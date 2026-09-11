const modelConfig = require(
  "../../data/roof-benchmark/calibration/shade-strength-model-v2.json"
);

const WINTER_MONTH_INDEXES = [
  10, // November
  11, // December
  0,  // January
  1,  // February
];

const EPSILON = 1e-9;

function numberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function assertNumericArray(
  values,
  label
) {
  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    throw new Error(
      `${label} must be a non-empty array.`
    );
  }

  for (
    let index = 0;
    index < values.length;
    index += 1
  ) {
    if (
      numberOrNull(
        values[index]
      ) === null
    ) {
      throw new Error(
        `${label}[${index}] is not numeric.`
      );
    }
  }
}

function assertMonthlyArray(
  values,
  label
) {
  assertNumericArray(
    values,
    label
  );

  if (
    values.length !== 12
  ) {
    throw new Error(
      `${label} must contain exactly 12 months.`
    );
  }
}

function clamp(
  value,
  minimum,
  maximum
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function sumArray(values) {
  return values.reduce(
    (sum, value) =>
      sum + Number(value || 0),
    0
  );
}

function sumMonths(
  monthlyKwh,
  monthIndexes
) {
  return monthIndexes.reduce(
    (sum, monthIndex) =>
      sum +
      Number(
        monthlyKwh[
          monthIndex
        ] || 0
      ),
    0
  );
}

function calculateLossPercent({
  baselineKwh,
  shadedKwh,
}) {
  assertNumericArray(
    baselineKwh,
    "baselineKwh"
  );

  assertNumericArray(
    shadedKwh,
    "shadedKwh"
  );

  if (
    baselineKwh.length !==
    shadedKwh.length
  ) {
    throw new Error(
      "baselineKwh and shadedKwh must have the same length."
    );
  }

  const baselineTotal =
    sumArray(
      baselineKwh
    );

  const shadedTotal =
    sumArray(
      shadedKwh
    );

  if (
    baselineTotal <=
    EPSILON
  ) {
    return 0;
  }

  return (
    (
      baselineTotal -
      shadedTotal
    ) /
    baselineTotal
  ) * 100;
}

function calculatePeriodLossPercent({
  baselineMonthlyKwh,
  shadedMonthlyKwh,
  monthIndexes,
}) {
  assertMonthlyArray(
    baselineMonthlyKwh,
    "baselineMonthlyKwh"
  );

  assertMonthlyArray(
    shadedMonthlyKwh,
    "shadedMonthlyKwh"
  );

  const baselineTotal =
    sumMonths(
      baselineMonthlyKwh,
      monthIndexes
    );

  const shadedTotal =
    sumMonths(
      shadedMonthlyKwh,
      monthIndexes
    );

  if (
    baselineTotal <=
    EPSILON
  ) {
    return 0;
  }

  return (
    (
      baselineTotal -
      shadedTotal
    ) /
    baselineTotal
  ) * 100;
}

function safeRatio(
  numerator,
  denominator,
  fallback = 0
) {
  const numeratorNumber =
    numberOrNull(
      numerator
    );

  const denominatorNumber =
    numberOrNull(
      denominator
    );

  if (
    numeratorNumber === null ||
    denominatorNumber === null ||
    Math.abs(
      denominatorNumber
    ) <= EPSILON
  ) {
    return fallback;
  }

  return (
    numeratorNumber /
    denominatorNumber
  );
}

function calculateRuntimeSignals({
  baselineMonthlyKwh,
  directMonthlyKwh,
  componentAwareMonthlyKwh,

  directAnnualShadeLossPercentOverride = null,
  componentAnnualShadeLossPercentOverride = null,
}) {
  assertMonthlyArray(
    baselineMonthlyKwh,
    "baselineMonthlyKwh"
  );

  assertMonthlyArray(
    directMonthlyKwh,
    "directMonthlyKwh"
  );

  assertMonthlyArray(
    componentAwareMonthlyKwh,
    "componentAwareMonthlyKwh"
  );

  const calculatedDirectAnnualShadeLossPercent =
    calculateLossPercent({
      baselineKwh:
        baselineMonthlyKwh,

      shadedKwh:
        directMonthlyKwh,
    });

  const calculatedComponentAnnualShadeLossPercent =
    calculateLossPercent({
      baselineKwh:
        baselineMonthlyKwh,

      shadedKwh:
        componentAwareMonthlyKwh,
    });

  const directOverride =
    numberOrNull(
      directAnnualShadeLossPercentOverride
    );

  const componentOverride =
    numberOrNull(
      componentAnnualShadeLossPercentOverride
    );

  const directAnnualShadeLossPercent =
    directOverride !== null
      ? directOverride
      : calculatedDirectAnnualShadeLossPercent;

  const componentAnnualShadeLossPercent =
    componentOverride !== null
      ? componentOverride
      : calculatedComponentAnnualShadeLossPercent;

  const R =
    safeRatio(
      componentAnnualShadeLossPercent,
      directAnnualShadeLossPercent,
      0
    );

  const directWinterShadeLossPercent =
    calculatePeriodLossPercent({
      baselineMonthlyKwh,

      shadedMonthlyKwh:
        directMonthlyKwh,

      monthIndexes:
        WINTER_MONTH_INDEXES,
    });

  const componentWinterShadeLossPercent =
    calculatePeriodLossPercent({
      baselineMonthlyKwh,

      shadedMonthlyKwh:
        componentAwareMonthlyKwh,

      monthIndexes:
        WINTER_MONTH_INDEXES,
    });

  const winterR =
    safeRatio(
      componentWinterShadeLossPercent,
      directWinterShadeLossPercent,
      R
    );

  return {
    directAnnualShadeLossPercent,
    componentAnnualShadeLossPercent,
    R,

    directWinterShadeLossPercent,
    componentWinterShadeLossPercent,
    winterR,
  };
}

function predictShadeStrength({
  R,
  winterR,
}) {
  const r =
    numberOrNull(R);

  const winter =
    numberOrNull(
      winterR
    );

  if (
    r === null ||
    winter === null
  ) {
    throw new Error(
      "R and winterR must be finite numbers."
    );
  }

  const {
    intercept,
    RCoefficient,
    winterRCoefficient,
  } =
    modelConfig.coefficients;

  const minimum =
    Number(
      modelConfig.limits
        .minStrength
    );

  const maximum =
    Number(
      modelConfig.limits
        .maxStrength
    );

  const latentStrength =
    Number(intercept) +
    Number(
      RCoefficient
    ) * r +
    Number(
      winterRCoefficient
    ) * winter;

  const shadeStrength =
    clamp(
      latentStrength,
      minimum,
      maximum
    );

  return {
    modelVersion:
      modelConfig.modelVersion,

    latentStrength,
    shadeStrength,

    wasClamped:
      shadeStrength !==
      latentStrength,
  };
}

function blendProduction({
  baselineKwh,
  directShadeKwh,
  shadeStrength,
}) {
  assertNumericArray(
    baselineKwh,
    "baselineKwh"
  );

  assertNumericArray(
    directShadeKwh,
    "directShadeKwh"
  );

  if (
    baselineKwh.length !==
    directShadeKwh.length
  ) {
    throw new Error(
      "baselineKwh and directShadeKwh must have the same length."
    );
  }

  const strength =
    clamp(
      Number(
        shadeStrength
      ),
      Number(
        modelConfig.limits
          .minStrength
      ),
      Number(
        modelConfig.limits
          .maxStrength
      )
    );

  return baselineKwh.map(
    (baselineValue, index) => {
      const baseline =
        Number(
          baselineValue || 0
        );

      const direct =
        Number(
          directShadeKwh[
            index
          ] || 0
        );

      const blended =
        baseline -
        strength *
        (
          baseline -
          direct
        );

      return Math.max(
        0,
        blended
      );
    }
  );
}

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
