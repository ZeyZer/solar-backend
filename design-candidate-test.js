const {
  buildDesignCandidateFromInputs,
} = require("./services/designCandidateService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runStandardCandidateTest() {
  console.log("\n▶ Standard design candidate schema");

  const candidate = buildDesignCandidateFromInputs({
    input: {
      panelOption: "value",
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "standard",
        allowGridCharging: false,
        exportFromBatteryEnabled: true,
      },
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

  assert(candidate.version, "Candidate missing version.");
  assert(candidate.mode === "candidate_schema_foundation", "Unexpected candidate mode.");
  assert(candidate.usedForCalculation === false, "Candidate should not be used for calculation.");
  assert(candidate.usedForPricing === false, "Candidate should not be used for pricing.");
  assert(candidate.usedForRecommendation === false, "Candidate should not be used for recommendation.");

  assert(candidate.products.panel, "Candidate missing panel product.");
  assert(candidate.products.inverter, "Candidate missing inverter product.");
  assert(candidate.products.battery, "Candidate missing battery product.");

  assert(candidate.panelLayout, "Candidate missing panelLayout.");
  assert(candidate.panelLayout.totalPanels === 10, "Expected 10 panels in layout.");
  assert(candidate.panelLayout.arrays.length === 1, "Expected one roof array.");

  assert(candidate.stringPlan, "Candidate missing stringPlan.");
  assert(candidate.stringPlan.strings.length === 1, "Expected one string.");
  assert(candidate.stringPlan.strings[0].panelsInSeries === 10, "Expected 10 panels in series.");

  assert(candidate.compatibility, "Candidate missing compatibility.");
  assert(candidate.compatibility.summary.total > 0, "Compatibility checks should not be empty.");

  assert(candidate.costModel, "Candidate missing costModel.");
  assert(candidate.costModel.mode === "candidate_cost_model_beta", "Unexpected candidate cost model mode.");
  assert(candidate.costModel.estimatedInstalledCost > 0, "Candidate cost model should include estimatedInstalledCost.");
  assert(candidate.costModel.usedForPricing === false, "Candidate cost model should not be used for pricing.");
  assert(candidate.costModel.usedForPricing === false, "Cost model should not be used for pricing.");


  //PERFORMANCE MODEL
  assert(candidate.performanceModel, "Candidate missing performanceModel.");

  assert(
    candidate.performanceModel.mode === "candidate_pvgis_performance_model_beta",
    "Unexpected candidate performance model mode."
  );

  assert(
    candidate.performanceModel.usedForCalculation === false,
    "Candidate performance model should not be used for calculation."
  );

  assert(
    candidate.performanceModel.usedForRecommendation === false,
    "Candidate performance model should not be used for recommendation."
  );

  assert(
    candidate.performanceModel.generation,
    "Candidate performance model should include generation section."
  );

  assert(
    candidate.performanceModel.pvgis,
    "Candidate performance model should include PVGIS metadata."
  );

  assert(candidate.dispatchModel, "Candidate missing dispatchModel.");
  assert(
    candidate.dispatchModel.usedForCalculation === false,
    "Candidate dispatch model should not be used for calculation."
  );
  assert(
    candidate.dispatchModel.usedForRecommendation === false,
    "Candidate dispatch model should not be used for recommendation."
  );
  
  //FINANCIAL MODEL
  assert(candidate.financialModel, "Candidate missing financialModel.");
  assert(
    candidate.financialModel.usedForCalculation === false,
    "Candidate financial model should not be used for calculation."
  );
  assert(
    candidate.financialModel.usedForPricing === false,
    "Candidate financial model should not be used for pricing."
  );
  assert(
    candidate.financialModel.usedForRecommendation === false,
    "Candidate financial model should not be used for recommendation."
  );
  assert(
    candidate.financialModel.annual,
    "Candidate financial model should include annual section."
  );

  assert(candidate.scoring.usedForRecommendation === false, "Scoring should not be active yet.");

  console.log("  ✓ Standard candidate OK:", {
    candidateId: candidate.candidateId,
    panel: candidate.products.panel.id,
    inverter: candidate.products.inverter.id,
    battery: candidate.products.battery.id,
    checks: candidate.compatibility.summary.total,
  });
}

function runNoBatteryCandidateTest() {
  console.log("\n▶ No-battery design candidate schema");

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

  assert(candidate.products.panel, "Candidate missing panel product.");
  assert(candidate.products.inverter, "Candidate missing inverter product.");
  assert(candidate.products.battery === null, "No-battery candidate should not include battery product.");
  assert(candidate.inputs.requestedBatteryKWh === 0, "Requested battery should be 0.");
  assert(candidate.stringPlan.strings.length === 1, "Expected one string.");

  console.log("  ✓ No-battery candidate OK:", {
    candidateId: candidate.candidateId,
    panel: candidate.products.panel.id,
    inverter: candidate.products.inverter.id,
  });
}

function runMultiRoofCandidateTest() {
  console.log("\n▶ Multi-roof design candidate schema");

  const candidate = buildDesignCandidateFromInputs({
    input: {
      panelOption: "value",
      batteryKWh: 10,
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

  assert(candidate.panelLayout.totalPanels === 12, "Expected 12 panels.");
  assert(candidate.panelLayout.arrays.length === 2, "Expected two roof arrays.");
  assert(candidate.stringPlan.strings.length === 2, "Expected two strings.");
  assert(candidate.products.battery, "Expected battery product.");
  assert(candidate.compatibility.summary.total > 0, "Expected compatibility checks.");

  console.log("  ✓ Multi-roof candidate OK:", {
    candidateId: candidate.candidateId,
    arrays: candidate.panelLayout.arrays.length,
    strings: candidate.stringPlan.strings.length,
    checks: candidate.compatibility.summary.total,
  });
}

function main() {
  console.log("Running design candidate tests");

  runStandardCandidateTest();
  runNoBatteryCandidateTest();
  runMultiRoofCandidateTest();

  console.log("\n✅ Design candidate tests passed");
}

main();