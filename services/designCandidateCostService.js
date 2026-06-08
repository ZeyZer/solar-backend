const { CONFIG } = require("../config/quoteConfig");

const DESIGN_CANDIDATE_COST_VERSION = "2026-beta-1";

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function getProductMaterialCost(product) {
  return numberOrZero(product?.pricing?.materialCost);
}

function getProductInstalledAdder(product) {
  return numberOrZero(product?.pricing?.estimatedInstalledAdder);
}

function getActiveArrays(roofs = []) {
  return (Array.isArray(roofs) ? roofs : []).filter(
    (roof) => Number(roof.panels || 0) > 0
  );
}

function getArrayCount({ arrays = [], roofs = [] } = {}) {
  if (Array.isArray(arrays) && arrays.length > 0) return arrays.length;
  return getActiveArrays(roofs).length;
}

function getScaffoldingCost({ arrayCount = 1 } = {}) {
  const firstRoof = numberOrZero(CONFIG?.scaffolding?.firstRoof || 600);
  const additionalRoof = numberOrZero(CONFIG?.scaffolding?.additionalRoof || 400);

  if (arrayCount <= 0) return 0;

  return firstRoof + Math.max(0, arrayCount - 1) * additionalRoof;
}

function getMountingCost({ totalPanels = 0, arrayCount = 1 } = {}) {
  const panelCount = numberOrZero(totalPanels);

  // Beta allowance. Later this should be replaced by mounting product data.
  const perPanelMounting = 55;
  const perArrayAllowance = 75;

  return panelCount * perPanelMounting + Math.max(0, arrayCount) * perArrayAllowance;
}

function getElectricalBosCost({
  hasBattery = false,
  inverter = null,
  arrayCount = 1,
} = {}) {
  // BOS = balance of system: isolators, small electrical materials, labels,
  // protection, comms allowance, monitoring setup allowance, etc.
  const base = 450;
  const perArray = 75;
  const batteryAdder = hasBattery ? 250 : 0;

  const hybridAdder =
    String(inverter?.inverterType || "").toLowerCase() === "hybrid" ? 100 : 0;

  return base + Math.max(0, arrayCount - 1) * perArray + batteryAdder + hybridAdder;
}

function getLabourCost({
  totalPanels = 0,
  arrayCount = 1,
  hasBattery = false,
  inverter = null,
} = {}) {
  const panelCount = numberOrZero(totalPanels);

  // Beta labour model. Later this should be replaced by a proper install
  // complexity model using roof type, access, mounting system, cable run, etc.
  const base = 900;
  const perPanel = 55;
  const perExtraArray = 175;
  const batteryAdder = hasBattery ? 350 : 0;

  const hybridAdder =
    String(inverter?.inverterType || "").toLowerCase() === "hybrid" ? 125 : 0;

  return (
    base +
    panelCount * perPanel +
    Math.max(0, arrayCount - 1) * perExtraArray +
    batteryAdder +
    hybridAdder
  );
}

function getComplexityMultiplier({
  arrayCount = 1,
  hasBattery = false,
  hasWarnings = false,
} = {}) {
  let multiplier = 1;

  if (arrayCount > 1) multiplier += 0.04 * Math.min(arrayCount - 1, 4);
  if (hasBattery) multiplier += 0.04;
  if (hasWarnings) multiplier += 0.03;

  return round2(multiplier);
}

function getCostConfidence({ products = {}, candidate = null } = {}) {
  const items = [products.panel, products.inverter, products.battery].filter(Boolean);

  if (!items.length) {
    return {
      level: "low",
      reason: "No product cost data available.",
    };
  }

  const placeholderCount = items.filter((item) => item.isPlaceholder).length;
  const missingPricingCount = items.filter((item) => !item.pricing).length;

  if (placeholderCount > 0 || missingPricingCount > 0) {
    return {
      level: "low",
      reason:
        "One or more products use placeholder catalogue data or incomplete pricing.",
    };
  }

  const rejected = candidate?.filtering?.status === "rejected";

  if (rejected) {
    return {
      level: "low",
      reason: "Candidate is currently rejected by compatibility filtering.",
    };
  }

  return {
    level: "medium",
    reason:
      "Catalogue pricing exists, but supplier live costs, labour details and site conditions are not yet connected.",
  };
}

