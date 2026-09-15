const {
  buildQuoteShadeStrengthV2Runtime,
} = require(
  "./shadeStrengthV2QuoteShadowService"
);

const SOURCE =
  "zeyzer_shade_strength_v2_quote_candidate_v1";

const MODEL =
  "hourly_pvgis_shade_strength_v2_candidate_3yr_avg_2021_2023";

const DEFAULT_YEARS = [
  2021,
  2022,
  2023,
];

function is8760Array(value) {
  return (
    Array.isArray(value) &&
    value.length === 8760
  );
}

function timeIndexesMatch(
  candidate,
  existing
) {
  if (
    !is8760Array(candidate) ||
    !is8760Array(existing)
  ) {
    return false;
  }

  for (
    let index = 0;
    index < 8760;
    index += 1
  ) {
    if (
      Number(candidate[index]) !==
      Number(existing[index])
    ) {
      return false;
    }
  }

  return true;
}

function buildCandidateDiagnostic({
  runtime,
  previousModel,
  previousAnnualGenerationKWh,
  candidateAnnualGenerationKWh,
} = {}) {
  const result =
    runtime?.result || null;

  return {
    source:
      SOURCE,

    status:
      "complete",

    applied:
      true,

    candidateModel:
      MODEL,

    previousModel:
      previousModel || null,

    previousAnnualGenerationKWh:
      previousAnnualGenerationKWh ??
      null,

    candidateAnnualGenerationKWh:
      candidateAnnualGenerationKWh ??
      null,

    sourceBuildingId:
      runtime?.sourceBuildingId ||
      null,

    locationSource:
      runtime?.locationSource ||
      null,

    boundaryFilterApplied:
      runtime?.boundaryFilterApplied ===
      true,

    hourCount:
      result?.productionProfile
        ?.hourCount ??
      null,

    runtimeSignals:
      result?.runtimeSignals ||
      null,

    prediction:
      result?.prediction ||
      null,

    diagnostics:
      result?.diagnostics ||
      null,

    provenance:
      result?.provenance ||
      null,
  };
}

