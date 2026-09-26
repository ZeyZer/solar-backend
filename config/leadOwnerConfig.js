const LEAD_OWNERS = Object.freeze({
  zeyzer: Object.freeze({
    id: "zeyzer",
    persistCustomerData: true,
  }),
  "zion-energy": Object.freeze({
    id: "zion-energy",
    persistCustomerData: false,
    brevo: Object.freeze({
      apiKeyEnv: "BREVO_API_KEY",
      quoteTemplateIdEnv: "BREVO_TEMPLATE_ID_QUOTE",
      callTemplateIdEnv: "BREVO_TEMPLATE_ID_CALL",
      quoteListIdEnv: "BREVO_QUOTE_LIST_ID",
      callListIdEnv: "BREVO_CALL_LIST_ID",
      marketingListIdEnv: "BREVO_MARKETING_LIST_ID",
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
  };
}

module.exports = {
  LEAD_OWNERS,
  getLeadOwnerById,
  canPersistCustomerData,
  getBrevoConfigForLeadOwner,
};
