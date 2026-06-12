const {
  buildSelectedTariffScenarioDefinition,
  buildScenarioDefinitionSetFromDefinitions,
} = require("./services/tariffControlScenarioDefinitionService");

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

function runStandardDefinitionTest() {
  console.log("\n▶ Standard tariff scenario definition");

  const definition = buildSelectedTariffScenarioDefinition({
    input: {
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "standard",
        importPrice: 0.28,
        segPrice: 0.12,
      },
    },
  });

  assert(definition.mode === "tariff_control_scenario_definition_beta", "Unexpected definition mode.");
  assert(definition.scenarioDefinitionId.includes("standard"), "Expected standard scenario definition ID.");
  assert(definition.scenarioFamily === "self_consumption", "Expected self-consumption family.");
  assert(definition.batteryControlStrategy.strategyId === "self_consumption", "Expected self-consumption strategy.");
  assert(definition.dispatch.allowGridCharge === false, "Standard tariff should not grid charge.");

  console.log("  ✓ Standard definition OK:", {
    scenarioDefinitionId: definition.scenarioDefinitionId,
    family: definition.scenarioFamily,
  });
}

function runOvernightDefinitionTest() {
  console.log("\n▶ Overnight tariff scenario definition");

  const definition = buildSelectedTariffScenarioDefinition({
    input: {
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "overnight",
        importDay: 0.30,
        importNight: 0.09,
        nightStartHour: 0,
        nightEndHour: 5,
        segPrice: 0.12,
      },
    },
  });

  assert(definition.scenarioDefinitionId.includes("overnight"), "Expected overnight scenario definition ID.");
  assert(definition.scenarioFamily === "time_of_use_grid_charging", "Expected grid charging family.");
  assert(definition.batteryControlStrategy.strategyId === "timed_grid_charge", "Expected timed grid charge strategy.");
  assert(definition.dispatch.allowGridCharge === true, "Overnight tariff should grid charge.");

  console.log("  ✓ Overnight definition OK:", {
    scenarioDefinitionId: definition.scenarioDefinitionId,
    family: definition.scenarioFamily,
  });
}

function runFluxDefinitionTest() {
  console.log("\n▶ Flux tariff scenario definition");

  const definition = buildSelectedTariffScenarioDefinition({
    input: {
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "flux",
        importOffPeak: 0.16,
        importPeak: 0.38,
        exportOffPeak: 0.08,
        exportPeak: 0.24,
      },
    },
  });

  assert(definition.scenarioFamily === "smart_import_export", "Expected smart import/export family.");
  assert(definition.batteryControlStrategy.strategyId === "smart_import_export", "Expected smart import/export strategy.");
  assert(definition.dispatch.allowGridCharge === true, "Flux should grid charge.");
  assert(definition.dispatch.allowEnergyTrading === true, "Flux should allow energy trading.");
  assert(definition.dispatch.exportFromBatteryEnabled === true, "Flux should allow battery export.");

  console.log("  ✓ Flux definition OK:", {
    scenarioDefinitionId: definition.scenarioDefinitionId,
    family: definition.scenarioFamily,
  });
}

function runDefinitionSetTest() {
  console.log("\n▶ Scenario definition set");

  const standard = buildSelectedTariffScenarioDefinition({
    input: {
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "standard",
      },
    },
  });

  const duplicateStandard = buildSelectedTariffScenarioDefinition({
    input: {
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "standard",
      },
    },
  });

  const overnight = buildSelectedTariffScenarioDefinition({
    input: {
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "overnight",
      },
    },
  });

  const set = buildScenarioDefinitionSetFromDefinitions([
    standard,
    duplicateStandard,
    overnight,
  ]);

  assert(set.mode === "tariff_control_scenario_definition_set_beta", "Unexpected definition set mode.");
  assert(set.counts.definitions === 2, "Expected duplicate definitions to be de-duplicated.");
  assert(Array.isArray(set.futureSupportedScenarioDefinitions), "Expected future supported definitions.");
  assert(set.futureSupportedScenarioDefinitions.length > 0, "Expected future supported definition metadata.");

  console.log("  ✓ Definition set OK:", {
    definitions: set.counts.definitions,
    futureSupported: set.futureSupportedScenarioDefinitions.length,
  });
}

function runCandidateScenarioDefinitionTest() {
  console.log("\n▶ Candidate includes scenario definition");

  const candidate = buildDesignCandidateFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
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

  assert(candidate.selectedTariffScenarioRun, "Candidate missing selectedTariffScenarioRun.");
  assert(candidate.selectedTariffScenarioRun.scenarioDefinition, "Scenario run missing scenarioDefinition.");
  assert(candidate.selectedTariffScenarioRun.scenarioDefinitionId, "Scenario run missing scenarioDefinitionId.");
  assert(
    candidate.selectedTariffScenarioRun.scenarioDefinition.scenarioFamily ===
      "time_of_use_grid_charging",
    "Expected overnight scenario family."
  );

  console.log("  ✓ Candidate scenario definition OK:", {
    scenarioDefinitionId:
      candidate.selectedTariffScenarioRun.scenarioDefinitionId,
  });
}

function runCandidateSetScenarioDefinitionSetTest() {
  console.log("\n▶ Candidate set includes scenario definition set");

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
  assert(candidateSet.scenarioSet.scenarioDefinitionSet, "Scenario set missing scenarioDefinitionSet.");
  assert(
    candidateSet.scenarioSet.scenarioDefinitionSet.mode ===
      "tariff_control_scenario_definition_set_beta",
    "Unexpected scenarioDefinitionSet mode."
  );
  assert(
    candidateSet.scenarioSet.scenarioDefinitionSet.counts.definitions >= 1,
    "Expected at least one scenario definition."
  );

  console.log("  ✓ Candidate set scenario definition set OK:", {
    definitions:
      candidateSet.scenarioSet.scenarioDefinitionSet.counts.definitions,
  });
}

function main() {
  console.log("Running scenario definition tests");

  runStandardDefinitionTest();
  runOvernightDefinitionTest();
  runFluxDefinitionTest();
  runDefinitionSetTest();
  runCandidateScenarioDefinitionTest();
  runCandidateSetScenarioDefinitionSetTest();

  console.log("\n✅ Scenario definition tests passed");
}

main();