// R1.7b.7
// Candidate adaptive policy for Google hourly shade factors.
// This is benchmark-supported, not yet final production-validated.

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function clamp01(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Math.max(0, Math.min(1, number));
}

function applyDiffuseFloor({ shadeFactor, diffuseFloor }) {
  const shade = clamp01(shadeFactor);
  const floor = clamp01(diffuseFloor) ?? 0;

  if (shade === null) return 1;

  return floor + (1 - floor) * shade;
}

function calculateDirectShadeLossPercent({
  unshadedAnnualKwh,
  directShadeAdjustedAnnualKwh,
}) {
  const unshaded = numberOrNull(unshadedAnnualKwh);
  const adjusted = numberOrNull(directShadeAdjustedAnnualKwh);

  if (!unshaded || adjusted === null) {
    return null;
  }

  return round1(((unshaded - adjusted) / unshaded) * 100);
}

function isLargeOrComplexSystem({
  originalHybridAnnualKwh,
  systemSizeKwp,
  allocatedPanelTotal,
}) {
  const annual = numberOrNull(originalHybridAnnualKwh);
  const kwp = numberOrNull(systemSizeKwp);
  const panels = numberOrNull(allocatedPanelTotal);

  return (
    (annual !== null && annual >= 15000) ||
    (kwp !== null && kwp >= 15) ||
    (panels !== null && panels >= 40)
  );
}

function chooseAdaptiveShadePolicy({
  directShadeLossPercent,
  originalHybridAnnualKwh,
  systemSizeKwp,
  allocatedPanelTotal,
}) {
  const directLoss = numberOrNull(directShadeLossPercent);

  if (directLoss === null) {
    return {
      policyName: "adaptive_c_complexity_guard",
      reason: "missing_direct_shade_loss_default_direct",
      diffuseFloor: 0,
      hourOffset: 0,
      confidenceImpact: "medium",
    };
  }

  if (
    isLargeOrComplexSystem({
      originalHybridAnnualKwh,
      systemSizeKwp,
      allocatedPanelTotal,
    })
  ) {
    return {
      policyName: "adaptive_c_complexity_guard",
      reason: "large_or_complex_system_use_direct_google_shade",
      diffuseFloor: 0,
      hourOffset: 0,
      confidenceImpact: "medium",
    };
  }

  if (directLoss >= 24) {
    return {
      policyName: "adaptive_c_complexity_guard",
      reason: "heavy_shade_domestic_low_diffuse_floor",
      diffuseFloor: 0.05,
      hourOffset: 1,
      confidenceImpact: "high",
    };
  }

  if (directLoss <= 14) {
    return {
      policyName: "adaptive_c_complexity_guard",
      reason: "low_shade_domestic_preserve_diffuse_light",
      diffuseFloor: 0.3,
      hourOffset: 1,
      confidenceImpact: "high",
    };
  }

  return {
    policyName: "adaptive_c_complexity_guard",
    reason: "medium_shade_domestic_balanced_floor",
    diffuseFloor: 0.15,
    hourOffset: 0,
    confidenceImpact: "medium",
  };
}

module.exports = {
  applyDiffuseFloor,
  calculateDirectShadeLossPercent,
  chooseAdaptiveShadePolicy,
};
