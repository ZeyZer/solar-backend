const {
  findClosestBatteryByUsableKWh,
} = require("./hardwareCatalogService");

function round1(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function roundMoney(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

function sanitizeBatteryProduct(product, requestedUsableKWh) {
  if (!product) return null;

  const requested = Number(requestedUsableKWh || 0);
  const matchedUsable = Number(product.usableCapacityKWh || 0);

  return {
    id: product.id,
    brand: product.brand,
    model: product.model,
    category: product.category,
    batteryType: product.batteryType,

    nominalCapacityKWh: Number(product.nominalCapacityKWh || 0),
    usableCapacityKWh: matchedUsable,

    maxChargeKW: Number(product.maxChargeKW || 0),
    maxDischargeKW: Number(product.maxDischargeKW || 0),
    roundTripEfficiency: Number(product.roundTripEfficiency || 0),

    warrantyYears: Number(product.warrantyYears || 0),
    degradationRatePerYear: Number(product.degradationRatePerYear || 0),
    minCapacityFraction: Number(product.minCapacityFraction || 0),

    compatibleInverterTypes: Array.isArray(product.compatibleInverterTypes)
      ? product.compatibleInverterTypes
      : [],

    pricing: product.pricing
      ? {
          currency: product.pricing.currency || "GBP",
          materialCost: roundMoney(product.pricing.materialCost),
          estimatedInstalledAdder: roundMoney(product.pricing.estimatedInstalledAdder),
          notes: product.pricing.notes || "",
        }
      : null,

    isPlaceholder: !!product.isPlaceholder,
    notes: product.notes || "",

    mapping: {
      requestedUsableKWh: round1(requested),
      matchedUsableKWh: round1(matchedUsable),
      differenceKWh: round1(matchedUsable - requested),
      method: "closest_active_usable_kwh",
      usedForCalculation: false,
      usedForDisplayOnly: true,
    },
  };
}

function getCandidateBatteryKWh(candidate) {
  if (!candidate || typeof candidate !== "object") return 0;

  const requested =
    candidate.requestedBatteryKWhUsable ??
    candidate.batteryKWhUsable ??
    candidate.batteryKWh ??
    0;

  const value = Number(requested);

  return Number.isFinite(value) ? value : 0;
}

function attachBatteryProductToCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return candidate;
  }

  const batteryKWh = getCandidateBatteryKWh(candidate);

  if (batteryKWh <= 0) {
    return {
      ...candidate,
      batteryProduct: null,
      batteryProductMapping: {
        requestedUsableKWh: round1(batteryKWh),
        method: "no_battery",
        usedForCalculation: false,
        usedForDisplayOnly: true,
      },
    };
  }

  const closestProduct = findClosestBatteryByUsableKWh(batteryKWh);

  return {
    ...candidate,
    batteryProduct: sanitizeBatteryProduct(closestProduct, batteryKWh),
  };
}

function attachNoBatteryComparisonProducts(noBatteryComparison) {
  if (!noBatteryComparison || typeof noBatteryComparison !== "object") {
    return noBatteryComparison;
  }

  return {
    ...noBatteryComparison,

    noBattery: {
      ...(noBatteryComparison.noBattery || {}),
      batteryProduct: null,
      batteryProductMapping: {
        method: "no_battery",
        usedForCalculation: false,
        usedForDisplayOnly: true,
      },
    },

    selectedBattery: attachBatteryProductToCandidate(
      noBatteryComparison.selectedBattery
    ),
  };
}

function attachBatteryProductsToRecommendations(batteryRecommendations) {
  if (!batteryRecommendations || typeof batteryRecommendations !== "object") {
    return batteryRecommendations;
  }

  return {
    ...batteryRecommendations,

    bestPayback: attachBatteryProductToCandidate(
      batteryRecommendations.bestPayback
    ),

    bestLifetimeSavings: attachBatteryProductToCandidate(
      batteryRecommendations.bestLifetimeSavings
    ),

    noBatteryComparison: attachNoBatteryComparisonProducts(
      batteryRecommendations.noBatteryComparison
    ),

    assumptions: {
      ...(batteryRecommendations.assumptions || {}),
      hardwareProductMapping: {
        enabled: true,
        method: "closest_active_usable_kwh",
        usedForCalculation: false,
        usedForDisplayOnly: true,
        note:
          "Battery catalogue products are attached for display/metadata only. Current calculations still use the abstract beta battery model.",
      },
    },
  };
}

module.exports = {
  sanitizeBatteryProduct,
  attachBatteryProductToCandidate,
  attachBatteryProductsToRecommendations,
};