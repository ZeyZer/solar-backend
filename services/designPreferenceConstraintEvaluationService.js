const DESIGN_PREFERENCE_CONSTRAINT_EVALUATION_VERSION = "2026-beta-1";

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normaliseString(value) {
  return String(value ?? "").trim().toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compact(values = []) {
  return values.filter((value) => value !== undefined && value !== null && value !== "");
}

function getCandidateId(candidate = {}) {
  return candidate?.candidateId || null;
}

function getProducts(candidate = {}) {
  return candidate?.products || {};
}

function getPanel(candidate = {}) {
  return getProducts(candidate).panel || null;
}

function getInverter(candidate = {}) {
  return getProducts(candidate).inverter || null;
}

function getBattery(candidate = {}) {
  return getProducts(candidate).battery || null;
}

function getTags(product = {}) {
  return [
    ...asArray(product?.tags),
    ...asArray(product?.features),
    ...asArray(product?.capabilities),
    ...asArray(product?.labels),
  ].map(normaliseString);
}

function containsAny(value, needles = []) {
  const haystack = normaliseString(value);

  return needles.some((needle) => haystack.includes(normaliseString(needle)));
}

function productHasTag(product = {}, needles = []) {
  return getTags(product).some((tag) =>
    needles.some((needle) => tag.includes(normaliseString(needle)))
  );
}

function readFirstNumber(product = {}, paths = []) {
  for (const path of paths) {
    const parts = path.split(".");
    let current = product;

    for (const part of parts) {
      if (current && Object.prototype.hasOwnProperty.call(current, part)) {
        current = current[part];
      } else {
        current = undefined;
        break;
      }
    }

    const n = numberOrNull(current);
    if (n !== null) return n;
  }

  return null;
}

function readFirstBoolean(product = {}, paths = []) {
  for (const path of paths) {
    const parts = path.split(".");
    let current = product;

    for (const part of parts) {
      if (current && Object.prototype.hasOwnProperty.call(current, part)) {
        current = current[part];
      } else {
        current = undefined;
        break;
      }
    }

    if (current === true || current === false) {
      return current;
    }

    if (normaliseString(current) === "true" || normaliseString(current) === "yes") {
      return true;
    }

    if (normaliseString(current) === "false" || normaliseString(current) === "no") {
      return false;
    }
  }

  return null;
}

function panelAppearsAllBlack(panel = {}) {
  if (!panel) return null;

  const explicit = readFirstBoolean(panel, [
    "allBlack",
    "isAllBlack",
    "aesthetic.allBlack",
    "appearance.allBlack",
  ]);

  if (explicit !== null) return explicit;

  const fields = compact([
    panel.name,
    panel.model,
    panel.description,
    panel.aesthetic,
    panel.appearance,
    panel.colour,
    panel.color,
    panel.frameColour,
    panel.frameColor,
    panel.backsheetColour,
    panel.backsheetColor,
  ]).join(" ");

  if (
    containsAny(fields, [
      "all black",
      "all-black",
      "full black",
      "full-black",
      "black frame",
      "black backsheet",
      "black module",
    ])
  ) {
    return true;
  }

  if (productHasTag(panel, ["all_black", "all black", "full black", "black aesthetic"])) {
    return true;
  }

  if (containsAny(fields, ["silver frame", "white backsheet"])) {
    return false;
  }

  return null;
}

function getPanelWarrantyYears(panel = {}) {
  return readFirstNumber(panel, [
    "warrantyYears",
    "productWarrantyYears",
    "warranty.productYears",
    "warranty.product",
    "warranty.materialYears",
    "warranty.material",
    "productWarranty",
  ]);
}

function inverterSupportsBackup(inverter = {}) {
  if (!inverter) return null;

  const explicit = readFirstBoolean(inverter, [
    "backupCapable",
    "supportsBackup",
    "backup",
    "eps",
    "hasEps",
    "capabilities.backup",
    "capabilities.eps",
  ]);

  if (explicit !== null) return explicit;

  const fields = compact([
    inverter.name,
    inverter.model,
    inverter.description,
    inverter.type,
    inverter.category,
  ]).join(" ");

  if (containsAny(fields, ["backup", "eps", "whole home backup", "backup gateway"])) {
    return true;
  }

  if (productHasTag(inverter, ["backup", "eps", "backup capable"])) {
    return true;
  }

  return null;
}

function inverterIsHybrid(inverter = {}) {
  if (!inverter) return null;

  const explicit = readFirstBoolean(inverter, [
    "hybrid",
    "isHybrid",
    "hybridInverter",
    "capabilities.hybrid",
  ]);

  if (explicit !== null) return explicit;

  const fields = compact([
    inverter.name,
    inverter.model,
    inverter.description,
    inverter.type,
    inverter.category,
  ]).join(" ");

  if (containsAny(fields, ["hybrid"])) {
    return true;
  }

  if (productHasTag(inverter, ["hybrid"])) {
    return true;
  }

  return null;
}

function getInverterWarrantyYears(inverter = {}) {
  return readFirstNumber(inverter, [
    "warrantyYears",
    "productWarrantyYears",
    "warranty.productYears",
    "warranty.product",
    "warrantyYearsStandard",
    "standardWarrantyYears",
  ]);
}

function hasBattery(candidate = {}) {
  const battery = getBattery(candidate);

  if (!battery) return false;

  if (typeof battery === "string") {
    return battery !== "no-battery" && battery !== "none";
  }

  if (battery?.id === "no-battery" || battery?.id === "none") {
    return false;
  }

  return !!battery?.id || Number(battery?.usableCapacityKWh) > 0;
}

function getBatteryUsableKWh(candidate = {}) {
  const battery = getBattery(candidate);

  return numberOrNull(
    battery?.usableCapacityKWh ??
      battery?.usableKWh ??
      battery?.usableCapacity ??
      candidate?.dispatchModel?.battery?.usableCapacityKWh ??
      candidate?.financialModel?.batteryControlStrategy?.battery?.usableCapacityKWh
  );
}

function getEstimatedInstalledCost(candidate = {}) {
  return numberOrNull(
    candidate?.financialModel?.systemCost?.estimatedInstalledCost ??
      candidate?.costModel?.estimatedInstalledCost ??
      candidate?.costModel?.estimatedTotalCost ??
      candidate?.costModel?.totalInstalledCost
  );
}

function passFailUnknown({ actual, expected, operator }) {
  if (actual === null || actual === undefined) {
    return "unknown";
  }

  if (operator === "equals") {
    return actual === expected ? "passed" : "failed";
  }

  if (operator === ">=") {
    return Number(actual) >= Number(expected) ? "passed" : "failed";
  }

  if (operator === "<=") {
    return Number(actual) <= Number(expected) ? "passed" : "failed";
  }

  return "unknown";
}

function evaluateSingleConstraint({ candidate = {}, constraint = {} } = {}) {
  const component = constraint.component;
  const type = constraint.constraintType;
  const value = constraint.value;
  const operator = constraint.operator;

  let actual = null;
  let evidence = null;

  if (constraint.constraintId === "panel_all_black_required") {
    actual = panelAppearsAllBlack(getPanel(candidate));
    evidence = "panel appearance/aesthetic fields";
  }

  if (constraint.constraintId === "panel_min_warranty") {
    actual = getPanelWarrantyYears(getPanel(candidate));
    evidence = "panel warranty fields";
  }

  if (constraint.constraintId === "backup_capability_required") {
    actual = inverterSupportsBackup(getInverter(candidate));
    evidence = "inverter backup capability fields";
  }

  if (constraint.constraintId === "hybrid_inverter_required") {
    actual = inverterIsHybrid(getInverter(candidate));
    evidence = "inverter hybrid capability fields";
  }

  if (constraint.constraintId === "inverter_min_warranty") {
    actual = getInverterWarrantyYears(getInverter(candidate));
    evidence = "inverter warranty fields";
  }

  if (constraint.constraintId === "battery_required") {
    actual = hasBattery(candidate);
    evidence = "selected battery product";
  }

  if (constraint.constraintId === "battery_min_usable_capacity") {
    actual = getBatteryUsableKWh(candidate);
    evidence = "battery usable capacity fields";
  }

  if (constraint.constraintId === "maximum_budget") {
    actual = getEstimatedInstalledCost(candidate);
    evidence = "candidate installed cost estimate";
  }

  const status = passFailUnknown({
    actual,
    expected: value,
    operator,
  });

  return {
    constraintId: constraint.constraintId,
    component,
    constraintType: type,
    operator,
    expectedValue: value,
    actualValue: actual,
    status,
    evidence,
    reason: constraint.reason || null,
  };
}

function summarizeEvaluations(evaluations = []) {
  const passed = evaluations.filter((item) => item.status === "passed");
  const failed = evaluations.filter((item) => item.status === "failed");
  const unknown = evaluations.filter((item) => item.status === "unknown");

  return {
    hardConstraintCount: evaluations.length,
    passedHardConstraints: passed.length,
    failedHardConstraints: failed.length,
    unknownHardConstraints: unknown.length,
    failedConstraintIds: failed.map((item) => item.constraintId),
    unknownConstraintIds: unknown.map((item) => item.constraintId),

    hardConstraintStatus:
      evaluations.length === 0
        ? "no_hard_constraints"
        : failed.length > 0
          ? "fails_hard_constraints"
          : unknown.length > 0
            ? "passes_known_constraints_with_unknowns"
            : "passes_all_hard_constraints",
  };
}

function evaluateDesignPreferenceConstraintsForCandidate({
  candidate = {},
  designPreferenceProfile = null,
} = {}) {
  const constraints =
    designPreferenceProfile?.hardConstraints?.constraints || [];

  const evaluations = constraints.map((constraint) =>
    evaluateSingleConstraint({
      candidate,
      constraint,
    })
  );

  const summary = summarizeEvaluations(evaluations);

  return {
    version: DESIGN_PREFERENCE_CONSTRAINT_EVALUATION_VERSION,
    mode: "design_preference_constraint_evaluation_beta",

    candidateId: getCandidateId(candidate),

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    summary,

    evaluations,

    diagnosticEligibility: {
      passesAllKnownHardConstraints:
        summary.failedHardConstraints === 0,
      hasFailedHardConstraints:
        summary.failedHardConstraints > 0,
      hasUnknownHardConstraints:
        summary.unknownHardConstraints > 0,
      recommendation:
        summary.failedHardConstraints > 0
          ? "candidate_would_be_rejected_if_constraints_were_enforced"
          : summary.unknownHardConstraints > 0
            ? "candidate_needs_better_catalogue_data_before_enforcement"
            : "candidate_passes_diagnostic_hard_constraints",
    },

    assumptions: {
      note:
        "This evaluation is diagnostic only. It does not yet filter candidates, alter ranking, change pricing or change recommendations.",
    },

    limitations: [
      "Some product catalogue fields may be incomplete, so unknown results should not be treated as failures yet.",
      "Constraint enforcement should only be enabled after catalogue data is normalised and tested.",
    ],
  };
}

function applyDesignPreferenceConstraintEvaluations({
  candidates = [],
  designPreferenceProfile = null,
} = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  return safeCandidates.map((candidate) => ({
    ...candidate,
    preferenceConstraintEvaluation:
      evaluateDesignPreferenceConstraintsForCandidate({
        candidate,
        designPreferenceProfile,
      }),
  }));
}

module.exports = {
  DESIGN_PREFERENCE_CONSTRAINT_EVALUATION_VERSION,
  evaluateDesignPreferenceConstraintsForCandidate,
  applyDesignPreferenceConstraintEvaluations,
};