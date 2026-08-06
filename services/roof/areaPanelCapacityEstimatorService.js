const AREA_PANEL_CAPACITY_ESTIMATOR_VERSION = "2026-beta-1";

const DEFAULT_PANEL_AREA_M2_BY_WATTAGE = [
  {
    maxWattage: 430,
    assumedAreaM2: 1.95,
  },
  {
    maxWattage: 470,
    assumedAreaM2: 2.05,
  },
  {
    maxWattage: 520,
    assumedAreaM2: 2.25,
  },
  {
    maxWattage: Infinity,
    assumedAreaM2: 2.45,
  },
];

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

function round1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
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

function getPanel(candidate = {}) {
  return (
    candidate?.products?.panel ||
    candidate?.panel ||
    candidate?.hardware?.panel ||
    candidate?.selectedPanel ||
    null
  );
}

function getNormalisedPanel(candidate = {}) {
  return candidate?.hardwareMetadataNormalisation?.products?.panel || null;
}

function getPanelWattage(candidate = {}) {
  const normalisedPanel = getNormalisedPanel(candidate);
  const panel = getPanel(candidate);

  return numberOrNull(
    normalisedPanel?.power?.wattage ??
      normalisedPanel?.wattage ??
      normalisedPanel?.watts ??
      panel?.wattage ??
      panel?.watts ??
      panel?.powerW ??
      panel?.moduleWattage
  );
}

function normaliseDimensionMetres(value) {
  const n = numberOrNull(value);

  if (n === null) return null;

  // If the value is probably millimetres, convert to metres.
  if (n > 20) {
    return round2(n / 1000);
  }

  return round2(n);
}

function getPanelDimensions(candidate = {}) {
  const normalisedPanel = getNormalisedPanel(candidate);
  const panel = getPanel(candidate);

  const widthM = normaliseDimensionMetres(
    normalisedPanel?.dimensions?.widthM ??
      normalisedPanel?.dimensions?.width ??
      normalisedPanel?.widthM ??
      normalisedPanel?.widthMm ??
      panel?.dimensions?.widthM ??
      panel?.dimensions?.width ??
      panel?.dimensions?.widthMm ??
      panel?.widthM ??
      panel?.widthMm
  );

  const heightM = normaliseDimensionMetres(
    normalisedPanel?.dimensions?.heightM ??
      normalisedPanel?.dimensions?.height ??
      normalisedPanel?.heightM ??
      normalisedPanel?.heightMm ??
      normalisedPanel?.lengthM ??
      normalisedPanel?.lengthMm ??
      panel?.dimensions?.heightM ??
      panel?.dimensions?.height ??
      panel?.dimensions?.heightMm ??
      panel?.heightM ??
      panel?.heightMm ??
      panel?.lengthM ??
      panel?.lengthMm
  );

  const areaM2 =
    widthM !== null && heightM !== null ? round2(widthM * heightM) : null;

  return {
    widthM,
    heightM,
    areaM2,
    source: areaM2 !== null ? "catalogue_panel_dimensions" : "not_available",
  };
}

function getAssumedPanelAreaFromWattage(wattage = null) {
  const w = numberOrNull(wattage);

  if (w === null) {
    return {
      areaM2: null,
      source: "not_available",
    };
  }

  const match = DEFAULT_PANEL_AREA_M2_BY_WATTAGE.find(
    (item) => w <= item.maxWattage
  );

  return {
    areaM2: match?.assumedAreaM2 ?? null,
    source: "wattage_based_panel_area_assumption",
  };
}

