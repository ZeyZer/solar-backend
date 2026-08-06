const {
  buildRoofGeometryInputModel,
} = require("./services/roof/roofGeometryInputService");

const {
  buildManualRoofPolygonModel,
} = require("./services/roof/manualRoofPolygonModelService");

const {
  buildCandidateSetFromInputs,
} = require("./services/candidates/designCandidateSetService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildDrawMyRoofMvpInput() {
  return {
    systemType: "balanced",
    batteryKWh: 5,

    roofGeometry: {
      source: "manual_roof_polygon",
      captureMethod: "user_drawn_map_polygon",
      geometryVersion: "draw_my_roof_mvp_1",

      addressContext: {
        postcode: "GU1 1AA",
        addressLine: "Example House, Example Road",
        country: "GB",
      },

      mapContext: {
        provider: "to_be_selected",
        zoom: 20,
        centre: {
          lng: -0.1,
          lat: 51.5,
        },
      },

      roofPlanes: [
        {
          id: "drawn-roof-main-south",
          label: "Main south roof",
          source: "manual_roof_polygon",
          geometryType: "polygon",

          orientation: "S",
          tilt: 40,
          shading: "none",

          areaM2: 24,
          usableAreaM2: 22,

          coordinates: [
            [-0.100000, 51.500000],
            [-0.099900, 51.500000],
            [-0.099900, 51.500100],
            [-0.100000, 51.500100],
          ],

          obstacles: [],

          setbacks: {
            edgeMm: null,
            ridgeMm: null,
            valleyMm: null,
            partyWallMm: null,
          },

          physicalFitVerified: false,
          panelDimensionFitVerified: false,

          notes: "User-drawn roof area. Not survey verified.",
        },
      ],
    },
  };
}

function runRoofGeometryContractTest() {
  console.log("\n▶ Draw-my-roof payload maps into roof geometry input model");

  const input = buildDrawMyRoofMvpInput();

  const roofGeometryInput = buildRoofGeometryInputModel({
    input,
  });

  assert(roofGeometryInput, "Missing roofGeometryInput.");

  assert(
    roofGeometryInput.mode === "roof_geometry_input_model_beta",
    "Unexpected roofGeometryInput mode."
  );

  assert(
    roofGeometryInput.sourceStatus === "geometry_input_available",
    `Expected geometry input available, got ${roofGeometryInput.sourceStatus}`
  );

  assert(
    roofGeometryInput.summary.manualPolygonReady === true,
    "Expected manualPolygonReady to be true."
  );

  assert(
    roofGeometryInput.summary.hasAreaGeometry === true,
    "Expected area geometry to be available."
  );

  assert(
    roofGeometryInput.summary.onlyPanelCountAssumptions === false,
    "Expected input not to be panel-count-only."
  );

  assert(
    roofGeometryInput.summary.roofPlaneCount === 1,
    "Expected one roof plane."
  );

  const plane = roofGeometryInput.roofPlanes[0];

  assert(
    plane.source === "manual_roof_polygon",
    `Expected manual_roof_polygon source, got ${plane.source}`
  );

  assert(
    plane.geometryType === "polygon",
    `Expected polygon geometry type, got ${plane.geometryType}`
  );

  assert(
    plane.geometry.coordinateCount === 4,
    `Expected four coordinates, got ${plane.geometry.coordinateCount}`
  );

  assert(
    plane.geometry.areaM2 === 24,
    `Expected areaM2 of 24, got ${plane.geometry.areaM2}`
  );

  assert(
    plane.geometry.usableAreaM2 === 22,
    `Expected usableAreaM2 of 22, got ${plane.geometry.usableAreaM2}`
  );

  console.log("  ✓ Draw-my-roof geometry contract OK:", {
    sourceStatus: roofGeometryInput.sourceStatus,
    roofPlaneCount: roofGeometryInput.summary.roofPlaneCount,
    areaM2: plane.geometry.areaM2,
    usableAreaM2: plane.geometry.usableAreaM2,
  });
}

function runManualPolygonContractTest() {
  console.log("\n▶ Draw-my-roof payload maps into manual polygon model");

  const input = buildDrawMyRoofMvpInput();

  const roofGeometryInput = buildRoofGeometryInputModel({
    input,
  });

  const manualRoofPolygonModel = buildManualRoofPolygonModel({
    roofGeometryInput,
  });

  assert(
    manualRoofPolygonModel.mode === "manual_roof_polygon_model_beta",
    "Unexpected manualRoofPolygonModel mode."
  );

  assert(
    manualRoofPolygonModel.summary.polygonCount === 1,
    "Expected one manual polygon."
  );

  assert(
    manualRoofPolygonModel.summary.invalidPolygonCount === 0,
    "Expected no invalid polygons."
  );

  assert(
    manualRoofPolygonModel.summary.readiness ===
      "manual_polygons_ready_for_future_area_estimation",
    `Unexpected readiness: ${manualRoofPolygonModel.summary.readiness}`
  );

  assert(
    manualRoofPolygonModel.summary.canSupportFutureAreaBasedPanelEstimate === true,
    "Expected support for future area-based panel estimate."
  );

  console.log("  ✓ Draw-my-roof manual polygon contract OK:", {
    readiness: manualRoofPolygonModel.summary.readiness,
    polygonCount: manualRoofPolygonModel.summary.polygonCount,
  });
}

