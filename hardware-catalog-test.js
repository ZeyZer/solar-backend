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

function isNullableNumber(value) {
  return value === null || isNumber(value);
}

function assertPriceObject(item, label) {
  assert(item.pricing, `${label} missing pricing object.`);
  assert(item.pricing.currency === "GBP", `${label} pricing currency should be GBP.`);
  assert(isNumber(item.pricing.materialCost), `${label} missing numeric materialCost.`);
  assert(isNumber(item.pricing.estimatedInstalledAdder), `${label} missing numeric estimatedInstalledAdder.`);
}

function assertSupplierMetadata(item, label) {
  assert(item.supplierMetadata, `${label} missing supplierMetadata.`);
  assert(item.supplierMetadata.sourceType, `${label} missing supplierMetadata.sourceType.`);
  assert(item.supplierMetadata.dataQuality, `${label} missing supplierMetadata.dataQuality.`);
}

function assertPositiveNumber(value, label) {
  assert(isNumber(value), `${label} must be a number.`);
  assert(value > 0, `${label} must be positive.`);
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

    assertPositiveNumber(battery.nominalCapacityKWh, `${battery.id} nominalCapacityKWh`);
    assertPositiveNumber(battery.usableCapacityKWh, `${battery.id} usableCapacityKWh`);
    assert(battery.usableCapacityKWh <= battery.nominalCapacityKWh, `${battery.id} usable capacity exceeds nominal capacity.`);

    assertPositiveNumber(battery.maxChargeKW, `${battery.id} maxChargeKW`);
    assertPositiveNumber(battery.maxDischargeKW, `${battery.id} maxDischargeKW`);
    assertPositiveNumber(battery.roundTripEfficiency, `${battery.id} roundTripEfficiency`);
    assert(battery.roundTripEfficiency > 0 && battery.roundTripEfficiency <= 1, `${battery.id} roundTripEfficiency should be between 0 and 1.`);

    assertPositiveNumber(battery.warrantyYears, `${battery.id} warrantyYears`);
    assert(isNumber(battery.degradationRatePerYear), `${battery.id} missing degradationRatePerYear.`);
    assert(isNumber(battery.minCapacityFraction), `${battery.id} missing minCapacityFraction.`);

    assert(battery.electrical, `${battery.id} missing electrical object.`);
    assert(battery.electrical.batteryVoltageType, `${battery.id} missing electrical.batteryVoltageType.`);
    assert(battery.electrical.operatingVoltageRangeV, `${battery.id} missing operatingVoltageRangeV.`);
    assert(isNullableNumber(battery.electrical.operatingVoltageRangeV.min), `${battery.id} operating voltage min must be number or null.`);
    assert(isNullableNumber(battery.electrical.operatingVoltageRangeV.max), `${battery.id} operating voltage max must be number or null.`);

    assert(battery.scalability, `${battery.id} missing scalability object.`);
    assert(typeof battery.scalability.isScalable === "boolean", `${battery.id} scalability.isScalable must be boolean.`);
    assertPositiveNumber(battery.scalability.moduleUsableCapacityKWh, `${battery.id} moduleUsableCapacityKWh`);
    assertPositiveNumber(battery.scalability.minModules, `${battery.id} minModules`);
    assertPositiveNumber(battery.scalability.maxModules, `${battery.id} maxModules`);
    assert(battery.scalability.maxModules >= battery.scalability.minModules, `${battery.id} maxModules must be >= minModules.`);

    assert(Array.isArray(battery.compatibleInverterTypes), `${battery.id} compatibleInverterTypes must be an array.`);
    assert(Array.isArray(battery.compatibleInverterIds), `${battery.id} compatibleInverterIds must be an array.`);

    assertPriceObject(battery, battery.id);
    assertSupplierMetadata(battery, battery.id);
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

    assertPositiveNumber(panel.wattage, `${panel.id} wattage`);

    assert(panel.electrical, `${panel.id} missing electrical object.`);
    assertPositiveNumber(panel.electrical.vocSTC, `${panel.id} electrical.vocSTC`);
    assertPositiveNumber(panel.electrical.vmpSTC, `${panel.id} electrical.vmpSTC`);
    assertPositiveNumber(panel.electrical.iscSTC, `${panel.id} electrical.iscSTC`);
    assertPositiveNumber(panel.electrical.impSTC, `${panel.id} electrical.impSTC`);
    assertPositiveNumber(panel.electrical.maxSystemVoltageV, `${panel.id} electrical.maxSystemVoltageV`);
    assert(isNumber(panel.electrical.tempCoeffVocPctPerC), `${panel.id} missing tempCoeffVocPctPerC.`);
    assert(isNumber(panel.electrical.tempCoeffPmaxPctPerC), `${panel.id} missing tempCoeffPmaxPctPerC.`);

    assert(panel.mechanical, `${panel.id} missing mechanical object.`);
    assertPositiveNumber(panel.mechanical.lengthMm, `${panel.id} mechanical.lengthMm`);
    assertPositiveNumber(panel.mechanical.widthMm, `${panel.id} mechanical.widthMm`);
    assertPositiveNumber(panel.mechanical.weightKg, `${panel.id} mechanical.weightKg`);

    assert(panel.warranty, `${panel.id} missing warranty object.`);
    assertPositiveNumber(panel.warranty.productWarrantyYears, `${panel.id} productWarrantyYears`);
    assertPositiveNumber(panel.warranty.performanceWarrantyYears, `${panel.id} performanceWarrantyYears`);
    assert(isNumber(panel.warranty.firstYearDegradation), `${panel.id} missing firstYearDegradation.`);
    assert(isNumber(panel.warranty.annualDegradationRate), `${panel.id} missing annualDegradationRate.`);

    assertPriceObject(panel, panel.id);
    assertSupplierMetadata(panel, panel.id);
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

    assertPositiveNumber(inverter.maxAcOutputKW, `${inverter.id} maxAcOutputKW`);
    assert(isNumber(inverter.maxPvInputKW), `${inverter.id} missing maxPvInputKW.`);

    assert(inverter.dcInput, `${inverter.id} missing dcInput object.`);
    assert(isNumber(inverter.dcInput.maxDcVoltageV), `${inverter.id} missing dcInput.maxDcVoltageV.`);
    assert(isNumber(inverter.dcInput.startupVoltageV), `${inverter.id} missing dcInput.startupVoltageV.`);
    assert(inverter.dcInput.mpptVoltageRangeV, `${inverter.id} missing dcInput.mpptVoltageRangeV.`);
    assert(isNumber(inverter.dcInput.mpptVoltageRangeV.min), `${inverter.id} missing MPPT voltage min.`);
    assert(isNumber(inverter.dcInput.mpptVoltageRangeV.max), `${inverter.id} missing MPPT voltage max.`);
    assert(isNumber(inverter.dcInput.mpptCount), `${inverter.id} missing dcInput.mpptCount.`);
    assert(Array.isArray(inverter.dcInput.mppts), `${inverter.id} dcInput.mppts must be an array.`);

    if (inverter.maxPvInputKW > 0) {
      assert(inverter.dcInput.mpptCount > 0, `${inverter.id} PV inverter should have MPPTs.`);
      assert(inverter.dcInput.mppts.length === inverter.dcInput.mpptCount, `${inverter.id} MPPT count mismatch.`);

      for (const mppt of inverter.dcInput.mppts) {
        assert(mppt.id, `${inverter.id} MPPT missing id.`);
        assertPositiveNumber(mppt.maxStrings, `${inverter.id} ${mppt.id} maxStrings`);
        assertPositiveNumber(mppt.maxInputCurrentA, `${inverter.id} ${mppt.id} maxInputCurrentA`);
        assertPositiveNumber(mppt.maxShortCircuitCurrentA, `${inverter.id} ${mppt.id} maxShortCircuitCurrentA`);
        assertPositiveNumber(mppt.maxDcPowerKW, `${inverter.id} ${mppt.id} maxDcPowerKW`);
      }
    }

    assert(inverter.batteryPort, `${inverter.id} missing batteryPort object.`);
    assert(Array.isArray(inverter.batteryPort.supportedBatteryTypes), `${inverter.id} supportedBatteryTypes must be an array.`);
    assert(isNumber(inverter.batteryPort.maxChargeKW), `${inverter.id} batteryPort.maxChargeKW must be numeric.`);
    assert(isNumber(inverter.batteryPort.maxDischargeKW), `${inverter.id} batteryPort.maxDischargeKW must be numeric.`);
    assert(Array.isArray(inverter.batteryPort.compatibleBatteryIds), `${inverter.id} compatibleBatteryIds must be an array.`);

    assertPriceObject(inverter, inverter.id);
    assertSupplierMetadata(inverter, inverter.id);
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