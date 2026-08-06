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

function buildLeadActionUpdate(eventType) {
  const now = new Date().toISOString();

  const update = {
    last_action_type: eventType,
    last_action_at: now,
    updated_at: now,
  };

  if (eventType === "call_requested") {
    update.call_requested_at = now;
  }

  if (eventType === "pdf_email_requested") {
    update.pdf_email_requested_at = now;
  }

  if (eventType === "pdf_downloaded") {
    update.pdf_downloaded_at = now;
  }

  return update;
}

async function recordLeadEvent({
  leadId,
  eventType,
  email = "",
  phone = "",
  metadata = {},
}) {
  if (!isSupabaseEnabled()) {
    return {
      skipped: true,
      reason: "SUPABASE_ENABLED is not true.",
    };
  }

  if (!leadId) {
    return {
      skipped: true,
      reason: "Missing leadId.",
    };
  }

  if (!eventType) {
    throw new Error("Cannot record lead event without eventType.");
  }

  const supabase = getSupabaseClient();

  const eventRow = {
    lead_id: leadId,
    event_type: eventType,
    email: email || null,
    phone: phone || null,
    metadata: metadata || {},
  };

  const { error: insertError } = await supabase
    .from("lead_events")
    .insert(eventRow);

  if (insertError) {
    throw new Error(`Supabase lead event insert failed: ${insertError.message}`);
  }

  const leadUpdate = buildLeadActionUpdate(eventType);

  const { error: updateError } = await supabase
    .from("leads")
    .update(leadUpdate)
    .eq("lead_id", leadId);

  if (updateError) {
    throw new Error(`Supabase lead action update failed: ${updateError.message}`);
  }

  return {
    skipped: false,
    leadId,
    eventType,
  };
}

module.exports = {
  saveLeadToSupabase,
  getLeadFromSupabaseByLeadId,
  buildSupabaseLeadRow,
  recordLeadEvent,
};