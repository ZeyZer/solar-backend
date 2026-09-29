require("dotenv").config();

const SibApiV3Sdk = require("sib-api-v3-sdk");

function createBrevoApis(apiKey) {
  const client = new SibApiV3Sdk.ApiClient();
  client.authentications["api-key"].apiKey = apiKey;
  client.authentications["partner-key"].apiKey = apiKey;

  return {
    contactsApi: new SibApiV3Sdk.ContactsApi(client),
    emailApi: new SibApiV3Sdk.TransactionalEmailsApi(client),
  };
}

function formatUkPhoneForBrevo(phone) {
  const raw = String(phone || "").replace(/\s+/g, "");

  if (!raw) return "";

  if (raw.startsWith("+44")) return raw;
  if (raw.startsWith("0044")) return `+${raw.slice(2)}`;
  if (raw.startsWith("0")) return `+44${raw.slice(1)}`;

  return raw;
}

async function upsertBrevoContact(
  contact,
  {
    brevoConfig = {},
    baseListId,
    marketingConsent = false,
    leadType = "",
  } = {}
) {
  if (!brevoConfig.apiKey) {
    throw new Error(
      `Brevo API key is not configured for lead owner: ${
        brevoConfig.leadOwner || "unknown"
      }.`
    );
  }

  if (!contact?.email) {
    throw new Error("Brevo contact sync requires a customer email.");
  }

  if (!baseListId) {
    throw new Error(
      `Brevo contact list is not configured for lead owner: ${
        brevoConfig.leadOwner || "unknown"
      }.`
    );
  }

  const listIds = [baseListId];
  if (marketingConsent && brevoConfig.marketingListId) {
    listIds.push(brevoConfig.marketingListId);
  }

  const { contactsApi } = createBrevoApis(brevoConfig.apiKey);

  const attributes = {
    FIRSTNAME: contact.name || "",
    ADDRESS: contact.address || "",
    SMS: formatUkPhoneForBrevo(contact.phone),
    LEAD_TYPE: leadType || "",
    MARKETING_CONSENT: !!marketingConsent,
  };

  const createContact = new SibApiV3Sdk.CreateContact();
  createContact.email = contact.email;
  createContact.attributes = attributes;
  createContact.listIds = listIds;

  try {
    await contactsApi.createContact(createContact);
    console.log("Brevo contact created for routed lead owner.");
  } catch (err) {
    if (
      err.response &&
      err.response.body &&
      err.response.body.code === "duplicate_parameter"
    ) {
      const updateContact = new SibApiV3Sdk.UpdateContact();
      updateContact.attributes = attributes;
      updateContact.listIds = listIds;

      await contactsApi.updateContact(contact.email, updateContact);
      console.log("Brevo contact updated for routed lead owner.");
    } else {
      throw err;
    }
  }
}

async function sendQuoteEmailWithAttachment(
  contact,
  quote,
  input,
  pdfBuffer,
  templateId,
  brevoConfig = {}
) {
  if (!brevoConfig.apiKey) {
    throw new Error(
      `Brevo API key is not configured for lead owner: ${
        brevoConfig.leadOwner || "unknown"
      }.`
    );
  }

  if (!contact?.email) {
    throw new Error("Brevo quote email requires a customer email.");
  }

  if (!templateId) {
    throw new Error(
      `Brevo quote email template is not configured for lead owner: ${
        brevoConfig.leadOwner || "unknown"
      }.`
    );
  }

  if (!pdfBuffer) {
    throw new Error("Brevo quote email requires a PDF attachment.");
  }

  const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");
  const { emailApi } = createBrevoApis(brevoConfig.apiKey);

  console.log("PDF attachment bytes:", Buffer.from(pdfBuffer).length);
  console.log("PDF attachment base64 length:", pdfBase64.length);

  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

  sendSmtpEmail.to = [
    {
      email: contact.email,
      name: contact.name || "",
    },
  ];

  sendSmtpEmail.templateId = templateId;

  sendSmtpEmail.params = {
    name: contact.name || "",
    address: contact.address || "",
    lead_type: input?.leadType || "",

    system_kwp: quote.systemSizeKwp,
    panel_count: quote.panelCount,
    panel_watt: quote.panelWatt,
    annual_kwh: quote.estAnnualGenerationKWh,
    price_low: quote.priceLow,
    price_high: quote.priceHigh,

    battery_kwh: input?.batteryKWh || 0,
    bird_protection: input?.extras?.birdProtection ? "Yes" : "No",
    ev_charger: input?.extras?.evCharger ? "Yes" : "No",

    annual_savings: quote.annualBillSavings || 0,
    seg_income: quote.annualSegIncome || 0,
    total_benefit: quote.totalAnnualBenefit || 0,
    payback_years: quote.simplePaybackYears || "",
  };

  sendSmtpEmail.attachment = [
    {
      name: "solar-quote.pdf",
      content: pdfBase64,
    },
  ];

  await emailApi.sendTransacEmail(sendSmtpEmail);

  console.log(
    "Brevo quote email sent using routed template:",
    templateId
  );
}


async function sendCallbackNotification({
  contact,
  quote,
  input,
  leadId,
  routing,
  brevoConfig = {},
}) {
  const recipientEmail = String(
    brevoConfig.callbackNotifyEmail || ""
  ).trim();

  const templateId = brevoConfig.callbackNotifyTemplateId;

  if (!recipientEmail || !templateId) {
    return {
      skipped: true,
      reason: "Callback notification email/template is not configured.",
    };
  }

  if (!brevoConfig.apiKey) {
    throw new Error(
      `Brevo API key is not configured for lead owner: ${
        brevoConfig.leadOwner || "unknown"
      }.`
    );
  }

  const { emailApi } = createBrevoApis(brevoConfig.apiKey);
  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

  sendSmtpEmail.to = [
    {
      email: recipientEmail,
    },
  ];

  sendSmtpEmail.templateId = templateId;

  sendSmtpEmail.params = {
    lead_id: leadId || "",
    lead_owner: routing?.leadOwner || brevoConfig.leadOwner || "",
    source: routing?.source || "",

    name: contact?.name || "",
    email: contact?.email || "",
    phone: formatUkPhoneForBrevo(contact?.phone),
    address: contact?.address || "",
    postcode: input?.postcode || "",

    system_kwp: quote?.systemSizeKwp || "",
    panel_count: quote?.panelCount || "",
    panel_watt: quote?.panelWatt || "",
    annual_kwh: quote?.estAnnualGenerationKWh || "",
    battery_kwh: input?.batteryKWh || 0,
    price_low: quote?.priceLow || "",
    price_high: quote?.priceHigh || "",
  };

  await emailApi.sendTransacEmail(sendSmtpEmail);

  console.log(
    "Brevo callback notification sent for routed lead owner:",
    routing?.leadOwner || brevoConfig.leadOwner || "unknown"
  );

  return {
    skipped: false,
  };
}

module.exports = {
  formatUkPhoneForBrevo,
  upsertBrevoContact,
  sendQuoteEmailWithAttachment,
  sendCallbackNotification,
};
