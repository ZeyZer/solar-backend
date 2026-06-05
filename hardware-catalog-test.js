const {
  getHardwareCatalog,
  listActiveBatteries,
  listActivePanels,
  listActiveInverters,
  findBatteryById,
  findClosestBatteryByUsableKWh,
  getHardwareCatalogSummary,
  getHardwareCatalogForQuote,
} = require("./services/hardwareCatalogService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assertPriceObject(item, label) {
  assert(item.pricing, `${label} missing pricing object.`);
  assert(item.pricing.currency === "GBP", `${label} pricing currency should be GBP.`);
  assert(isNumber(item.pricing.materialCost), `${label} missing numeric materialCost.`);
  assert(isNumber(item.pricing.estimatedInstalledAdder), `${label} missing numeric estimatedInstalledAdder.`);
}

function runCatalogueLoadChecks() {
  console.log("\n▶ Hardware catalogue load checks");

  const catalog = getHardwareCatalog();

  assert(Array.isArray(catalog.batteries), "Batteries catalogue should be an array.");
  assert(Array.isArray(catalog.panels), "Panels catalogue should be an array.");
  assert(Array.isArray(catalog.inverters), "Inverters catalogue should be an array.");

  assert(catalog.batteries.length > 0, "Battery catalogue should not be empty.");
  assert(catalog.panels.length > 0, "Panel catalogue should not be empty.");
  assert(catalog.inverters.length > 0, "Inverter catalogue should not be empty.");

  console.log("  ✓ Catalogue files load correctly");
}

function runBatteryChecks() {
  console.log("\n▶ Battery catalogue checks");

  const batteries = listActiveBatteries();

  assert(batteries.length > 0, "There should be at least one active battery.");

  for (const battery of batteries) {
    assert(battery.id, "Battery missing id.");
    assert(battery.brand, `${battery.id} missing brand.`);
    assert(battery.model, `${battery.id} missing model.`);
    assert(battery.category === "battery", `${battery.id} category should be battery.`);

    assert(isNumber(battery.nominalCapacityKWh), `${battery.id} missing nominalCapacityKWh.`);
    assert(isNumber(battery.usableCapacityKWh), `${battery.id} missing usableCapacityKWh.`);
    assert(battery.usableCapacityKWh <= battery.nominalCapacityKWh, `${battery.id} usable capacity exceeds nominal capacity.`);

    assert(isNumber(battery.maxChargeKW), `${battery.id} missing maxChargeKW.`);
    assert(isNumber(battery.maxDischargeKW), `${battery.id} missing maxDischargeKW.`);
    assert(isNumber(battery.roundTripEfficiency), `${battery.id} missing roundTripEfficiency.`);
    assert(isNumber(battery.warrantyYears), `${battery.id} missing warrantyYears.`);

    assertPriceObject(battery, battery.id);
  }

  const exact = findBatteryById("beta-battery-10kwh");
  assert(exact, "Should find beta-battery-10kwh by id.");
  assert(exact.usableCapacityKWh === 10, "beta-battery-10kwh should have 10 kWh usable capacity.");

  const closest = findClosestBatteryByUsableKWh(9);
  assert(closest, "Should find closest battery to 9 kWh.");
  assert(closest.id === "beta-battery-10kwh", `Expected closest 9 kWh battery to be 10 kWh, got ${closest.id}.`);

  console.log("  ✓ Battery catalogue OK");
}

function runPanelChecks() {
  console.log("\n▶ Panel catalogue checks");

  const panels = listActivePanels();

  assert(panels.length > 0, "There should be at least one active panel.");

  for (const panel of panels) {
    assert(panel.id, "Panel missing id.");
    assert(panel.brand, `${panel.id} missing brand.`);
    assert(panel.model, `${panel.id} missing model.`);
    assert(panel.category === "panel", `${panel.id} category should be panel.`);

    assert(isNumber(panel.wattage), `${panel.id} missing wattage.`);
    assert(panel.wattage > 0, `${panel.id} wattage should be positive.`);

    assertPriceObject(panel, panel.id);
  }

  console.log("  ✓ Panel catalogue OK");
}

function runInverterChecks() {
  console.log("\n▶ Inverter catalogue checks");

  const inverters = listActiveInverters();

  assert(inverters.length > 0, "There should be at least one active inverter.");

  for (const inverter of inverters) {
    assert(inverter.id, "Inverter missing id.");
    assert(inverter.brand, `${inverter.id} missing brand.`);
    assert(inverter.model, `${inverter.id} missing model.`);
    assert(inverter.category === "inverter", `${inverter.id} category should be inverter.`);

    assert(isNumber(inverter.maxAcOutputKW), `${inverter.id} missing maxAcOutputKW.`);
    assert(isNumber(inverter.maxPvInputKW), `${inverter.id} missing maxPvInputKW.`);

    assertPriceObject(inverter, inverter.id);
  }

  console.log("  ✓ Inverter catalogue OK");
}

function runSummaryChecks() {
  console.log("\n▶ Hardware summary checks");

  const summary = getHardwareCatalogSummary();

  assert(summary.batteries.active > 0, "Summary should show active batteries.");
  assert(summary.panels.active > 0, "Summary should show active panels.");
  assert(summary.inverters.active > 0, "Summary should show active inverters.");

  console.log("  ✓ Summary OK:", summary);
}

function runQuoteMetadataChecks() {
  console.log("\n▶ Hardware quote metadata checks");

  const metadata = getHardwareCatalogForQuote();

  assert(metadata.version, "Hardware quote metadata should include version.");
  assert(metadata.assumptions, "Hardware quote metadata should include assumptions.");
  assert(metadata.summary, "Hardware quote metadata should include summary.");

  assert(
    metadata.assumptions.usedForPricing === false,
    "Hardware catalogue should not yet be marked as used for pricing."
  );

  assert(
    metadata.assumptions.usedForBatteryRecommendations === false,
    "Hardware catalogue should not yet be marked as used for battery recommendations."
  );

  assert(
    metadata.summary.batteries.active > 0,
    "Hardware quote metadata should include active battery count."
  );

  assert(
    metadata.summary.panels.active > 0,
    "Hardware quote metadata should include active panel count."
  );

  assert(
    metadata.summary.inverters.active > 0,
    "Hardware quote metadata should include active inverter count."
  );

  console.log("  ✓ Quote metadata OK:", metadata.version);
}

function main() {
  console.log("Running hardware catalogue tests");

  runCatalogueLoadChecks();
  runBatteryChecks();
  runPanelChecks();
  runInverterChecks();
  runSummaryChecks();
  runQuoteMetadataChecks();

  console.log("\n✅ Hardware catalogue tests passed");
}

main();