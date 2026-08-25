// R1.7b.2b
// Applies segment-level Google month/hour shade matrices to each segment's PVGIS hourly output.

const {
  getLatLonFromUkPostcode,
  getPvgisHourlyKWhForRoof,
} = require("../integrations/pvgisService");

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

function getShadeFactor({ matrix, monthIdx, hourOfDay }) {
  const month = Number(monthIdx);
  const hour = Number(hourOfDay);

  if (month < 0 || month > 11 || hour < 0 || hour > 23) {
    return 1;
  }

  const value = clampShadeFactor(matrix?.[month]?.[hour]);

  // Missing shade value means "do not alter PVGIS for this hour".
  return value === null ? 1 : value;
}

function applyShadeToHourly({ hourlyKwh, monthIdx, hourOfDay, shadeMatrix }) {
  const adjusted = [];
  const factors = [];

  for (let i = 0; i < hourlyKwh.length; i += 1) {
    const original = Number(hourlyKwh[i] || 0);
    const factor = getShadeFactor({
      matrix: shadeMatrix,
      monthIdx: monthIdx[i],
      hourOfDay: hourOfDay[i],
    });

    adjusted.push(round2(original * factor));
    factors.push(round2(factor));
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

async function buildSegmentShadeAdjustedPvgisProductionBenchmark({
  benchmarkItem,
  hybridPvgisProductionBenchmark,
  googleHourlyShadeFactorAudit,
}) {
  const source = "zeyzer_segment_google_hourly_shade_adjusted_pvgis_v1";

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

  const yearlyResults = [];

  for (const year of years) {
    const segmentProfiles = [];

    for (const segment of segmentInputs) {
      const segmentKey = String(segment.segmentIndex);
      const shadeMatrix = segmentMatrices[segmentKey];

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

      const shaded = applyShadeToHourly({
        hourlyKwh: pvgisProfile.kWh,
        monthIdx: pvgisProfile.monthIdx,
        hourOfDay: pvgisProfile.hourOfDay,
        shadeMatrix,
      });

      const unshadedAnnualKwh = round1(
        pvgisProfile.kWh.reduce((sum, value) => sum + Number(value || 0), 0)
      );

      const shadeAdjustedAnnualKwh = round1(
        shaded.adjusted.reduce((sum, value) => sum + Number(value || 0), 0)
      );

      segmentProfiles.push({
        segmentIndex: segment.segmentIndex,
        allocatedPanels: segment.allocatedPanels,
        peakPowerKwp: segment.peakPowerKwp,
        tiltDeg: segment.tiltDeg,
        googleAzimuthDegrees: segment.googleAzimuthDegrees,
        pvgisAspectDeg: segment.pvgisAspectDeg,

        unshadedAnnualKwh,
        shadeAdjustedAnnualKwh,
        shadeLossKwh: round1(unshadedAnnualKwh - shadeAdjustedAnnualKwh),
        shadeLossPercent:
          unshadedAnnualKwh > 0
            ? round1(((unshadedAnnualKwh - shadeAdjustedAnnualKwh) / unshadedAnnualKwh) * 100)
            : null,

        unshadedHourlyKwh: pvgisProfile.kWh,
        shadeAdjustedHourlyKwh: shaded.adjusted,
        monthIdx: pvgisProfile.monthIdx,
        hourOfDay: pvgisProfile.hourOfDay,
      });
    }

    const unshadedTotalHourly = sumHourlyArrays(
      segmentProfiles.map((profile) => profile.unshadedHourlyKwh)
    );

    const shadeAdjustedTotalHourly = sumHourlyArrays(
      segmentProfiles.map((profile) => profile.shadeAdjustedHourlyKwh)
    );

    if (!unshadedTotalHourly || !shadeAdjustedTotalHourly) continue;

    const monthIdx = segmentProfiles[0].monthIdx;

    const unshadedMonthlyKwh = monthlyFromHourly(unshadedTotalHourly, monthIdx);
    const shadeAdjustedMonthlyKwh = monthlyFromHourly(
      shadeAdjustedTotalHourly,
      monthIdx
    );

    const unshadedAnnualKwh = round1(
      unshadedTotalHourly.reduce((sum, value) => sum + Number(value || 0), 0)
    );

    const shadeAdjustedAnnualKwh = round1(
      shadeAdjustedTotalHourly.reduce((sum, value) => sum + Number(value || 0), 0)
    );

    yearlyResults.push({
      year,
      unshadedAnnualKwh,
      shadeAdjustedAnnualKwh,
      shadeLossKwh: round1(unshadedAnnualKwh - shadeAdjustedAnnualKwh),
      shadeLossPercent:
        unshadedAnnualKwh > 0
          ? round1(((unshadedAnnualKwh - shadeAdjustedAnnualKwh) / unshadedAnnualKwh) * 100)
          : null,

      unshadedMonthlyKwh,
      shadeAdjustedMonthlyKwh,

      segmentProfiles: segmentProfiles.map((profile) => ({
        segmentIndex: profile.segmentIndex,
        allocatedPanels: profile.allocatedPanels,
        peakPowerKwp: profile.peakPowerKwp,
        unshadedAnnualKwh: profile.unshadedAnnualKwh,
        shadeAdjustedAnnualKwh: profile.shadeAdjustedAnnualKwh,
        shadeLossPercent: profile.shadeLossPercent,
      })),
    });
  }

  if (!yearlyResults.length) {
    return {
      source,
      status: "no_yearly_results",
      postcode,
      error: "No yearly shade-adjusted PVGIS results were produced.",
    };
  }

  const unshadedAnnualKwh = round1(
    average(yearlyResults.map((result) => result.unshadedAnnualKwh))
  );

  const shadeAdjustedAnnualKwh = round1(
    average(yearlyResults.map((result) => result.shadeAdjustedAnnualKwh))
  );

  const unshadedMonthlyKwh = averageMonthly(
    yearlyResults.map((result) => result.unshadedMonthlyKwh)
  );

  const shadeAdjustedMonthlyKwh = averageMonthly(
    yearlyResults.map((result) => result.shadeAdjustedMonthlyKwh)
  );

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

    pvgisUnshaded: {
      annualKwh: unshadedAnnualKwh,
      monthlyKwh: unshadedMonthlyKwh,
    },

    pvgisSegmentShadeAdjusted: {
      annualKwh: shadeAdjustedAnnualKwh,
      monthlyKwh: shadeAdjustedMonthlyKwh,
    },

    installerReference: {
      annualKwh: round1(installerAnnualKwh),
      monthlyKwh: installerMonthlyKwh,
    },

    deltas: {
      unshadedAnnualDeltaPercent: percentDelta(
        unshadedAnnualKwh,
        installerAnnualKwh
      ),
      segmentShadeAdjustedAnnualDeltaPercent: percentDelta(
        shadeAdjustedAnnualKwh,
        installerAnnualKwh
      ),
      segmentShadeAdjustedMonthlyDeltaPercent: monthlyDeltaPercent(
        shadeAdjustedMonthlyKwh,
        installerMonthlyKwh
      ),
    },

    shadeImpact: {
      annualShadeLossKwh: round1(unshadedAnnualKwh - shadeAdjustedAnnualKwh),
      annualShadeLossPercent:
        unshadedAnnualKwh > 0
          ? round1(((unshadedAnnualKwh - shadeAdjustedAnnualKwh) / unshadedAnnualKwh) * 100)
          : null,
    },

    yearlyResults,
  };
}

module.exports = {
  buildSegmentShadeAdjustedPvgisProductionBenchmark,
};
