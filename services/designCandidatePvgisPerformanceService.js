const DESIGN_CANDIDATE_PVGIS_PERFORMANCE_VERSION = "2026-beta-1";

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function sum(values = []) {
  return values.reduce((total, value) => total + numberOrZero(value), 0);
}

function getHourlyArray(value) {
  return Array.isArray(value)
    ? value.map((v) => Math.max(0, numberOrZero(v)))
    : null;
}

function getMonthIdxArray(value, expectedLength = null) {
  if (!Array.isArray(value)) return null;

  const mapped = value.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

  if (expectedLength !== null && mapped.length !== expectedLength) return null;

  return mapped.every((v) => v !== null) ? mapped : null;
}

function getHourOfDayArray(value, expectedLength = null) {
  if (!Array.isArray(value)) return null;

  const mapped = value.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

  if (expectedLength !== null && mapped.length !== expectedLength) return null;

  return mapped.every((v) => v !== null) ? mapped : null;
}

function addHourlyArrays(a = [], b = []) {
  const length = Math.max(a.length, b.length);

  return Array.from({ length }, (_, index) => {
    return numberOrZero(a[index]) + numberOrZero(b[index]);
  });
}

function scaleHourlyArray(hourly = [], scaleFactor = 1) {
  return hourly.map((value) => round2(numberOrZero(value) * numberOrZero(scaleFactor)));
}

function aggregateMonthlyFromHourly(hourly = [], monthIdx = null) {
  const monthly = Array(12).fill(0);

  if (Array.isArray(monthIdx) && monthIdx.length === hourly.length) {
    for (let i = 0; i < hourly.length; i++) {
      const month = Number(monthIdx[i]);

      if (month >= 0 && month <= 11) {
        monthly[month] += numberOrZero(hourly[i]);
      }
    }

    return monthly.map(round2);
  }

  // Fallback aggregation only. This does not create generation;
  // it simply groups whatever hourly PVGIS data exists.
  if (!hourly.length) return monthly;

  const bucketSize = Math.ceil(hourly.length / 12);

  for (let i = 0; i < hourly.length; i++) {
    const month = Math.min(11, Math.floor(i / bucketSize));
    monthly[month] += numberOrZero(hourly[i]);
  }

  return monthly.map(round2);
}

function getArrayKwp({ array = {}, panel = null } = {}) {
  const panels = numberOrZero(array.panels || array.panelCount);
  const wattage = numberOrZero(panel?.wattage);

  if (panels <= 0 || wattage <= 0) return 0;

  return (panels * wattage) / 1000;
}

function getCandidateSystemSizeKwp({
  panel = null,
  totalPanels = 0,
  fallbackSystemSizeKwp = 0,
} = {}) {
  const wattage = numberOrZero(panel?.wattage);
  const panels = numberOrZero(totalPanels);

  if (wattage > 0 && panels > 0) {
    return round2((wattage * panels) / 1000);
  }

  return round2(fallbackSystemSizeKwp);
}

function getProfileBaseKwp(profile = {}) {
  return numberOrZero(
    profile.baseSystemSizeKwp ??
      profile.systemSizeKwp ??
      profile.arrayKwp ??
      profile.baseArrayKwp ??
      profile.kwp
  );
}

function getProfileHourly(profile = {}) {
  return getHourlyArray(
    profile.hourlyGenerationKWh ??
      profile.pvHourlyKWh ??
      profile.hourlyPvKWh ??
      profile.hourlyKWh
  );
}

function getProfileMonthIdx(profile = {}, expectedLength = null) {
  return getMonthIdxArray(
    profile.monthIdx ??
      profile._monthIdx ??
      profile.monthIndex,
    expectedLength
  );
}

function getProfileHourOfDay(profile = {}, expectedLength = null) {
  return getHourOfDayArray(
    profile.hourOfDay ??
      profile._hourOfDay,
    expectedLength
  );
}

function getPvgisRoofProfiles(quote = {}) {
  const candidates = [
    quote.designPvgisRoofProfiles,
    quote.pvgisRoofProfiles,
    quote.roofPvgisProfiles,
    quote?.hourlyModel?._pvgisRoofProfiles,
    quote?.hourlyModel?.pvgisRoofProfiles,
  ];

  for (const value of candidates) {
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }

  return [];
}

