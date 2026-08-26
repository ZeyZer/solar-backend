// R1.7b.8
// Applies segment-level Google month/hour shade matrices to each segment's PVGIS hourly output.
// Includes both:
// 1) direct Google shade adjustment
// 2) adaptive diffuse-floor policy adjustment

const {
  getLatLonFromUkPostcode,
  getPvgisHourlyKWhForRoof,
} = require("../integrations/pvgisService");

const {
  applyDiffuseFloor,
  calculateDirectShadeLossPercent,
  chooseAdaptiveShadePolicy,
} = require("./googleShadeAdjustmentPolicyService");

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function round2(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 100) / 100;
}

function percentDelta(estimate, reference) {
  const estimateNumber = numberOrNull(estimate);
  const referenceNumber = numberOrNull(reference);

  if (estimateNumber === null || referenceNumber === null || referenceNumber === 0) {
    return null;
  }

  return round1(((estimateNumber - referenceNumber) / referenceNumber) * 100);
}

function getBenchmarkPostcode(benchmarkItem = {}) {
  return (
    benchmarkItem.postcode ||
    benchmarkItem.postCode ||
    benchmarkItem.property?.postcode ||
    benchmarkItem.property?.postCode ||
    benchmarkItem.address?.postcode ||
    benchmarkItem.address?.postCode ||
    benchmarkItem.input?.postcode ||
    benchmarkItem.input?.postCode ||
    benchmarkItem.customerInput?.postcode ||
    benchmarkItem.customerInput?.postCode ||
    null
  );
}

function isValidShadeMatrix(matrix) {
  return (
    Array.isArray(matrix) &&
    matrix.length === 12 &&
    matrix.every(
      (month) =>
        Array.isArray(month) &&
        month.length === 24 &&
        month.some((value) => numberOrNull(value) !== null)
    )
  );
}

function clampShadeFactor(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Math.min(1, Math.max(0, number));
}

function getShadeFactor({ matrix, monthIdx, hourOfDay, hourOffset = 0 }) {
  const month = Number(monthIdx);
  const hour = (Number(hourOfDay) + Number(hourOffset) + 24) % 24;

  if (month < 0 || month > 11 || hour < 0 || hour > 23) {
    return 1;
  }

  const value = clampShadeFactor(matrix?.[month]?.[hour]);

  // Missing shade value means "do not alter PVGIS for this hour".
  return value === null ? 1 : value;
}

function applyShadeToHourly({
  hourlyKwh,
  monthIdx,
  hourOfDay,
  shadeMatrix,
  diffuseFloor = 0,
  hourOffset = 0,
}) {
  const adjusted = [];
  const factors = [];

  for (let i = 0; i < hourlyKwh.length; i += 1) {
    const original = Number(hourlyKwh[i] || 0);

    const shadeFactor = getShadeFactor({
      matrix: shadeMatrix,
      monthIdx: monthIdx[i],
      hourOfDay: hourOfDay[i],
      hourOffset,
    });

    const multiplier = applyDiffuseFloor({
      shadeFactor,
      diffuseFloor,
    });

    adjusted.push(round2(original * multiplier));
    factors.push(round2(multiplier));
  }

  return { adjusted, factors };
}

function monthlyFromHourly(kwh = [], monthIdx = []) {
  const monthly = Array(12).fill(0);

  for (let i = 0; i < kwh.length; i += 1) {
    const month = Number(monthIdx[i]);
    if (month >= 0 && month <= 11) {
      monthly[month] += Number(kwh[i] || 0);
    }
  }

  return monthly.map(round1);
}

function sumHourlyArrays(arrays = []) {
  const validArrays = arrays.filter((arr) => Array.isArray(arr) && arr.length > 0);

  if (!validArrays.length) return null;

  const length = validArrays[0].length;
  const total = Array(length).fill(0);

  for (const arr of validArrays) {
    if (arr.length !== length) {
      throw new Error("Hourly array length mismatch.");
    }

    for (let i = 0; i < length; i += 1) {
      total[i] += Number(arr[i] || 0);
    }
  }

  return total.map(round2);
}

