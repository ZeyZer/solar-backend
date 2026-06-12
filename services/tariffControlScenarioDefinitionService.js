const {
  resolveCandidateBatteryControlStrategy,
  summarizeCandidateBatteryControlStrategy,
} = require("./candidateBatteryControlStrategyService");

const TARIFF_CONTROL_SCENARIO_DEFINITION_VERSION = "2026-beta-1";

function normaliseId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getStrategyId(strategy = {}) {
  return strategy?.strategyId || "unknown_strategy";
}

function getTariffType(strategy = {}) {
  return (
    strategy?.tariff?.tariffType ||
    strategy?.tariffType ||
    "standard"
  );
}

function getScenarioFamily({ tariffType = "standard", strategyId = "" } = {}) {
  const safeTariffType = String(tariffType || "standard").toLowerCase();
  const safeStrategyId = String(strategyId || "").toLowerCase();

  if (safeStrategyId === "no_battery") {
    return "no_battery";
  }

  if (safeStrategyId === "smart_import_export") {
    return "smart_import_export";
  }

  if (safeStrategyId === "timed_grid_charge") {
    return "time_of_use_grid_charging";
  }

  if (safeStrategyId === "self_consumption") {
    return "self_consumption";
  }

  if (safeTariffType === "flux") {
    return "smart_import_export";
  }

  if (
    safeTariffType === "overnight" ||
    safeTariffType === "ev" ||
    safeTariffType === "tou" ||
    safeTariffType === "time_of_use"
  ) {
    return "time_of_use_grid_charging";
  }

  return "self_consumption";
}

function getScenarioLabel({ scenarioFamily, tariffType, strategy = {} } = {}) {
  if (scenarioFamily === "no_battery") {
    return "No battery control";
  }

  if (scenarioFamily === "smart_import_export") {
    return "Smart import/export tariff control";
  }

  if (scenarioFamily === "time_of_use_grid_charging") {
    return "Timed grid charging tariff control";
  }

  if (scenarioFamily === "self_consumption") {
    return "Solar self-consumption tariff control";
  }

  return strategy?.label || `${tariffType || "Selected"} tariff control`;
}

function getScenarioDescription({ scenarioFamily } = {}) {
  if (scenarioFamily === "no_battery") {
    return "No battery is selected, so no battery charge/discharge control strategy is applied.";
  }

  if (scenarioFamily === "smart_import_export") {
    return "Models a smart import/export style strategy where grid charging, energy trading and battery export may be useful.";
  }

  if (scenarioFamily === "time_of_use_grid_charging") {
    return "Models timed off-peak grid charging, then battery discharge into household load.";
  }

  return "Models standard solar self-consumption, prioritising use of generated solar energy on site.";
}

function buildScenarioDefinitionId({
  scenarioType = "selected_tariff",
  tariffType = "standard",
  strategyId = "self_consumption",
} = {}) {
  return [
    normaliseId(scenarioType),
    normaliseId(tariffType),
    normaliseId(strategyId),
  ]
    .filter(Boolean)
    .join("__");
}

function buildSelectedTariffScenarioDefinition({
  input = null,
  quote = null,
  battery = null,
  batteryKWh = null,
  batteryControlStrategy = null,
} = {}) {
  const strategy =
    batteryControlStrategy ||
    resolveCandidateBatteryControlStrategy({
      input,
      quote,
      battery,
      batteryKWh,
    });

  const tariffType = getTariffType(strategy);
  const strategyId = getStrategyId(strategy);

  const scenarioFamily = getScenarioFamily({
    tariffType,
    strategyId,
  });

  const scenarioDefinitionId = buildScenarioDefinitionId({
    scenarioType: "selected_tariff",
    tariffType,
    strategyId,
  });

  return {
    version: TARIFF_CONTROL_SCENARIO_DEFINITION_VERSION,
    mode: "tariff_control_scenario_definition_beta",

    scenarioDefinitionId,
    scenarioType: "selected_tariff_resolved_control_strategy",
    scenarioFamily,

    label: getScenarioLabel({
      scenarioFamily,
      tariffType,
      strategy,
    }),

    description: getScenarioDescription({
      scenarioFamily,
    }),

    source: "selected_tariff_and_resolved_control_strategy",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    tariff: {
      source: "selected_tariff",
      tariffType,
      retailRateMode: !!strategy?.tariff?.retailRateMode,
    },

    batteryControlStrategy:
      summarizeCandidateBatteryControlStrategy(strategy),

    dispatch: {
      dispatchMode: strategy?.dispatch?.dispatchMode || null,
      allowGridCharge: !!strategy?.dispatch?.allowGridCharge,
      allowGridCharging: !!strategy?.dispatch?.allowGridCharging,
      allowEnergyTrading: !!strategy?.dispatch?.allowEnergyTrading,
      exportFromBatteryEnabled:
        !!strategy?.dispatch?.exportFromBatteryEnabled,
    },

    enabledForCurrentPhase: true,
    selectedTariffOnly: true,
    futureScenarioReady: true,

    limitations: [
      "This scenario definition represents the currently selected tariff only.",
      "It defines the tariff/control combination used by the selected-tariff scenario runner.",
      "It does not yet cause additional tariff/control scenarios to be simulated.",
    ],
  };
}

