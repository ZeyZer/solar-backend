const GOOGLE_PANEL_KWP = 0.4;

const YIELD_THRESHOLDS = {
  strongKwhPerKwp: 800,
  usableKwhPerKwp: 600,
  weakKwhPerKwp: 450,
};

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round1(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

function normalise(value) {
  return String(value || "").trim().toLowerCase();
}

function clamp(value, min, max) {
  const number = toNumber(value, min);
  return Math.max(min, Math.min(max, number));
}

function getFirstBuildingAudit(googleSolarApi = {}, key) {
  return (
    googleSolarApi?.[key]?.firstBuilding ||
    googleSolarApi?.[key]?.buildingAudits?.[0] ||
    {}
  );
}

function isTerraceOrSemi(propertyType) {
  const type = normalise(propertyType);

  return [
    "terrace",
    "terraced",
    "end_terrace",
    "end-terrace",
    "semi",
    "semi_detached",
    "semi-detached",
  ].includes(type);
}

function isCommercial(propertyType) {
  return normalise(propertyType).includes("commercial");
}

function compareSegmentsByYieldAndCapacity(a, b) {
  const panelsA = toNumber(a?.maxPanels, 0);
  const panelsB = toNumber(b?.maxPanels, 0);

  if (panelsA !== panelsB) {
    return panelsB - panelsA;
  }

  const yieldA = toNumber(a?.annualKwhPerKwp, -1);
  const yieldB = toNumber(b?.annualKwhPerKwp, -1);

  return yieldB - yieldA;
}

function calculateSegmentAnnualKwhPerKwp(segment) {
  const maxPanels = toNumber(segment.maxConfigPanels);
  const annualKwh = toNumber(segment.maxConfigAnnualKwh);

  if (!maxPanels || !annualKwh) return null;

  return annualKwh / (maxPanels * GOOGLE_PANEL_KWP);
}

function isNorthOrVeryLow(segment) {
  const orientation = normalise(segment.orientationClass);
  const sunshine = normalise(segment.sunshineClass);

  return orientation === "north" || sunshine === "very_low";
}

function classifyRoofSegment(segment, scoredSegment = {}) {
  const maxPanels = toNumber(segment.maxConfigPanels);
  const areaM2 = toNumber(segment.areaM2);
  const orientation = normalise(segment.orientationClass);
  const sunshine = normalise(segment.sunshineClass);
  const score = toNumber(scoredSegment.baseScore, 0);
  const annualKwhPerKwp = calculateSegmentAnnualKwhPerKwp(segment);

  const reasons = [];

  if (maxPanels <= 0) {
    return {
      selectionStatus: "hidden",
      defaultSelected: false,
      hideFromSimpleUi: true,
      reasons: ["No usable Google panel capacity detected."],
    };
  }

  if (isNorthOrVeryLow(segment)) {
    return {
      selectionStatus: "not_recommended",
      defaultSelected: false,
      hideFromSimpleUi: true,
      reasons: ["Poor orientation or very low sunshine."],
    };
  }

  if (
    annualKwhPerKwp !== null &&
    annualKwhPerKwp < YIELD_THRESHOLDS.weakKwhPerKwp
  ) {
    return {
      selectionStatus: "not_recommended",
      defaultSelected: false,
      hideFromSimpleUi: true,
      reasons: [
        `Low expected roof-space yield: ${round1(
          annualKwhPerKwp
        )} kWh/kWp.`,
      ],
    };
  }

  if (
    annualKwhPerKwp !== null &&
    annualKwhPerKwp >= YIELD_THRESHOLDS.strongKwhPerKwp &&
    score >= 70 &&
    ["south", "east_west"].includes(orientation)
  ) {
    reasons.push(
      `Strong roof-space yield: ${round1(annualKwhPerKwp)} kWh/kWp.`
    );

    return {
      selectionStatus: "recommended",
      defaultSelected: true,
      hideFromSimpleUi: false,
      reasons,
    };
  }

  if (score >= 80 && maxPanels >= 2) {
    reasons.push("Strong roof segment.");

    return {
      selectionStatus: "recommended",
      defaultSelected: true,
      hideFromSimpleUi: false,
      reasons,
    };
  }

  if (
    score >= 70 &&
    maxPanels >= 2 &&
    ["south", "east_west"].includes(orientation)
  ) {
    reasons.push("Usable roof segment with good orientation/sunshine.");

    return {
      selectionStatus: "recommended",
      defaultSelected: true,
      hideFromSimpleUi: false,
      reasons,
    };
  }

  if (
    annualKwhPerKwp !== null &&
    annualKwhPerKwp >= YIELD_THRESHOLDS.usableKwhPerKwp &&
    ["south", "east_west", "marginal_east_west"].includes(orientation) &&
    ["good", "medium"].includes(sunshine)
  ) {
    reasons.push(
      `Usable roof-space yield: ${round1(annualKwhPerKwp)} kWh/kWp.`
    );
    reasons.push("User confirmation recommended.");

    return {
      selectionStatus: "optional",
      defaultSelected: false,
      hideFromSimpleUi: false,
      reasons,
    };
  }

  if (
    score >= 25 &&
    maxPanels >= 1 &&
    ["south", "east_west", "marginal_east_west"].includes(orientation) &&
    ["good", "medium"].includes(sunshine)
  ) {
    reasons.push("Potentially usable roof segment; user confirmation needed.");

    return {
      selectionStatus: "optional",
      defaultSelected: false,
      hideFromSimpleUi: false,
      reasons,
    };
  }

  if (areaM2 < 8) {
    return {
      selectionStatus: "hidden",
      defaultSelected: false,
      hideFromSimpleUi: true,
      reasons: ["Tiny roof fragment."],
    };
  }

  return {
    selectionStatus: "not_recommended",
    defaultSelected: false,
    hideFromSimpleUi: true,
    reasons: ["Low score or marginal suitability."],
  };
}

function buildDefaultSelectedSegments({
  recommendedSegments = [],
  optionalSegments = [],
  targetPanels = 0,
}) {
  const selected = recommendedSegments.slice();
  const selectedIds = new Set(selected.map((segment) => segment.segmentIndex));

  let selectedCapacity = selected.reduce(
    (sum, segment) => sum + toNumber(segment.maxPanels),
    0
  );

  if (selected.length === 0) {
    const bestOptional = optionalSegments
      .slice()
      .sort(compareSegmentsByYieldAndCapacity)[0];

    return {
      defaultSelectionMode: bestOptional ? "best_optional_segment" : "none",
      defaultSelectedSegments: bestOptional ? [bestOptional] : [],
    };
  }

  const sortedOptionalSegments = optionalSegments
    .slice()
    .sort(compareSegmentsByYieldAndCapacity);

  for (const segment of sortedOptionalSegments) {
    if (selectedCapacity >= targetPanels) break;
    if (selectedIds.has(segment.segmentIndex)) continue;

    selected.push(segment);
    selectedIds.add(segment.segmentIndex);
    selectedCapacity += toNumber(segment.maxPanels);
  }

  return {
    defaultSelectionMode:
      selected.length > recommendedSegments.length
        ? "recommended_plus_optional_to_reach_target"
        : "recommended_segments",
    defaultSelectedSegments: selected,
  };
}

function buildSuggestedPanelRange({
  selectableCapacityPanels,
  currentAutoExpectedPanels,
}) {
  if (!selectableCapacityPanels) {
    return {
      low: 0,
      expected: 0,
      high: 0,
    };
  }

  const expected = clamp(
    currentAutoExpectedPanels || Math.round(selectableCapacityPanels * 0.7),
    1,
    selectableCapacityPanels
  );

  const low = clamp(Math.round(expected * 0.85), 1, selectableCapacityPanels);
  const high = clamp(
    Math.max(expected, Math.round(expected * 1.15)),
    1,
    selectableCapacityPanels
  );

  return {
    low,
    expected,
    high,
  };
}

function buildRoofSelectionModelFromGoogleSolarApi(
  googleSolarApi = {},
  options = {}
) {
  const segmentPanelAudit = getFirstBuildingAudit(
    googleSolarApi,
    "segmentPanelAudit"
  );

  const selectorAudit = getFirstBuildingAudit(
    googleSolarApi,
    "segmentSelectorAudit"
  );

  const practicalPanelEstimate = googleSolarApi.practicalPanelEstimate || {};

  const segmentRows = Array.isArray(segmentPanelAudit.segmentRows)
    ? segmentPanelAudit.segmentRows
    : [];

  const scoredSegments = Array.isArray(selectorAudit.scoredSegments)
    ? selectorAudit.scoredSegments
    : [];

  const scoredByIndex = Object.fromEntries(
    scoredSegments.map((segment) => [segment.segmentIndex, segment])
  );

  const segments = segmentRows.map((segment) => {
    const scoredSegment = scoredByIndex[segment.segmentIndex] || {};
    const classification = classifyRoofSegment(segment, scoredSegment);
    const annualKwhPerKwp = calculateSegmentAnnualKwhPerKwp(segment);

    return {
      segmentIndex: segment.segmentIndex,
      segmentId: segment.segmentId,

      areaM2: round1(segment.areaM2),
      groundAreaM2: round1(segment.groundAreaM2),
      pitchDegrees: round1(segment.pitchDegrees),
      azimuthDegrees: round1(segment.azimuthDegrees),

      orientationClass: segment.orientationClass,
      sunshineClass: segment.sunshineClass,
      medianSunshineHours: round1(segment.medianSunshineHours),
      lowSunshineHours: round1(segment.lowSunshineHours),

      score: scoredSegment.baseScore ?? null,
      scoreReasons: scoredSegment.reasons || [],

      maxPanels: toNumber(segment.maxConfigPanels),
      maxConfigAnnualKwh: round1(segment.maxConfigAnnualKwh),
      annualKwhPerKwp: round1(annualKwhPerKwp),

      currentClosestInstallerConfigPanels: toNumber(
        segment.closestInstallerConfigPanels
      ),

      selectionStatus: classification.selectionStatus,
      defaultSelected: classification.defaultSelected,
      hideFromSimpleUi: classification.hideFromSimpleUi,
      reasons: classification.reasons,
    };
  });

  const recommendedSegments = segments.filter(
    (segment) => segment.selectionStatus === "recommended"
  );

  const optionalSegments = segments.filter(
    (segment) => segment.selectionStatus === "optional"
  );

  const notRecommendedSegments = segments.filter(
    (segment) => segment.selectionStatus === "not_recommended"
  );

  const hiddenSegments = segments.filter(
    (segment) => segment.selectionStatus === "hidden"
  );

  const recommendedCapacityPanels = recommendedSegments.reduce(
    (sum, segment) => sum + segment.maxPanels,
    0
  );

  const optionalCapacityPanels = optionalSegments.reduce(
    (sum, segment) => sum + segment.maxPanels,
    0
  );

  const selectableCapacityPanels =
    recommendedCapacityPanels + optionalCapacityPanels;

  const googleMaxPanels =
    toNumber(googleSolarApi.maxPanels, 0) ||
    segments.reduce((sum, segment) => sum + segment.maxPanels, 0);

  const rawAutoExpectedPanels = toNumber(
    practicalPanelEstimate?.practicalPanels?.expected
  );

  const currentAutoExpectedPanels =
    rawAutoExpectedPanels ||
    (selectableCapacityPanels > 0
      ? Math.round(selectableCapacityPanels * 0.7)
      : 0);

  const suggestedPanelRange = buildSuggestedPanelRange({
    selectableCapacityPanels,
    currentAutoExpectedPanels,
  });

  const editableMin = selectableCapacityPanels > 0 ? 1 : 0;
  const editableMax = selectableCapacityPanels;
  const editableDefault = clamp(
    currentAutoExpectedPanels || suggestedPanelRange.expected,
    editableMin,
    editableMax
  );

  const warnings = [];

  if (optionalSegments.length > 0) {
    warnings.push({
      code: "optional_roof_segments_present",
      level: "medium",
      message:
        "There are usable optional roof spaces. The user should confirm which roof areas to include.",
    });
  }

  if (segments.length >= 6) {
    warnings.push({
      code: "complex_multi_segment_roof",
      level: "medium",
      message:
        "This is a complex multi-segment roof. Automatic panel selection should be treated cautiously.",
    });
  }

  const propertyType = options.propertyType;
  const mainSelectableSegment = recommendedSegments
    .concat(optionalSegments)
    .slice()
    .sort((a, b) => b.maxPanels - a.maxPanels)[0];

  if (mainSelectableSegment && mainSelectableSegment.maxPanels >= 18) {
    if (isTerraceOrSemi(propertyType)) {
      warnings.push({
        code: "possible_property_boundary_overcount",
        level: "medium",
        message:
          "A large roof plane may include neighbouring roof area on a terrace/semi-detached property. User or installer should confirm the usable area/panel count.",
      });
    } else if (isCommercial(propertyType)) {
      warnings.push({
        code: "large_commercial_roof_capacity_requires_confirmation",
        level: "medium",
        message:
          "Large commercial roof capacity should be confirmed before treating the panel count as design-ready.",
      });
    } else {
      warnings.push({
        code: "large_roof_plane_requires_panel_count_confirmation",
        level: "medium",
        message:
          "A large roof plane was detected. User or installer should confirm the usable area/panel count.",
      });
    }
  }

  if (
    selectableCapacityPanels > 0 &&
    currentAutoExpectedPanels > 0 &&
    Math.abs(currentAutoExpectedPanels - selectableCapacityPanels) /
      selectableCapacityPanels >
      0.35
  ) {
    warnings.push({
      code: "auto_panel_count_differs_from_selectable_capacity",
      level: "medium",
      message:
        "The current automatic panel estimate differs materially from the selectable roof capacity.",
    });
  }

  const defaultSelectionTargetPanels =
    selectableCapacityPanels > 0
      ? clamp(
          Math.max(
            currentAutoExpectedPanels,
            Math.round(selectableCapacityPanels * 0.7)
          ),
          1,
          selectableCapacityPanels
        )
      : 0;

  const { defaultSelectionMode, defaultSelectedSegments } =
    buildDefaultSelectedSegments({
      recommendedSegments,
      optionalSegments,
      targetPanels: defaultSelectionTargetPanels,
    });

  const defaultSelectedCapacityPanels = defaultSelectedSegments.reduce(
    (sum, segment) => sum + segment.maxPanels,
    0
  );

  const visibleSimpleUiSegmentCount =
    recommendedSegments.length + optionalSegments.length;

  if (visibleSimpleUiSegmentCount > 8) {
    warnings.push({
      code: "many_selectable_roof_segments",
      level: "medium",
      message:
        "Many selectable roof spaces were detected. The UI should group or simplify these before asking the user to confirm.",
    });
  }

  const confidenceLevel =
    warnings.some((warning) => warning.level === "high")
      ? "low"
      : warnings.length >= 2
        ? "medium"
        : "high";

  return {
    source: "zeyzer_roof_selection_model_v4_yield_filtered_default_selection",
    status: "complete",

    thresholds: YIELD_THRESHOLDS,

    summary: {
      googleMaxPanels,
      currentAutoExpectedPanels,
      recommendedCapacityPanels,
      optionalCapacityPanels,
      selectableCapacityPanels,
      defaultSelectionMode,
      defaultSelectionTargetPanels,
      defaultSelectedCapacityPanels,
      defaultSelectedSegmentCount: defaultSelectedSegments.length,
      recommendedSegmentCount: recommendedSegments.length,
      optionalSegmentCount: optionalSegments.length,
      notRecommendedSegmentCount: notRecommendedSegments.length,
      hiddenSegmentCount: hiddenSegments.length,
      totalSegmentCount: segments.length,
      confidenceLevel,
    },

    editablePanelRange: {
      min: editableMin,
      defaultValue: editableDefault,
      max: editableMax,
      googleMax: googleMaxPanels,
    },

    suggestedPanelRange,

    defaultSelectedSegments,
    recommendedSegments,
    optionalSegments,
    notRecommendedSegments,
    hiddenSegments,
    warnings,
  };
}


function normaliseAngle360(value) {
  const number = toNumber(value, null);

  if (number === null) return null;

  return ((number % 360) + 360) % 360;
}

function circularDistanceDeg(a, b) {
  const angleA = normaliseAngle360(a);
  const angleB = normaliseAngle360(b);

  if (angleA === null || angleB === null) return null;

  const diff = Math.abs(angleA - angleB);
  return Math.min(diff, 360 - diff);
}

function classifyOrientationFromGoogleAzimuth(azimuthDegrees) {
  const azimuth = normaliseAngle360(azimuthDegrees);

  if (azimuth === null) return "unknown";

  const southDistance = circularDistanceDeg(azimuth, 180);
  const eastDistance = circularDistanceDeg(azimuth, 90);
  const westDistance = circularDistanceDeg(azimuth, 270);
  const northDistance = circularDistanceDeg(azimuth, 0);

  if (southDistance <= 45) return "south";

  if (eastDistance <= 25 || westDistance <= 45) {
    return "east_west";
  }

  if (eastDistance <= 45 || westDistance <= 65) {
    return "marginal_east_west";
  }

  if (northDistance <= 70) return "north";

  return "marginal_east_west";
}

function pickQuantile(quantiles = [], indexFromEnd = 1) {
  if (!Array.isArray(quantiles) || quantiles.length === 0) return null;

  const index = Math.max(0, quantiles.length - indexFromEnd);
  return toNumber(quantiles[index], null);
}

function getApproxMedianSunshineHours(segment = {}) {
  const quantiles = segment.sunshineQuantiles || [];

  if (!Array.isArray(quantiles) || quantiles.length === 0) return null;

  const middleIndex = Math.floor(quantiles.length / 2);
  return toNumber(quantiles[middleIndex], null);
}

function getApproxLowSunshineHours(segment = {}) {
  const quantiles = segment.sunshineQuantiles || [];

  if (!Array.isArray(quantiles) || quantiles.length === 0) return null;

  return toNumber(quantiles[1] ?? quantiles[0], null);
}

function classifySunshineFromSegment(segment = {}) {
  const median = getApproxMedianSunshineHours(segment);

  if (median === null) return "unknown";

  if (median >= 850) return "good";
  if (median >= 750) return "medium";
  if (median >= 650) return "low";

  return "very_low";
}

function scoreSegmentForSelection({
  areaM2,
  pitchDegrees,
  orientationClass,
  sunshineClass,
  maxPanels,
  maxConfigPanels,
}) {
  let score = 0;
  const reasons = [];

  const area = toNumber(areaM2);
  const pitch = toNumber(pitchDegrees);
  const panels = toNumber(maxPanels ?? maxConfigPanels);

  if (area >= 30) {
    score += 25;
    reasons.push("large roof segment");
  } else if (area >= 12) {
    score += 15;
    reasons.push("medium roof segment");
  } else if (area >= 8) {
    score += 5;
    reasons.push("small but potentially usable segment");
  } else {
    score -= 25;
    reasons.push("tiny roof fragment under 8m²");
  }

  if (pitch >= 25 && pitch <= 55) {
    score += 20;
    reasons.push("normal pitched roof angle");
  } else if (pitch > 0 && pitch < 25) {
    score += 5;
    reasons.push("low-pitch roof section");
  } else {
    score -= 10;
    reasons.push("unusual roof pitch");
  }

  if (orientationClass === "south") {
    score += 35;
    reasons.push("south-facing");
  } else if (orientationClass === "east_west") {
    score += 25;
    reasons.push("east/west-facing");
  } else if (orientationClass === "marginal_east_west") {
    score += 10;
    reasons.push("marginal east/west-facing");
  } else if (orientationClass === "north") {
    score -= 25;
    reasons.push("north-facing");
  }

  if (sunshineClass === "good") {
    score += 20;
    reasons.push("good sunshine");
  } else if (sunshineClass === "medium") {
    score += 10;
    reasons.push("medium sunshine");
  } else if (sunshineClass === "low") {
    score -= 10;
    reasons.push("low sunshine");
  } else if (sunshineClass === "very_low") {
    score -= 25;
    reasons.push("very low sunshine");
  }

  if (panels <= 0) {
    score -= 50;
    reasons.push("no Google panel capacity");
  }

  return {
    baseScore: score,
    reasons,
  };
}

function findLargestPanelConfig(buildingModel = {}) {
  const configs = Array.isArray(buildingModel.googlePanelConfigs)
    ? buildingModel.googlePanelConfigs
    : [];

  return configs
    .slice()
    .filter((config) => Number.isFinite(Number(config.panelsCount)))
    .sort((a, b) => Number(b.panelsCount) - Number(a.panelsCount))[0] || null;
}

function buildSegmentRowsFromBuildingModel(buildingModel = {}) {
  const roofSegments = Array.isArray(buildingModel.roofSegments)
    ? buildingModel.roofSegments
    : [];

  const maxConfig = findLargestPanelConfig(buildingModel);

  const summariesBySegmentIndex = Object.fromEntries(
    (maxConfig?.roofSegmentSummaries || [])
      .filter((summary) => summary.segmentIndex !== null && summary.segmentIndex !== undefined)
      .map((summary) => [summary.segmentIndex, summary])
  );

  return roofSegments.map((segment) => {
    const segmentIndex = segment.sourceIndex;
    const summary = summariesBySegmentIndex[segmentIndex] || {};

    const orientationClass = classifyOrientationFromGoogleAzimuth(
      segment.azimuthDegrees
    );

    const sunshineClass = classifySunshineFromSegment(segment);

    return {
      segmentIndex,
      segmentId: segment.id,
      areaM2: segment.areaM2,
      groundAreaM2: segment.groundAreaM2,
      pitchDegrees: segment.pitchDegrees,
      azimuthDegrees: segment.azimuthDegrees,
      orientationClass,
      sunshineClass,
      medianSunshineHours: getApproxMedianSunshineHours(segment),
      lowSunshineHours: getApproxLowSunshineHours(segment),
      maxConfigPanels: toNumber(summary.panelsCount),
      maxConfigAnnualKwh: toNumber(summary.yearlyEnergyDcKwh),
      closestInstallerConfigPanels: 0,
      appearsInMaxConfig: toNumber(summary.panelsCount) > 0,
      appearsInClosestInstallerConfig: false,
    };
  });
}

function buildRoofSelectionModelFromBuildingModel(buildingModel = {}, options = {}) {
  const segmentRows = buildSegmentRowsFromBuildingModel(buildingModel);

  const scoredSegments = segmentRows.map((segment) => ({
    segmentIndex: segment.segmentIndex,
    segmentId: segment.segmentId,
    ...scoreSegmentForSelection(segment),
  }));

  const fakeGoogleSolarApi = {
    maxPanels:
      toNumber(buildingModel?.solarPotential?.maxArrayPanelsCount, 0) ||
      segmentRows.reduce((sum, segment) => sum + toNumber(segment.maxConfigPanels), 0),

    segmentPanelAudit: {
      firstBuilding: {
        segmentRows,
      },
    },

    segmentSelectorAudit: {
      firstBuilding: {
        scoredSegments,
      },
    },

    practicalPanelEstimate: options.practicalPanelEstimate || null,
  };

  return buildRoofSelectionModelFromGoogleSolarApi(fakeGoogleSolarApi, options);
}

module.exports = {
  buildRoofSelectionModelFromGoogleSolarApi,
  buildRoofSelectionModelFromBuildingModel,
  calculateSegmentAnnualKwhPerKwp,
};