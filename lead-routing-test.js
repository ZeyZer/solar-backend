const assert = require("assert");

const {
  resolveTenantFromInput,
  getCanonicalLeadRoutingForTenant,
} = require("./config/tenantConfig");

const {
  buildSupabaseLeadRow,
  resolveStoredLeadRouting,
  sanitiseLeadEventData,
} = require("./services/leads/supabaseLeadService");

function buildLead(overrides = {}) {
  return {
    leadId: "lead_test",
    tenantId: "zion-energy",
    source: "zion-website",
    leadOwner: "zion-energy",
    form: {
      name: "Test Customer",
      email: "test@example.com",
      phone: "07123456789",
      address: "10 Test Street, London",
      houseNumber: "10",
      postcode: "SW1A 1AA",
      annualKWh: 3500,
    },
    quote: {
      panelCount: 10,
      systemSizeKwp: 4.65,
    },
    roofs: [],
    ...overrides,
  };
}

function main() {
  const tenantResolution = resolveTenantFromInput({
    tenantId: "zion-energy",
    source: "untrusted-source",
    leadOwner: "untrusted-owner",
  });
  const routing = getCanonicalLeadRoutingForTenant(tenantResolution.tenant);

  assert.deepStrictEqual(routing, {
    tenantId: "zion-energy",
    source: "zion-website",
    leadOwner: "zion-energy",
  });

  const externalRow = buildSupabaseLeadRow(buildLead());

  assert.strictEqual(externalRow.tenant_id, "zion-energy");
  assert.strictEqual(externalRow.source, "zion-website");
  assert.strictEqual(externalRow.lead_owner, "zion-energy");
  assert.strictEqual(externalRow.name, null);
  assert.strictEqual(externalRow.email, null);
  assert.strictEqual(externalRow.phone, null);
  assert.strictEqual(externalRow.address, null);
  assert.strictEqual(externalRow.house_number, null);
  assert.strictEqual(externalRow.postcode, "SW1A 1AA");
  assert.strictEqual(externalRow.form.email, undefined);
  assert.strictEqual(externalRow.full_payload.form.address, undefined);
  assert.strictEqual(externalRow.form.annualKWh, 3500);
  assert.strictEqual(externalRow.quote.panelCount, 10);

  const externalEvent = sanitiseLeadEventData({
    leadOwner: "zion-energy",
    email: "test@example.com",
    phone: "07123456789",
    metadata: {
      route: "/api/lead/request-call",
      marketingConsent: true,
      templateId: 123,
      address: "10 Test Street, London",
      name: "Test Customer",
    },
  });

  assert.strictEqual(externalEvent.email, null);
  assert.strictEqual(externalEvent.phone, null);
  assert.strictEqual(externalEvent.metadata.address, undefined);
  assert.strictEqual(externalEvent.metadata.name, undefined);
  assert.strictEqual(externalEvent.metadata.marketingConsent, undefined);
  assert.strictEqual(externalEvent.metadata.route, "/api/lead/request-call");

  const ownedRow = buildSupabaseLeadRow(
    buildLead({
      tenantId: "zeyzer",
      source: "zeyzer-leadgen",
      leadOwner: "zeyzer",
    })
  );

  assert.strictEqual(ownedRow.email, "test@example.com");
  assert.strictEqual(ownedRow.form.address, "10 Test Street, London");

  const historicalRouting = resolveStoredLeadRouting({
    tenant_id: "zion-energy",
  });

  assert.deepStrictEqual(historicalRouting, routing);

  console.log("Lead routing and privacy tests passed.");
}

main();