function getPanelAreaModel(candidate = {}) {
  const wattage = getPanelWattage(candidate);
  const dimensions = getPanelDimensions(candidate);

  if (dimensions.areaM2 !== null) {
    return {
      panelWattage: wattage,
      panelWidthM: dimensions.widthM,
      panelHeightM: dimensions.heightM,
      panelAreaM2: dimensions.areaM2,
      panelAreaSource: dimensions.source,
      confidence: "medium",
      warning:
        "Panel area is based on catalogue dimensions where available, but layout fit is still not verified.",
    };
  }

  const assumedArea = getAssumedPanelAreaFromWattage(wattage);

  return {
    panelWattage: wattage,
    panelWidthM: null,
    panelHeightM: null,
    panelAreaM2: assumedArea.areaM2,
    panelAreaSource: assumedArea.source,
    confidence: assumedArea.areaM2 !== null ? "low" : "unknown",
    warning:
      assumedArea.areaM2 !== null
        ? "Panel area is estimated from wattage because catalogue dimensions were not available."
        : "Panel area cannot be estimated because panel wattage and dimensions are missing.",
  };
}

function getRoofPlanes(roofGeometryInput = null) {
  return asArray(roofGeometryInput?.roofPlanes);
}

function getUsableAreaM2(plane = {}) {
  return numberOrNull(
    plane?.geometry?.usableAreaM2 ??
      plane?.geometry?.areaM2 ??
      plane?.usableAreaM2 ??
      plane?.areaM2
  );
}

function getAssumedPanelPositions(plane = {}) {
  return numberOrNull(
    plane?.assumedPanelPositions ??
      plane?.panelCount ??
      plane?.panels
  );
}

function getGeometryConfidenceScore(plane = {}) {
  return numberOrNull(plane?.confidence?.confidenceScore);
}

function getRoofPlaneConfidenceLevel(plane = {}) {
  return plane?.confidence?.confidenceLevel || "unknown";
}

function getPackingFactors({ geometryType, source } = {}) {
  // These are deliberately broad and conservative.
  // They account for setbacks, unusable edges, imperfect panel tessellation,
  // and simple access/obstacle allowances. This is not a true layout engine.
  if (geometryType === "polygon" || source === "manual_roof_polygon") {
    return {
      low: 0.55,
      expected: 0.7,
      high: 0.82,
      source: "manual_polygon_simple_packing_assumption",
    };
  }

  if (geometryType === "dimensions") {
    return {
      low: 0.6,
      expected: 0.75,
      high: 0.88,
      source: "dimension_simple_packing_assumption",
    };
  }

  return {
    low: 0.5,
    expected: 0.65,
    high: 0.78,
    source: "generic_simple_packing_assumption",
  };
}

function buildIssue(code, severity, message) {
  return {
    code,
    severity,
    message,
  };
}

