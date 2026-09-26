const {
  getLeadById,
} = require("./leadStorageService");

const {
  getLeadFromSupabaseByLeadId,
  resolveStoredLeadRouting,
} = require("./supabaseLeadService");

const {
  getBrevoConfigForLeadOwner,
} = require("../../config/leadOwnerConfig");

function toSupabaseShape(localLead) {
  if (!localLead) return null;

  return {
    ...localLead,
    lead_id: localLead.leadId,
    tenant_id: localLead.tenantId,
    lead_owner: localLead.leadOwner,
  };
}

async function resolveLeadActionRouting(leadId) {
  const canonicalLeadId = String(leadId || "").trim();

  if (!canonicalLeadId) {
    throw new Error("A stored leadId is required for lead routing.");
  }

  const supabaseLead = await getLeadFromSupabaseByLeadId(canonicalLeadId);
  const owningLead = supabaseLead || toSupabaseShape(getLeadById(canonicalLeadId));

  if (!owningLead) {
    throw new Error(`Cannot route lead action: lead ${canonicalLeadId} was not found.`);
  }

  const routing = resolveStoredLeadRouting(owningLead);

  return {
    ...routing,
    leadId: canonicalLeadId,
    integration: {
      brevo: getBrevoConfigForLeadOwner(routing.leadOwner),
    },
  };
}

module.exports = {
  resolveLeadActionRouting,
};