function getAggregatePvgisProfile(quote = {}) {
  const hm = quote?.hourlyModel || {};

  const hourly = getHourlyArray(
    hm._pvHourlyKWh ??
      hm.pvHourlyKWh ??
      hm.hourlyPvKWh ??
      quote._pvHourlyKWh
  );

  if (!hourly || hourly.length === 0) {
    return null;
  }

  const baseSystemSizeKwp = numberOrZero(
    quote.systemSizeKwp ??
      quote.systemSizeKWp ??
      quote.systemSize ??
      quote?.system?.systemSizeKwp
  );

  if (baseSystemSizeKwp <= 0) {
    return null;
  }

  return {
    id: "aggregate_quote_pvgis_profile",
    profileType: "aggregate",
    baseSystemSizeKwp,
    hourlyGenerationKWh: hourly,
    monthIdx: getMonthIdxArray(hm._monthIdx ?? hm.monthIdx, hourly.length),
    hourOfDay: getHourOfDayArray(hm._hourOfDay ?? hm.hourOfDay, hourly.length),
    source: "quote.hourlyModel._pvHourlyKWh",
  };
}

function normaliseId(value) {
  return String(value || "").trim().toLowerCase();
}

function profileMatchesArray(profile = {}, array = {}, index = 0) {
  const arrayId = normaliseId(array.id);

  const profileIds = [
    profile.roofId,
    profile.id,
    profile.sourceRoofId,
    profile.sourceArrayId,
    profile.arrayId,
  ]
    .map(normaliseId)
    .filter(Boolean);

  if (arrayId && profileIds.includes(arrayId)) {
    return true;
  }

  const profileIndex = Number(
    profile.index ??
      profile.roofIndex ??
      profile.arrayIndex
  );

  if (Number.isFinite(profileIndex) && profileIndex === index) {
    return true;
  }

  return false;
}

function findProfileForArray({ profiles = [], array = {}, index = 0 } = {}) {
  return profiles.find((profile) => profileMatchesArray(profile, array, index)) || null;
}

function buildUnavailablePerformanceModel({
  reason = "PVGIS hourly data is not available for this candidate.",
  systemSizeKwp = 0,
  totalPanels = 0,
  panel = null,
  inverter = null,
  battery = null,
} = {}) {
  return {
    version: DESIGN_CANDIDATE_PVGIS_PERFORMANCE_VERSION,
    mode: "candidate_pvgis_performance_model_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    source: "pvgis_data_unavailable",

    systemSizeKwp,
    totalPanels,

    generation: {
      annualGrossGenerationKWh: 0,
      annualAfterClippingKWh: 0,
      annualClippedKWh: 0,
      monthlyGrossGenerationKWh: Array(12).fill(0),
      monthlyAfterClippingKWh: Array(12).fill(0),
      hourlySeries: {
        available: false,
        included: false,
        length: 0,
      },
    },

    pvgis: {
      usesRoofArrayProfiles: false,
      usesAggregateProfile: false,
      matchedArrayCount: 0,
      missingArrayCount: 0,
      sourceProfileCount: 0,
    },

    inverter: {
      inverterProductId: inverter?.id || null,
      maxAcOutputKW: round2(inverter?.maxAcOutputKW),
      clippingRisk: "unknown",
    },

    battery: {
      hasBattery: !!battery,
      batteryProductId: battery?.id || null,
      usableCapacityKWh: round2(battery?.usableCapacityKWh || 0),
      maxChargeKW: round2(battery?.maxChargeKW || 0),
      maxDischargeKW: round2(battery?.maxDischargeKW || 0),
    },

    confidence: {
      level: "unavailable",
      reason,
    },

    limitations: [
      "No fallback generation constants are used here.",
      "Candidate performance requires PVGIS hourly data from either roof-array profiles or the existing aggregate quote hourly model.",
      "This model is not currently used for customer-facing calculations.",
    ],
  };
}

