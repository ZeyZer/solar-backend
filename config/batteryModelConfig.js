const { CONFIG } = require("./quoteConfig");

const DEFAULT_BATTERY_MODEL_ASSUMPTIONS = {
  batteryCostPerKWh: 280,

  roundTripEfficiency: 0.90,

  smallBatteryThresholdKWh: 8,
  smallBatteryMaxChargeKW: 3.7,
  smallBatteryMaxDischargeKW: 3.7,
  largeBatteryMaxChargeKW: 5,
  largeBatteryMaxDischargeKW: 6,

  gridChargeTargetPct: 80,

  degradationRate: 0.02,
  minCapacityFraction: 0.70,

  recommendationMinBatteryKWh: 2,
  recommendationMaxBatteryKWh: 35,
  recommendationStepKWh: 1,
};

function numberOrDefault(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getBatteryModelAssumptions(overrides = {}) {
  const model = CONFIG.batteryModel || {};

  const merged = {
    ...DEFAULT_BATTERY_MODEL_ASSUMPTIONS,
    ...model,
    ...overrides,
  };

  return {
    batteryCostPerKWh: numberOrDefault(
      merged.batteryCostPerKWh ?? CONFIG.batteryCostPerKwh,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.batteryCostPerKWh
    ),

    roundTripEfficiency: numberOrDefault(
      merged.roundTripEfficiency,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.roundTripEfficiency
    ),

    smallBatteryThresholdKWh: numberOrDefault(
      merged.smallBatteryThresholdKWh,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.smallBatteryThresholdKWh
    ),

    smallBatteryMaxChargeKW: numberOrDefault(
      merged.smallBatteryMaxChargeKW,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.smallBatteryMaxChargeKW
    ),

    smallBatteryMaxDischargeKW: numberOrDefault(
      merged.smallBatteryMaxDischargeKW,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.smallBatteryMaxDischargeKW
    ),

    largeBatteryMaxChargeKW: numberOrDefault(
      merged.largeBatteryMaxChargeKW,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.largeBatteryMaxChargeKW
    ),

    largeBatteryMaxDischargeKW: numberOrDefault(
      merged.largeBatteryMaxDischargeKW,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.largeBatteryMaxDischargeKW
    ),

    gridChargeTargetPct: numberOrDefault(
      merged.gridChargeTargetPct,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.gridChargeTargetPct
    ),

    degradationRate: numberOrDefault(
      merged.degradationRate,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.degradationRate
    ),

    minCapacityFraction: numberOrDefault(
      merged.minCapacityFraction,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.minCapacityFraction
    ),

    recommendationMinBatteryKWh: numberOrDefault(
      merged.recommendationMinBatteryKWh,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.recommendationMinBatteryKWh
    ),

    recommendationMaxBatteryKWh: numberOrDefault(
      merged.recommendationMaxBatteryKWh,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.recommendationMaxBatteryKWh
    ),

    recommendationStepKWh: numberOrDefault(
      merged.recommendationStepKWh,
      DEFAULT_BATTERY_MODEL_ASSUMPTIONS.recommendationStepKWh
    ),
  };
}

module.exports = {
  DEFAULT_BATTERY_MODEL_ASSUMPTIONS,
  getBatteryModelAssumptions,
};