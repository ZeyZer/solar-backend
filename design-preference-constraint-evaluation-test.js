const {
  buildDesignPreferenceProfile,
} = require("./services/preferences/designPreferenceProfileService");

const {
  evaluateDesignPreferenceConstraintsForCandidate,
  applyDesignPreferenceConstraintEvaluations,
} = require("./services/preferences/designPreferenceConstraintEvaluationService");

const {
  buildCandidateSetFromInputs,
} = require("./services/candidates/designCandidateSetService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildPassingCandidate() {
  return {
    candidateId: "passing-candidate",
    products: {
      panel: {
        id: "panel-black-25",
        name: "Premium All Black 440W",
        allBlack: true,
        warrantyYears: 25,
      },
      inverter: {
        id: "hybrid-backup-inverter",
        name: "Hybrid Backup Inverter",
        hybrid: true,
        backupCapable: true,
        warrantyYears: 10,
      },
      battery: {
        id: "battery-10",
        usableCapacityKWh: 10,
      },
    },
    financialModel: {
      systemCost: {
        estimatedInstalledCost: 12000,
      },
    },
  };
}

function buildFailingCandidate() {
  return {
    candidateId: "failing-candidate",
    products: {
      panel: {
        id: "panel-silver-15",
        name: "Silver Frame 420W",
        allBlack: false,
        warrantyYears: 15,
      },
      inverter: {
        id: "string-inverter",
        name: "Standard String Inverter",
        hybrid: false,
        backupCapable: false,
        warrantyYears: 5,
      },
      battery: null,
    },
    financialModel: {
      systemCost: {
        estimatedInstalledCost: 16000,
      },
    },
  };
}

function runPassingCandidateTest() {
  console.log("\n▶ Passing candidate hard-constraint evaluation");

  const profile = buildDesignPreferenceProfile({
    input: {
      requireAllBlackPanels: true,
      minPanelWarrantyYears: 25,
      backupRequired: true,
      hybridRequired: true,
      batteryRequired: true,
      minBatteryKWh: 9,
      maxBudget: 14000,
    },
  });

  const evaluation = evaluateDesignPreferenceConstraintsForCandidate({
    candidate: buildPassingCandidate(),
    designPreferenceProfile: profile,
  });

  assert(evaluation, "Missing evaluation.");
  assert(
    evaluation.mode === "design_preference_constraint_evaluation_beta",
    "Unexpected evaluation mode."
  );
  assert(evaluation.usedForCalculation === false, "Evaluation should not be used for calculation.");
  assert(evaluation.usedForPricing === false, "Evaluation should not be used for pricing.");
  assert(evaluation.usedForRecommendation === false, "Evaluation should not be used for recommendation.");
  assert(evaluation.appliedToFiltering === false, "Evaluation should not be applied to filtering.");
  assert(evaluation.appliedToRanking === false, "Evaluation should not be applied to ranking.");

  assert(
    evaluation.summary.hardConstraintStatus === "passes_all_hard_constraints",
    `Expected pass status, got ${evaluation.summary.hardConstraintStatus}`
  );

  assert(
    evaluation.summary.failedHardConstraints === 0,
    "Passing candidate should have no failed hard constraints."
  );

  console.log("  ✓ Passing candidate OK:", {
    status: evaluation.summary.hardConstraintStatus,
    passed: evaluation.summary.passedHardConstraints,
  });
}

