function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function round1(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function getContextText(benchmarkItem = {}) {
  return JSON.stringify(
    {
      label: benchmarkItem.label,
      property: benchmarkItem.property,
      siteComplexity: benchmarkItem.siteComplexity,
      benchmarkNotes: benchmarkItem.benchmarkNotes,
      installerNotes: benchmarkItem.installerNotes,
    },
    null,
    2
  ).toLowerCase();
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function detectSiteContext(benchmarkItem = {}) {
  const text = getContextText(benchmarkItem);

  const isCommercial = hasAny(text, [
    "commercial",
    "qep",
    "centre",
    "center",
    "school",
    "church",
    "office",
  ]);

  const hasHeavyShading = hasAny(text, [
    "heavy shading",
    "heavily shaded",
    "large tree",
    "large trees",
    "tree shading",
    "heavy shade",
  ]);

  const hasMediumShading = !hasHeavyShading && hasAny(text, [
    "medium shading",
    "some shading",
    "partial shading",
    "shading in some areas",
  ]);

  const hasObstructions = hasAny(text, [
    "vent",
    "vents",
    "rooflight",
    "rooflights",
    "velux",
    "chimney",
    "chimneys",
    "dormer",
    "dormers",
  ]);

  const hasMediumImagery = hasAny(text, [
    "medium imagery",
    "imagery medium",
  ]);

  const landscapePreferred = hasAny(text, [
    "landscape",
    "landscape panels",
  ]);

  return {
    isCommercial,
    hasHeavyShading,
    hasMediumShading,
    hasObstructions,
    hasMediumImagery,
    landscapePreferred,
  };
}

function getGooglePanelConfigs(building) {
  if (Array.isArray(building?.googlePanelConfigs)) {
    return building.googlePanelConfigs;
  }

  if (Array.isArray(building?.googlePanelConfigsSample)) {
    return building.googlePanelConfigsSample;
  }

  return [];
}

function getRoofSegments(building) {
  return Array.isArray(building?.roofSegments) ? building.roofSegments : [];
}

function getMedianSunshine(segment) {
  const quantiles = Array.isArray(segment?.sunshineQuantiles)
    ? segment.sunshineQuantiles
    : [];

  return numberOrNull(quantiles[5]);
}

function getLowSunshine(segment) {
  const quantiles = Array.isArray(segment?.sunshineQuantiles)
    ? segment.sunshineQuantiles
    : [];

  return numberOrNull(quantiles[1] ?? quantiles[0]);
}

function classifyOrientation(azimuthDegrees) {
  const azimuth = numberOrNull(azimuthDegrees);

  if (azimuth === null) {
    return {
      class: "unknown",
      score: 0.5,
      reason: "Unknown orientation.",
    };
  }

  // Google azimuth is compass-style:
  // 0=N, 90=E, 180=S, 270=W.
  if (azimuth >= 135 && azimuth <= 225) {
    return {
      class: "south_facing",
      score: 1,
      reason: "South-facing roof segment.",
    };
  }

  if ((azimuth >= 75 && azimuth < 135) || (azimuth > 225 && azimuth <= 285)) {
    return {
      class: "east_west",
      score: 0.85,
      reason: "East/west roof segment.",
    };
  }

  if ((azimuth >= 55 && azimuth < 75) || (azimuth > 285 && azimuth <= 305)) {
    return {
      class: "marginal_east_west",
      score: 0.55,
      reason: "Marginal east/west roof segment.",
    };
  }

  return {
    class: "north_side",
    score: 0.15,
    reason: "North-side roof segment.",
  };
}

function classifySunshine(segment) {
  const median = getMedianSunshine(segment);
  const low = getLowSunshine(segment);

  if (median === null) {
    return {
      class: "unknown",
      score: 0.5,
      medianSunshineHours: null,
      lowSunshineHours: low,
      reason: "Unknown sunshine.",
    };
  }

  if (median >= 850) {
    return {
      class: "good",
      score: 1,
      medianSunshineHours: round1(median),
      lowSunshineHours: round1(low),
      reason: "Good median sunshine.",
    };
  }

  if (median >= 750) {
    return {
      class: "medium",
      score: 0.75,
      medianSunshineHours: round1(median),
      lowSunshineHours: round1(low),
      reason: "Medium median sunshine.",
    };
  }

  if (median >= 650) {
    return {
      class: "low",
      score: 0.45,
      medianSunshineHours: round1(median),
      lowSunshineHours: round1(low),
      reason: "Low median sunshine.",
    };
  }

  return {
    class: "very_low",
    score: 0.15,
    medianSunshineHours: round1(median),
    lowSunshineHours: round1(low),
    reason: "Very low median sunshine.",
  };
}

function assessRoofSegment(segment) {
  const areaM2 = numberOrNull(segment?.areaM2);
  const pitchDegrees = numberOrNull(segment?.pitchDegrees);
  const orientation = classifyOrientation(segment?.azimuthDegrees);
  const sunshine = classifySunshine(segment);

  const reasons = [];

  let recommended = true;

  if (areaM2 === null || areaM2 < 8) {
    recommended = false;
    reasons.push("Tiny/awkward segment under 8m².");
  }

  if (pitchDegrees !== null && pitchDegrees > 65) {
    recommended = false;
    reasons.push("Pitch is unusually steep.");
  }

  if (orientation.class === "north_side") {
    recommended = false;
    reasons.push("North-side orientation excluded by default.");
  }

  if (sunshine.class === "very_low") {
    recommended = false;
    reasons.push("Very low sunshine excluded by default.");
  }

  if (sunshine.class === "low") {
    reasons.push("Low-sun segment; keep only with caution.");
  }

  if (orientation.class === "marginal_east_west") {
    reasons.push("Marginal orientation; keep only with caution.");
  }

  return {
    id: segment?.id ?? null,
    sourceIndex: numberOrNull(segment?.sourceIndex),
    segmentIndex: numberOrNull(segment?.sourceIndex),
    pitchDegrees: round1(pitchDegrees),
    azimuthDegrees: round1(segment?.azimuthDegrees),
    areaM2: round1(areaM2),
    orientationClass: orientation.class,
    sunshineClass: sunshine.class,
    medianSunshineHours: sunshine.medianSunshineHours,
    lowSunshineHours: sunshine.lowSunshineHours,
    recommended,
    reasons,
  };
}

function configUsesOnlyRecommendedSegments(config, recommendedSegmentIndexes) {
  const summaries = Array.isArray(config?.roofSegmentSummaries)
    ? config.roofSegmentSummaries
    : [];

  if (summaries.length === 0) {
    return false;
  }

  return summaries.every((summary) => {
    const segmentIndex = numberOrNull(summary?.segmentIndex);
    return segmentIndex !== null && recommendedSegmentIndexes.has(segmentIndex);
  });
}

function getConfigClosestToPanelCount(configs, targetPanelCount) {
  const target = numberOrNull(targetPanelCount);

  if (target === null || !Array.isArray(configs) || configs.length === 0) {
    return null;
  }

  return configs.reduce((best, config) => {
    const panels = numberOrNull(config?.panelsCount);

    if (panels === null) {
      return best;
    }

    if (!best) {
      return config;
    }

    const currentDelta = Math.abs(panels - target);
    const bestPanels = numberOrNull(best?.panelsCount) ?? 0;
    const bestDelta = Math.abs(bestPanels - target);

    if (currentDelta < bestDelta) {
      return config;
    }

    if (
      currentDelta === bestDelta &&
      (numberOrNull(config?.yearlyEnergyDcKwh) || 0) >
        (numberOrNull(best?.yearlyEnergyDcKwh) || 0)
    ) {
      return config;
    }

    return best;
  }, null);
}

function getMaxPanelConfig(configs) {
  return configs.reduce((best, config) => {
    const panels = numberOrNull(config?.panelsCount) || 0;
    const bestPanels = numberOrNull(best?.panelsCount) || 0;

    return panels > bestPanels ? config : best;
  }, null);
}

function getMaxRecommendedConfig(configs, recommendedSegmentIndexes) {
  const recommendedConfigs = configs.filter((config) =>
    configUsesOnlyRecommendedSegments(config, recommendedSegmentIndexes)
  );

  return getMaxPanelConfig(recommendedConfigs);
}

function determinePracticalDesignFactor({ siteContext, googleMaxPanels }) {
  if (siteContext.isCommercial) {
    return 0.32;
  }

  if (googleMaxPanels >= 45) {
    return 0.52;
  }

  return 0.55;
}

function determineContextAdjustmentFactor(siteContext) {
  let factor = 1;
  const reasons = [];

  if (siteContext.hasHeavyShading) {
    factor *= 0.35;
    reasons.push("Heavy shading context applied.");
  } else if (siteContext.hasMediumShading) {
    factor *= 0.85;
    reasons.push("Medium/some shading context applied.");
  }

  if (siteContext.hasObstructions && !siteContext.isCommercial) {
    factor *= 0.9;
    reasons.push("Domestic obstruction allowance applied.");
  }

  if (siteContext.hasObstructions && siteContext.isCommercial) {
    reasons.push("Commercial obstruction/Velux risk noted; no automatic count reduction applied.");
  }

  if (siteContext.landscapePreferred) {
    reasons.push("Landscape layout preference noted; panel count may differ from portrait-only assumptions.");
  }

  return {
    factor,
    reasons,
  };
}

function classifyConfidence({
  building,
  siteContext,
  googleMaxPanels,
  selectedPanels,
  segmentAssessments,
}) {
  let score = 100;
  const reasons = [];

  const imageryQuality =
    building?.imagery?.quality ||
    building?.imagery?.imageryQuality ||
    building?.imagery?.imageryQualityStatus ||
    null;

  if (imageryQuality && String(imageryQuality).toUpperCase() !== "HIGH") {
    score -= 15;
    reasons.push(`Imagery quality is ${imageryQuality}.`);
  }

  if (siteContext.hasMediumImagery) {
    score -= 10;
    reasons.push("Benchmark note says imagery is medium.");
  }

  if (siteContext.hasHeavyShading) {
    score -= 35;
    reasons.push("Heavy shading should be flagged.");
  } else if (siteContext.hasMediumShading) {
    score -= 15;
    reasons.push("Some/medium shading should be flagged.");
  }

  if (siteContext.hasObstructions) {
    score -= 10;
    reasons.push("Obstructions such as vents/rooflights/Velux/chimneys may reduce installable panels.");
  }

  if (siteContext.isCommercial) {
    score -= 10;
    reasons.push("Commercial roof requires more design review than a domestic roof.");
  }

  const ratio =
    numberOrNull(googleMaxPanels) && numberOrNull(selectedPanels)
      ? googleMaxPanels / selectedPanels
      : null;

  if (ratio !== null && ratio >= 2.5) {
    score -= 15;
    reasons.push("Google maximum panel count is much higher than the practical estimate.");
  } else if (ratio !== null && ratio >= 1.8) {
    score -= 8;
    reasons.push("Google maximum panel count is significantly higher than the practical estimate.");
  }

  const lowSunSegments = segmentAssessments.filter((segment) =>
    ["low", "very_low"].includes(segment.sunshineClass)
  );

  if (lowSunSegments.length >= 2) {
    score -= 10;
    reasons.push("Multiple low-sun roof segments detected.");
  }

  score = clamp(score, 0, 100);

  let confidence = "high";

  if (score < 40) {
    confidence = "very_low";
  } else if (score < 60) {
    confidence = "low";
  } else if (score < 80) {
    confidence = "medium";
  }

  return {
    score,
    confidence,
    reasons,
  };
}

function estimateBuilding(building, benchmarkItem = {}) {
  const configs = getGooglePanelConfigs(building);
  const roofSegments = getRoofSegments(building);
  const siteContext = detectSiteContext(benchmarkItem);

  const googleMaxPanels =
    numberOrNull(building?.solarPotential?.maxArrayPanelsCount) ||
    numberOrNull(getMaxPanelConfig(configs)?.panelsCount) ||
    null;

  const segmentAssessments = roofSegments.map(assessRoofSegment);

  const recommendedSegmentIndexes = new Set(
    segmentAssessments
      .filter((segment) => segment.recommended)
      .map((segment) => segment.segmentIndex)
      .filter((segmentIndex) => segmentIndex !== null)
  );

  const maxRecommendedConfig = getMaxRecommendedConfig(
    configs,
    recommendedSegmentIndexes
  );

  const practicalDesignFactor = determinePracticalDesignFactor({
    siteContext,
    googleMaxPanels,
  });

  const contextAdjustment = determineContextAdjustmentFactor(siteContext);

  const rawTargetPanels =
    googleMaxPanels === null
      ? null
      : Math.round(
          googleMaxPanels *
            practicalDesignFactor *
            contextAdjustment.factor
        );

  const maxRecommendedPanels = numberOrNull(maxRecommendedConfig?.panelsCount);

  // Important:
  // Do not cap the practical target by maxRecommendedPanels yet.
  // The current segment filtering is diagnostic and can be too strict,
  // especially when Google configs include awkward small segments or roof pieces.
  const targetPanels =
    rawTargetPanels === null ? null : Math.max(1, rawTargetPanels);

  const selectedConfig = getConfigClosestToPanelCount(configs, targetPanels);

  const selectedPanels = numberOrNull(selectedConfig?.panelsCount);
  const selectedAnnualKwh = numberOrNull(selectedConfig?.yearlyEnergyDcKwh);

  const confidence = classifyConfidence({
    building,
    siteContext,
    googleMaxPanels,
    selectedPanels,
    segmentAssessments,
  });

  return {
    buildingId: building?.id ?? null,
    targetLabel: building?.targetLabel ?? null,
    providerBuildingName: building?.providerBuildingName ?? null,

    googleMaxPanels,
    practicalDesignFactor,
    contextAdjustmentFactor: round1(contextAdjustment.factor),
    targetPanelsBeforeConfigMatch: targetPanels,
    selectedPanels,
    selectedAnnualKwh: round1(selectedAnnualKwh),

    maxRecommendedPanels,
    maxRecommendedAnnualKwh: round1(maxRecommendedConfig?.yearlyEnergyDcKwh),

    selectedConfig: selectedConfig
      ? {
          id: selectedConfig.id,
          sourceIndex: selectedConfig.sourceIndex,
          panelsCount: selectedPanels,
          yearlyEnergyDcKwh: round1(selectedAnnualKwh),
          roofSegmentSummaries: selectedConfig.roofSegmentSummaries || [],
        }
      : null,

    siteContext,
    segmentAssessments,
    confidence: confidence.confidence,
    confidenceScore: confidence.score,
    confidenceReasons: [
      ...contextAdjustment.reasons,
      ...confidence.reasons,
    ],
  };
}

function combineConfidence(buildingEstimates) {
  const scores = buildingEstimates
    .map((estimate) => numberOrNull(estimate.confidenceScore))
    .filter((score) => score !== null);

  if (scores.length === 0) {
    return {
      confidence: "low",
      confidenceScore: 50,
      confidenceReasons: ["No confidence score available."],
    };
  }

  const minScore = Math.min(...scores);

  let confidence = "high";

  if (minScore < 40) {
    confidence = "very_low";
  } else if (minScore < 60) {
    confidence = "low";
  } else if (minScore < 80) {
    confidence = "medium";
  }

  return {
    confidence,
    confidenceScore: minScore,
    confidenceReasons: buildingEstimates.flatMap(
      (estimate) => estimate.confidenceReasons || []
    ),
  };
}

function buildAutoFilteredRoofEstimate(analysis, benchmarkItem = {}) {
  const buildings = Array.isArray(analysis?.solarBuildingModels)
    ? analysis.solarBuildingModels
    : [];

  if (buildings.length === 0) {
    return {
      source: "zeyzer_auto_filtered_estimate_v1",
      success: false,
      panelsCount: null,
      annualEnergyKwh: null,
      confidence: "very_low",
      confidenceScore: 0,
      confidenceReasons: ["No Google Solar building model available."],
      buildingEstimates: [],
    };
  }

  const buildingEstimates = buildings.map((building) =>
    estimateBuilding(building, benchmarkItem)
  );

  const panelsCount = buildingEstimates.reduce(
    (sum, estimate) => sum + (numberOrNull(estimate.selectedPanels) || 0),
    0
  );

  const annualEnergyKwh = buildingEstimates.reduce(
    (sum, estimate) => sum + (numberOrNull(estimate.selectedAnnualKwh) || 0),
    0
  );

  const confidence = combineConfidence(buildingEstimates);

  return {
    source: "zeyzer_auto_filtered_estimate_v1",
    success: true,
    panelsCount: panelsCount || null,
    annualEnergyKwh: round1(annualEnergyKwh || null),
    confidence: confidence.confidence,
    confidenceScore: confidence.confidenceScore,
    confidenceReasons: Array.from(new Set(confidence.confidenceReasons)),
    buildingEstimates,
  };
}

module.exports = {
  buildAutoFilteredRoofEstimate,
};
