const {
  WINTER_MONTH_INDEXES,

  calculateLossPercent,
  calculatePeriodLossPercent,
  calculateRuntimeSignals,

  predictShadeStrength,
  blendProduction,
} = require("./shadeStrengthV2CoreService");

function buildShadeStrengthV2Benchmark({
  baselineMonthlyKwh,
  directMonthlyKwh,
  componentAwareMonthlyKwh,

  baselineHourlyKwh = null,
  directHourlyKwh = null,

  directAnnualShadeLossPercentOverride = null,
  componentAnnualShadeLossPercentOverride = null,
}) {
  const runtimeSignals =
    calculateRuntimeSignals({
      baselineMonthlyKwh,
      directMonthlyKwh,
      componentAwareMonthlyKwh,

      directAnnualShadeLossPercentOverride,
      componentAnnualShadeLossPercentOverride,
    });

  const prediction =
    predictShadeStrength({
      R:
        runtimeSignals.R,

      winterR:
        runtimeSignals.winterR,
    });

  const blendedMonthlyKwh =
    blendProduction({
      baselineKwh:
        baselineMonthlyKwh,

      directShadeKwh:
        directMonthlyKwh,

      shadeStrength:
        prediction.shadeStrength,
    });

  let blendedHourlyKwh =
    null;

  if (
    baselineHourlyKwh !== null ||
    directHourlyKwh !== null
  ) {
    if (
      !Array.isArray(
        baselineHourlyKwh
      ) ||
      !Array.isArray(
        directHourlyKwh
      )
    ) {
      throw new Error(
        "Both baselineHourlyKwh and directHourlyKwh are required when hourly blending is requested."
      );
    }

    blendedHourlyKwh =
      blendProduction({
        baselineKwh:
          baselineHourlyKwh,

        directShadeKwh:
          directHourlyKwh,

        shadeStrength:
          prediction.shadeStrength,
      });
  }

  return {
    source:
      "zeyzer_roof_benchmark_shade_strength_v2",

    status:
      "complete",

    modelVersion:
      prediction.modelVersion,

    runtimeSignals,

    prediction,

    monthly: {
      baselineKwh:
        baselineMonthlyKwh,

      directShadeKwh:
        directMonthlyKwh,

      blendedKwh:
        blendedMonthlyKwh,
    },

    hourly:
      blendedHourlyKwh
        ? {
            baselineKwh:
              baselineHourlyKwh,

            directShadeKwh:
              directHourlyKwh,

            blendedKwh:
              blendedHourlyKwh,
          }
        : null,
  };
}

module.exports = {
  WINTER_MONTH_INDEXES,

  calculateLossPercent,
  calculatePeriodLossPercent,
  calculateRuntimeSignals,

  predictShadeStrength,
  blendProduction,

  buildShadeStrengthV2Benchmark,
};
