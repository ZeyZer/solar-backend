const {
  buildCandidateSetFromInputs,
} = require("./services/designCandidateSetService");

const {
  buildScenarioExpansionPlan,
} = require("./services/designCandidateScenarioExpansionService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildMonthIdx() {
  const daysByMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const result = [];

  daysByMonth.forEach((days, monthIndex) => {
    for (let i = 0; i < days * 24; i++) {
      result.push(monthIndex);
    }
  });

  return result;
}

function buildHourOfDay(length = 8760) {
  return Array.from({ length }, (_, index) => index % 24);
}

function buildSyntheticPvHourly({ annualKWh = 4300 } = {}) {
  const raw = Array.from({ length: 8760 }, (_, index) => {
    const hour = index % 24;
    const day = Math.floor(index / 24);

    const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const seasonal =
      0.35 + 0.65 * Math.max(0, Math.sin(((day - 20) / 365) * Math.PI));

    return daylight * seasonal;
  });

  const rawTotal = raw.reduce((sum, value) => sum + value, 0);
  const scale = rawTotal > 0 ? annualKWh / rawTotal : 0;

  return raw.map((value) => value * scale);
}

function buildFlatLoadHourly({ annualKWh = 3500 } = {}) {
  return Array(8760).fill(annualKWh / 8760);
}

function buildQuoteWithRoofProfile({
  annualPvKWh = 4300,
  annualLoadKWh = 3500,
  baseSystemSizeKwp = 4.3,
} = {}) {
  const monthIdx = buildMonthIdx();
  const hourOfDay = buildHourOfDay();
  const pvHourly = buildSyntheticPvHourly({ annualKWh: annualPvKWh });
  const loadHourly = buildFlatLoadHourly({ annualKWh: annualLoadKWh });

  return {
    systemSizeKwp: baseSystemSizeKwp,
    priceLow: 7500,
    priceHigh: 9500,

    tariffBefore: {
      tariffType: "standard",
      importPrice: 0.28,
      standingChargePerDay: 0.6,
    },

    tariffAfter: {
      tariffType: "standard",
      importPrice: 0.28,
      standingChargePerDay: 0.6,
      segPrice: 0.12,
    },

    hourlyModel: {
      _pvHourlyKWh: pvHourly,
      _loadHourlyKWh: loadHourly,
      _monthIdx: monthIdx,
      _hourOfDay: hourOfDay,
      _batteryKWh: 5,
      _pvgisRoofProfiles: [
        {
          id: "roof-1-pvgis-avg-2021-2023",
          roofId: "roof-1",
          index: 0,
          year: "avg_2021_2023",
          source: "pvgis_hourly_3yr_avg_roof_array",
          baseSystemSizeKwp,
          hourlyGenerationKWh: pvHourly,
          monthIdx,
          hourOfDay,
          annualGenerationKWh: Math.round(
            pvHourly.reduce((sum, value) => sum + Number(value || 0), 0)
          ),
        },
      ],
    },
  };
}

