const express = require("express");

const {
  generateQuotePdfBuffer,
  getLatestPdfQuoteData,
} = require("../services/pdfService");

const router = express.Router();

// POST /api/quote/pdf
router.post("/pdf", async (req, res) => {
  try {
    const { quote, form, roofs } = req.body || {};

    const pdf = await generateQuotePdfBuffer({
      quote,
      form,
      roofs: roofs || [],
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="solar-quote.pdf"',
    });

    res.send(pdf);
  } catch (err) {
    console.error("PDF generation failed:", err);
    res.status(500).json({ error: "PDF generation failed." });
  }
});

// GET /api/quote/pdf-data
router.get("/pdf-data", (req, res) => {
  const latestPdfQuoteData = getLatestPdfQuoteData();

  if (!latestPdfQuoteData) {
    return res.status(404).json({
      error: "No PDF quote data found.",
    });
  }

  res.json(latestPdfQuoteData);
});

module.exports = router;