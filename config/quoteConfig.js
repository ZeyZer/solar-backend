// ====== QUOTE CONFIG ======
const CONFIG = {
  baseCostPerKwp: 800,
  batteryCostPerKwh: 280,
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