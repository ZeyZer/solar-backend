require("dotenv").config();

const SibApiV3Sdk = require("sib-api-v3-sdk");

const brevoClient = SibApiV3Sdk.ApiClient.instance;

brevoClient.authentications["api-key"].apiKey =
  process.env.BREVO_API_KEY || "";

brevoClient.authentications["partner-key"].apiKey =
  process.env.BREVO_API_KEY || "";

console.log("BREVO key loaded:", (process.env.BREVO_API_KEY || "").slice(0, 8));

const brevoContactsApi = new SibApiV3Sdk.ContactsApi();
const brevoEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

const BREVO_TEMPLATE_ID_QUOTE = process.env.BREVO_TEMPLATE_ID_QUOTE
  ? Number(process.env.BREVO_TEMPLATE_ID_QUOTE)
  : undefined;

const BREVO_TEMPLATE_ID_CALL = process.env.BREVO_TEMPLATE_ID_CALL
  ? Number(process.env.BREVO_TEMPLATE_ID_CALL)
  : undefined;

const BREVO_QUOTE_LIST_ID = process.env.BREVO_QUOTE_LIST_ID
  ? Number(process.env.BREVO_QUOTE_LIST_ID)
  : undefined;

const BREVO_CALL_LIST_ID = process.env.BREVO_CALL_LIST_ID
  ? Number(process.env.BREVO_CALL_LIST_ID)
  : undefined;

const BREVO_MARKETING_LIST_ID = process.env.BREVO_MARKETING_LIST_ID
  ? Number(process.env.BREVO_MARKETING_LIST_ID)
  : undefined;

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
  { baseListId, marketingConsent = false, leadType = "" } = {}
) {
  if (!process.env.BREVO_API_KEY) {
    console.log("No BREVO_API_KEY set, skipping Brevo sync.");
    return;
  }

  if (!contact?.email) {
    console.log("No email on contact, skipping Brevo sync.");
    return;
  }

  const listIds = [];

  if (baseListId) listIds.push(baseListId);
  if (marketingConsent && BREVO_MARKETING_LIST_ID) {
    listIds.push(BREVO_MARKETING_LIST_ID);
  }

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
    await brevoContactsApi.createContact(createContact);
    console.log("Brevo contact created:", contact.email);
  } catch (err) {
    if (
      err.response &&
      err.response.body &&
      err.response.body.code === "duplicate_parameter"
    ) {
      const updateContact = new SibApiV3Sdk.UpdateContact();
      updateContact.attributes = attributes;
      updateContact.listIds = listIds;

      await brevoContactsApi.updateContact(contact.email, updateContact);
      console.log("Brevo contact updated:", contact.email);
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
  templateId
) {
  if (!process.env.BREVO_API_KEY) {
    console.log("No BREVO_API_KEY set, skipping Brevo email send.");
    return;
  }

  if (!templateId) {
    console.log("No templateId provided, skipping Brevo email send.");
    return;
  }

  if (!pdfBuffer) {
    console.log("No pdfBuffer provided, skipping Brevo email send.");
    return;
  }

  const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");

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

  await brevoEmailApi.sendTransacEmail(sendSmtpEmail);

  console.log(
    "Brevo quote email sent to:",
    contact.email,
    "using template:",
    templateId
  );
}

module.exports = {
  BREVO_TEMPLATE_ID_QUOTE,
  BREVO_TEMPLATE_ID_CALL,
  BREVO_QUOTE_LIST_ID,
  BREVO_CALL_LIST_ID,
  BREVO_MARKETING_LIST_ID,
  formatUkPhoneForBrevo,
  upsertBrevoContact,
  sendQuoteEmailWithAttachment,
};