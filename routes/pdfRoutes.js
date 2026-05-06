const express = require("express");

const {
  generateQuotePdfBuffer,
  getPdfQuoteDataById,
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

// GET /api/quote/pdf-data?id=<pdfId>
router.get("/pdf-data", (req, res) => {
  const pdfId = String(req.query.id || "").trim();

  if (!pdfId) {
    return res.status(400).json({
      error: "Missing PDF ID.",
    });
  }

  const pdfQuoteData = getPdfQuoteDataById(pdfId);

  if (!pdfQuoteData) {
    return res.status(404).json({
      error: "No PDF quote data found for this ID.",
    });
  }

  res.json(pdfQuoteData);
});

module.exports = router;