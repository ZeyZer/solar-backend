const { createClient } = require("@supabase/supabase-js");

let supabaseClient = null;

function isSupabaseEnabled() {
  return String(process.env.SUPABASE_ENABLED || "").toLowerCase() === "true";
}

function getSupabaseClient() {
  if (!isSupabaseEnabled()) return null;

  if (supabaseClient) return supabaseClient;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseClient;
}

function numberOrNull(value) {
  if (value === "" || value == null) return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(value) {
  if (value == null) return null;
  return !!value;
}

function getPaybackYears(quote) {
  const value =
    quote?.financialSeries?.payback?.paybackYear ??
    quote?.paybackYears ??
    quote?.payback ??
    null;

  return numberOrNull(value);
}

function getRecommendedBatteryKWh(quote) {
  const value =
    quote?.batteryRecommendations?.bestPayback?.batteryKWhUsable ??
    quote?.batteryRecommendation?.batteryKWhUsable ??
    quote?.batteryRecommendation ??
    null;

  return numberOrNull(value);
}

function buildQuoteSummary(quote) {
  return {
    systemSizeKwp: quote?.systemSizeKwp ?? null,
    panelCount: quote?.panelCount ?? null,
    priceLow: quote?.priceLow ?? null,
    priceHigh: quote?.priceHigh ?? null,
    annualGenerationKWh: quote?.estAnnualGenerationKWh ?? null,
    annualBillSavings: quote?.annualBillSavings ?? null,
    annualSegIncome: quote?.annualSegIncome ?? null,
    totalAnnualBenefit: quote?.totalAnnualBenefit ?? null,
    paybackYears: getPaybackYears(quote),
    recommendedBatteryKWh: getRecommendedBatteryKWh(quote),
    selfConsumptionModel: quote?.selfConsumptionModel ?? null,
  };
}

function buildSupabaseLeadRow(lead) {
  const form = lead?.form || {};
  const quote = lead?.quote || {};
  const roofs = Array.isArray(lead?.roofs) ? lead.roofs : [];
  const quoteSummary = buildQuoteSummary(quote);

  return {
    lead_id: lead.leadId,

    status: lead.status || "new",
    source: lead.source || "beta-calculator",

    name: form.name || null,
    email: form.email || null,
    phone: form.phone || null,

    address: form.address || null,
    house_number: form.houseNumber || null,
    postcode: form.postcode || null,
    home_ownership: form.homeOwnership || null,

    annual_kwh: numberOrNull(form.annualKWh),
    monthly_bill: numberOrNull(form.monthlyBill),
    occupancy_profile: form.occupancyProfile || null,

    panel_option: form.panelOption || null,
    battery_kwh: numberOrNull(form.batteryKWh),
    bird_protection: boolOrNull(form.birdProtection),
    ev_charger: boolOrNull(form.evCharger),

    panel_count: numberOrNull(quote.panelCount),
    system_size_kwp: numberOrNull(quote.systemSizeKwp),
    price_low: numberOrNull(quote.priceLow),
    price_high: numberOrNull(quote.priceHigh),
    annual_generation_kwh: numberOrNull(quote.estAnnualGenerationKWh),
    annual_bill_savings: numberOrNull(quote.annualBillSavings),
    annual_seg_income: numberOrNull(quote.annualSegIncome),
    total_annual_benefit: numberOrNull(quote.totalAnnualBenefit),
    payback_years: getPaybackYears(quote),
    recommended_battery_kwh: getRecommendedBatteryKWh(quote),
    self_consumption_model: quote.selfConsumptionModel || null,

    tariff_before: form.tariffBefore || null,
    tariff_after: form.tariffAfter || null,
    roofs,
    quote_summary: quoteSummary,
    form,
    quote,
    full_payload: lead,
  };
}

async function saveLeadToSupabase(lead) {
  if (!isSupabaseEnabled()) {
    return {
      skipped: true,
      reason: "SUPABASE_ENABLED is not true.",
    };
  }

  const supabase = getSupabaseClient();
  const row = buildSupabaseLeadRow(lead);

  if (!row.lead_id) {
    throw new Error("Cannot save lead to Supabase without leadId.");
  }

  const { data, error } = await supabase
    .from("leads")
    .upsert(row, {
      onConflict: "lead_id",
    })
    .select("lead_id")
    .single();

  if (error) {
    throw new Error(`Supabase lead save failed: ${error.message}`);
  }

  return {
    skipped: false,
    leadId: data?.lead_id || row.lead_id,
  };
}

async function getLeadFromSupabaseByLeadId(leadId) {
  if (!isSupabaseEnabled()) {
    return null;
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("lead_id", leadId)
    .single();

  if (error) {
    return null;
  }

  return data;
}

module.exports = {
  saveLeadToSupabase,
  getLeadFromSupabaseByLeadId,
  buildSupabaseLeadRow,
};