async function buildQuoteShadeStrengthV2Candidate({
  input = {},
  panelWatt = 0,
  hourlyModel = null,
  years = DEFAULT_YEARS,
  dependencies = {},
} = {}) {
  if (
    !hourlyModel ||
    !is8760Array(
      hourlyModel._pvHourlyKWh
    ) ||
    !is8760Array(
      hourlyModel._loadHourlyKWh
    ) ||
    !is8760Array(
      hourlyModel._monthIdx
    ) ||
    !is8760Array(
      hourlyModel._hourOfDay
    )
  ) {
    return {
      source:
        SOURCE,

      status:
        "fallback",

      applied:
        false,

      reason:
        "base_hourly_model_unavailable",
    };
  }

  const runtimeBuilder =
    dependencies
      .buildQuoteShadeStrengthV2Runtime ||
    buildQuoteShadeStrengthV2Runtime;

  const runtime =
    await runtimeBuilder({
      input,
      panelWatt,
      years,
    });

  if (
    !runtime ||
    runtime.status !==
    "complete"
  ) {
    return {
      source:
        SOURCE,

      status:
        "fallback",

      applied:
        false,

      reason:
        runtime?.reason ||
        runtime?.status ||
        "runtime_unavailable",

      runtime:
        runtime || null,
    };
  }

  const profile =
    runtime?.result
      ?.productionProfile;

  if (
    !profile ||
    !is8760Array(
      profile.hourlyKwh
    ) ||
    !is8760Array(
      profile.monthIdx
    ) ||
    !is8760Array(
      profile.hourOfDay
    ) ||
    !Array.isArray(
      profile.monthlyKwh
    ) ||
    profile.monthlyKwh.length !==
      12
  ) {
    return {
      source:
        SOURCE,

      status:
        "fallback",

      applied:
        false,

      reason:
        "candidate_profile_invalid",

      runtime,
    };
  }

  if (
    !timeIndexesMatch(
      profile.monthIdx,
      hourlyModel._monthIdx
    ) ||
    !timeIndexesMatch(
      profile.hourOfDay,
      hourlyModel._hourOfDay
    )
  ) {
    return {
      source:
        SOURCE,

      status:
        "fallback",

      applied:
        false,

      reason:
        "candidate_time_index_mismatch",

      runtime,
    };
  }

  const annualKwh =
    Number(
      profile.annualKwh
    );

  if (
    !Number.isFinite(annualKwh) ||
    annualKwh <= 0
  ) {
    return {
      source:
        SOURCE,

      status:
        "fallback",

      applied:
        false,

      reason:
        "candidate_annual_generation_invalid",

      runtime,
    };
  }

  const previousModel =
    hourlyModel.model ||
    null;

  const previousAnnualGenerationKWh =
    Number.isFinite(
      Number(
        hourlyModel
          .annualGenerationKWh
      )
    )
      ? Number(
          hourlyModel
            .annualGenerationKWh
        )
      : null;

  const candidateAnnualGenerationKWh =
    Math.round(
      annualKwh
    );

  const candidateHourlyModel = {
    ...hourlyModel,

    model:
      MODEL,

    years:
      Array.isArray(
        runtime?.result?.years
      )
        ? [
            ...runtime.result.years,
          ]
        : [...years],

    monthlyGenerationKWh:
      profile.monthlyKwh.map(
        (value) =>
          Number(value || 0)
      ),

    annualGenerationKWh:
      candidateAnnualGenerationKWh,

    _pvHourlyKWh:
      profile.hourlyKwh.map(
        (value) =>
          Number(value || 0)
      ),

    _monthIdx:
      profile.monthIdx.map(
        (value) =>
          Number(value || 0)
      ),

    _hourOfDay:
      profile.hourOfDay.map(
        (value) =>
          Number(value || 0)
      ),

    // The inherited PVGIS roof profiles describe the
    // legacy categorical-shading production model.
    // They must not be presented as v2 roof profiles.
    _pvgisRoofProfiles: [],

    productionProvenance: {
      source:
        SOURCE,

      candidateModel:
        MODEL,

      previousModel,

      previousAnnualGenerationKWh,

      locationSource:
        runtime.locationSource ||
        null,

      sourceBuildingId:
        runtime.sourceBuildingId ||
        null,

      boundaryFilterApplied:
        runtime
          .boundaryFilterApplied ===
        true,

      categoricalShadingApplied:
        runtime?.result
          ?.diagnostics
          ?.categoricalShadingApplied ===
        true,

      shadeStrength:
        runtime?.result
          ?.prediction
          ?.shadeStrength ??
        null,

      wasClamped:
        runtime?.result
          ?.prediction
          ?.wasClamped ??
        null,
    },
  };

  const hourlyYearData = [
    {
      year:
        "avg_2021_2023_shade_v2_candidate",

      pvHourlyKWh:
        candidateHourlyModel
          ._pvHourlyKWh,

      loadHourlyKWh:
        candidateHourlyModel
          ._loadHourlyKWh,

      monthIdx:
        candidateHourlyModel
          ._monthIdx,

      hourOfDay:
        candidateHourlyModel
          ._hourOfDay,
    },
  ];

  return {
    source:
      SOURCE,

    status:
      "complete",

    applied:
      true,

    model:
      MODEL,

    annualGenerationKWh:
      candidateAnnualGenerationKWh,

    hourlyModel:
      candidateHourlyModel,

    hourlyYearData,

    runtime,

    diagnostic:
      buildCandidateDiagnostic({
        runtime,
        previousModel,
        previousAnnualGenerationKWh,
        candidateAnnualGenerationKWh,
      }),
  };
}

module.exports = {
  SOURCE,
  MODEL,
  is8760Array,
  timeIndexesMatch,
  buildCandidateDiagnostic,
  buildQuoteShadeStrengthV2Candidate,
};
