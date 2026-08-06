const {
  buildRoofGeometryInputModel,
  buildCandidateRoofGeometryAssumption,
  applyRoofGeometryAssumptionsToCandidates,
  buildRoofGeometryInputSummary,
} = require("./services/roof/roofGeometryInputService");

const {
  applyHardwareMetadataNormalisationToCandidates,
} = require("./services/hardware/hardwareMetadataNormalisationService");

const {
  buildCandidateSetFromInputs,
} = require("./services/candidates/designCandidateSetService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildCandidate() {
  return {
    candidateId: "roof-geometry-candidate",
    products: {
      panel: {
        id: "panel-460",
        brand: "Test",
        model: "460 W Panel",
        wattage: 460,
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

function runPanelCountInputModelTest() {
  console.log("\n▶ Roof geometry input from current panel-count inputs");

  const roofGeometryInput = buildRoofGeometryInputModel({
    input: {
      roofs: [
        {
          id: "roof-south",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 10,
        },
        {
          id: "roof-west",
          orientation: "W",
          tilt: 35,
          shading: "some",
          panels: 4,
        },
      ],
    },
  });

  assert(roofGeometryInput, "Missing roof geometry input.");
  assert(
    roofGeometryInput.mode === "roof_geometry_input_model_beta",
    "Unexpected roof geometry input mode."
  );

  assert(
    roofGeometryInput.usedForCalculation === false,
    "Roof geometry input should not be used for calculation."
  );

  assert(
    roofGeometryInput.usedForRecommendation === false,
    "Roof geometry input should not be used for recommendation."
  );

  assert(
    roofGeometryInput.sourceStatus === "user_estimated_panel_count_only",
    "Expected user estimated panel count source status."
  );

  assert(
    roofGeometryInput.summary.roofPlaneCount === 2,
    "Expected two roof planes."
  );

  assert(
    roofGeometryInput.summary.totalAssumedPanelPositions === 14,
    "Expected 14 assumed panel positions."
  );

  assert(
    roofGeometryInput.summary.onlyPanelCountAssumptions === true,
    "Expected only panel count assumptions."
  );

  assert(
    roofGeometryInput.currentOptimiserInterpretation.canConfirmLargerPanelFit === false,
    "Should not confirm larger panel fit."
  );

  console.log("  ✓ Panel-count roof input OK:", {
    roofPlanes: roofGeometryInput.summary.roofPlaneCount,
    assumedPanels: roofGeometryInput.summary.totalAssumedPanelPositions,
    confidence: roofGeometryInput.summary.confidenceLevel,
  });
}

function runManualPolygonInputModelTest() {
  console.log("\n▶ Manual polygon roof geometry input");

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

  assert(
    roofGeometryInput.sourceStatus === "geometry_input_available",
    "Expected geometry input available."
  );

  assert(
    roofGeometryInput.summary.hasAreaGeometry === true,
    "Expected area geometry."
  );

  assert(
    roofGeometryInput.summary.manualPolygonReady === true,
    "Expected manual polygon readiness."
  );

  assert(
    roofGeometryInput.summary.onlyPanelCountAssumptions === false,
    "Manual polygon should not be panel count only."
  );

  console.log("  ✓ Manual polygon input OK:", {
    areaM2: roofGeometryInput.roofPlanes[0].geometry.areaM2,
    confidence: roofGeometryInput.summary.confidenceLevel,
  });
}

function runCandidateRoofAssumptionTest() {
  console.log("\n▶ Candidate roof geometry assumption");

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

  const candidate = applyHardwareMetadataNormalisationToCandidates({
    candidates: [buildCandidate()],
  })[0];

  const assumption = buildCandidateRoofGeometryAssumption({
    candidate,
    roofGeometryInput,
  });

  assert(
    assumption.mode === "candidate_roof_geometry_assumption_beta",
    "Unexpected candidate roof assumption mode."
  );

  assert(
    assumption.usedForCalculation === false,
    "Candidate roof assumption should not be used for calculation."
  );

  assert(
    assumption.summary.totalAssumedPanelPositions === 10,
    "Expected 10 assumed panel positions."
  );

  assert(
    assumption.summary.candidatePanelWattage === 460,
    "Expected 460 W candidate panel."
  );

  assert(
    assumption.summary.assumedSystemSizeKwp === 4.6,
    `Expected 4.6 kWp, got ${assumption.summary.assumedSystemSizeKwp}`
  );

  assert(
    assumption.summary.canConfirmLargerPanelFit === false,
    "Should not confirm larger panel fit."
  );

  console.log("  ✓ Candidate roof assumption OK:", {
    panelWattage: assumption.summary.candidatePanelWattage,
    assumedKwp: assumption.summary.assumedSystemSizeKwp,
  });
}

function runApplyAndSummaryTest() {
  console.log("\n▶ Apply roof geometry assumptions and summary");

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

  const candidates = applyHardwareMetadataNormalisationToCandidates({
    candidates: [buildCandidate()],
  });

  const roofCandidates = applyRoofGeometryAssumptionsToCandidates({
    candidates,
    roofGeometryInput,
  });

  assert(
    roofCandidates.every((candidate) => candidate.roofGeometryAssumption),
    "Every candidate should include roofGeometryAssumption."
  );

  const summary = buildRoofGeometryInputSummary({
    roofGeometryInput,
    candidates: roofCandidates,
  });

  assert(
    summary.mode === "roof_geometry_input_summary_beta",
    "Unexpected roof geometry summary mode."
  );

  assert(summary.candidateCount === 1, "Expected one candidate.");
  assert(summary.roofPlaneCount === 1, "Expected one roof plane.");
  assert(
    summary.readiness === "ready_for_assumed_panel_count_modelling_only",
    "Expected assumed panel count readiness."
  );

  console.log("  ✓ Apply and summary OK:", {
    readiness: summary.readiness,
    confidence: summary.confidenceLevel,
  });
}

function runCandidateSetIncludesRoofGeometryTest() {
  console.log("\n▶ Candidate set includes roof geometry input");

  const candidateSet = buildCandidateSetFromInputs({
    input: {
      systemType: "balanced",
      batteryKWh: 5,
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

  assert(candidateSet.roofGeometryInput, "Candidate set missing roofGeometryInput.");
  assert(
    candidateSet.roofGeometryInput.mode === "roof_geometry_input_model_beta",
    "Unexpected roofGeometryInput mode."
  );

  assert(
    candidateSet.roofGeometryInputSummary,
    "Candidate set missing roofGeometryInputSummary."
  );

  assert(
    candidateSet.roofGeometryInputSummary.mode === "roof_geometry_input_summary_beta",
    "Unexpected roofGeometryInputSummary mode."
  );

  assert(
    candidateSet.candidates.every((candidate) => candidate.roofGeometryAssumption),
    "Every candidate should include roofGeometryAssumption."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) =>
        candidate.roofGeometryAssumption.usedForRecommendation === false
    ),
    "roofGeometryAssumption should not be used for recommendation."
  );

  console.log("  ✓ Candidate set roof geometry OK:", {
    roofPlanes: candidateSet.roofGeometryInputSummary.roofPlaneCount,
    readiness: candidateSet.roofGeometryInputSummary.readiness,
  });
}

function main() {
  console.log("Running roof geometry input tests");

  runPanelCountInputModelTest();
  runManualPolygonInputModelTest();
  runCandidateRoofAssumptionTest();
  runApplyAndSummaryTest();
  runCandidateSetIncludesRoofGeometryTest();

  console.log("\n✅ Roof geometry input tests passed");
}

main();