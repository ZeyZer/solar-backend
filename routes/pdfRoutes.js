const express = require("express");

const {
  generateQuotePdfBuffer,
  getPdfQuoteDataById,
} = require("../services/pdfService");

const {
  recordLeadEvent,
} = require("../services/supabaseLeadService");

const router = express.Router();


// PDF DOWNLOAD ID TRACKER
async function recordPdfDownloadSafely({ leadId, quote, form }) {
  const actionLeadId =
    leadId ||
    quote?.leadId ||
    form?.leadId ||
    form?.quoteLeadId ||
    "";

  if (!actionLeadId) {
    console.log("PDF download event skipped: missing leadId.");
    return;
  }

  try {
    const result = await recordLeadEvent({
      leadId: actionLeadId,
      eventType: "pdf_downloaded",
      email: form?.email || "",
      phone: form?.phone || "",
      metadata: {
        route: "/api/quote/pdf",
      },
    });

    if (result?.skipped) {
      console.log("PDF download event skipped:", result.reason);
    } else {
      console.log("PDF download event recorded:", actionLeadId);
    }
  } catch (err) {
    console.error("PDF download event failed:", err.message);
  }
}

// POST /api/quote/pdf
router.post("/pdf", async (req, res) => {
  try {
    const { quote, form, roofs, leadId } = req.body || {};

    const pdf = await generateQuotePdfBuffer({
      quote,
      form,
      roofs: roofs || [],
    });

    await recordPdfDownloadSafely({
      leadId,
      quote,
      form,
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