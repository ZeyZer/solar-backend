const DESIGN_PREFERENCE_CONSTRAINT_ENFORCEMENT_READINESS_VERSION =
  "2026-beta-1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getHardConstraints(designPreferenceProfile = null) {
  return asArray(designPreferenceProfile?.hardConstraints?.constraints);
}

function getCandidateEvaluation(candidate = {}) {
  return candidate?.preferenceConstraintEvaluation || null;
}

function getConstraintEvaluation(candidate = {}, constraintId = null) {
  const evaluation = getCandidateEvaluation(candidate);

  return asArray(evaluation?.evaluations).find(
    (item) => item.constraintId === constraintId
  );
}

function getCandidateId(candidate = {}, index = 0) {
  return candidate?.candidateId || `candidate-${index + 1}`;
}

function getCandidateConstraintSummary(candidate = {}, index = 0) {
  const evaluation = getCandidateEvaluation(candidate);
  const summary = evaluation?.summary || {};

  return {
    candidateId: getCandidateId(candidate, index),
    hardConstraintStatus:
      summary.hardConstraintStatus || "not_evaluated",
    hardConstraintCount:
      summary.hardConstraintCount ?? 0,
    passedHardConstraints:
      summary.passedHardConstraints ?? 0,
    failedHardConstraints:
      summary.failedHardConstraints ?? 0,
    unknownHardConstraints:
      summary.unknownHardConstraints ?? 0,
    failedConstraintIds:
      summary.failedConstraintIds || [],
    unknownConstraintIds:
      summary.unknownConstraintIds || [],
  };
}

function summarizeConstraintAcrossCandidates({
  constraint = {},
  candidates = [],
} = {}) {
  const rows = candidates.map((candidate, index) => {
    const evaluation = getConstraintEvaluation(
      candidate,
      constraint.constraintId
    );

    return {
      candidateId: getCandidateId(candidate, index),
      status: evaluation?.status || "not_evaluated",
      actualValue: evaluation?.actualValue ?? null,
      expectedValue:
        evaluation?.expectedValue ?? constraint.value ?? null,
      evidence: evaluation?.evidence || null,
    };
  });

  const passed = rows.filter((row) => row.status === "passed");
  const failed = rows.filter((row) => row.status === "failed");
  const unknown = rows.filter(
    (row) =>
      row.status === "unknown" || row.status === "not_evaluated"
  );

  const candidateCount = rows.length;

  const dataCompletenessPercent =
    candidateCount === 0
      ? 100
      : Math.round(((candidateCount - unknown.length) / candidateCount) * 100);

  const enforcementReadiness =
    candidateCount === 0
      ? "no_candidates"
      : unknown.length === 0
        ? "ready_to_enforce"
        : failed.length > 0
          ? "partially_ready_known_failures_with_unknowns"
          : "not_ready_unknown_catalogue_data";

  return {
    constraintId: constraint.constraintId,
    component: constraint.component,
    constraintType: constraint.constraintType,
    operator: constraint.operator,
    expectedValue: constraint.value,
    reason: constraint.reason || null,

    candidateCount,
    passedCandidateCount: passed.length,
    failedCandidateCount: failed.length,
    unknownCandidateCount: unknown.length,
    dataCompletenessPercent,

    enforcementReadiness,

    wouldRejectCandidateIds: failed.map((row) => row.candidateId),
    unknownCandidateIds: unknown.map((row) => row.candidateId),

    evidenceSummary: Array.from(
      new Set(rows.map((row) => row.evidence).filter(Boolean))
    ),

    recommendation:
      enforcementReadiness === "ready_to_enforce"
        ? "constraint_can_be_safely_enforced"
        : "constraint_should_remain_diagnostic_until_catalogue_data_is_complete",
  };
}

function buildOverallSummary({
  constraintSummaries = [],
  candidateSummaries = [],
} = {}) {
  const hardConstraintCount = constraintSummaries.length;

  const readyConstraints = constraintSummaries.filter(
    (item) => item.enforcementReadiness === "ready_to_enforce"
  );

  const constraintsWithUnknowns = constraintSummaries.filter(
    (item) => item.unknownCandidateCount > 0
  );

  const candidatesWithKnownFailures = candidateSummaries.filter(
    (item) => item.failedHardConstraints > 0
  );

  const candidatesWithUnknowns = candidateSummaries.filter(
    (item) => item.unknownHardConstraints > 0
  );

  const wouldRejectCandidateIds = Array.from(
    new Set(
      candidatesWithKnownFailures.map((candidate) => candidate.candidateId)
    )
  );

  const unknownCandidateIds = Array.from(
    new Set(candidatesWithUnknowns.map((candidate) => candidate.candidateId))
  );

  return {
    hardConstraintCount,
    candidateCount: candidateSummaries.length,

    readyToEnforceConstraintCount: readyConstraints.length,
    constraintsWithUnknownCatalogueData:
      constraintsWithUnknowns.length,

    candidatesWithKnownFailures:
      candidatesWithKnownFailures.length,
    candidatesWithUnknowns:
      candidatesWithUnknowns.length,

    wouldRejectCandidateIds,
    unknownCandidateIds,

    enforcementReadiness:
      hardConstraintCount === 0
        ? "no_hard_constraints_to_enforce"
        : readyConstraints.length === hardConstraintCount
          ? "all_hard_constraints_ready_to_enforce"
          : readyConstraints.length > 0
            ? "some_hard_constraints_ready_to_enforce"
            : "hard_constraints_not_ready_to_enforce",

    recommendedNextAction:
      hardConstraintCount === 0
        ? "No hard constraints are currently selected by the user."
        : constraintsWithUnknowns.length > 0
          ? "Keep constraints diagnostic until catalogue metadata gaps are filled."
          : "Constraints can be promoted to enforcement in a future phase after final review.",
  };
}

function buildPreferenceConstraintEnforcementReadiness({
  candidates = [],
  designPreferenceProfile = null,
} = {}) {
  const safeCandidates = asArray(candidates);
  const hardConstraints = getHardConstraints(designPreferenceProfile);

  const constraintSummaries = hardConstraints.map((constraint) =>
    summarizeConstraintAcrossCandidates({
      constraint,
      candidates: safeCandidates,
    })
  );

  const candidateSummaries = safeCandidates.map((candidate, index) =>
    getCandidateConstraintSummary(candidate, index)
  );

  const summary = buildOverallSummary({
    constraintSummaries,
    candidateSummaries,
  });

  return {
    version: DESIGN_PREFERENCE_CONSTRAINT_ENFORCEMENT_READINESS_VERSION,
    mode: "design_preference_constraint_enforcement_readiness_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    enforcementStatus: "diagnostic_only_not_enforced",

    summary,

    constraintSummaries,
    candidateSummaries,

    assumptions: {
      note:
        "This readiness report shows which hard constraints could be safely enforced in future. It does not currently reject candidates or alter ranking.",
    },

    limitations: [
      "Unknown catalogue metadata is not treated as a failure in this phase.",
      "Constraint enforcement should only be enabled once metadata completeness is acceptable.",
      "This report does not yet distinguish between public quote defaults and installer/admin-only constraints.",
    ],
  };
}

module.exports = {
  DESIGN_PREFERENCE_CONSTRAINT_ENFORCEMENT_READINESS_VERSION,
  buildPreferenceConstraintEnforcementReadiness,
};