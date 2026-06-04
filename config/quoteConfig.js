// ====== QUOTE CONFIG ======
const CONFIG = {
  baseCostPerKwp: 800,

  // Keep this top-level alias for existing pricing code.
  batteryCostPerKwh: 280,

  // Centralised abstract battery model assumptions.
  // These are NOT product-specific yet. They will later be replaced or extended
  // by a real hardware database.
  batteryModel: {
    batteryCostPerKWh: 280,

    // Hourly dispatch model
    roundTripEfficiency: 0.90,

    // Abstract inverter/battery power assumptions
    smallBatteryThresholdKWh: 8,
    smallBatteryMaxChargeKW: 3.7,
    smallBatteryMaxDischargeKW: 3.7,
    largeBatteryMaxChargeKW: 5,
    largeBatteryMaxDischargeKW: 6,

    // Retail tariff / grid-charge planning
    gridChargeTargetPct: 80,

    // Lifetime modelling
    degradationRate: 0.02,
    minCapacityFraction: 0.70,

    // Recommendation search range
    recommendationMinBatteryKWh: 2,
    recommendationMaxBatteryKWh: 35,
    recommendationStepKWh: 1,
  },

  scaffolding: {
    firstRoof: 600,
    additionalRoof: 400,
  },
  priceRangeFactor: 0.10,
  assumedPricePerKWh: 0.28,
  assumedSegPricePerKWh: 0.12,

  standingChargePerDay: 0.60,
  energyInflationRate: 0.06,

  irradianceFactor: 0.85,
  roofKwpCaps: {
    small: 2.5,
    medium: 4.0,
    large: 6.5,
  },
  panelOptions: {
    value: { watt: 430, multiplier: 1.0 },
    premium: { watt: 460, multiplier: 1.1 },
  },
  regionalMultipliers: {
    default: 1.0,
    london: 1.1,
    scotland: 0.95,
  },
};

module.exports = {
  CONFIG,
};