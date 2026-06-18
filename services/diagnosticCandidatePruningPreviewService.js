const DIAGNOSTIC_CANDIDATE_PRUNING_PREVIEW_VERSION = "2026-beta-1";

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getCandidateId(candidate = {}, index = 0) {
  return candidate?.candidateId || candidate?.id || `candidate-${index + 1}`;
}

function getCandidateCompatibilityStatus(candidate = {}) {
  const raw =
    candidate?.compatibilityStatus ||
    candidate?.compatibility?.status ||
    candidate?.filtering?.status ||
    candidate?.candidateSetMetadata?.compatibilityStatus ||
    candidate?.candidateSetMetadata?.status ||
    candidate?.status;

  const value = String(raw || "").trim().toLowerCase();

  if (["viable", "pass", "passed"].includes(value)) return "viable";

  if (
    [
      "viable_with_warnings",
      "warning",
      "warnings",
      "passed_with_warnings",
    ].includes(value)
  ) {
    return "viable_with_warnings";
  }

  if (
    [
      "rejected",
      "fail",
      "failed",
      "not_viable",
      "incompatible",
    ].includes(value)
  ) {
    return "rejected";
  }

  if (
    candidate?.rejected === true ||
    candidate?.isRejected === true ||
    candidate?.filtering?.rejected === true
  ) {
    return "rejected";
  }

  return "unknown";
}

function getCompatibilityScore(status) {
  const scores = {
    viable: 100,
    viable_with_warnings: 75,
    unknown: 50,
    rejected: 0,
  };

  return scores[status] ?? scores.unknown;
}

function getPreferenceConstraintSummary(candidate = {}) {
  return candidate?.preferenceConstraintEvaluation?.summary || {};
}

function getHardConstraintStatus(candidate = {}) {
  return (
    getPreferenceConstraintSummary(candidate).hardConstraintStatus ||
    "not_evaluated"
  );
}

function getFailedHardConstraintCount(candidate = {}) {
  return numberOrZero(
    getPreferenceConstraintSummary(candidate).failedHardConstraints
  );
}

function getUnknownHardConstraintCount(candidate = {}) {
  return numberOrZero(
    getPreferenceConstraintSummary(candidate).unknownHardConstraints
  );
}

function getFailedConstraintIds(candidate = {}) {
  return asArray(
    getPreferenceConstraintSummary(candidate).failedConstraintIds
  );
}

function getUnknownConstraintIds(candidate = {}) {
  return asArray(
    getPreferenceConstraintSummary(candidate).unknownConstraintIds
  );
}

function getPreferenceScore(candidate = {}) {
  return numberOrNull(candidate?.designPreferenceScore?.weightedScore);
}

function getPreferenceScoreBand(candidate = {}) {
  return candidate?.designPreferenceScore?.scoreBand || "unknown";
}

function getDataCompletenessScore(candidate = {}) {
  return numberOrNull(
    candidate?.hardwareMetadataNormalisation?.summary?.dataCompletenessScore
  );
}

