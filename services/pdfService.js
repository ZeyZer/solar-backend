const puppeteer = require("puppeteer");

let latestPdfQuoteData = null;

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  "http://localhost:3000";
    //http://localhost:3000
    //https://www.zeyzersolar.com

async function generateQuotePdfBuffer({ quote, form, roofs }) {
  if (!quote || !form) {
    throw new Error("Missing quote or form data.");
  }

  latestPdfQuoteData = {
    quote,
    form,
    roofs: roofs || [],
  };

  console.log("Saved latest PDF quote data");
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

    const pdfUrl = `${FRONTEND_URL}/#/quote-pdf`;
    console.log("Opening PDF page:", pdfUrl);

    await page.setViewport({
      width: 1240,
      height: 1754,
      deviceScaleFactor: 1,
    });

    await page.goto(pdfUrl, {
      waitUntil: ["load", "domcontentloaded", "networkidle0"],
      timeout: 80000,
    });

    await page.emulateMediaType("print");

    await page.evaluateHandle("document.fonts.ready");

    await page
      .waitForFunction(
        () =>
          Array.from(document.images).every(
            (img) => img.complete && img.naturalHeight > 0
          ),
        { timeout: 10000 }
      )
      .catch(() => {
        console.log("Some images did not finish loading before PDF render");
      });

    await page.waitForTimeout?.(2500).catch?.(() => null);
    await new Promise((resolve) => setTimeout(resolve, 2500));

    await page.evaluate(() => {
      document.body.offsetHeight;
      window.scrollTo(0, 0);
    });

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
  }
}

function getLatestPdfQuoteData() {
  return latestPdfQuoteData;
}

module.exports = {
  generateQuotePdfBuffer,
  getLatestPdfQuoteData,
};