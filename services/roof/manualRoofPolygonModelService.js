const MANUAL_ROOF_POLYGON_MODEL_VERSION = "2026-beta-1";

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

function normaliseString(value, fallback = null) {
  const str = String(value ?? "").trim();
  return str || fallback;
}

function getRoofPlanes(roofGeometryInput = null) {
  return asArray(roofGeometryInput?.roofPlanes);
}

function isManualPolygonPlane(plane = {}) {
  return (
    plane.source === "manual_roof_polygon" ||
    plane.geometryType === "polygon"
  );
}

function getCoordinates(plane = {}) {
  return asArray(plane?.geometry?.coordinates)
    .map((point) => ({
      lat: numberOrNull(point?.lat),
      lng: numberOrNull(point?.lng),
    }))
    .filter((point) => point.lat !== null && point.lng !== null);
}

function estimatePolygonAreaM2(coordinates = []) {
  const points = asArray(coordinates);

  if (points.length < 3) {
    return null;
  }

  const originLatRad = (points[0].lat * Math.PI) / 180;
  const metresPerDegreeLat = 111320;
  const metresPerDegreeLng = 111320 * Math.cos(originLatRad);

  const projected = points.map((point) => ({
    x: point.lng * metresPerDegreeLng,
    y: point.lat * metresPerDegreeLat,
  }));

  let sum = 0;

  for (let i = 0; i < projected.length; i += 1) {
    const current = projected[i];
    const next = projected[(i + 1) % projected.length];

    sum += current.x * next.y - next.x * current.y;
  }

  return round2(Math.abs(sum) / 2);
}

function getCoordinateBounds(coordinates = []) {
  const points = asArray(coordinates);

  if (!points.length) {
    return null;
  }

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);

  return {
    minLat: round2(Math.min(...lats)),
    maxLat: round2(Math.max(...lats)),
    minLng: round2(Math.min(...lngs)),
    maxLng: round2(Math.max(...lngs)),
  };
}

function buildIssue(code, severity, message) {
  return {
    code,
    severity,
    message,
  };
}

function validateManualPolygonPlane(plane = {}) {
  const coordinates = getCoordinates(plane);
  const coordinateCount = coordinates.length;

  const recordedAreaM2 = numberOrNull(
    plane?.geometry?.usableAreaM2 ?? plane?.geometry?.areaM2
  );

  const estimatedAreaM2 = estimatePolygonAreaM2(coordinates);
  const areaM2 = recordedAreaM2 ?? estimatedAreaM2;

  const issues = [];

  if (coordinateCount < 3) {
    issues.push(
      buildIssue(
        "insufficient_coordinates",
        "high",
        "Manual roof polygon needs at least three coordinates."
      )
    );
  }

  if (areaM2 === null) {
    issues.push(
      buildIssue(
        "missing_area",
        "high",
        "Manual roof polygon does not have a usable area estimate."
      )
    );
  }

  if (areaM2 !== null && areaM2 < 3) {
    issues.push(
      buildIssue(
        "very_small_area",
        "medium",
        "Manual roof polygon area looks very small for a usable solar roof plane."
      )
    );
  }

  if (areaM2 !== null && areaM2 > 250) {
    issues.push(
      buildIssue(
        "very_large_area",
        "medium",
        "Manual roof polygon area looks unusually large for a domestic roof plane and may need review."
      )
    );
  }

  if (
    !plane.orientation ||
    String(plane.orientation).toLowerCase() === "unknown"
  ) {
    issues.push(
      buildIssue(
        "missing_orientation",
        "medium",
        "Manual roof polygon needs a roof orientation/aspect before accurate PV modelling."
      )
    );
  }

  if (plane.tilt === null || plane.tilt === undefined) {
    issues.push(
      buildIssue(
        "missing_tilt",
        "medium",
        "Manual roof polygon needs roof pitch/tilt before accurate PV modelling."
      )
    );
  }

  const highSeverityIssueCount = issues.filter(
    (issue) => issue.severity === "high"
  ).length;

  const mediumSeverityIssueCount = issues.filter(
    (issue) => issue.severity === "medium"
  ).length;

  const validationStatus =
    highSeverityIssueCount > 0
      ? "invalid_needs_fix"
      : mediumSeverityIssueCount > 0
        ? "usable_needs_review"
        : "valid_for_future_area_estimation";

  return {
    validationStatus,
    coordinateCount,
    recordedAreaM2,
    estimatedAreaM2,
    areaM2,
    coordinateBounds: getCoordinateBounds(coordinates),
    highSeverityIssueCount,
    mediumSeverityIssueCount,
    issues,
  };
}

function getReadinessFromValidation(validation = {}) {
  if (validation.validationStatus === "valid_for_future_area_estimation") {
    return {
      readiness: "ready_for_future_area_based_layout_estimation",
      canUseForFutureAreaBasedPanelEstimate: true,
      canUseForFutureMapDrawingMvp: true,
      requiresReviewBeforeUse: false,
    };
  }

  if (validation.validationStatus === "usable_needs_review") {
    return {
      readiness: "usable_but_needs_admin_or_user_review",
      canUseForFutureAreaBasedPanelEstimate: true,
      canUseForFutureMapDrawingMvp: true,
      requiresReviewBeforeUse: true,
    };
  }

  return {
    readiness: "not_ready_polygon_needs_fix",
    canUseForFutureAreaBasedPanelEstimate: false,
    canUseForFutureMapDrawingMvp: true,
    requiresReviewBeforeUse: true,
  };
}

