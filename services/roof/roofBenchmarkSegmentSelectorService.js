function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function circularDifferenceDegrees(a, b) {
  const first = numberOrNull(a);
  const second = numberOrNull(b);

  if (first === null || second === null) {
    return null;
  }

  const diff = Math.abs(first - second) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function isOppositeAzimuth(a, b) {
  const diff = circularDifferenceDegrees(a, b);
  return diff !== null && diff >= 145 && diff <= 215;
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
    return "unknown";
  }

  if (azimuth >= 135 && azimuth <= 225) {
    return "south";
  }

  if ((azimuth >= 75 && azimuth < 135) || (azimuth > 225 && azimuth <= 285)) {
    return "east_west";
  }

  if ((azimuth >= 55 && azimuth < 75) || (azimuth > 285 && azimuth <= 305)) {
    return "marginal_east_west";
  }

  return "north";
}

function classifySunshine(segment) {
  const median = getMedianSunshine(segment);

  if (median === null) {
    return "unknown";
  }

  if (median >= 850) {
    return "good";
  }

  if (median >= 750) {
    return "medium";
  }

  if (median >= 650) {
    return "low";
  }

  return "very_low";
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

function getMaxPanelConfig(configs) {
  return configs.reduce((best, config) => {
    const panels = numberOrNull(config?.panelsCount) || 0;
    const bestPanels = numberOrNull(best?.panelsCount) || 0;
    return panels > bestPanels ? config : best;
  }, null);
}

function getConfigSegmentIndexes(config) {
  const indexes = new Set();

  for (const summary of config?.roofSegmentSummaries || []) {
    const segmentIndex = numberOrNull(summary.segmentIndex);
    if (segmentIndex !== null) {
      indexes.add(segmentIndex);
    }
  }

  return indexes;
}

function configUsesOnlySegments(config, allowedSegmentIndexes) {
  const used = getConfigSegmentIndexes(config);

  if (used.size === 0) {
    return false;
  }

  for (const segmentIndex of used) {
    if (!allowedSegmentIndexes.has(segmentIndex)) {
      return false;
    }
  }

  return true;
}

function getBestConfigForAllowedSegments(configs, allowedSegmentIndexes) {
  const usableConfigs = configs.filter((config) =>
    configUsesOnlySegments(config, allowedSegmentIndexes)
  );

  return getMaxPanelConfig(usableConfigs);
}

function scoreBaseSegment(segment) {
  const areaM2 = numberOrNull(segment.areaM2);
  const pitch = numberOrNull(segment.pitchDegrees);
  const orientation = classifyOrientation(segment.azimuthDegrees);
  const sun = classifySunshine(segment);
  const medianSunshine = getMedianSunshine(segment);

  let score = 0;
  const reasons = [];

  if (areaM2 !== null) {
    if (areaM2 >= 25) {
      score += 35;
      reasons.push("large roof segment");
    } else if (areaM2 >= 12) {
      score += 20;
      reasons.push("medium roof segment");
    } else if (areaM2 >= 8) {
      score += 8;
      reasons.push("small but potentially usable segment");
    } else {
      score -= 40;
      reasons.push("tiny roof fragment under 8m²");
    }
  }

  if (pitch !== null) {
    if (pitch >= 25 && pitch <= 55) {
      score += 20;
      reasons.push("normal pitched roof angle");
    } else if (pitch >= 15 && pitch < 25) {
      score -= 5;
      reasons.push("low-pitch roof section");
    } else if (pitch < 15) {
      score -= 25;
      reasons.push("very low-pitch roof section");
    } else {
      score -= 20;
      reasons.push("unusually steep roof section");
    }
  }

  if (orientation === "south") {
    score += 25;
    reasons.push("south-facing");
  } else if (orientation === "east_west") {
    score += 20;
    reasons.push("east/west-facing");
  } else if (orientation === "marginal_east_west") {
    score += 3;
    reasons.push("marginal east/west-facing");
  } else if (orientation === "north") {
    score -= 35;
    reasons.push("north-facing");
  }

  if (sun === "good") {
    score += 20;
    reasons.push("good sunshine");
  } else if (sun === "medium") {
    score += 10;
    reasons.push("medium sunshine");
  } else if (sun === "low") {
    score -= 15;
    reasons.push("low sunshine");
  } else if (sun === "very_low") {
    score -= 40;
    reasons.push("very low sunshine");
  }

  return {
    segmentIndex: numberOrNull(segment.sourceIndex),
    segmentId: segment.id,
    areaM2: round1(areaM2),
    groundAreaM2: round1(segment.groundAreaM2),
    pitchDegrees: round1(pitch),
    azimuthDegrees: round1(segment.azimuthDegrees),
    orientationClass: orientation,
    sunshineClass: sun,
    medianSunshineHours: round1(medianSunshine),
    lowSunshineHours: round1(getLowSunshine(segment)),
    baseScore: score,
    reasons,
  };
}

function findMainRoofPair(scoredSegments) {
  let bestPair = null;

  for (let i = 0; i < scoredSegments.length; i += 1) {
    for (let j = i + 1; j < scoredSegments.length; j += 1) {
      const a = scoredSegments[i];
      const b = scoredSegments[j];

      const aArea = numberOrNull(a.areaM2);
      const bArea = numberOrNull(b.areaM2);
      const aPitch = numberOrNull(a.pitchDegrees);
      const bPitch = numberOrNull(b.pitchDegrees);

      if (aArea === null || bArea === null || aPitch === null || bPitch === null) {
        continue;
      }

      if (aArea < 20 || bArea < 20) {
        continue;
      }

      if (Math.abs(aPitch - bPitch) > 8) {
        continue;
      }

      if (!isOppositeAzimuth(a.azimuthDegrees, b.azimuthDegrees)) {
        continue;
      }

      if (a.baseScore < 70 || b.baseScore < 70) {
        continue;
      }

      if (
        !["south", "east_west"].includes(a.orientationClass) ||
        !["south", "east_west"].includes(b.orientationClass)
      ) {
        continue;
      }

      if (
        ["low", "very_low", "unknown"].includes(a.sunshineClass) ||
        ["low", "very_low", "unknown"].includes(b.sunshineClass)
      ) {
        continue;
      }

      const combinedScore =
        a.baseScore +
        b.baseScore +
        Math.min(aArea, bArea) * 1.5 -
        Math.abs(aArea - bArea) * 0.5 -
        Math.abs(aPitch - bPitch) * 2;

      if (!bestPair || combinedScore > bestPair.score) {
        bestPair = {
          type: "main_roof_pair",
          segmentIndexes: [a.segmentIndex, b.segmentIndex],
          score: round1(combinedScore),
          reasons: [
            "Matched main roof pair: similar pitch, opposite azimuths, and usable area.",
          ],
        };
      }
    }
  }

  return bestPair;
}

function chooseRecommendedSegments(scoredSegments) {
  const mainRoofPair = findMainRoofPair(scoredSegments);

  if (mainRoofPair) {
    const recommended = new Set(mainRoofPair.segmentIndexes);

    const optional = scoredSegments
      .filter((segment) => {
        if (recommended.has(segment.segmentIndex)) {
          return false;
        }

        return segment.baseScore >= 65 && segment.areaM2 >= 12;
      })
      .map((segment) => segment.segmentIndex);

    const excluded = scoredSegments
      .filter(
        (segment) =>
          !recommended.has(segment.segmentIndex) &&
          !optional.includes(segment.segmentIndex)
      )
      .map((segment) => segment.segmentIndex);

    return {
      strategy: "main_roof_pair",
      recommendedSegmentIndexes: Array.from(recommended),
      optionalSegmentIndexes: optional,
      excludedSegmentIndexes: excluded,
      reasons: mainRoofPair.reasons,
    };
  }

  const recommended = scoredSegments
    .filter((segment) => segment.baseScore >= 60)
    .map((segment) => segment.segmentIndex);

  const optional = scoredSegments
    .filter(
      (segment) =>
        segment.baseScore >= 40 && segment.baseScore < 60
    )
    .map((segment) => segment.segmentIndex);

  const excluded = scoredSegments
    .filter((segment) => segment.baseScore < 40)
    .map((segment) => segment.segmentIndex);

  return {
    strategy: "score_threshold",
    recommendedSegmentIndexes: recommended,
    optionalSegmentIndexes: optional,
    excludedSegmentIndexes: excluded,
    reasons: ["Recommended segments chosen by area, pitch, orientation and sunshine score."],
  };
}

function getSegmentSummaries(config) {
  return Array.isArray(config?.roofSegmentSummaries)
    ? config.roofSegmentSummaries.map((summary) => ({
        segmentIndex: numberOrNull(summary.segmentIndex),
        panelsCount: numberOrNull(summary.panelsCount),
        yearlyEnergyDcKwh: round1(summary.yearlyEnergyDcKwh),
        pitchDegrees: round1(summary.pitchDegrees),
        azimuthDegrees: round1(summary.azimuthDegrees),
      }))
    : [];
}

function buildSegmentAggregateConfig(config, allowedSegmentIndexes) {
  if (!config || !allowedSegmentIndexes || allowedSegmentIndexes.size === 0) {
    return null;
  }

  const roofSegmentSummaries = getSegmentSummaries(config).filter((summary) =>
    allowedSegmentIndexes.has(summary.segmentIndex)
  );

  if (roofSegmentSummaries.length === 0) {
    return null;
  }

  const panelsCount = roofSegmentSummaries.reduce(
    (sum, summary) => sum + (numberOrNull(summary.panelsCount) || 0),
    0
  );

  const yearlyEnergyDcKwh = roofSegmentSummaries.reduce(
    (sum, summary) => sum + (numberOrNull(summary.yearlyEnergyDcKwh) || 0),
    0
  );

  return {
    source: "max_config_recommended_segment_sum",
    panelsCount,
    yearlyEnergyDcKwh: round1(yearlyEnergyDcKwh),
    roofSegmentSummaries,
  };
}

function buildBuildingSegmentSelector(building) {
  const roofSegments = Array.isArray(building?.roofSegments)
    ? building.roofSegments
    : [];

  const configs = getGooglePanelConfigs(building);
  const scoredSegments = roofSegments.map(scoreBaseSegment);
  const selection = chooseRecommendedSegments(scoredSegments);

  const recommendedSet = new Set(selection.recommendedSegmentIndexes);
  const exactRecommendedConfig = getBestConfigForAllowedSegments(
    configs,
    recommendedSet
  );

  const maxConfig = getMaxPanelConfig(configs);

  const recommendedConfig =
    exactRecommendedConfig ||
    buildSegmentAggregateConfig(maxConfig, recommendedSet);

  return {
    buildingId: building?.id ?? null,
    providerBuildingName: building?.providerBuildingName ?? null,
    strategy: selection.strategy,
    recommendedSegmentIndexes: selection.recommendedSegmentIndexes,
    optionalSegmentIndexes: selection.optionalSegmentIndexes,
    excludedSegmentIndexes: selection.excludedSegmentIndexes,
    selectionReasons: selection.reasons,
    scoredSegments,
    recommendedConfig: recommendedConfig
      ? {
          source: recommendedConfig.source || "exact_google_config",
          panelsCount: numberOrNull(recommendedConfig.panelsCount),
          yearlyEnergyDcKwh: round1(recommendedConfig.yearlyEnergyDcKwh),
          roofSegmentSummaries:
            recommendedConfig.roofSegmentSummaries ||
            getSegmentSummaries(recommendedConfig),
        }
      : null,
  };
}

function buildSegmentSelectorAudit(analysis) {
  const buildings = Array.isArray(analysis?.solarBuildingModels)
    ? analysis.solarBuildingModels
    : [];

  const buildingAudits = buildings.map(buildBuildingSegmentSelector);

  return {
    source: "zeyzer_segment_selector_v1",
    status: buildingAudits.length ? "complete" : "no_buildings",
    buildingAudits,
    firstBuilding: buildingAudits[0] || null,
  };
}

module.exports = {
  buildSegmentSelectorAudit,
};