function estimatePanelsForPlane({ plane = {}, panelAreaModel = {} } = {}) {
  const usableAreaM2 = getUsableAreaM2(plane);
  const assumedPanelPositions = getAssumedPanelPositions(plane);
  const panelAreaM2 = numberOrNull(panelAreaModel.panelAreaM2);
  const panelWattage = numberOrNull(panelAreaModel.panelWattage);

  const issues = [];

  if (usableAreaM2 === null) {
    issues.push(
      buildIssue(
        "missing_roof_area",
        "high",
        "Roof plane does not have usable area geometry, so area-based panel capacity cannot be estimated."
      )
    );
  }

  if (panelAreaM2 === null) {
    issues.push(
      buildIssue(
        "missing_panel_area",
        "high",
        "Panel area is not available, so area-based panel capacity cannot be estimated."
      )
    );
  }

  if (panelWattage === null) {
    issues.push(
      buildIssue(
        "missing_panel_wattage",
        "medium",
        "Panel wattage is not available, so estimated kWp range cannot be calculated."
      )
    );
  }

  const highIssueCount = issues.filter((issue) => issue.severity === "high")
    .length;

  if (highIssueCount > 0) {
    return {
      roofId: plane.roofId,
      source: plane.source,
      geometryType: plane.geometryType,
      orientation: plane.orientation,
      tilt: plane.tilt,
      shading: plane.shading,

      usableAreaM2,
      assumedPanelPositions,

      panelAreaM2,
      panelAreaSource: panelAreaModel.panelAreaSource,
      panelWattage,

      capacityEstimateAvailable: false,
      estimateStatus:
        usableAreaM2 === null
          ? "not_available_missing_roof_area"
          : "not_available_missing_panel_area",

      packingFactors: null,

      estimatedPanelCountRange: {
        low: null,
        expected: null,
        high: null,
      },

      estimatedSystemSizeKwpRange: {
        low: null,
        expected: null,
        high: null,
      },

      comparisonToAssumedPanelCount: {
        available: false,
        assumedPanelPositions,
        expectedDifferencePanels: null,
        status: "not_available",
      },

      confidence: {
        level: "low",
        score: 25,
        reason:
          "Area-based estimate is not available because required roof area or panel area data is missing.",
      },

      issues,

      limitations: [
        "No area-based panel estimate is available for this roof plane.",
        "Current user-estimated panel count can still be used as an assumption if provided.",
      ],
    };
  }

  const packingFactors = getPackingFactors({
    geometryType: plane.geometryType,
    source: plane.source,
  });

  const lowPanels = Math.max(
    0,
    Math.floor((usableAreaM2 * packingFactors.low) / panelAreaM2)
  );

  const expectedPanels = Math.max(
    0,
    Math.floor((usableAreaM2 * packingFactors.expected) / panelAreaM2)
  );

  const highPanels = Math.max(
    0,
    Math.floor((usableAreaM2 * packingFactors.high) / panelAreaM2)
  );

  const expectedDifferencePanels =
    assumedPanelPositions !== null ? expectedPanels - assumedPanelPositions : null;

  let comparisonStatus = "no_assumed_panel_count_to_compare";

  if (expectedDifferencePanels !== null) {
    if (Math.abs(expectedDifferencePanels) <= 1) {
      comparisonStatus = "roughly_matches_assumed_panel_count";
    } else if (expectedDifferencePanels > 1) {
      comparisonStatus = "area_estimate_higher_than_assumed_panel_count";
    } else {
      comparisonStatus = "area_estimate_lower_than_assumed_panel_count";
    }
  }

  const geometryConfidenceScore = getGeometryConfidenceScore(plane);
  const panelAreaConfidenceScore =
    panelAreaModel.panelAreaSource === "catalogue_panel_dimensions"
      ? 65
      : panelAreaModel.panelAreaSource === "wattage_based_panel_area_assumption"
        ? 45
        : 25;

  const estimateConfidenceScore = average([
    geometryConfidenceScore ?? 50,
    panelAreaConfidenceScore,
  ]);

  const confidenceLevel =
    estimateConfidenceScore === null
      ? "unknown"
      : estimateConfidenceScore >= 75
        ? "high"
        : estimateConfidenceScore >= 50
          ? "medium"
          : "low";

  if (panelAreaModel.panelAreaSource === "wattage_based_panel_area_assumption") {
    issues.push(
      buildIssue(
        "panel_area_assumed_from_wattage",
        "medium",
        "Panel area is estimated from wattage because catalogue dimensions are not available."
      )
    );
  }

  if (plane.physicalFitVerified !== true) {
    issues.push(
      buildIssue(
        "physical_fit_not_verified",
        "medium",
        "This is an area-based estimate only; physical fit has not been verified."
      )
    );
  }

  return {
    roofId: plane.roofId,
    source: plane.source,
    geometryType: plane.geometryType,
    orientation: plane.orientation,
    tilt: plane.tilt,
    shading: plane.shading,

    usableAreaM2,
    assumedPanelPositions,

    panelAreaM2,
    panelAreaSource: panelAreaModel.panelAreaSource,
    panelWattage,

    capacityEstimateAvailable: true,
    estimateStatus: "area_based_capacity_estimate_available",

    packingFactors,

    estimatedPanelCountRange: {
      low: lowPanels,
      expected: expectedPanels,
      high: highPanels,
    },

    estimatedSystemSizeKwpRange: {
      low:
        panelWattage !== null
          ? round2((lowPanels * panelWattage) / 1000)
          : null,
      expected:
        panelWattage !== null
          ? round2((expectedPanels * panelWattage) / 1000)
          : null,
      high:
        panelWattage !== null
          ? round2((highPanels * panelWattage) / 1000)
          : null,
    },

    comparisonToAssumedPanelCount: {
      available: assumedPanelPositions !== null,
      assumedPanelPositions,
      expectedDifferencePanels,
      status: comparisonStatus,
    },

    confidence: {
      level: confidenceLevel,
      score: estimateConfidenceScore,
      roofGeometryConfidenceLevel: getRoofPlaneConfidenceLevel(plane),
      roofGeometryConfidenceScore: geometryConfidenceScore,
      panelAreaConfidence: panelAreaModel.confidence,
      reason:
        "Confidence is based on roof geometry confidence and panel area data availability.",
    },

    issues,

    limitations: [
      "This is a simple area-based capacity estimate, not a true panel layout.",
      "Portrait/landscape placement is not calculated.",
      "Setbacks and obstacles are not geometrically applied yet.",
      "This estimate does not confirm that larger panels will fit.",
      "This estimate does not confirm the final number of panels for installation.",
    ],
  };
}

