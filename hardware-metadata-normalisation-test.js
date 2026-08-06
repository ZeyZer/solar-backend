const {
  listActivePanels,
  listActiveInverters,
  listActiveBatteries,
} = require("./services/hardware/hardwareCatalogService");

const {
  normalisePanelMetadata,
  normaliseInverterMetadata,
  normaliseBatteryMetadata,
  buildCandidateHardwareMetadataNormalisation,
  applyHardwareMetadataNormalisationToCandidates,
  buildHardwareMetadataNormalisationSummary,
} = require("./services/hardware/hardwareMetadataNormalisationService");

const {
  buildDesignPreferenceProfile,
} = require("./services/preferences/designPreferenceProfileService");

const {
  evaluateDesignPreferenceConstraintsForCandidate,
} = require("./services/preferences/designPreferenceConstraintEvaluationService");

const {
  buildCandidateSetFromInputs,
} = require("./services/candidates/designCandidateSetService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runPanelNormalisationTest() {
  console.log("\n▶ Panel metadata normalisation");

  const panel = {
    id: "panel-test",
    brand: "Test",
    model: "All Black 460 W",
    category: "panel",
    wattage: 460,
    productWarrantyYears: 25,
    performanceWarrantyYears: 30,
    allBlack: true,
    pricing: {
      currency: "GBP",
      materialCost: 120,
      estimatedInstalledAdder: 180,
    },
  };

  const metadata = normalisePanelMetadata(panel);

  assert(metadata.exists === true, "Panel should exist.");
  assert(metadata.power.wattage === 460, "Expected panel wattage.");
  assert(metadata.warranties.productYears === 25, "Expected panel warranty.");
  assert(metadata.aesthetics.allBlack === true, "Expected all-black metadata.");
  assert(metadata.dataQuality.completenessScore > 0, "Expected data quality score.");

  console.log("  ✓ Panel metadata OK:", {
    wattage: metadata.power.wattage,
    warranty: metadata.warranties.productYears,
    allBlack: metadata.aesthetics.allBlack,
  });
}

function runInverterNormalisationTest() {
  console.log("\n▶ Inverter metadata normalisation");

  const inverter = {
    id: "inverter-test",
    brand: "Test",
    model: "10 kW Hybrid Backup Inverter",
    category: "inverter",
    inverterType: "hybrid",
    phase: "single_phase",
    maxAcOutputKW: 10,
    maxPvInputKW: 15,
    backupCompatible: true,
    batteryCompatible: true,
    pricing: {
      currency: "GBP",
      materialCost: 1600,
      estimatedInstalledAdder: 2200,
    },
  };

  const metadata = normaliseInverterMetadata(inverter);

  assert(metadata.exists === true, "Inverter should exist.");
  assert(metadata.classification.inverterType === "hybrid", "Expected hybrid type.");
  assert(metadata.capabilities.hybrid === true, "Expected hybrid capability.");
  assert(metadata.capabilities.backupCompatible === true, "Expected backup capability.");
  assert(metadata.power.maxAcOutputKW === 10, "Expected AC output.");
  assert(metadata.power.maxPvInputKW === 15, "Expected PV input.");

  console.log("  ✓ Inverter metadata OK:", {
    type: metadata.classification.inverterType,
    hybrid: metadata.capabilities.hybrid,
    backup: metadata.capabilities.backupCompatible,
  });
}

function runBatteryNormalisationTest() {
  console.log("\n▶ Battery metadata normalisation");

  const battery = {
    id: "battery-test",
    brand: "Test",
    model: "10 kWh Battery",
    category: "battery",
    usableCapacityKWh: 10,
    nominalCapacityKWh: 10.6,
    maxChargeKW: 5,
    maxDischargeKW: 6,
    warrantyYears: 10,
    pricing: {
      currency: "GBP",
      materialCost: 2800,
      estimatedInstalledAdder: 3300,
    },
  };

  const metadata = normaliseBatteryMetadata(battery);

  assert(metadata.exists === true, "Battery should exist.");
  assert(metadata.capacity.usableKWh === 10, "Expected usable capacity.");
  assert(metadata.power.maxChargeKW === 5, "Expected max charge power.");
  assert(metadata.power.maxDischargeKW === 6, "Expected max discharge power.");
  assert(metadata.warranties.productYears === 10, "Expected warranty.");

  console.log("  ✓ Battery metadata OK:", {
    usableKWh: metadata.capacity.usableKWh,
    chargeKW: metadata.power.maxChargeKW,
    dischargeKW: metadata.power.maxDischargeKW,
  });
}