function applyInverterClipping({
  hourlyGross = [],
  inverter = null,
} = {}) {
  const maxAcOutputKW = numberOrZero(inverter?.maxAcOutputKW);

  if (maxAcOutputKW <= 0) {
    return {
      hourlyAfterClipping: hourlyGross.map(round2),
      annualClippedKWh: 0,
      clippedPercent: 0,
      clippingRisk: "unknown",
    };
  }

  const hourlyAfterClipping = hourlyGross.map((value) => {
    // Hourly values are kWh per one-hour interval, so kW limit can be
    // approximated as max kWh per hour for this diagnostic stage.
    return round2(Math.min(numberOrZero(value), maxAcOutputKW));
  });

  const annualGross = sum(hourlyGross);
  const annualAfterClipping = sum(hourlyAfterClipping);
  const annualClippedKWh = Math.max(0, annualGross - annualAfterClipping);
  const clippedPercent =
    annualGross > 0 ? (annualClippedKWh / annualGross) * 100 : 0;

  let clippingRisk = "none";

  if (clippedPercent > 8) clippingRisk = "high";
  else if (clippedPercent > 3) clippingRisk = "moderate";
  else if (clippedPercent > 0.5) clippingRisk = "low";

  return {
    hourlyAfterClipping,
    annualClippedKWh: round2(annualClippedKWh),
    clippedPercent: round2(clippedPercent),
    clippingRisk,
  };
}

function buildArrayPerformanceFromRoofProfiles({
  arrays = [],
  panel = null,
  profiles = [],
} = {}) {
  const rows = [];
  let combinedHourly = [];
  let matchedArrayCount = 0;
  let missingArrayCount = 0;
  let monthIdx = null;
  let hourOfDay = null;

  arrays.forEach((array, index) => {
    const profile = findProfileForArray({ profiles, array, index });
    const hourly = profile ? getProfileHourly(profile) : null;
    const baseKwp = profile ? getProfileBaseKwp(profile) : 0;
    const candidateArrayKwp = getArrayKwp({ array, panel });

    if (!profile || !hourly || !hourly.length || baseKwp <= 0 || candidateArrayKwp <= 0) {
      missingArrayCount += 1;

      rows.push({
        id: array.id || `array_${index + 1}`,
        source: "missing_pvgis_roof_profile",
        matchedProfileId: profile?.id || null,
        panelCount: numberOrZero(array.panels || array.panelCount),
        candidateArrayKwp: round2(candidateArrayKwp),
        baseProfileKwp: round2(baseKwp),
        scaleFactor: null,
        annualGrossGenerationKWh: 0,
      });

      return;
    }

    const scaleFactor = candidateArrayKwp / baseKwp;
    const scaledHourly = scaleHourlyArray(hourly, scaleFactor);

    if (!monthIdx) {
      monthIdx = getProfileMonthIdx(profile, scaledHourly.length);
    }

    if (!hourOfDay) {
      hourOfDay = getProfileHourOfDay(profile, scaledHourly.length);
    }

    combinedHourly = addHourlyArrays(combinedHourly, scaledHourly);
    matchedArrayCount += 1;

    rows.push({
      id: array.id || `array_${index + 1}`,
      source: "scaled_from_pvgis_roof_array_profile",
      matchedProfileId: profile.id || profile.roofId || null,
      orientation: array.orientation || profile.orientation || null,
      tilt: numberOrZero(array.tilt ?? profile.tilt),
      shading: array.shading || profile.shading || null,
      panelCount: numberOrZero(array.panels || array.panelCount),
      candidateArrayKwp: round2(candidateArrayKwp),
      baseProfileKwp: round2(baseKwp),
      scaleFactor: round2(scaleFactor),
      annualGrossGenerationKWh: round2(sum(scaledHourly)),
    });
  });

  return {
    rows,
    combinedHourly,
    matchedArrayCount,
    missingArrayCount,
    monthIdx,
    hourOfDay,
  };
}

