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

    financial: {
      mode: candidate?.financialModel?.mode || null,
      source: candidate?.financialModel?.source || null,
      annualBaselineBill:
        candidate?.financialModel?.annual?.baselineBill ?? null,
      annualAfterNetBill:
        candidate?.financialModel?.annual?.afterNetBill ?? null,
      annualBillSavings:
        candidate?.financialModel?.annual?.billSavings ?? null,
      annualSegIncome:
        candidate?.financialModel?.annual?.segIncome ?? null,
      totalAnnualBenefit:
        candidate?.financialModel?.annual?.totalAnnualBenefit ?? null,
      estimatedInstalledCost:
        candidate?.financialModel?.systemCost?.estimatedInstalledCost ?? null,
      simplePaybackYears:
        candidate?.financialModel?.payback?.simplePaybackYears ?? null,
      lifetimeSavings:
        candidate?.financialModel?.payback?.lifetimeSavings ?? null,
      batteryControlStrategyId:
        candidate?.financialModel?.batteryControlStrategy?.strategyId ?? null,
      batteryControlStrategyLabel:
        candidate?.financialModel?.batteryControlStrategy?.label ?? null,
      confidence:
        candidate?.financialModel?.confidence?.level || null,
    },

    hardwareMetadata: {
      mode: candidate?.hardwareMetadataNormalisation?.mode || null,
      dataCompletenessScore:
        candidate?.hardwareMetadataNormalisation?.summary?.dataCompletenessScore ?? null,
      missingRequiredFieldCount:
        candidate?.hardwareMetadataNormalisation?.summary?.missingRequiredFieldCount ?? null,
      panelWattage:
        candidate?.hardwareMetadataNormalisation?.summary?.panelWattage ?? null,
      inverterType:
        candidate?.hardwareMetadataNormalisation?.summary?.inverterType ?? null,
      inverterHybrid:
        candidate?.hardwareMetadataNormalisation?.summary?.inverterHybrid ?? null,
      inverterBackupCompatible:
        candidate?.hardwareMetadataNormalisation?.summary?.inverterBackupCompatible ?? null,
      batteryUsableKWh:
        candidate?.hardwareMetadataNormalisation?.summary?.batteryUsableKWh ?? null,
      appliedToFiltering:
        candidate?.hardwareMetadataNormalisation?.appliedToFiltering === true,
      appliedToRanking:
        candidate?.hardwareMetadataNormalisation?.appliedToRanking === true,
    },

    preferenceConstraints: {
      mode: candidate?.preferenceConstraintEvaluation?.mode || null,
      hardConstraintStatus:
        candidate?.preferenceConstraintEvaluation?.summary?.hardConstraintStatus || null,
      hardConstraintCount:
        candidate?.preferenceConstraintEvaluation?.summary?.hardConstraintCount ?? null,
      passedHardConstraints:
        candidate?.preferenceConstraintEvaluation?.summary?.passedHardConstraints ?? null,
      failedHardConstraints:
        candidate?.preferenceConstraintEvaluation?.summary?.failedHardConstraints ?? null,
      unknownHardConstraints:
        candidate?.preferenceConstraintEvaluation?.summary?.unknownHardConstraints ?? null,
      failedConstraintIds:
        candidate?.preferenceConstraintEvaluation?.summary?.failedConstraintIds || [],
      appliedToFiltering:
        candidate?.preferenceConstraintEvaluation?.appliedToFiltering === true,
      appliedToRanking:
        candidate?.preferenceConstraintEvaluation?.appliedToRanking === true,
    },

    designPreferenceScore: {
      mode: candidate?.designPreferenceScore?.mode || null,
      selectedSystemType:
        candidate?.designPreferenceScore?.selectedSystemType || null,
      weightedScore:
        candidate?.designPreferenceScore?.weightedScore ?? null,
      scoreBand:
        candidate?.designPreferenceScore?.scoreBand || null,
      componentScores:
        candidate?.designPreferenceScore?.componentScores || null,
      appliedToFiltering:
        candidate?.designPreferenceScore?.appliedToFiltering === true,
      appliedToRanking:
        candidate?.designPreferenceScore?.appliedToRanking === true,
    },

    diagnosticPruningPreview: {
      mode: candidate?.diagnosticPruningPreview?.mode || null,
      compatibilityStatus:
        candidate?.diagnosticPruningPreview?.compatibilityStatus || null,
      hardConstraintStatus:
        candidate?.diagnosticPruningPreview?.hardConstraintStatus || null,
      provisionalTier:
        candidate?.diagnosticPruningPreview?.provisionalTier || null,
      previewAction:
        candidate?.diagnosticPruningPreview?.previewAction || null,
      wouldCarryForwardForFutureOptimisation:
        candidate?.diagnosticPruningPreview
          ?.wouldCarryForwardForFutureOptimisation ?? null,
      carryForwardScore:
        candidate?.diagnosticPruningPreview?.carryForwardScore ?? null,
      reasons:
        candidate?.diagnosticPruningPreview?.reasons || [],
      appliedToFiltering:
        candidate?.diagnosticPruningPreview?.appliedToFiltering === true,
      appliedToRanking:
        candidate?.diagnosticPruningPreview?.appliedToRanking === true,
    },

    roofGeometry: {
      mode: candidate?.roofGeometryAssumption?.mode || null,
      inputBasis:
        candidate?.roofGeometryAssumption?.inputBasis || null,
      confidenceLevel:
        candidate?.roofGeometryAssumption?.summary?.confidenceLevel || null,
      confidenceScore:
        candidate?.roofGeometryAssumption?.summary?.confidenceScore ?? null,
      totalAssumedPanelPositions:
        candidate?.roofGeometryAssumption?.summary
          ?.totalAssumedPanelPositions ?? null,
      candidatePanelWattage:
        candidate?.roofGeometryAssumption?.summary
          ?.candidatePanelWattage ?? null,
      assumedSystemSizeKwp:
        candidate?.roofGeometryAssumption?.summary
          ?.assumedSystemSizeKwp ?? null,
      physicalFitVerified:
        candidate?.roofGeometryAssumption?.summary
          ?.physicalFitVerified === true,
      panelCountOptimisationAvailable:
        candidate?.roofGeometryAssumption?.summary
          ?.panelCountOptimisationAvailable === true,
      trueLayoutOptimisationAvailable:
        candidate?.roofGeometryAssumption?.summary
          ?.trueLayoutOptimisationAvailable === true,
      canCompareSamePanelCountOptions:
        candidate?.roofGeometryAssumption?.summary
          ?.canCompareSamePanelCountOptions === true,
      canConfirmLargerPanelFit:
        candidate?.roofGeometryAssumption?.summary
          ?.canConfirmLargerPanelFit === true,
      appliedToFiltering:
        candidate?.roofGeometryAssumption?.appliedToFiltering === true,
      appliedToRanking:
        candidate?.roofGeometryAssumption?.appliedToRanking === true,
    },

    roofDesignConfidence: {
      mode: candidate?.roofDesignConfidence?.mode || null,
      inputBasis:
        candidate?.roofDesignConfidence?.inputBasis || null,
      confidenceCategory:
        candidate?.roofDesignConfidence?.confidenceCategory || null,
      confidenceLevel:
        candidate?.roofDesignConfidence?.confidenceLevel || null,
      confidenceScore:
        candidate?.roofDesignConfidence?.confidenceScore ?? null,
      confidenceLabel:
        candidate?.roofDesignConfidence?.confidenceLabel || null,
      sourceDescription:
        candidate?.roofDesignConfidence?.sourceDescription || null,
      customerSafeSummary:
        candidate?.roofDesignConfidence?.customerSafeMessaging?.summary || null,
      primaryLimitation:
        candidate?.roofDesignConfidence?.customerSafeMessaging
          ?.primaryLimitation || null,
      recommendedNextAction:
        candidate?.roofDesignConfidence?.internalMessaging
          ?.recommendedNextAction || null,
      warningCount:
        candidate?.roofDesignConfidence?.warnings?.length ?? 0,
      canUseForFutureAreaBasedEstimate:
        candidate?.roofDesignConfidence?.optimiserCapabilities
          ?.canUseForFutureAreaBasedEstimate === true,
      canConfirmLargerPanelFit:
        candidate?.roofDesignConfidence?.optimiserCapabilities
          ?.canConfirmLargerPanelFit === true,
      canConfirmMorePanelsFit:
        candidate?.roofDesignConfidence?.optimiserCapabilities
          ?.canConfirmMorePanelsFit === true,
      appliedToFiltering:
        candidate?.roofDesignConfidence?.appliedToFiltering === true,
      appliedToRanking:
        candidate?.roofDesignConfidence?.appliedToRanking === true,
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