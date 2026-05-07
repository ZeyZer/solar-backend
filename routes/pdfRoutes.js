const express = require("express");

const {
  generateQuotePdfBuffer,
  getPdfQuoteDataById,
} = require("../services/pdfService");

const {
  recordLeadEvent,
  getLeadFromSupabaseByLeadId,
} = require("../services/supabaseLeadService");

const router = express.Router();

// PDF REGENERATION
function buildPdfDataFromLeadRow(leadRow) {
  if (!leadRow) {
    return null;
  }

  const quote = leadRow.quote || leadRow.full_payload?.quote || null;
  const form = leadRow.form || leadRow.full_payload?.form || null;
  const roofs = Array.isArray(leadRow.roofs)
    ? leadRow.roofs
    : Array.isArray(leadRow.full_payload?.roofs)
      ? leadRow.full_payload.roofs
      : [];

  if (!quote || !form) {
    return null;
  }

  const leadId = leadRow.lead_id || quote.leadId || form.leadId || "";

  return {
    quote: {
      ...quote,
      leadId,
    },
    form: {
      ...form,
      leadId,
    },
    roofs,
  };
}


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


// POST /api/quote/pdf/from-lead/:leadId
router.post("/pdf/from-lead/:leadId", async (req, res) => {
  const leadId = String(req.params.leadId || "").trim();

  try {
    if (!leadId) {
      return res.status(400).json({
        error: "Missing lead ID.",
      });
    }

    const leadRow = await getLeadFromSupabaseByLeadId(leadId);

    if (!leadRow) {
      return res.status(404).json({
        error: "Lead not found.",
      });
    }

    const pdfData = buildPdfDataFromLeadRow(leadRow);

    if (!pdfData) {
      return res.status(400).json({
        error: "Lead does not contain enough quote data to regenerate PDF.",
      });
    }

    const pdf = await generateQuotePdfBuffer(pdfData);

    try {
      const result = await recordLeadEvent({
        leadId,
        eventType: "pdf_regenerated",
        email: pdfData.form?.email || leadRow.email || "",
        phone: pdfData.form?.phone || leadRow.phone || "",
        metadata: {
          route: "/api/quote/pdf/from-lead/:leadId",
        },
      });

      if (result?.skipped) {
        console.log("PDF regeneration event skipped:", result.reason);
      } else {
        console.log("PDF regeneration event recorded:", leadId);
      }
    } catch (eventErr) {
      console.error("PDF regeneration event failed:", eventErr.message);
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="solar-quote-${leadId}.pdf"`,
    });

    return res.send(pdf);
  } catch (err) {
    console.error("PDF regeneration from lead failed:", err);

    return res.status(500).json({
      error: "PDF regeneration from lead failed.",
    });
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