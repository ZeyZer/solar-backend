const {
  isValidShadeMatrix,
  monthlyFromHourly,
  buildYearlyAdjustedResult,
  aggregateYearlyResults,
  buildBaseSegmentProfilesForYear,
} = require("./googleShadePvgisCoreService");

const {
  calculateRuntimeSignals,
  predictShadeStrength,
  blendProduction,
} = require("./shadeStrengthV2CoreService");

const DEFAULT_YEARS = [2021, 2022, 2023];

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumArray(values = []) {
  return values.reduce(
    (sum, value) => sum + Number(value || 0),
    0
  );
}

function averageHourlyArrays(arrays = []) {
  const valid = arrays.filter(
    (values) => Array.isArray(values) && values.length > 0
  );

  if (!valid.length) {
    return null;
  }

  const length = valid[0].length;

  for (const values of valid) {
    if (values.length !== length) {
      throw new Error(
        "Cannot average hourly arrays with different lengths."
      );
    }
  }

  const output = Array(length).fill(0);

  for (const values of valid) {
    for (let index = 0; index < length; index += 1) {
      output[index] += Number(values[index] || 0);
    }
  }

  return output.map(
    (value) => value / valid.length
  );
}

function validateMatchingTimeIndexes(yearlyResults = []) {
  const valid = yearlyResults.filter(Boolean);

  if (!valid.length) {
    return {
      valid: false,
      reason: "no_yearly_results",
    };
  }

  const reference = valid[0];

  const referenceMonthIdx =
    reference.monthIdx;

  const referenceHourOfDay =
    reference.hourOfDay;

  if (
    !Array.isArray(referenceMonthIdx) ||
    !Array.isArray(referenceHourOfDay) ||
    !referenceMonthIdx.length ||
    referenceMonthIdx.length !==
      referenceHourOfDay.length
  ) {
    return {
      valid: false,
      reason:
        "invalid_reference_time_index",
    };
  }

  for (const result of valid) {
    if (
      !Array.isArray(result.monthIdx) ||
      !Array.isArray(result.hourOfDay)
    ) {
      return {
        valid: false,
        reason:
          "missing_year_time_index",
        year: result.year,
      };
    }

    if (
      result.monthIdx.length !==
        referenceMonthIdx.length ||
      result.hourOfDay.length !==
        referenceHourOfDay.length
    ) {
      return {
        valid: false,
        reason:
          "time_index_length_mismatch",
        year: result.year,
        expectedHourCount:
          referenceMonthIdx.length,
        actualMonthIndexCount:
          result.monthIdx.length,
        actualHourIndexCount:
          result.hourOfDay.length,
      };
    }

    for (
      let index = 0;
      index < referenceMonthIdx.length;
      index += 1
    ) {
      if (
        Number(result.monthIdx[index]) !==
          Number(referenceMonthIdx[index]) ||
        Number(result.hourOfDay[index]) !==
          Number(referenceHourOfDay[index])
      ) {
        return {
          valid: false,
          reason:
            "time_index_value_mismatch",
          year: result.year,
          index,
          expected: {
            monthIdx:
              referenceMonthIdx[index],
            hourOfDay:
              referenceHourOfDay[index],
          },
          actual: {
            monthIdx:
              result.monthIdx[index],
            hourOfDay:
              result.hourOfDay[index],
          },
        };
      }
    }
  }

  return {
    valid: true,
    hourCount:
      referenceMonthIdx.length,
  };
}

function getMissingSegmentMatrices({
  segmentInputs,
  segmentMatrices,
}) {
  return segmentInputs
    .map((segment) => String(segment.segmentIndex))
    .filter(
      (segmentKey) =>
        !isValidShadeMatrix(
          segmentMatrices?.[segmentKey]
        )
    );
}

