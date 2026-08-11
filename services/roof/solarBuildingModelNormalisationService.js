function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, decimals = 2) {
  const number = numberOrNull(value);

  if (number === null) {
    return null;
  }

  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function formatGoogleDate(date) {
  if (!date || !date.year) {
    return null;
  }

  const year = String(date.year).padStart(4, "0");
  const month = String(date.month || 1).padStart(2, "0");
  const day = String(date.day || 1).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function normaliseLatLng(value) {
  if (!value) {
    return null;
  }

  const latitude = numberOrNull(value.latitude);
  const longitude = numberOrNull(value.longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

function normaliseBoundingBox(value) {
  if (!value) {
    return null;
  }

  return {
    sw: normaliseLatLng(value.sw),
    ne: normaliseLatLng(value.ne),
  };
}

function normaliseSizeAndSunshineStats(stats) {
  if (!stats) {
    return null;
  }

  return {
    areaM2: round(stats.areaMeters2),
    groundAreaM2: round(stats.groundAreaMeters2),
    sunshineQuantiles: Array.isArray(stats.sunshineQuantiles)
      ? stats.sunshineQuantiles.map((item) => round(item, 3))
      : [],
  };
}

function normaliseRoofSegment(segment, index) {
  const stats = normaliseSizeAndSunshineStats(segment?.stats);

  return {
    id: `google-roof-segment-${index + 1}`,
    sourceIndex: index,

    pitchDegrees: round(segment?.pitchDegrees, 1),
    azimuthDegrees: round(segment?.azimuthDegrees, 1),

    areaM2: stats?.areaM2 || null,
    groundAreaM2: stats?.groundAreaM2 || null,
    sunshineQuantiles: stats?.sunshineQuantiles || [],

    center: normaliseLatLng(segment?.center),
    boundingBox: normaliseBoundingBox(segment?.boundingBox),

    planeHeightAtCenterMeters: round(segment?.planeHeightAtCenterMeters, 2),

    usable: true,
    userExcluded: false,
    confidence: "google_solar_api_model",
  };
}

function normaliseSolarPanel(panel, index) {
  return {
    id: `google-panel-${index + 1}`,
    sourceIndex: index,
    center: normaliseLatLng(panel?.center),
    orientation: panel?.orientation || null,
    segmentIndex: Number.isInteger(panel?.segmentIndex)
      ? panel.segmentIndex
      : null,
    yearlyEnergyDcKwh: round(panel?.yearlyEnergyDcKwh, 1),
  };
}

function normaliseRoofSegmentSummary(summary, index) {
  return {
    sourceIndex: index,
    pitchDegrees: round(summary?.pitchDegrees, 1),
    azimuthDegrees: round(summary?.azimuthDegrees, 1),
    panelsCount: numberOrNull(summary?.panelsCount),
    yearlyEnergyDcKwh: round(summary?.yearlyEnergyDcKwh, 1),
    segmentIndex: Number.isInteger(summary?.segmentIndex)
      ? summary.segmentIndex
      : null,
  };
}

function normalisePanelConfig(config, index) {
  return {
    id: `google-panel-config-${index + 1}`,
    sourceIndex: index,
    panelsCount: numberOrNull(config?.panelsCount),
    yearlyEnergyDcKwh: round(config?.yearlyEnergyDcKwh, 1),
    roofSegmentSummaries: Array.isArray(config?.roofSegmentSummaries)
      ? config.roofSegmentSummaries.map(normaliseRoofSegmentSummary)
      : [],
  };
}

function normaliseDetectedArrays(detectedArrays) {
  if (!detectedArrays) {
    return null;
  }

  return {
    detectionStatus: detectedArrays.detectionStatus || null,
    latestCaptureDate: formatGoogleDate(detectedArrays.latestCaptureDate),
  };
}

function normaliseGoogleSolarBuildingInsights(providerResponse, options = {}) {
  const target = options.target || {};
  const solarPotential = providerResponse?.solarPotential || {};
  const roofSegmentStats = Array.isArray(solarPotential.roofSegmentStats)
    ? solarPotential.roofSegmentStats
    : [];

  const solarPanels = Array.isArray(solarPotential.solarPanels)
    ? solarPotential.solarPanels
    : [];

  const solarPanelConfigs = Array.isArray(solarPotential.solarPanelConfigs)
    ? solarPotential.solarPanelConfigs
    : [];

  const roofSegments = roofSegmentStats.map(normaliseRoofSegment);

  return {
    id: options.id || "google-solar-building-1",
    targetId: target.id || null,
    targetLabel: target.label || null,

    diagnosticOnly: true,
    source: "google_solar_api_building_insights",
    providerBuildingName: providerResponse?.name || null,

    requestedLocation: {
      latitude: numberOrNull(target.latitude),
      longitude: numberOrNull(target.longitude),
    },

    center: normaliseLatLng(providerResponse?.center),
    boundingBox: normaliseBoundingBox(providerResponse?.boundingBox),

    postalCode: providerResponse?.postalCode || null,
    administrativeArea: providerResponse?.administrativeArea || null,
    statisticalArea: providerResponse?.statisticalArea || null,
    regionCode: providerResponse?.regionCode || null,

    imagery: {
      quality: providerResponse?.imageryQuality || null,
      date: formatGoogleDate(providerResponse?.imageryDate),
      processedDate: formatGoogleDate(providerResponse?.imageryProcessedDate),
    },

    solarPotential: {
      maxArrayPanelsCount: numberOrNull(solarPotential.maxArrayPanelsCount),
      maxArrayAreaM2: round(solarPotential.maxArrayAreaMeters2),
      maxSunshineHoursPerYear: round(solarPotential.maxSunshineHoursPerYear, 1),

      panelCapacityWatts: numberOrNull(solarPotential.panelCapacityWatts),
      panelHeightMeters: round(solarPotential.panelHeightMeters, 3),
      panelWidthMeters: round(solarPotential.panelWidthMeters, 3),
      panelLifetimeYears: numberOrNull(solarPotential.panelLifetimeYears),

      carbonOffsetFactorKgPerMwh: round(
        solarPotential.carbonOffsetFactorKgPerMwh,
        2
      ),

      wholeRoofStats: normaliseSizeAndSunshineStats(
        solarPotential.wholeRoofStats
      ),
      buildingStats: normaliseSizeAndSunshineStats(
        solarPotential.buildingStats
      ),
    },

    roofSegmentCount: roofSegments.length,
    roofSegments,

    googlePanelPositionsSample: solarPanels
      .slice(0, 30)
      .map(normaliseSolarPanel),

    googlePanelPositionsCount: solarPanels.length,

    googlePanelConfigsSample: solarPanelConfigs
      .slice(0, 20)
      .map(normalisePanelConfig),

    googlePanelConfigsCount: solarPanelConfigs.length,

    detectedArrays: normaliseDetectedArrays(providerResponse?.detectedArrays),

    warnings: [
      "Diagnostic only. Not survey verified.",
      "Google panel positions/configurations use Google's own panel assumptions, not Zion Energy's final product catalogue.",
    ],
  };
}

module.exports = {
  normaliseGoogleSolarBuildingInsights,
};