function average(values = []) {
  const valid = values.map(numberOrNull).filter((value) => value !== null);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function averageMonthly(monthlySets = []) {
  if (!monthlySets.length) return null;

  const out = Array(12).fill(0);

  for (const monthly of monthlySets) {
    for (let i = 0; i < 12; i += 1) {
      out[i] += Number(monthly[i] || 0);
    }
  }

  return out.map((value) => round1(value / monthlySets.length));
}

function monthlyDeltaPercent(estimateMonthly, referenceMonthly) {
  if (!Array.isArray(estimateMonthly) || !Array.isArray(referenceMonthly)) {
    return null;
  }

  if (estimateMonthly.length !== 12 || referenceMonthly.length !== 12) {
    return null;
  }

  return estimateMonthly.map((estimate, index) =>
    percentDelta(estimate, referenceMonthly[index])
  );
}

function buildYearlyAdjustedResult({
  year,
  baseSegmentProfiles,
  segmentMatrices,
  diffuseFloor,
  hourOffset,
}) {
  const adjustedSegmentProfiles = [];

  for (const baseProfile of baseSegmentProfiles) {
    const segmentKey = String(baseProfile.segmentIndex);
    const shadeMatrix = segmentMatrices[segmentKey];

    const adjusted = applyShadeToHourly({
      hourlyKwh: baseProfile.unshadedHourlyKwh,
      monthIdx: baseProfile.monthIdx,
      hourOfDay: baseProfile.hourOfDay,
      shadeMatrix,
      diffuseFloor,
      hourOffset,
    });

    const unshadedAnnualKwh = round1(
      baseProfile.unshadedHourlyKwh.reduce(
        (sum, value) => sum + Number(value || 0),
        0
      )
    );

    const adjustedAnnualKwh = round1(
      adjusted.adjusted.reduce((sum, value) => sum + Number(value || 0), 0)
    );

    adjustedSegmentProfiles.push({
      segmentIndex: baseProfile.segmentIndex,
      allocatedPanels: baseProfile.allocatedPanels,
      peakPowerKwp: baseProfile.peakPowerKwp,
      tiltDeg: baseProfile.tiltDeg,
      googleAzimuthDegrees: baseProfile.googleAzimuthDegrees,
      pvgisAspectDeg: baseProfile.pvgisAspectDeg,

      unshadedAnnualKwh,
      adjustedAnnualKwh,
      shadeLossKwh: round1(unshadedAnnualKwh - adjustedAnnualKwh),
      shadeLossPercent:
        unshadedAnnualKwh > 0
          ? round1(((unshadedAnnualKwh - adjustedAnnualKwh) / unshadedAnnualKwh) * 100)
          : null,

      adjustedHourlyKwh: adjusted.adjusted,
    });
  }

  const unshadedTotalHourly = sumHourlyArrays(
    baseSegmentProfiles.map((profile) => profile.unshadedHourlyKwh)
  );

  const adjustedTotalHourly = sumHourlyArrays(
    adjustedSegmentProfiles.map((profile) => profile.adjustedHourlyKwh)
  );

  if (!unshadedTotalHourly || !adjustedTotalHourly) {
    return null;
  }

  const monthIdx = baseSegmentProfiles[0].monthIdx;

  const unshadedMonthlyKwh = monthlyFromHourly(unshadedTotalHourly, monthIdx);
  const adjustedMonthlyKwh = monthlyFromHourly(adjustedTotalHourly, monthIdx);

  const unshadedAnnualKwh = round1(
    unshadedTotalHourly.reduce((sum, value) => sum + Number(value || 0), 0)
  );

  const adjustedAnnualKwh = round1(
    adjustedTotalHourly.reduce((sum, value) => sum + Number(value || 0), 0)
  );

  return {
    year,
    diffuseFloor,
    hourOffset,

    unshadedAnnualKwh,
    adjustedAnnualKwh,
    shadeLossKwh: round1(unshadedAnnualKwh - adjustedAnnualKwh),
    shadeLossPercent:
      unshadedAnnualKwh > 0
        ? round1(((unshadedAnnualKwh - adjustedAnnualKwh) / unshadedAnnualKwh) * 100)
        : null,

    unshadedMonthlyKwh,
    adjustedMonthlyKwh,

    segmentProfiles: adjustedSegmentProfiles.map((profile) => ({
      segmentIndex: profile.segmentIndex,
      allocatedPanels: profile.allocatedPanels,
      peakPowerKwp: profile.peakPowerKwp,
      unshadedAnnualKwh: profile.unshadedAnnualKwh,
      adjustedAnnualKwh: profile.adjustedAnnualKwh,
      shadeLossPercent: profile.shadeLossPercent,
    })),
  };
}

function aggregateYearlyResults(yearlyResults = []) {
  const valid = yearlyResults.filter(Boolean);

  if (!valid.length) {
    return null;
  }

  const unshadedAnnualKwh = round1(
    average(valid.map((result) => result.unshadedAnnualKwh))
  );

  const adjustedAnnualKwh = round1(
    average(valid.map((result) => result.adjustedAnnualKwh))
  );

  const unshadedMonthlyKwh = averageMonthly(
    valid.map((result) => result.unshadedMonthlyKwh)
  );

  const adjustedMonthlyKwh = averageMonthly(
    valid.map((result) => result.adjustedMonthlyKwh)
  );

  return {
    unshadedAnnualKwh,
    adjustedAnnualKwh,
    unshadedMonthlyKwh,
    adjustedMonthlyKwh,
    shadeLossKwh: round1(unshadedAnnualKwh - adjustedAnnualKwh),
    shadeLossPercent:
      unshadedAnnualKwh > 0
        ? round1(((unshadedAnnualKwh - adjustedAnnualKwh) / unshadedAnnualKwh) * 100)
        : null,
  };
}

async function buildBaseSegmentProfilesForYear({
  year,
  location,
  segmentInputs,
}) {
  const baseSegmentProfiles = [];

  for (const segment of segmentInputs) {
    const peakPowerKwp = numberOrNull(segment.peakPowerKwp);
    if (!peakPowerKwp || peakPowerKwp <= 0) continue;

    const pvgisProfile = await getPvgisHourlyKWhForRoof({
      lat: location.lat,
      lon: location.lon,
      tiltDeg: numberOrNull(segment.tiltDeg),
      aspectDeg: numberOrNull(segment.pvgisAspectDeg),
      peakPowerKwp,
      year,
    });

    baseSegmentProfiles.push({
      segmentIndex: segment.segmentIndex,
      allocatedPanels: segment.allocatedPanels,
      peakPowerKwp: segment.peakPowerKwp,
      tiltDeg: segment.tiltDeg,
      googleAzimuthDegrees: segment.googleAzimuthDegrees,
      pvgisAspectDeg: segment.pvgisAspectDeg,

      unshadedHourlyKwh: pvgisProfile.kWh,
      monthIdx: pvgisProfile.monthIdx,
      hourOfDay: pvgisProfile.hourOfDay,
    });
  }

  return baseSegmentProfiles;
}

async function buildSegmentShadeAdjustedPvgisProductionBenchmark({
  benchmarkItem,
  hybridPvgisProductionBenchmark,
  googleHourlyShadeFactorAudit,
}) {
  const source = "zeyzer_segment_google_hourly_shade_adjusted_pvgis_v2";

  const segmentInputs = Array.isArray(hybridPvgisProductionBenchmark?.segmentInputs)
    ? hybridPvgisProductionBenchmark.segmentInputs
    : [];

  if (!segmentInputs.length) {
    return {
      source,
      status: "missing_segment_inputs",
      error: "No hybrid PVGIS segment inputs found.",
    };
  }

  const segmentMatrices =
    googleHourlyShadeFactorAudit?.segmentMonthlyByHourShadeFactor || {};

  const missingMatrices = segmentInputs
    .map((segment) => String(segment.segmentIndex))
    .filter((segmentKey) => !isValidShadeMatrix(segmentMatrices[segmentKey]));

  if (missingMatrices.length) {
    return {
      source,
      status: "missing_segment_shade_matrix",
      missingSegmentIndexes: missingMatrices,
      error: "One or more selected segments are missing a valid 12x24 shade matrix.",
    };
  }

  const postcode =
    hybridPvgisProductionBenchmark?.postcode || getBenchmarkPostcode(benchmarkItem);

  if (!postcode) {
    return {
      source,
      status: "missing_postcode",
      error: "Benchmark item is missing postcode.",
    };
  }

  const years = Array.isArray(hybridPvgisProductionBenchmark?.years)
    ? hybridPvgisProductionBenchmark.years
    : [2021, 2022, 2023];

  const lat = numberOrNull(hybridPvgisProductionBenchmark?.latitude);
  const lon = numberOrNull(hybridPvgisProductionBenchmark?.longitude);

  const location =
    lat !== null && lon !== null
      ? { lat, lon }
      : await getLatLonFromUkPostcode(postcode);

  const baseYearlyProfiles = [];

  for (const year of years) {
    const baseSegmentProfiles = await buildBaseSegmentProfilesForYear({
      year,
      location,
      segmentInputs,
    });

    if (baseSegmentProfiles.length) {
      baseYearlyProfiles.push({
        year,
        baseSegmentProfiles,
      });
    }
  }

  if (!baseYearlyProfiles.length) {
    return {
      source,
      status: "no_yearly_results",
      postcode,
      error: "No yearly PVGIS base profiles were produced.",
    };
  }

  const directYearlyResults = baseYearlyProfiles
    .map((yearData) =>
      buildYearlyAdjustedResult({
        year: yearData.year,
        baseSegmentProfiles: yearData.baseSegmentProfiles,
        segmentMatrices,
        diffuseFloor: 0,
        hourOffset: 0,
      })
    )
    .filter(Boolean);

  const directAggregate = aggregateYearlyResults(directYearlyResults);

  const directShadeLossPercent = calculateDirectShadeLossPercent({
    unshadedAnnualKwh: directAggregate?.unshadedAnnualKwh,
    directShadeAdjustedAnnualKwh: directAggregate?.adjustedAnnualKwh,
  });

  const adaptivePolicy = chooseAdaptiveShadePolicy({
    directShadeLossPercent,
    originalHybridAnnualKwh: hybridPvgisProductionBenchmark?.pvgis?.annualKwh,
    systemSizeKwp: hybridPvgisProductionBenchmark?.systemSizeKwp,
    allocatedPanelTotal: hybridPvgisProductionBenchmark?.allocatedPanelTotal,
  });

  const adaptiveYearlyResults = baseYearlyProfiles
    .map((yearData) =>
      buildYearlyAdjustedResult({
        year: yearData.year,
        baseSegmentProfiles: yearData.baseSegmentProfiles,
        segmentMatrices,
        diffuseFloor: adaptivePolicy.diffuseFloor,
        hourOffset: adaptivePolicy.hourOffset,
      })
    )
    .filter(Boolean);

  const adaptiveAggregate = aggregateYearlyResults(adaptiveYearlyResults);

  const installerAnnualKwh = numberOrNull(
    hybridPvgisProductionBenchmark?.installerReference?.annualKwh
  );

  const installerMonthlyKwh =
    hybridPvgisProductionBenchmark?.installerReference?.monthlyKwh || null;

  return {
    source,
    status: "complete",
    postcode,
    latitude: location.lat,
    longitude: location.lon,
    years,

    segmentMatricesUsed: Object.keys(segmentMatrices),
    selectedPanelSampleCount:
      googleHourlyShadeFactorAudit?.selectedPanelSampleCount || null,
    selectedPanelSamplesBySegment:
      googleHourlyShadeFactorAudit?.selectedPanelSamplesBySegment || null,

    directShadeLossPercent,
    adaptivePolicy,

    pvgisUnshaded: {
      annualKwh: directAggregate.unshadedAnnualKwh,
      monthlyKwh: directAggregate.unshadedMonthlyKwh,
    },

    // Backward-compatible direct Google shade output.
    pvgisSegmentShadeAdjusted: {
      annualKwh: directAggregate.adjustedAnnualKwh,
      monthlyKwh: directAggregate.adjustedMonthlyKwh,
      diffuseFloor: 0,
      hourOffset: 0,
    },

    // New adaptive policy output.
    pvgisAdaptiveShadeAdjusted: {
      annualKwh: adaptiveAggregate.adjustedAnnualKwh,
      monthlyKwh: adaptiveAggregate.adjustedMonthlyKwh,
      diffuseFloor: adaptivePolicy.diffuseFloor,
      hourOffset: adaptivePolicy.hourOffset,
    },

    installerReference: {
      annualKwh: round1(installerAnnualKwh),
      monthlyKwh: installerMonthlyKwh,
    },

    deltas: {
      unshadedAnnualDeltaPercent: percentDelta(
        directAggregate.unshadedAnnualKwh,
        installerAnnualKwh
      ),

      segmentShadeAdjustedAnnualDeltaPercent: percentDelta(
        directAggregate.adjustedAnnualKwh,
        installerAnnualKwh
      ),

      segmentShadeAdjustedMonthlyDeltaPercent: monthlyDeltaPercent(
        directAggregate.adjustedMonthlyKwh,
        installerMonthlyKwh
      ),

      adaptiveShadeAdjustedAnnualDeltaPercent: percentDelta(
        adaptiveAggregate.adjustedAnnualKwh,
        installerAnnualKwh
      ),

      adaptiveShadeAdjustedMonthlyDeltaPercent: monthlyDeltaPercent(
        adaptiveAggregate.adjustedMonthlyKwh,
        installerMonthlyKwh
      ),
    },

    shadeImpact: {
      directAnnualShadeLossKwh: directAggregate.shadeLossKwh,
      directAnnualShadeLossPercent: directAggregate.shadeLossPercent,

      adaptiveAnnualShadeLossKwh: adaptiveAggregate.shadeLossKwh,
      adaptiveAnnualShadeLossPercent: adaptiveAggregate.shadeLossPercent,
    },

    yearlyResults: {
      directGoogleShade: directYearlyResults,
      adaptiveShadePolicy: adaptiveYearlyResults,
    },
  };
}

module.exports = {
  buildSegmentShadeAdjustedPvgisProductionBenchmark,
};
