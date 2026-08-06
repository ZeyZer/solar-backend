const {
  buildDesignPreferenceProfile,
} = require("./services/preferences/designPreferenceProfileService");

const {
  applyHardwareMetadataNormalisationToCandidates,
} = require("./services/hardware/hardwareMetadataNormalisationService");

const {
  applyDesignPreferenceConstraintEvaluations,
} = require("./services/preferences/designPreferenceConstraintEvaluationService");

const {
  buildPreferenceConstraintEnforcementReadiness,
} = require("./services/preferences/designPreferenceConstraintEnforcementReadinessService");

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
        brand: "Test",
        model: "Premium All Black 440W",
        allBlack: true,
        wattage: 440,
        productWarrantyYears: 25,
        pricing: {
          materialCost: 110,
        },
      },
      inverter: {
        id: "hybrid-backup-inverter",
        brand: "Test",
        model: "Hybrid Backup Inverter",
        inverterType: "hybrid",
        maxAcOutputKW: 5,
        maxPvInputKW: 7.5,
        backupCompatible: true,
        pricing: {
          materialCost: 1200,
        },
      },
      battery: {
        id: "battery-10",
        brand: "Test",
        model: "10 kWh Battery",
        usableCapacityKWh: 10,
        maxChargeKW: 5,
        maxDischargeKW: 5,
        warrantyYears: 10,
        pricing: {
          materialCost: 3000,
        },
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
        brand: "Test",
        model: "Silver Frame 420W",
        allBlack: false,
        wattage: 420,
        productWarrantyYears: 15,
        pricing: {
          materialCost: 90,
        },
      },
      inverter: {
        id: "string-inverter",
        brand: "Test",
        model: "Standard String Inverter",
        inverterType: "string",
        maxAcOutputKW: 5,
        maxPvInputKW: 7,
        backupCompatible: false,
        pricing: {
          materialCost: 700,
        },
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

function buildUnknownCandidate() {
  return {
    candidateId: "unknown-candidate",
    products: {
      panel: {
        id: "panel-unknown",
        brand: "Test",
        model: "Unknown 430W",
        wattage: 430,
      },
      inverter: {
        id: "inverter-unknown",
        brand: "Test",
        model: "Unknown Inverter",
        maxAcOutputKW: 5,
      },
      battery: {
        id: "battery-unknown",
        brand: "Test",
        model: "Unknown Battery",
      },
    },
    financialModel: {
      systemCost: {
        estimatedInstalledCost: 13000,
      },
    },
  };
}

function prepareCandidates({ profile }) {
  const hardwareCandidates = applyHardwareMetadataNormalisationToCandidates({
    candidates: [
      buildPassingCandidate(),
      buildFailingCandidate(),
      buildUnknownCandidate(),
    ],
  });

  return applyDesignPreferenceConstraintEvaluations({
    candidates: hardwareCandidates,
    designPreferenceProfile: profile,
  });
}

function runMixedReadinessTest() {
  console.log("\n▶ Mixed hard-constraint enforcement readiness");

  const profile = buildDesignPreferenceProfile({
    input: {
      requireAllBlackPanels: true,
      minPanelWarrantyYears: 25,
      backupRequired: true,
      batteryRequired: true,
      minBatteryKWh: 9,
      maxBudget: 14000,
    },
  });

  const candidates = prepareCandidates({ profile });

  const readiness = buildPreferenceConstraintEnforcementReadiness({
    candidates,
    designPreferenceProfile: profile,
  });

  assert(readiness, "Missing readiness report.");
  assert(
    readiness.mode ===
      "design_preference_constraint_enforcement_readiness_beta",
    "Unexpected readiness mode."
  );

  assert(readiness.usedForCalculation === false, "Readiness should not be used for calculation.");
  assert(readiness.usedForPricing === false, "Readiness should not be used for pricing.");
  assert(readiness.usedForRecommendation === false, "Readiness should not be used for recommendation.");
  assert(readiness.appliedToFiltering === false, "Readiness should not be applied to filtering.");
  assert(readiness.appliedToRanking === false, "Readiness should not be applied to ranking.");

  assert(
    readiness.summary.hardConstraintCount > 0,
    "Expected hard constraints."
  );

  assert(
    readiness.summary.candidatesWithKnownFailures > 0,
    "Expected known failing candidates."
  );

  assert(
    readiness.summary.candidatesWithUnknowns > 0,
    "Expected candidates with unknown metadata."
  );

  assert(
    readiness.summary.wouldRejectCandidateIds.includes("failing-candidate"),
    "Expected failing candidate in rejection preview."
  );

  assert(
    readiness.summary.unknownCandidateIds.includes("unknown-candidate"),
    "Expected unknown candidate in unknown preview."
  );

  console.log("  ✓ Mixed readiness OK:", {
    readiness: readiness.summary.enforcementReadiness,
    wouldReject: readiness.summary.wouldRejectCandidateIds,
    unknown: readiness.summary.unknownCandidateIds,
  });
}

function runNoConstraintsReadinessTest() {
  console.log("\n▶ No hard constraints readiness");

  const profile = buildDesignPreferenceProfile({
    input: {},
  });

  const candidates = prepareCandidates({ profile });

  const readiness = buildPreferenceConstraintEnforcementReadiness({
    candidates,
    designPreferenceProfile: profile,
  });

  assert(
    readiness.summary.enforcementReadiness ===
      "no_hard_constraints_to_enforce",
    "Expected no hard constraints readiness."
  );

  assert(
    readiness.constraintSummaries.length === 0,
    "Expected no constraint summaries."
  );

  console.log("  ✓ No constraints readiness OK");
}

function runCandidateSetIncludesReadinessTest() {
  console.log("\n▶ Candidate set includes enforcement readiness");

  const candidateSet = buildCandidateSetFromInputs({
    input: {
      systemType: "backup_ready",
      backupRequired: true,
      batteryRequired: true,
      minBatteryKWh: 5,
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
    candidateSet.preferenceConstraintEnforcementReadiness,
    "Candidate set missing preferenceConstraintEnforcementReadiness."
  );

  assert(
    candidateSet.preferenceConstraintEnforcementReadiness.mode ===
      "design_preference_constraint_enforcement_readiness_beta",
    "Unexpected preferenceConstraintEnforcementReadiness mode."
  );

  assert(
    candidateSet.preferenceConstraintEnforcementReadiness.usedForRecommendation === false,
    "Readiness should not be used for recommendation."
  );

  console.log("  ✓ Candidate set readiness OK:", {
    readiness:
      candidateSet.preferenceConstraintEnforcementReadiness.summary
        .enforcementReadiness,
  });
}

function main() {
  console.log("Running design preference constraint enforcement readiness tests");

  runMixedReadinessTest();
  runNoConstraintsReadinessTest();
  runCandidateSetIncludesReadinessTest();

  console.log("\n✅ Design preference constraint enforcement readiness tests passed");
}

main();