// ------------------------------
// Lead capture + Brevo email
// ------------------------------

const express = require("express");

const {
  BREVO_TEMPLATE_ID_QUOTE,
  BREVO_TEMPLATE_ID_CALL,
  BREVO_QUOTE_LIST_ID,
  BREVO_CALL_LIST_ID,
  upsertBrevoContact,
  sendQuoteEmailWithAttachment,
} = require("../services/brevoService");

const {
  generateQuotePdfBuffer,
} = require("../services/pdfService");

const router = express.Router();

// POST /api/lead/email-quote
router.post("/email-quote", async (req, res) => {
  try {
    const { contact, quote, input, marketingConsent } = req.body || {};

    console.log("✅ /api/lead/email-quote hit", req.body?.contact?.email);

    if (!contact || !quote || !input) {
      return res.status(400).json({
        ok: false,
        error: "Missing contact, quote, or input.",
      });
    }

    if (!contact.email || typeof contact.email !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Email is required.",
      });
    }

    if (!contact.name || typeof contact.name !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Name is required.",
      });
    }

    await upsertBrevoContact(contact, {
      baseListId: BREVO_QUOTE_LIST_ID,
      marketingConsent: !!marketingConsent,
      leadType: "email_quote",
    });

    const emailInput = {
      ...input,
      leadType: "email_quote",
    };

    const pdfBuffer = await generateQuotePdfBuffer({
      quote,
      form: emailInput,
      roofs: emailInput.roofs || [],
    });

    await sendQuoteEmailWithAttachment(
      contact,
      quote,
      emailInput,
      pdfBuffer,
      BREVO_TEMPLATE_ID_QUOTE
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("Error in /api/lead/email-quote:", err);

    return res.status(500).json({
      ok: false,
      error: "Server error sending quote email.",
    });
  }
});

// POST /api/lead/request-call
router.post("/request-call", async (req, res) => {
  try {
    const { contact, quote, input, marketingConsent } = req.body || {};

    console.log("✅ /api/lead/request-call hit", req.body?.contact?.email);

    if (!contact || !quote || !input) {
      return res.status(400).json({
        ok: false,
        error: "Missing contact, quote, or input.",
      });
    }

    if (!contact.email || typeof contact.email !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Email is required.",
      });
    }

    if (!contact.name || typeof contact.name !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Name is required.",
      });
    }

    if (!contact.phone || typeof contact.phone !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Phone is required.",
      });
    }

    await upsertBrevoContact(contact, {
      baseListId: BREVO_CALL_LIST_ID,
      marketingConsent: !!marketingConsent,
      leadType: "request_call",
    });

    const callInput = {
      ...input,
      leadType: "request_call",
    };

    const pdfBuffer = await generateQuotePdfBuffer({
      quote,
      form: callInput,
      roofs: callInput.roofs || [],
    });

    await sendQuoteEmailWithAttachment(
      contact,
      quote,
      callInput,
      pdfBuffer,
      BREVO_TEMPLATE_ID_CALL
    );

    console.log("Callback requested:", {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      address: contact.address || "",
      ts: new Date().toISOString(),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Error in /api/lead/request-call:", err);

    return res.status(500).json({
      ok: false,
      error: "Server error requesting call.",
    });
  }
});

module.exports = router;