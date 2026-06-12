const DESIGN_CANDIDATE_SCENARIO_VERSION = "2026-beta-1";

const {
  summarizeScenarioRun,
} = require("./designCandidateScenarioRunnerService");

const {
  buildScenarioDefinitionSetFromDefinitions,
} = require("./tariffControlScenarioDefinitionService");

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

function getCandidateStatus(candidate = {}) {
  return candidate?.filtering?.status || "unknown";
}

function isEligible(candidate = {}) {
  return candidate?.filtering?.eligibleForFutureOptimiser === true;
}

function hasActiveFinancial(candidate = {}) {
  return candidate?.financialModel?.mode === "candidate_hourly_financial_model_beta";
}

function hasActiveDispatch(candidate = {}) {
  return candidate?.dispatchModel?.mode === "candidate_hourly_dispatch_model_beta";
}

function getBatteryControlStrategy(candidate = {}) {
  return (
    candidate?.financialModel?.batteryControlStrategy ||
    candidate?.dispatchModel?.batteryControlStrategy ||
    null
  );
}

function getTariffType(candidate = {}) {
  return (
    candidate?.financialModel?.tariff?.after?.tariffType ||
    candidate?.dispatchModel?.tariff?.tariffType ||
    "standard"
  );
}

function buildScenarioId(candidate = {}, index = 0) {
  const candidateId = candidate?.candidateId || `candidate-${index + 1}`;
  const tariffType = getTariffType(candidate);
  const strategyId =
    getBatteryControlStrategy(candidate)?.strategyId || "no-control-strategy";

  return [
    normaliseId(candidateId),
    normaliseId(tariffType),
    normaliseId(strategyId),
  ]
    .filter(Boolean)
    .join("__");
}

function summarizeProducts(candidate = {}) {
  return {
    panel: candidate?.products?.panel || null,
    inverter: candidate?.products?.inverter || null,
    battery: candidate?.products?.battery || null,
  };
}

function summarizeSystem(candidate = {}) {
  return {
    totalPanels: candidate?.panelLayout?.totalPanels ?? null,
    systemSizeKwp: candidate?.panelLayout?.systemSizeKwp ?? null,
    arrayCount: Array.isArray(candidate?.panelLayout?.arrays)
      ? candidate.panelLayout.arrays.length
      : 0,
    stringCount: Array.isArray(candidate?.stringPlan?.strings)
      ? candidate.stringPlan.strings.length
      : 0,
    mpptCount: candidate?.stringPlan?.mpptCount ?? null,
  };
}

function summarizePerformance(candidate = {}) {
  const performance = candidate?.performanceModel || {};
  const generation = performance?.generation || {};

  return {
    mode: performance?.mode || null,
    source: performance?.source || null,
    annualGrossGenerationKWh:
      generation?.annualGrossGenerationKWh ?? null,
    annualAfterClippingKWh:
      generation?.annualAfterClippingKWh ?? null,
    annualClippedKWh:
      generation?.annualClippedKWh ?? null,
    confidence:
      performance?.confidence?.level || null,
    usesRoofArrayProfiles:
      performance?.pvgis?.usesRoofArrayProfiles === true,
    usesAggregateProfile:
      performance?.pvgis?.usesAggregateProfile === true,
  };
}

function summarizeDispatch(candidate = {}) {
  const dispatch = candidate?.dispatchModel || {};
  const annual = dispatch?.annual || {};

  return {
    mode: dispatch?.mode || null,
    source: dispatch?.source || null,
    generationSource: dispatch?.generationSource || null,

    annualGenerationKWh: annual?.generationKWh ?? null,
    annualSelfUsedKWh: annual?.selfUsedKWh ?? null,
    annualExportedKWh: annual?.exportedKWh ?? null,
    annualImportedKWh: annual?.importedKWh ?? null,
    annualBatteryChargeKWh: annual?.batteryChargeKWh ?? null,
    annualBatteryDischargeKWh: annual?.batteryDischargeKWh ?? null,

    confidence:
      dispatch?.confidence?.level || null,
  };
}

function summarizeFinancial(candidate = {}) {
  const financial = candidate?.financialModel || {};
  const annual = financial?.annual || {};
  const payback = financial?.payback || {};

  return {
    mode: financial?.mode || null,
    source: financial?.source || null,

    estimatedInstalledCost:
      financial?.systemCost?.estimatedInstalledCost ?? null,

    annualBaselineBill: annual?.baselineBill ?? null,
    annualAfterNetBill: annual?.afterNetBill ?? null,
    annualBillSavings: annual?.billSavings ?? null,
    annualSegIncome: annual?.segIncome ?? null,
    totalAnnualBenefit: annual?.totalAnnualBenefit ?? null,

    simplePaybackYears:
      payback?.simplePaybackYears ?? payback?.paybackYear ?? null,
    lifetimeSavings:
      payback?.lifetimeSavings ?? null,

    confidence:
      financial?.confidence?.level || null,
  };
}

function summarizeTariffAndControl(candidate = {}) {
  const financial = candidate?.financialModel || {};
  const dispatch = candidate?.dispatchModel || {};
  const strategy = getBatteryControlStrategy(candidate);

  return {
    scenarioType: "selected_tariff_resolved_control_strategy",

    tariff: {
      source: "selected_tariff",
      beforeTariffType:
        financial?.tariff?.before?.tariffType || null,
      afterTariffType:
        financial?.tariff?.after?.tariffType ||
        dispatch?.tariff?.tariffType ||
        null,
      retailRateMode:
        financial?.tariff?.after?.retailRateMode ??
        dispatch?.tariff?.retailRateMode ??
        false,
    },

    batteryControlStrategy: strategy
      ? {
          strategyId: strategy.strategyId || null,
          label: strategy.label || null,
          source: strategy.source || null,
          reason: strategy.reason || null,
          dispatch: strategy.dispatch || null,
          futureScenarioReady: strategy.futureScenarioReady === true,
        }
      : null,
  };
}

