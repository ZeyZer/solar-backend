const {
  resolveCandidateBatteryControlStrategy,
  summarizeCandidateBatteryControlStrategy,
} = require("./candidateBatteryControlStrategyService");

const {
  buildDesignCandidateDispatchModel,
} = require("./designCandidateDispatchService");

const {
  buildDesignCandidateFinancialModel,
} = require("./designCandidateFinancialService");

const DESIGN_CANDIDATE_SCENARIO_RUNNER_VERSION = "2026-beta-1";

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function normaliseId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getTariffTypeFromStrategy(strategy = {}) {
  return strategy?.tariff?.tariffType || "standard";
}

function buildScenarioRunId({
  candidateId = null,
  batteryControlStrategy = null,
} = {}) {
  const tariffType = getTariffTypeFromStrategy(batteryControlStrategy);
  const strategyId = batteryControlStrategy?.strategyId || "no-control-strategy";

  return [
    normaliseId(candidateId || "candidate"),
    normaliseId(tariffType),
    normaliseId(strategyId),
  ]
    .filter(Boolean)
    .join("__");
}

function getAnnualFinancialSummary(financialModel = {}) {
  const annual = financialModel?.annual || {};
  const payback = financialModel?.payback || {};

  return {
    estimatedInstalledCost:
      financialModel?.systemCost?.estimatedInstalledCost ?? null,
    annualBaselineBill: annual?.baselineBill ?? null,
    annualAfterNetBill: annual?.afterNetBill ?? null,
    annualBillSavings: annual?.billSavings ?? null,
    annualSegIncome: annual?.segIncome ?? null,
    totalAnnualBenefit: annual?.totalAnnualBenefit ?? null,
    simplePaybackYears:
      payback?.simplePaybackYears ?? payback?.paybackYear ?? null,
    lifetimeSavings: payback?.lifetimeSavings ?? null,
  };
}

function getAnnualDispatchSummary(dispatchModel = {}) {
  const annual = dispatchModel?.annual || {};

  return {
    generationKWh: annual?.generationKWh ?? null,
    selfUsedKWh: annual?.selfUsedKWh ?? null,
    exportedKWh: annual?.exportedKWh ?? null,
    importedKWh: annual?.importedKWh ?? null,
    batteryChargeKWh: annual?.batteryChargeKWh ?? null,
    batteryDischargeKWh: annual?.batteryDischargeKWh ?? null,
  };
}

function buildSelectedTariffScenarioRun({
  candidateId = null,
  quote = null,
  input = null,
  performanceModel = null,
  costModel = null,
  battery = null,
  panelOption = "value",
} = {}) {
  const safeQuote = quote || {};
  const safeInput = input || {};

  const batteryControlStrategy = resolveCandidateBatteryControlStrategy({
    input: safeInput,
    quote: safeQuote,
    battery,
  });

  const dispatchModel = buildDesignCandidateDispatchModel({
    quote: safeQuote,
    input: safeInput,
    performanceModel,
    battery,
  });

  const financialModel = buildDesignCandidateFinancialModel({
    quote: safeQuote,
    input: safeInput,
    performanceModel,
    dispatchModel,
    costModel,
    battery,
    panelOption,
  });

  const scenarioRunId = buildScenarioRunId({
    candidateId,
    batteryControlStrategy,
  });

  const activeModels = {
    performance:
      performanceModel?.mode === "candidate_pvgis_performance_model_beta",
    dispatch:
      dispatchModel?.mode === "candidate_hourly_dispatch_model_beta",
    financial:
      financialModel?.mode === "candidate_hourly_financial_model_beta",
  };

  return {
    version: DESIGN_CANDIDATE_SCENARIO_RUNNER_VERSION,
    mode: "candidate_scenario_run_selected_tariff_beta",

    scenarioRunId,
    candidateId,

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    scenarioBasis: {
      scenarioType: "selected_tariff_resolved_control_strategy",
      selectedTariffOnly: true,
      multiTariffScenarioOptimisation: false,
      selectedTariffSource: "quote_or_input_tariff_after",
      oneControlStrategyOnly: true,
    },

    batteryControlStrategy:
      summarizeCandidateBatteryControlStrategy(batteryControlStrategy),

    modelModes: {
      performance: performanceModel?.mode || null,
      dispatch: dispatchModel?.mode || null,
      financial: financialModel?.mode || null,
    },

    modelSources: {
      performance: performanceModel?.source || null,
      dispatch: dispatchModel?.source || null,
      financial: financialModel?.source || null,
    },

    activeModels,

    dispatchModel,
    financialModel,

    annual: {
      ...getAnnualDispatchSummary(dispatchModel),
      ...getAnnualFinancialSummary(financialModel),
    },

    confidence: {
      dispatch: dispatchModel?.confidence?.level || null,
      financial: financialModel?.confidence?.level || null,
    },

    readiness:
      activeModels.financial
        ? "selected_tariff_scenario_run_ready"
        : activeModels.dispatch
          ? "selected_tariff_scenario_dispatch_only"
          : "selected_tariff_scenario_unavailable",

    limitations: [
      "This scenario runner currently runs one selected-tariff scenario per candidate.",
      "It uses the resolved battery control strategy for the selected tariff.",
      "It does not yet generate alternative tariff or control-strategy scenarios.",
      "It is diagnostic only and does not change customer-facing quote calculations.",
    ],
  };
}

function summarizeScenarioRun(scenarioRun = {}) {
  return {
    version:
      scenarioRun.version || DESIGN_CANDIDATE_SCENARIO_RUNNER_VERSION,
    mode: scenarioRun.mode || null,

    scenarioRunId: scenarioRun.scenarioRunId || null,
    candidateId: scenarioRun.candidateId || null,

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    scenarioBasis: scenarioRun.scenarioBasis || null,
    batteryControlStrategy: scenarioRun.batteryControlStrategy || null,

    modelModes: scenarioRun.modelModes || null,
    modelSources: scenarioRun.modelSources || null,
    activeModels: scenarioRun.activeModels || null,

    annual: scenarioRun.annual || null,
    confidence: scenarioRun.confidence || null,
    readiness: scenarioRun.readiness || null,
  };
}

module.exports = {
  DESIGN_CANDIDATE_SCENARIO_RUNNER_VERSION,
  buildSelectedTariffScenarioRun,
  summarizeScenarioRun,
};