function runCatalogueNormalisationTest() {
  console.log("\n▶ Current hardware catalogue metadata normalisation");

  const panel = normalisePanelMetadata(listActivePanels()[0]);
  const inverter = normaliseInverterMetadata(listActiveInverters()[0]);
  const battery = normaliseBatteryMetadata(listActiveBatteries()[0]);

  assert(panel.exists === true, "Expected active panel metadata.");
  assert(inverter.exists === true, "Expected active inverter metadata.");
  assert(battery.exists === true, "Expected active battery metadata.");

  assert(panel.power.wattage > 0, "Expected catalogue panel wattage.");
  assert(inverter.power.maxAcOutputKW !== null, "Expected catalogue inverter AC output.");
  assert(battery.capacity.usableKWh !== null, "Expected catalogue battery usable capacity.");

  console.log("  ✓ Catalogue metadata OK:", {
    panelCompleteness: panel.dataQuality.completenessScore,
    inverterCompleteness: inverter.dataQuality.completenessScore,
    batteryCompleteness: battery.dataQuality.completenessScore,
  });
}

function runCandidateNormalisationTest() {
  console.log("\n▶ Candidate hardware metadata normalisation");

  const candidate = {
    candidateId: "candidate-test",
    products: {
      panel: listActivePanels()[0],
      inverter: listActiveInverters()[1] || listActiveInverters()[0],
      battery: listActiveBatteries()[1] || listActiveBatteries()[0],
    },
  };

  const metadata = buildCandidateHardwareMetadataNormalisation(candidate);

  assert(
    metadata.mode === "candidate_hardware_metadata_normalisation_beta",
    "Unexpected candidate metadata mode."
  );
  assert(metadata.usedForCalculation === false, "Metadata should not be used for calculation.");
  assert(metadata.usedForPricing === false, "Metadata should not be used for pricing.");
  assert(metadata.usedForRecommendation === false, "Metadata should not be used for recommendation.");

  assert(metadata.summary.hasPanel === true, "Expected panel.");
  assert(metadata.summary.hasInverter === true, "Expected inverter.");
  assert(metadata.summary.hasBattery === true, "Expected battery.");

  console.log("  ✓ Candidate metadata OK:", {
    completeness: metadata.summary.dataCompletenessScore,
    panelWattage: metadata.summary.panelWattage,
    inverterType: metadata.summary.inverterType,
    batteryUsableKWh: metadata.summary.batteryUsableKWh,
  });
}

function runApplyAndSummaryTest() {
  console.log("\n▶ Apply metadata normalisation and summary");

  const candidates = applyHardwareMetadataNormalisationToCandidates({
    candidates: [
      {
        candidateId: "candidate-1",
        products: {
          panel: listActivePanels()[0],
          inverter: listActiveInverters()[0],
          battery: listActiveBatteries()[0],
        },
      },
      {
        candidateId: "candidate-2",
        products: {
          panel: listActivePanels()[1] || listActivePanels()[0],
          inverter: listActiveInverters()[1] || listActiveInverters()[0],
          battery: null,
        },
      },
    ],
  });

  assert(candidates.length === 2, "Expected two candidates.");
  assert(
    candidates.every((candidate) => candidate.hardwareMetadataNormalisation),
    "Every candidate should include hardwareMetadataNormalisation."
  );

  const summary = buildHardwareMetadataNormalisationSummary({
    candidates,
  });

  assert(
    summary.mode === "hardware_metadata_normalisation_summary_beta",
    "Unexpected summary mode."
  );

  assert(summary.candidateCount === 2, "Expected two candidates in summary.");
  assert(summary.normalisedCandidateCount === 2, "Expected two normalised candidates.");

  console.log("  ✓ Apply and summary OK:", {
    averageCompletenessScore: summary.averageCompletenessScore,
    withBattery: summary.productPresence.withBattery,
  });
}