function runCandidateSetContractTest() {
  console.log("\n▶ Draw-my-roof payload works through candidate set");

  const candidateSet = buildCandidateSetFromInputs({
    input: buildDrawMyRoofMvpInput(),
  });

  assert(candidateSet, "Missing candidate set.");

  assert(
    candidateSet.roofGeometryInput,
    "Candidate set missing roofGeometryInput."
  );

  assert(
    candidateSet.manualRoofPolygonModel,
    "Candidate set missing manualRoofPolygonModel."
  );

  assert(
    candidateSet.roofDesignConfidenceSummary,
    "Candidate set missing roofDesignConfidenceSummary."
  );

  assert(
    candidateSet.areaPanelCapacityEstimateSummary,
    "Candidate set missing areaPanelCapacityEstimateSummary."
  );

  assert(
    candidateSet.roofGeometryInput.summary.manualPolygonReady === true,
    "Expected candidate set to be manual polygon ready."
  );

  assert(
    candidateSet.manualRoofPolygonModel.summary.readiness ===
      "manual_polygons_ready_for_future_area_estimation",
    `Unexpected manual polygon readiness: ${candidateSet.manualRoofPolygonModel.summary.readiness}`
  );

  assert(
    candidateSet.roofDesignConfidenceSummary.readiness ===
      "ready_for_area_geometry_confidence_messaging",
    `Unexpected roof design confidence readiness: ${candidateSet.roofDesignConfidenceSummary.readiness}`
  );

  assert(
    candidateSet.candidates.every(
      (candidate) => candidate.roofGeometryAssumption
    ),
    "Every candidate should include roofGeometryAssumption."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) => candidate.roofDesignConfidence
    ),
    "Every candidate should include roofDesignConfidence."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) => candidate.areaPanelCapacityEstimate
    ),
    "Every candidate should include areaPanelCapacityEstimate."
  );

  assert(
    candidateSet.areaPanelCapacityEstimateSummary.usedForRecommendation === false,
    "Area panel capacity estimate summary should not be used for recommendation."
  );

  assert(
    candidateSet.areaPanelCapacityEstimateSummary.canConfirmPanelFit === false,
    "Area panel capacity estimate summary should not confirm panel fit."
  );

  console.log("  ✓ Draw-my-roof candidate set contract OK:", {
    candidates: candidateSet.candidates.length,
    roofConfidenceReadiness:
      candidateSet.roofDesignConfidenceSummary.readiness,
    areaCapacityReadiness:
      candidateSet.areaPanelCapacityEstimateSummary.readiness,
    areaEstimateAvailableCandidates:
      candidateSet.areaPanelCapacityEstimateSummary
        .areaEstimateAvailableCandidateCount,
  });
}

function runContractSafetyFlagsTest() {
  console.log("\n▶ Draw-my-roof diagnostic safety flags");

  const candidateSet = buildCandidateSetFromInputs({
    input: buildDrawMyRoofMvpInput(),
  });

  assert(
    candidateSet.roofGeometryInput.usedForCalculation === false,
    "roofGeometryInput should not be used for calculation."
  );

  assert(
    candidateSet.manualRoofPolygonModel.usedForCalculation === false,
    "manualRoofPolygonModel should not be used for calculation."
  );

  assert(
    candidateSet.roofDesignConfidenceSummary.usedForCalculation === false,
    "roofDesignConfidenceSummary should not be used for calculation."
  );

  assert(
    candidateSet.areaPanelCapacityEstimateSummary.usedForCalculation === false,
    "areaPanelCapacityEstimateSummary should not be used for calculation."
  );

  assert(
    candidateSet.roofGeometryInput.usedForRecommendation === false,
    "roofGeometryInput should not be used for recommendation."
  );

  assert(
    candidateSet.manualRoofPolygonModel.usedForRecommendation === false,
    "manualRoofPolygonModel should not be used for recommendation."
  );

  assert(
    candidateSet.roofDesignConfidenceSummary.usedForRecommendation === false,
    "roofDesignConfidenceSummary should not be used for recommendation."
  );

  assert(
    candidateSet.areaPanelCapacityEstimateSummary.usedForRecommendation === false,
    "areaPanelCapacityEstimateSummary should not be used for recommendation."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) =>
        candidate.roofGeometryAssumption.usedForRecommendation === false
    ),
    "candidate roofGeometryAssumption should not be used for recommendation."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) =>
        candidate.roofDesignConfidence.usedForRecommendation === false
    ),
    "candidate roofDesignConfidence should not be used for recommendation."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) =>
        candidate.areaPanelCapacityEstimate.usedForRecommendation === false
    ),
    "candidate areaPanelCapacityEstimate should not be used for recommendation."
  );

  console.log("  ✓ Draw-my-roof safety flags OK");
}

function main() {
  console.log("Running draw-my-roof contract tests");

  runRoofGeometryContractTest();
  runManualPolygonContractTest();
  runCandidateSetContractTest();
  runContractSafetyFlagsTest();

  console.log("\n✅ Draw-my-roof contract tests passed");
}

main();