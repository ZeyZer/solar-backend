const {
  buildDesignCandidateFromInputs,
} = require("./services/designCandidateService");

const {
  buildCandidateSetFromInputs,
} = require("./services/designCandidateSetService");

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
      tariffType: "overnight",
      importDay: 0.30,
      importNight: 0.09,
      nightStartHour: 0,
      nightEndHour: 5,
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

function runCandidateScenarioRunTest() {
  console.log("\n▶ Candidate selected-tariff scenario run");

  const candidate = buildDesignCandidateFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
      tariffBefore: {
        tariffType: "standard",
        importPrice: 0.28,
        standingChargePerDay: 0.6,
      },
      tariffAfter: {
        tariffType: "overnight",
        importDay: 0.30,
        importNight: 0.09,
        nightStartHour: 0,
        nightEndHour: 5,
        standingChargePerDay: 0.6,
        segPrice: 0.12,
      },
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

  const run = candidate.selectedTariffScenarioRun;

  assert(run, "Candidate missing selectedTariffScenarioRun.");
  assert(
    run.mode === "candidate_scenario_run_selected_tariff_beta",
    "Unexpected selected tariff scenario run mode."
  );

  assert(run.usedForCalculation === false, "Scenario run should not be used for calculation.");
  assert(run.usedForPricing === false, "Scenario run should not be used for pricing.");
  assert(run.usedForRecommendation === false, "Scenario run should not be used for recommendation.");

  assert(run.scenarioRunId, "Scenario run missing scenarioRunId.");
  assert(run.candidateId === candidate.candidateId, "Scenario run candidateId mismatch.");

  assert(run.batteryControlStrategy, "Scenario run missing battery control strategy.");
  assert(
    run.batteryControlStrategy.strategyId === "timed_grid_charge",
    "Overnight tariff should resolve to timed grid charge."
  );

  assert(run.activeModels.performance === true, "Expected active performance model.");
  assert(run.activeModels.dispatch === true, "Expected active dispatch model.");
  assert(run.activeModels.financial === true, "Expected active financial model.");

  assert(
    candidate.dispatchModel.mode === "candidate_hourly_dispatch_model_beta",
    "Candidate dispatch model should come from scenario run."
  );

  assert(
    candidate.financialModel.mode === "candidate_hourly_financial_model_beta",
    "Candidate financial model should come from scenario run."
  );

  assert(
    candidate.financialModel.batteryControlStrategy.strategyId ===
      run.batteryControlStrategy.strategyId,
    "Financial model strategy should match scenario run strategy."
  );

  console.log("  ✓ Candidate scenario run OK:", {
    scenarioRunId: run.scenarioRunId,
    strategy: run.batteryControlStrategy.strategyId,
    annualBenefit: run.annual.totalAnnualBenefit,
    readiness: run.readiness,
  });
}

function runUnavailableScenarioRunTest() {
  console.log("\n▶ Unavailable selected-tariff scenario run");

  const candidate = buildDesignCandidateFromInputs({
    input: {
      panelOption: "value",
      batteryKWh: 5,
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

  const run = candidate.selectedTariffScenarioRun;

  assert(run, "Candidate missing selectedTariffScenarioRun.");
  assert(
    run.mode === "candidate_scenario_run_selected_tariff_beta",
    "Expected selected tariff scenario run even when unavailable."
  );

  assert(run.activeModels.performance === true, "Performance model shell should exist.");
  assert(run.activeModels.dispatch === false, "Dispatch should not be active without quote hourly data.");
  assert(run.activeModels.financial === false, "Financial should not be active without quote hourly data.");
  assert(
    run.readiness === "selected_tariff_scenario_unavailable",
    "Expected unavailable scenario readiness."
  );

  console.log("  ✓ Unavailable scenario run OK:", {
    readiness: run.readiness,
    dispatchMode: run.modelModes.dispatch,
    financialMode: run.modelModes.financial,
  });
}

function runCandidateSetScenarioRunSummaryTest() {
  console.log("\n▶ Candidate set scenario run summaries");

  const candidateSet = buildCandidateSetFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
      systemType: "balanced",
      tariffAfter: {
        tariffType: "overnight",
        importDay: 0.30,
        importNight: 0.09,
        nightStartHour: 0,
        nightEndHour: 5,
        standingChargePerDay: 0.6,
        segPrice: 0.12,
      },
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

  assert(candidateSet.scenarioSet, "Candidate set missing scenarioSet.");
  assert(
    candidateSet.scenarioSet.summary.selectedTariffScenarioRuns ===
      candidateSet.candidates.length,
    "Expected one selected-tariff scenario run per candidate."
  );

  const firstScenario = candidateSet.scenarioSet.scenarios[0];
  assert(firstScenario.selectedTariffScenarioRun, "Scenario missing selectedTariffScenarioRun summary.");
  assert(
    firstScenario.activeModels.selectedTariffScenarioRun === true,
    "Scenario should flag selected tariff scenario run as active."
  );

  console.log("  ✓ Candidate set scenario run summaries OK:", {
    scenarios: candidateSet.scenarioSet.summary.totalScenarios,
    selectedTariffScenarioRuns:
      candidateSet.scenarioSet.summary.selectedTariffScenarioRuns,
  });
}

function main() {
  console.log("Running design candidate scenario runner tests");

  runCandidateScenarioRunTest();
  runUnavailableScenarioRunTest();
  runCandidateSetScenarioRunSummaryTest();

  console.log("\n✅ Design candidate scenario runner tests passed");
}

main();