function runConstraintEvaluationUsesNormalisedMetadataTest() {
  console.log("\n▶ Constraint evaluation uses normalised metadata");

  const rawCandidate = {
    candidateId: "normalised-constraint-candidate",
    products: {
      panel: {
        id: "panel-black",
        brand: "Test",
        model: "All Black 440 W",
        category: "panel",
        wattage: 440,
        productWarrantyYears: 25,
        allBlack: true,
        pricing: {
          currency: "GBP",
          materialCost: 100,
          estimatedInstalledAdder: 160,
        },
      },
      inverter: {
        id: "hybrid-backup",
        brand: "Test",
        model: "Hybrid Backup 5 kW",
        category: "inverter",
        inverterType: "hybrid",
        maxAcOutputKW: 5,
        maxPvInputKW: 7.5,
        backupCompatible: true,
        pricing: {
          currency: "GBP",
          materialCost: 900,
          estimatedInstalledAdder: 1300,
        },
      },
      battery: {
        id: "battery-10",
        brand: "Test",
        model: "10 kWh Battery",
        category: "battery",
        usableCapacityKWh: 10,
        nominalCapacityKWh: 10.6,
        maxChargeKW: 5,
        maxDischargeKW: 6,
        warrantyYears: 10,
        pricing: {
          currency: "GBP",
          materialCost: 2800,
          estimatedInstalledAdder: 3300,
        },
      },
    },
    financialModel: {
      systemCost: {
        estimatedInstalledCost: 12000,
      },
    },
  };

  const candidate = applyHardwareMetadataNormalisationToCandidates({
    candidates: [rawCandidate],
  })[0];

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
    candidate,
    designPreferenceProfile: profile,
  });

  assert(
    evaluation.summary.hardConstraintStatus === "passes_all_hard_constraints",
    `Expected pass status, got ${evaluation.summary.hardConstraintStatus}`
  );

  assert(
    evaluation.evaluations.some((item) =>
      String(item.evidence || "").includes("normalised")
    ),
    "Expected evidence from normalised metadata."
  );

  console.log("  ✓ Constraint evaluation metadata OK:", {
    status: evaluation.summary.hardConstraintStatus,
  });
}

function runCandidateSetIncludesHardwareMetadataTest() {
  console.log("\n▶ Candidate set includes hardware metadata normalisation");

  const candidateSet = buildCandidateSetFromInputs({
    input: {
      systemType: "balanced",
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

  assert(candidateSet.hardwareMetadataSummary, "Candidate set missing hardwareMetadataSummary.");
  assert(
    candidateSet.hardwareMetadataSummary.mode ===
      "hardware_metadata_normalisation_summary_beta",
    "Unexpected hardwareMetadataSummary mode."
  );

  assert(
    candidateSet.candidates.every(
      (candidate) => candidate.hardwareMetadataNormalisation
    ),
    "Every candidate should include hardwareMetadataNormalisation."
  );

  console.log("  ✓ Candidate set hardware metadata OK:", {
    candidates: candidateSet.hardwareMetadataSummary.candidateCount,
    averageCompleteness:
      candidateSet.hardwareMetadataSummary.averageCompletenessScore,
  });
}

function main() {
  console.log("Running hardware metadata normalisation tests");

  runPanelNormalisationTest();
  runInverterNormalisationTest();
  runBatteryNormalisationTest();
  runCatalogueNormalisationTest();
  runCandidateNormalisationTest();
  runApplyAndSummaryTest();
  runConstraintEvaluationUsesNormalisedMetadataTest();
  runCandidateSetIncludesHardwareMetadataTest();

  console.log("\n✅ Hardware metadata normalisation tests passed");
}

main();