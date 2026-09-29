const LEAD_OWNERS = Object.freeze({
  zeyzer: Object.freeze({
    id: "zeyzer",
    persistCustomerData: true,
    brevo: Object.freeze({
      apiKeyEnv: "BREVO_API_KEY",
      quoteTemplateIdEnv: "BREVO_TEMPLATE_ID_QUOTE",
      callTemplateIdEnv: "BREVO_TEMPLATE_ID_CALL",
      quoteListIdEnv: "BREVO_QUOTE_LIST_ID",
      callListIdEnv: "BREVO_CALL_LIST_ID",
      marketingListIdEnv: "BREVO_MARKETING_LIST_ID",
      callbackNotifyEmailEnv: "BREVO_CALLBACK_NOTIFY_EMAIL",
      callbackNotifyTemplateIdEnv: "BREVO_TEMPLATE_ID_CALLBACK_NOTIFY",
    }),
  }),
  "zion-energy": Object.freeze({
    id: "zion-energy",
    persistCustomerData: false,
    brevo: Object.freeze({
      apiKeyEnv: "ZION_BREVO_API_KEY",
      quoteTemplateIdEnv: "ZION_BREVO_TEMPLATE_ID_QUOTE",
      callTemplateIdEnv: "ZION_BREVO_TEMPLATE_ID_CALL",
      quoteListIdEnv: "ZION_BREVO_QUOTE_LIST_ID",
      callListIdEnv: "ZION_BREVO_CALL_LIST_ID",
      marketingListIdEnv: "ZION_BREVO_MARKETING_LIST_ID",
      callbackNotifyEmailEnv: "ZION_BREVO_CALLBACK_NOTIFY_EMAIL",
      callbackNotifyTemplateIdEnv: "ZION_BREVO_TEMPLATE_ID_CALLBACK_NOTIFY",
    }),
  }),
});

function getLeadOwnerById(leadOwner) {
  const ownerId = String(leadOwner || "").trim().toLowerCase();
  return ownerId ? LEAD_OWNERS[ownerId] || null : null;
}

function canPersistCustomerData(leadOwner) {
  return getLeadOwnerById(leadOwner)?.persistCustomerData === true;
}

function numberFromEnv(envName) {
  const value = process.env[envName];

  if (!value) return undefined;

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function getBrevoConfigForLeadOwner(leadOwner) {
  const owner = getLeadOwnerById(leadOwner);

  if (!owner?.brevo) {
    throw new Error(`No Brevo integration configured for lead owner: ${leadOwner}`);
  }

  return {
    leadOwner: owner.id,
    apiKey: process.env[owner.brevo.apiKeyEnv] || "",
    quoteTemplateId: numberFromEnv(owner.brevo.quoteTemplateIdEnv),
    callTemplateId: numberFromEnv(owner.brevo.callTemplateIdEnv),
    quoteListId: numberFromEnv(owner.brevo.quoteListIdEnv),
    callListId: numberFromEnv(owner.brevo.callListIdEnv),
    marketingListId: numberFromEnv(owner.brevo.marketingListIdEnv),
    callbackNotifyEmail:
      process.env[owner.brevo.callbackNotifyEmailEnv] || "",
    callbackNotifyTemplateId: numberFromEnv(
      owner.brevo.callbackNotifyTemplateIdEnv
    ),
  };
}

module.exports = {
  LEAD_OWNERS,
  getLeadOwnerById,
  canPersistCustomerData,
  getBrevoConfigForLeadOwner,
};
