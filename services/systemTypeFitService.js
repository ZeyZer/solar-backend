const {
  findPanelById,
  findInverterById,
  findBatteryById,
} = require("./hardwareCatalogService");

const {
  getSystemTypeProfile,
  listSystemTypeProfiles,
  SYSTEM_TYPE_PROFILES_VERSION,
} = require("../config/systemTypeProfiles");

const SYSTEM_TYPE_FIT_VERSION = "2026-beta-1";

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function average(values = []) {
  const usable = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!usable.length) return 0;

  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function getFullProducts(candidate) {
  const panelId = candidate?.products?.panel?.id;
  const inverterId = candidate?.products?.inverter?.id;
  const batteryId = candidate?.products?.battery?.id;

  return {
    panel: panelId ? findPanelById(panelId) : null,
    inverter: inverterId ? findInverterById(inverterId) : null,
    battery: batteryId ? findBatteryById(batteryId) : null,
  };
}

function getCapabilities(product) {
  return product?.capabilities && typeof product.capabilities === "object"
    ? product.capabilities
    : {};
}

function getCostScore(candidate) {
  const cost = numberOrZero(candidate?.costModel?.estimatedHardwareAdder);

  if (cost <= 0) return 50;

  // Diagnostic only. This will later be replaced by real product cost benchmarking.
  return clamp(100 - cost / 150);
}

function getCompatibilityScore(candidate) {
  const filteringStatus = candidate?.filtering?.status;
  const summary = candidate?.compatibility?.summary || {};

  if (filteringStatus === "rejected") return 0;

  const fail = numberOrZero(summary.fail);
  const warn = numberOrZero(summary.warn);
  const pass = numberOrZero(summary.pass);

  return clamp(70 + pass * 2 - warn * 8 - fail * 30);
}

function getWarrantyScore(candidate) {
  const { panel, inverter, battery } = getFullProducts(candidate);

  const panelProductWarranty = numberOrZero(panel?.warranty?.productWarrantyYears);
  const panelPerformanceWarranty = numberOrZero(panel?.warranty?.performanceWarrantyYears);
  const inverterWarranty = numberOrZero(inverter?.warrantyYears);
  const batteryWarranty = battery ? numberOrZero(battery?.warrantyYears) : 0;

  const values = [
    panelProductWarranty,
    panelPerformanceWarranty,
    inverterWarranty,
    battery ? batteryWarranty : null,
  ].filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);

  if (!values.length) return 45;

  const weakest = Math.min(...values);
  const avg = average(values);

  return clamp(weakest * 4 + avg);
}

function getOptimisationScore(candidate) {
  const { inverter, battery } = getFullProducts(candidate);
  const inverterCaps = getCapabilities(inverter);
  const batteryCaps = getCapabilities(battery);

  const flags = Array.isArray(candidate?.compatibility?.optimisationFlags)
    ? candidate.compatibility.optimisationFlags
    : [];

  const mpptCount = numberOrZero(candidate?.stringPlan?.mpptCount);

  let score = 25;

  score += Math.min(mpptCount * 10, 30);

  score += average([
    inverterCaps.softwareOptimisationScore,
    inverterCaps.ecosystemScore,
    inverterCaps.smartTariffControlScore,
    batteryCaps.tariffControlSupportScore,
    batteryCaps.powerCapabilityScore,
  ]) * 0.45;

  if (inverterCaps.supportsOptimisers === true) score += 8;
  if (inverterCaps.supportsMicroinverters === true) score += 10;

  // If the roof has optimisation flags, optimisation capability becomes more important.
  if (flags.length > 0) score += 8;

  return clamp(score);
}

function getBackupScore(candidate) {
  const { inverter, battery } = getFullProducts(candidate);
  const inverterCaps = getCapabilities(inverter);
  const batteryCaps = getCapabilities(battery);

  let score = 10;

  score += numberOrZero(inverterCaps.backupCapabilityScore) * 0.6;
  score += numberOrZero(batteryCaps.backupSupportScore) * 0.25;

  if (inverterCaps.supportsWholeHomeBackup === true) score += 12;
  if (inverterCaps.supportsEssentialLoadBackup === true) score += 8;
  if (battery) score += 8;

  return clamp(score);
}

function getMonitoringScore(candidate) {
  const { inverter, battery, panel } = getFullProducts(candidate);

  const inverterCaps = getCapabilities(inverter);
  const batteryCaps = getCapabilities(battery);
  const panelCaps = getCapabilities(panel);

  let score = 25;

  score += average([
    inverterCaps.monitoringQualityScore,
    batteryCaps.monitoringQualityScore,
    panelCaps.monitoringVisibilityScore,
  ]) * 0.65;

  if (inverterCaps.monitoringLevel === "enhanced") score += 8;

  return clamp(score);
}