function summarizeScenarioDefinition(definition = {}) {
  return {
    version:
      definition.version || TARIFF_CONTROL_SCENARIO_DEFINITION_VERSION,
    mode: definition.mode || null,

    scenarioDefinitionId: definition.scenarioDefinitionId || null,
    scenarioType: definition.scenarioType || null,
    scenarioFamily: definition.scenarioFamily || null,

    label: definition.label || null,
    description: definition.description || null,
    source: definition.source || null,

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    tariff: definition.tariff || null,
    batteryControlStrategy:
      definition.batteryControlStrategy || null,
    dispatch: definition.dispatch || null,

    enabledForCurrentPhase:
      definition.enabledForCurrentPhase === true,
    selectedTariffOnly:
      definition.selectedTariffOnly === true,
    futureScenarioReady:
      definition.futureScenarioReady === true,

    limitations: definition.limitations || [],
  };
}

function getFutureSupportedScenarioDefinitions() {
  return [
    {
      scenarioFamily: "self_consumption",
      label: "Standard tariff self-consumption",
      intendedTariffTypes: ["standard"],
      intendedStrategyIds: ["self_consumption"],
      futurePhase: "multi_tariff_scenario_expansion",
    },
    {
      scenarioFamily: "time_of_use_grid_charging",
      label: "Time-of-use grid charging",
      intendedTariffTypes: ["overnight", "ev", "time_of_use"],
      intendedStrategyIds: ["timed_grid_charge"],
      futurePhase: "multi_tariff_scenario_expansion",
    },
    {
      scenarioFamily: "smart_import_export",
      label: "Smart import/export control",
      intendedTariffTypes: ["flux", "smart_export", "import_export"],
      intendedStrategyIds: ["smart_import_export"],
      futurePhase: "multi_tariff_scenario_expansion",
    },
    {
      scenarioFamily: "no_battery",
      label: "No battery",
      intendedTariffTypes: ["standard", "overnight", "flux"],
      intendedStrategyIds: ["no_battery"],
      futurePhase: "multi_tariff_scenario_expansion",
    },
  ];
}

function buildScenarioDefinitionSetFromDefinitions(definitions = []) {
  const safeDefinitions = Array.isArray(definitions)
    ? definitions.filter(Boolean)
    : [];

  const unique = new Map();

  for (const definition of safeDefinitions) {
    const key =
      definition.scenarioDefinitionId ||
      buildScenarioDefinitionId({
        scenarioType: definition.scenarioType,
        tariffType: definition?.tariff?.tariffType,
        strategyId:
          definition?.batteryControlStrategy?.strategyId,
      });

    if (!unique.has(key)) {
      unique.set(key, summarizeScenarioDefinition(definition));
    }
  }

  const uniqueDefinitions = Array.from(unique.values());

  return {
    version: TARIFF_CONTROL_SCENARIO_DEFINITION_VERSION,
    mode: "tariff_control_scenario_definition_set_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    selectedTariffOnly: true,
    multiTariffScenarioOptimisation: false,

    definitions: uniqueDefinitions,

    counts: {
      definitions: uniqueDefinitions.length,
      enabledForCurrentPhase: uniqueDefinitions.filter(
        (definition) => definition.enabledForCurrentPhase === true
      ).length,
      futureScenarioReady: uniqueDefinitions.filter(
        (definition) => definition.futureScenarioReady === true
      ).length,
    },

    futureSupportedScenarioDefinitions:
      getFutureSupportedScenarioDefinitions(),

    readiness:
      uniqueDefinitions.length === 0
        ? "no_scenario_definitions"
        : "selected_tariff_scenario_definitions_ready",

    assumptions: {
      note:
        "Scenario definitions currently describe the selected tariff/control strategy only. Future phases will generate multiple tariff/control definitions and run them for shortlisted candidates.",
    },
  };
}

module.exports = {
  TARIFF_CONTROL_SCENARIO_DEFINITION_VERSION,
  buildSelectedTariffScenarioDefinition,
  summarizeScenarioDefinition,
  buildScenarioDefinitionSetFromDefinitions,
  getFutureSupportedScenarioDefinitions,
};