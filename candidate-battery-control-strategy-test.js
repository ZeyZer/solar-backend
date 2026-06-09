const {
  resolveCandidateBatteryControlStrategy,
} = require("./services/candidateBatteryControlStrategyService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runStandardTariffTest() {
  console.log("\n▶ Standard tariff control strategy");

  const strategy = resolveCandidateBatteryControlStrategy({
    input: {
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "standard",
        importPrice: 0.28,
        segPrice: 0.12,
      },
    },
  });

  assert(strategy.strategyId === "self_consumption", "Expected self-consumption strategy.");
  assert(strategy.dispatch.dispatchMode === "self_consumption", "Expected self-consumption dispatch.");
  assert(strategy.dispatch.allowGridCharge === false, "Standard tariff should not grid charge.");
  assert(strategy.dispatch.exportFromBatteryEnabled === false, "Standard tariff should not export from battery by default.");

  console.log("  ✓ Standard strategy OK:", strategy.strategyId);
}

function runOvernightTariffTest() {
  console.log("\n▶ Overnight tariff control strategy");

  const strategy = resolveCandidateBatteryControlStrategy({
    input: {
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "overnight",
        importDay: 0.30,
        importNight: 0.09,
        nightStartHour: 0,
        nightEndHour: 5,
        segPrice: 0.12,
      },
    },
  });

  assert(strategy.strategyId === "timed_grid_charge", "Expected timed grid charge strategy.");
  assert(strategy.dispatch.dispatchMode === "retail_rate", "Expected retail-rate dispatch.");
  assert(strategy.dispatch.allowGridCharge === true, "Overnight tariff should allow grid charging.");
  assert(strategy.dispatch.allowEnergyTrading === false, "Overnight tariff should not energy trade by default.");
  assert(strategy.dispatch.exportFromBatteryEnabled === false, "Overnight tariff should not export from battery by default.");

  console.log("  ✓ Overnight strategy OK:", strategy.strategyId);
}

function runFluxTariffTest() {
  console.log("\n▶ Flux tariff control strategy");

  const strategy = resolveCandidateBatteryControlStrategy({
    input: {
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "flux",
        importOffPeak: 0.16,
        importPeak: 0.38,
        exportOffPeak: 0.08,
        exportPeak: 0.24,
      },
    },
  });

  assert(strategy.strategyId === "smart_import_export", "Expected smart import/export strategy.");
  assert(strategy.dispatch.dispatchMode === "retail_rate", "Expected retail-rate dispatch.");
  assert(strategy.dispatch.allowGridCharge === true, "Flux tariff should allow grid charging.");
  assert(strategy.dispatch.allowEnergyTrading === true, "Flux tariff should allow energy trading.");
  assert(strategy.dispatch.exportFromBatteryEnabled === true, "Flux tariff should allow battery export.");

  console.log("  ✓ Flux strategy OK:", strategy.strategyId);
}

function runNoBatteryTest() {
  console.log("\n▶ No-battery control strategy");

  const strategy = resolveCandidateBatteryControlStrategy({
    input: {
      batteryKWh: 0,
      tariffAfter: {
        tariffType: "overnight",
      },
    },
  });

  assert(strategy.strategyId === "no_battery", "Expected no-battery strategy.");
  assert(strategy.battery.hasBattery === false, "Expected no battery.");
  assert(strategy.dispatch.allowGridCharge === false, "No battery should not grid charge.");

  console.log("  ✓ No-battery strategy OK:", strategy.strategyId);
}

function runOverrideTest() {
  console.log("\n▶ Explicit control override");

  const strategy = resolveCandidateBatteryControlStrategy({
    input: {
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "overnight",
      },
      batteryControlStrategy: {
        strategyId: "manual_self_consumption",
        allowGridCharge: false,
        allowEnergyTrading: false,
        exportFromBatteryEnabled: false,
      },
    },
  });

  assert(strategy.source === "explicit_battery_control_override", "Expected explicit override source.");
  assert(strategy.strategyId === "manual_self_consumption", "Expected override strategy ID.");
  assert(strategy.dispatch.allowGridCharge === false, "Override should disable grid charging.");

  console.log("  ✓ Override strategy OK:", strategy.strategyId);
}

function main() {
  console.log("Running candidate battery control strategy tests");

  runStandardTariffTest();
  runOvernightTariffTest();
  runFluxTariffTest();
  runNoBatteryTest();
  runOverrideTest();

  console.log("\n✅ Candidate battery control strategy tests passed");
}

main();