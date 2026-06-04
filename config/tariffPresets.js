const { CONFIG } = require("./quoteConfig");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const DEFAULT_TARIFF_PRESETS = {
  standard: {
    tariffType: "standard",

    importPrice: Number(CONFIG.assumedPricePerKWh || 0.28),
    segPrice: Number(CONFIG.assumedSegPricePerKWh || 0.12),
    standingChargePerDay: Number(CONFIG.standingChargePerDay || 0.60),

    importNight: 0.08,
    importDay: 0.20,
    nightStartHour: 0,
    nightEndHour: 7,

    importOffPeak: 0.15,
    importPeak: 0.40,
    exportOffPeak: 0.08,
    exportPeak: 0.30,
    offPeakStartHour: 0,
    offPeakEndHour: 6,
    peakStartHour: 16,
    peakEndHour: 19,

    exportFromBatteryEnabled: true,
    allowGridCharging: false,
    allowEnergyTrading: false,
  },

  overnight: {
    tariffType: "overnight",

    importPrice: Number(CONFIG.assumedPricePerKWh || 0.28),
    segPrice: Number(CONFIG.assumedSegPricePerKWh || 0.12),
    standingChargePerDay: Number(CONFIG.standingChargePerDay || 0.60),

    importNight: 0.08,
    importDay: 0.20,
    nightStartHour: 0,
    nightEndHour: 7,

    importOffPeak: 0.15,
    importPeak: 0.40,
    exportOffPeak: 0.08,
    exportPeak: 0.30,
    offPeakStartHour: 0,
    offPeakEndHour: 6,
    peakStartHour: 16,
    peakEndHour: 19,

    exportFromBatteryEnabled: true,
    allowGridCharging: true,
    allowEnergyTrading: false,
  },

  flux: {
    tariffType: "flux",

    importPrice: Number(CONFIG.assumedPricePerKWh || 0.28),
    segPrice: Number(CONFIG.assumedSegPricePerKWh || 0.12),
    standingChargePerDay: Number(CONFIG.standingChargePerDay || 0.60),

    importNight: 0.08,
    importDay: 0.20,
    nightStartHour: 0,
    nightEndHour: 7,

    importOffPeak: 0.15,
    importPeak: 0.40,
    exportOffPeak: 0.08,
    exportPeak: 0.30,
    offPeakStartHour: 0,
    offPeakEndHour: 6,
    peakStartHour: 16,
    peakEndHour: 19,

    exportFromBatteryEnabled: true,
    allowGridCharging: true,
    allowEnergyTrading: false,
  },
};

const TARIFF_MODEL_ASSUMPTIONS = {
  model: "hourly-tou-v1",
  timeResolution: "hourly",
  supportsHalfHourly: false,
  defaultTariffType: "standard",
  availableTariffTypes: ["standard", "overnight", "flux"],
  note:
    "Current beta tariff model uses hourly tariff windows. Half-hour tariff windows are not implemented yet.",
};

function normaliseTariffType(tariffType) {
  const type = String(tariffType || "standard").toLowerCase();

  if (DEFAULT_TARIFF_PRESETS[type]) {
    return type;
  }

  return "standard";
}

function getTariffPreset(tariffType = "standard") {
  const type = normaliseTariffType(tariffType);
  return clone(DEFAULT_TARIFF_PRESETS[type]);
}

function getDefaultTariff(kind = "after") {
  const tariff = getTariffPreset("standard");

  // Keep this simple for now. Before-solar billing only uses import rates
  // and standing charge, but leaving the full object present avoids breaking
  // older frontend/backend assumptions.
  tariff.kind = kind;

  return tariff;
}

function getTariffModelAssumptions() {
  return {
    ...clone(TARIFF_MODEL_ASSUMPTIONS),
    presets: clone(DEFAULT_TARIFF_PRESETS),
  };
}

module.exports = {
  DEFAULT_TARIFF_PRESETS,
  TARIFF_MODEL_ASSUMPTIONS,
  getTariffPreset,
  getDefaultTariff,
  getTariffModelAssumptions,
};