function buildManualRoofPolygonPlane(plane = {}, index = 0) {
  const validation = validateManualPolygonPlane(plane);
  const readiness = getReadinessFromValidation(validation);

  return {
    polygonId: plane.roofId || `manual-polygon-${index + 1}`,
    roofId: plane.roofId || `roof-${index + 1}`,

    source: plane.source || "manual_roof_polygon",
    geometryType: plane.geometryType || "polygon",

    orientation: normaliseString(plane.orientation, "unknown"),
    tilt: numberOrNull(plane.tilt),
    shading: normaliseString(plane.shading, "unknown"),

    confidenceLevel: plane.confidence?.confidenceLevel || "unknown",
    confidenceScore: plane.confidence?.confidenceScore ?? null,

    physicalFitVerified: plane.physicalFitVerified === true,
    panelDimensionFitVerified: plane.panelDimensionFitVerified === true,

    validation,

    readiness,

    currentUse: {
      usedForPhysicalLayout: false,
      usedForPanelCountOptimisation: false,
      usedForRecommendation: false,
      usedForCalculation: false,
      canConfirmLargerPanelFit: false,
      canConfirmMorePanelsFit: false,
    },

    futureUse: {
      canSupportDrawMyRoofMvp: true,
      canSupportAreaBasedPanelCapacityEstimate:
        readiness.canUseForFutureAreaBasedPanelEstimate,
      canSupportFutureObstacleModel:
        validation.coordinateCount >= 3,
      canSupportFutureSatelliteOrLidarReplacement: true,
    },

    limitations: [
      "Manual polygon is not a surveyed roof design.",
      "Area is approximate unless later verified.",
      "Panel layout, orientation fit and setbacks are not calculated in this phase.",
      "Obstacles are not modelled in this phase.",
      "This polygon does not confirm that larger panels or more panels will fit.",
    ],
  };
}

function average(values = []) {
  const nums = values.filter((value) => Number.isFinite(Number(value)));

  if (!nums.length) return null;

  return round2(nums.reduce((sum, value) => sum + Number(value), 0) / nums.length);
}

function countBy(items = [], getter) {
  return items.reduce((acc, item) => {
    const key = getter(item) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function buildManualRoofPolygonModel({ roofGeometryInput = null } = {}) {
  const roofPlanes = getRoofPlanes(roofGeometryInput);
  const manualPolygonPlanes = roofPlanes.filter(isManualPolygonPlane);

  const polygons = manualPolygonPlanes.map((plane, index) =>
    buildManualRoofPolygonPlane(plane, index)
  );

  const validPolygons = polygons.filter(
    (polygon) =>
      polygon.validation.validationStatus ===
      "valid_for_future_area_estimation"
  );

  const reviewPolygons = polygons.filter(
    (polygon) =>
      polygon.validation.validationStatus === "usable_needs_review"
  );

  const invalidPolygons = polygons.filter(
    (polygon) =>
      polygon.validation.validationStatus === "invalid_needs_fix"
  );

  const totalAreaM2 = polygons.reduce(
    (sum, polygon) => sum + numberOrZero(polygon.validation.areaM2),
    0
  );

  const averageConfidenceScore = average(
    polygons.map((polygon) => polygon.confidenceScore)
  );

  let readiness = "manual_polygons_not_provided";

  if (polygons.length > 0 && invalidPolygons.length === polygons.length) {
    readiness = "manual_polygons_not_ready";
  } else if (polygons.length > 0 && invalidPolygons.length > 0) {
    readiness = "manual_polygons_partially_ready";
  } else if (polygons.length > 0 && reviewPolygons.length > 0) {
    readiness = "manual_polygons_ready_but_need_review";
  } else if (polygons.length > 0 && validPolygons.length === polygons.length) {
    readiness = "manual_polygons_ready_for_future_area_estimation";
  }

  return {
    version: MANUAL_ROOF_POLYGON_MODEL_VERSION,
    mode: "manual_roof_polygon_model_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    inputSourceStatus:
      roofGeometryInput?.sourceStatus || "unknown_roof_geometry_input",

    polygons,

    summary: {
      polygonCount: polygons.length,
      validPolygonCount: validPolygons.length,
      reviewPolygonCount: reviewPolygons.length,
      invalidPolygonCount: invalidPolygons.length,

      totalAreaM2: totalAreaM2 > 0 ? round2(totalAreaM2) : null,
      averageConfidenceScore,

      validationStatusCounts: countBy(
        polygons,
        (polygon) => polygon.validation.validationStatus
      ),

      readiness,

      canSupportDrawMyRoofMvp: true,
      canSupportFutureAreaBasedPanelEstimate:
        polygons.length > 0 && invalidPolygons.length === 0,
      canConfirmPanelFit: false,
      canConfirmLargerPanelFit: false,
      canConfirmMorePanelsFit: false,
      canRunTrueLayoutOptimisation: false,
    },

    recommendedNextAction:
      polygons.length === 0
        ? "No manual roof polygons were provided. Current roof inputs can still be treated as assumed panel positions."
        : invalidPolygons.length > 0
          ? "Fix invalid manual roof polygons before using them for area-based layout estimates."
          : reviewPolygons.length > 0
            ? "Review orientation, tilt or area assumptions before using polygons for layout estimates."
            : "Manual roof polygons are ready to support a future area-based panel capacity estimator.",

    assumptions: {
      note:
        "This model validates manual roof polygon readiness only. It does not calculate final panel layout or verify physical fit.",
    },

    limitations: [
      "Manual polygons are approximate unless surveyed or admin verified.",
      "Setbacks and obstacles are not used for layout in this phase.",
      "Panel dimensions are not tested against polygon geometry in this phase.",
      "This model does not affect calculation, pricing, filtering, ranking or recommendations.",
    ],
  };
}

module.exports = {
  MANUAL_ROOF_POLYGON_MODEL_VERSION,
  buildManualRoofPolygonModel,
  validateManualPolygonPlane,
};