function buildCandidateScenario(candidate = {}, index = 0) {
  const scenarioId = buildScenarioId(candidate, index);
  const selectedTariffScenarioRun =
    candidate?.selectedTariffScenarioRun || null;

  return {
    scenarioId,
    candidateId: candidate?.candidateId || null,

    selectedTariffScenarioRun:
      selectedTariffScenarioRun
        ? summarizeScenarioRun(selectedTariffScenarioRun)
        : null,

    scenarioDefinitionId:
      selectedTariffScenarioRun?.scenarioDefinitionId || null,

    scenarioDefinition:
      selectedTariffScenarioRun?.scenarioDefinition || null,

    version: DESIGN_CANDIDATE_SCENARIO_VERSION,
    mode: "candidate_selected_tariff_scenario_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    candidateStatus: getCandidateStatus(candidate),
    eligibleForFutureOptimiser: isEligible(candidate),

    products: summarizeProducts(candidate),
    system: summarizeSystem(candidate),

    tariffAndControl: summarizeTariffAndControl(candidate),

    performance: summarizePerformance(candidate),
    dispatch: summarizeDispatch(candidate),
    financial: summarizeFinancial(candidate),

    activeModels: {
      performance:
        candidate?.performanceModel?.mode ===
        "candidate_pvgis_performance_model_beta",
      dispatch: hasActiveDispatch(candidate),
      financial: hasActiveFinancial(candidate),
      selectedTariffScenarioRun:
        selectedTariffScenarioRun?.mode ===
        "candidate_scenario_run_selected_tariff_beta",
    },

    limitations: [
      "This scenario represents one candidate using the currently selected tariff and resolved battery control strategy.",
      "It does not yet represent alternative tariffs or alternative control strategies.",
      "It is diagnostic only and does not change customer-facing quote calculations.",
    ],
  };
}

function buildScenarioSummary(scenarios = []) {
  const summary = {
    totalScenarios: scenarios.length,
    eligibleScenarios: 0,
    activePerformanceScenarios: 0,
    activeDispatchScenarios: 0,
    activeFinancialScenarios: 0,
    selectedTariffScenarioRuns: 0,
    roofArrayPvgisScenarios: 0,
    aggregatePvgisFallbackScenarios: 0,
    unavailableFinancialScenarios: 0,
    scenarioDefinitions: 0,
  };

  for (const scenario of scenarios) {
    if (scenario.eligibleForFutureOptimiser) {
      summary.eligibleScenarios += 1;
    }

    if (scenario.activeModels?.performance) {
      summary.activePerformanceScenarios += 1;
    }

    if (scenario.activeModels?.dispatch) {
      summary.activeDispatchScenarios += 1;
    }

    if (scenario.activeModels?.financial) {
      summary.activeFinancialScenarios += 1;
    }

    if (scenario.performance?.usesRoofArrayProfiles) {
      summary.roofArrayPvgisScenarios += 1;
    }

    if (scenario.performance?.usesAggregateProfile) {
      summary.aggregatePvgisFallbackScenarios += 1;
    }

    if (scenario.financial?.mode === "candidate_financial_model_unavailable") {
      summary.unavailableFinancialScenarios += 1;
    }

    if (scenario.activeModels?.selectedTariffScenarioRun) {
      summary.selectedTariffScenarioRuns += 1;
    }
  }

  const definitionIds = new Set();

  for (const scenario of scenarios) {
    if (scenario?.scenarioDefinitionId) {
      definitionIds.add(scenario.scenarioDefinitionId);
    }
  }

  summary.scenarioDefinitions = definitionIds.size;

  return summary;
}

function buildScenarioDefinitionSetFromScenarios(scenarios = []) {
  const definitions = scenarios
    .map((scenario) => scenario?.scenarioDefinition)
    .filter(Boolean);

  return buildScenarioDefinitionSetFromDefinitions(definitions);
}

function buildCandidateScenarioSet({
  candidates = [],
  selectedSystemType = "balanced",
} = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  const scenarios = safeCandidates.map((candidate, index) =>
    buildCandidateScenario(candidate, index)
  );

  const summary = buildScenarioSummary(scenarios);

  const scenarioDefinitionSet =
    buildScenarioDefinitionSetFromScenarios(scenarios);

  return {
    version: DESIGN_CANDIDATE_SCENARIO_VERSION,
    mode: "candidate_scenario_set_selected_tariff_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    selectedSystemType,

    scenarioBasis: {
      selectedTariffOnly: true,
      multiTariffScenarioOptimisation: false,
      oneScenarioPerCandidate: true,
      note:
        "Each scenario currently represents one candidate using the selected tariff and resolved battery control strategy.",
    },

    summary,
    scenarioDefinitionSet,

    readiness:
      scenarios.length === 0
        ? "no_scenarios_generated"
        : summary.activeFinancialScenarios === 0
          ? "scenarios_available_without_financial_models"
          : "selected_tariff_scenarios_ready",

    scenarios,

    assumptions: {
      note:
        "Candidate scenarios are diagnostic only. They prepare the data structure for future multi-tariff and multi-control optimisation.",
    },

    limitations: [
      "Only the selected tariff is modelled at this stage.",
      "Only one resolved battery control strategy is modelled per candidate.",
      "Future phases will generate multiple tariff/control scenarios for shortlisted candidates.",
    ],
  };
}

module.exports = {
  DESIGN_CANDIDATE_SCENARIO_VERSION,
  buildCandidateScenario,
  buildCandidateScenarioSet,
};