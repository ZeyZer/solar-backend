const {
  buildDesignPreferenceProfile,
} = require("./services/designPreferenceProfileService");

const {
  applyHardwareMetadataNormalisationToCandidates,
} = require("./services/hardwareMetadataNormalisationService");

const {
  applyDesignPreferenceConstraintEvaluations,
} = require("./services/designPreferenceConstraintEvaluationService");

const {
  applyDesignPreferenceScoringToCandidates,
} = require("./services/designPreferenceScoringService");

const {
  applyDiagnosticPruningPreviewToCandidates,
  buildDiagnosticPruningPreviewSummary,
} = require("./services/diagnosticCandidatePruningPreviewService");

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
    candidateId: "premium-carry-forward",
    compatibilityStatus: "viable",
    products: {
      panel: {
        id: "premium-panel",
        brand: "Test",
        model: "Premium All Black 460W",
        wattage: 460,
        productWarrantyYears: 25,
        allBlack: true,
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

function buildFailingCandidate() {
  return {
    candidateId: "failing-hard-constraints",
    compatibilityStatus: "viable",
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

function buildUnknownCandidate() {
  return {
    candidateId: "unknown-catalogue-data",
    compatibilityStatus: "viable",
    products: {
      panel: {
        id: "unknown-panel",
        brand: "Test",
        model: "Unknown 430W",
        wattage: 430,
      },
      inverter: {
        id: "unknown-inverter",
        brand: "Test",
        model: "Unknown Inverter",
        maxAcOutputKW: 5,
      },
      battery: {
        id: "unknown-battery",
        brand: "Test",
        model: "Unknown Battery",
      },
    },
    financialModel: {
      mode: "candidate_hourly_financial_model_beta",
      systemCost: {
        estimatedInstalledCost: 13000,
      },
      payback: {
        simplePaybackYears: 10,
        lifetimeSavings: 18000,
      },
    },
  };
}

function prepareCandidates() {
  const profile = buildDesignPreferenceProfile({
    input: {
      systemType: "premium_integrated",
      panelAesthetic: "all_black",
      requireAllBlackPanels: true,
      minPanelWarrantyYears: 25,
      backupRequired: true,
      batteryRequired: true,
      minBatteryKWh: 9,
      maxBudget: 15000,
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
    candidates: [
      buildPremiumCandidate(),
      buildFailingCandidate(),
      buildUnknownCandidate(),
    ],
  });

  const preferenceEvaluatedCandidates =
    applyDesignPreferenceConstraintEvaluations({
      candidates: hardwareCandidates,
      designPreferenceProfile: profile,
    });

  const preferenceScoredCandidates =
    applyDesignPreferenceScoringToCandidates({
      candidates: preferenceEvaluatedCandidates,
      designPreferenceProfile: profile,
    });

  return {
    profile,
    candidates: preferenceScoredCandidates,
  };
}

function runCandidatePruningPreviewTest() {
  console.log("\n▶ Candidate pruning preview");

  const { candidates } = prepareCandidates();

  const previewedCandidates = applyDiagnosticPruningPreviewToCandidates({
    candidates,
  });

  assert(previewedCandidates.length === 3, "Expected three previewed candidates.");

  assert(
    previewedCandidates.every((candidate) => candidate.diagnosticPruningPreview),
    "Every candidate should include diagnosticPruningPreview."
  );

  assert(
    previewedCandidates.every(
      (candidate) =>
        candidate.diagnosticPruningPreview.mode ===
        "diagnostic_candidate_pruning_preview_beta"
    ),
    "Unexpected diagnosticPruningPreview mode."
  );

  assert(
    previewedCandidates.every(
      (candidate) =>
        candidate.diagnosticPruningPreview.usedForRecommendation === false
    ),
    "Pruning preview should not be used for recommendation."
  );

  const premium = previewedCandidates.find(
    (candidate) => candidate.candidateId === "premium-carry-forward"
  );

  const failing = previewedCandidates.find(
    (candidate) => candidate.candidateId === "failing-hard-constraints"
  );

  const unknown = previewedCandidates.find(
    (candidate) => candidate.candidateId === "unknown-catalogue-data"
  );

  assert(
    premium.diagnosticPruningPreview.wouldCarryForwardForFutureOptimisation === true,
    "Premium candidate should be carried forward."
  );

  assert(
    failing.diagnosticPruningPreview.wouldCarryForwardForFutureOptimisation === false,
    "Failing candidate should not be carried forward if constraints are enforced."
  );

  assert(
    unknown.diagnosticPruningPreview.provisionalTier ===
      "needs_catalogue_data_before_pruning",
    "Unknown candidate should need catalogue data before pruning."
  );

  console.log("  ✓ Candidate pruning preview OK:", {
    premiumTier: premium.diagnosticPruningPreview.provisionalTier,
    failingTier: failing.diagnosticPruningPreview.provisionalTier,
    unknownTier: unknown.diagnosticPruningPreview.provisionalTier,
  });
}

function runPruningPreviewSummaryTest() {
  console.log("\n▶ Candidate pruning preview summary");

  const { candidates } = prepareCandidates();

  const previewedCandidates = applyDiagnosticPruningPreviewToCandidates({
    candidates,
  });

  const summary = buildDiagnosticPruningPreviewSummary({
    candidates: previewedCandidates,
    recommendedCarryForwardLimit: 2,
  });

  assert(
    summary.mode === "diagnostic_candidate_pruning_preview_summary_beta",
    "Unexpected pruning preview summary mode."
  );

  assert(summary.candidateCount === 3, "Expected three candidates.");
  assert(summary.previewedCandidateCount === 3, "Expected three previewed candidates.");
  assert(summary.usedForRecommendation === false, "Summary should not be used for recommendation.");
  assert(summary.appliedToFiltering === false, "Summary should not be applied to filtering.");
  assert(summary.appliedToRanking === false, "Summary should not be applied to ranking.");

  assert(
    summary.wouldNotCarryForwardCandidateIds.includes("failing-hard-constraints"),
    "Expected failing candidate in would-not-carry-forward list."
  );

  assert(
    summary.needsCatalogueDataCandidateIds.includes("unknown-catalogue-data"),
    "Expected unknown candidate in needs-catalogue-data list."
  );

  console.log("  ✓ Pruning preview summary OK:", {
    readiness: summary.readiness,
    recommendedCarryForward: summary.recommendedCarryForwardCandidateIds,
  });
}

function runCandidateSetIncludesPruningPreviewTest() {
  console.log("\n▶ Candidate set includes pruning preview");

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
    candidateSet.diagnosticPruningPreviewSummary,
    "Candidate set missing diagnosticPruningPreviewSummary."
  );

  assert(
    candidateSet.diagnosticPruningPreviewSummary.mode ===
      "diagnostic_candidate_pruning_preview_summary_beta",
    "Unexpected candidate set pruning preview summary mode."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) => candidate.diagnosticPruningPreview
    ),
    "Every candidate should include diagnosticPruningPreview."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) =>
        candidate.diagnosticPruningPreview.usedForRecommendation === false
    ),
    "diagnosticPruningPreview should not be used for recommendation."
  );

  console.log("  ✓ Candidate set pruning preview OK:", {
    candidates: candidateSet.diagnosticPruningPreviewSummary.candidateCount,
    readiness: candidateSet.diagnosticPruningPreviewSummary.readiness,
  });
}

function main() {
  console.log("Running diagnostic candidate pruning preview tests");

  runCandidatePruningPreviewTest();
  runPruningPreviewSummaryTest();
  runCandidateSetIncludesPruningPreviewTest();

  console.log("\n✅ Diagnostic candidate pruning preview tests passed");
}

main();