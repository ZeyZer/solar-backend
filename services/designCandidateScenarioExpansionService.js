const {
  getFutureSupportedScenarioDefinitions,
} = require("./tariffControlScenarioDefinitionService");

const DESIGN_CANDIDATE_SCENARIO_EXPANSION_VERSION = "2026-beta-1";

function normaliseId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unique(values = []) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function getCandidateStatus(candidate = {}) {
  return candidate?.filtering?.status || "unknown";
}

function isEligible(candidate = {}) {
  return candidate?.filtering?.eligibleForFutureOptimiser === true;
}

function hasBattery(candidate = {}) {
  const battery = candidate?.products?.battery;

  if (!battery) return false;

  if (battery === "no-battery") return false;

  if (typeof battery === "string") {
    return battery !== "no-battery";
  }

  return !!battery?.id;
}

function getCandidateById(candidates = [], candidateId = null) {
  return candidates.find(
    (candidate) => String(candidate?.candidateId || "") === String(candidateId || "")
  );
}

function getCandidateSystemSummary(candidate = {}) {
  return {
    totalPanels: candidate?.panelLayout?.totalPanels ?? null,
    systemSizeKwp: candidate?.panelLayout?.systemSizeKwp ?? null,
    batteryKWh:
      candidate?.dispatchModel?.battery?.usableCapacityKWh ??
      candidate?.financialModel?.batteryControlStrategy?.battery?.usableCapacityKWh ??
      null,
    status: getCandidateStatus(candidate),
    hasBattery: hasBattery(candidate),
  };
}

function getCandidateFinancialSummary(candidate = {}) {
  return {
    annualBenefit:
      candidate?.financialModel?.annual?.totalAnnualBenefit ?? null,
    simplePaybackYears:
      candidate?.financialModel?.payback?.simplePaybackYears ??
      candidate?.financialModel?.payback?.paybackYear ??
      null,
    lifetimeSavings:
      candidate?.financialModel?.payback?.lifetimeSavings ?? null,
    estimatedInstalledCost:
      candidate?.financialModel?.systemCost?.estimatedInstalledCost ??
      candidate?.costModel?.estimatedInstalledCost ??
      candidate?.costModel?.estimatedHardwareAdder ??
      null,
    financialMode:
      candidate?.financialModel?.mode || null,
  };
}

function getSeedCandidateIds({
  candidates = [],
  shortlist = null,
  optimiserResults = null,
  maxCandidates = 8,
} = {}) {
  const keyIds = optimiserResults?.keyCandidateIds || {};

  const optimiserIds = [
    keyIds.bestPayback,
    keyIds.bestLifetimeSavings,
    keyIds.lowestUpfrontCost,
    keyIds.bestAnnualBenefit,
    keyIds.bestSelectedSystemTypeFit,
    keyIds.balanced,
  ];

  const shortlistIds = Array.isArray(shortlist?.shortlistedCandidates)
    ? shortlist.shortlistedCandidates.map((candidate) => candidate.candidateId)
    : [];

  const fallbackEligibleIds = candidates
    .filter(isEligible)
    .slice(0, maxCandidates)
    .map((candidate) => candidate.candidateId);

  return unique([
    ...optimiserIds,
    ...shortlistIds,
    ...fallbackEligibleIds,
  ]).slice(0, maxCandidates);
}

function scenarioAppliesToCandidate({ candidate = {}, scenarioDefinition = {} } = {}) {
  const family = scenarioDefinition.scenarioFamily;

  if (family === "no_battery") {
    return !hasBattery(candidate);
  }

  if (!hasBattery(candidate)) {
    return family === "no_battery";
  }

  return [
    "self_consumption",
    "time_of_use_grid_charging",
    "smart_import_export",
  ].includes(family);
}

function buildPlannedScenarioId({ candidateId, scenarioFamily } = {}) {
  return [
    normaliseId(candidateId),
    normaliseId(scenarioFamily),
    "planned",
  ]
    .filter(Boolean)
    .join("__");
}

