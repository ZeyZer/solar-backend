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
  buildRoofDesignConfidenceSummary,
} = require("./services/roofDesignConfidenceService");

const {
  buildCandidateSetFromInputs,
} = require("./services/designCandidateSetService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildCandidate() {
  return {
    candidateId: "roof-confidence-candidate",
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

function prepareCandidateWithRoofInput(input) {
  const roofGeometryInput = buildRoofGeometryInputModel({
    input,
  });

  const manualRoofPolygonModel = buildManualRoofPolygonModel({
    roofGeometryInput,
  });

  const hardwareCandidates = applyHardwareMetadataNormalisationToCandidates({
    candidates: [buildCandidate()],
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

  return {
    roofGeometryInput,
    manualRoofPolygonModel,
    candidates: roofDesignConfidenceCandidates,
  };
}

function runPanelCountConfidenceTest() {
  console.log("\n▶ Roof design confidence from panel-count input");

  const { candidates } = prepareCandidateWithRoofInput({
    roofs: [
      {
        id: "roof-1",
        orientation: "S",
        tilt: 40,
        shading: "none",
        panels: 10,
      },
    ],
  });

  const confidence = candidates[0].roofDesignConfidence;

  assert(confidence, "Missing roofDesignConfidence.");
  assert(
    confidence.mode === "roof_design_confidence_beta",
    "Unexpected roofDesignConfidence mode."
  );

  assert(
    confidence.usedForCalculation === false,
    "roofDesignConfidence should not be used for calculation."
  );

  assert(
    confidence.usedForRecommendation === false,
    "roofDesignConfidence should not be used for recommendation."
  );

  assert(
    confidence.confidenceCategory === "user_estimated_panel_count",
    `Expected user panel count category, got ${confidence.confidenceCategory}`
  );

  assert(
    confidence.confidenceLevel === "low",
    "Expected low confidence for panel-count-only input."
  );

  assert(
    confidence.optimiserCapabilities.canConfirmLargerPanelFit === false,
    "Should not confirm larger panel fit."
  );

  assert(
    confidence.warnings.some(
      (warning) => warning.code === "user_estimated_panel_count_only"
    ),
    "Expected user panel count warning."
  );

  console.log("  ✓ Panel-count confidence OK:", {
    category: confidence.confidenceCategory,
    confidence: confidence.confidenceLabel,
  });
}

function runManualPolygonConfidenceTest() {
  console.log("\n▶ Roof design confidence from manual polygon");

  const { candidates } = prepareCandidateWithRoofInput({
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
  });

  const confidence = candidates[0].roofDesignConfidence;

  assert(
    confidence.confidenceCategory === "manual_polygon_ready",
    `Expected manual polygon ready category, got ${confidence.confidenceCategory}`
  );

  assert(
    confidence.confidenceLevel === "medium",
    "Expected medium confidence for manual polygon."
  );

  assert(
    confidence.optimiserCapabilities.canUseForFutureAreaBasedEstimate === true,
    "Expected future area-based estimate support."
  );

  assert(
    confidence.optimiserCapabilities.canConfirmMorePanelsFit === false,
    "Should not confirm more panels fit."
  );

  console.log("  ✓ Manual polygon confidence OK:", {
    category: confidence.confidenceCategory,
    confidence: confidence.confidenceLabel,
  });
}

function runRoofDesignConfidenceSummaryTest() {
  console.log("\n▶ Roof design confidence summary");

  const { candidates } = prepareCandidateWithRoofInput({
    roofs: [
      {
        id: "roof-1",
        orientation: "S",
        tilt: 40,
        shading: "none",
        panels: 10,
      },
    ],
  });

  const summary = buildRoofDesignConfidenceSummary({
    candidates,
  });

  assert(
    summary.mode === "roof_design_confidence_summary_beta",
    "Unexpected roof design confidence summary mode."
  );

  assert(summary.candidateCount === 1, "Expected one candidate.");
  assert(summary.reportedCandidateCount === 1, "Expected one confidence report.");
  assert(summary.usedForRecommendation === false, "Summary should not be used for recommendation.");
  assert(
    summary.readiness === "ready_for_panel_count_assumption_messaging",
    `Unexpected readiness: ${summary.readiness}`
  );

  assert(
    summary.globalCustomerSafeMessage.includes("assumed panel"),
    "Expected global customer-safe panel-count message."
  );

  console.log("  ✓ Roof design confidence summary OK:", {
    readiness: summary.readiness,
    averageConfidence: summary.averageConfidenceLabel,
  });
}

function runCandidateSetIncludesRoofDesignConfidenceTest() {
  console.log("\n▶ Candidate set includes roof design confidence");

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

  assert(
    candidateSet.roofDesignConfidenceSummary,
    "Candidate set missing roofDesignConfidenceSummary."
  );

  assert(
    candidateSet.roofDesignConfidenceSummary.mode ===
      "roof_design_confidence_summary_beta",
    "Unexpected roofDesignConfidenceSummary mode."
  );

  assert(
    candidateSet.roofDesignConfidenceSummary.usedForRecommendation === false,
    "roofDesignConfidenceSummary should not be used for recommendation."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) => candidate.roofDesignConfidence
    ),
    "Every candidate should include roofDesignConfidence."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) =>
        candidate.roofDesignConfidence.usedForRecommendation === false
    ),
    "roofDesignConfidence should not be used for recommendation."
  );

  console.log("  ✓ Candidate set roof design confidence OK:", {
    readiness: candidateSet.roofDesignConfidenceSummary.readiness,
    confidence: candidateSet.roofDesignConfidenceSummary.averageConfidenceLabel,
  });
}

function main() {
  console.log("Running roof design confidence tests");

  runPanelCountConfidenceTest();
  runManualPolygonConfidenceTest();
  runRoofDesignConfidenceSummaryTest();
  runCandidateSetIncludesRoofDesignConfidenceTest();

  console.log("\n✅ Roof design confidence tests passed");
}

main();