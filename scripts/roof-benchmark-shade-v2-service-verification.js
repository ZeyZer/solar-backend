const fs = require("fs");
const path = require("path");

const {
  buildShadeStrengthV2Benchmark,
} = require(
  "../services/roof/roofBenchmarkShadeStrengthV2Service"
);

const CACHE_DIR =
  "data/roof-benchmark/shade-calibration-cache";

const EXPECTED = {
  "benchmark-001": 0.188,
  "benchmark-002": 0.470,
  "benchmark-003": 1.000,
  "benchmark-004": 0.759,
  "benchmark-005": 1.000,
  "benchmark-006": 0.999,
  "benchmark-007": 0.296,
  "benchmark-008": 0.431,
};

const TOLERANCE = 0.01;

function round(
  value,
  places = 3
) {
  const factor =
    10 ** places;

  return (
    Math.round(
      Number(value) *
      factor
    ) / factor
  );
}

function sum(values) {
  return values.reduce(
    (total, value) =>
      total +
      Number(value || 0),
    0
  );
}

const rows = [];

for (
  const [
    benchmarkId,
    expectedStrength,
  ]
  of Object.entries(EXPECTED)
) {
  const file =
    path.join(
      CACHE_DIR,
      `${benchmarkId}.json`
    );

  if (
    !fs.existsSync(file)
  ) {
    throw new Error(
      `Missing frozen cache: ${file}`
    );
  }

  const diagnostic =
    JSON.parse(
      fs.readFileSync(
        file,
        "utf8"
      )
    );

  const baselineMonthlyKwh =
    diagnostic
      .fixedReferencePvgis
      .monthlyKwh;

  const directMonthlyKwh =
    diagnostic
      .fixedReferencePvgisPlusGoogleDirectShade
      .monthlyKwh;

  const componentAwareMonthlyKwh =
    diagnostic
      .fixedReferencePvgisPlusGoogleComponentAwareShade
      .monthlyKwh;

  const result =
    buildShadeStrengthV2Benchmark({
      baselineMonthlyKwh,
      directMonthlyKwh,
      componentAwareMonthlyKwh,

      directAnnualShadeLossPercentOverride:
        diagnostic
          .googleShadeCalibrationDiagnostic
          .directAnnualShadeLossPercent,

      componentAnnualShadeLossPercentOverride:
        diagnostic
          .googleShadeCalibrationDiagnostic
          .componentAwareAnnualShadeLossPercent,
    });

  const actualStrength =
    result
      .prediction
      .shadeStrength;

  const delta =
    Math.abs(
      actualStrength -
      expectedStrength
    );

  const minimumBlendedMonthlyKwh =
    Math.min(
      ...result
        .monthly
        .blendedKwh
    );

  const baselineAnnualKwh =
    sum(
      baselineMonthlyKwh
    );

  const directAnnualKwh =
    sum(
      directMonthlyKwh
    );

  const blendedAnnualKwh =
    sum(
      result
        .monthly
        .blendedKwh
    );

  const strengthPass =
    delta <= TOLERANCE;

  const nonNegativePass =
    minimumBlendedMonthlyKwh >= 0;

  rows.push({
    id:
      benchmarkId,

    R:
      round(
        result
          .runtimeSignals
          .R
      ),

    winterR:
      round(
        result
          .runtimeSignals
          .winterR
      ),

    latent:
      round(
        result
          .prediction
          .latentStrength
      ),

    expectedS:
      expectedStrength,

    actualS:
      round(
        actualStrength
      ),

    delta:
      round(
        delta,
        4
      ),

    baselineAnnual:
      round(
        baselineAnnualKwh,
        1
      ),

    directAnnual:
      round(
        directAnnualKwh,
        1
      ),

    v2Annual:
      round(
        blendedAnnualKwh,
        1
      ),

    minMonthly:
      round(
        minimumBlendedMonthlyKwh,
        1
      ),

    pass:
      strengthPass &&
      nonNegativePass,
  });
}

console.log(
  "\nSHADE STRENGTH V2 SERVICE VERIFICATION"
);

console.table(rows);

const failures =
  rows.filter(
    (row) =>
      !row.pass
  );

if (
  failures.length > 0
) {
  console.error(
    "\nFAIL: v2 service did not reproduce the frozen benchmark behaviour."
  );

  console.table(
    failures
  );

  process.exitCode = 1;
} else {
  console.log(
    "\nPASS: all eight frozen benchmarks reproduced v2 shade strength within tolerance."
  );

  console.log(
    "PASS: no blended monthly production value was negative."
  );
}
