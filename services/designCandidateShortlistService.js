const DESIGN_CANDIDATE_SHORTLIST_VERSION = "2026-beta-1";

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function getCandidateStatus(candidate) {
  return candidate?.filtering?.status || "unknown";
}

function isEligibleForFutureOptimiser(candidate) {
  return candidate?.filtering?.eligibleForFutureOptimiser === true;
}

function getCandidateCost(candidate) {
  return numberOrZero(candidate?.costModel?.estimatedHardwareAdder);
}

function getSelectedSystemTypeFit(candidate, selectedSystemType = "balanced") {
  const selected =
    candidate?.systemTypeFits?.[selectedSystemType] ||
    candidate?.selectedSystemTypeFit ||
    candidate?.systemTypeFits?.balanced ||
    null;

  return selected
    ? {
        systemType: selected.systemType,
        label: selected.label,
        score: round2(selected.score),
      }
    : null;
}

function getBestFitSystemType(candidate) {
  const best = candidate?.bestFitSystemType;

  return best
    ? {
        systemType: best.systemType,
        label: best.label,
        score: round2(best.score),
      }
    : null;
}

function getReasonCodes(reasons = []) {
  return reasons
    .map((reason) => reason?.code)
    .filter((code) => typeof code === "string" && code.length > 0);
}

function getTopReasons(reasons = [], limit = 5) {
  const counts = new Map();

  for (const reason of reasons) {
    const code = reason?.code || "UNKNOWN";
    const title = reason?.title || code;
    const message = reason?.message || "";
    const severity = reason?.severity || "info";

    const existing = counts.get(code) || {
      code,
      title,
      message,
      severity,
      count: 0,
    };

    existing.count += 1;
    counts.set(code, existing);
  }

  return Array.from(counts.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.code.localeCompare(b.code);
    })
    .slice(0, limit);
}

function collectReasons(candidates = [], type = "rejection") {
  const allReasons = [];

  for (const candidate of candidates) {
    const filtering = candidate?.filtering || {};

    if (type === "rejection") {
      allReasons.push(...(filtering.rejectionReasons || []));
    }

    if (type === "warning") {
      allReasons.push(...(filtering.warningReasons || []));
    }
  }

  return allReasons;
}

function getStatusRank(candidate) {
  const status = getCandidateStatus(candidate);

  if (status === "viable") return 0;
  if (status === "viable_with_warnings") return 1;
  if (status === "rejected") return 2;

  return 3;
}

function getSelectedScore(candidate, selectedSystemType = "balanced") {
  const fit = getSelectedSystemTypeFit(candidate, selectedSystemType);
  return numberOrZero(fit?.score);
}

function getBestFitScore(candidate) {
  return numberOrZero(candidate?.bestFitSystemType?.score);
}

function sortCandidatesForShortlist(candidates = [], selectedSystemType = "balanced") {
  return [...candidates].sort((a, b) => {
    const statusDiff = getStatusRank(a) - getStatusRank(b);
    if (statusDiff !== 0) return statusDiff;

    const selectedDiff =
      getSelectedScore(b, selectedSystemType) -
      getSelectedScore(a, selectedSystemType);

    if (selectedDiff !== 0) return selectedDiff;

    const bestFitDiff = getBestFitScore(b) - getBestFitScore(a);
    if (bestFitDiff !== 0) return bestFitDiff;

    return getCandidateCost(a) - getCandidateCost(b);
  });
}

