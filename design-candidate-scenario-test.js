const {
  buildCandidateSetFromInputs,
} = require("./services/designCandidateSetService");

const {
  buildCandidateScenarioSet,
} = require("./services/designCandidateScenarioService");

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

function runDirectScenarioSetTest() {
  console.log("\n▶ Direct candidate scenario set");

  const candidateSet = buildCandidateSetFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
      systemType: "balanced",
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

  const scenarioSet = buildCandidateScenarioSet({
    candidates: candidateSet.candidates,
    selectedSystemType: "balanced",
  });

  assert(scenarioSet, "Missing scenario set.");
  assert(
    scenarioSet.mode === "candidate_scenario_set_selected_tariff_beta",
    "Unexpected scenario set mode."
  );
  assert(scenarioSet.usedForCalculation === false, "Scenario set should not be used for calculation.");
  assert(scenarioSet.usedForPricing === false, "Scenario set should not be used for pricing.");
  assert(scenarioSet.usedForRecommendation === false, "Scenario set should not be used for recommendation.");

  assert(Array.isArray(scenarioSet.scenarios), "Scenarios should be an array.");
  assert(
    scenarioSet.scenarios.length === candidateSet.candidates.length,
    "Expected one scenario per candidate."
  );

  assert(
    scenarioSet.summary.totalScenarios === candidateSet.candidates.length,
    "Scenario summary total mismatch."
  );

  assert(
    scenarioSet.summary.activeFinancialScenarios > 0,
    "Expected active financial scenarios."
  );

  assert(
    scenarioSet.summary.activeDispatchScenarios > 0,
    "Expected active dispatch scenarios."
  );

  const firstActive = scenarioSet.scenarios.find(
    (scenario) => scenario.activeModels.financial
  );

  assert(firstActive, "Expected at least one active financial scenario.");
  assert(firstActive.scenarioId, "Scenario missing scenarioId.");

  assert(
    firstActive.selectedTariffScenarioRun,
    "Scenario missing selectedTariffScenarioRun summary."
  );

  assert(
    firstActive.selectedTariffScenarioRun.mode ===
      "candidate_scenario_run_selected_tariff_beta",
    "Unexpected selectedTariffScenarioRun mode."
  );

  assert(firstActive.candidateId, "Scenario missing candidateId.");
  assert(firstActive.tariffAndControl, "Scenario missing tariff/control section.");
  assert(
    firstActive.tariffAndControl.batteryControlStrategy,
    "Scenario missing battery control strategy."
  );
  assert(
    firstActive.tariffAndControl.batteryControlStrategy.strategyId === "timed_grid_charge",
    "Expected overnight tariff to use timed grid charge strategy."
  );

  console.log("  ✓ Direct scenario set OK:", {
    scenarios: scenarioSet.summary.totalScenarios,
    activeFinancialScenarios: scenarioSet.summary.activeFinancialScenarios,
    readiness: scenarioSet.readiness,
  });
}

function runCandidateSetIncludesScenarioSetTest() {
  console.log("\n▶ Candidate set includes scenario set");

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

  assert(candidateSet.scenarioSet, "Candidate set missing scenarioSet.");
  assert(
    candidateSet.scenarioSet.mode === "candidate_scenario_set_selected_tariff_beta",
    "Unexpected candidate set scenarioSet mode."
  );

  assert(
    candidateSet.scenarioSet.summary.totalScenarios === candidateSet.candidates.length,
    "Candidate set scenario count mismatch."
  );

  assert(
    candidateSet.scenarioSet.summary.selectedTariffScenarioRuns ===
      candidateSet.candidates.length,
    "Expected one selected-tariff scenario run per candidate."
  );

  console.log("  ✓ Candidate set scenario set OK:", {
    scenarios: candidateSet.scenarioSet.summary.totalScenarios,
    readiness: candidateSet.scenarioSet.readiness,
  });
}

function runUnavailableFinancialScenarioTest() {
  console.log("\n▶ Scenario set without quote-level hourly data");

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

  assert(candidateSet.scenarioSet, "Candidate set missing scenarioSet.");
  assert(
    candidateSet.scenarioSet.summary.totalScenarios === candidateSet.candidates.length,
    "Scenario count mismatch."
  );

  assert(
    candidateSet.scenarioSet.summary.activeFinancialScenarios === 0,
    "Expected no active financial scenarios without quote-level hourly data."
  );

  assert(
    candidateSet.scenarioSet.readiness === "scenarios_available_without_financial_models",
    "Unexpected no-financial scenario readiness."
  );

  console.log("  ✓ Unavailable financial scenario OK:", {
    scenarios: candidateSet.scenarioSet.summary.totalScenarios,
    readiness: candidateSet.scenarioSet.readiness,
  });
}

function main() {
  console.log("Running design candidate scenario tests");

  runDirectScenarioSetTest();
  runCandidateSetIncludesScenarioSetTest();
  runUnavailableFinancialScenarioTest();

  console.log("\n✅ Design candidate scenario tests passed");
}

main();