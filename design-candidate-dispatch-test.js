const {
  buildDesignCandidateFromInputs,
} = require("./services/designCandidateService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function buildMonthIdx() {
  const daysByMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const result = [];

  daysByMonth.forEach((days, monthIndex) => {
    for (let i = 0; i < days * 24; i++) {
      result.push(monthIndex);
    }
  });

  return result;
}

function buildHourOfDay(length = 8760) {
  return Array.from({ length }, (_, index) => index % 24);
}

function buildSyntheticPvHourly({ annualKWh = 4200 } = {}) {
  const raw = Array.from({ length: 8760 }, (_, index) => {
    const hour = index % 24;
    const day = Math.floor(index / 24);

    const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const seasonal = 0.35 + 0.65 * Math.max(0, Math.sin(((day - 20) / 365) * Math.PI));

    return daylight * seasonal;
  });

  const rawTotal = raw.reduce((sum, value) => sum + value, 0);
  const scale = rawTotal > 0 ? annualKWh / rawTotal : 0;

  return raw.map((value) => value * scale);
}

function buildFlatLoadHourly({ annualKWh = 3500 } = {}) {
  const hourly = annualKWh / 8760;
  return Array(8760).fill(hourly);
}

function buildQuoteWithRoofProfile({
  annualPvKWh = 4221,
  annualLoadKWh = 3500,
  baseSystemSizeKwp = 4.3,
} = {}) {
  const monthIdx = buildMonthIdx();
  const hourOfDay = buildHourOfDay();
  const pvHourly = buildSyntheticPvHourly({ annualKWh: annualPvKWh });
  const loadHourly = buildFlatLoadHourly({ annualKWh: annualLoadKWh });

  return {
    systemSizeKwp: baseSystemSizeKwp,

    tariffAfter: {
      tariffType: "standard",
      importPrice: 0.28,
      standingChargePerDay: 0.6,
      segPrice: 0.12,
    },

    hourlyModel: {
      _pvHourlyKWh: pvHourly,
      _loadHourlyKWh: loadHourly,
      _monthIdx: monthIdx,
      _hourOfDay: hourOfDay,
      _batteryKWh: 5,
      _pvgisRoofProfiles: [
        {
          id: "roof-1-pvgis-avg-2021-2023",
          roofId: "roof-1",
          index: 0,
          year: "avg_2021_2023",
          source: "pvgis_hourly_3yr_avg_roof_array",
          baseSystemSizeKwp,
          hourlyGenerationKWh: pvHourly,
          monthIdx,
          hourOfDay,
          annualGenerationKWh: Math.round(
            pvHourly.reduce((sum, value) => sum + Number(value || 0), 0)
          ),
        },
      ],
    },
  };
}

function runStandardDispatchTest() {
  console.log("\n▶ Standard candidate dispatch model");

  const candidate = buildDesignCandidateFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
      tariffAfter: {
        tariffType: "standard",
        importPrice: 0.28,
        standingChargePerDay: 0.6,
        segPrice: 0.12,
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

  const model = candidate.dispatchModel;

  assert(model, "Candidate missing dispatchModel.");
  assert(model.mode === "candidate_hourly_dispatch_model_beta", "Unexpected dispatch model mode.");
  assert(model.usedForCalculation === false, "Dispatch model should not be used for calculation.");
  assert(model.usedForRecommendation === false, "Dispatch model should not be used for recommendation.");

  assert(model.generationSource === "scaled_from_pvgis_roof_array_profiles", "Expected roof-array PVGIS generation source.");
  assert(model.hourlySeries.available === true, "Expected hourly dispatch source arrays.");
  assert(model.hourlySeries.included === false, "Hourly arrays should not be exposed.");
  assert(model.hourlySeries.length === 8760, "Expected 8760-hour dispatch model.");

  assert(isNumber(model.annual.generationKWh), "Missing annual generation.");
  assert(model.annual.generationKWh > 0, "Annual generation should be positive.");
  assert(isNumber(model.annual.importedKWh), "Missing annual import.");
  assert(isNumber(model.annual.exportedKWh), "Missing annual export.");
  assert(isNumber(model.annual.selfUsedKWh), "Missing annual self-used energy.");

  assert(Array.isArray(model.monthly.generation), "Monthly generation should be an array.");
  assert(model.monthly.generation.length === 12, "Monthly generation should have 12 values.");

  assert(model.battery.hasBattery === true, "Expected battery dispatch.");
  assert(model.battery.usableCapacityKWh > 0, "Expected usable battery capacity.");

  assert(
    !candidate.performanceModel.generation.hourlyGrossGenerationKWh,
    "Returned performanceModel should not expose hourly gross array."
  );

  assert(
    !candidate.performanceModel.generation.hourlyAfterClippingKWh,
    "Returned performanceModel should not expose hourly clipped array."
  );

  console.log("  ✓ Standard dispatch OK:", {
    generationSource: model.generationSource,
    annualGeneration: model.annual.generationKWh,
    annualImported: model.annual.importedKWh,
    annualExported: model.annual.exportedKWh,
    annualSelfUsed: model.annual.selfUsedKWh,
  });
}

function runNoBatteryDispatchTest() {
  console.log("\n▶ No-battery candidate dispatch model");

  const candidate = buildDesignCandidateFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "premium",
      batteryKWh: 0,
      tariffAfter: {
        tariffType: "standard",
        importPrice: 0.28,
        standingChargePerDay: 0.6,
        segPrice: 0.12,
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

  const model = candidate.dispatchModel;

  assert(model.mode === "candidate_hourly_dispatch_model_beta", "Unexpected dispatch model mode.");
  assert(model.battery.hasBattery === false, "Expected no battery.");
  assert(model.battery.usableCapacityKWh === 0, "Expected 0 kWh battery.");
  assert(model.annual.batteryChargeKWh === 0, "No-battery charge should be zero.");
  assert(model.annual.batteryDischargeKWh === 0, "No-battery discharge should be zero.");

  console.log("  ✓ No-battery dispatch OK:", {
    annualGeneration: model.annual.generationKWh,
    annualExported: model.annual.exportedKWh,
  });
}

function runUnavailableDispatchTest() {
  console.log("\n▶ Unavailable candidate dispatch model");

  const candidate = buildDesignCandidateFromInputs({
    input: {
      panelOption: "value",
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

  const model = candidate.dispatchModel;

  assert(model, "Candidate missing dispatchModel.");
  assert(model.mode === "candidate_dispatch_model_unavailable", "Expected unavailable dispatch model.");
  assert(model.source === "dispatch_data_unavailable", "Expected unavailable dispatch source.");
  assert(model.confidence.level === "unavailable", "Expected unavailable confidence.");

  console.log("  ✓ Unavailable dispatch OK:", {
    mode: model.mode,
    reason: model.confidence.reason,
  });
}

function main() {
  console.log("Running design candidate dispatch tests");

  runStandardDispatchTest();
  runNoBatteryDispatchTest();
  runUnavailableDispatchTest();

  console.log("\n✅ Design candidate dispatch tests passed");
}

main();