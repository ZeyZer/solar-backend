const {
  buildShadeStrengthV2LiveShadow,
} = require("./shadeStrengthV2LiveShadowService");

const SOURCE =
  "zeyzer_shade_strength_v2_quote_shadow_v1";

const ATTACHED_PROPERTY_TYPES =
  new Set([
    "semi_detached",
    "mid_terrace",
    "end_terrace",
  ]);

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function getPositivePanelRoofs(input = {}) {
  return (
    Array.isArray(input.roofs)
      ? input.roofs
      : []
  ).filter(
    (roof) =>
      Number(roof?.panels || 0) > 0
  );
}

function resolveQuoteShadowInputs({
  input = {},
  panelWatt = 0,
} = {}) {
  if (
    input.roofInputMode !==
    "draw_my_roof"
  ) {
    return {
      status: "ineligible",
      reason:
        "roof_input_mode_not_google",
    };
  }

  const roofGeometry =
    input.roofGeometry || null;

  if (!roofGeometry) {
    return {
      status: "ineligible",
      reason:
        "missing_roof_geometry",
    };
  }

  const roofs =
    getPositivePanelRoofs(input);

  if (!roofs.length) {
    return {
      status: "ineligible",
      reason:
        "missing_positive_panel_roofs",
    };
  }

  const missingBuildingRoof =
    roofs.find(
      (roof) =>
        !String(
          roof?.sourceBuildingId ||
          ""
        ).trim()
    );

  if (missingBuildingRoof) {
    return {
      status: "ineligible",
      reason:
        "missing_source_building_id",
      roofId:
        missingBuildingRoof.id ||
        null,
    };
  }

  const sourceBuildingIds = [
    ...new Set(
      roofs.map(
        (roof) =>
          String(
            roof.sourceBuildingId
          )
      )
    ),
  ];

  if (
    sourceBuildingIds.length !== 1
  ) {
    return {
      status: "ineligible",
      reason:
        "multiple_buildings_not_supported",
      sourceBuildingIds,
    };
  }

  const sourceBuildingId =
    sourceBuildingIds[0];

  const buildingModels =
    Array.isArray(
      roofGeometry
        .solarBuildingModels
    )
      ? roofGeometry
          .solarBuildingModels
      : [];

  const building =
    buildingModels.find(
      (item) =>
        String(item?.id || "") ===
        sourceBuildingId
    );

  if (!building) {
    return {
      status: "ineligible",
      reason:
        "source_building_model_not_found",
      sourceBuildingId,
    };
  }

  const propertyType =
    String(
      input.propertyType ||
      roofGeometry.propertyType ||
      "unknown"
    )
      .trim()
      .toLowerCase();

  if (
    ATTACHED_PROPERTY_TYPES.has(
      propertyType
    )
  ) {
    if (
      !roofGeometry
        .propertyBoundary
    ) {
      return {
        status: "ineligible",
        reason:
          "required_property_boundary_missing",
        sourceBuildingId,
      };
    }

    if (
      building
        ?.propertyBoundaryFilter
        ?.applied !== true
    ) {
      return {
        status: "ineligible",
        reason:
          "property_boundary_filter_not_applied",
        sourceBuildingId,
      };
    }
  }

  const targets =
    Array.isArray(
      roofGeometry
        .solarTargetBuildings
    )
      ? roofGeometry
          .solarTargetBuildings
      : [];

  const clickedTarget =
    targets.find(
      (target) =>
        String(
          target?.id || ""
        ) ===
        String(
          building?.targetId || ""
        )
    ) || null;

  const latitude =
    numberOrNull(
      clickedTarget?.latitude ??
      clickedTarget?.lat ??
      building
        ?.requestedLocation
        ?.latitude
    );

  const longitude =
    numberOrNull(
      clickedTarget?.longitude ??
      clickedTarget?.lng ??
      building
        ?.requestedLocation
        ?.longitude
    );

  if (
    latitude === null ||
    longitude === null
  ) {
    return {
      status: "ineligible",
      reason:
        "clicked_roof_location_unavailable",
      sourceBuildingId,
    };
  }

  const googlePanelPositions =
    Array.isArray(
      building
        ?.googlePanelPositions
    )
      ? building
          .googlePanelPositions
      : [];

  if (
    !googlePanelPositions.length
  ) {
    return {
      status: "ineligible",
      reason:
        "google_panel_positions_unavailable",
      sourceBuildingId,
    };
  }

  const resolvedPanelWatt =
    numberOrNull(panelWatt);

  if (
    resolvedPanelWatt === null ||
    resolvedPanelWatt <= 0
  ) {
    return {
      status: "ineligible",
      reason:
        "panel_watt_unavailable",
      sourceBuildingId,
    };
  }

  return {
    status: "complete",

    sourceBuildingId,

    location: {
      lat: latitude,
      lon: longitude,
    },

    locationSource:
      clickedTarget
        ? "clicked_solar_target"
        : "building_requested_location_fallback",

    roofs,

    googlePanelPositions,

    panelWatt:
      resolvedPanelWatt,

    propertyType,

    boundaryFilterApplied:
      building
        ?.propertyBoundaryFilter
        ?.applied === true,
  };
}

