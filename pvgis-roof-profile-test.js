const {
  buildDesignCandidateFromInputs,
} = require("./services/designCandidateService");

const {
  averageHourlyArrays,
} = require("./utils/arrayUtils");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function buildSyntheticHourly({ annualKWh }) {
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

function buildQuoteWithAveragedRoofProfiles() {
  const monthIdx = buildMonthIdx();
  const hourOfDay = buildHourOfDay();

  const roof1Years = [
    buildSyntheticHourly({ annualKWh: 2000 }),
    buildSyntheticHourly({ annualKWh: 2100 }),
    buildSyntheticHourly({ annualKWh: 2200 }),
  ];

  const roof2Years = [
    buildSyntheticHourly({ annualKWh: 1500 }),
    buildSyntheticHourly({ annualKWh: 1600 }),
    buildSyntheticHourly({ annualKWh: 1700 }),
  ];

  const roof1Average = averageHourlyArrays(roof1Years);
  const roof2Average = averageHourlyArrays(roof2Years);

  const aggregate = roof1Average.map((value, index) => {
    return Number(value || 0) + Number(roof2Average[index] || 0);
  });

  return {
    systemSizeKwp: 4.3,
    hourlyModel: {
      _pvHourlyKWh: aggregate,
      _monthIdx: monthIdx,
      _hourOfDay: hourOfDay,
      _pvgisRoofProfiles: [
        {
          id: "east-roof-pvgis-avg-2021-2023",
          roofId: "east-roof",
          index: 0,
          year: "avg_2021_2023",
          years: [2021, 2022, 2023],
          source: "pvgis_hourly_3yr_avg_roof_array",
          orientation: "E",
          tilt: 35,
          shading: "none",
          shadingDerate: 1,
          panelWatt: 430,
          panelCount: 6,
          baseSystemSizeKwp: 2.58,
          hourlyGenerationKWh: roof1Average,
          monthIdx,
          hourOfDay,
          annualGenerationKWh: Math.round(
            roof1Average.reduce((sum, value) => sum + Number(value || 0), 0)
          ),
          sourceProfileCount: 3,
        },
        {
          id: "west-roof-pvgis-avg-2021-2023",
          roofId: "west-roof",
          index: 1,
          year: "avg_2021_2023",
          years: [2021, 2022, 2023],
          source: "pvgis_hourly_3yr_avg_roof_array",
          orientation: "W",
          tilt: 35,
          shading: "some",
          shadingDerate: 0.9,
          panelWatt: 430,
          panelCount: 6,
          baseSystemSizeKwp: 2.58,
          hourlyGenerationKWh: roof2Average,
          monthIdx,
          hourOfDay,
          annualGenerationKWh: Math.round(
            roof2Average.reduce((sum, value) => sum + Number(value || 0), 0)
          ),
          sourceProfileCount: 3,
        },
      ],
    },
  };
}

function runCandidateUsesRoofProfilesTest() {
  console.log("\n▶ Candidate uses roof-array PVGIS profiles");

  const candidate = buildDesignCandidateFromInputs({
    quote: buildQuoteWithAveragedRoofProfiles(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
      roofs: [
        {
          id: "east-roof",
          orientation: "E",
          tilt: 35,
          shading: "none",
          panels: 6,
        },
        {
          id: "west-roof",
          orientation: "W",
          tilt: 35,
          shading: "some",
          panels: 6,
        },
      ],
    },
  });

  const model = candidate.performanceModel;

  assert(model, "Candidate missing performance model.");
  assert(
    model.source === "scaled_from_pvgis_roof_array_profiles",
    `Expected roof-array PVGIS source, got ${model.source}`
  );

  assert(model.pvgis.usesRoofArrayProfiles === true, "Expected roof profiles to be used.");
  assert(model.pvgis.usesAggregateProfile === false, "Expected aggregate profile not to be used.");
  assert(model.pvgis.matchedArrayCount === 2, "Expected two matched roof arrays.");
  assert(model.pvgis.missingArrayCount === 0, "Expected no missing roof arrays.");

  assert(Array.isArray(model.arrays), "Expected performance arrays.");
  assert(model.arrays.length === 2, "Expected two array performance rows.");

  assert(model.generation.annualGrossGenerationKWh > 0, "Expected annual generation.");
  assert(model.generation.hourlySeries.length === 8760, "Expected 8760 hourly values.");

  console.log("  ✓ Candidate roof-profile performance OK:", {
    source: model.source,
    matchedArrayCount: model.pvgis.matchedArrayCount,
    annualGrossGenerationKWh: model.generation.annualGrossGenerationKWh,
  });
}

function main() {
  console.log("Running PVGIS roof profile tests");

  runCandidateUsesRoofProfilesTest();

  console.log("\n✅ PVGIS roof profile tests passed");
}

main();