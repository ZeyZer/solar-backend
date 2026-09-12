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

const {
  isValidShadeMatrix,
  buildYearlyAdjustedResult,
  aggregateYearlyResults,
  buildBaseSegmentProfilesForYear,
} = require("./googleShadePvgisCoreService");

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

  const componentAwareYearlyResults =
    baseYearlyProfiles
      .map((yearData) =>
        buildYearlyAdjustedResult({
          year: yearData.year,
          baseSegmentProfiles:
            yearData.baseSegmentProfiles,
          segmentMatrices,
          diffuseFloor: 0,
          hourOffset: 0,
          componentAware: true,
        })
      )
      .filter(Boolean);

  const componentAwareAggregate =
    aggregateYearlyResults(
      componentAwareYearlyResults
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

    // Existing adaptive diffuse-floor policy output.
    pvgisAdaptiveShadeAdjusted: {
      annualKwh: adaptiveAggregate.adjustedAnnualKwh,
      monthlyKwh: adaptiveAggregate.adjustedMonthlyKwh,
      diffuseFloor: adaptivePolicy.diffuseFloor,
      hourOffset: adaptivePolicy.hourOffset,
    },

    // Component-aware Google shading:
    // Google visibility affects beam irradiance only.
    pvgisComponentAwareShadeAdjusted: {
      annualKwh:
        componentAwareAggregate.adjustedAnnualKwh,
      monthlyKwh:
        componentAwareAggregate.adjustedMonthlyKwh,
      hourOffset: 0,
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

      componentAwareShadeAdjustedAnnualDeltaPercent:
        percentDelta(
          componentAwareAggregate.adjustedAnnualKwh,
          installerAnnualKwh
        ),

      componentAwareShadeAdjustedMonthlyDeltaPercent:
        monthlyDeltaPercent(
          componentAwareAggregate.adjustedMonthlyKwh,
          installerMonthlyKwh
        ),
    },

    shadeImpact: {
      directAnnualShadeLossKwh: directAggregate.shadeLossKwh,
      directAnnualShadeLossPercent: directAggregate.shadeLossPercent,

      adaptiveAnnualShadeLossKwh: adaptiveAggregate.shadeLossKwh,
      adaptiveAnnualShadeLossPercent: adaptiveAggregate.shadeLossPercent,

      componentAwareAnnualShadeLossKwh:
        componentAwareAggregate.shadeLossKwh,

      componentAwareAnnualShadeLossPercent:
        componentAwareAggregate.shadeLossPercent,
    },

    yearlyResults: {
      directGoogleShade: directYearlyResults,
      adaptiveShadePolicy: adaptiveYearlyResults,
      componentAwareGoogleShade:
        componentAwareYearlyResults,
    },
  };
}

module.exports = {
  buildSegmentShadeAdjustedPvgisProductionBenchmark,
};