function buildAreaPanelCapacityEstimateForCandidate({
  candidate = {},
  roofGeometryInput = null,
  index = 0,
} = {}) {
  const panelAreaModel = getPanelAreaModel(candidate);
  const roofPlanes = getRoofPlanes(roofGeometryInput);

  const roofPlaneEstimates = roofPlanes.map((plane) =>
    estimatePanelsForPlane({
      plane,
      panelAreaModel,
    })
  );

  const estimatesAvailable = roofPlaneEstimates.filter(
    (estimate) => estimate.capacityEstimateAvailable === true
  );

  const totalEstimatedPanelCountRange = estimatesAvailable.reduce(
    (acc, estimate) => ({
      low: acc.low + numberOrZero(estimate.estimatedPanelCountRange.low),
      expected:
        acc.expected +
        numberOrZero(estimate.estimatedPanelCountRange.expected),
      high: acc.high + numberOrZero(estimate.estimatedPanelCountRange.high),
    }),
    {
      low: 0,
      expected: 0,
      high: 0,
    }
  );

  const totalEstimatedSystemSizeKwpRange = estimatesAvailable.reduce(
    (acc, estimate) => ({
      low: acc.low + numberOrZero(estimate.estimatedSystemSizeKwpRange.low),
      expected:
        acc.expected +
        numberOrZero(estimate.estimatedSystemSizeKwpRange.expected),
      high: acc.high + numberOrZero(estimate.estimatedSystemSizeKwpRange.high),
    }),
    {
      low: 0,
      expected: 0,
      high: 0,
    }
  );

  const totalAssumedPanelPositions = roofPlanes.reduce(
    (sum, plane) => sum + numberOrZero(getAssumedPanelPositions(plane)),
    0
  );

  const confidenceScores = roofPlaneEstimates
    .map((estimate) => estimate.confidence?.score)
    .filter((score) => score !== null && score !== undefined);

  const averageConfidenceScore = average(confidenceScores);
  const averageConfidenceLevel =
    averageConfidenceScore === null
      ? "unknown"
      : averageConfidenceScore >= 75
        ? "high"
        : averageConfidenceScore >= 50
          ? "medium"
          : "low";

  const issueCount = roofPlaneEstimates.reduce(
    (sum, estimate) => sum + asArray(estimate.issues).length,
    0
  );

  const capacityEstimateAvailable = estimatesAvailable.length > 0;

  const expectedDifferencePanels =
    capacityEstimateAvailable && totalAssumedPanelPositions > 0
      ? totalEstimatedPanelCountRange.expected - totalAssumedPanelPositions
      : null;

  let comparisonStatus = "not_available";

  if (expectedDifferencePanels !== null) {
    if (Math.abs(expectedDifferencePanels) <= 1) {
      comparisonStatus = "roughly_matches_assumed_panel_count";
    } else if (expectedDifferencePanels > 1) {
      comparisonStatus = "area_estimate_higher_than_assumed_panel_count";
    } else {
      comparisonStatus = "area_estimate_lower_than_assumed_panel_count";
    }
  } else if (capacityEstimateAvailable) {
    comparisonStatus = "area_estimate_available_no_assumed_count";
  } else if (totalAssumedPanelPositions > 0) {
    comparisonStatus = "assumed_panel_count_available_no_area_estimate";
  }

  return {
    version: AREA_PANEL_CAPACITY_ESTIMATOR_VERSION,
    mode: "area_panel_capacity_estimate_beta",

    candidateId: getCandidateId(candidate, index),

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    inputBasis: roofGeometryInput?.sourceStatus || "unknown_roof_geometry_input",

    capacityEstimateAvailable,

    estimateStatus: capacityEstimateAvailable
      ? "area_based_capacity_estimate_available"
      : "area_based_capacity_estimate_not_available",

    panelAreaModel,

    summary: {
      roofPlaneCount: roofPlanes.length,
      estimatedRoofPlaneCount: estimatesAvailable.length,

      totalAssumedPanelPositions,

      totalEstimatedPanelCountRange: capacityEstimateAvailable
        ? totalEstimatedPanelCountRange
        : {
            low: null,
            expected: null,
            high: null,
          },

      totalEstimatedSystemSizeKwpRange: capacityEstimateAvailable
        ? {
            low: round2(totalEstimatedSystemSizeKwpRange.low),
            expected: round2(totalEstimatedSystemSizeKwpRange.expected),
            high: round2(totalEstimatedSystemSizeKwpRange.high),
          }
        : {
            low: null,
            expected: null,
            high: null,
          },

      comparisonToAssumedPanelCount: {
        available: expectedDifferencePanels !== null,
        expectedDifferencePanels,
        status: comparisonStatus,
      },

      confidenceLevel: averageConfidenceLevel,
      confidenceScore: averageConfidenceScore,

      issueCount,

      canSupportFutureAreaBasedPanelEstimate: capacityEstimateAvailable,
      canConfirmPanelFit: false,
      canConfirmLargerPanelFit: false,
      canConfirmMorePanelsFit: false,
      canRunTrueLayoutOptimisation: false,
    },

    roofPlaneEstimates,

    customerSafeMessaging: {
      suitableForCustomerDisplayLater: false,
      summary: capacityEstimateAvailable
        ? "A rough area-based panel capacity estimate is available, but it is not a final layout or survey-confirmed panel count."
        : "An area-based panel capacity estimate is not available yet because roof area geometry or panel area data is missing.",
      disclaimer:
        "Final panel quantity and layout must be confirmed by survey or detailed roof measurement before installation.",
    },

    assumptions: {
      note:
        "This is a diagnostic area-to-panel capacity estimate only. It does not confirm physical panel fit or alter quote calculations.",
    },

    limitations: [
      "This is not a true layout engine.",
      "Panel orientation, setbacks and obstacles are not geometrically calculated.",
      "Panel dimensions may be estimated if catalogue dimensions are unavailable.",
      "Larger panel fit is not confirmed.",
      "Additional panel fit is not confirmed.",
      "This estimate is not used for recommendations, ranking, pricing or calculations.",
    ],
  };
}

