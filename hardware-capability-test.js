const {
  listActivePanels,
  listActiveInverters,
  listActiveBatteries,
} = require("./services/hardwareCatalogService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assertScore(value, label) {
  assert(isNumber(value), `${label} must be numeric.`);
  assert(value >= 0 && value <= 100, `${label} must be between 0 and 100.`);
}

function runPanelCapabilityChecks() {
  console.log("\n▶ Panel capability checks");

  const panels = listActivePanels();

  assert(panels.length > 0, "Expected active panels.");

  for (const panel of panels) {
    assert(panel.capabilities, `${panel.id} missing capabilities.`);
    assertScore(panel.capabilities.aestheticsScore, `${panel.id} aestheticsScore`);
    assertScore(panel.capabilities.complexRoofSuitabilityScore, `${panel.id} complexRoofSuitabilityScore`);
    assertScore(panel.capabilities.premiumAppearanceScore, `${panel.id} premiumAppearanceScore`);
    assert(Array.isArray(panel.scoringTags), `${panel.id} scoringTags must be an array.`);
  }

  console.log("  ✓ Panel capabilities OK");
}

function runInverterCapabilityChecks() {
  console.log("\n▶ Inverter capability checks");

  const inverters = listActiveInverters();

  assert(inverters.length > 0, "Expected active inverters.");

  for (const inverter of inverters) {
    assert(inverter.capabilities, `${inverter.id} missing capabilities.`);

    assertScore(inverter.capabilities.softwareOptimisationScore, `${inverter.id} softwareOptimisationScore`);
    assertScore(inverter.capabilities.monitoringQualityScore, `${inverter.id} monitoringQualityScore`);
    assertScore(inverter.capabilities.backupCapabilityScore, `${inverter.id} backupCapabilityScore`);
    assertScore(inverter.capabilities.exportControlScore, `${inverter.id} exportControlScore`);
    assertScore(inverter.capabilities.g100Score, `${inverter.id} g100Score`);
    assertScore(inverter.capabilities.ecosystemScore, `${inverter.id} ecosystemScore`);
    assertScore(inverter.capabilities.smartTariffControlScore, `${inverter.id} smartTariffControlScore`);
    assertScore(inverter.capabilities.forcedChargeDischargeScore, `${inverter.id} forcedChargeDischargeScore`);

    assert(typeof inverter.capabilities.supportsExportLimiting === "boolean", `${inverter.id} supportsExportLimiting must be boolean.`);
    assert(typeof inverter.capabilities.supportsSmartTariffControl === "boolean", `${inverter.id} supportsSmartTariffControl must be boolean.`);
    assert(typeof inverter.capabilities.supportsForcedChargeDischarge === "boolean", `${inverter.id} supportsForcedChargeDischarge must be boolean.`);

    assert(Array.isArray(inverter.scoringTags), `${inverter.id} scoringTags must be an array.`);
  }

  console.log("  ✓ Inverter capabilities OK");
}

function runBatteryCapabilityChecks() {
  console.log("\n▶ Battery capability checks");

  const batteries = listActiveBatteries();

  assert(batteries.length > 0, "Expected active batteries.");

  for (const battery of batteries) {
    assert(battery.capabilities, `${battery.id} missing capabilities.`);

    assertScore(battery.capabilities.monitoringQualityScore, `${battery.id} monitoringQualityScore`);
    assertScore(battery.capabilities.tariffControlSupportScore, `${battery.id} tariffControlSupportScore`);
    assertScore(battery.capabilities.backupSupportScore, `${battery.id} backupSupportScore`);
    assertScore(battery.capabilities.powerCapabilityScore, `${battery.id} powerCapabilityScore`);
    assertScore(battery.capabilities.scalabilityScore, `${battery.id} scalabilityScore`);

    assert(typeof battery.capabilities.supportsForcedChargeDischarge === "boolean", `${battery.id} supportsForcedChargeDischarge must be boolean.`);
    assert(typeof battery.capabilities.supportsSmartTariffControl === "boolean", `${battery.id} supportsSmartTariffControl must be boolean.`);
    assert(typeof battery.capabilities.suitableForShortTariffWindows === "boolean", `${battery.id} suitableForShortTariffWindows must be boolean.`);

    assert(Array.isArray(battery.scoringTags), `${battery.id} scoringTags must be an array.`);
  }

  console.log("  ✓ Battery capabilities OK");
}

function main() {
  console.log("Running hardware capability tests");

  runPanelCapabilityChecks();
  runInverterCapabilityChecks();
  runBatteryCapabilityChecks();

  console.log("\n✅ Hardware capability tests passed");
}

main();