function buildShadeStrengthV2FromYearlyProfiles({
  baseYearlyProfiles,
  segmentMatrices,
}) {
  const validYears = Array.isArray(baseYearlyProfiles)
    ? baseYearlyProfiles.filter(
        (yearData) =>
          Array.isArray(yearData?.baseSegmentProfiles) &&
          yearData.baseSegmentProfiles.length > 0
      )
    : [];

  if (!validYears.length) {
    return {
      source: "zeyzer_shade_strength_v2_runtime_v1",
      mode: "shadow",
      status: "no_yearly_profiles",
      canonicalProduction: false,
    };
  }

  const directYearlyResults = [];
  const componentAwareYearlyResults = [];

  for (const yearData of validYears) {
    const directResult =
      buildYearlyAdjustedResult({
        year: yearData.year,
        baseSegmentProfiles:
          yearData.baseSegmentProfiles,
        segmentMatrices,
        diffuseFloor: 0,
        hourOffset: 0,
        componentAware: false,
        includeHourly: true,
      });

    const componentAwareResult =
      buildYearlyAdjustedResult({
        year: yearData.year,
        baseSegmentProfiles:
          yearData.baseSegmentProfiles,
        segmentMatrices,
        diffuseFloor: 0,
        hourOffset: 0,
        componentAware: true,
      });

    if (directResult) {
      directYearlyResults.push(
        directResult
      );
    }

    if (componentAwareResult) {
      componentAwareYearlyResults.push(
        componentAwareResult
      );
    }
  }

  if (
    !directYearlyResults.length ||
    !componentAwareYearlyResults.length
  ) {
    return {
      source: "zeyzer_shade_strength_v2_runtime_v1",
      mode: "shadow",
      status: "no_adjusted_yearly_results",
      canonicalProduction: false,
    };
  }

  const timeIndexValidation =
    validateMatchingTimeIndexes(
      directYearlyResults
    );

  if (!timeIndexValidation.valid) {
    return {
      source: "zeyzer_shade_strength_v2_runtime_v1",
      mode: "shadow",
      status: "time_index_mismatch",
      canonicalProduction: false,
      timeIndexValidation,
    };
  }

  const directAggregate =
    aggregateYearlyResults(
      directYearlyResults
    );

  const componentAwareAggregate =
    aggregateYearlyResults(
      componentAwareYearlyResults
    );

  const runtimeSignals =
    calculateRuntimeSignals({
      baselineMonthlyKwh:
        directAggregate.unshadedMonthlyKwh,

      directMonthlyKwh:
        directAggregate.adjustedMonthlyKwh,

      componentAwareMonthlyKwh:
        componentAwareAggregate.adjustedMonthlyKwh,

      directAnnualShadeLossPercentOverride:
        directAggregate.shadeLossPercent,

      componentAnnualShadeLossPercentOverride:
        componentAwareAggregate.shadeLossPercent,
    });

  const prediction =
    predictShadeStrength({
      R: runtimeSignals.R,
      winterR:
        runtimeSignals.winterR,
    });

  const representativeUnshadedHourlyKwh =
    averageHourlyArrays(
      directYearlyResults.map(
        (result) =>
          result.unshadedHourlyKwh
      )
    );

  const representativeDirectHourlyKwh =
    averageHourlyArrays(
      directYearlyResults.map(
        (result) =>
          result.adjustedHourlyKwh
      )
    );

  const representativeHourlyKwh =
    blendProduction({
      baselineKwh:
        representativeUnshadedHourlyKwh,

      directShadeKwh:
        representativeDirectHourlyKwh,

      shadeStrength:
        prediction.shadeStrength,
    });

  const monthIdx =
    directYearlyResults[0].monthIdx;

  const hourOfDay =
    directYearlyResults[0].hourOfDay;

  const monthlyKwh =
    monthlyFromHourly(
      representativeHourlyKwh,
      monthIdx
    );

  return {
    source: "zeyzer_shade_strength_v2_runtime_v1",
    mode: "shadow",
    status: "complete",
    canonicalProduction: false,

    years:
      directYearlyResults.map(
        (result) => result.year
      ),

    runtimeSignals,
    prediction,

    productionProfile: {
      hourlyKwh:
        representativeHourlyKwh,

      monthIdx: [...monthIdx],
      hourOfDay: [...hourOfDay],

      hourCount:
        representativeHourlyKwh.length,

      annualKwh:
        sumArray(
          representativeHourlyKwh
        ),

      monthlyKwh,
    },

    diagnostics: {
      categoricalShadingApplied: false,

      unshadedAnnualKwh:
        sumArray(
          representativeUnshadedHourlyKwh
        ),

      directShadeAnnualKwh:
        sumArray(
          representativeDirectHourlyKwh
        ),

      directAnnualShadeLossPercent:
        directAggregate.shadeLossPercent,

      componentAwareAnnualShadeLossPercent:
        componentAwareAggregate.shadeLossPercent,

      unshadedMonthlyKwh:
        directAggregate.unshadedMonthlyKwh,

      directMonthlyKwh:
        directAggregate.adjustedMonthlyKwh,

      componentAwareMonthlyKwh:
        componentAwareAggregate.adjustedMonthlyKwh,
    },
  };
}

