const {
  normalizeTariff,
  rateForHour,
  computeHourlyBilling,
} = require("./services/tariffService");

const {
  getTariffPreset,
  getTariffModelAssumptions,
} = require("./config/tariffPresets");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(Number(actual) - Number(expected));

  if (diff > tolerance) {
    throw new Error(
      `${message}: expected ${expected}, got ${actual}, difference ${diff}`
    );
  }
}

function runPresetChecks() {
  console.log("\n▶ Tariff preset checks");

  const standard = getTariffPreset("standard");
  const overnight = getTariffPreset("overnight");
  const flux = getTariffPreset("flux");

  assertEqual(standard.tariffType, "standard", "Standard preset tariffType");
  assertEqual(overnight.tariffType, "overnight", "Overnight preset tariffType");
  assertEqual(flux.tariffType, "flux", "Flux preset tariffType");

  assertApprox(standard.importPrice, 0.28, 0.0001, "Standard import price");
  assertApprox(standard.segPrice, 0.12, 0.0001, "Standard export price");

  assertApprox(overnight.importNight, 0.08, 0.0001, "Overnight night import");
  assertApprox(overnight.importDay, 0.20, 0.0001, "Overnight day import");
  assertEqual(overnight.allowGridCharging, true, "Overnight allows grid charging");

  assertApprox(flux.importOffPeak, 0.15, 0.0001, "Flux off-peak import");
  assertApprox(flux.importPeak, 0.40, 0.0001, "Flux peak import");
  assertApprox(flux.exportOffPeak, 0.08, 0.0001, "Flux off-peak export");
  assertApprox(flux.exportPeak, 0.30, 0.0001, "Flux peak export");

  console.log("  ✓ Presets OK");
}

function runNormalisationChecks() {
  console.log("\n▶ Tariff normalisation checks");

  const invalid = normalizeTariff(
    {
      tariffType: "made-up-tariff",
      importPrice: "0.31",
      standingChargePerDay: "0.55",
    },
    "after"
  );

  assertEqual(invalid.tariffType, "standard", "Invalid tariff falls back to standard");
  assertApprox(invalid.importPrice, 0.31, 0.0001, "String importPrice becomes number");
  assertApprox(invalid.standingChargePerDay, 0.55, 0.0001, "String standing charge becomes number");

  const nested = normalizeTariff(
    {
      tariffType: "standard",
      before: { bad: true },
      after: { bad: true },
      tariff: { bad: true },
      importPrice: 0.29,
    },
    "after"
  );

  assert(!nested.before, "Nested before field should be removed");
  assert(!nested.after, "Nested after field should be removed");
  assert(!nested.tariff, "Nested tariff field should be removed");

  console.log("  ✓ Normalisation OK");
}

function runRateChecks() {
  console.log("\n▶ Hourly rate checks");

  const standard = normalizeTariff(getTariffPreset("standard"), "after");

  assertApprox(rateForHour(standard, 10, "import"), 0.28, 0.0001, "Standard import rate");
  assertApprox(rateForHour(standard, 10, "export"), 0.12, 0.0001, "Standard export rate");

  const overnight = normalizeTariff(getTariffPreset("overnight"), "after");

  assertApprox(rateForHour(overnight, 2, "import"), 0.08, 0.0001, "Overnight import during night");
  assertApprox(rateForHour(overnight, 8, "import"), 0.20, 0.0001, "Overnight import during day");
  assertApprox(rateForHour(overnight, 2, "export"), 0.12, 0.0001, "Overnight export uses flat SEG");

  const flux = normalizeTariff(getTariffPreset("flux"), "after");

  assertApprox(rateForHour(flux, 3, "import"), 0.15, 0.0001, "Flux import off-peak");
  assertApprox(rateForHour(flux, 12, "import"), 0.28, 0.0001, "Flux import day");
  assertApprox(rateForHour(flux, 17, "import"), 0.40, 0.0001, "Flux import peak");

  assertApprox(rateForHour(flux, 3, "export"), 0.08, 0.0001, "Flux export off-peak");
  assertApprox(rateForHour(flux, 12, "export"), 0.12, 0.0001, "Flux export day");
  assertApprox(rateForHour(flux, 17, "export"), 0.30, 0.0001, "Flux export peak");

  console.log("  ✓ Hourly rates OK");
}

function runBillingCheck() {
  console.log("\n▶ Hourly billing check");

  const hours = 24;

  const loadKWh = Array(hours).fill(1);
  const importKWh = Array(hours).fill(0.5);
  const exportKWh = Array(hours).fill(0.25);
  const hourOfDay = Array.from({ length: hours }, (_, i) => i);
  const monthIdx = Array(hours).fill(0);

  const tariffBefore = {
    tariffType: "standard",
    importPrice: 0.28,
    standingChargePerDay: 0,
  };

  const tariffAfter = {
    tariffType: "standard",
    importPrice: 0.28,
    segPrice: 0.12,
    standingChargePerDay: 0,
  };

  const billing = computeHourlyBilling({
    loadKWh,
    importKWh,
    exportKWh,
    hourOfDay,
    monthIdx,
    tariffBefore,
    tariffAfter,
  });

  // Baseline: 24 kWh × £0.28 = £6.72
  assertApprox(billing.annualBaseline, 6.72, 0.001, "Baseline bill");

  // After import: 12 kWh × £0.28 = £3.36
  assertApprox(billing.annualAfterImportAndStanding, 3.36, 0.001, "After import bill");

  // Export: 6 kWh × £0.12 = £0.72
  assertApprox(billing.annualExportCredit, 0.72, 0.001, "Export credit");

  // Net after: £3.36 - £0.72 = £2.64
  assertApprox(billing.annualAfterNet, 2.64, 0.001, "After net bill");

  console.log("  ✓ Billing OK");
}

function runAssumptionChecks() {
  console.log("\n▶ Tariff assumption checks");

  const assumptions = getTariffModelAssumptions();

  assertEqual(assumptions.model, "hourly-tou-v1", "Tariff model name");
  assertEqual(assumptions.timeResolution, "hourly", "Tariff time resolution");
  assertEqual(assumptions.supportsHalfHourly, false, "Half-hour support flag");

  assert(
    Array.isArray(assumptions.availableTariffTypes),
    "availableTariffTypes should be an array"
  );

  assert(
    assumptions.availableTariffTypes.includes("standard"),
    "standard should be an available tariff type"
  );

  assert(
    assumptions.availableTariffTypes.includes("overnight"),
    "overnight should be an available tariff type"
  );

  assert(
    assumptions.availableTariffTypes.includes("flux"),
    "flux should be an available tariff type"
  );

  console.log("  ✓ Assumptions OK");
}

function main() {
  console.log("Running tariff model tests");

  runPresetChecks();
  runNormalisationChecks();
  runRateChecks();
  runBillingCheck();
  runAssumptionChecks();

  console.log("\n✅ Tariff model tests passed");
}

main();