function runFailingCandidateTest() {
  console.log("\n▶ Failing candidate hard-constraint evaluation");

  const profile = buildDesignPreferenceProfile({
    input: {
      requireAllBlackPanels: true,
      minPanelWarrantyYears: 25,
      backupRequired: true,
      hybridRequired: true,
      batteryRequired: true,
      minBatteryKWh: 9,
      maxBudget: 14000,
    },
  });

  const evaluation = evaluateDesignPreferenceConstraintsForCandidate({
    candidate: buildFailingCandidate(),
    designPreferenceProfile: profile,
  });

  assert(
    evaluation.summary.hardConstraintStatus === "fails_hard_constraints",
    `Expected fail status, got ${evaluation.summary.hardConstraintStatus}`
  );

  assert(
    evaluation.summary.failedHardConstraints > 0,
    "Failing candidate should have failed hard constraints."
  );

  assert(
    evaluation.summary.failedConstraintIds.includes("panel_all_black_required"),
    "Expected all-black panel failure."
  );

  assert(
    evaluation.summary.failedConstraintIds.includes("backup_capability_required"),
    "Expected backup failure."
  );

  assert(
    evaluation.summary.failedConstraintIds.includes("battery_required"),
    "Expected battery required failure."
  );

  console.log("  ✓ Failing candidate OK:", {
    status: evaluation.summary.hardConstraintStatus,
    failed: evaluation.summary.failedConstraintIds,
  });
}

function runNoHardConstraintsTest() {
  console.log("\n▶ No hard constraints evaluation");

  const profile = buildDesignPreferenceProfile({
    input: {},
  });

  const evaluation = evaluateDesignPreferenceConstraintsForCandidate({
    candidate: buildPassingCandidate(),
    designPreferenceProfile: profile,
  });

  assert(
    evaluation.summary.hardConstraintStatus === "no_hard_constraints",
    "Expected no hard constraints status."
  );

  assert(
    evaluation.summary.hardConstraintCount === 0,
    "Expected zero hard constraints."
  );

  console.log("  ✓ No hard constraints OK");
}

function runApplyToCandidateListTest() {
  console.log("\n▶ Apply hard-constraint evaluations to candidate list");

  const profile = buildDesignPreferenceProfile({
    input: {
      requireAllBlackPanels: true,
      batteryRequired: true,
    },
  });

  const candidates = applyDesignPreferenceConstraintEvaluations({
    candidates: [buildPassingCandidate(), buildFailingCandidate()],
    designPreferenceProfile: profile,
  });

  assert(candidates.length === 2, "Expected two candidates.");
  assert(
    candidates.every((candidate) => candidate.preferenceConstraintEvaluation),
    "Expected every candidate to have preferenceConstraintEvaluation."
  );

  assert(
    candidates[0].preferenceConstraintEvaluation.summary.hardConstraintStatus !== null,
    "Expected first candidate status."
  );

  console.log("  ✓ Candidate list evaluation OK:", {
    statuses: candidates.map(
      (candidate) =>
        candidate.preferenceConstraintEvaluation.summary.hardConstraintStatus
    ),
  });
}

function runCandidateSetIncludesEvaluationTest() {
  console.log("\n▶ Candidate set includes hard-constraint evaluations");

  const candidateSet = buildCandidateSetFromInputs({
    input: {
      systemType: "backup_ready",
      backupRequired: true,
      batteryRequired: true,
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

  assert(Array.isArray(candidateSet.candidates), "Candidate set candidates should be an array.");
  assert(candidateSet.candidates.length > 0, "Expected candidates.");

  assert(
    candidateSet.candidates.every(
      (candidate) => candidate.preferenceConstraintEvaluation
    ),
    "Every candidate should include preferenceConstraintEvaluation."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) =>
        candidate.preferenceConstraintEvaluation.usedForRecommendation === false
    ),
    "Preference constraint evaluations should not be used for recommendations."
  );

  console.log("  ✓ Candidate set evaluation OK:", {
    candidates: candidateSet.candidates.length,
    firstStatus:
      candidateSet.candidates[0].preferenceConstraintEvaluation.summary
        .hardConstraintStatus,
  });
}

function main() {
  console.log("Running design preference constraint evaluation tests");

  runPassingCandidateTest();
  runFailingCandidateTest();
  runNoHardConstraintsTest();
  runApplyToCandidateListTest();
  runCandidateSetIncludesEvaluationTest();

  console.log("\n✅ Design preference constraint evaluation tests passed");
}

main();