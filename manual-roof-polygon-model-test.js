const {
  buildRoofGeometryInputModel,
} = require("./services/roof/roofGeometryInputService");

const {
  buildManualRoofPolygonModel,
  validateManualPolygonPlane,
} = require("./services/roof/manualRoofPolygonModelService");

const {
  buildCandidateSetFromInputs,
} = require("./services/candidates/designCandidateSetService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runNoManualPolygonTest() {
  console.log("\n▶ No manual roof polygon model");

  const roofGeometryInput = buildRoofGeometryInputModel({
    input: {
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 10,
        },
      ],
    },
  });

  const model = buildManualRoofPolygonModel({
    roofGeometryInput,
  });

  assert(model, "Missing manual roof polygon model.");
  assert(
    model.mode === "manual_roof_polygon_model_beta",
    "Unexpected manual roof polygon model mode."
  );
  assert(model.usedForCalculation === false, "Model should not be used for calculation.");
  assert(model.usedForRecommendation === false, "Model should not be used for recommendation.");
  assert(model.summary.polygonCount === 0, "Expected no manual polygons.");
  assert(
    model.summary.readiness === "manual_polygons_not_provided",
    "Expected no manual polygons readiness."
  );

  console.log("  ✓ No manual polygon OK:", {
    readiness: model.summary.readiness,
  });
}

function runValidManualPolygonTest() {
  console.log("\n▶ Valid manual roof polygon model");

  const roofGeometryInput = buildRoofGeometryInputModel({
    input: {
      roofGeometry: {
        source: "manual_roof_polygon",
        roofPlanes: [
          {
            id: "drawn-roof-1",
            orientation: "S",
            tilt: 40,
            shading: "none",
            areaM2: 24,
            coordinates: [
              [-0.1, 51.5],
              [-0.0999, 51.5],
              [-0.0999, 51.5001],
              [-0.1, 51.5001],
            ],
          },
        ],
      },
    },
  });

  const model = buildManualRoofPolygonModel({
    roofGeometryInput,
  });

  assert(model.summary.polygonCount === 1, "Expected one polygon.");
  assert(model.summary.validPolygonCount === 1, "Expected one valid polygon.");
  assert(model.summary.invalidPolygonCount === 0, "Expected no invalid polygons.");
  assert(
    model.summary.readiness ===
      "manual_polygons_ready_for_future_area_estimation",
    `Unexpected readiness: ${model.summary.readiness}`
  );
  assert(
    model.summary.canSupportFutureAreaBasedPanelEstimate === true,
    "Expected future area-based estimate support."
  );
  assert(
    model.summary.canConfirmPanelFit === false,
    "Manual polygon model should not confirm panel fit."
  );

  console.log("  ✓ Valid manual polygon OK:", {
    readiness: model.summary.readiness,
    totalAreaM2: model.summary.totalAreaM2,
  });
}

function runManualPolygonNeedsReviewTest() {
  console.log("\n▶ Manual roof polygon needs review");

  const roofGeometryInput = buildRoofGeometryInputModel({
    input: {
      roofGeometry: {
        source: "manual_roof_polygon",
        roofPlanes: [
          {
            id: "drawn-roof-review",
            shading: "some",
            areaM2: 20,
            coordinates: [
              [-0.1, 51.5],
              [-0.0999, 51.5],
              [-0.0999, 51.5001],
            ],
          },
        ],
      },
    },
  });

  const model = buildManualRoofPolygonModel({
    roofGeometryInput,
  });

  assert(model.summary.polygonCount === 1, "Expected one polygon.");
  assert(model.summary.reviewPolygonCount === 1, "Expected one review polygon.");
  assert(
    model.summary.readiness === "manual_polygons_ready_but_need_review",
    `Unexpected readiness: ${model.summary.readiness}`
  );

  const polygon = model.polygons[0];

  assert(
    polygon.validation.issues.some((issue) => issue.code === "missing_orientation"),
    "Expected missing orientation issue."
  );

  assert(
    polygon.validation.issues.some((issue) => issue.code === "missing_tilt"),
    "Expected missing tilt issue."
  );

  console.log("  ✓ Manual polygon review OK:", {
    readiness: model.summary.readiness,
    issues: polygon.validation.issues.map((issue) => issue.code),
  });
}

function runInvalidManualPolygonTest() {
  console.log("\n▶ Invalid manual roof polygon");

  const validation = validateManualPolygonPlane({
    roofId: "invalid-roof",
    source: "manual_roof_polygon",
    geometryType: "polygon",
    orientation: "S",
    tilt: 40,
    shading: "none",
    geometry: {
      coordinates: [
        {
          lng: -0.1,
          lat: 51.5,
        },
        {
          lng: -0.0999,
          lat: 51.5,
        },
      ],
    },
  });

  assert(
    validation.validationStatus === "invalid_needs_fix",
    "Expected invalid polygon status."
  );

  assert(
    validation.issues.some((issue) => issue.code === "insufficient_coordinates"),
    "Expected insufficient coordinates issue."
  );

  console.log("  ✓ Invalid manual polygon OK:", {
    status: validation.validationStatus,
    issues: validation.issues.map((issue) => issue.code),
  });
}

function runCandidateSetIncludesManualPolygonModelTest() {
  console.log("\n▶ Candidate set includes manual roof polygon model");

  const candidateSet = buildCandidateSetFromInputs({
    input: {
      systemType: "balanced",
      batteryKWh: 5,
      roofGeometry: {
        source: "manual_roof_polygon",
        roofPlanes: [
          {
            id: "drawn-roof-1",
            orientation: "S",
            tilt: 40,
            shading: "none",
            areaM2: 24,
            coordinates: [
              [-0.1, 51.5],
              [-0.0999, 51.5],
              [-0.0999, 51.5001],
              [-0.1, 51.5001],
            ],
          },
        ],
      },
    },
  });

  assert(
    candidateSet.manualRoofPolygonModel,
    "Candidate set missing manualRoofPolygonModel."
  );

  assert(
    candidateSet.manualRoofPolygonModel.mode ===
      "manual_roof_polygon_model_beta",
    "Unexpected manualRoofPolygonModel mode."
  );

  assert(
    candidateSet.manualRoofPolygonModel.usedForRecommendation === false,
    "manualRoofPolygonModel should not be used for recommendation."
  );

  assert(
    candidateSet.manualRoofPolygonModel.summary.polygonCount === 1,
    "Expected one manual polygon in candidate set."
  );

  console.log("  ✓ Candidate set manual polygon model OK:", {
    readiness: candidateSet.manualRoofPolygonModel.summary.readiness,
  });
}

function main() {
  console.log("Running manual roof polygon model tests");

  runNoManualPolygonTest();
  runValidManualPolygonTest();
  runManualPolygonNeedsReviewTest();
  runInvalidManualPolygonTest();
  runCandidateSetIncludesManualPolygonModelTest();

  console.log("\n✅ Manual roof polygon model tests passed");
}

main();