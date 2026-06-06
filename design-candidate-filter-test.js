const {
  buildDesignCandidateFromInputs,
} = require("./services/designCandidateService");

const {
  applyCandidateFiltering,
} = require("./services/designCandidateFilterService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasRejectionCode(candidate, code) {
  return candidate.filtering?.hardRejectionCodes?.includes(code);
}

function runStandardCandidateFilterTest() {
  console.log("\n▶ Standard candidate filtering");

  const candidate = applyCandidateFiltering(
    buildDesignCandidateFromInputs({
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
    })
  );

  assert(candidate.filtering, "Candidate missing filtering.");
  assert(
    candidate.filtering.status === "viable" ||
      candidate.filtering.status === "viable_with_warnings",
    `Expected standard candidate to be viable or viable_with_warnings, got ${candidate.filtering.status}.`
  );
  assert(candidate.filtering.usedForCalculation === false, "Filtering should not be used for calculation.");
  assert(candidate.filtering.usedForRecommendation === false, "Filtering should not be used for recommendation.");

  console.log("  ✓ Standard candidate filtering OK:", {
    status: candidate.filtering.status,
    warnings: candidate.filtering.counts.warningChecks,
  });
}

function runOversizedStringRejectionTest() {
  console.log("\n▶ Oversized string rejection");

  const candidate = applyCandidateFiltering(
    buildDesignCandidateFromInputs({
      inverterId: "beta-inverter-hybrid-5kw",
      input: {
        panelOption: "value",
        batteryKWh: 5,
        roofs: [
          {
            id: "roof-oversized",
            orientation: "S",
            tilt: 40,
            shading: "none",
            panels: 20,
          },
        ],
      },
    })
  );

  assert(candidate.filtering.status === "rejected", "Oversized string candidate should be rejected.");

  assert(
    hasRejectionCode(candidate, "STRING_COLD_VOC_VS_INVERTER_MAX_DC") ||
      hasRejectionCode(candidate, "STRING_COLD_VOC_VS_MPPT_MAX") ||
      hasRejectionCode(candidate, "INVERTER_MAX_PV_INPUT"),
    "Expected oversized candidate to have voltage or PV input rejection reason."
  );

  console.log("  ✓ Oversized string rejection OK:", {
    status: candidate.filtering.status,
    hardRejections: candidate.filtering.hardRejectionCodes,
  });
}

function runTooManyArraysRejectionTest() {
  console.log("\n▶ Too many arrays rejection");

  const candidate = applyCandidateFiltering(
    buildDesignCandidateFromInputs({
      inverterId: "beta-inverter-hybrid-5kw",
      input: {
        panelOption: "value",
        batteryKWh: 5,
        roofs: [
          { id: "roof-east", orientation: "E", tilt: 35, shading: "none", panels: 4 },
          { id: "roof-south", orientation: "S", tilt: 35, shading: "none", panels: 4 },
          { id: "roof-west", orientation: "W", tilt: 35, shading: "none", panels: 4 },
        ],
      },
    })
  );

  assert(candidate.filtering.status === "rejected", "Too-many-arrays candidate should be rejected.");
  assert(
    hasRejectionCode(candidate, "MPPT_COUNT_VS_ARRAYS"),
    "Expected MPPT count rejection reason."
  );

  console.log("  ✓ Too many arrays rejection OK:", {
    status: candidate.filtering.status,
    hardRejections: candidate.filtering.hardRejectionCodes,
  });
}

function runShortStringRejectionTest() {
  console.log("\n▶ Short string rejection");

  const candidate = applyCandidateFiltering(
    buildDesignCandidateFromInputs({
      inverterId: "beta-inverter-hybrid-5kw",
      input: {
        panelOption: "value",
        batteryKWh: 5,
        roofs: [
          {
            id: "roof-short",
            orientation: "S",
            tilt: 40,
            shading: "none",
            panels: 3,
          },
        ],
      },
    })
  );

  assert(candidate.filtering.status === "rejected", "Short string candidate should be rejected.");

  assert(
    hasRejectionCode(candidate, "STRING_HOT_VMP_VS_MPPT_MIN") ||
      hasRejectionCode(candidate, "STRING_VMP_VS_STARTUP_VOLTAGE"),
    "Expected short string voltage rejection reason."
  );

  console.log("  ✓ Short string rejection OK:", {
    status: candidate.filtering.status,
    hardRejections: candidate.filtering.hardRejectionCodes,
  });
}

function main() {
  console.log("Running design candidate filtering tests");

  runStandardCandidateFilterTest();
  runOversizedStringRejectionTest();
  runTooManyArraysRejectionTest();
  runShortStringRejectionTest();

  console.log("\n✅ Design candidate filtering tests passed");
}

main();