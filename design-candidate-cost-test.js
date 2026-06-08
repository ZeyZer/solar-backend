const {
  buildDesignCandidateFromInputs,
} = require("./services/designCandidateService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function runStandardCandidateCostTest() {
  console.log("\n▶ Standard candidate cost model");

  const candidate = buildDesignCandidateFromInputs({
    input: {
      panelOption: "value",
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

  assert(candidate.costModel, "Candidate missing costModel.");
  assert(candidate.costModel.mode === "candidate_cost_model_beta", "Unexpected cost model mode.");
  assert(candidate.costModel.usedForPricing === false, "Cost model should not be used for pricing.");
  assert(candidate.costModel.usedForCalculation === false, "Cost model should not be used for calculation.");
  assert(candidate.costModel.usedForRecommendation === false, "Cost model should not be used for recommendation.");

  assert(isNumber(candidate.costModel.estimatedHardwareAdder), "Missing estimatedHardwareAdder.");
  assert(isNumber(candidate.costModel.estimatedInstalledCost), "Missing estimatedInstalledCost.");
  assert(candidate.costModel.estimatedInstalledCost > 0, "Estimated installed cost should be positive.");

  assert(candidate.costModel.estimatedInstalledCostRange, "Missing cost range.");
  assert(candidate.costModel.estimatedInstalledCostRange.low > 0, "Cost range low should be positive.");
  assert(candidate.costModel.estimatedInstalledCostRange.high > candidate.costModel.estimatedInstalledCostRange.low, "Cost range high should exceed low.");

  assert(candidate.costModel.breakdown, "Missing cost breakdown.");
  assert(candidate.costModel.breakdown.products.panels > 0, "Panel product cost should be positive.");
  assert(candidate.costModel.breakdown.products.inverter > 0, "Inverter product cost should be positive.");
  assert(candidate.costModel.breakdown.products.battery > 0, "Battery product cost should be positive.");

  assert(candidate.costModel.breakdown.installation.mounting > 0, "Mounting cost should be positive.");
  assert(candidate.costModel.breakdown.installation.scaffolding > 0, "Scaffolding cost should be positive.");
  assert(candidate.costModel.breakdown.installation.electricalBos > 0, "Electrical BOS cost should be positive.");
  assert(candidate.costModel.breakdown.installation.labourAdjusted > 0, "Labour cost should be positive.");

  assert(candidate.costModel.confidence, "Missing cost confidence.");
  assert(candidate.costModel.confidence.level, "Missing cost confidence level.");

  console.log("  ✓ Standard candidate cost OK:", {
    estimatedInstalledCost: candidate.costModel.estimatedInstalledCost,
    range: candidate.costModel.estimatedInstalledCostRange,
    confidence: candidate.costModel.confidence.level,
  });
}

function runNoBatteryCandidateCostTest() {
  console.log("\n▶ No-battery candidate cost model");

  const candidate = buildDesignCandidateFromInputs({
    input: {
      panelOption: "premium",
      batteryKWh: 0,
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

  assert(candidate.products.battery === null, "Expected no battery product.");
  assert(candidate.costModel.breakdown.products.battery === 0, "Battery product cost should be 0.");
  assert(candidate.costModel.inputs.hasBattery === false, "Cost model should record no battery.");
  assert(candidate.costModel.estimatedInstalledCost > 0, "No-battery cost should still be positive.");

  console.log("  ✓ No-battery candidate cost OK:", {
    estimatedInstalledCost: candidate.costModel.estimatedInstalledCost,
  });
}

function runMultiRoofCandidateCostTest() {
  console.log("\n▶ Multi-roof candidate cost model");

  const singleRoof = buildDesignCandidateFromInputs({
    input: {
      panelOption: "value",
      batteryKWh: 5,
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 12,
        },
      ],
    },
  });

  const multiRoof = buildDesignCandidateFromInputs({
    input: {
      panelOption: "value",
      batteryKWh: 5,
      roofs: [
        {
          id: "roof-east",
          orientation: "E",
          tilt: 35,
          shading: "none",
          panels: 6,
        },
        {
          id: "roof-west",
          orientation: "W",
          tilt: 35,
          shading: "none",
          panels: 6,
        },
      ],
    },
  });

  assert(multiRoof.costModel.inputs.arrayCount === 2, "Expected two arrays.");
  assert(singleRoof.costModel.inputs.arrayCount === 1, "Expected one array.");

  assert(
    multiRoof.costModel.breakdown.installation.scaffolding >
      singleRoof.costModel.breakdown.installation.scaffolding,
    "Multi-roof scaffolding should exceed single-roof scaffolding."
  );

  console.log("  ✓ Multi-roof candidate cost OK:", {
    singleRoofScaffolding: singleRoof.costModel.breakdown.installation.scaffolding,
    multiRoofScaffolding: multiRoof.costModel.breakdown.installation.scaffolding,
  });
}

function main() {
  console.log("Running design candidate cost tests");

  runStandardCandidateCostTest();
  runNoBatteryCandidateCostTest();
  runMultiRoofCandidateCostTest();

  console.log("\n✅ Design candidate cost tests passed");
}

main();