function buildDesignCandidateCostModel({
  candidate = null,
  panel = null,
  inverter = null,
  battery = null,
  arrays = [],
  roofs = [],
  totalPanels = 0,
} = {}) {
  const arrayCount = getArrayCount({ arrays, roofs });
  const hasBattery = !!battery;

  const compatibilitySummary = candidate?.compatibility?.summary || {};
  const hasWarnings =
    numberOrZero(compatibilitySummary.warn) > 0 ||
    Array.isArray(candidate?.compatibility?.optimisationFlags) &&
      candidate.compatibility.optimisationFlags.length > 0;

  const panelMaterial = getProductMaterialCost(panel) * numberOrZero(totalPanels);
  const inverterMaterial = getProductMaterialCost(inverter);
  const batteryMaterial = hasBattery ? getProductMaterialCost(battery) : 0;

  const panelInstalledAdder = getProductInstalledAdder(panel) * numberOrZero(totalPanels);
  const inverterInstalledAdder = getProductInstalledAdder(inverter);
  const batteryInstalledAdder = hasBattery ? getProductInstalledAdder(battery) : 0;

  const mounting = getMountingCost({ totalPanels, arrayCount });
  const scaffolding = getScaffoldingCost({ arrayCount });
  const electricalBos = getElectricalBosCost({
    hasBattery,
    inverter,
    arrayCount,
  });

  const labourBase = getLabourCost({
    totalPanels,
    arrayCount,
    hasBattery,
    inverter,
  });

  const complexityMultiplier = getComplexityMultiplier({
    arrayCount,
    hasBattery,
    hasWarnings,
  });

  const labourAdjusted = labourBase * complexityMultiplier;

  const directCostBeforeOverhead =
    panelMaterial +
    inverterMaterial +
    batteryMaterial +
    mounting +
    scaffolding +
    electricalBos +
    labourAdjusted;

  // Beta allowance for overhead/margin. Not customer-facing yet.
  const overheadAndMarginRate = 0.18;
  const overheadAndMargin = directCostBeforeOverhead * overheadAndMarginRate;

  const estimatedInstalledCost =
    directCostBeforeOverhead + overheadAndMargin;

  const priceRangeFactor = numberOrZero(CONFIG.priceRangeFactor || 0.1);

  const low = estimatedInstalledCost * (1 - priceRangeFactor);
  const high = estimatedInstalledCost * (1 + priceRangeFactor);

  return {
    version: DESIGN_CANDIDATE_COST_VERSION,
    mode: "candidate_cost_model_beta",
    currency: "GBP",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    // Backward-compatible name used by candidate sorting.
    estimatedHardwareAdder: roundMoney(estimatedInstalledCost),

    estimatedInstalledCost: roundMoney(estimatedInstalledCost),

    estimatedInstalledCostRange: {
      low: roundMoney(low),
      high: roundMoney(high),
      rangeFactor: priceRangeFactor,
    },

    breakdown: {
      products: {
        panels: roundMoney(panelMaterial),
        inverter: roundMoney(inverterMaterial),
        battery: roundMoney(batteryMaterial),
      },

      installedAddersReference: {
        panels: roundMoney(panelInstalledAdder),
        inverter: roundMoney(inverterInstalledAdder),
        battery: roundMoney(batteryInstalledAdder),
        note:
          "Installed adders are retained as catalogue reference values. The candidate cost model uses its own beta breakdown.",
      },

      installation: {
        mounting: roundMoney(mounting),
        scaffolding: roundMoney(scaffolding),
        electricalBos: roundMoney(electricalBos),
        labourBase: roundMoney(labourBase),
        labourAdjusted: roundMoney(labourAdjusted),
        complexityMultiplier,
      },

      overheadAndMargin: {
        rate: overheadAndMarginRate,
        amount: roundMoney(overheadAndMargin),
      },

      total: roundMoney(estimatedInstalledCost),
    },

    inputs: {
      totalPanels: numberOrZero(totalPanels),
      arrayCount,
      hasBattery,
      panelProductId: panel?.id || null,
      inverterProductId: inverter?.id || null,
      batteryProductId: battery?.id || null,
    },

    confidence: getCostConfidence({
      products: { panel, inverter, battery },
      candidate,
    }),

    limitations: [
      "This is a candidate-level beta cost model only.",
      "It is not customer-facing pricing.",
      "It does not yet use live supplier costs.",
      "It does not yet model roof covering, mounting system choice, cable routes, consumer unit works, DNO/export equipment, travel, waste, access equipment or site-specific labour.",
      "It does not yet replace the existing quote price calculation.",
    ],
  };
}

module.exports = {
  DESIGN_CANDIDATE_COST_VERSION,
  buildDesignCandidateCostModel,
};