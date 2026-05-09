const crypto = require("crypto");
const puppeteer = require("puppeteer");

const pdfQuoteDataById = new Map();

const PDF_DATA_TTL_MS = 10 * 60 * 1000;

function getFrontendUrl() {
  const rawUrl =
    process.env.PDF_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:3000";

  const frontendUrl = String(rawUrl || "")
    .trim()
    .replace(/\/+$/, "");

  return frontendUrl || "http://localhost:3000";
}

function buildPdfRouteUrl(pdfId) {
  const frontendUrl = getFrontendUrl();

  // Use /index.html explicitly for Hostinger.
  // The hash part is handled by React in the browser.
  return `${frontendUrl}/index.html#/quote-pdf?id=${encodeURIComponent(pdfId)}`;
}

function cleanupExpiredPdfQuoteData() {
  const now = Date.now();

  for (const [pdfId, record] of pdfQuoteDataById.entries()) {
    if (!record?.createdAt || now - record.createdAt > PDF_DATA_TTL_MS) {
      pdfQuoteDataById.delete(pdfId);
    }
  }
}

function savePdfQuoteData({ quote, form, roofs }) {
  cleanupExpiredPdfQuoteData();

  const pdfId =
    crypto.randomUUID?.() ||
    `pdf-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  pdfQuoteDataById.set(pdfId, {
    createdAt: Date.now(),
    quote,
    form,
    roofs: roofs || [],
  });

  return pdfId;
}

function getPdfQuoteDataById(pdfId) {
  cleanupExpiredPdfQuoteData();

  if (!pdfId) return null;

  const record = pdfQuoteDataById.get(pdfId);

  if (!record) return null;

  return {
    quote: record.quote,
    form: record.form,
    roofs: record.roofs || [],
  };
}

function deletePdfQuoteDataById(pdfId) {
  if (!pdfId) return;

  pdfQuoteDataById.delete(pdfId);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPdfPageToSettle(page) {
  await page.emulateMediaType("print");

  try {
    await page.waitForFunction(
      () =>
        window.__QUOTE_PDF_READY__ === true ||
        Boolean(window.__QUOTE_PDF_ERROR__),
      {
        timeout: 25000,
      }
    );
  } catch (err) {
    console.log("PDF ready flag wait timed out:", err.message);
  }

  const pdfStatus = await page.evaluate(() => ({
    ready: window.__QUOTE_PDF_READY__ === true,
    error: window.__QUOTE_PDF_ERROR__ || "",
    hash: window.location.hash || "",
    href: window.location.href || "",
    bodyText: (document.body?.innerText || "").slice(0, 500),
  }));

  console.log("PDF route browser status:", pdfStatus);

  if (pdfStatus.error) {
    throw new Error(`PDF frontend reported error: ${pdfStatus.error}`);
  }

  if (!pdfStatus.ready) {
    throw new Error("PDF frontend did not report ready.");
  }

  if (!String(pdfStatus.hash || "").startsWith("#/quote-pdf")) {
    throw new Error(`PDF frontend navigated away from quote-pdf route: ${pdfStatus.href}`);
  }

  try {
    await page.evaluateHandle("document.fonts.ready");
  } catch (err) {
    console.log("Font readiness check skipped:", err.message);
  }

  try {
    await page.waitForFunction(
      () =>
        Array.from(document.images || []).every(
          (img) => img.complete && img.naturalHeight > 0
        ),
      {
        timeout: 10000,
      }
    );
  } catch {
    console.log("Some images did not finish loading before PDF render");
  }

  await wait(2000);

  try {
    const bodyHeight = await page.evaluate(() => {
      window.scrollTo(0, 0);
      return document.body?.offsetHeight || 0;
    });

    console.log("PDF page body height:", bodyHeight);
  } catch (err) {
    console.log("Final PDF page evaluate skipped:", err.message);
  }
}

async function generateQuotePdfBuffer({ quote, form, roofs }) {
  if (!quote || !form) {
    throw new Error("Missing quote or form data.");
  }

  const pdfId = savePdfQuoteData({
    quote,
    form,
    roofs: roofs || [],
  });

  console.log("Saved PDF quote data:", {
    pdfId,
    storedPdfQuotes: pdfQuoteDataById.size,
  });

  console.log("PDF frontend URL:", getFrontendUrl());
  console.log("Launching Puppeteer...");

  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 80000,
    timeout: 80000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  });

  console.log("Puppeteer launched successfully");

  try {
    const page = await browser.newPage();

    await page.setCacheEnabled(false);

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        console.log("PDF page navigated:", frame.url());
      }
    });

    page.on("pageerror", (err) => {
      console.error("PDF page error:", err.message);
    });

    page.on("console", (msg) => {
      const text = msg.text();

      if (
        text.includes("Failed") ||
        text.includes("Error") ||
        text.includes("PDF") ||
        text.includes("quote") ||
        text.includes("lead")
      ) {
        console.log("PDF page console:", text);
      }
    });

    const pdfUrl = buildPdfRouteUrl(pdfId);
    console.log("Opening PDF page:", pdfUrl);

    await page.setViewport({
      width: 1240,
      height: 1754,
      deviceScaleFactor: 1,
    });

    const response = await page.goto(pdfUrl, {
      waitUntil: "domcontentloaded",
      timeout: 80000,
    });

    const status = response?.status?.() || 0;

    console.log("PDF page initial status:", status || "unknown");
    console.log("PDF page final URL after goto:", page.url());

    if (status >= 400) {
      throw new Error(`PDF frontend returned HTTP ${status} for ${pdfUrl}`);
    }

    await waitForPdfPageToSettle(page);

    console.log("/quote-pdf page loaded and settled");

    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "0mm",
        bottom: "0mm",
        left: "0mm",
        right: "0mm",
      },
    });

    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();

    deletePdfQuoteDataById(pdfId);

    console.log("Deleted PDF quote data:", {
      pdfId,
      storedPdfQuotes: pdfQuoteDataById.size,
    });
  }
}

module.exports = {
  generateQuotePdfBuffer,
  getPdfQuoteDataById,
};