function compactLiveShadowResult(
  result
) {
  if (
    !result ||
    result.status !== "complete"
  ) {
    return result || null;
  }

  return {
    source:
      result.source,

    mode:
      result.mode,

    status:
      result.status,

    canonicalProduction:
      false,

    inputSummary:
      result.inputSummary,

    segmentInputs:
      result.segmentInputs,

    runtimeSignals:
      result.runtimeSignals,

    prediction:
      result.prediction,

    diagnostics:
      result.diagnostics,

    productionProfile: {
      hourCount:
        result.productionProfile
          ?.hourCount ??
        null,

      annualKwh:
        result.productionProfile
          ?.annualKwh ??
        null,

      monthlyKwh:
        result.productionProfile
          ?.monthlyKwh ??
        null,
    },

    provenance:
      result.provenance,
  };
}

async function buildQuoteShadeStrengthV2Runtime({
  input = {},
  panelWatt = 0,
  years = [2021, 2022, 2023],
  dependencies = {},
} = {}) {
  const resolved =
    resolveQuoteShadowInputs({
      input,
      panelWatt,
    });

  if (
    resolved.status !==
    "complete"
  ) {
    return {
      source:
        "zeyzer_shade_strength_v2_quote_runtime_v1",

      mode:
        "runtime",

      status:
        "ineligible",

      canonicalProduction:
        false,

      reason:
        resolved.reason ||
        "unknown",

      eligibility:
        resolved,
    };
  }

  const liveShadowBuilder =
    dependencies
      .buildShadeStrengthV2LiveShadow ||
    buildShadeStrengthV2LiveShadow;

  try {
    const result =
      await liveShadowBuilder({
        location:
          resolved.location,

        roofs:
          resolved.roofs,

        fallbackPanelWatt:
          resolved.panelWatt,

        googlePanelPositions:
          resolved
            .googlePanelPositions,

        years,
      });

    return {
      source:
        "zeyzer_shade_strength_v2_quote_runtime_v1",

      mode:
        "runtime",

      status:
        result?.status ===
        "complete"
          ? "complete"
          : "shadow_unavailable",

      canonicalProduction:
        false,

      sourceBuildingId:
        resolved
          .sourceBuildingId,

      locationSource:
        resolved
          .locationSource,

      boundaryFilterApplied:
        resolved
          .boundaryFilterApplied,

      result:
        result || null,
    };
  } catch (error) {
    return {
      source:
        "zeyzer_shade_strength_v2_quote_runtime_v1",

      mode:
        "runtime",

      status:
        "shadow_error",

      canonicalProduction:
        false,

      sourceBuildingId:
        resolved
          .sourceBuildingId,

      error:
        error?.message ||
        String(error),
    };
  }
}

async function buildQuoteShadeStrengthV2Shadow({
  input = {},
  panelWatt = 0,
  years = [2021, 2022, 2023],
  dependencies = {},
} = {}) {
  const runtime =
    await buildQuoteShadeStrengthV2Runtime({
      input,
      panelWatt,
      years,
      dependencies,
    });

  return {
    ...runtime,

    source:
      SOURCE,

    mode:
      "shadow",

    result:
      runtime.status ===
      "complete"
        ? compactLiveShadowResult(
            runtime.result
          )
        : runtime.result,
  };
}

module.exports = {
  resolveQuoteShadowInputs,
  compactLiveShadowResult,
  buildQuoteShadeStrengthV2Runtime,
  buildQuoteShadeStrengthV2Shadow,
};