function buildPerformanceModelFromHourly({
  source,
  hourlyGross = [],
  monthIdx = null,
  hourOfDay = null,
  arrays = [],
  systemSizeKwp = 0,
  totalPanels = 0,
  panel = null,
  inverter = null,
  battery = null,
  pvgis = {},
  confidence = {},
  includeHourlySeries = false,
} = {}) {
  const clipping = applyInverterClipping({
    hourlyGross,
    inverter,
  });

  const monthlyGrossGenerationKWh = aggregateMonthlyFromHourly(hourlyGross, monthIdx);
  const monthlyAfterClippingKWh = aggregateMonthlyFromHourly(
    clipping.hourlyAfterClipping,
    monthIdx
  );

  const annualGrossGenerationKWh = round2(sum(hourlyGross));
  const annualAfterClippingKWh = round2(sum(clipping.hourlyAfterClipping));

  return {
    version: DESIGN_CANDIDATE_PVGIS_PERFORMANCE_VERSION,
    mode: "candidate_pvgis_performance_model_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    source,

    systemSizeKwp: round2(systemSizeKwp),
    totalPanels: numberOrZero(totalPanels),

    generation: {
      annualGrossGenerationKWh,
      annualAfterClippingKWh,
      annualClippedKWh: clipping.annualClippedKWh,
      monthlyGrossGenerationKWh,
      monthlyAfterClippingKWh,

      hourlySeries: {
        available: hourlyGross.length > 0,
        included: !!includeHourlySeries,
        length: hourlyGross.length,
      },

      ...(includeHourlySeries
        ? {
            hourlyGrossGenerationKWh: hourlyGross.map(round2),
            hourlyAfterClippingKWh: clipping.hourlyAfterClipping.map(round2),
            monthIdx: Array.isArray(monthIdx) ? monthIdx : null,
            hourOfDay: Array.isArray(hourOfDay) ? hourOfDay : null,
          }
        : {}),
    },

    arrays,

    pvgis,

    inverter: {
      inverterProductId: inverter?.id || null,
      inverterType: inverter?.inverterType || null,
      maxAcOutputKW: round2(inverter?.maxAcOutputKW),
      maxPvInputKW: round2(inverter?.maxPvInputKW),
      clippingRisk: clipping.clippingRisk,
      annualClippedKWh: clipping.annualClippedKWh,
      clippedPercent: clipping.clippedPercent,
    },

    battery: {
      hasBattery: !!battery,
      batteryProductId: battery?.id || null,
      usableCapacityKWh: round2(battery?.usableCapacityKWh || 0),
      nominalCapacityKWh: round2(battery?.nominalCapacityKWh || 0),
      maxChargeKW: round2(battery?.maxChargeKW || 0),
      maxDischargeKW: round2(battery?.maxDischargeKW || 0),
      roundTripEfficiency: round2(battery?.roundTripEfficiency || 0),
    },

    confidence,

    limitations: [
      "This is a candidate-level PVGIS performance bridge.",
      "It uses PVGIS-derived hourly data where available.",
      "It does not use arbitrary orientation/tilt constants to invent generation.",
      "Inverter clipping is currently a simple hourly AC-limit diagnostic.",
      "Candidate-specific battery dispatch is not modelled here yet.",
      "This model does not yet replace the customer-facing quote calculation.",
      "Hourly series are omitted by default to avoid bloating quote responses.",
    ],
  };
}

