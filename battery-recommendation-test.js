const {
  selectBalancedCandidate,
  buildBatteryRecommendations,
} = require("./services/modelling/batteryRecommendationService");

const {
  attachBatteryProductsToRecommendations,
} = require("./services/hardware/batteryProductMappingService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function candidate(batteryKWhUsable, paybackYears, lifetimeNetSavings) {
  return {
    batteryKWhUsable,
    paybackYears,
    lifetimeNetSavings,
    annualBenefit: 1000,
  };
}

function runClearMiddleGroundTest() {
  console.log("\n▶ Balanced recommendation: clear middle ground");

  const candidates = [
    candidate(5, 6.0, 18000),
    candidate(10, 6.4, 23000),
    candidate(15, 7.8, 25000),
  ];

  const balanced = selectBalancedCandidate(candidates);

  assert(balanced, "Expected a balanced recommendation.");
  assert(
    balanced.batteryKWhUsable === 10,
    `Expected 10 kWh, got ${balanced.batteryKWhUsable} kWh.`
  );

  console.log("  ✓ Balanced recommendation:", balanced.batteryKWhUsable, "kWh");
}

function runPaybackLeaningCurveTest() {
  console.log("\n▶ Balanced recommendation: payback-leaning curve");

  const candidates = [
    candidate(5, 6.0, 18000),
    candidate(7, 6.2, 19000),
    candidate(10, 7.5, 19500),
    candidate(15, 9.0, 20000),
  ];

  const balanced = selectBalancedCandidate(candidates);

  assert(balanced, "Expected a balanced recommendation.");
  assert(
    balanced.batteryKWhUsable === 7,
    `Expected 7 kWh, got ${balanced.batteryKWhUsable} kWh.`
  );

  console.log("  ✓ Balanced recommendation:", balanced.batteryKWhUsable, "kWh");
}

function runSameCandidateDominatesTest() {
  console.log("\n▶ Balanced recommendation: one candidate dominates");

  const candidates = [
    candidate(5, 7.0, 18000),
    candidate(10, 6.0, 24000),
    candidate(15, 8.0, 22000),
  ];

  const balanced = selectBalancedCandidate(candidates);

  assert(balanced, "Expected a balanced recommendation.");
  assert(
    balanced.batteryKWhUsable === 10,
    `Expected dominant 10 kWh candidate, got ${balanced.batteryKWhUsable} kWh.`
  );

  console.log("  ✓ Dominant recommendation:", balanced.batteryKWhUsable, "kWh");
}

function runInvalidCandidateTest() {
  console.log("\n▶ Balanced recommendation: invalid candidates ignored");

  const candidates = [
    candidate(5, null, 20000),
    candidate(7, 6.4, -1000),
    candidate(10, 6.8, 22000),
    candidate(15, 7.5, 25000),
  ];

  const balanced = selectBalancedCandidate(candidates);

  assert(balanced, "Expected a viable balanced recommendation.");
  assert(
    [10, 15].includes(balanced.batteryKWhUsable),
    `Expected invalid candidates to be ignored, got ${balanced.batteryKWhUsable} kWh.`
  );

  console.log("  ✓ Invalid candidates ignored.");
}

function runRecommendationContractTest() {
  console.log("\n▶ Battery recommendation contract");

  const curve = [
    {
      batteryKWhUsable: 0,
      candidateMidPrice: 6000,
      annualBenefit: 700,
      paybackYears: 8.6,
      lifetimeNetSavings: 12000,
      annualSelfUsedKWh: 1800,
      annualExportedKWh: 2200,
      annualImportedKWh: 3200,
    },
    {
      batteryKWhUsable: 5,
      candidateMidPrice: 8000,
      annualBenefit: 1100,
      paybackYears: 7.3,
      lifetimeNetSavings: 18000,
      annualSelfUsedKWh: 2500,
      annualExportedKWh: 1500,
      annualImportedKWh: 2500,
    },
    {
      batteryKWhUsable: 10,
      candidateMidPrice: 10000,
      annualBenefit: 1450,
      paybackYears: 6.9,
      lifetimeNetSavings: 23000,
      annualSelfUsedKWh: 3100,
      annualExportedKWh: 900,
      annualImportedKWh: 1900,
    },
    {
      batteryKWhUsable: 15,
      candidateMidPrice: 12500,
      annualBenefit: 1600,
      paybackYears: 7.8,
      lifetimeNetSavings: 25000,
      annualSelfUsedKWh: 3400,
      annualExportedKWh: 600,
      annualImportedKWh: 1600,
    },
  ];

  const recommendations = buildBatteryRecommendations({
    curve,
    batteryCostPerKWh: 500,
    minRecommendedBatteryKWh: 5,
    maxBatteryKWh: 15,
    stepKWh: 5,
    lifetimeYears: 25,
    selectedBatteryKWh: 10,
    panelOption: "value",
    energyInflationRate: 0.06,
    batteryDegradationRate: 0,
    minBatteryCapacityFraction: 1,
    batteryModelAssumptions: {},
  });

  assert(
    recommendations.bestPayback,
    "Expected bestPayback recommendation."
  );

  assert(
    recommendations.balanced,
    "Expected balanced recommendation."
  );

  assert(
    recommendations.bestLifetimeSavings,
    "Expected bestLifetimeSavings recommendation."
  );

  assert(
    Array.isArray(recommendations.curve) &&
      recommendations.curve.length === curve.length,
    "Expected full battery curve to remain available."
  );

  const mapped =
    attachBatteryProductsToRecommendations(recommendations);

  assert(
    mapped.balanced,
    "Expected balanced recommendation after product mapping."
  );

  assert(
    Object.prototype.hasOwnProperty.call(
      mapped.balanced,
      "batteryProduct"
    ),
    "Expected balanced recommendation to receive battery product metadata."
  );

  console.log(
    "  ✓ Contract includes fastest payback, balanced and max savings."
  );
}

function main() {
  console.log("Running battery recommendation tests");

  runClearMiddleGroundTest();
  runPaybackLeaningCurveTest();
  runSameCandidateDominatesTest();
  runInvalidCandidateTest();
  runRecommendationContractTest();

  console.log("\n✅ Battery recommendation tests passed");
}

main();