async function buildBaseYearlyProfilesConcurrently({
  years,
  location,
  segmentInputs,
  buildYear = buildBaseSegmentProfilesForYear,
}) {
  const stageStartedAt = Date.now();

  try {
    const yearlyProfiles = await Promise.all(
      years.map(async (year) => {
        const yearStartedAt = Date.now();

        try {
          const baseSegmentProfiles = await buildYear({
            year,
            location,
            segmentInputs,
          });

          return baseSegmentProfiles.length
            ? {
                year,
                baseSegmentProfiles,
              }
            : null;
        } finally {
          console.log(
            `[PERF] Shade V2 production ${year}: ${Date.now() - yearStartedAt}ms`
          );
        }
      })
    );

    return yearlyProfiles.filter(Boolean);
  } finally {
    console.log(
      `[PERF] Shade V2 production total: ${Date.now() - stageStartedAt}ms`
    );
  }
}

async function buildShadeStrengthV2RuntimeProduction({
  location,
  segmentInputs,
  segmentMatrices,
  years = DEFAULT_YEARS,
}) {
  const lat =
    numberOrNull(location?.lat);

  const lon =
    numberOrNull(
      location?.lon ??
      location?.lng
    );

  if (
    lat === null ||
    lon === null
  ) {
    return {
      source: "zeyzer_shade_strength_v2_runtime_v1",
      mode: "shadow",
      status: "missing_location",
      canonicalProduction: false,
      error:
        "A finite live roof latitude and longitude are required.",
    };
  }

  const cleanSegmentInputs =
    Array.isArray(segmentInputs)
      ? segmentInputs
      : [];

  if (!cleanSegmentInputs.length) {
    return {
      source: "zeyzer_shade_strength_v2_runtime_v1",
      mode: "shadow",
      status: "missing_segment_inputs",
      canonicalProduction: false,
    };
  }

  const missingSegmentMatrices =
    getMissingSegmentMatrices({
      segmentInputs:
        cleanSegmentInputs,

      segmentMatrices:
        segmentMatrices || {},
    });

  if (missingSegmentMatrices.length) {
    return {
      source: "zeyzer_shade_strength_v2_runtime_v1",
      mode: "shadow",
      status: "missing_segment_shade_matrix",
      canonicalProduction: false,
      missingSegmentIndexes:
        missingSegmentMatrices,
    };
  }

  const cleanYears =
    Array.isArray(years)
      ? years
          .map(Number)
          .filter(Number.isFinite)
      : DEFAULT_YEARS;

  const baseYearlyProfiles =
    await buildBaseYearlyProfilesConcurrently({
      years: cleanYears,
      location: {
        lat,
        lon,
      },
      segmentInputs:
        cleanSegmentInputs,
    });

  const result =
    buildShadeStrengthV2FromYearlyProfiles({
      baseYearlyProfiles,
      segmentMatrices,
    });

  return {
    ...result,

    location: {
      lat,
      lon,
      source:
        "explicit_live_roof_location",
    },

    segmentCount:
      cleanSegmentInputs.length,

    shadeMatrixSegmentIndexes:
      Object.keys(
        segmentMatrices || {}
      ),
  };
}

module.exports = {
  DEFAULT_YEARS,
  averageHourlyArrays,
  validateMatchingTimeIndexes,
  buildShadeStrengthV2FromYearlyProfiles,
  buildBaseYearlyProfilesConcurrently,
  buildShadeStrengthV2RuntimeProduction,
};
