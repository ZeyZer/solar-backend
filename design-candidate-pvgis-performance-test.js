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

function buildSyntheticPvgisHourly({ annualKWh = 4200 } = {}) {
  const hours = 8760;
  const raw = [];

  for (let i = 0; i < hours; i++) {
    const dayOfYear = Math.floor(i / 24);
    const hour = i % 24;

    const daylightShape = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const seasonalShape = 0.35 + 0.65 * Math.max(0, Math.sin(((dayOfYear - 20) / 365) * Math.PI));

    raw.push(daylightShape * seasonalShape);
  }

  const rawTotal = raw.reduce((sum, value) => sum + value, 0);
  const scale = rawTotal > 0 ? annualKWh / rawTotal : 0;

  return raw.map((value) => value * scale);
}

function buildQuoteWithRoofProfile({ annualKWh = 4221, baseSystemSizeKwp = 4.3 } = {}) {
  const hourly = buildSyntheticPvgisHourly({ annualKWh });
  const monthIdx = buildMonthIdx();
  const hourOfDay = buildHourOfDay(hourly.length);

  return {
    systemSizeKwp: baseSystemSizeKwp,
    designPvgisRoofProfiles: [
      {
        id: "roof-1-profile",
        roofId: "roof-1",
        index: 0,
        baseSystemSizeKwp,
        hourlyGenerationKWh: hourly,
        monthIdx,
        hourOfDay,
        source: "test_pvgis_roof_profile",
      },
    ],
  };
}

function buildQuoteWithAggregateProfile({ annualKWh = 4221, baseSystemSizeKwp = 4.3 } = {}) {
  const hourly = buildSyntheticPvgisHourly({ annualKWh });
  const monthIdx = buildMonthIdx();
  const hourOfDay = buildHourOfDay(hourly.length);

  return {
    systemSizeKwp: baseSystemSizeKwp,
    hourlyModel: {
      _pvHourlyKWh: hourly,
      _monthIdx: monthIdx,
      _hourOfDay: hourOfDay,
    },
  };
}

function runRoofProfilePerformanceTest() {
  console.log("\n▶ PVGIS roof-profile candidate performance");

  const candidate = buildDesignCandidateFromInputs({
    quote: buildQuoteWithRoofProfile({
      annualKWh: 4221,
      baseSystemSizeKwp: 4.3,
    }),
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

  const model = candidate.performanceModel;

  assert(model, "Candidate missing performanceModel.");
  assert(model.mode === "candidate_pvgis_performance_model_beta", "Unexpected performance model mode.");
  assert(model.source === "scaled_from_pvgis_roof_array_profiles", "Expected roof-array PVGIS source.");
  assert(model.usedForCalculation === false, "Performance model should not be used for calculation.");
  assert(model.usedForRecommendation === false, "Performance model should not be used for recommendation.");

  assert(model.pvgis.usesRoofArrayProfiles === true, "Expected roof-array profiles to be used.");
  assert(model.pvgis.usesAggregateProfile === false, "Did not expect aggregate profile.");
  assert(model.pvgis.matchedArrayCount === 1, "Expected one matched array.");
  assert(model.pvgis.missingArrayCount === 0, "Expected no missing arrays.");

  assert(isNumber(model.systemSizeKwp), "Missing systemSizeKwp.");
  assert(model.systemSizeKwp > 0, "systemSizeKwp should be positive.");

  assert(model.generation.annualGrossGenerationKWh > 0, "Annual gross generation should be positive.");
  assert(model.generation.annualAfterClippingKWh > 0, "Annual after clipping should be positive.");
  assert(Array.isArray(model.generation.monthlyGrossGenerationKWh), "Monthly gross generation should be an array.");
  assert(model.generation.monthlyGrossGenerationKWh.length === 12, "Monthly generation should contain 12 values.");

  assert(model.generation.hourlySeries.available === true, "Hourly series should be available.");
  assert(model.generation.hourlySeries.included === false, "Hourly series should be omitted by default.");
  assert(model.generation.hourlySeries.length === 8760, "Expected 8760 hourly values.");

  assert(Array.isArray(model.arrays), "Expected array performance rows.");
  assert(model.arrays.length === 1, "Expected one array performance row.");
  assert(model.arrays[0].annualGrossGenerationKWh > 0, "Array generation should be positive.");

  assert(model.inverter.clippingRisk, "Missing clipping risk.");
  assert(model.confidence.level === "medium_high", "Expected medium_high confidence.");

  console.log("  ✓ PVGIS roof-profile performance OK:", {
    source: model.source,
    annualGrossGenerationKWh: model.generation.annualGrossGenerationKWh,
    annualAfterClippingKWh: model.generation.annualAfterClippingKWh,
    confidence: model.confidence.level,
  });
}

function runPanelScalingTest() {
  console.log("\n▶ PVGIS candidate panel scaling");

  const quote = buildQuoteWithRoofProfile({
    annualKWh: 4221,
    baseSystemSizeKwp: 4.3,
  });

  const valueCandidate = buildDesignCandidateFromInputs({
    quote,
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

  const premiumCandidate = buildDesignCandidateFromInputs({
    quote,
    input: {
      panelOption: "premium",
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

  const valueAnnual = valueCandidate.performanceModel.generation.annualGrossGenerationKWh;
  const premiumAnnual = premiumCandidate.performanceModel.generation.annualGrossGenerationKWh;

  assert(premiumAnnual > valueAnnual, "Premium higher-wattage panels should scale to higher PVGIS generation.");

  console.log("  ✓ PVGIS panel scaling OK:", {
    valueAnnual,
    premiumAnnual,
  });
}

function runAggregateFallbackPerformanceTest() {
  console.log("\n▶ Aggregate PVGIS fallback performance");

  const candidate = buildDesignCandidateFromInputs({
    quote: buildQuoteWithAggregateProfile({
      annualKWh: 4221,
      baseSystemSizeKwp: 4.3,
    }),
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

  const model = candidate.performanceModel;

  assert(
    model.source === "scaled_from_aggregate_quote_pvgis_hourly_profile",
    "Expected aggregate PVGIS fallback source."
  );

  assert(model.pvgis.usesRoofArrayProfiles === false, "Expected no roof-array profile usage.");
  assert(model.pvgis.usesAggregateProfile === true, "Expected aggregate profile usage.");
  assert(model.generation.annualGrossGenerationKWh > 0, "Aggregate fallback generation should be positive.");
  assert(model.confidence.level === "medium_low", "Expected medium_low confidence.");

  console.log("  ✓ Aggregate PVGIS fallback OK:", {
    source: model.source,
    annualGrossGenerationKWh: model.generation.annualGrossGenerationKWh,
    confidence: model.confidence.level,
  });
}

function runNoPvgisDataTest() {
  console.log("\n▶ Missing PVGIS data performance");

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

  const model = candidate.performanceModel;

  assert(model.source === "pvgis_data_unavailable", "Expected unavailable PVGIS source.");
  assert(model.generation.annualGrossGenerationKWh === 0, "Missing PVGIS should not invent generation.");
  assert(model.confidence.level === "unavailable", "Expected unavailable confidence.");

  console.log("  ✓ Missing PVGIS handling OK:", {
    source: model.source,
    annualGrossGenerationKWh: model.generation.annualGrossGenerationKWh,
    confidence: model.confidence.level,
  });
}

function main() {
  console.log("Running design candidate PVGIS performance tests");

  runRoofProfilePerformanceTest();
  runPanelScalingTest();
  runAggregateFallbackPerformanceTest();
  runNoPvgisDataTest();

  console.log("\n✅ Design candidate PVGIS performance tests passed");
}

main();