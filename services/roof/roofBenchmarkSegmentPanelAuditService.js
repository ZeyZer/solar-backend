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

function getConfigClosestToPanelCount(configs, targetPanelCount) {
  const target = numberOrNull(targetPanelCount);

  if (target === null) {
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
    const bestDelta = Math.abs(
      (numberOrNull(best?.panelsCount) || 0) - target
    );

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

function summariseConfigBySegment(config) {
  const map = new Map();

  for (const summary of config?.roofSegmentSummaries || []) {
    const segmentIndex = numberOrNull(summary.segmentIndex);

    if (segmentIndex === null) {
      continue;
    }

    map.set(segmentIndex, {
      segmentIndex,
      panelsCount: numberOrNull(summary.panelsCount) || 0,
      yearlyEnergyDcKwh: round1(summary.yearlyEnergyDcKwh),
      pitchDegrees: round1(summary.pitchDegrees),
      azimuthDegrees: round1(summary.azimuthDegrees),
    });
  }

  return map;
}

function buildSegmentRows({ building, maxConfig, closestInstallerConfig }) {
  const roofSegments = Array.isArray(building?.roofSegments)
    ? building.roofSegments
    : [];

  const maxBySegment = summariseConfigBySegment(maxConfig);
  const closestBySegment = summariseConfigBySegment(closestInstallerConfig);

  return roofSegments.map((segment) => {
    const segmentIndex = numberOrNull(segment.sourceIndex);
    const max = maxBySegment.get(segmentIndex) || null;
    const closest = closestBySegment.get(segmentIndex) || null;

    return {
      segmentIndex,
      segmentId: segment.id,
      areaM2: round1(segment.areaM2),
      groundAreaM2: round1(segment.groundAreaM2),
      pitchDegrees: round1(segment.pitchDegrees),
      azimuthDegrees: round1(segment.azimuthDegrees),
      orientationClass: classifyOrientation(segment.azimuthDegrees),
      sunshineClass: classifySunshine(segment),
      medianSunshineHours: round1(getMedianSunshine(segment)),
      lowSunshineHours: round1(getLowSunshine(segment)),

      maxConfigPanels: max?.panelsCount || 0,
      maxConfigAnnualKwh: max?.yearlyEnergyDcKwh || 0,

      closestInstallerConfigPanels: closest?.panelsCount || 0,
      closestInstallerConfigAnnualKwh: closest?.yearlyEnergyDcKwh || 0,

      appearsInMaxConfig: Boolean(max?.panelsCount),
      appearsInClosestInstallerConfig: Boolean(closest?.panelsCount),
    };
  });
}

function buildBuildingSegmentPanelAudit(building, installerPanelCount) {
  const configs = getGooglePanelConfigs(building);
  const maxConfig = getMaxPanelConfig(configs);
  const closestInstallerConfig = getConfigClosestToPanelCount(
    configs,
    installerPanelCount
  );

  const segmentRows = buildSegmentRows({
    building,
    maxConfig,
    closestInstallerConfig,
  });

  const maxConfigPanelTotal = segmentRows.reduce(
    (sum, row) => sum + (numberOrNull(row.maxConfigPanels) || 0),
    0
  );

  const closestInstallerPanelTotal = segmentRows.reduce(
    (sum, row) => sum + (numberOrNull(row.closestInstallerConfigPanels) || 0),
    0
  );

  const maxOnlySegments = segmentRows.filter(
    (row) => row.appearsInMaxConfig && !row.appearsInClosestInstallerConfig
  );

  const closestSegments = segmentRows.filter(
    (row) => row.appearsInClosestInstallerConfig
  );

  return {
    buildingId: building?.id ?? null,
    providerBuildingName: building?.providerBuildingName ?? null,
    roofSegmentCount: building?.roofSegmentCount ?? segmentRows.length,

    googleMaxConfig: maxConfig
      ? {
          panelsCount: numberOrNull(maxConfig.panelsCount),
          yearlyEnergyDcKwh: round1(maxConfig.yearlyEnergyDcKwh),
        }
      : null,

    closestInstallerPanelCountConfig: closestInstallerConfig
      ? {
          panelsCount: numberOrNull(closestInstallerConfig.panelsCount),
          yearlyEnergyDcKwh: round1(closestInstallerConfig.yearlyEnergyDcKwh),
        }
      : null,

    maxConfigPanelTotal,
    closestInstallerPanelTotal,

    maxOnlySegmentIndexes: maxOnlySegments.map((row) => row.segmentIndex),
    closestInstallerSegmentIndexes: closestSegments.map(
      (row) => row.segmentIndex
    ),

    segmentRows,
  };
}

function buildSegmentPanelAudit(analysis, benchmarkItem = {}) {
  const installerPanelCount = numberOrNull(
    benchmarkItem?.installerDesignTruth?.panelCount
  );

  const buildings = Array.isArray(analysis?.solarBuildingModels)
    ? analysis.solarBuildingModels
    : [];

  const buildingAudits = buildings.map((building) =>
    buildBuildingSegmentPanelAudit(building, installerPanelCount)
  );

  return {
    source: "zeyzer_segment_panel_audit_v1",
    status: buildingAudits.length ? "complete" : "no_buildings",
    buildingAudits,
    firstBuilding: buildingAudits[0] || null,
  };
}

module.exports = {
  buildSegmentPanelAudit,
};
