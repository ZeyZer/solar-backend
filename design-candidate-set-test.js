const {
  buildCandidateSetFromInputs,
} = require("./services/designCandidateSetService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runStandardCandidateSetTest() {
  console.log("\n▶ Standard design candidate set");

  const candidateSet = buildCandidateSetFromInputs({
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

  assert(candidateSet.version, "Candidate set missing version.");
  assert(candidateSet.mode === "candidate_set_foundation", "Unexpected candidate set mode.");
  assert(candidateSet.usedForCalculation === false, "Candidate set should not be used for calculation.");
  assert(candidateSet.usedForPricing === false, "Candidate set should not be used for pricing.");
  assert(candidateSet.usedForRecommendation === false, "Candidate set should not be used for recommendation.");

  assert(candidateSet.productSearchSpace.panelCandidateCount > 0, "Expected panel candidates.");
  assert(candidateSet.productSearchSpace.inverterCandidateCount > 0, "Expected inverter candidates.");
  assert(candidateSet.productSearchSpace.batteryCandidateCount > 0, "Expected battery candidates.");
  assert(candidateSet.productSearchSpace.candidateCount > 0, "Expected generated candidates.");

  assert(Array.isArray(candidateSet.candidates), "Candidates should be an array.");
  assert(candidateSet.candidates.length === candidateSet.productSearchSpace.candidateCount, "Candidate count mismatch.");

  assert(candidateSet.shortlist, "Candidate set missing shortlist.");
  assert(candidateSet.shortlist.viabilitySummary, "Candidate shortlist missing viability summary.");
  assert(
    candidateSet.shortlist.viabilitySummary.total === candidateSet.candidates.length,
    "Candidate shortlist total should match candidate count."
  );
  assert(
    Array.isArray(candidateSet.shortlist.shortlistedCandidates),
    "Candidate shortlist should include shortlistedCandidates array."
  );
  assert(
    candidateSet.shortlist.usedForCalculation === false,
    "Candidate shortlist should not be used for calculation."
  );
  assert(
    candidateSet.shortlist.usedForRecommendation === false,
    "Candidate shortlist should not be used for recommendation."
  );

  assert(
    candidateSet.summary.total === candidateSet.productSearchSpace.candidateCount,
    "Candidate filtering summary count mismatch."
  );

  assert(
    candidateSet.summary.viable +
      candidateSet.summary.viable_with_warnings +
      candidateSet.summary.rejected >
      0,
    "Candidate filtering summary should include classified candidates."
  );

  assert(candidateSet.optimiserResults, "Candidate set missing optimiserResults.");
  assert(
    candidateSet.optimiserResults.mode === "candidate_ranking_selected_tariff_beta",
    "Unexpected optimiserResults mode."
  );
  assert(
    candidateSet.optimiserResults.usedForCalculation === false,
    "optimiserResults should not be used for calculation."
  );
  assert(
    candidateSet.optimiserResults.usedForRecommendation === false,
    "optimiserResults should not be used for recommendation."
  );
  assert(
    candidateSet.optimiserResults.counts.totalCandidates === candidateSet.candidates.length,
    "optimiserResults total candidate count mismatch."
  );

  assert(candidateSet.scenarioSet, "Candidate set missing scenarioSet.");
  assert(
    candidateSet.scenarioSet.mode === "candidate_scenario_set_selected_tariff_beta",
    "Unexpected scenarioSet mode."
  );
  assert(
    candidateSet.scenarioSet.usedForCalculation === false,
    "scenarioSet should not be used for calculation."
  );
  assert(
    candidateSet.scenarioSet.usedForRecommendation === false,
    "scenarioSet should not be used for recommendation."
  );
  assert(
    candidateSet.scenarioSet.summary.totalScenarios === candidateSet.candidates.length,
    "scenarioSet total scenario count mismatch."
  );

  for (const candidate of candidateSet.candidates) {
    assert(candidate.candidateId, "Candidate missing candidateId.");
    assert(candidate.products.panel, `${candidate.candidateId} missing panel product.`);
    assert(candidate.products.inverter, `${candidate.candidateId} missing inverter product.`);
    assert(candidate.products.battery, `${candidate.candidateId} missing battery product.`);
    assert(candidate.compatibility.summary.total > 0, `${candidate.candidateId} missing compatibility checks.`);

    assert(candidate.filtering, `${candidate.candidateId} missing filtering.`);
    assert(candidate.filtering.status, `${candidate.candidateId} missing filtering status.`);
    assert(
      candidate.filtering.usedForCalculation === false,
      `${candidate.candidateId} filtering should not be used for calculation.`
    );
    assert(
      candidate.filtering.usedForRecommendation === false,
      `${candidate.candidateId} filtering should not be used for recommendation.`
    );

    assert(candidate.systemTypeFits, `${candidate.candidateId} missing systemTypeFits.`);
    assert(candidate.systemTypeFits.budget, `${candidate.candidateId} missing budget fit.`);
    assert(candidate.systemTypeFits.balanced, `${candidate.candidateId} missing balanced fit.`);
    assert(candidate.selectedSystemTypeFit, `${candidate.candidateId} missing selectedSystemTypeFit.`);
    assert(candidate.bestFitSystemType, `${candidate.candidateId} missing bestFitSystemType.`);
    assert(
      candidate.selectedSystemTypeFit.usedForCalculation === false,
      `${candidate.candidateId} selectedSystemTypeFit should not be used for calculation.`
    );
    assert(
      candidate.selectedSystemTypeFit.usedForRecommendation === false,
      `${candidate.candidateId} selectedSystemTypeFit should not be used for recommendation.`
    );

    assert(candidate.candidateSetMetadata, `${candidate.candidateId} missing candidateSetMetadata.`);
    assert(
      candidate.candidateSetMetadata.usedForCalculation === false,
      `${candidate.candidateId} should not be used for calculation.`
    );
    assert(
      candidate.candidateSetMetadata.usedForRecommendation === false,
      `${candidate.candidateId} should not be used for recommendation.`
    );
  }

  console.log("  ✓ Standard candidate set OK:", {
    candidates: candidateSet.productSearchSpace.candidateCount,
    summary: candidateSet.summary,
  });
}

function runNoBatteryCandidateSetTest() {
  console.log("\n▶ No-battery design candidate set");

  const candidateSet = buildCandidateSetFromInputs({
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

  assert(candidateSet.productSearchSpace.candidateCount > 0, "Expected no-battery candidates.");
  assert(candidateSet.inputSummary.batteryKWh === 0, "Expected 0 kWh battery input.");
  assert(candidateSet.summary.total === candidateSet.productSearchSpace.candidateCount, "Candidate filtering summary count mismatch.");
  assert(
    candidateSet.summary.viable + candidateSet.summary.viable_with_warnings + candidateSet.summary.rejected > 0,
    "Candidate filtering summary should include classified candidates."
  );

  for (const candidate of candidateSet.candidates) {
    assert(candidate.products.panel, `${candidate.candidateId} missing panel product.`);
    assert(candidate.products.inverter, `${candidate.candidateId} missing inverter product.`);
    assert(candidate.products.battery === null, `${candidate.candidateId} should not include a battery product.`);
  }

  console.log("  ✓ No-battery candidate set OK:", {
    candidates: candidateSet.productSearchSpace.candidateCount,
  });
}

function runMultiRoofCandidateSetTest() {
  console.log("\n▶ Multi-roof design candidate set");

  const candidateSet = buildCandidateSetFromInputs({
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

  assert(candidateSet.inputSummary.roofArrayCount === 2, "Expected two roof arrays.");
  assert(candidateSet.productSearchSpace.candidateCount > 0, "Expected generated candidates.");

  const first = candidateSet.candidates[0];

  assert(first.panelLayout.arrays.length === 2, "Expected candidate with two panel arrays.");
  assert(first.stringPlan.strings.length === 2, "Expected candidate with two strings.");

  console.log("  ✓ Multi-roof candidate set OK:", {
    candidates: candidateSet.productSearchSpace.candidateCount,
    summary: candidateSet.summary,
  });
}

function main() {
  console.log("Running design candidate set tests");

  runStandardCandidateSetTest();
  runNoBatteryCandidateSetTest();
  runMultiRoofCandidateSetTest();

  console.log("\n✅ Design candidate set tests passed");
}

main();