function summarizeCandidate(candidate, selectedSystemType = "balanced") {
  const filtering = candidate?.filtering || {};
  const rejectionReasons = filtering.rejectionReasons || [];
  const warningReasons = filtering.warningReasons || [];

  return {
    candidateId: candidate?.candidateId || null,

    status: getCandidateStatus(candidate),
    eligibleForFutureOptimiser: isEligibleForFutureOptimiser(candidate),

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    products: candidate?.products || {},

    panelLayout: {
      totalPanels: candidate?.panelLayout?.totalPanels ?? null,
      systemSizeKwp: candidate?.panelLayout?.systemSizeKwp ?? null,
      arrayCount: Array.isArray(candidate?.panelLayout?.arrays)
        ? candidate.panelLayout.arrays.length
        : 0,
    },

    stringPlan: {
      stringCount: Array.isArray(candidate?.stringPlan?.strings)
        ? candidate.stringPlan.strings.length
        : 0,
      mpptCount: candidate?.stringPlan?.mpptCount ?? null,
      stringPlanMode: candidate?.stringPlan?.stringPlanMode || null,
    },

    cost: {
      estimatedHardwareAdder:
        candidate?.costModel?.estimatedHardwareAdder ?? null,
      mode: candidate?.costModel?.mode || null,
    },

    compatibility: {
      summary: candidate?.compatibility?.summary || null,
      optimisationFlagCount: Array.isArray(candidate?.compatibility?.optimisationFlags)
        ? candidate.compatibility.optimisationFlags.length
        : 0,
    },

    performance: {
      mode: candidate?.performanceModel?.mode || null,
      source: candidate?.performanceModel?.source || null,
      annualGrossGenerationKWh:
        candidate?.performanceModel?.generation?.annualGrossGenerationKWh ?? null,
      annualAfterClippingKWh:
        candidate?.performanceModel?.generation?.annualAfterClippingKWh ?? null,
      annualClippedKWh:
        candidate?.performanceModel?.generation?.annualClippedKWh ?? null,
      clippingRisk:
        candidate?.performanceModel?.inverter?.clippingRisk || null,
      confidence:
        candidate?.performanceModel?.confidence?.level || null,
    },

    dispatch: {
      mode: candidate?.dispatchModel?.mode || null,
      source: candidate?.dispatchModel?.source || null,
      generationSource:
        candidate?.dispatchModel?.generationSource || null,
      annualGenerationKWh:
        candidate?.dispatchModel?.annual?.generationKWh ?? null,
      annualSelfUsedKWh:
        candidate?.dispatchModel?.annual?.selfUsedKWh ?? null,
      annualExportedKWh:
        candidate?.dispatchModel?.annual?.exportedKWh ?? null,
      annualImportedKWh:
        candidate?.dispatchModel?.annual?.importedKWh ?? null,
      annualBatteryChargeKWh:
        candidate?.dispatchModel?.annual?.batteryChargeKWh ?? null,
      annualBatteryDischargeKWh:
        candidate?.dispatchModel?.annual?.batteryDischargeKWh ?? null,
      confidence:
        candidate?.dispatchModel?.confidence?.level || null,
    },

    selectedSystemTypeFit: getSelectedSystemTypeFit(
      candidate,
      selectedSystemType
    ),

    bestFitSystemType: getBestFitSystemType(candidate),

    rejectionCodes: getReasonCodes(rejectionReasons),
    warningCodes: getReasonCodes(warningReasons),

    keyRejectionReasons: rejectionReasons.slice(0, 5).map((reason) => ({
      code: reason.code,
      title: reason.title,
      message: reason.message,
      severity: reason.severity,
    })),

    keyWarningReasons: warningReasons.slice(0, 5).map((reason) => ({
      code: reason.code,
      title: reason.title,
      message: reason.message,
      severity: reason.severity,
    })),
  };
}

