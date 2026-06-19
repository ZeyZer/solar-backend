const ROOF_DESIGN_CONFIDENCE_VERSION = "2026-beta-1";

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function countBy(items = [], getter) {
  return items.reduce((acc, item) => {
    const key = getter(item) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function average(values = []) {
  const nums = values.filter((value) => Number.isFinite(Number(value)));

  if (!nums.length) return null;

  return round2(nums.reduce((sum, value) => sum + Number(value), 0) / nums.length);
}

function getCandidateId(candidate = {}, index = 0) {
  return candidate?.candidateId || candidate?.id || `candidate-${index + 1}`;
}

function getConfidenceLabel(score = null) {
  const n = numberOrNull(score);

  if (n === null) return "Unknown confidence";
  if (n >= 80) return "High confidence";
  if (n >= 55) return "Medium confidence";
  return "Low confidence";
}

function getConfidenceLevel(score = null) {
  const n = numberOrNull(score);

  if (n === null) return "unknown";
  if (n >= 80) return "high";
  if (n >= 55) return "medium";
  return "low";
}

function buildWarning(code, severity, message) {
  return {
    code,
    severity,
    message,
  };
}

function getManualPolygonReadiness(manualRoofPolygonModel = null) {
  return manualRoofPolygonModel?.summary?.readiness || "manual_polygons_not_provided";
}

function classifyRoofConfidence({
  roofGeometryInput = null,
  manualRoofPolygonModel = null,
  roofGeometryAssumption = null,
} = {}) {
  const inputBasis =
    roofGeometryAssumption?.inputBasis ||
    roofGeometryInput?.sourceStatus ||
    "unknown_roof_geometry_input";

  const assumptionSummary = roofGeometryAssumption?.summary || {};
  const inputSummary = roofGeometryInput?.summary || {};
  const manualReadiness = getManualPolygonReadiness(manualRoofPolygonModel);

  const physicalFitVerified =
    assumptionSummary.physicalFitVerified === true ||
    inputSummary.physicalFitVerified === true;

  const panelDimensionFitVerified =
    assumptionSummary.panelDimensionFitVerified === true;

  if (physicalFitVerified && panelDimensionFitVerified) {
    return {
      confidenceCategory: "verified_panel_fit",
      confidenceScore: 92,
      confidenceLevel: "high",
      sourceDescription: "Verified roof and panel-fit geometry",
    };
  }

  if (physicalFitVerified) {
    return {
      confidenceCategory: "verified_roof_geometry",
      confidenceScore: 85,
      confidenceLevel: "high",
      sourceDescription: "Verified roof geometry",
    };
  }

  if (
    manualReadiness === "manual_polygons_ready_for_future_area_estimation"
  ) {
    return {
      confidenceCategory: "manual_polygon_ready",
      confidenceScore: 68,
      confidenceLevel: "medium",
      sourceDescription: "Manually drawn roof polygon",
    };
  }

  if (
    manualReadiness === "manual_polygons_ready_but_need_review" ||
    manualReadiness === "manual_polygons_partially_ready"
  ) {
    return {
      confidenceCategory: "manual_polygon_needs_review",
      confidenceScore: 55,
      confidenceLevel: "medium",
      sourceDescription: "Manually drawn roof polygon requiring review",
    };
  }

  if (manualReadiness === "manual_polygons_not_ready") {
    return {
      confidenceCategory: "manual_polygon_not_ready",
      confidenceScore: 35,
      confidenceLevel: "low",
      sourceDescription: "Manual polygon provided but not ready",
    };
  }

  if (inputSummary.hasAreaGeometry === true) {
    return {
      confidenceCategory: "area_geometry_available",
      confidenceScore: 60,
      confidenceLevel: "medium",
      sourceDescription: "Roof area geometry available",
    };
  }

  if (
    inputBasis === "user_estimated_panel_count_only" ||
    inputSummary.onlyPanelCountAssumptions === true
  ) {
    return {
      confidenceCategory: "user_estimated_panel_count",
      confidenceScore: 35,
      confidenceLevel: "low",
      sourceDescription: "User-estimated panel count",
    };
  }

  if (inputBasis === "no_roof_geometry_input") {
    return {
      confidenceCategory: "missing_roof_geometry",
      confidenceScore: 20,
      confidenceLevel: "low",
      sourceDescription: "Missing roof geometry input",
    };
  }

  return {
    confidenceCategory: "unknown_roof_geometry_confidence",
    confidenceScore: 25,
    confidenceLevel: "low",
    sourceDescription: "Unknown roof geometry confidence",
  };
}

function buildMessages({
  classification = {},
  roofGeometryInput = null,
  manualRoofPolygonModel = null,
  roofGeometryAssumption = null,
} = {}) {
  const inputSummary = roofGeometryInput?.summary || {};
  const assumptionSummary = roofGeometryAssumption?.summary || {};
  const manualSummary = manualRoofPolygonModel?.summary || {};

  const warnings = [];

  const category = classification.confidenceCategory;

  if (category === "user_estimated_panel_count") {
    warnings.push(
      buildWarning(
        "user_estimated_panel_count_only",
        "medium",
        "Roof capacity is based on the user-estimated number of panels, not measured roof dimensions."
      )
    );

    warnings.push(
      buildWarning(
        "larger_panel_fit_not_confirmed",
        "medium",
        "The system can compare candidates using the same assumed panel count, but it cannot confirm that physically larger panels will fit."
      )
    );

    return {
      customerSafeSummary:
        "This estimate is based on the number of panels expected to fit on the roof. It does not yet verify the measured roof dimensions or final panel layout.",
      internalSummary:
        "Roof input is currently panel-count based only. Use as assumed panel positions, not as verified layout geometry.",
      quoteDisclaimer:
        "Final panel quantity, panel model and layout must be confirmed by survey or roof measurement before installation.",
      primaryLimitation:
        "Measured roof dimensions are not available.",
      recommendedNextAction:
        "Use this result as an assumed-panel-count estimate only. Do not claim that larger panels or additional panels will fit.",
      warnings,
    };
  }

  if (category === "manual_polygon_ready") {
    warnings.push(
      buildWarning(
        "manual_polygon_not_surveyed",
        "low",
        "Manual roof polygon area is approximate and should be reviewed before final design."
      )
    );

    return {
      customerSafeSummary:
        "This estimate can use a manually drawn roof area as a better roof-size starting point, but final panel layout still needs survey/design confirmation.",
      internalSummary:
        "Manual polygon appears ready for future area-based capacity estimation. It is not yet a true panel layout.",
      quoteDisclaimer:
        "Drawn roof areas improve the estimate, but final panel placement, setbacks and obstacles must still be checked.",
      primaryLimitation:
        "Manual polygon has not been converted into a verified panel layout.",
      recommendedNextAction:
        "Proceed to future area-based panel capacity estimation, then layout checks.",
      warnings,
    };
  }

  if (category === "manual_polygon_needs_review") {
    warnings.push(
      buildWarning(
        "manual_polygon_needs_review",
        "medium",
        "Manual roof polygon appears usable but needs orientation, tilt, area or data review before future layout estimation."
      )
    );

    return {
      customerSafeSummary:
        "A roof area has been drawn, but some roof details need checking before it can support a more accurate layout estimate.",
      internalSummary:
        "Manual polygon is present but requires review before relying on it for area-based panel capacity estimation.",
      quoteDisclaimer:
        "The drawn roof area should be reviewed before using it for layout or panel capacity assumptions.",
      primaryLimitation:
        "Manual polygon data is incomplete or needs review.",
      recommendedNextAction:
        "Review the drawn roof polygon, orientation, tilt and area before using it in future layout estimation.",
      warnings,
    };
  }

  if (category === "manual_polygon_not_ready") {
    warnings.push(
      buildWarning(
        "manual_polygon_not_ready",
        "high",
        "Manual roof polygon data is not ready for future area-based panel estimation."
      )
    );

    return {
      customerSafeSummary:
        "A drawn roof area was provided, but it is incomplete and cannot yet support a reliable roof-size estimate.",
      internalSummary:
        "Manual polygon is invalid or incomplete. Do not use it for panel capacity estimation.",
      quoteDisclaimer:
        "Roof drawing needs correction before it can improve the estimate.",
      primaryLimitation:
        "Manual polygon is invalid or incomplete.",
      recommendedNextAction:
        "Fix the manual polygon coordinates and required roof details.",
      warnings,
    };
  }

  if (category === "area_geometry_available") {
    warnings.push(
      buildWarning(
        "area_geometry_not_layout",
        "low",
        "Roof area geometry is available, but exact panel layout has not been calculated."
      )
    );

    return {
      customerSafeSummary:
        "This estimate uses roof area information, but final panel placement has not yet been confirmed.",
      internalSummary:
        "Area geometry exists and can support future area-based estimation, but not true layout optimisation yet.",
      quoteDisclaimer:
        "Final layout, setbacks and obstacles must be checked before installation.",
      primaryLimitation:
        "Area geometry has not yet been converted into panel placement.",
      recommendedNextAction:
        "Use area geometry for future capacity estimation, then proceed to layout skeletons.",
      warnings,
    };
  }

  if (
    category === "verified_roof_geometry" ||
    category === "verified_panel_fit"
  ) {
    return {
      customerSafeSummary:
        "This estimate is based on higher-confidence roof geometry, but final installation details should still be confirmed before work starts.",
      internalSummary:
        "Roof geometry has been marked as verified. Suitable for higher-confidence downstream layout assumptions.",
      quoteDisclaimer:
        "Final electrical design and installation details must still be confirmed.",
      primaryLimitation:
        category === "verified_panel_fit"
          ? "Panel fit is marked as verified, but electrical design still requires final checks."
          : "Roof geometry is marked as verified, but panel-dimension fit may still need confirmation.",
      recommendedNextAction:
        "Use verified geometry in future layout, topology and inverter-envelope stages.",
      warnings: [],
    };
  }

  warnings.push(
    buildWarning(
      "roof_geometry_confidence_unknown",
      "medium",
      "Roof geometry confidence is unknown or incomplete."
    )
  );

  return {
    customerSafeSummary:
      "This estimate is based on limited roof information and should be treated as an early guide only.",
    internalSummary:
      "Roof geometry input is incomplete or unknown. Use only as a diagnostic placeholder.",
    quoteDisclaimer:
      "Roof size, panel quantity and layout must be confirmed before installation.",
    primaryLimitation:
      "Roof geometry input is incomplete.",
    recommendedNextAction:
      "Collect panel count, roof dimensions, manual polygon or verified roof geometry.",
    warnings,
  };
}

function buildRoofDesignConfidenceForCandidate({
  candidate = {},
  roofGeometryInput = null,
  manualRoofPolygonModel = null,
  index = 0,
} = {}) {
  const roofGeometryAssumption = candidate?.roofGeometryAssumption || null;

  const classification = classifyRoofConfidence({
    roofGeometryInput,
    manualRoofPolygonModel,
    roofGeometryAssumption,
  });

  const messages = buildMessages({
    classification,
    roofGeometryInput,
    manualRoofPolygonModel,
    roofGeometryAssumption,
  });

  const assumptionSummary = roofGeometryAssumption?.summary || {};
  const inputSummary = roofGeometryInput?.summary || {};

  return {
    version: ROOF_DESIGN_CONFIDENCE_VERSION,
    mode: "roof_design_confidence_beta",

    candidateId: getCandidateId(candidate, index),

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    inputBasis:
      roofGeometryAssumption?.inputBasis ||
      roofGeometryInput?.sourceStatus ||
      "unknown_roof_geometry_input",

    confidenceCategory: classification.confidenceCategory,
    confidenceLevel: classification.confidenceLevel,
    confidenceScore: classification.confidenceScore,
    confidenceLabel: getConfidenceLabel(classification.confidenceScore),
    sourceDescription: classification.sourceDescription,

    roofGeometrySignals: {
      roofPlaneCount:
        assumptionSummary.roofPlaneCount ??
        inputSummary.roofPlaneCount ??
        0,
      totalAssumedPanelPositions:
        assumptionSummary.totalAssumedPanelPositions ??
        inputSummary.totalAssumedPanelPositions ??
        0,
      totalUsableAreaM2:
        inputSummary.totalUsableAreaM2 ?? null,
      candidatePanelWattage:
        assumptionSummary.candidatePanelWattage ?? null,
      assumedSystemSizeKwp:
        assumptionSummary.assumedSystemSizeKwp ?? null,
      physicalFitVerified:
        assumptionSummary.physicalFitVerified === true,
      panelDimensionFitVerified:
        assumptionSummary.panelDimensionFitVerified === true,
    },

    optimiserCapabilities: {
      canCompareSamePanelCountOptions:
        assumptionSummary.canCompareSamePanelCountOptions === true ||
        roofGeometryInput?.currentOptimiserInterpretation
          ?.canCompareSamePanelCountOptions === true,
      canConfirmLargerPanelFit: false,
      canConfirmMorePanelsFit: false,
      canRunTrueLayoutOptimisation: false,
      canUseForFutureAreaBasedEstimate:
        manualRoofPolygonModel?.summary?.canSupportFutureAreaBasedPanelEstimate === true ||
        inputSummary.hasAreaGeometry === true,
    },

    customerSafeMessaging: {
      suitableForCustomerDisplayLater: true,
      confidenceLabel: getConfidenceLabel(classification.confidenceScore),
      summary: messages.customerSafeSummary,
      disclaimer: messages.quoteDisclaimer,
      primaryLimitation: messages.primaryLimitation,
    },

    internalMessaging: {
      summary: messages.internalSummary,
      recommendedNextAction: messages.recommendedNextAction,
    },

    warnings: messages.warnings,

    assumptions: {
      note:
        "Roof design confidence is diagnostic messaging only. It does not affect calculations, pricing, ranking, filtering or recommendations.",
    },

    limitations: [
      "This does not verify final panel layout.",
      "This does not confirm that larger panels will fit.",
      "This does not confirm that additional panels will fit.",
      "This does not perform satellite, LiDAR or surveyed roof detection.",
      "This is not used for customer-facing recommendations yet.",
    ],
  };
}

function applyRoofDesignConfidenceToCandidates({
  candidates = [],
  roofGeometryInput = null,
  manualRoofPolygonModel = null,
} = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  return safeCandidates.map((candidate, index) => ({
    ...candidate,
    roofDesignConfidence: buildRoofDesignConfidenceForCandidate({
      candidate,
      roofGeometryInput,
      manualRoofPolygonModel,
      index,
    }),
  }));
}

function buildRoofDesignConfidenceSummary({ candidates = [] } = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  const reports = safeCandidates
    .map((candidate) => candidate.roofDesignConfidence)
    .filter(Boolean);

  const confidenceScores = reports
    .map((report) => numberOrNull(report.confidenceScore))
    .filter((score) => score !== null);

  const averageConfidenceScore = average(confidenceScores);
  const averageConfidenceLevel = getConfidenceLevel(averageConfidenceScore);

  const lowConfidenceReports = reports.filter(
    (report) => report.confidenceLevel === "low"
  );

  const warningCount = reports.reduce(
    (sum, report) => sum + asArray(report.warnings).length,
    0
  );

  const canUseForFutureAreaBasedEstimate = reports.some(
    (report) =>
      report.optimiserCapabilities?.canUseForFutureAreaBasedEstimate === true
  );

  const onlyAssumedPanelCount =
    reports.length > 0 &&
    reports.every(
      (report) => report.confidenceCategory === "user_estimated_panel_count"
    );

  return {
    version: ROOF_DESIGN_CONFIDENCE_VERSION,
    mode: "roof_design_confidence_summary_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    candidateCount: safeCandidates.length,
    reportedCandidateCount: reports.length,

    averageConfidenceScore,
    averageConfidenceLevel,
    averageConfidenceLabel: getConfidenceLabel(averageConfidenceScore),

    confidenceCategoryCounts: countBy(
      reports,
      (report) => report.confidenceCategory
    ),

    confidenceLevelCounts: countBy(
      reports,
      (report) => report.confidenceLevel
    ),

    warningCount,

    lowConfidenceCandidateIds: lowConfidenceReports.map(
      (report) => report.candidateId
    ),

    canUseForFutureAreaBasedEstimate,
    onlyAssumedPanelCount,

    globalCustomerSafeMessage:
      onlyAssumedPanelCount
        ? "This estimate is based on assumed panel quantities rather than measured roof geometry. It should be treated as an early guide until roof dimensions or a drawn roof area are confirmed."
        : canUseForFutureAreaBasedEstimate
          ? "Roof geometry information is available and can support future area-based layout estimation, but final panel placement still needs confirmation."
          : "Roof geometry confidence is limited and further roof information is needed before accurate layout optimisation.",

    readiness:
      reports.length === 0
        ? "roof_design_confidence_not_available"
        : onlyAssumedPanelCount
          ? "ready_for_panel_count_assumption_messaging"
          : canUseForFutureAreaBasedEstimate
            ? "ready_for_area_geometry_confidence_messaging"
            : "roof_design_confidence_needs_better_input",

    recommendedNextAction:
      onlyAssumedPanelCount
        ? "Add manual roof polygon or roof dimension inputs before claiming physical panel fit or maximum panel count."
        : canUseForFutureAreaBasedEstimate
          ? "Proceed to future area-based panel capacity estimation."
          : "Collect better roof geometry before layout optimisation.",

    assumptions: {
      note:
        "This summary provides confidence and messaging only. It does not affect the optimiser outputs yet.",
    },
  };
}

module.exports = {
  ROOF_DESIGN_CONFIDENCE_VERSION,
  buildRoofDesignConfidenceForCandidate,
  applyRoofDesignConfidenceToCandidates,
  buildRoofDesignConfidenceSummary,
};