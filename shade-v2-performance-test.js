const assert = require("assert");

const {
  processGeoTiffMonthsInBatches,
} = require("./services/roof/googleHourlyShadeFactorRuntimeService");

const {
  buildBaseYearlyProfilesConcurrently,
  buildShadeStrengthV2FromYearlyProfiles,
} = require("./services/roof/shadeStrengthV2RuntimeProductionService");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testGeoTiffConcurrencyAndMonthOrdering() {
  const urls = Array.from({ length: 12 }, (_, monthIndex) => `month-${monthIndex}`);
  const processedMonths = [];
  const downloadedMonths = [];
  let activeDownloads = 0;
  let maxActiveDownloads = 0;

  await processGeoTiffMonthsInBatches({
    hourlyShadeUrls: urls,
    apiKey: "test-key",
    fetchImage: async (url) => {
      const monthIndex = Number(url.split("-")[1]);
      activeDownloads += 1;
      maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);

      await delay((2 - (monthIndex % 3)) * 4);
      downloadedMonths.push(monthIndex);
      activeDownloads -= 1;

      return { monthIndex };
    },
    processImage: async ({ image, monthIndex }) => {
      assert.strictEqual(image.monthIndex, monthIndex);
      processedMonths.push(monthIndex);
    },
  });

  assert.strictEqual(maxActiveDownloads, 3);
  assert.strictEqual(downloadedMonths.length, 12);
  assert.notDeepStrictEqual(downloadedMonths, Array.from({ length: 12 }, (_, i) => i));
  assert.deepStrictEqual(processedMonths, Array.from({ length: 12 }, (_, i) => i));
}

async function testGeoTiffFailureRejectsStage() {
  await assert.rejects(
    processGeoTiffMonthsInBatches({
      hourlyShadeUrls: Array.from({ length: 12 }, (_, index) => `month-${index}`),
      apiKey: "test-key",
      fetchImage: async (url) => {
        if (url === "month-4") {
          throw new Error("GeoTIFF failed");
        }

        return { url };
      },
      processImage: async () => {},
    }),
    /GeoTIFF failed/
  );
}

function makeBaseSegmentProfile(year, segmentIndex) {
  return {
    segmentIndex,
    allocatedPanels: 2,
    peakPowerKwp: 0.8,
    tiltDeg: 35,
    googleAzimuthDegrees: 180,
    pvgisAspectDeg: 0,
    unshadedHourlyKwh: Array(24).fill(year - 2020),
    monthIdx: Array(24).fill(0),
    hourOfDay: Array.from({ length: 24 }, (_, hour) => hour),
    irradianceComponents: {
      beamInPlaneWm2: Array(24).fill(500),
      diffuseInPlaneWm2: Array(24).fill(100),
      reflectedInPlaneWm2: Array(24).fill(0),
    },
  };
}

async function testProductionYearConcurrencyOrderingAndDeterminism() {
  const years = [2021, 2022, 2023];
  const segmentInputs = [{ segmentIndex: 0 }, { segmentIndex: 1 }];
  const startedYears = [];
  const completedYears = [];
  const activeSegmentsByYear = new Map();
  const maxActiveSegmentsByYear = new Map();
  const delays = { 2021: 18, 2022: 12, 2023: 6 };

  const baseYearlyProfiles = await buildBaseYearlyProfilesConcurrently({
    years,
    location: { lat: 51.5, lon: -0.1 },
    segmentInputs,
    buildYear: async ({ year, segmentInputs: segments }) => {
      startedYears.push(year);
      const profiles = [];

      for (const segment of segments) {
        const active = (activeSegmentsByYear.get(year) || 0) + 1;
        activeSegmentsByYear.set(year, active);
        maxActiveSegmentsByYear.set(
          year,
          Math.max(maxActiveSegmentsByYear.get(year) || 0, active)
        );

        await delay(delays[year]);
        profiles.push(makeBaseSegmentProfile(year, segment.segmentIndex));
        activeSegmentsByYear.set(year, active - 1);
      }

      completedYears.push(year);
      return profiles;
    },
  });

  assert.deepStrictEqual(startedYears, years);
  assert.deepStrictEqual(completedYears, [2023, 2022, 2021]);
  assert.deepStrictEqual(baseYearlyProfiles.map((item) => item.year), years);

  for (const year of years) {
    assert.strictEqual(maxActiveSegmentsByYear.get(year), 1);
  }

  const expectedYearlyProfiles = years.map((year) => ({
    year,
    baseSegmentProfiles: segmentInputs.map((segment) =>
      makeBaseSegmentProfile(year, segment.segmentIndex)
    ),
  }));
  const shadeMatrix = Array.from({ length: 12 }, () => Array(24).fill(0.5));
  const segmentMatrices = {
    0: shadeMatrix,
    1: shadeMatrix,
  };

  assert.deepStrictEqual(
    buildShadeStrengthV2FromYearlyProfiles({
      baseYearlyProfiles,
      segmentMatrices,
    }),
    buildShadeStrengthV2FromYearlyProfiles({
      baseYearlyProfiles: expectedYearlyProfiles,
      segmentMatrices,
    })
  );
}

async function testEmptyProductionYearIsFilteredInInputOrder() {
  const result = await buildBaseYearlyProfilesConcurrently({
    years: [2021, 2022, 2023],
    location: { lat: 51.5, lon: -0.1 },
    segmentInputs: [{ segmentIndex: 0 }],
    buildYear: async ({ year }) =>
      year === 2022 ? [] : [makeBaseSegmentProfile(year, 0)],
  });

  assert.deepStrictEqual(result.map((item) => item.year), [2021, 2023]);
}

async function testProductionYearFailureRejectsStage() {
  await assert.rejects(
    buildBaseYearlyProfilesConcurrently({
      years: [2021, 2022, 2023],
      location: { lat: 51.5, lon: -0.1 },
      segmentInputs: [{ segmentIndex: 0 }],
      buildYear: async ({ year }) => {
        if (year === 2022) {
          throw new Error("production year failed");
        }

        return [makeBaseSegmentProfile(year, 0)];
      },
    }),
    /production year failed/
  );
}

async function main() {
  await testGeoTiffConcurrencyAndMonthOrdering();
  await testGeoTiffFailureRejectsStage();
  await testProductionYearConcurrencyOrderingAndDeterminism();
  await testEmptyProductionYearIsFilteredInInputOrder();
  await testProductionYearFailureRejectsStage();
  console.log("Shade V2 P2 orchestration tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
