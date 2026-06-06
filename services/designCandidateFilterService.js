const DESIGN_CANDIDATE_FILTER_VERSION = "2026-beta-1";

const HARD_REJECTION_CODES = new Set([
  "PANEL_PRODUCT_SELECTED",
  "INVERTER_PRODUCT_SELECTED",
  "MPPT_COUNT_VS_ARRAYS",
  "INVERTER_MAX_PV_INPUT",
  "DC_AC_RATIO",
  "ARRAY_MPPT_ASSIGNMENT",
  "STRING_COLD_VOC_VS_INVERTER_MAX_DC",
  "STRING_COLD_VOC_VS_PANEL_MAX_SYSTEM_VOLTAGE",
  "STRING_COLD_VOC_VS_MPPT_MAX",
  "STRING_HOT_VMP_VS_MPPT_MIN",
  "STRING_VMP_VS_STARTUP_VOLTAGE",
  "STRING_IMP_VS_MPPT_INPUT_CURRENT",
  "STRING_ISC_VS_MPPT_SHORT_CIRCUIT_CURRENT",
  "BATTERY_INVERTER_COMPATIBILITY",
]);

const SOFT_REVIEW_CODES = new Set([
  "ARRAY_DC_POWER_VS_MPPT_POWER",
  "BATTERY_INVERTER_BRAND_ALIGNMENT",
  "BATTERY_FULL_CHARGE_WITHIN_SHORT_WINDOW",
  "BATTERY_FULL_DISCHARGE_WITHIN_SHORT_WINDOW",
]);

function getCompatibilityChecks(candidate) {
  return Array.isArray(candidate?.compatibility?.checks)
    ? candidate.compatibility.checks
    : [];
}

function getOptimisationFlags(candidate) {
  return Array.isArray(candidate?.compatibility?.optimisationFlags)
    ? candidate.compatibility.optimisationFlags
    : [];
}

function buildReasonFromCheck(check, reasonType = "check") {
  return {
    code: check.code,
    category: check.category || "unknown",
    status: check.status,
    severity: check.severity || "info",
    title: check.title || check.code,
    message: check.message || "",
    reasonType,
    values: check.values || {},
  };
}

function buildReasonFromFlag(flag) {
  return {
    code: flag.code,
    category: "optimisation_flag",
    status: "warn",
    severity: flag.severity || "info",
    title: flag.code,
    message: flag.reason || "",
    reasonType: "optimisation_flag",
    possibleSolutions: flag.possibleSolutions || [],
  };
}

function classifyDesignCandidate(candidate) {
  const checks = getCompatibilityChecks(candidate);
  const flags = getOptimisationFlags(candidate);

  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn");

  const hardFailures = failedChecks.filter((check) =>
    HARD_REJECTION_CODES.has(check.code)
  );

  const otherFailures = failedChecks.filter(
    (check) => !HARD_REJECTION_CODES.has(check.code)
  );

  const softReviews = warningChecks.filter((check) =>
    SOFT_REVIEW_CODES.has(check.code)
  );

  const warningFlags = flags.filter(
    (flag) => String(flag.severity || "").toLowerCase() === "warning"
  );

  let status = "viable";

  if (hardFailures.length > 0 || otherFailures.length > 0) {
    status = "rejected";
  } else if (warningChecks.length > 0 || flags.length > 0) {
    status = "viable_with_warnings";
  }

  const rejectionReasons = [
    ...hardFailures.map((check) => buildReasonFromCheck(check, "hard_rejection")),
    ...otherFailures.map((check) => buildReasonFromCheck(check, "rejection")),
  ];

  const warningReasons = [
    ...warningChecks.map((check) =>
      buildReasonFromCheck(
        check,
        SOFT_REVIEW_CODES.has(check.code) ? "soft_review" : "warning"
      )
    ),
    ...flags.map(buildReasonFromFlag),
  ];

  return {
    version: DESIGN_CANDIDATE_FILTER_VERSION,
    status,

    eligibleForFutureOptimiser: status !== "rejected",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    counts: {
      checks: checks.length,
      failedChecks: failedChecks.length,
      hardFailures: hardFailures.length,
      warningChecks: warningChecks.length,
      optimisationFlags: flags.length,
      warningFlags: warningFlags.length,
      softReviews: softReviews.length,
    },

    rejectionReasons,
    warningReasons,

    hardRejectionCodes: hardFailures.map((check) => check.code),
    warningCodes: warningReasons.map((reason) => reason.code),

    notes:
      "Candidate filtering is diagnostic only. It does not yet change quote calculations, customer pricing, product selection or recommendations.",
  };
}

function applyCandidateFiltering(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return candidate;
  }

  return {
    ...candidate,
    filtering: classifyDesignCandidate(candidate),
  };
}

function summarizeFilteredCandidates(candidates = []) {
  return candidates.reduce(
    (summary, candidate) => {
      summary.total += 1;

      const status = candidate?.filtering?.status || "unknown";

      if (status === "viable") {
        summary.viable += 1;
        summary.pass += 1;
      } else if (status === "viable_with_warnings") {
        summary.viable_with_warnings += 1;
        summary.warn += 1;
      } else if (status === "rejected") {
        summary.rejected += 1;
        summary.fail += 1;
      } else {
        summary.unknown += 1;
      }

      return summary;
    },
    {
      total: 0,

      viable: 0,
      viable_with_warnings: 0,
      rejected: 0,
      unknown: 0,

      // Backward-friendly aliases for simple summaries.
      pass: 0,
      warn: 0,
      fail: 0,
    }
  );
}

module.exports = {
  DESIGN_CANDIDATE_FILTER_VERSION,
  HARD_REJECTION_CODES,
  SOFT_REVIEW_CODES,
  classifyDesignCandidate,
  applyCandidateFiltering,
  summarizeFilteredCandidates,
};