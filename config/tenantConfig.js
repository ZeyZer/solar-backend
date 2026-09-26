const DEFAULT_TENANT_ID = "zion-energy";

const TENANTS = Object.freeze({
  [DEFAULT_TENANT_ID]: Object.freeze({
    id: DEFAULT_TENANT_ID,
    name: "Zion Energy",
  }),
});

function normaliseTenantId(value) {
  if (value == null) {
    return "";
  }

  return String(value)
    .trim()
    .toLowerCase();
}

function getTenantById(value) {
  const tenantId = normaliseTenantId(value);

  if (!tenantId) {
    return null;
  }

  return TENANTS[tenantId] || null;
}

function resolveTenantFromInput(input = {}) {
  const hasExplicitTenantId = Object.prototype.hasOwnProperty.call(
    input,
    "tenantId"
  );

  // Temporary backwards compatibility for frontend versions that pre-date
  // explicit tenant ownership. Remove this legacy fallback once all live
  // clients send tenantId.
  if (!hasExplicitTenantId) {
    return {
      ok: true,
      tenantId: DEFAULT_TENANT_ID,
      tenant: TENANTS[DEFAULT_TENANT_ID],
      source: "legacy_default",
    };
  }

  const tenantId = normaliseTenantId(input.tenantId);
  const tenant = getTenantById(tenantId);

  if (!tenantId) {
    return {
      ok: false,
      tenantId: null,
      tenant: null,
      source: "request",
      error: "tenantId is required.",
    };
  }

  if (!tenant) {
    return {
      ok: false,
      tenantId,
      tenant: null,
      source: "request",
      error: `Unknown tenantId: ${tenantId}`,
    };
  }

  return {
    ok: true,
    tenantId: tenant.id,
    tenant,
    source: "request",
  };
}

module.exports = {
  TENANTS,
  DEFAULT_TENANT_ID,
  normaliseTenantId,
  getTenantById,
  resolveTenantFromInput,
};
