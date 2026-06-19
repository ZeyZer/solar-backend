const {
  buildRoofGeometryInputModel,
  applyRoofGeometryAssumptionsToCandidates,
} = require("./services/roofGeometryInputService");

const {
  buildManualRoofPolygonModel,
} = require("./services/manualRoofPolygonModelService");

const {
  applyHardwareMetadataNormalisationToCandidates,
} = require("./services/hardwareMetadataNormalisationService");

const {
  applyRoofDesignConfidenceToCandidates,
} = require("./services/roofDesignConfidenceService");

const {
  applyAreaPanelCapacityEstimatesToCandidates,
  buildAreaPanelCapacityEstimateSummary,
} = require("./services/areaPanelCapacityEstimatorService");

const {
  buildCandidateSetFromInputs,
} = require("./services/designCandidateSetService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildCandidateWithDimensions() {
  return {
    candidateId: "panel-with-dimensions",
    products: {
      panel: {
        id: "panel-460",
        brand: "Test",
        model: "460 W Panel",
        wattage: 460,
        widthMm: 1134,
        heightMm: 1762,
        productWarrantyYears: 25,
        pricing: {
          materialCost: 120,
        },
      },
      inverter: {
        id: "inverter-5",
        brand: "Test",
        model: "5 kW Hybrid",
        inverterType: "hybrid",
        maxAcOutputKW: 5,
        maxPvInputKW: 7.5,
        pricing: {
          materialCost: 1000,
        },
      },
      battery: null,
    },
  };
}

function buildCandidateWithoutDimensions() {
  return {
    candidateId: "panel-without-dimensions",
    products: {
      panel: {
        id: "panel-500",
        brand: "Test",
        model: "500 W Panel",
        wattage: 500,
        productWarrantyYears: 25,
        pricing: {
          materialCost: 140,
        },
      },
      inverter: {
        id: "inverter-6",
        brand: "Test",
        model: "6 kW Hybrid",
        inverterType: "hybrid",
        maxAcOutputKW: 6,
        maxPvInputKW: 9,
        pricing: {
          materialCost: 1200,
        },
      },
      battery: null,
    },
  };
}

function prepareCandidatesWithInput(input, candidates) {
  const roofGeometryInput = buildRoofGeometryInputModel({
    input,
  });

  const manualRoofPolygonModel = buildManualRoofPolygonModel({
    roofGeometryInput,
  });

  const hardwareCandidates = applyHardwareMetadataNormalisationToCandidates({
    candidates,
  });

  const roofGeometryCandidates = applyRoofGeometryAssumptionsToCandidates({
    candidates: hardwareCandidates,
    roofGeometryInput,
  });

  const roofDesignConfidenceCandidates = applyRoofDesignConfidenceToCandidates({
    candidates: roofGeometryCandidates,
    roofGeometryInput,
    manualRoofPolygonModel,
  });

  const areaCandidates = applyAreaPanelCapacityEstimatesToCandidates({
    candidates: roofDesignConfidenceCandidates,
    roofGeometryInput,
  });

  return {
    roofGeometryInput,
    candidates: areaCandidates,
  };
}