function buildCandidateScenarioPlan({
  candidate = {},
  scenarioDefinitions = [],
  maxScenariosPerCandidate = 3,
} = {}) {
  const applicableDefinitions = scenarioDefinitions
    .filter((definition) =>
      scenarioAppliesToCandidate({
        candidate,
        scenarioDefinition: definition,
      })
    )
    .slice(0, maxScenariosPerCandidate);

  return {
    candidateId: candidate?.candidateId || null,

    candidateStatus: getCandidateStatus(candidate),
    eligibleForFutureOptimiser: isEligible(candidate),

    system: getCandidateSystemSummary(candidate),
    financial: getCandidateFinancialSummary(candidate),

    plannedScenarios: applicableDefinitions.map((definition) => ({
      plannedScenarioId: buildPlannedScenarioId({
        candidateId: candidate?.candidateId,
        scenarioFamily: definition.scenarioFamily,
      }),

      scenarioFamily: definition.scenarioFamily,
      label: definition.label,
      intendedTariffTypes: definition.intendedTariffTypes || [],
      intendedStrategyIds: definition.intendedStrategyIds || [],

      executionStatus: "planned_not_run",
      enabledForCurrentPhase: false,

      futurePhase: definition.futurePhase || "multi_tariff_scenario_expansion",

      assumptions: {
        note:
          "This scenario is planned only. Dispatch and financial modelling will be run in a later phase.",
      },
    })),
  };
}

function buildScenarioExpansionPlan({
  candidates = [],
  shortlist = null,
  optimiserResults = null,
  maxCandidates = 8,
  maxScenariosPerCandidate = 3,
} = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  const supportedDefinitions = getFutureSupportedScenarioDefinitions();

  const seedCandidateIds = getSeedCandidateIds({
    candidates: safeCandidates,
    shortlist,
    optimiserResults,
    maxCandidates,
  });

  const targetCandidates = seedCandidateIds
    .map((candidateId) => getCandidateById(safeCandidates, candidateId))
    .filter(Boolean)
    .filter(isEligible);

  const candidatePlans = targetCandidates.map((candidate) =>
    buildCandidateScenarioPlan({
      candidate,
      scenarioDefinitions: supportedDefinitions,
      maxScenariosPerCandidate,
    })
  );

  const plannedScenarioCount = candidatePlans.reduce(
    (total, plan) => total + plan.plannedScenarios.length,
    0
  );

  const scenarioFamilyCounts = {};

  for (const plan of candidatePlans) {
    for (const scenario of plan.plannedScenarios) {
      scenarioFamilyCounts[scenario.scenarioFamily] =
        (scenarioFamilyCounts[scenario.scenarioFamily] || 0) + 1;
    }
  }

  return {
    version: DESIGN_CANDIDATE_SCENARIO_EXPANSION_VERSION,
    mode: "candidate_scenario_expansion_plan_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    executionMode: "plan_only",
    executionStatus: "not_run",

    selectedCandidatesOnly: true,
    multiTariffScenarioOptimisation: false,

    selectionPolicy: {
      source:
        "optimiser winner candidates, shortlisted candidates, then eligible fallback candidates",
      maxCandidates,
      maxScenariosPerCandidate,
      candidateSelectionOrder: [
        "bestPayback",
        "bestLifetimeSavings",
        "lowestUpfrontCost",
        "bestAnnualBenefit",
        "bestSelectedSystemTypeFit",
        "balanced",
        "shortlist",
        "eligibleFallback",
      ],
    },

    summary: {
      totalCandidates: safeCandidates.length,
      selectedCandidateIds: seedCandidateIds,
      targetCandidateCount: targetCandidates.length,
      plannedScenarioCount,
      scenarioFamilyCounts,
      supportedScenarioFamilyCount: supportedDefinitions.length,
    },

    supportedScenarioDefinitions: supportedDefinitions,

    candidatePlans,

    readiness:
      targetCandidates.length === 0
        ? "no_target_candidates_for_scenario_expansion"
        : plannedScenarioCount === 0
          ? "no_applicable_scenarios_for_target_candidates"
          : "scenario_expansion_plan_ready",

    assumptions: {
      note:
        "This is a planning layer only. It identifies which shortlisted/optimiser candidates should later be tested against multiple tariff/control scenario families.",
    },

    limitations: [
      "No additional dispatch or financial simulations are run in this phase.",
      "Tariff availability is not yet filtered by user postcode, supplier or meter constraints.",
      "Future phases will convert planned scenarios into executed scenario runs.",
      "The final optimiser should rank candidate scenarios, not candidates alone.",
    ],
  };
}

module.exports = {
  DESIGN_CANDIDATE_SCENARIO_EXPANSION_VERSION,
  buildScenarioExpansionPlan,
};