function applyAreaPanelCapacityEstimatesToCandidates({
  candidates = [],
  roofGeometryInput = null,
} = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  return safeCandidates.map((candidate, index) => ({
    ...candidate,
    areaPanelCapacityEstimate: buildAreaPanelCapacityEstimateForCandidate({
      candidate,
      roofGeometryInput,
      index,
    }),
  }));
}

function buildAreaPanelCapacityEstimateSummary({ candidates = [] } = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  const reports = safeCandidates
    .map((candidate) => candidate.areaPanelCapacityEstimate)
    .filter(Boolean);

  const availableReports = reports.filter(
    (report) => report.capacityEstimateAvailable === true
  );

  const confidenceScores = reports
    .map((report) => numberOrNull(report.summary?.confidenceScore))
    .filter((score) => score !== null);

  const averageConfidenceScore = average(confidenceScores);

  const totalIssueCount = reports.reduce(
    (sum, report) => sum + numberOrZero(report.summary?.issueCount),
    0
  );

  const expectedPanelCounts = availableReports
    .map((report) => numberOrNull(report.summary?.totalEstimatedPanelCountRange?.expected))
    .filter((value) => value !== null);

  const expectedSystemSizes = availableReports
    .map((report) => numberOrNull(report.summary?.totalEstimatedSystemSizeKwpRange?.expected))
    .filter((value) => value !== null);

  const canSupportFutureAreaBasedPanelEstimate = availableReports.length > 0;

  const allReportsUnavailable =
    reports.length > 0 && availableReports.length === 0;

  return {
    version: AREA_PANEL_CAPACITY_ESTIMATOR_VERSION,
    mode: "area_panel_capacity_estimate_summary_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    candidateCount: safeCandidates.length,
    reportedCandidateCount: reports.length,
    areaEstimateAvailableCandidateCount: availableReports.length,
    areaEstimateUnavailableCandidateCount:
      reports.length - availableReports.length,

    estimateStatusCounts: countBy(
      reports,
      (report) => report.estimateStatus
    ),

    comparisonStatusCounts: countBy(
      reports,
      (report) => report.summary?.comparisonToAssumedPanelCount?.status
    ),

    averageConfidenceScore,
    averageConfidenceLevel:
      averageConfidenceScore === null
        ? "unknown"
        : averageConfidenceScore >= 75
          ? "high"
          : averageConfidenceScore >= 50
            ? "medium"
            : "low",

    totalIssueCount,

    expectedPanelCountRangeAcrossCandidates: {
      min:
        expectedPanelCounts.length > 0
          ? Math.min(...expectedPanelCounts)
          : null,
      average: average(expectedPanelCounts),
      max:
        expectedPanelCounts.length > 0
          ? Math.max(...expectedPanelCounts)
          : null,
    },

    expectedSystemSizeKwpRangeAcrossCandidates: {
      min:
        expectedSystemSizes.length > 0
          ? round2(Math.min(...expectedSystemSizes))
          : null,
      average: average(expectedSystemSizes),
      max:
        expectedSystemSizes.length > 0
          ? round2(Math.max(...expectedSystemSizes))
          : null,
    },

    canSupportFutureAreaBasedPanelEstimate,
    canConfirmPanelFit: false,
    canConfirmLargerPanelFit: false,
    canConfirmMorePanelsFit: false,
    canRunTrueLayoutOptimisation: false,

    readiness:
      reports.length === 0
        ? "area_panel_capacity_estimate_not_available"
        : allReportsUnavailable
          ? "ready_for_panel_count_only_no_area_estimate"
          : "ready_for_future_area_based_panel_capacity_estimation",

    recommendedNextAction:
      allReportsUnavailable
        ? "Collect roof area geometry or panel dimensions before using area-based panel capacity estimates."
        : "Use this diagnostic estimate as the foundation for a future roof layout skeleton, but do not treat it as verified panel fit.",

    assumptions: {
      note:
        "This summary describes diagnostic area-to-panel estimates only. It does not change quote outputs.",
    },
  };
}

module.exports = {
  AREA_PANEL_CAPACITY_ESTIMATOR_VERSION,
  buildAreaPanelCapacityEstimateForCandidate,
  applyAreaPanelCapacityEstimatesToCandidates,
  buildAreaPanelCapacityEstimateSummary,
};