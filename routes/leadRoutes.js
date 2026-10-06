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

function snapshotLeadActionData(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function scheduleBestEffortBackground(task) {
  // Best-effort in-process delivery: a restart or deploy after acknowledgement
  // can interrupt the PDF email. Durable retries are intentionally out of scope.
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((error) => {
        console.error(
          "Background PDF/email task failed unexpectedly:",
          error?.name || "Error"
        );
      });
  });
}

async function deliverQuotePdfEmailInBackground({
  contact,
  quote,
  input,
  leadId,
  brevoConfig,
  templateId,
  route,
  generatePdf = generateQuotePdfBuffer,
  sendQuoteEmail = sendQuoteEmailWithAttachment,
  recordEvent = recordLeadEventSafely,
}) {
  try {
    const pdfBuffer = await generatePdf({
      quote,
      form: input,
      roofs: input.roofs || [],
    });

    await sendQuoteEmail(
      contact,
      quote,
      input,
      pdfBuffer,
      templateId,
      brevoConfig
    );

    await recordEvent({
      leadId,
      eventType: "pdf_email_sent",
      contact,
      metadata: {
        route,
        templateId: templateId || null,
      },
    });
  } catch (error) {
    console.error(
      "Background PDF/email delivery failed:",
      error?.name || "Error"
    );

    await recordEvent({
      leadId,
      eventType: "pdf_email_failed",
      contact,
      metadata: {
        route,
        templateId: templateId || null,
      },
    });
  }
}

function createEmailQuoteHandler({
  resolveRouting = resolveLeadActionRouting,
  upsertContact = upsertBrevoContact,
  generatePdf = generateQuotePdfBuffer,
  sendQuoteEmail = sendQuoteEmailWithAttachment,
  recordEvent = recordLeadEventSafely,
  scheduleBackground = scheduleBestEffortBackground,
} = {}) {
  return async (req, res) => {
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
    const routing = await resolveRouting(actionLeadId);
    const brevoConfig = routing.integration.brevo;

    await upsertContact(contact, {
      brevoConfig,
      baseListId: brevoConfig.quoteListId,
      marketingConsent: !!marketingConsent,
      leadType: "email_quote",
    });

    const emailInput = {
      ...input,
      leadType: "email_quote",
    };
    const snapshot = snapshotLeadActionData({
      contact,
      quote,
      input: emailInput,
      leadId: actionLeadId,
      brevoConfig,
    });

    await recordEvent({
      leadId: actionLeadId,
      eventType: "pdf_email_requested",
      contact,
      metadata: {
        route: "/api/lead/email-quote",
        templateId: brevoConfig.quoteTemplateId || null,
      },
    });

    scheduleBackground(() =>
      deliverQuotePdfEmailInBackground({
        ...snapshot,
        templateId:
          snapshot.brevoConfig.quoteTemplateId,
        route: "/api/lead/email-quote",
        generatePdf,
        sendQuoteEmail,
        recordEvent,
      })
    );

    return res.status(202).json({
      ok: true,
      accepted: true,
      leadId: actionLeadId || null,
    });

  } catch (err) {
    console.error(
      "Error in /api/lead/email-quote:",
      err?.message || "Unknown error"
    );

    return res.status(500).json({
      ok: false,
      error: "Server error sending quote email.",
    });
  }
  };
}

// POST /api/lead/email-quote
router.post("/email-quote", createEmailQuoteHandler());

function createRequestCallHandler({
  resolveRouting = resolveLeadActionRouting,
  upsertContact = upsertBrevoContact,
  sendCallback = sendCallbackNotification,
  generatePdf = generateQuotePdfBuffer,
  sendQuoteEmail = sendQuoteEmailWithAttachment,
  recordEvent = recordLeadEventSafely,
  scheduleBackground = scheduleBestEffortBackground,
} = {}) {
  return async (req, res) => {
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
    const routing = await resolveRouting(actionLeadId);
    const brevoConfig = routing.integration.brevo;

    await upsertContact(contact, {
      brevoConfig,
      baseListId: brevoConfig.callListId,
      marketingConsent: !!marketingConsent,
      leadType: "request_call",
    });

    const callInput = {
      ...input,
      leadType: "request_call",
    };
    const snapshot = snapshotLeadActionData({
      contact,
      quote,
      input: callInput,
      leadId: actionLeadId,
      brevoConfig,
    });

    const callbackResult = await sendCallback({
      contact,
      quote,
      input: callInput,
      leadId: actionLeadId,
      routing,
      brevoConfig,
    });

    if (
      callbackResult?.skipped &&
      routing.leadOwner === "zion-energy"
    ) {
      throw new Error(
        "Required Zion callback notification was skipped."
      );
    }

    await recordEvent({
      leadId: actionLeadId,
      eventType: "call_requested",
      contact,
      metadata: {
        route: "/api/lead/request-call",
        templateId:
          brevoConfig.callbackNotifyTemplateId || null,
      },
    });

    console.log("Callback requested:", {
      leadId: actionLeadId || null,
      leadOwner: routing.leadOwner,
      ts: new Date().toISOString(),
    });

    scheduleBackground(() =>
      deliverQuotePdfEmailInBackground({
        ...snapshot,
        templateId:
          snapshot.brevoConfig.callTemplateId,
        route: "/api/lead/request-call",
        generatePdf,
        sendQuoteEmail,
        recordEvent,
      })
    );

    return res.status(202).json({
      ok: true,
      accepted: true,
      leadId: actionLeadId || null,
    });

    
  } catch (err) {
    console.error(
      "Error in /api/lead/request-call:",
      err?.message || "Unknown error"
    );

    return res.status(500).json({
      ok: false,
      error: "Server error requesting call.",
    });
  }
  };
}

// POST /api/lead/request-call
router.post("/request-call", createRequestCallHandler());

module.exports = router;
module.exports.createEmailQuoteHandler = createEmailQuoteHandler;
module.exports.createRequestCallHandler = createRequestCallHandler;
module.exports.deliverQuotePdfEmailInBackground =
  deliverQuotePdfEmailInBackground;
module.exports.snapshotLeadActionData = snapshotLeadActionData;
