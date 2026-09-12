const {
  buildRuntimeSegmentInputs,
} = require("./shadeStrengthV2RuntimeInputAdapterService");

const {
  buildShadeStrengthV2ShadowProduction,
} = require("./shadeStrengthV2ShadowOrchestratorService");

const SOURCE =
  "zeyzer_shade_strength_v2_live_shadow_v1";

async function buildShadeStrengthV2LiveShadow({
  location,
  roofs,
  fallbackPanelWatt = 0,
  googlePanelPositions,
  years,
  apiKey = null,
  dependencies = {},
}) {
  const inputBuilder =
    dependencies.buildRuntimeSegmentInputs ||
    buildRuntimeSegmentInputs;

  const shadowBuilder =
    dependencies.buildShadeStrengthV2ShadowProduction ||
    buildShadeStrengthV2ShadowProduction;

  const inputResult =
    inputBuilder({
      roofs,
      fallbackPanelWatt,
    });

  if (
    !inputResult ||
    inputResult.status !== "complete"
  ) {
    return {
      source: SOURCE,
      mode: "shadow",
      status: "input_unavailable",
      canonicalProduction: false,

      inputStatus:
        inputResult?.status ||
        "unknown",

      issues:
        inputResult?.issues ||
        [],

      input:
        inputResult ||
        null,
    };
  }

  const shadowResult =
    await shadowBuilder({
      location,

      googlePanelPositions,

      segmentInputs:
        inputResult.segmentInputs,

      years,
      apiKey,
    });

  if (
    !shadowResult ||
    shadowResult.status !== "complete"
  ) {
    return {
      source: SOURCE,
      mode: "shadow",
      status: "shadow_unavailable",
      canonicalProduction: false,

      shadowStatus:
        shadowResult?.status ||
        "unknown",

      inputSummary:
        inputResult.summary,

      segmentInputs:
        inputResult.segmentInputs,

      shadow:
        shadowResult ||
        null,
    };
  }

  return {
    source: SOURCE,
    mode: "shadow",
    status: "complete",
    canonicalProduction: false,

    inputSummary:
      inputResult.summary,

    segmentInputs:
      inputResult.segmentInputs,

    productionProfile:
      shadowResult.productionProfile,

    runtimeSignals:
      shadowResult.runtimeSignals,

    prediction:
      shadowResult.prediction,

    diagnostics:
      shadowResult.diagnostics,

    provenance: {
      inputAdapter: {
        source:
          inputResult.source,

        summary:
          inputResult.summary,
      },

      shadow:
        shadowResult.provenance,
    },
  };
}

module.exports = {
  buildShadeStrengthV2LiveShadow,
};