function getMissingRequiredFieldCount(candidate = {}) {
  return numberOrZero(
    candidate?.hardwareMetadataNormalisation?.summary?.missingRequiredFieldCount
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

function getPaybackYears(candidate = {}) {
  return numberOrNull(
    candidate?.financialModel?.payback?.simplePaybackYears ??
      candidate?.financialModel?.payback?.paybackYear
  );
}

function getLifetimeSavings(candidate = {}) {
  return numberOrNull(candidate?.financialModel?.payback?.lifetimeSavings);
}

function getFinancialAvailabilityScore(candidate = {}) {
  const fields = [
    getEstimatedInstalledCost(candidate),
    getPaybackYears(candidate),
    getLifetimeSavings(candidate),
  ];

  const available = fields.filter((field) => field !== null).length;

  return round2((available / fields.length) * 100);
}

function buildReason(code, severity, message) {
  return {
    code,
    severity,
    message,
  };
}

function classifyCandidateForPruningPreview(candidate = {}) {
  const compatibilityStatus = getCandidateCompatibilityStatus(candidate);
  const failedHardConstraints = getFailedHardConstraintCount(candidate);
  const unknownHardConstraints = getUnknownHardConstraintCount(candidate);
  const preferenceScore = getPreferenceScore(candidate);
  const dataCompletenessScore = getDataCompletenessScore(candidate);
  const missingRequiredFieldCount = getMissingRequiredFieldCount(candidate);

  const reasons = [];

  if (compatibilityStatus === "rejected") {
    reasons.push(
      buildReason(
        "existing_compatibility_rejection",
        "high",
        "Candidate is already marked as rejected or incompatible by existing compatibility checks."
      )
    );

    return {
      provisionalTier: "would_prune_existing_rejection",
      previewAction: "would_not_carry_forward_if_pruning_enabled",
      wouldCarryForwardForFutureOptimisation: false,
      reasons,
    };
  }

  if (failedHardConstraints > 0) {
    reasons.push(
      buildReason(
        "known_hard_constraint_failures",
        "high",
        "Candidate has known hard-constraint failures and would probably be rejected if hard constraints were enforced."
      )
    );

    return {
      provisionalTier: "would_prune_known_hard_constraint_failures",
      previewAction: "would_not_carry_forward_if_constraints_enforced",
      wouldCarryForwardForFutureOptimisation: false,
      reasons,
    };
  }

  if (
    unknownHardConstraints > 0 ||
    dataCompletenessScore === null ||
    dataCompletenessScore < 60 ||
    missingRequiredFieldCount > 5
  ) {
    reasons.push(
      buildReason(
        "catalogue_data_gaps",
        "medium",
        "Candidate has unknown hard-constraint data or low catalogue metadata completeness, so it should not be pruned automatically yet."
      )
    );

    return {
      provisionalTier: "needs_catalogue_data_before_pruning",
      previewAction: "carry_forward_for_review",
      wouldCarryForwardForFutureOptimisation: true,
      reasons,
    };
  }

  if (preferenceScore !== null && preferenceScore >= 85) {
    reasons.push(
      buildReason(
        "excellent_preference_match",
        "positive",
        "Candidate appears to be an excellent match for the current soft preference profile."
      )
    );

    return {
      provisionalTier: "priority_carry_forward",
      previewAction: "carry_forward_priority",
      wouldCarryForwardForFutureOptimisation: true,
      reasons,
    };
  }

  if (preferenceScore !== null && preferenceScore >= 70) {
    reasons.push(
      buildReason(
        "good_preference_match",
        "positive",
        "Candidate appears to be a good match for the current soft preference profile."
      )
    );

    return {
      provisionalTier: "standard_carry_forward",
      previewAction: "carry_forward",
      wouldCarryForwardForFutureOptimisation: true,
      reasons,
    };
  }

  if (compatibilityStatus === "viable_with_warnings") {
    reasons.push(
      buildReason(
        "viable_with_warnings",
        "medium",
        "Candidate is viable with warnings, so it should be carried forward cautiously until the optimiser has better topology and catalogue checks."
      )
    );

    return {
      provisionalTier: "caution_carry_forward",
      previewAction: "carry_forward_with_warnings",
      wouldCarryForwardForFutureOptimisation: true,
      reasons,
    };
  }

  if (preferenceScore !== null && preferenceScore < 55) {
    reasons.push(
      buildReason(
        "weak_preference_match",
        "low",
        "Candidate has a weak soft-preference score, but it is not rejected because diagnostic pruning is not enforced yet."
      )
    );

    return {
      provisionalTier: "low_priority_keep_for_now",
      previewAction: "keep_for_now_low_priority",
      wouldCarryForwardForFutureOptimisation: true,
      reasons,
    };
  }

  reasons.push(
    buildReason(
      "default_keep_for_now",
      "low",
      "Candidate has no strong reason for diagnostic rejection, so it is kept for now."
    )
  );

  return {
    provisionalTier: "standard_carry_forward",
    previewAction: "carry_forward",
    wouldCarryForwardForFutureOptimisation: true,
    reasons,
  };
}

function buildCarryForwardScore(candidate = {}) {
  const compatibilityStatus = getCandidateCompatibilityStatus(candidate);

  const compatibilityScore = getCompatibilityScore(compatibilityStatus);
  const preferenceScore = getPreferenceScore(candidate) ?? 50;
  const dataCompletenessScore = getDataCompletenessScore(candidate) ?? 50;
  const financialAvailabilityScore = getFinancialAvailabilityScore(candidate) ?? 50;

  const failedHardConstraintPenalty =
    getFailedHardConstraintCount(candidate) > 0 ? 50 : 0;

  const rejectedPenalty = compatibilityStatus === "rejected" ? 75 : 0;

  const score =
    compatibilityScore * 0.3 +
    preferenceScore * 0.35 +
    dataCompletenessScore * 0.2 +
    financialAvailabilityScore * 0.15 -
    failedHardConstraintPenalty -
    rejectedPenalty;

  return clamp(round2(score));
}

function buildDiagnosticPruningPreviewForCandidate({
  candidate = {},
  index = 0,
} = {}) {
  const classification = classifyCandidateForPruningPreview(candidate);
  const compatibilityStatus = getCandidateCompatibilityStatus(candidate);

  const carryForwardScore = buildCarryForwardScore(candidate);

  return {
    version: DIAGNOSTIC_CANDIDATE_PRUNING_PREVIEW_VERSION,
    mode: "diagnostic_candidate_pruning_preview_beta",

    candidateId: getCandidateId(candidate, index),

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    enforcementStatus: "diagnostic_only_not_pruned",

    compatibilityStatus,
    hardConstraintStatus: getHardConstraintStatus(candidate),
    preferenceScore: getPreferenceScore(candidate),
    preferenceScoreBand: getPreferenceScoreBand(candidate),
    dataCompletenessScore: getDataCompletenessScore(candidate),

    carryForwardScore,

    provisionalTier: classification.provisionalTier,
    previewAction: classification.previewAction,
    wouldCarryForwardForFutureOptimisation:
      classification.wouldCarryForwardForFutureOptimisation,

    failedConstraintIds: getFailedConstraintIds(candidate),
    unknownConstraintIds: getUnknownConstraintIds(candidate),

    financialSignals: {
      estimatedInstalledCost: getEstimatedInstalledCost(candidate),
      paybackYears: getPaybackYears(candidate),
      lifetimeSavings: getLifetimeSavings(candidate),
      financialAvailabilityScore: getFinancialAvailabilityScore(candidate),
    },

    reasons: classification.reasons,

    assumptions: {
      note:
        "This is a diagnostic pruning preview only. It does not remove candidates, change ranking or affect recommendations.",
    },

    limitations: [
      "This preview is not a full Pareto frontier calculation.",
      "Unknown catalogue data is not treated as a hard failure.",
      "Roof layout, stringing and inverter envelope checks are not yet included.",
      "Actual pruning should only be enabled in a later phase after additional testing.",
    ],
  };
}

function applyDiagnosticPruningPreviewToCandidates({ candidates = [] } = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  return safeCandidates.map((candidate, index) => ({
    ...candidate,
    diagnosticPruningPreview: buildDiagnosticPruningPreviewForCandidate({
      candidate,
      index,
    }),
  }));
}

function countBy(items = [], getter) {
  return items.reduce((acc, item) => {
    const key = getter(item) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function buildDiagnosticPruningPreviewSummary({
  candidates = [],
  recommendedCarryForwardLimit = 12,
} = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  const previews = safeCandidates
    .map((candidate) => candidate.diagnosticPruningPreview)
    .filter(Boolean);

  const carryForward = previews.filter(
    (preview) => preview.wouldCarryForwardForFutureOptimisation === true
  );

  const wouldNotCarryForward = previews.filter(
    (preview) => preview.wouldCarryForwardForFutureOptimisation === false
  );

  const needsCatalogueData = previews.filter(
    (preview) =>
      preview.provisionalTier === "needs_catalogue_data_before_pruning"
  );

  const sortedCarryForward = [...carryForward].sort(
    (a, b) => numberOrZero(b.carryForwardScore) - numberOrZero(a.carryForwardScore)
  );

  const recommendedCarryForward = sortedCarryForward.slice(
    0,
    recommendedCarryForwardLimit
  );

  const averageCarryForwardScore =
    previews.length === 0
      ? null
      : round2(
          previews.reduce(
            (sum, preview) => sum + numberOrZero(preview.carryForwardScore),
            0
          ) / previews.length
        );

  return {
    version: DIAGNOSTIC_CANDIDATE_PRUNING_PREVIEW_VERSION,
    mode: "diagnostic_candidate_pruning_preview_summary_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    enforcementStatus: "diagnostic_only_not_pruned",

    candidateCount: safeCandidates.length,
    previewedCandidateCount: previews.length,

    recommendedCarryForwardLimit,
    wouldCarryForwardCount: carryForward.length,
    wouldNotCarryForwardCount: wouldNotCarryForward.length,
    needsCatalogueDataCount: needsCatalogueData.length,

    averageCarryForwardScore,

    provisionalTierCounts: countBy(
      previews,
      (preview) => preview.provisionalTier
    ),

    previewActionCounts: countBy(
      previews,
      (preview) => preview.previewAction
    ),

    recommendedCarryForwardCandidateIds:
      recommendedCarryForward.map((preview) => preview.candidateId),

    wouldNotCarryForwardCandidateIds:
      wouldNotCarryForward.map((preview) => preview.candidateId),

    needsCatalogueDataCandidateIds:
      needsCatalogueData.map((preview) => preview.candidateId),

    readiness:
      previews.length === 0
        ? "no_candidates_to_preview"
        : needsCatalogueData.length > 0
          ? "diagnostic_pruning_preview_ready_with_catalogue_data_gaps"
          : "diagnostic_pruning_preview_ready",

    recommendedNextAction:
      needsCatalogueData.length > 0
        ? "Improve catalogue metadata before enabling actual pruning."
        : "Use this preview to design the later enforced pruning and Pareto frontier phase.",

    assumptions: {
      note:
        "This summary previews future pruning decisions but does not currently remove candidates or affect ranking.",
    },
  };
}

module.exports = {
  DIAGNOSTIC_CANDIDATE_PRUNING_PREVIEW_VERSION,
  buildDiagnosticPruningPreviewForCandidate,
  applyDiagnosticPruningPreviewToCandidates,
  buildDiagnosticPruningPreviewSummary,
};