function runDirectExpansionPlanTest() {
  console.log("\n▶ Direct scenario expansion plan");

  const candidateSet = buildCandidateSetFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
      systemType: "balanced",
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 10,
        },
      ],
    },
  });

  const plan = buildScenarioExpansionPlan({
    candidates: candidateSet.candidates,
    shortlist: candidateSet.shortlist,
    optimiserResults: candidateSet.optimiserResults,
    maxCandidates: 8,
    maxScenariosPerCandidate: 3,
  });

  assert(plan, "Missing scenario expansion plan.");
  assert(
    plan.mode === "candidate_scenario_expansion_plan_beta",
    "Unexpected scenario expansion plan mode."
  );

  assert(plan.usedForCalculation === false, "Expansion plan should not be used for calculation.");
  assert(plan.usedForPricing === false, "Expansion plan should not be used for pricing.");
  assert(plan.usedForRecommendation === false, "Expansion plan should not be used for recommendation.");

  assert(plan.executionMode === "plan_only", "Expected plan-only execution mode.");
  assert(plan.executionStatus === "not_run", "Expected not-run execution status.");

  assert(plan.summary.targetCandidateCount > 0, "Expected target candidates.");
  assert(plan.summary.plannedScenarioCount > 0, "Expected planned scenarios.");
  assert(plan.candidatePlans.length === plan.summary.targetCandidateCount, "Candidate plan count mismatch.");

  const firstPlan = plan.candidatePlans[0];

  assert(firstPlan.candidateId, "Candidate plan missing candidateId.");
  assert(Array.isArray(firstPlan.plannedScenarios), "plannedScenarios should be an array.");
  assert(firstPlan.plannedScenarios.length > 0, "Expected planned scenarios for first candidate.");

  for (const scenario of firstPlan.plannedScenarios) {
    assert(scenario.plannedScenarioId, "Planned scenario missing ID.");
    assert(scenario.scenarioFamily, "Planned scenario missing family.");
    assert(
      scenario.executionStatus === "planned_not_run",
      "Planned scenario should not be run yet."
    );
  }

  console.log("  ✓ Direct expansion plan OK:", {
    targetCandidates: plan.summary.targetCandidateCount,
    plannedScenarios: plan.summary.plannedScenarioCount,
    readiness: plan.readiness,
  });
}

function runCandidateSetIncludesExpansionPlanTest() {
  console.log("\n▶ Candidate set includes scenario expansion plan");

  const candidateSet = buildCandidateSetFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
      systemType: "balanced",
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 10,
        },
      ],
    },
  });

  assert(candidateSet.scenarioExpansionPlan, "Candidate set missing scenarioExpansionPlan.");
  assert(
    candidateSet.scenarioExpansionPlan.mode === "candidate_scenario_expansion_plan_beta",
    "Unexpected scenarioExpansionPlan mode."
  );

  assert(
    candidateSet.scenarioExpansionPlan.summary.targetCandidateCount > 0,
    "Expected scenario expansion target candidates."
  );

  assert(
    candidateSet.scenarioExpansionPlan.summary.plannedScenarioCount > 0,
    "Expected planned scenario count."
  );

  console.log("  ✓ Candidate set expansion plan OK:", {
    targetCandidates:
      candidateSet.scenarioExpansionPlan.summary.targetCandidateCount,
    plannedScenarios:
      candidateSet.scenarioExpansionPlan.summary.plannedScenarioCount,
  });
}

function runNoQuoteDataExpansionPlanTest() {
  console.log("\n▶ Scenario expansion plan without quote-level hourly data");

  const candidateSet = buildCandidateSetFromInputs({
    input: {
      panelOption: "value",
      batteryKWh: 5,
      systemType: "balanced",
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 10,
        },
      ],
    },
  });

  assert(candidateSet.scenarioExpansionPlan, "Candidate set missing scenarioExpansionPlan.");

  assert(
    candidateSet.scenarioExpansionPlan.summary.targetCandidateCount > 0,
    "Expected eligible candidates even without active financial models."
  );

  assert(
    candidateSet.scenarioExpansionPlan.executionStatus === "not_run",
    "Expansion plan should still not run simulations."
  );

  console.log("  ✓ No-quote expansion plan OK:", {
    targetCandidates:
      candidateSet.scenarioExpansionPlan.summary.targetCandidateCount,
    plannedScenarios:
      candidateSet.scenarioExpansionPlan.summary.plannedScenarioCount,
    readiness: candidateSet.scenarioExpansionPlan.readiness,
  });
}

function main() {
  console.log("Running design candidate scenario expansion tests");

  runDirectExpansionPlanTest();
  runCandidateSetIncludesExpansionPlanTest();
  runNoQuoteDataExpansionPlanTest();

  console.log("\n✅ Scenario expansion tests passed");
}

main();