function runPanelCountOnlyNoAreaEstimateTest() {
  console.log("\n▶ Panel-count-only input has no area-based estimate");

  const { candidates } = prepareCandidatesWithInput(
    {
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
    [buildCandidateWithDimensions()]
  );

  const estimate = candidates[0].areaPanelCapacityEstimate;

  assert(estimate, "Missing areaPanelCapacityEstimate.");
  assert(
    estimate.mode === "area_panel_capacity_estimate_beta",
    "Unexpected areaPanelCapacityEstimate mode."
  );

  assert(
    estimate.usedForCalculation === false,
    "Area estimate should not be used for calculation."
  );

  assert(
    estimate.usedForRecommendation === false,
    "Area estimate should not be used for recommendation."
  );

  assert(
    estimate.capacityEstimateAvailable === false,
    "Panel-count-only input should not have area-based estimate."
  );

  assert(
    estimate.summary.canConfirmLargerPanelFit === false,
    "Should not confirm larger panel fit."
  );

  console.log("  ✓ Panel-count-only no area estimate OK:", {
    status: estimate.estimateStatus,
    comparison:
      estimate.summary.comparisonToAssumedPanelCount.status,
  });
}

function runManualPolygonAreaEstimateTest() {
  console.log("\n▶ Manual polygon area-based capacity estimate");

  const { candidates } = prepareCandidatesWithInput(
    {
      roofGeometry: {
        source: "manual_roof_polygon",
        roofPlanes: [
          {
            id: "drawn-roof-1",
            orientation: "S",
            tilt: 40,
            shading: "none",
            areaM2: 24,
            panels: 10,
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
    [buildCandidateWithDimensions()]
  );

  const estimate = candidates[0].areaPanelCapacityEstimate;

  assert(
    estimate.capacityEstimateAvailable === true,
    "Expected area-based estimate to be available."
  );

  assert(
    estimate.panelAreaModel.panelAreaSource === "catalogue_panel_dimensions",
    "Expected catalogue panel dimensions."
  );

  assert(
    estimate.summary.totalEstimatedPanelCountRange.expected > 0,
    "Expected positive panel count estimate."
  );

  assert(
    estimate.summary.totalEstimatedSystemSizeKwpRange.expected > 0,
    "Expected positive kWp estimate."
  );

  assert(
    estimate.summary.canConfirmPanelFit === false,
    "Area estimate should not confirm panel fit."
  );

  console.log("  ✓ Manual polygon area estimate OK:", {
    expectedPanels:
      estimate.summary.totalEstimatedPanelCountRange.expected,
    expectedKwp:
      estimate.summary.totalEstimatedSystemSizeKwpRange.expected,
  });
}

function runWattageBasedPanelAreaAssumptionTest() {
  console.log("\n▶ Wattage-based panel area assumption");

  const { candidates } = prepareCandidatesWithInput(
    {
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
    [buildCandidateWithoutDimensions()]
  );

  const estimate = candidates[0].areaPanelCapacityEstimate;

  assert(
    estimate.capacityEstimateAvailable === true,
    "Expected area-based estimate to be available with wattage assumption."
  );

  assert(
    estimate.panelAreaModel.panelAreaSource ===
      "wattage_based_panel_area_assumption",
    "Expected wattage-based panel area assumption."
  );

  assert(
    estimate.summary.issueCount > 0,
    "Expected issue count for assumed panel area."
  );

  console.log("  ✓ Wattage-based panel area assumption OK:", {
    panelAreaSource: estimate.panelAreaModel.panelAreaSource,
    expectedPanels:
      estimate.summary.totalEstimatedPanelCountRange.expected,
  });
}

function runAreaPanelCapacitySummaryTest() {
  console.log("\n▶ Area panel capacity summary");

  const { candidates } = prepareCandidatesWithInput(
    {
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
    [buildCandidateWithDimensions(), buildCandidateWithoutDimensions()]
  );

  const summary = buildAreaPanelCapacityEstimateSummary({
    candidates,
  });

  assert(
    summary.mode === "area_panel_capacity_estimate_summary_beta",
    "Unexpected area panel capacity summary mode."
  );

  assert(summary.candidateCount === 2, "Expected two candidates.");
  assert(
    summary.areaEstimateAvailableCandidateCount === 2,
    "Expected two available area estimates."
  );

  assert(
    summary.usedForRecommendation === false,
    "Summary should not be used for recommendation."
  );

  assert(
    summary.canConfirmPanelFit === false,
    "Summary should not confirm panel fit."
  );

  assert(
    summary.readiness ===
      "ready_for_future_area_based_panel_capacity_estimation",
    `Unexpected readiness: ${summary.readiness}`
  );

  console.log("  ✓ Area panel capacity summary OK:", {
    readiness: summary.readiness,
    available: summary.areaEstimateAvailableCandidateCount,
  });
}

function runCandidateSetIncludesAreaPanelCapacityTest() {
  console.log("\n▶ Candidate set includes area panel capacity estimate");

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
    candidateSet.areaPanelCapacityEstimateSummary,
    "Candidate set missing areaPanelCapacityEstimateSummary."
  );

  assert(
    candidateSet.areaPanelCapacityEstimateSummary.mode ===
      "area_panel_capacity_estimate_summary_beta",
    "Unexpected areaPanelCapacityEstimateSummary mode."
  );

  assert(
    candidateSet.areaPanelCapacityEstimateSummary.usedForRecommendation === false,
    "areaPanelCapacityEstimateSummary should not be used for recommendation."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) => candidate.areaPanelCapacityEstimate
    ),
    "Every candidate should include areaPanelCapacityEstimate."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) =>
        candidate.areaPanelCapacityEstimate.usedForRecommendation === false
    ),
    "areaPanelCapacityEstimate should not be used for recommendation."
  );

  console.log("  ✓ Candidate set area panel capacity OK:", {
    readiness: candidateSet.areaPanelCapacityEstimateSummary.readiness,
  });
}

function main() {
  console.log("Running area panel capacity estimator tests");

  runPanelCountOnlyNoAreaEstimateTest();
  runManualPolygonAreaEstimateTest();
  runWattageBasedPanelAreaAssumptionTest();
  runAreaPanelCapacitySummaryTest();
  runCandidateSetIncludesAreaPanelCapacityTest();

  console.log("\n✅ Area panel capacity estimator tests passed");
}

main();