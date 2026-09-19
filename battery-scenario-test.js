const {
  buildBatteryScenario,
} = require("./services/modelling/batteryScenarioService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function twelve(value) {
  return Array(12).fill(value);
}

function runScenarioContractTest() {
  console.log("\n▶ Battery scenario contract");

  const scenario = buildBatteryScenario({
    batteryKWhUsable: 10,

    candidateBaseQuote: {
      priceLow: 9000,
      priceHigh: 11000,
    },

    billing: {
      annualBaseline: 1800,
      annualAfterImportAndStanding: 850,
      annualExportCredit: 150,
      annualAfterNet: 700,

      monthlyBaseline: twelve(150),
      monthlyAfterImportAndStanding: twelve(70),
      monthlyExportCredit: twelve(12.5),
      monthlyAfterNet: twelve(57.5),
    },

    monthly: {
      generation: twelve(400),
      selfUsed: twelve(240),
      exported: twelve(160),
      imported: twelve(100),

      batteryCharge: twelve(100),
      batteryDischarge: twelve(90),

      batteryChargeFromPV: twelve(80),
      batteryChargeFromGrid: twelve(20),

      batteryDischargeFromPVToLoad: twelve(70),
      batteryDischargeFromGridToLoad: twelve(20),

      pvExportDirect: twelve(80),
    },

    monthlyLoadKWh: twelve(340),

    debugWinterDay: {
      label: "winter-test",
    },

    debugSummerDay: {
      label: "summer-test",
    },

    noBatteryAnnualBenefit: 700,
    annualSolarGenerationKWh: 4800,

    lifetimeYears: 25,
    panelOption: "value",
    energyInflationRate: 0.06,
    batteryDegradationRate: 0.02,
    minBatteryCapacityFraction: 0.7,
  });

  assert(scenario, "Expected battery scenario.");

  assert(
    scenario.batteryKWhUsable === 10,
    "Expected 10 kWh scenario."
  );

  assert(
    scenario.priceLow === 9000 &&
      scenario.priceHigh === 11000,
    "Expected candidate price range."
  );

  assert(
    scenario.annualBillSavings === 950,
    `Expected £950 bill saving, got ${scenario.annualBillSavings}.`
  );

  assert(
    scenario.annualSegIncome === 150,
    "Expected £150 export income."
  );

  assert(
    scenario.totalAnnualBenefit === 1100,
    `Expected £1100 annual benefit, got ${scenario.totalAnnualBenefit}.`
  );

  assert(
    scenario.financialSeries?.payback,
    "Expected payback series."
  );

  assert(
    Array.isArray(
      scenario.financialSeries.payback.yearly
    ) &&
      scenario.financialSeries.payback.yearly.length === 25,
    "Expected 25 yearly financial rows."
  );

  assert(
    scenario.hourlyModel?.monthlyImportedKWh?.length === 12,
    "Expected 12 monthly import values."
  );

  assert(
    scenario.hourlyModel?.monthlyBatteryChargeFromGridKWh?.length === 12,
    "Expected source-aware battery flow values."
  );

  assert(
    scenario.hourlyModel?.debugWinterDay?.label ===
      "winter-test",
    "Expected winter debug day."
  );

  console.log(
    "  ✓ Scenario includes pricing, savings, payback, monthly flows and chart data."
  );
}

function runMissingInputTest() {
  console.log("\n▶ Battery scenario missing input");

  const scenario = buildBatteryScenario({
    batteryKWhUsable: 10,
  });

  assert(
    scenario === null,
    "Expected incomplete scenario input to return null."
  );

  console.log("  ✓ Incomplete scenario rejected safely.");
}

function main() {
  console.log("Running battery scenario tests");

  runScenarioContractTest();
  runMissingInputTest();

  console.log("\n✅ Battery scenario tests passed");
}

main();
