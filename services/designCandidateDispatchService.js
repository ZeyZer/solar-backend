const {
  normalizeTariff,
  isRetailRateTariff,
} = require("./tariffService");

const {
  simulateHourByHour,
} = require("./batterySimulationService");

const DESIGN_CANDIDATE_DISPATCH_VERSION = "2026-beta-1";

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function sum(values = []) {
  return values.reduce((total, value) => total + numberOrZero(value), 0);
}

function roundMonthly(values = []) {
  return Array.isArray(values) ? values.map(round2) : Array(12).fill(0);
}

function getHourlyArray(value) {
  return Array.isArray(value)
    ? value.map((v) => Math.max(0, numberOrZero(v)))
    : null;
}

function getCandidatePvHourly(performanceModel = {}) {
  return getHourlyArray(
    performanceModel?.generation?.hourlyAfterClippingKWh ||
      performanceModel?.generation?.hourlyGrossGenerationKWh
  );
}

function getMonthIdx({ performanceModel = {}, quote = {} } = {}) {
  const perfMonthIdx = performanceModel?.generation?.monthIdx;
  if (Array.isArray(perfMonthIdx)) return perfMonthIdx;

  const quoteMonthIdx = quote?.hourlyModel?._monthIdx;
  if (Array.isArray(quoteMonthIdx)) return quoteMonthIdx;

  return null;
}

function getHourOfDay({ performanceModel = {}, quote = {} } = {}) {
  const perfHourOfDay = performanceModel?.generation?.hourOfDay;
  if (Array.isArray(perfHourOfDay)) return perfHourOfDay;

  const quoteHourOfDay = quote?.hourlyModel?._hourOfDay;
  if (Array.isArray(quoteHourOfDay)) return quoteHourOfDay;

  return null;
}

function getLoadHourly(quote = {}) {
  return getHourlyArray(quote?.hourlyModel?._loadHourlyKWh);
}

function getBatteryKWh({ battery = null, input = {}, quote = {} } = {}) {
  if (battery && numberOrZero(battery.usableCapacityKWh) > 0) {
    return numberOrZero(battery.usableCapacityKWh);
  }

  return numberOrZero(
    input.batteryKWh ??
      input.batteryCapacity ??
      quote?.hourlyModel?._batteryKWh ??
      0
  );
}

function getUnavailableDispatchModel({
  reason = "Candidate hourly dispatch could not be modelled.",
  performanceModel = null,
  battery = null,
} = {}) {
  return {
    version: DESIGN_CANDIDATE_DISPATCH_VERSION,
    mode: "candidate_dispatch_model_unavailable",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    source: "dispatch_data_unavailable",

    generationSource: performanceModel?.source || null,

    annual: {
      generationKWh: 0,
      selfUsedKWh: 0,
      exportedKWh: 0,
      importedKWh: 0,
      batteryChargeKWh: 0,
      batteryDischargeKWh: 0,
      batteryChargeFromPVKWh: 0,
      batteryChargeFromGridKWh: 0,
      batteryDischargeToLoadKWh: 0,
      batteryDischargeToExportKWh: 0,
      pvExportDirectKWh: 0,
    },

    monthly: {
      generation: Array(12).fill(0),
      selfUsed: Array(12).fill(0),
      exported: Array(12).fill(0),
      imported: Array(12).fill(0),
      batteryCharge: Array(12).fill(0),
      batteryDischarge: Array(12).fill(0),
      batteryChargeFromPV: Array(12).fill(0),
      batteryChargeFromGrid: Array(12).fill(0),
      pvExportDirect: Array(12).fill(0),
    },

    battery: {
      hasBattery: !!battery,
      batteryProductId: battery?.id || null,
      usableCapacityKWh: round2(battery?.usableCapacityKWh || 0),
      maxChargeKW: round2(battery?.maxChargeKW || 0),
      maxDischargeKW: round2(battery?.maxDischargeKW || 0),
    },

    hourlySeries: {
      available: false,
      included: false,
      length: 0,
    },

    confidence: {
      level: "unavailable",
      reason,
    },

    limitations: [
      "Candidate dispatch requires candidate hourly PV generation and quote hourly load data.",
      "This model is not currently used for customer-facing calculations.",
    ],
  };
}

