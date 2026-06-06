const {
  buildDesignCandidateFromInputs,
} = require("./services/designCandidateService");

const {
  applyCandidateFiltering,
} = require("./services/designCandidateFilterService");

const {
  buildSystemTypeFits,
  attachSystemTypeFits,
  getBestFitSystemType,
} = require("./services/systemTypeFitService");

const {
  buildCandidateSetFromInputs,
} = require("./services/designCandidateSetService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function buildBaseCandidate() {
  return applyCandidateFiltering(
    buildDesignCandidateFromInputs({
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
    })
  );
}

function runAllProfileFitChecks() {
  console.log("\n▶ All-profile system type fit checks");

  const candidate = buildBaseCandidate();
  const fits = buildSystemTypeFits(candidate);

  const expectedProfiles = [
    "budget",
    "balanced",
    "premium_integrated",
    "backup_ready",
    "shaded_roof",
    "monitoring_focused",
    "warranty_focused",
    "export_control_focused",
    "aesthetics_focused",
  ];

  for (const profileId of expectedProfiles) {
    assert(fits[profileId], `Missing fit for ${profileId}.`);
    assert(fits[profileId].systemType === profileId, `Wrong system type for ${profileId}.`);
    assert(isNumber(fits[profileId].score), `${profileId} score should be numeric.`);
    assert(fits[profileId].usedForCalculation === false, `${profileId} should not be used for calculation.`);
    assert(fits[profileId].usedForRecommendation === false, `${profileId} should not be used for recommendation.`);
  }

  const bestFit = getBestFitSystemType(fits);

  assert(bestFit, "Missing best fit system type.");
  assert(bestFit.systemType, "Best fit missing systemType.");
  assert(isNumber(bestFit.score), "Best fit score should be numeric.");

  console.log("  ✓ All-profile fits OK:", {
    profileCount: Object.keys(fits).length,
    bestFit,
  });
}

function runAttachSystemTypeFitsCheck() {
  console.log("\n▶ Attach multi-profile fits to candidate");

  const candidate = attachSystemTypeFits(buildBaseCandidate(), "backup_ready");

  assert(candidate.systemTypeFits, "Candidate missing systemTypeFits.");
  assert(candidate.systemTypeFits.budget, "Candidate missing budget fit.");
  assert(candidate.systemTypeFits.balanced, "Candidate missing balanced fit.");
  assert(candidate.systemTypeFits.backup_ready, "Candidate missing backup_ready fit.");

  assert(candidate.selectedSystemTypeFit, "Candidate missing selectedSystemTypeFit.");
  assert(candidate.selectedSystemTypeFit.systemType === "backup_ready", "Expected selected fit to be backup_ready.");

  assert(candidate.bestFitSystemType, "Candidate missing bestFitSystemType.");
  assert(candidate.bestFitSystemType.systemType, "bestFitSystemType missing systemType.");
  assert(isNumber(candidate.bestFitSystemType.score), "bestFitSystemType score should be numeric.");

  console.log("  ✓ Attach multi-profile fits OK:", {
    selected: candidate.selectedSystemTypeFit.systemType,
    selectedScore: candidate.selectedSystemTypeFit.score,
    bestFit: candidate.bestFitSystemType,
  });
}

function runCandidateSetSystemTypeFitsCheck() {
  console.log("\n▶ Candidate set multi-profile fits");

  const candidateSet = buildCandidateSetFromInputs({
    input: {
      panelOption: "value",
      batteryKWh: 5,
      systemType: "premium_integrated",
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
    candidateSet.inputSummary.selectedSystemType === "premium_integrated",
    "Candidate set should preserve selected system type."
  );

  assert(candidateSet.candidates.length > 0, "Candidate set should have candidates.");

  for (const candidate of candidateSet.candidates) {
    assert(candidate.systemTypeFits, `${candidate.candidateId} missing systemTypeFits.`);
    assert(candidate.systemTypeFits.budget, `${candidate.candidateId} missing budget fit.`);
    assert(candidate.systemTypeFits.premium_integrated, `${candidate.candidateId} missing premium fit.`);

    assert(candidate.selectedSystemTypeFit, `${candidate.candidateId} missing selectedSystemTypeFit.`);
    assert(
      candidate.selectedSystemTypeFit.systemType === "premium_integrated",
      `${candidate.candidateId} wrong selected system type.`
    );

    assert(candidate.bestFitSystemType, `${candidate.candidateId} missing bestFitSystemType.`);

    assert(
      candidate.candidateSetMetadata.selectedSystemTypeFitScore === candidate.selectedSystemTypeFit.score,
      `${candidate.candidateId} metadata selected score mismatch.`
    );

    assert(
      candidate.candidateSetMetadata.bestFitSystemTypeScore === candidate.bestFitSystemType.score,
      `${candidate.candidateId} metadata best fit score mismatch.`
    );
  }

  console.log("  ✓ Candidate set multi-profile fits OK:", {
    candidates: candidateSet.candidates.length,
    selectedSystemType: candidateSet.inputSummary.selectedSystemType,
  });
}

function main() {
  console.log("Running system type fit tests");

  runAllProfileFitChecks();
  runAttachSystemTypeFitsCheck();
  runCandidateSetSystemTypeFitsCheck();

  console.log("\n✅ System type fit tests passed");
}

main();