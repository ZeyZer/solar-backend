const {
  normalizeTariff,
  isRetailRateTariff,
} = require("./tariffService");

const CANDIDATE_BATTERY_CONTROL_STRATEGY_VERSION = "2026-beta-1";

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function getBatteryKWh({ battery = null, input = {}, quote = {}, batteryKWh = null } = {}) {
  const hasExplicitBatteryKWh =
    batteryKWh !== null &&
    batteryKWh !== undefined &&
    batteryKWh !== "";

  if (hasExplicitBatteryKWh) {
    const explicit = Number(batteryKWh);
    if (Number.isFinite(explicit)) {
      return Math.max(0, explicit);
    }
  }

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

function getTariffType(tariff = {}) {
  return String(tariff?.tariffType || "standard").trim().toLowerCase();
}

function isOvernightLikeTariff(tariffType = "") {
  return [
    "overnight",
    "ev",
    "ev_overnight",
    "economy7",
    "economy_7",
    "time_of_use",
    "tou",
  ].includes(String(tariffType || "").toLowerCase());
}

function isFluxLikeTariff(tariffType = "") {
  return [
    "flux",
    "intelligent_flux",
    "smart_export",
    "import_export",
    "agile",
  ].includes(String(tariffType || "").toLowerCase());
}

function getExplicitControlOverride(input = {}) {
  return (
    input.candidateBatteryControlStrategy ||
    input.batteryControlStrategy ||
    input.batteryControl ||
    null
  );
}

function overrideBoolean(override = null, key, fallback) {
  if (override && typeof override[key] === "boolean") {
    return override[key];
  }

  return fallback;
}

function resolveCandidateBatteryControlStrategy({
  tariffAfter = null,
  input = null,
  quote = null,
  battery = null,
  batteryKWh = null,
} = {}) {
  const safeInput = input || {};
  const safeQuote = quote || {};

  const rawTariff =
    tariffAfter ||
    safeInput.tariffAfter ||
    safeInput.tariff ||
    safeQuote.tariffAfter ||
    safeQuote.tariff ||
    {};

  const normalizedTariff = normalizeTariff(rawTariff, "after");
  const tariffType = getTariffType(normalizedTariff);
  const retailRateMode = isRetailRateTariff(normalizedTariff);

  const usableBatteryKWh = getBatteryKWh({
    battery,
    input: safeInput,
    quote: safeQuote,
    batteryKWh,
  });

  const hasBattery = usableBatteryKWh > 0;
  const override = getExplicitControlOverride(safeInput);

  let strategyId = "self_consumption";
  let label = "Self-consumption";
  let dispatchMode = "self_consumption";
  let allowGridCharge = false;
  let allowEnergyTrading = false;
  let exportFromBatteryEnabled = false;
  let reason =
    "Flat-rate or standard tariff: maximise solar self-consumption and avoid unnecessary grid charging.";

  if (!hasBattery) {
    strategyId = "no_battery";
    label = "No battery";
    dispatchMode = "self_consumption";
    allowGridCharge = false;
    allowEnergyTrading = false;
    exportFromBatteryEnabled = false;
    reason = "No battery selected, so battery control settings are not applicable.";
  } else if (isFluxLikeTariff(tariffType)) {
    strategyId = "smart_import_export";
    label = "Smart import/export";
    dispatchMode = "retail_rate";
    allowGridCharge = true;
    allowEnergyTrading = true;
    exportFromBatteryEnabled = true;
    reason =
      "Flux-style tariff: test grid charging and export-capable battery control where import/export spreads may make this beneficial.";
  } else if (isOvernightLikeTariff(tariffType) || retailRateMode) {
    strategyId = "timed_grid_charge";
    label = "Timed grid charging";
    dispatchMode = "retail_rate";
    allowGridCharge = true;
    allowEnergyTrading = false;
    exportFromBatteryEnabled = false;
    reason =
      "Time-of-use tariff: charge the battery from cheaper off-peak electricity where useful, then discharge into household load.";
  }

  allowGridCharge = overrideBoolean(
    override,
    "allowGridCharge",
    overrideBoolean(override, "allowGridCharging", allowGridCharge)
  );

  allowEnergyTrading = overrideBoolean(
    override,
    "allowEnergyTrading",
    allowEnergyTrading
  );

  exportFromBatteryEnabled = overrideBoolean(
    override,
    "exportFromBatteryEnabled",
    exportFromBatteryEnabled
  );

  if (override?.strategyId) {
    strategyId = String(override.strategyId);
  }

  if (override?.label) {
    label = String(override.label);
  }

  return {
    version: CANDIDATE_BATTERY_CONTROL_STRATEGY_VERSION,
    mode: "selected_tariff_resolved_battery_control_strategy",

    source: override
      ? "explicit_battery_control_override"
      : "selected_tariff_recommended_default",

    strategyId,
    label,
    reason,

    tariff: {
      normalized: normalizedTariff,
      tariffType,
      retailRateMode,
    },

    battery: {
      hasBattery,
      batteryProductId: battery?.id || null,
      usableCapacityKWh: round2(usableBatteryKWh),
    },

    dispatch: {
      dispatchMode,
      allowGridCharge,
      allowGridCharging: allowGridCharge,
      allowEnergyTrading,
      exportFromBatteryEnabled,
    },

    futureScenarioReady: true,

    limitations: [
      "This resolves one sensible battery control strategy for the currently selected tariff.",
      "It does not yet test every available tariff or every possible battery control strategy.",
      "Future scenario optimisation will generate multiple tariff/control combinations per shortlisted candidate.",
    ],
  };
}

function summarizeCandidateBatteryControlStrategy(strategy = {}) {
  return {
    version: strategy.version || CANDIDATE_BATTERY_CONTROL_STRATEGY_VERSION,
    mode: strategy.mode || null,
    source: strategy.source || null,

    strategyId: strategy.strategyId || null,
    label: strategy.label || null,
    reason: strategy.reason || null,

    tariffType: strategy?.tariff?.tariffType || null,
    retailRateMode: !!strategy?.tariff?.retailRateMode,

    battery: strategy.battery || null,
    dispatch: strategy.dispatch || null,

    futureScenarioReady: strategy.futureScenarioReady === true,
    limitations: strategy.limitations || [],
  };
}

module.exports = {
  CANDIDATE_BATTERY_CONTROL_STRATEGY_VERSION,
  resolveCandidateBatteryControlStrategy,
  summarizeCandidateBatteryControlStrategy,
};