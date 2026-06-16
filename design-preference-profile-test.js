const {
  buildDesignPreferenceProfile,
  buildPriorityWeights,
  buildHardConstraints,
  buildSoftPreferences,
} = require("./services/designPreferenceProfileService");

const {
  buildCandidateSetFromInputs,
} = require("./services/designCandidateSetService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runDefaultProfileTest() {
  console.log("\n▶ Default design preference profile");

  const profile = buildDesignPreferenceProfile({
    input: {},
    quote: {
      systemSizeKwp: 4.3,
      hourlyModel: {
        _batteryKWh: 5,
      },
    },
  });

  assert(profile, "Missing preference profile.");
  assert(profile.mode === "design_preference_profile_beta", "Unexpected profile mode.");
  assert(profile.usedForCalculation === false, "Profile should not be used for calculation.");
  assert(profile.usedForPricing === false, "Profile should not be used for pricing.");
  assert(profile.usedForRecommendation === false, "Profile should not be used for recommendation.");

  assert(profile.selectedSystemType === "balanced", "Default system type should be balanced.");
  assert(profile.hardConstraints.constraints.length === 0, "Default profile should not create hard constraints.");
  assert(profile.softPreferences.rankedPriorities.length > 0, "Expected ranked priorities.");

  console.log("  ✓ Default profile OK:", {
    readiness: profile.readiness,
    primaryGoal: profile.designIntent.primaryOptimisationGoal,
  });
}

function runHardConstraintProfileTest() {
  console.log("\n▶ Hard constraint preference profile");

  const profile = buildDesignPreferenceProfile({
    input: {
      systemType: "premium_integrated",
      requireAllBlackPanels: true,
      minPanelWarrantyYears: 25,
      backupRequired: true,
      hybridRequired: true,
      batteryRequired: true,
      minBatteryKWh: 9,
      maxBudget: 14000,
    },
  });

  const constraints = profile.hardConstraints.constraints;

  assert(profile.selectedSystemType === "premium_integrated", "Expected premium integrated system type.");
  assert(profile.readiness === "profile_ready_with_hard_constraints", "Expected hard constraint readiness.");

  assert(
    constraints.some((constraint) => constraint.constraintId === "panel_all_black_required"),
    "Expected all-black panel constraint."
  );

  assert(
    constraints.some((constraint) => constraint.constraintId === "panel_min_warranty"),
    "Expected panel warranty constraint."
  );

  assert(
    constraints.some((constraint) => constraint.constraintId === "backup_capability_required"),
    "Expected backup constraint."
  );

  assert(
    constraints.some((constraint) => constraint.constraintId === "battery_required"),
    "Expected battery required constraint."
  );

  assert(
    constraints.some((constraint) => constraint.constraintId === "maximum_budget"),
    "Expected maximum budget constraint."
  );

  console.log("  ✓ Hard constraints OK:", {
    constraints: constraints.map((constraint) => constraint.constraintId),
  });
}

function runSoftPreferenceWeightsTest() {
  console.log("\n▶ Soft preference weights");

  const balancedWeights = buildPriorityWeights({}, "balanced");
  const backupWeights = buildPriorityWeights({}, "backup_ready");
  const overriddenWeights = buildPriorityWeights(
    {
      preferenceWeights: {
        aesthetics: 1,
        lowUpfrontCost: 0.1,
      },
    },
    "balanced"
  );

  assert(balancedWeights.payback > 0, "Expected balanced payback weight.");
  assert(backupWeights.backup === 1, "Backup-ready preset should prioritise backup.");
  assert(overriddenWeights.aesthetics === 1, "Expected aesthetics override.");
  assert(overriddenWeights.lowUpfrontCost === 0.1, "Expected low upfront cost override.");

  const soft = buildSoftPreferences(
    {
      preferenceWeights: {
        aesthetics: 1,
        warranty: 0.8,
      },
      panelAesthetic: "all_black",
      inverterSmartness: "advanced",
    },
    "premium"
  );

  assert(soft.rankedPriorities[0].priorityId === "aesthetics", "Expected aesthetics to be top priority.");
  assert(soft.preferenceSignals.panelAesthetic === "all_black", "Expected panel aesthetic signal.");
  assert(soft.preferenceSignals.inverterSmartness === "advanced", "Expected smartness signal.");

  console.log("  ✓ Soft preferences OK:", {
    topPriority: soft.rankedPriorities[0],
  });
}

function runHardConstraintHelperTest() {
  console.log("\n▶ Hard constraint helper");

  const hard = buildHardConstraints({
    blackPanelsOnly: true,
    minInverterWarrantyYears: 10,
    batteryRequired: true,
  });

  assert(hard.panel.requireAllBlack === true, "Expected all-black panel preference.");
  assert(hard.inverter.minWarrantyYears === 10, "Expected inverter warranty.");
  assert(hard.battery.batteryRequired === true, "Expected battery required.");
  assert(hard.constraints.length === 3, "Expected three hard constraints.");

  console.log("  ✓ Hard constraint helper OK:", {
    constraintCount: hard.constraints.length,
  });
}

function runCandidateSetIncludesProfileTest() {
  console.log("\n▶ Candidate set includes preference profile");

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

  assert(candidateSet.designPreferenceProfile, "Candidate set missing designPreferenceProfile.");
  assert(
    candidateSet.designPreferenceProfile.mode === "design_preference_profile_beta",
    "Unexpected designPreferenceProfile mode."
  );
  assert(
    candidateSet.designPreferenceProfile.selectedSystemType === "backup_ready",
    "Expected backup-ready profile."
  );
  assert(
    candidateSet.designPreferenceProfile.hardConstraints.constraints.some(
      (constraint) => constraint.constraintId === "backup_capability_required"
    ),
    "Expected backup hard constraint in candidate set profile."
  );

  console.log("  ✓ Candidate set profile OK:", {
    systemType: candidateSet.designPreferenceProfile.selectedSystemType,
    readiness: candidateSet.designPreferenceProfile.readiness,
  });
}

function main() {
  console.log("Running design preference profile tests");

  runDefaultProfileTest();
  runHardConstraintProfileTest();
  runSoftPreferenceWeightsTest();
  runHardConstraintHelperTest();
  runCandidateSetIncludesProfileTest();

  console.log("\n✅ Design preference profile tests passed");
}

main();