function buildViabilitySummary(candidates = []) {
  const summary = {
    total: candidates.length,
    viable: 0,
    viable_with_warnings: 0,
    rejected: 0,
    unknown: 0,
    eligibleForFutureOptimiser: 0,
  };

  for (const candidate of candidates) {
    const status = getCandidateStatus(candidate);

    if (status === "viable") summary.viable += 1;
    else if (status === "viable_with_warnings") summary.viable_with_warnings += 1;
    else if (status === "rejected") summary.rejected += 1;
    else summary.unknown += 1;

    if (isEligibleForFutureOptimiser(candidate)) {
      summary.eligibleForFutureOptimiser += 1;
    }
  }

  const rejectionReasons = collectReasons(candidates, "rejection");
  const warningReasons = collectReasons(candidates, "warning");

  return {
    ...summary,

    commonRejectionReasons: getTopReasons(rejectionReasons, 8),
    commonWarningReasons: getTopReasons(warningReasons, 8),

    readiness:
      summary.total === 0
        ? "no_candidates_generated"
        : summary.eligibleForFutureOptimiser === 0
          ? "no_viable_candidates"
          : summary.viable > 0
            ? "ready_for_future_cost_performance_modelling"
            : "warning_candidates_available_for_review",
  };
}

function buildProfileFitSummary(candidates = []) {
  const bestFitCounts = {};

  for (const candidate of candidates) {
    const best = candidate?.bestFitSystemType?.systemType || "unknown";
    bestFitCounts[best] = (bestFitCounts[best] || 0) + 1;
  }

  return {
    bestFitCounts,
  };
}

function buildCandidateShortlist({
  candidates = [],
  selectedSystemType = "balanced",
  maxShortlist = 8,
  maxRejectedExamples = 5,
} = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  const sorted = sortCandidatesForShortlist(safeCandidates, selectedSystemType);

  const eligible = sorted.filter(isEligibleForFutureOptimiser);
  const rejected = sorted.filter(
    (candidate) => getCandidateStatus(candidate) === "rejected"
  );

  const viable = sorted.filter(
    (candidate) => getCandidateStatus(candidate) === "viable"
  );

  const viableWithWarnings = sorted.filter(
    (candidate) => getCandidateStatus(candidate) === "viable_with_warnings"
  );

  const shortlistedCandidates = eligible
    .slice(0, maxShortlist)
    .map((candidate) => summarizeCandidate(candidate, selectedSystemType));

  const rejectedExamples = rejected
    .slice(0, maxRejectedExamples)
    .map((candidate) => summarizeCandidate(candidate, selectedSystemType));

  const lowestCostEligible = [...eligible].sort(
    (a, b) => getCandidateCost(a) - getCandidateCost(b)
  )[0];

  const bestSelectedProfileFit = [...eligible].sort(
    (a, b) =>
      getSelectedScore(b, selectedSystemType) -
      getSelectedScore(a, selectedSystemType)
  )[0];

  const bestOverallFit = [...eligible].sort(
    (a, b) => getBestFitScore(b) - getBestFitScore(a)
  )[0];

  return {
    version: DESIGN_CANDIDATE_SHORTLIST_VERSION,
    mode: "candidate_shortlist_diagnostic",
    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    selectedSystemType,

    viabilitySummary: buildViabilitySummary(safeCandidates),
    profileFitSummary: buildProfileFitSummary(safeCandidates),

    shortlistSummary: {
      maxShortlist,
      eligibleCount: eligible.length,
      shortlistedCount: shortlistedCandidates.length,
      viableCount: viable.length,
      viableWithWarningsCount: viableWithWarnings.length,
      rejectedCount: rejected.length,
    },

    keyCandidateIds: {
      lowestCostEligible: lowestCostEligible?.candidateId || null,
      bestSelectedProfileFit: bestSelectedProfileFit?.candidateId || null,
      bestOverallFit: bestOverallFit?.candidateId || null,
    },

    shortlistedCandidates,
    rejectedExamples,

    assumptions: {
      note:
        "Candidate shortlist is diagnostic only. It identifies viable candidates for future optimiser stages, but does not yet change quote calculations, pricing, product selection or recommendations.",
    },
  };
}

module.exports = {
  DESIGN_CANDIDATE_SHORTLIST_VERSION,
  buildCandidateShortlist,
  buildViabilitySummary,
  summarizeCandidate,
};