function buildDesignCandidateDispatchModel({
  quote = null,
  input = null,
  performanceModel = null,
  battery = null,
} = {}) {
  const safeQuote = quote || {};
  const safeInput = input || {};

  const pvHourlyKWh = getCandidatePvHourly(performanceModel);
  const loadHourlyKWh = getLoadHourly(safeQuote);
  const monthIdx = getMonthIdx({ performanceModel, quote: safeQuote });
  const hourOfDay = getHourOfDay({ performanceModel, quote: safeQuote });

  if (
    !Array.isArray(pvHourlyKWh) ||
    !Array.isArray(loadHourlyKWh) ||
    !Array.isArray(monthIdx) ||
    !Array.isArray(hourOfDay) ||
    pvHourlyKWh.length === 0 ||
    loadHourlyKWh.length !== pvHourlyKWh.length ||
    monthIdx.length !== pvHourlyKWh.length ||
    hourOfDay.length !== pvHourlyKWh.length
  ) {
    return getUnavailableDispatchModel({
      reason:
        "Missing or mismatched candidate PV hourly data, quote load data, month index or hour-of-day arrays.",
      performanceModel,
      battery,
    });
  }

  const tariffAfter =
    safeInput.tariffAfter ||
    safeInput.tariff ||
    safeQuote.tariffAfter ||
    safeQuote.tariff ||
    {};

  const ta = normalizeTariff(tariffAfter, "after");
  const retail = isRetailRateTariff(ta);

  const batteryKWh = getBatteryKWh({
    battery,
    input: safeInput,
    quote: safeQuote,
  });

  const sim = simulateHourByHour({
    pvHourlyKWh,
    loadHourlyKWh,
    monthIdx,
    hourOfDay,

    batteryKWh,

    tariff: ta,
    dispatchMode: retail ? "retail_rate" : "self_consumption",

    allowGridCharge: retail && !!ta.allowGridCharging,
    allowEnergyTrading: retail && !!ta.allowEnergyTrading,
    exportFromBatteryEnabled: retail && !!ta.exportFromBatteryEnabled,
  });

  if (!sim || !sim.monthly || !sim.hourly) {
    return getUnavailableDispatchModel({
      reason: "simulateHourByHour did not return expected monthly/hourly results.",
      performanceModel,
      battery,
    });
  }

  const annual = {
    generationKWh: round2(sum(sim.monthly.generation)),
    selfUsedKWh: round2(sum(sim.monthly.selfUsed)),
    exportedKWh: round2(sum(sim.monthly.exported)),
    importedKWh: round2(sum(sim.monthly.imported)),
    batteryChargeKWh: round2(sum(sim.monthly.batteryCharge)),
    batteryDischargeKWh: round2(sum(sim.monthly.batteryDischarge)),
    batteryChargeFromPVKWh: round2(sum(sim.monthly.batteryChargeFromPV)),
    batteryChargeFromGridKWh: round2(sum(sim.monthly.batteryChargeFromGrid)),
    batteryDischargeToLoadKWh: round2(
      sum(sim.monthly.batteryDischargeFromPVToLoad) +
        sum(sim.monthly.batteryDischargeFromGridToLoad)
    ),
    batteryDischargeToExportKWh: round2(
      sum(sim.hourly.battDischargeToExportKWh || [])
    ),
    pvExportDirectKWh: round2(sum(sim.monthly.pvExportDirect)),
  };

  return {
    version: DESIGN_CANDIDATE_DISPATCH_VERSION,
    mode: "candidate_hourly_dispatch_model_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    source: "candidate_pvgis_hourly_dispatch",

    generationSource: performanceModel?.source || null,

    tariff: {
      tariffType: ta.tariffType || "standard",
      retailRateMode: retail,
      allowGridCharging: !!ta.allowGridCharging,
      allowEnergyTrading: !!ta.allowEnergyTrading,
      exportFromBatteryEnabled: !!ta.exportFromBatteryEnabled,
    },

    annual,

    monthly: {
      generation: roundMonthly(sim.monthly.generation),
      selfUsed: roundMonthly(sim.monthly.selfUsed),
      exported: roundMonthly(sim.monthly.exported),
      imported: roundMonthly(sim.monthly.imported),
      batteryCharge: roundMonthly(sim.monthly.batteryCharge),
      batteryDischarge: roundMonthly(sim.monthly.batteryDischarge),
      batteryChargeFromPV: roundMonthly(sim.monthly.batteryChargeFromPV),
      batteryChargeFromGrid: roundMonthly(sim.monthly.batteryChargeFromGrid),
      batteryDischargeFromPVToLoad: roundMonthly(
        sim.monthly.batteryDischargeFromPVToLoad
      ),
      batteryDischargeFromGridToLoad: roundMonthly(
        sim.monthly.batteryDischargeFromGridToLoad
      ),
      pvExportDirect: roundMonthly(sim.monthly.pvExportDirect),
    },

    battery: {
      hasBattery: batteryKWh > 0,
      batteryProductId: battery?.id || null,
      usableCapacityKWh: round2(batteryKWh),
      catalogueUsableCapacityKWh: round2(battery?.usableCapacityKWh || 0),
      maxChargeKW: round2(battery?.maxChargeKW || 0),
      maxDischargeKW: round2(battery?.maxDischargeKW || 0),
      roundTripEfficiency: round2(battery?.roundTripEfficiency || 0),
    },

    hourlySeries: {
      available: true,
      included: false,
      length: pvHourlyKWh.length,
    },

    confidence: {
      level:
        performanceModel?.source === "scaled_from_pvgis_roof_array_profiles"
          ? "medium_high"
          : performanceModel?.source ===
              "scaled_from_aggregate_quote_pvgis_hourly_profile"
            ? "medium_low"
            : "low",
      reason:
        "Dispatch uses candidate hourly PV generation and the quote hourly load profile.",
    },

    limitations: [
      "This is a candidate-level hourly dispatch model.",
      "It uses the existing battery dispatch engine.",
      "It does not yet enforce product-specific max charge/discharge power inside the dispatch engine.",
      "It does not yet model manufacturer-specific battery control behaviour.",
      "It is not currently used for customer-facing quote calculations.",
    ],
  };
}

module.exports = {
  DESIGN_CANDIDATE_DISPATCH_VERSION,
  buildDesignCandidateDispatchModel,
};