const ROOF_GEOMETRY_INPUT_VERSION = "2026-beta-1";

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

function normaliseString(value, fallback = null) {
  const str = String(value ?? "").trim();
  return str || fallback;
}

function normaliseId(value, fallback = "unknown") {
  return normaliseString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getInputRoofs(input = {}) {
  return asArray(
    input.roofs ||
      input.roofDetails ||
      input.arrays ||
      input.roofArrays ||
      []
  );
}

function getPanelCount(roof = {}) {
  return numberOrNull(
    roof.panels ??
      roof.panelCount ??
      roof.numberOfPanels ??
      roof.modules ??
      roof.assumedPanelPositions
  );
}

function getOrientation(roof = {}) {
  return normaliseString(
    roof.orientation ||
      roof.azimuthLabel ||
      roof.aspect ||
      roof.roofOrientation,
    "unknown"
  );
}

function getTilt(roof = {}) {
  return numberOrNull(roof.tilt ?? roof.pitch ?? roof.roofPitch);
}

function getShading(roof = {}) {
  return normaliseString(
    roof.shading || roof.shade || roof.shadingLevel,
    "unknown"
  );
}

function getCoordinates(roof = {}) {
  const coordinates =
    roof.coordinates ||
    roof.polygon ||
    roof.geometry?.coordinates ||
    roof.geometry?.polygon ||
    [];

  return asArray(coordinates)
    .map((point) => {
      if (Array.isArray(point) && point.length >= 2) {
        return {
          lng: numberOrNull(point[0]),
          lat: numberOrNull(point[1]),
        };
      }

      if (point && typeof point === "object") {
        return {
          lng: numberOrNull(point.lng ?? point.longitude ?? point.x),
          lat: numberOrNull(point.lat ?? point.latitude ?? point.y),
        };
      }

      return null;
    })
    .filter((point) => point && point.lng !== null && point.lat !== null);
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

function getAreaM2(roof = {}) {
  const explicitArea = numberOrNull(
    roof.areaM2 ??
      roof.roofAreaM2 ??
      roof.usableAreaM2 ??
      roof.geometry?.areaM2
  );

  if (explicitArea !== null) {
    return explicitArea;
  }

  const coordinates = getCoordinates(roof);
  return estimatePolygonAreaM2(coordinates);
}

function getDimensions(roof = {}) {
  const widthM = numberOrNull(
    roof.widthM ??
      roof.roofWidthM ??
      roof.dimensions?.widthM
  );

  const heightM = numberOrNull(
    roof.heightM ??
      roof.roofHeightM ??
      roof.rafterLengthM ??
      roof.slopeLengthM ??
      roof.dimensions?.heightM ??
      roof.dimensions?.rafterLengthM
  );

  const areaFromDimensions =
    widthM !== null && heightM !== null ? round2(widthM * heightM) : null;

  return {
    widthM,
    heightM,
    areaFromDimensionsM2: areaFromDimensions,
  };
}

function hasPolygonGeometry(roof = {}) {
  return getCoordinates(roof).length >= 3 || !!roof.geometry?.coordinates;
}

function hasDimensionGeometry(roof = {}) {
  const dimensions = getDimensions(roof);
  return dimensions.widthM !== null && dimensions.heightM !== null;
}

function inferRoofSource(roof = {}, fallbackSource = null) {
  const explicitSource = normaliseId(
    roof.source ||
      roof.inputSource ||
      roof.geometrySource ||
      fallbackSource ||
      ""
  );

  if (
    [
      "manual_roof_polygon",
      "admin_entered_roof_dimensions",
      "future_auto_detected_roof_geometry",
      "auto_detected_roof_geometry",
      "surveyed_roof_geometry",
      "user_estimated_panel_count",
    ].includes(explicitSource)
  ) {
    return explicitSource;
  }

  if (hasPolygonGeometry(roof)) {
    return "manual_roof_polygon";
  }

  if (hasDimensionGeometry(roof)) {
    return "admin_entered_roof_dimensions";
  }

  if (getPanelCount(roof) !== null) {
    return "user_estimated_panel_count";
  }

  return "unknown_roof_input";
}

function getGeometryType(roof = {}, source = "unknown_roof_input") {
  if (hasPolygonGeometry(roof)) return "polygon";
  if (hasDimensionGeometry(roof)) return "dimensions";
  if (source === "user_estimated_panel_count") return "panel_count_assumption";
  return "unknown";
}

function getPhysicalFitVerified(roof = {}) {
  return (
    roof.physicalFitVerified === true ||
    roof.verified === true ||
    roof.geometryVerified === true ||
    roof.surveyed === true
  );
}

function getConfidenceForPlane({ source, roof = {}, areaM2 = null } = {}) {
  const physicalFitVerified = getPhysicalFitVerified(roof);

  if (physicalFitVerified) {
    return {
      confidenceLevel: "high",
      confidenceScore: 90,
      reasons: [
        "Roof geometry or panel fit has been marked as verified.",
      ],
    };
  }

  if (
    source === "surveyed_roof_geometry" ||
    source === "future_auto_detected_roof_geometry" ||
    source === "auto_detected_roof_geometry"
  ) {
    return {
      confidenceLevel: "high",
      confidenceScore: 85,
      reasons: [
        "Roof geometry comes from a higher-confidence geometry source.",
      ],
    };
  }

  if (source === "manual_roof_polygon" && areaM2 !== null) {
    return {
      confidenceLevel: "medium",
      confidenceScore: 65,
      reasons: [
        "Roof area is based on a manually drawn polygon, but panel fit has not been verified.",
      ],
    };
  }

  if (source === "admin_entered_roof_dimensions" && areaM2 !== null) {
    return {
      confidenceLevel: "medium",
      confidenceScore: 60,
      reasons: [
        "Roof area is based on entered dimensions, but panel fit has not been verified.",
      ],
    };
  }

  if (source === "user_estimated_panel_count") {
    return {
      confidenceLevel: "low",
      confidenceScore: 35,
      reasons: [
        "Roof capacity is based on a user-estimated panel count only.",
      ],
    };
  }

  return {
    confidenceLevel: "low",
    confidenceScore: 25,
    reasons: [
      "Roof input source is unknown or incomplete.",
    ],
  };
}

function buildRoofPlaneFromInput({
  roof = {},
  index = 0,
  fallbackSource = null,
} = {}) {
  const source = inferRoofSource(roof, fallbackSource);
  const coordinates = getCoordinates(roof);
  const dimensions = getDimensions(roof);
  const areaM2 =
    getAreaM2(roof) ?? dimensions.areaFromDimensionsM2 ?? null;

  const confidence = getConfidenceForPlane({
    source,
    roof,
    areaM2,
  });

  const assumedPanelPositions = getPanelCount(roof);

  return {
    roofId:
      roof.id ||
      roof.roofId ||
      roof.name ||
      `roof-${index + 1}`,

    source,
    geometryType: getGeometryType(roof, source),

    orientation: getOrientation(roof),
    tilt: getTilt(roof),
    shading: getShading(roof),

    assumedPanelPositions,

    geometry: {
      areaM2,
      usableAreaM2:
        numberOrNull(roof.usableAreaM2 ?? roof.geometry?.usableAreaM2) ??
        areaM2,
      coordinates,
      coordinateCount: coordinates.length,
      dimensions,
    },

    obstacles: asArray(roof.obstacles),

    setbacks: {
      edgeMm: numberOrNull(roof.setbacks?.edgeMm ?? roof.edgeSetbackMm),
      ridgeMm: numberOrNull(roof.setbacks?.ridgeMm ?? roof.ridgeSetbackMm),
      valleyMm: numberOrNull(roof.setbacks?.valleyMm ?? roof.valleySetbackMm),
      partyWallMm:
        numberOrNull(roof.setbacks?.partyWallMm ?? roof.partyWallSetbackMm),
    },

    confidence,

    physicalFitVerified: getPhysicalFitVerified(roof),
    panelDimensionFitVerified:
      roof.panelDimensionFitVerified === true ||
      roof.panelFitVerified === true,

    currentUse: {
      usedForPhysicalLayout: false,
      usedForPanelCountOptimisation: false,
      usedForRecommendation: false,
      canCompareSamePanelCountOptions:
        assumedPanelPositions !== null && assumedPanelPositions > 0,
      canConfirmLargerPanelFit: false,
      canConfirmMorePanelsFit: false,
    },

    limitations: [
      "This roof plane is a geometry/input assumption, not a surveyed layout.",
      "Panel fit is not verified unless explicitly marked as verified.",
      "Exact portrait/landscape placement is not calculated in this phase.",
      "Obstacles and setbacks are recorded only as placeholders in this phase.",
    ],
  };
}

function getRoofGeometryInputPlanes(input = {}) {
  const roofGeometry = input.roofGeometry || {};

  const explicitPlanes = asArray(
    roofGeometry.roofPlanes ||
      roofGeometry.planes ||
      input.roofPlanes ||
      input.manualRoofPolygons ||
      []
  );

  if (explicitPlanes.length > 0) {
    const fallbackSource = roofGeometry.source || "manual_roof_polygon";

    return explicitPlanes.map((roof, index) =>
      buildRoofPlaneFromInput({
        roof,
        index,
        fallbackSource,
      })
    );
  }

  const currentRoofs = getInputRoofs(input);

  return currentRoofs.map((roof, index) =>
    buildRoofPlaneFromInput({
      roof,
      index,
      fallbackSource: "user_estimated_panel_count",
    })
  );
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

function getOverallConfidenceLevel(score) {
  const n = numberOrNull(score);

  if (n === null) return "unknown";
  if (n >= 80) return "high";
  if (n >= 55) return "medium";
  return "low";
}

function buildRoofGeometryInputModel({ input = {}, quote = {} } = {}) {
  const roofPlanes = getRoofGeometryInputPlanes(input);

  const totalAssumedPanelPositions = roofPlanes.reduce(
    (sum, plane) => sum + numberOrZero(plane.assumedPanelPositions),
    0
  );

  const totalUsableAreaM2 = roofPlanes.reduce(
    (sum, plane) => sum + numberOrZero(plane.geometry?.usableAreaM2),
    0
  );

  const confidenceScore = average(
    roofPlanes.map((plane) => plane.confidence?.confidenceScore)
  );

  const hasAreaGeometry = roofPlanes.some(
    (plane) => numberOrNull(plane.geometry?.usableAreaM2) !== null
  );

  const onlyPanelCountAssumptions =
    roofPlanes.length > 0 &&
    roofPlanes.every(
      (plane) => plane.source === "user_estimated_panel_count"
    );

  return {
    version: ROOF_GEOMETRY_INPUT_VERSION,
    mode: "roof_geometry_input_model_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    sourceStatus:
      roofPlanes.length === 0
        ? "no_roof_geometry_input"
        : onlyPanelCountAssumptions
          ? "user_estimated_panel_count_only"
          : "geometry_input_available",

    roofPlanes,

    summary: {
      roofPlaneCount: roofPlanes.length,
      sourceCounts: countBy(roofPlanes, (plane) => plane.source),
      geometryTypeCounts: countBy(roofPlanes, (plane) => plane.geometryType),
      confidenceLevel: getOverallConfidenceLevel(confidenceScore),
      confidenceScore,
      totalAssumedPanelPositions,
      totalUsableAreaM2: totalUsableAreaM2 > 0 ? round2(totalUsableAreaM2) : null,
      hasAreaGeometry,
      onlyPanelCountAssumptions,
      physicalFitVerified:
        roofPlanes.length > 0 &&
        roofPlanes.every((plane) => plane.physicalFitVerified === true),
      panelCountOptimisationAvailable: false,
      manualPolygonReady:
        roofPlanes.some((plane) => plane.source === "manual_roof_polygon"),
      futureAutoGeometryReady:
        roofPlanes.some((plane) =>
          [
            "future_auto_detected_roof_geometry",
            "auto_detected_roof_geometry",
          ].includes(plane.source)
        ),
    },

    currentOptimiserInterpretation: {
      canCompareSamePanelCountOptions: totalAssumedPanelPositions > 0,
      canConfirmLargerPanelFit: false,
      canConfirmMorePanelsFit: false,
      canRunTrueLayoutOptimisation: false,
      canSupportFutureManualPolygonInput: true,
      canSupportFutureSatelliteOrLidarInput: true,
    },

    quoteContext: {
      quoteSystemSizeKwp: numberOrNull(quote?.systemSizeKwp),
      quoteHasHourlyModel:
        Array.isArray(quote?.hourlyModel?._pvHourlyKWh) ||
        Array.isArray(quote?.hourlyModel?._loadHourlyKWh),
    },

    assumptions: {
      note:
        "This model captures roof geometry/input confidence only. It does not verify panel fit or generate final roof layouts.",
    },

    limitations: [
      "Current user-estimated panel counts are not measured roof dimensions.",
      "Manual polygons and dimensions are not yet converted into exact panel placement.",
      "Satellite/LiDAR roof detection is not implemented in this phase.",
      "Panel count optimisation is not enabled in this phase.",
      "This model is diagnostic and does not affect calculation, pricing or recommendations.",
    ],
  };
}

function getCandidatePanelWattage(candidate = {}) {
  return numberOrNull(
    candidate?.hardwareMetadataNormalisation?.products?.panel?.power?.wattage ??
      candidate?.products?.panel?.wattage ??
      candidate?.products?.panel?.watts ??
      candidate?.products?.panel?.powerW ??
      candidate?.panel?.wattage
  );
}

function buildCandidateRoofGeometryAssumption({
  candidate = {},
  roofGeometryInput = null,
  index = 0,
} = {}) {
  const roofPlanes = asArray(roofGeometryInput?.roofPlanes);
  const panelWattage = getCandidatePanelWattage(candidate);

  const roofPlaneAssumptions = roofPlanes.map((plane) => {
    const assumedPanelPositions = numberOrNull(plane.assumedPanelPositions);
    const assumedArraySizeKwp =
      assumedPanelPositions !== null && panelWattage !== null
        ? round2((assumedPanelPositions * panelWattage) / 1000)
        : null;

    return {
      roofId: plane.roofId,
      source: plane.source,
      geometryType: plane.geometryType,

      orientation: plane.orientation,
      tilt: plane.tilt,
      shading: plane.shading,

      assumedPanelPositions,
      candidatePanelWattage: panelWattage,
      assumedArraySizeKwp,

      areaM2: plane.geometry?.areaM2 ?? null,
      usableAreaM2: plane.geometry?.usableAreaM2 ?? null,

      physicalFitVerified: plane.physicalFitVerified === true,
      panelDimensionFitVerified: plane.panelDimensionFitVerified === true,

      fitStatus:
        plane.physicalFitVerified === true &&
        plane.panelDimensionFitVerified === true
          ? "verified"
          : "not_verified",

      confidenceLevel: plane.confidence?.confidenceLevel || "unknown",
      confidenceScore: plane.confidence?.confidenceScore ?? null,

      currentUse: {
        usedForPhysicalLayout: false,
        usedForPanelCountOptimisation: false,
        usedForRecommendation: false,
        canCompareSamePanelCountOptions:
          assumedPanelPositions !== null && assumedPanelPositions > 0,
        canConfirmLargerPanelFit: false,
        canConfirmMorePanelsFit: false,
      },

      limitation:
        "Assumed array size is based on roof input and candidate panel wattage. Physical panel fit is not verified in this phase.",
    };
  });

  const totalAssumedPanelPositions = roofPlaneAssumptions.reduce(
    (sum, plane) => sum + numberOrZero(plane.assumedPanelPositions),
    0
  );

  const assumedSystemSizeKwp = roofPlaneAssumptions.reduce(
    (sum, plane) => sum + numberOrZero(plane.assumedArraySizeKwp),
    0
  );

  const confidenceScore = average(
    roofPlaneAssumptions.map((plane) => plane.confidenceScore)
  );

  return {
    version: ROOF_GEOMETRY_INPUT_VERSION,
    mode: "candidate_roof_geometry_assumption_beta",

    candidateId:
      candidate?.candidateId || candidate?.id || `candidate-${index + 1}`,

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    inputBasis:
      roofGeometryInput?.sourceStatus || "unknown_roof_geometry_input",

    summary: {
      roofPlaneCount: roofPlaneAssumptions.length,
      totalAssumedPanelPositions,
      candidatePanelWattage: panelWattage,
      assumedSystemSizeKwp:
        assumedSystemSizeKwp > 0 ? round2(assumedSystemSizeKwp) : null,
      confidenceLevel: getOverallConfidenceLevel(confidenceScore),
      confidenceScore,

      physicalFitVerified:
        roofPlaneAssumptions.length > 0 &&
        roofPlaneAssumptions.every(
          (plane) => plane.physicalFitVerified === true
        ),

      panelDimensionFitVerified:
        roofPlaneAssumptions.length > 0 &&
        roofPlaneAssumptions.every(
          (plane) => plane.panelDimensionFitVerified === true
        ),

      panelCountOptimisationAvailable: false,
      trueLayoutOptimisationAvailable: false,

      canCompareSamePanelCountOptions:
        totalAssumedPanelPositions > 0 && panelWattage !== null,
      canConfirmLargerPanelFit: false,
      canConfirmMorePanelsFit: false,
    },

    roofPlaneAssumptions,

    assumptions: {
      note:
        "Candidate roof geometry is currently an assumption layer. It supports future geometry-based layout work but does not verify physical panel placement.",
    },

    limitations: [
      "Assumed panel positions may be based on user estimate only.",
      "Panel dimensions are not used to verify fit in this phase.",
      "Larger panels are not assumed to fit unless future layout checks confirm it.",
      "More panels are not assumed to fit unless future layout checks confirm it.",
      "This data is not used for recommendation, filtering, pricing or calculation.",
    ],
  };
}

function applyRoofGeometryAssumptionsToCandidates({
  candidates = [],
  roofGeometryInput = null,
} = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  return safeCandidates.map((candidate, index) => ({
    ...candidate,
    roofGeometryAssumption: buildCandidateRoofGeometryAssumption({
      candidate,
      roofGeometryInput,
      index,
    }),
  }));
}

function buildRoofGeometryInputSummary({
  roofGeometryInput = null,
  candidates = [],
} = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  const candidateAssumptions = safeCandidates
    .map((candidate) => candidate.roofGeometryAssumption)
    .filter(Boolean);

  const confidenceScores = candidateAssumptions
    .map((item) => item.summary?.confidenceScore)
    .filter((score) => score !== null && score !== undefined);

  return {
    version: ROOF_GEOMETRY_INPUT_VERSION,
    mode: "roof_geometry_input_summary_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    candidateCount: safeCandidates.length,
    roofPlaneCount: roofGeometryInput?.summary?.roofPlaneCount ?? 0,

    inputSourceStatus:
      roofGeometryInput?.sourceStatus || "unknown_roof_geometry_input",

    confidenceLevel:
      roofGeometryInput?.summary?.confidenceLevel || "unknown",
    confidenceScore:
      roofGeometryInput?.summary?.confidenceScore ?? null,

    candidateAverageConfidenceScore: average(confidenceScores),

    onlyPanelCountAssumptions:
      roofGeometryInput?.summary?.onlyPanelCountAssumptions === true,

    hasAreaGeometry:
      roofGeometryInput?.summary?.hasAreaGeometry === true,

    manualPolygonReady:
      roofGeometryInput?.summary?.manualPolygonReady === true,

    futureAutoGeometryReady:
      roofGeometryInput?.summary?.futureAutoGeometryReady === true,

    totalAssumedPanelPositions:
      roofGeometryInput?.summary?.totalAssumedPanelPositions ?? 0,

    totalUsableAreaM2:
      roofGeometryInput?.summary?.totalUsableAreaM2 ?? null,

    canCompareSamePanelCountOptions:
      roofGeometryInput?.currentOptimiserInterpretation
        ?.canCompareSamePanelCountOptions === true,

    canConfirmLargerPanelFit: false,
    canConfirmMorePanelsFit: false,
    canRunTrueLayoutOptimisation: false,

    readiness:
      roofGeometryInput?.summary?.onlyPanelCountAssumptions === true
        ? "ready_for_assumed_panel_count_modelling_only"
        : roofGeometryInput?.summary?.hasAreaGeometry === true
          ? "ready_for_future_area_based_layout_estimation"
          : "roof_geometry_input_incomplete",

    recommendedNextAction:
      roofGeometryInput?.summary?.onlyPanelCountAssumptions === true
        ? "Use current roof inputs only as assumed panel positions. Do not claim larger panels or more panels will fit."
        : "Use geometry fields as the foundation for future area-based panel capacity and layout estimation.",

    assumptions: {
      note:
        "This summary describes roof input confidence. It is not a physical design verification.",
    },
  };
}

module.exports = {
  ROOF_GEOMETRY_INPUT_VERSION,
  buildRoofGeometryInputModel,
  buildCandidateRoofGeometryAssumption,
  applyRoofGeometryAssumptionsToCandidates,
  buildRoofGeometryInputSummary,
};