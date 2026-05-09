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

  if (!frontendUrl) {
    return "http://localhost:3000";
  }

  return frontendUrl;
}

function buildPdfRouteUrl(pdfId) {
  const frontendUrl = getFrontendUrl();

  return `${frontendUrl}/#/quote-pdf?id=${encodeURIComponent(pdfId)}`;
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

  // Hostinger/React can trigger a late navigation after the first load.
  // This should never fail the PDF generation.
  await page
    .waitForNavigation({
      waitUntil: "networkidle0",
      timeout: 10000,
    })
    .catch(() => null);

  await wait(3000);

  try {
    await page.evaluateHandle("document.fonts.ready");
  } catch (err) {
    console.log("Font readiness check skipped:", err.message);
  }

  try {
    await page.waitForFunction(
      () => {
        const bodyText = document.body?.innerText || "";

        const hasLoadingText =
          bodyText.includes("Loading") ||
          bodyText.includes("loading") ||
          bodyText.includes("Preparing");

        const hasPdfErrorText =
          bodyText.includes("Failed to load PDF") ||
          bodyText.includes("No PDF quote data") ||
          bodyText.includes("Missing PDF ID");

        return document.body && !hasLoadingText && !hasPdfErrorText;
      },
      {
        timeout: 20000,
      }
    );
  } catch (err) {
    console.log("PDF route settle check timed out:", err.message);
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

  await wait(2500);

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

    console.log("PDF page initial status:", response?.status?.() || "unknown");
    console.log("PDF page final URL after goto:", page.url());

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