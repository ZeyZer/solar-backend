// ------------------------------
// Lead capture + Brevo email
// ------------------------------

const express = require("express");

const {
  upsertBrevoContact,
  sendQuoteEmailWithAttachment,
  sendCallbackNotification,
} = require("../services/integrations/brevoService");

const {
  resolveLeadActionRouting,
} = require("../services/leads/leadRoutingService");

const {
  recordLeadEvent,
} = require("../services/leads/supabaseLeadService");

const {
  generateQuotePdfBuffer,
} = require("../services/pdf/pdfService");

const router = express.Router();


// LEAD REQUEST TRACKER
function getLeadIdFromPayload({ leadId, quote, input }) {
  return (
    leadId ||
    quote?.leadId ||
    input?.leadId ||
    input?.quoteLeadId ||
    ""
  );
}

async function recordLeadEventSafely({
  leadId,
  eventType,
  contact,
  metadata = {},
}) {
  try {
    const result = await recordLeadEvent({
      leadId,
      eventType,
      email: contact?.email || "",
      phone: contact?.phone || "",
      metadata,
    });

    if (result?.skipped) {
      console.log(`Lead event skipped (${eventType}):`, result.reason);
    } else {
      console.log(`Lead event recorded (${eventType}):`, leadId);
    }
  } catch (err) {
    console.error(`Lead event failed (${eventType}):`, err.message);
  }
}

async function sendCallbackNotificationSafely({
  contact,
  quote,
  input,
  leadId,
  routing,
  brevoConfig,
}) {
  try {
    const result = await sendCallbackNotification({
      contact,
      quote,
      input,
      leadId,
      routing,
      brevoConfig,
    });

    if (result?.skipped) {
      console.log("Callback notification skipped:", result.reason);
    }
  } catch (err) {
    console.error("Callback notification failed:", err.message);
  }
}

// POST /api/lead/email-quote
router.post("/email-quote", async (req, res) => {
  try {
    const { contact, quote, input, marketingConsent, leadId } = req.body || {};

    console.log("✅ /api/lead/email-quote hit");

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

    const actionLeadId = getLeadIdFromPayload({
      leadId,
      quote,
      input,
    });
    const routing = await resolveLeadActionRouting(actionLeadId);
    const brevoConfig = routing.integration.brevo;

    await upsertBrevoContact(contact, {
      brevoConfig,
      baseListId: brevoConfig.quoteListId,
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
      brevoConfig.quoteTemplateId,
      brevoConfig
    );

    await recordLeadEventSafely({
      leadId: actionLeadId,
      eventType: "pdf_email_requested",
      contact,
      metadata: {
        route: "/api/lead/email-quote",
        marketingConsent: !!marketingConsent,
        templateId: brevoConfig.quoteTemplateId || null,
      },
    });

    return res.json({
      ok: true,
      leadId: actionLeadId || null,
    });

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
    const { contact, quote, input, marketingConsent, leadId } = req.body || {};

    console.log("✅ /api/lead/request-call hit");

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

    const actionLeadId = getLeadIdFromPayload({
      leadId,
      quote,
      input,
    });
    const routing = await resolveLeadActionRouting(actionLeadId);
    const brevoConfig = routing.integration.brevo;

    await upsertBrevoContact(contact, {
      brevoConfig,
      baseListId: brevoConfig.callListId,
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
      brevoConfig.callTemplateId,
      brevoConfig
    );

    await sendCallbackNotificationSafely({
      contact,
      quote,
      input: callInput,
      leadId: actionLeadId,
      routing,
      brevoConfig,
    });

    await recordLeadEventSafely({
      leadId: actionLeadId,
      eventType: "call_requested",
      contact,
      metadata: {
        route: "/api/lead/request-call",
        marketingConsent: !!marketingConsent,
        templateId: brevoConfig.callTemplateId || null,
      },
    });

    console.log("Callback requested:", {
      leadId: actionLeadId || null,
      leadOwner: routing.leadOwner,
      ts: new Date().toISOString(),
    });

    return res.json({
      ok: true,
      leadId: actionLeadId || null,
    });

    
  } catch (err) {
    console.error("Error in /api/lead/request-call:", err);

    return res.status(500).json({
      ok: false,
      error: "Server error requesting call.",
    });
  }
});

module.exports = router;
