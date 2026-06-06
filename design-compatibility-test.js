const {
  buildDesignCompatibilityPreview,
} = require("./services/designCompatibilityService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasCheck(preview, code) {
  return preview.checks.some((check) => check.code === code);
}

function getChecks(preview, code) {
  return preview.checks.filter((check) => check.code === code);
}

function hasFail(preview, code) {
  return preview.checks.some(
    (check) => check.code === code && check.status === "fail"
  );
}

function hasPass(preview, code) {
  return preview.checks.some(
    (check) => check.code === code && check.status === "pass"
  );
}

function runStandardDesignCheck() {
  console.log("\n▶ Standard design compatibility preview");

  const preview = buildDesignCompatibilityPreview({
    input: {
      panelOption: "value",
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "standard",
        exportFromBatteryEnabled: true,
        allowGridCharging: false,
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

  assert(preview.mode === "diagnostic_only", "Preview should be diagnostic only.");
  assert(preview.usedForCalculation === false, "Preview should not be used for calculation.");
  assert(preview.selectedProducts.panel, "Preview should select a panel.");
  assert(preview.selectedProducts.inverter, "Preview should select an inverter.");
  assert(preview.selectedProducts.battery, "Preview should select a battery.");
  assert(preview.summary.total > 0, "Preview should contain checks.");

  assert(hasPass(preview, "MPPT_COUNT_VS_ARRAYS"), "Expected MPPT count check to pass.");
  assert(hasPass(preview, "INVERTER_MAX_PV_INPUT"), "Expected inverter max PV input check to pass.");
  assert(hasCheck(preview, "STRING_COLD_VOC_VS_INVERTER_MAX_DC"), "Expected cold Voc check.");
  assert(hasCheck(preview, "STRING_HOT_VMP_VS_MPPT_MIN"), "Expected hot Vmp check.");
  assert(hasCheck(preview, "STRING_IMP_VS_MPPT_INPUT_CURRENT"), "Expected MPPT current check.");
  assert(hasCheck(preview, "BATTERY_INVERTER_COMPATIBILITY"), "Expected battery compatibility check.");
  assert(hasCheck(preview, "BATTERY_FULL_CHARGE_WITHIN_SHORT_WINDOW"), "Expected battery charge window check.");
  assert(hasCheck(preview, "BATTERY_FULL_DISCHARGE_WITHIN_SHORT_WINDOW"), "Expected battery discharge window check.");

  console.log("  ✓ Standard preview OK:", {
    checks: preview.summary,
    panel: preview.selectedProducts.panel.id,
    inverter: preview.selectedProducts.inverter.id,
    battery: preview.selectedProducts.battery.id,
  });
}

function runTooManyArraysCheck() {
  console.log("\n▶ Too many arrays / MPPT check");

  const preview = buildDesignCompatibilityPreview({
    inverterId: "beta-inverter-hybrid-5kw",
    input: {
      panelOption: "value",
      batteryKWh: 5,
      roofs: [
        { id: "roof-1", orientation: "E", tilt: 35, shading: "none", panels: 4 },
        { id: "roof-2", orientation: "S", tilt: 35, shading: "none", panels: 4 },
        { id: "roof-3", orientation: "W", tilt: 35, shading: "none", panels: 4 },
      ],
    },
  });

  assert(hasFail(preview, "MPPT_COUNT_VS_ARRAYS"), "Expected MPPT count to fail.");
  assert(
    preview.optimisationFlags.some(
      (flag) => flag.code === "ARRAYS_EXCEED_MPPTS_OPTIMISATION_REVIEW"
    ),
    "Expected optimisation flag for arrays exceeding MPPTs."
  );

  console.log("  ✓ Too many arrays check OK");
}

function runOversizedStringVoltageCheck() {
  console.log("\n▶ Oversized string voltage check");

  const preview = buildDesignCompatibilityPreview({
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
  });

  assert(
    hasFail(preview, "STRING_COLD_VOC_VS_INVERTER_MAX_DC") ||
      hasFail(preview, "STRING_COLD_VOC_VS_MPPT_MAX"),
    "Expected oversized string voltage to fail against inverter or MPPT voltage."
  );

  console.log("  ✓ Oversized string voltage check OK");
}

function runShortStringCheck() {
  console.log("\n▶ Short string / MPPT minimum voltage check");

  const preview = buildDesignCompatibilityPreview({
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
  });

  assert(
    hasFail(preview, "STRING_HOT_VMP_VS_MPPT_MIN") ||
      hasFail(preview, "STRING_VMP_VS_STARTUP_VOLTAGE"),
    "Expected short string to fail MPPT minimum or startup voltage."
  );

  assert(
    preview.optimisationFlags.some(
      (flag) => flag.code === "SHORT_STRING_OPTIMISATION_REVIEW"
    ),
    "Expected short string optimisation flag."
  );

  console.log("  ✓ Short string check OK");
}

function runShadingOptimisationFlagCheck() {
  console.log("\n▶ Shading optimisation flag check");

  const preview = buildDesignCompatibilityPreview({
    input: {
      panelOption: "value",
      batteryKWh: 5,
      roofs: [
        {
          id: "roof-shaded",
          orientation: "S",
          tilt: 40,
          shading: "some",
          panels: 10,
        },
      ],
    },
  });

  assert(
    preview.optimisationFlags.some(
      (flag) => flag.code === "SHADED_ARRAY_OPTIMISATION_REVIEW"
    ),
    "Expected shading optimisation flag."
  );

  console.log("  ✓ Shading optimisation flag OK");
}

function runLargeBatteryWindowCheck() {
  console.log("\n▶ Large battery short-window check");

  const preview = buildDesignCompatibilityPreview({
    inverterId: "beta-inverter-hybrid-5kw",
    input: {
      panelOption: "value",
      batteryKWh: 15,
      tariffAfter: {
        tariffType: "flux",
        allowGridCharging: true,
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

  assert(
    getChecks(preview, "BATTERY_FULL_CHARGE_WITHIN_SHORT_WINDOW").length > 0,
    "Expected full charge window check."
  );

  assert(
    getChecks(preview, "BATTERY_FULL_DISCHARGE_WITHIN_SHORT_WINDOW").length > 0,
    "Expected full discharge window check."
  );

  console.log("  ✓ Large battery window check OK");
}

function main() {
  console.log("Running design compatibility tests");

  runStandardDesignCheck();
  runTooManyArraysCheck();
  runOversizedStringVoltageCheck();
  runShortStringCheck();
  runShadingOptimisationFlagCheck();
  runLargeBatteryWindowCheck();

  console.log("\n✅ Design compatibility tests passed");
}

main();