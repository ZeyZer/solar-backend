const DESIGN_PREFERENCE_PROFILE_VERSION = "2026-beta-1";

function normaliseString(value, fallback = "") {
  const str = String(value ?? "").trim();
  return str || fallback;
}

function normaliseId(value, fallback = "unknown") {
  return normaliseString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function booleanOrNull(value) {
  if (value === true || value === "true" || value === "yes" || value === "required") {
    return true;
  }

  if (value === false || value === "false" || value === "no" || value === "not_required") {
    return false;
  }

  return null;
}

function clampWeight(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function getNested(input = {}, paths = [], fallback = undefined) {
  for (const path of paths) {
    const parts = path.split(".");
    let current = input;

    for (const part of parts) {
      if (current && Object.prototype.hasOwnProperty.call(current, part)) {
        current = current[part];
      } else {
        current = undefined;
        break;
      }
    }

    if (current !== undefined && current !== null && current !== "") {
      return current;
    }
  }

  return fallback;
}

function inferSystemType(input = {}) {
  return normaliseId(
    getNested(input, [
      "systemType",
      "selectedSystemType",
      "preferences.systemType",
      "designPreferences.systemType",
    ], "balanced"),
    "balanced"
  );
}

function getPriorityPreset(systemType = "balanced") {
  const presets = {
    lowest_upfront_cost: {
      lowUpfrontCost: 1,
      payback: 0.75,
      lifetimeSavings: 0.35,
      aesthetics: 0.2,
      warranty: 0.25,
      smartControls: 0.25,
      backup: 0.1,
      shadeResilience: 0.35,
    },

    best_payback: {
      lowUpfrontCost: 0.65,
      payback: 1,
      lifetimeSavings: 0.7,
      aesthetics: 0.25,
      warranty: 0.35,
      smartControls: 0.45,
      backup: 0.15,
      shadeResilience: 0.45,
    },

    best_lifetime_savings: {
      lowUpfrontCost: 0.35,
      payback: 0.65,
      lifetimeSavings: 1,
      aesthetics: 0.3,
      warranty: 0.55,
      smartControls: 0.65,
      backup: 0.25,
      shadeResilience: 0.5,
    },

    premium: {
      lowUpfrontCost: 0.15,
      payback: 0.45,
      lifetimeSavings: 0.75,
      aesthetics: 0.9,
      warranty: 0.85,
      smartControls: 0.8,
      backup: 0.45,
      shadeResilience: 0.55,
    },

    premium_integrated: {
      lowUpfrontCost: 0.15,
      payback: 0.45,
      lifetimeSavings: 0.75,
      aesthetics: 0.85,
      warranty: 0.8,
      smartControls: 0.9,
      backup: 0.55,
      shadeResilience: 0.6,
    },

    backup_ready: {
      lowUpfrontCost: 0.25,
      payback: 0.45,
      lifetimeSavings: 0.6,
      aesthetics: 0.35,
      warranty: 0.7,
      smartControls: 0.75,
      backup: 1,
      shadeResilience: 0.55,
    },

    shaded_roof: {
      lowUpfrontCost: 0.35,
      payback: 0.65,
      lifetimeSavings: 0.75,
      aesthetics: 0.3,
      warranty: 0.55,
      smartControls: 0.7,
      backup: 0.25,
      shadeResilience: 1,
    },

    balanced: {
      lowUpfrontCost: 0.55,
      payback: 0.75,
      lifetimeSavings: 0.75,
      aesthetics: 0.5,
      warranty: 0.55,
      smartControls: 0.55,
      backup: 0.35,
      shadeResilience: 0.55,
    },
  };

  return presets[systemType] || presets.balanced;
}

function readPriorityOverrides(input = {}) {
  const raw =
    getNested(input, [
      "preferenceWeights",
      "preferences.weights",
      "designPreferences.weights",
      "optimisationWeights",
    ], {}) || {};

  return {
    lowUpfrontCost: raw.lowUpfrontCost,
    payback: raw.payback,
    lifetimeSavings: raw.lifetimeSavings,
    aesthetics: raw.aesthetics,
    warranty: raw.warranty,
    smartControls: raw.smartControls,
    backup: raw.backup,
    shadeResilience: raw.shadeResilience,
  };
}

function buildPriorityWeights(input = {}, systemType = "balanced") {
  const preset = getPriorityPreset(systemType);
  const overrides = readPriorityOverrides(input);

  return {
    lowUpfrontCost: clampWeight(overrides.lowUpfrontCost, preset.lowUpfrontCost),
    payback: clampWeight(overrides.payback, preset.payback),
    lifetimeSavings: clampWeight(overrides.lifetimeSavings, preset.lifetimeSavings),
    aesthetics: clampWeight(overrides.aesthetics, preset.aesthetics),
    warranty: clampWeight(overrides.warranty, preset.warranty),
    smartControls: clampWeight(overrides.smartControls, preset.smartControls),
    backup: clampWeight(overrides.backup, preset.backup),
    shadeResilience: clampWeight(overrides.shadeResilience, preset.shadeResilience),
  };
}

function buildPanelConstraints(input = {}) {
  const minWarrantyYears = numberOrNull(
    getNested(input, [
      "minPanelWarrantyYears",
      "panelWarrantyYears",
      "preferences.minPanelWarrantyYears",
      "designPreferences.panel.minWarrantyYears",
    ], null)
  );

  const requireAllBlack = booleanOrNull(
    getNested(input, [
      "requireAllBlackPanels",
      "blackPanelsOnly",
      "preferences.blackPanelsOnly",
      "designPreferences.panel.blackOnly",
    ], null)
  );

  const preferredAesthetic = normaliseId(
    getNested(input, [
      "panelAesthetic",
      "preferences.panelAesthetic",
      "designPreferences.panel.aesthetic",
    ], "no_strong_preference"),
    "no_strong_preference"
  );

  return {
    minWarrantyYears,
    requireAllBlack,
    preferredAesthetic,
    preferredTechnology:
      getNested(input, [
        "panelTechnology",
        "preferences.panelTechnology",
        "designPreferences.panel.technology",
      ], null) || null,
  };
}

function buildInverterConstraints(input = {}) {
  const backupRequired = booleanOrNull(
    getNested(input, [
      "backupRequired",
      "requiresBackup",
      "preferences.backupRequired",
      "designPreferences.inverter.backupRequired",
    ], null)
  );

  const hybridRequired = booleanOrNull(
    getNested(input, [
      "hybridRequired",
      "requiresHybridInverter",
      "preferences.hybridRequired",
      "designPreferences.inverter.hybridRequired",
    ], null)
  );

  const minWarrantyYears = numberOrNull(
    getNested(input, [
      "minInverterWarrantyYears",
      "inverterWarrantyYears",
      "preferences.minInverterWarrantyYears",
      "designPreferences.inverter.minWarrantyYears",
    ], null)
  );

  const smartness = normaliseId(
    getNested(input, [
      "inverterSmartness",
      "smartControlsPreference",
      "preferences.inverterSmartness",
      "designPreferences.inverter.smartness",
    ], "standard"),
    "standard"
  );

  return {
    backupRequired,
    hybridRequired,
    minWarrantyYears,
    smartness,
    monitoringRequired:
      booleanOrNull(
        getNested(input, [
          "monitoringRequired",
          "preferences.monitoringRequired",
          "designPreferences.inverter.monitoringRequired",
        ], null)
      ),
  };
}

function buildBatteryConstraints(input = {}) {
  const batteryRequired = booleanOrNull(
    getNested(input, [
      "batteryRequired",
      "requiresBattery",
      "preferences.batteryRequired",
      "designPreferences.battery.required",
    ], null)
  );

  const minUsableKWh = numberOrNull(
    getNested(input, [
      "minBatteryKWh",
      "minimumBatteryKWh",
      "preferences.minBatteryKWh",
      "designPreferences.battery.minUsableKWh",
    ], null)
  );

  const backupReserveRequired = booleanOrNull(
    getNested(input, [
      "backupReserveRequired",
      "preferences.backupReserveRequired",
      "designPreferences.battery.backupReserveRequired",
    ], null)
  );

  return {
    batteryRequired,
    minUsableKWh,
    backupReserveRequired,
    allowGridCharging:
      booleanOrNull(
        getNested(input, [
          "allowGridCharging",
          "preferences.allowGridCharging",
          "designPreferences.battery.allowGridCharging",
        ], null)
      ),
  };
}

function buildBudgetConstraints(input = {}) {
  return {
    maxBudget:
      numberOrNull(
        getNested(input, [
          "maxBudget",
          "budgetMax",
          "preferences.maxBudget",
          "designPreferences.budget.max",
        ], null)
      ),
    targetBudget:
      numberOrNull(
        getNested(input, [
          "targetBudget",
          "budgetTarget",
          "preferences.targetBudget",
          "designPreferences.budget.target",
        ], null)
      ),
    budgetSensitivity:
      normaliseId(
        getNested(input, [
          "budgetSensitivity",
          "preferences.budgetSensitivity",
          "designPreferences.budget.sensitivity",
        ], "medium"),
        "medium"
      ),
  };
}

function buildShadeConstraints(input = {}) {
  return {
    shadeTolerance:
      normaliseId(
        getNested(input, [
          "shadeTolerance",
          "preferences.shadeTolerance",
          "designPreferences.shade.tolerance",
        ], "standard"),
        "standard"
      ),
    optimiserFriendlyPreferred:
      booleanOrNull(
        getNested(input, [
          "optimiserFriendlyPreferred",
          "preferences.optimiserFriendlyPreferred",
          "designPreferences.shade.optimiserFriendlyPreferred",
        ], null)
      ),
    microinverterAllowed:
      booleanOrNull(
        getNested(input, [
          "microinverterAllowed",
          "preferences.microinverterAllowed",
          "designPreferences.shade.microinverterAllowed",
        ], null)
      ),
  };
}

function buildHardConstraints(input = {}) {
  const panel = buildPanelConstraints(input);
  const inverter = buildInverterConstraints(input);
  const battery = buildBatteryConstraints(input);
  const budget = buildBudgetConstraints(input);
  const shade = buildShadeConstraints(input);

  const constraints = [];

  if (panel.requireAllBlack === true) {
    constraints.push({
      constraintId: "panel_all_black_required",
      component: "panel",
      constraintType: "aesthetic",
      operator: "equals",
      value: true,
      reason: "Customer requires all-black panels.",
    });
  }

  if (panel.minWarrantyYears !== null) {
    constraints.push({
      constraintId: "panel_min_warranty",
      component: "panel",
      constraintType: "warranty",
      operator: ">=",
      value: panel.minWarrantyYears,
      reason: "Customer has a minimum panel warranty requirement.",
    });
  }

  if (inverter.backupRequired === true) {
    constraints.push({
      constraintId: "backup_capability_required",
      component: "inverter",
      constraintType: "backup",
      operator: "equals",
      value: true,
      reason: "Customer requires backup capability.",
    });
  }

  if (inverter.hybridRequired === true) {
    constraints.push({
      constraintId: "hybrid_inverter_required",
      component: "inverter",
      constraintType: "hybrid",
      operator: "equals",
      value: true,
      reason: "Customer requires a hybrid inverter pathway.",
    });
  }

  if (inverter.minWarrantyYears !== null) {
    constraints.push({
      constraintId: "inverter_min_warranty",
      component: "inverter",
      constraintType: "warranty",
      operator: ">=",
      value: inverter.minWarrantyYears,
      reason: "Customer has a minimum inverter warranty requirement.",
    });
  }

  if (battery.batteryRequired === true) {
    constraints.push({
      constraintId: "battery_required",
      component: "battery",
      constraintType: "required",
      operator: "equals",
      value: true,
      reason: "Customer requires a battery.",
    });
  }

  if (battery.minUsableKWh !== null) {
    constraints.push({
      constraintId: "battery_min_usable_capacity",
      component: "battery",
      constraintType: "usable_capacity",
      operator: ">=",
      value: battery.minUsableKWh,
      reason: "Customer has a minimum battery capacity requirement.",
    });
  }

  if (budget.maxBudget !== null) {
    constraints.push({
      constraintId: "maximum_budget",
      component: "system",
      constraintType: "budget",
      operator: "<=",
      value: budget.maxBudget,
      reason: "Customer has a maximum budget.",
    });
  }

  return {
    panel,
    inverter,
    battery,
    budget,
    shade,
    constraints,
  };
}

function buildSoftPreferences(input = {}, systemType = "balanced") {
  const weights = buildPriorityWeights(input, systemType);

  return {
    systemType,
    weights,

    rankedPriorities: Object.entries(weights)
      .sort((a, b) => b[1] - a[1])
      .map(([priorityId, weight], index) => ({
        priorityId,
        weight,
        rank: index + 1,
      })),

    preferenceSignals: {
      panelAesthetic:
        buildPanelConstraints(input).preferredAesthetic,
      inverterSmartness:
        buildInverterConstraints(input).smartness,
      budgetSensitivity:
        buildBudgetConstraints(input).budgetSensitivity,
      shadeTolerance:
        buildShadeConstraints(input).shadeTolerance,
    },
  };
}

function buildDesignPreferenceProfile({ input = {}, quote = {} } = {}) {
  const systemType = inferSystemType(input);

  const hardConstraints = buildHardConstraints(input);
  const softPreferences = buildSoftPreferences(input, systemType);

  const explicitPreferenceFields = [
    "preferences",
    "designPreferences",
    "preferenceWeights",
    "systemType",
    "panelAesthetic",
    "requireAllBlackPanels",
    "blackPanelsOnly",
    "backupRequired",
    "batteryRequired",
    "maxBudget",
  ].filter((key) => input && input[key] !== undefined);

  return {
    version: DESIGN_PREFERENCE_PROFILE_VERSION,
    mode: "design_preference_profile_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    source: {
      systemTypeSource: input?.systemType ? "input.systemType" : "default_balanced",
      explicitPreferenceFields,
      hasExplicitPreferences: explicitPreferenceFields.length > 0,
    },

    selectedSystemType: systemType,

    hardConstraints,
    softPreferences,

    designIntent: {
      primaryOptimisationGoal:
        softPreferences.rankedPriorities[0]?.priorityId || "balanced",
      secondaryOptimisationGoal:
        softPreferences.rankedPriorities[1]?.priorityId || null,
      quoteSystemSizeKwp:
        numberOrNull(quote?.systemSizeKwp),
      existingBatteryKWh:
        numberOrNull(input?.batteryKWh ?? quote?.hourlyModel?._batteryKWh),
    },

    readiness:
      hardConstraints.constraints.length > 0
        ? "profile_ready_with_hard_constraints"
        : "profile_ready_default_preferences",

    assumptions: {
      note:
        "This preference profile is diagnostic only. It records hard constraints and soft design priorities but does not yet filter or rank hardware.",
    },

    limitations: [
      "The profile does not yet filter panels, inverters or batteries.",
      "The profile does not yet alter candidate ranking.",
      "The profile does not yet change quote calculations, pricing or customer-facing recommendations.",
      "Future phases will apply these hard constraints and soft preferences to candidate pruning and scoring.",
    ],
  };
}

module.exports = {
  DESIGN_PREFERENCE_PROFILE_VERSION,
  buildDesignPreferenceProfile,
  buildPriorityWeights,
  buildHardConstraints,
  buildSoftPreferences,
};