function getExportControlScore(candidate) {
  const { inverter, battery } = getFullProducts(candidate);

  const inverterCaps = getCapabilities(inverter);
  const batteryCaps = getCapabilities(battery);

  let score = 25;

  score += average([
    inverterCaps.exportControlScore,
    inverterCaps.g100Score,
    inverterCaps.smartTariffControlScore,
    batteryCaps.tariffControlSupportScore,
  ]) * 0.65;

  if (inverterCaps.supportsExportLimiting === true) score += 8;
  if (inverterCaps.supportsForcedChargeDischarge === true) score += 4;
  if (batteryCaps.supportsForcedChargeDischarge === true) score += 4;

  return clamp(score);
}

function getAestheticsScore(candidate) {
  const { panel } = getFullProducts(candidate);
  const panelCaps = getCapabilities(panel);

  let score = 30;

  score += numberOrZero(panelCaps.aestheticsScore) * 0.55;
  score += numberOrZero(panelCaps.premiumAppearanceScore) * 0.25;

  const option = String(panel?.panelOption || "").toLowerCase();
  const technology = String(panel?.technology || "").toLowerCase();

  if (option === "premium") score += 8;
  if (technology.includes("n-type")) score += 4;

  return clamp(score);
}

function buildAxisScores(candidate) {
  return {
    cost: round2(getCostScore(candidate)),
    compatibility: round2(getCompatibilityScore(candidate)),
    warranty: round2(getWarrantyScore(candidate)),
    optimisation: round2(getOptimisationScore(candidate)),
    backup: round2(getBackupScore(candidate)),
    monitoring: round2(getMonitoringScore(candidate)),
    exportControl: round2(getExportControlScore(candidate)),
    aesthetics: round2(getAestheticsScore(candidate)),
  };
}

function scoreCandidateForProfile(candidate, profile) {
  const axisScores = buildAxisScores(candidate);
  const weights = profile.weights || {};

  const weightTotal = Object.values(weights).reduce(
    (sum, value) => sum + numberOrZero(value),
    0
  );

  const weightedTotal = Object.entries(weights).reduce(
    (sum, [axis, weight]) => {
      return sum + numberOrZero(axisScores[axis]) * numberOrZero(weight);
    },
    0
  );

  const score = weightTotal > 0 ? weightedTotal / weightTotal : 0;

  return {
    version: SYSTEM_TYPE_FIT_VERSION,
    profileVersion: SYSTEM_TYPE_PROFILES_VERSION,

    systemType: profile.id,
    label: profile.label,
    description: profile.description,

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    score: round2(score),
    axisScores,
    weights,

    scoringSource: {
      usesCatalogueCapabilities: true,
      usesCompatibilityChecks: true,
      usesPlaceholderPricing: true,
      note:
        "System type scores now use explicit catalogue capability fields where available, but remain diagnostic only.",
    },

    limitations: [
      "System type fit is diagnostic only.",
      "It does not yet change quote pricing, PV generation, battery dispatch or recommendations.",
      "Scores currently use beta catalogue capability fields and simple heuristics.",
      "Future supplier data should replace placeholder capability scores.",
    ],
  };
}

function buildSystemTypeFits(candidate) {
  const profiles = listSystemTypeProfiles();

  return profiles.reduce((fits, profile) => {
    fits[profile.id] = scoreCandidateForProfile(candidate, profile);
    return fits;
  }, {});
}

function getBestFitSystemType(systemTypeFits = {}) {
  const values = Object.values(systemTypeFits);

  if (!values.length) {
    return null;
  }

  const best = values.reduce((currentBest, fit) => {
    if (!currentBest) return fit;
    return numberOrZero(fit.score) > numberOrZero(currentBest.score)
      ? fit
      : currentBest;
  }, null);

  if (!best) return null;

  return {
    systemType: best.systemType,
    label: best.label,
    score: best.score,
  };
}

function attachSystemTypeFits(candidate, selectedSystemType = "balanced") {
  if (!candidate || typeof candidate !== "object") {
    return candidate;
  }

  const selectedProfile = getSystemTypeProfile(selectedSystemType);
  const systemTypeFits = buildSystemTypeFits(candidate);

  return {
    ...candidate,

    systemTypeFits,

    selectedSystemTypeFit:
      systemTypeFits[selectedProfile.id] || systemTypeFits.balanced || null,

    bestFitSystemType: getBestFitSystemType(systemTypeFits),
  };
}

module.exports = {
  SYSTEM_TYPE_FIT_VERSION,
  buildAxisScores,
  scoreCandidateForProfile,
  buildSystemTypeFits,
  getBestFitSystemType,
  attachSystemTypeFits,
};