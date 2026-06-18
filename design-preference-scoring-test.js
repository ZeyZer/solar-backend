const {
  buildDesignPreferenceProfile,
} = require("./services/designPreferenceProfileService");

const {
  applyHardwareMetadataNormalisationToCandidates,
} = require("./services/hardwareMetadataNormalisationService");

const {
  applyDesignPreferenceScoringToCandidates,
  buildDesignPreferenceScoringSummary,
} = require("./services/designPreferenceScoringService");

const {
  buildCandidateSetFromInputs,
} = require("./services/designCandidateSetService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildPremiumCandidate() {
  return {
    candidateId: "premium-candidate",
    products: {
      panel: {
        id: "premium-panel",
        brand: "Test",
        model: "Premium All Black 460W",
        wattage: 460,
        productWarrantyYears: 25,
        allBlack: true,
        tags: ["all black", "premium"],
        pricing: {
          materialCost: 130,
        },
      },
      inverter: {
        id: "premium-hybrid-backup",
        brand: "Test",
        model: "Hybrid Backup Smart Inverter",
        inverterType: "hybrid",
        maxAcOutputKW: 6,
        maxPvInputKW: 9,
        mpptCount: 3,
        backupCompatible: true,
        batteryCompatible: true,
        monitoring: true,
        exportControlCompatible: true,
        pricing: {
          materialCost: 1500,
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
      mode: "candidate_hourly_financial_model_beta",
      systemCost: {
        estimatedInstalledCost: 14000,
      },
      payback: {
        simplePaybackYears: 8,
        lifetimeSavings: 35000,
      },
    },
  };
}

function buildBasicCandidate() {
  return {
    candidateId: "basic-candidate",
    products: {
      panel: {
        id: "basic-panel",
        brand: "Test",
        model: "Silver Frame 420W",
        wattage: 420,
        productWarrantyYears: 15,
        allBlack: false,
        pricing: {
          materialCost: 90,
        },
      },
      inverter: {
        id: "basic-string",
        brand: "Test",
        model: "Basic String Inverter",
        inverterType: "string",
        maxAcOutputKW: 5,
        maxPvInputKW: 7,
        mpptCount: 1,
        backupCompatible: false,
        batteryCompatible: false,
        monitoring: false,
        exportControlCompatible: false,
        pricing: {
          materialCost: 650,
        },
      },
      battery: null,
    },
    financialModel: {
      mode: "candidate_hourly_financial_model_beta",
      systemCost: {
        estimatedInstalledCost: 9500,
      },
      payback: {
        simplePaybackYears: 9,
        lifetimeSavings: 22000,
      },
    },
  };
}

function runPremiumPreferenceScoringTest() {
  console.log("\n▶ Premium preference scoring");

  const profile = buildDesignPreferenceProfile({
    input: {
      systemType: "premium_integrated",
      panelAesthetic: "all_black",
      preferenceWeights: {
        aesthetics: 1,
        warranty: 0.9,
        smartControls: 0.9,
        backup: 0.8,
        lowUpfrontCost: 0.1,
      },
    },
  });

  const hardwareCandidates = applyHardwareMetadataNormalisationToCandidates({
    candidates: [buildPremiumCandidate(), buildBasicCandidate()],
  });

  const scoredCandidates = applyDesignPreferenceScoringToCandidates({
    candidates: hardwareCandidates,
    designPreferenceProfile: profile,
  });

  const premium = scoredCandidates.find(
    (candidate) => candidate.candidateId === "premium-candidate"
  );
  const basic = scoredCandidates.find(
    (candidate) => candidate.candidateId === "basic-candidate"
  );

  assert(premium.designPreferenceScore, "Premium candidate missing score.");
  assert(basic.designPreferenceScore, "Basic candidate missing score.");

  assert(
    premium.designPreferenceScore.mode === "design_preference_soft_scoring_beta",
    "Unexpected score mode."
  );

  assert(
    premium.designPreferenceScore.usedForRecommendation === false,
    "Preference score should not be used for recommendation."
  );

  assert(
    premium.designPreferenceScore.appliedToRanking === false,
    "Preference score should not be applied to ranking yet."
  );

  assert(
    premium.designPreferenceScore.weightedScore >
      basic.designPreferenceScore.weightedScore,
    "Premium candidate should score above basic candidate for premium preferences."
  );

  console.log("  ✓ Premium scoring OK:", {
    premiumScore: premium.designPreferenceScore.weightedScore,
    basicScore: basic.designPreferenceScore.weightedScore,
  });
}

function runBudgetPreferenceScoringTest() {
  console.log("\n▶ Budget preference scoring");

  const profile = buildDesignPreferenceProfile({
    input: {
      systemType: "lowest_upfront_cost",
      preferenceWeights: {
        lowUpfrontCost: 1,
        aesthetics: 0.1,
        backup: 0.1,
        smartControls: 0.1,
      },
    },
  });

  const hardwareCandidates = applyHardwareMetadataNormalisationToCandidates({
    candidates: [buildPremiumCandidate(), buildBasicCandidate()],
  });

  const scoredCandidates = applyDesignPreferenceScoringToCandidates({
    candidates: hardwareCandidates,
    designPreferenceProfile: profile,
  });

  const premium = scoredCandidates.find(
    (candidate) => candidate.candidateId === "premium-candidate"
  );
  const basic = scoredCandidates.find(
    (candidate) => candidate.candidateId === "basic-candidate"
  );

  assert(
    basic.designPreferenceScore.componentScores.lowUpfrontCost >
      premium.designPreferenceScore.componentScores.lowUpfrontCost,
    "Basic candidate should have stronger low-upfront-cost component."
  );

  console.log("  ✓ Budget scoring OK:", {
    premiumCostScore:
      premium.designPreferenceScore.componentScores.lowUpfrontCost,
    basicCostScore:
      basic.designPreferenceScore.componentScores.lowUpfrontCost,
  });
}

function runPreferenceScoringSummaryTest() {
  console.log("\n▶ Preference scoring summary");

  const profile = buildDesignPreferenceProfile({
    input: {
      systemType: "premium_integrated",
      panelAesthetic: "all_black",
    },
  });

  const hardwareCandidates = applyHardwareMetadataNormalisationToCandidates({
    candidates: [buildPremiumCandidate(), buildBasicCandidate()],
  });

  const scoredCandidates = applyDesignPreferenceScoringToCandidates({
    candidates: hardwareCandidates,
    designPreferenceProfile: profile,
  });

  const summary = buildDesignPreferenceScoringSummary({
    candidates: scoredCandidates,
  });

  assert(
    summary.mode === "design_preference_soft_scoring_summary_beta",
    "Unexpected summary mode."
  );

  assert(summary.candidateCount === 2, "Expected two candidates.");
  assert(summary.scoredCandidateCount === 2, "Expected two scored candidates.");
  assert(summary.topPreferenceMatchCandidateId, "Expected top preference match.");
  assert(summary.usedForRecommendation === false, "Summary should not be used for recommendation.");

  console.log("  ✓ Preference scoring summary OK:", {
    topCandidate: summary.topPreferenceMatchCandidateId,
    averageScore: summary.averageScore,
  });
}

function runCandidateSetIncludesPreferenceScoringTest() {
  console.log("\n▶ Candidate set includes preference scoring");

  const candidateSet = buildCandidateSetFromInputs({
    input: {
      systemType: "premium_integrated",
      panelAesthetic: "all_black",
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
    candidateSet.designPreferenceScoringSummary,
    "Candidate set missing designPreferenceScoringSummary."
  );

  assert(
    candidateSet.designPreferenceScoringSummary.mode ===
      "design_preference_soft_scoring_summary_beta",
    "Unexpected candidate set preference scoring summary mode."
  );

  assert(
    candidateSet.candidates.every((candidate) => candidate.designPreferenceScore),
    "Every candidate should include designPreferenceScore."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) =>
        candidate.designPreferenceScore.usedForRecommendation === false
    ),
    "designPreferenceScore should not be used for recommendation."
  );

  console.log("  ✓ Candidate set preference scoring OK:", {
    candidates: candidateSet.designPreferenceScoringSummary.candidateCount,
    topCandidate:
      candidateSet.designPreferenceScoringSummary.topPreferenceMatchCandidateId,
  });
}

function main() {
  console.log("Running design preference scoring tests");

  runPremiumPreferenceScoringTest();
  runBudgetPreferenceScoringTest();
  runPreferenceScoringSummaryTest();
  runCandidateSetIncludesPreferenceScoringTest();

  console.log("\n✅ Design preference scoring tests passed");
}

main();