const { CONFIG } = require("../config/quoteConfig");

const {
  normalizeTariff,
  computeHourlyBilling,
} = require("./tariffService");

const {
  simulateHourByHour,
} = require("./batterySimulationService");

const {
  makePaybackAndLifetimeSeries,
} = require("./financialService");

const {
  resolveCandidateBatteryControlStrategy,
  summarizeCandidateBatteryControlStrategy,
} = require("./candidateBatteryControlStrategyService");

const DESIGN_CANDIDATE_FINANCIAL_VERSION = "2026-beta-1";

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
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

function getLoadHourly(quote = {}) {
  return getHourlyArray(quote?.hourlyModel?._loadHourlyKWh);
}

function getMonthIdx({ performanceModel = {}, quote = {} } = {}) {
  if (Array.isArray(performanceModel?.generation?.monthIdx)) {
    return performanceModel.generation.monthIdx;
  }

  if (Array.isArray(quote?.hourlyModel?._monthIdx)) {
    return quote.hourlyModel._monthIdx;
  }

  return null;
}

function getHourOfDay({ performanceModel = {}, quote = {} } = {}) {
  if (Array.isArray(performanceModel?.generation?.hourOfDay)) {
    return performanceModel.generation.hourOfDay;
  }

  if (Array.isArray(quote?.hourlyModel?._hourOfDay)) {
    return quote.hourlyModel._hourOfDay;
  }

  return null;
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

function getSystemCost(costModel = {}, quote = {}) {
  const directCost = numberOrZero(
    costModel.estimatedInstalledCost ??
      costModel.estimatedInstalledCostMid ??
      costModel.estimatedCandidateCost ??
      costModel.estimatedHardwareAdder ??
      0
  );

  if (directCost > 0) {
    return directCost;
  }

  const quoteMid =
    (numberOrZero(quote.priceLow) + numberOrZero(quote.priceHigh)) / 2;

  return quoteMid > 0 ? quoteMid : 0;
}

function getUnavailableFinancialModel({
  reason = "Candidate financial model could not be calculated.",
  performanceModel = null,
  dispatchModel = null,
  costModel = null,
  quote = {},
} = {}) {
  return {
    version: DESIGN_CANDIDATE_FINANCIAL_VERSION,
    mode: "candidate_financial_model_unavailable",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    source: "financial_data_unavailable",

    performanceSource: performanceModel?.source || null,
    dispatchMode: dispatchModel?.mode || null,

    systemCost: {
      estimatedInstalledCost: roundMoney(getSystemCost(costModel, quote)),
      estimatedInstalledCostRange:
        costModel?.estimatedInstalledCostRange || null,
      confidence: costModel?.confidence || null,
    },

    annual: {
      baselineBill: 0,
      afterImportAndStanding: 0,
      exportCredit: 0,
      afterNetBill: 0,
      billSavings: 0,
      segIncome: 0,
      totalAnnualBenefit: 0,
    },

    monthly: {
      baselineBill: Array(12).fill(0),
      afterImportAndStanding: Array(12).fill(0),
      exportCredit: Array(12).fill(0),
      afterNetBill: Array(12).fill(0),
    },

    payback: {
      simplePaybackYears: null,
      lifetimeYears: 25,
      lifetimeSavings: null,
      paybackYear: null,
      paybackSeries: null,
    },

    batteryControlStrategy: null,

    confidence: {
      level: "unavailable",
      reason,
    },

    limitations: [
      "Candidate financial modelling requires candidate hourly PV generation and quote hourly load data.",
      "This model is not currently used for customer-facing calculations.",
    ],
  };
}

function buildFinancialConfidence({ performanceModel, dispatchModel, costModel } = {}) {
  const performanceSource = performanceModel?.source;
  const dispatchMode = dispatchModel?.mode;
  const costConfidence = costModel?.confidence?.level || "unknown";

  if (
    performanceSource === "scaled_from_pvgis_roof_array_profiles" &&
    dispatchMode === "candidate_hourly_dispatch_model_beta"
  ) {
    return {
      level: costConfidence === "low" ? "medium" : "medium_high",
      reason:
        "Financial model uses roof-array PVGIS candidate performance, resolved battery control strategy, candidate hourly dispatch and candidate cost model.",
    };
  }

  if (
    performanceSource === "scaled_from_aggregate_quote_pvgis_hourly_profile" &&
    dispatchMode === "candidate_hourly_dispatch_model_beta"
  ) {
    return {
      level: "medium_low",
      reason:
        "Financial model uses aggregate PVGIS hourly fallback rather than roof-array PVGIS profiles.",
    };
  }

  return {
    level: "low",
    reason:
      "Financial model uses incomplete candidate performance, dispatch or cost data.",
  };
}

function buildDesignCandidateFinancialModel({
  quote = null,
  input = null,
  performanceModel = null,
  dispatchModel = null,
  costModel = null,
  battery = null,
  panelOption = "",
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
    return getUnavailableFinancialModel({
      reason:
        "Missing or mismatched candidate PV hourly data, quote load data, month index or hour-of-day arrays.",
      performanceModel,
      dispatchModel,
      costModel,
      quote: safeQuote,
    });
  }

  const tariffBefore =
    safeInput.tariffBefore ||
    safeQuote.tariffBefore ||
    {};

  const tb = normalizeTariff(tariffBefore, "before");

  const batteryKWh = getBatteryKWh({
    battery,
    input: safeInput,
    quote: safeQuote,
  });

  const controlStrategy = resolveCandidateBatteryControlStrategy({
    input: safeInput,
    quote: safeQuote,
    battery,
    batteryKWh,
  });

  const ta = controlStrategy.tariff.normalized;

  const sim = simulateHourByHour({
    pvHourlyKWh,
    loadHourlyKWh,
    monthIdx,
    hourOfDay,

    batteryKWh,

    tariff: ta,
    dispatchMode: controlStrategy.dispatch.dispatchMode,

    allowGridCharge: controlStrategy.dispatch.allowGridCharge,
    allowEnergyTrading: controlStrategy.dispatch.allowEnergyTrading,
    exportFromBatteryEnabled: controlStrategy.dispatch.exportFromBatteryEnabled,
  });

  if (!sim?.hourly?.importKWh || !sim?.hourly?.exportKWh) {
    return getUnavailableFinancialModel({
      reason:
        "Candidate dispatch simulation did not return hourly import/export arrays for billing.",
      performanceModel,
      dispatchModel,
      costModel,
      quote: safeQuote,
    });
  }

  const billing = computeHourlyBilling({
    loadKWh: loadHourlyKWh,
    importKWh: sim.hourly.importKWh,
    exportKWh: sim.hourly.exportKWh,
    hourOfDay,
    monthIdx,
    tariffBefore: tb,
    tariffAfter: ta,
  });

  const annualBaseline = round2(numberOrZero(billing.annualBaseline));
  const annualAfterImportAndStanding = round2(
    numberOrZero(billing.annualAfterImportAndStanding)
  );
  const annualExportCredit = round2(numberOrZero(billing.annualExportCredit));
  const annualAfterNet = round2(numberOrZero(billing.annualAfterNet));

  const annualBillSavings = Math.max(
    0,
    round2(annualBaseline - annualAfterImportAndStanding)
  );

  const annualSegIncome = annualExportCredit;
  const totalAnnualBenefit = round2(annualBillSavings + annualSegIncome);

  const systemCostMid = getSystemCost(costModel, safeQuote);

  const simplePaybackYears =
    totalAnnualBenefit > 0 && systemCostMid > 0
      ? Number((systemCostMid / totalAnnualBenefit).toFixed(1))
      : null;

  const lifetimeYears = 25;

  const paybackSeries = makePaybackAndLifetimeSeries({
    systemCostMid,
    annualBenefit: totalAnnualBenefit,
    years: lifetimeYears,
    panelOption,
    energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
  });

  return {
    version: DESIGN_CANDIDATE_FINANCIAL_VERSION,
    mode: "candidate_hourly_financial_model_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    source: "candidate_hourly_dispatch_billing",

    performanceSource: performanceModel?.source || null,
    dispatchMode: dispatchModel?.mode || null,

    tariff: {
      before: {
        tariffType: tb.tariffType || "standard",
      },
      after: {
        tariffType: ta.tariffType || "standard",
        retailRateMode: !!controlStrategy.tariff.retailRateMode,
      },
    },

    batteryControlStrategy:
      summarizeCandidateBatteryControlStrategy(controlStrategy),

    systemCost: {
      estimatedInstalledCost: roundMoney(systemCostMid),
      estimatedInstalledCostRange:
        costModel?.estimatedInstalledCostRange || null,
      confidence: costModel?.confidence || null,
    },

    annual: {
      baselineBill: annualBaseline,
      afterImportAndStanding: annualAfterImportAndStanding,
      exportCredit: annualExportCredit,
      afterNetBill: annualAfterNet,

      billSavings: annualBillSavings,
      segIncome: annualSegIncome,
      totalAnnualBenefit,

      generationKWh: round2(dispatchModel?.annual?.generationKWh),
      selfUsedKWh: round2(dispatchModel?.annual?.selfUsedKWh),
      exportedKWh: round2(dispatchModel?.annual?.exportedKWh),
      importedKWh: round2(dispatchModel?.annual?.importedKWh),
    },

    monthly: {
      baselineBill: billing.monthlyBaseline || Array(12).fill(0),
      afterImportAndStanding:
        billing.monthlyAfterImportAndStanding || Array(12).fill(0),
      exportCredit: billing.monthlyExportCredit || Array(12).fill(0),
      afterNetBill: billing.monthlyAfterNet || Array(12).fill(0),
    },

    payback: {
      simplePaybackYears,
      lifetimeYears,
      lifetimeSavings:
        paybackSeries?.lifetimeSavings !== undefined
          ? roundMoney(paybackSeries.lifetimeSavings)
          : null,
      paybackYear:
        paybackSeries?.paybackYear !== undefined
          ? paybackSeries.paybackYear
          : simplePaybackYears,
      paybackSeries,
    },

    confidence: buildFinancialConfidence({
      performanceModel,
      dispatchModel,
      costModel,
    }),

    limitations: [
      "This is a candidate-level hourly financial model.",
      "It uses candidate PVGIS-backed hourly performance, resolved battery control strategy and the existing hourly billing model.",
      "It does not yet change customer-facing quote calculations, pricing, savings, payback, PDF output or frontend recommendations.",
      "Candidate cost data is still beta and not live supplier pricing.",
      "Product-specific battery charge/discharge power is not yet enforced inside the dispatch engine.",
      "Only one selected-tariff control strategy is tested at this stage. Multi-tariff scenario optimisation comes later.",
    ],
  };
}

module.exports = {
  DESIGN_CANDIDATE_FINANCIAL_VERSION,
  buildDesignCandidateFinancialModel,
};