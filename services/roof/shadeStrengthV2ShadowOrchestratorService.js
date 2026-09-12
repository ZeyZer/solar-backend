const {
  buildGoogleHourlyShadeFactorsRuntime,
} = require("./googleHourlyShadeFactorRuntimeService");

const {
  buildShadeStrengthV2RuntimeProduction,
} = require("./shadeStrengthV2RuntimeProductionService");

const SOURCE =
  "zeyzer_shade_strength_v2_shadow_orchestrator_v1";

async function buildShadeStrengthV2ShadowProduction({
  location,
  googlePanelPositions,
  segmentInputs,
  years,
  apiKey = null,
  dependencies = {},
}) {
  const shadeBuilder =
    dependencies.buildGoogleHourlyShadeFactorsRuntime ||
    buildGoogleHourlyShadeFactorsRuntime;

  const productionBuilder =
    dependencies.buildShadeStrengthV2RuntimeProduction ||
    buildShadeStrengthV2RuntimeProduction;

  const shadeResult =
    await shadeBuilder({
      googlePanelPositions,
      segmentInputs,
      fallbackLocation:
        location,
      apiKey,
    });

  if (
    !shadeResult ||
    shadeResult.status !== "complete"
  ) {
    return {
      source: SOURCE,
      mode: "shadow",
      status:
        "shade_unavailable",
      canonicalProduction: false,

      shadeStatus:
        shadeResult?.status ||
        "unknown",

      shadeError:
        shadeResult?.error ||
        null,

      shade:
        shadeResult ||
        null,
    };
  }

  const productionResult =
    await productionBuilder({
      location,
      segmentInputs,

      segmentMatrices:
        shadeResult
          .segmentMonthlyByHourShadeFactor,

      years,
    });

  if (
    !productionResult ||
    productionResult.status !== "complete"
  ) {
    return {
      source: SOURCE,
      mode: "shadow",
      status:
        "production_unavailable",
      canonicalProduction: false,

      productionStatus:
        productionResult?.status ||
        "unknown",

      production:
        productionResult ||
        null,

      shade: {
        source:
          shadeResult.source,

        requestLocation:
          shadeResult.requestLocation,

        imageryQuality:
          shadeResult.imageryQuality,

        selectedPanelSampleCount:
          shadeResult
            .selectedPanelSampleCount,

        selectedPanelSamplesBySegment:
          shadeResult
            .selectedPanelSamplesBySegment,
      },
    };
  }

  return {
    source: SOURCE,
    mode: "shadow",
    status: "complete",
    canonicalProduction: false,

    productionProfile:
      productionResult
        .productionProfile,

    runtimeSignals:
      productionResult
        .runtimeSignals,

    prediction:
      productionResult
        .prediction,

    diagnostics:
      productionResult
        .diagnostics,

    provenance: {
      location:
        productionResult.location,

      years:
        productionResult.years,

      segmentCount:
        productionResult.segmentCount,

      shadeMatrixSegmentIndexes:
        productionResult
          .shadeMatrixSegmentIndexes,

      googleShade: {
        source:
          shadeResult.source,

        requestLocation:
          shadeResult.requestLocation,

        imageryQuality:
          shadeResult.imageryQuality,

        selectedPanelSampleCount:
          shadeResult
            .selectedPanelSampleCount,

        selectedPanelSamplesBySegment:
          shadeResult
            .selectedPanelSamplesBySegment,

        segmentMonthlyAverageShadeFactor:
          shadeResult
            .segmentMonthlyAverageShadeFactor,
      },

      categoricalShadingApplied:
        false,
    },
  };
}

module.exports = {
  buildShadeStrengthV2ShadowProduction,
};