function buildDesignCandidatePvgisPerformanceModel({
  quote = null,
  panel = null,
  inverter = null,
  battery = null,
  arrays = [],
  totalPanels = 0,
  fallbackSystemSizeKwp = 0,
  includeHourlySeries = false,
} = {}) {
  const safeQuote = quote || {};
  const safeArrays = Array.isArray(arrays) ? arrays : [];

  const systemSizeKwp = getCandidateSystemSizeKwp({
    panel,
    totalPanels,
    fallbackSystemSizeKwp,
  });

  const roofProfiles = getPvgisRoofProfiles(safeQuote);
  const aggregateProfile = getAggregatePvgisProfile(safeQuote);

  if (roofProfiles.length > 0 && safeArrays.length > 0) {
    const roofProfileResult = buildArrayPerformanceFromRoofProfiles({
      arrays: safeArrays,
      panel,
      profiles: roofProfiles,
    });

    if (
      roofProfileResult.matchedArrayCount > 0 &&
      roofProfileResult.missingArrayCount === 0 &&
      roofProfileResult.combinedHourly.length > 0
    ) {
      return buildPerformanceModelFromHourly({
        source: "scaled_from_pvgis_roof_array_profiles",
        hourlyGross: roofProfileResult.combinedHourly,
        monthIdx: roofProfileResult.monthIdx,
        hourOfDay: roofProfileResult.hourOfDay,
        arrays: roofProfileResult.rows,
        systemSizeKwp,
        totalPanels,
        panel,
        inverter,
        battery,
        includeHourlySeries,
        pvgis: {
          usesRoofArrayProfiles: true,
          usesAggregateProfile: false,
          matchedArrayCount: roofProfileResult.matchedArrayCount,
          missingArrayCount: roofProfileResult.missingArrayCount,
          sourceProfileCount: roofProfiles.length,
        },
        confidence: {
          level: "medium_high",
          reason:
            "Candidate generation is scaled from PVGIS roof-array hourly profiles.",
        },
      });
    }
  }

  if (aggregateProfile) {
    const hourly = getProfileHourly(aggregateProfile);
    const baseKwp = getProfileBaseKwp(aggregateProfile);

    if (hourly && hourly.length > 0 && baseKwp > 0 && systemSizeKwp > 0) {
      const scaleFactor = systemSizeKwp / baseKwp;
      const scaledHourly = scaleHourlyArray(hourly, scaleFactor);

      return buildPerformanceModelFromHourly({
        source: "scaled_from_aggregate_quote_pvgis_hourly_profile",
        hourlyGross: scaledHourly,
        monthIdx: getProfileMonthIdx(aggregateProfile, scaledHourly.length),
        hourOfDay: getProfileHourOfDay(aggregateProfile, scaledHourly.length),
        arrays: safeArrays.map((array, index) => ({
          id: array.id || `array_${index + 1}`,
          source: "aggregate_profile_scaled_to_candidate_system",
          panelCount: numberOrZero(array.panels || array.panelCount),
          candidateArrayKwp: round2(getArrayKwp({ array, panel })),
          annualGrossGenerationKWh: null,
          note:
            "Aggregate quote PVGIS profile was used because roof-array PVGIS profiles were not available.",
        })),
        systemSizeKwp,
        totalPanels,
        panel,
        inverter,
        battery,
        includeHourlySeries,
        pvgis: {
          usesRoofArrayProfiles: false,
          usesAggregateProfile: true,
          matchedArrayCount: 0,
          missingArrayCount: safeArrays.length,
          sourceProfileCount: roofProfiles.length,
          aggregateBaseSystemSizeKwp: round2(baseKwp),
          scaleFactor: round2(scaleFactor),
        },
        confidence: {
          level: "medium_low",
          reason:
            "Candidate generation is scaled from the existing aggregate quote PVGIS hourly profile. Roof-array PVGIS profiles are not yet exposed.",
        },
      });
    }
  }

  return buildUnavailablePerformanceModel({
    reason:
      "No PVGIS roof-array profiles or aggregate quote hourly PVGIS profile were available.",
    systemSizeKwp,
    totalPanels,
    panel,
    inverter,
    battery,
  });
}

function stripCandidatePerformanceHourlySeries(performanceModel = {}) {
  if (!performanceModel || typeof performanceModel !== "object") {
    return performanceModel;
  }

  const generation = performanceModel.generation || {};

  return {
    ...performanceModel,
    generation: {
      ...generation,

      hourlySeries: {
        ...(generation.hourlySeries || {}),
        included: false,
      },

      hourlyGrossGenerationKWh: undefined,
      hourlyAfterClippingKWh: undefined,
      monthIdx: undefined,
      hourOfDay: undefined,
    },
  };
}

module.exports = {
  DESIGN_CANDIDATE_PVGIS_PERFORMANCE_VERSION,
  buildDesignCandidatePvgisPerformanceModel,
  stripCandidatePerformanceHourlySeries,
};