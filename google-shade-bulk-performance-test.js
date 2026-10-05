const assert = require("assert");

const {
  readShadeFractionsForPoint,
  readShadeFractionsForPoints,
  averageHourlyFractions,
} = require("./services/roof/googleHourlyShadeFactorCoreService");

const {
  processGeoTiffMonthsInBatches,
} = require("./services/roof/googleHourlyShadeFactorRuntimeService");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rasterValue(hour, x, y) {
  if (hour === 5 && x === 4 && y === 3) {
    return -9999;
  }

  return (1 << ((hour + x + y) % 28)) - 1;
}

function createMockImage() {
  const calls = [];

  return {
    calls,
    getWidth: () => 10,
    getHeight: () => 10,
    getBoundingBox: () => [0, 0, 10, 10],
    getGeoKeys: () => ({ GeographicTypeGeoKey: 4326 }),
    readRasters: async ({ window }) => {
      calls.push(window);
      const [minX, minY, maxX, maxY] = window;
      const rasters = [];

      for (let hour = 0; hour < 24; hour += 1) {
        const band = [];

        for (let y = minY; y < maxY; y += 1) {
          for (let x = minX; x < maxX; x += 1) {
            band.push(rasterValue(hour, x, y));
          }
        }

        rasters.push(band);
      }

      return rasters;
    },
  };
}

async function legacyResultsForPoints(points, monthIndex) {
  const image = createMockImage();
  const results = [];

  for (const point of points) {
    results.push(
      await readShadeFractionsForPoint({
        image,
        ...point,
        monthIndex,
      })
    );
  }

  return { results, calls: image.calls };
}

async function testBulkMatchesLegacyExactly() {
  const points = [
    { lat: 8.2, lon: 1.4 },
    { lat: 6.1, lon: 4.7 },
    { lat: 7.4, lon: 2.6 },
    { lat: 8.2, lon: 1.4 },
    { lat: 20, lon: 20 },
  ];
  const monthIndex = 0;
  const image = createMockImage();

  const bulkResults = await readShadeFractionsForPoints({
    image,
    points,
    monthIndex,
  });
  const legacy = await legacyResultsForPoints(points, monthIndex);

  assert.strictEqual(image.calls.length, 1);
  assert.deepStrictEqual(image.calls[0], [1, 1, 5, 4]);
  assert.strictEqual(legacy.calls.length, 4);
  assert.deepStrictEqual(bulkResults, legacy.results);
  assert.strictEqual(bulkResults.length, points.length);
  assert.deepStrictEqual(bulkResults[0], bulkResults[3]);
  assert.strictEqual(bulkResults[4].fractions, null);
  assert.strictEqual(bulkResults[4].debug.reason, "coordinate_outside_bbox");
  assert.strictEqual(bulkResults[1].fractions.length, 24);
  assert.strictEqual(bulkResults[1].fractions[5], null);

  assert.deepStrictEqual(
    averageHourlyFractions(bulkResults.filter((result) => result.fractions).map((result) => result.fractions)),
    averageHourlyFractions(legacy.results.filter((result) => result.fractions).map((result) => result.fractions))
  );
}

async function testNoValidPointsSkipsRasterRead() {
  const image = createMockImage();
  const points = [
    { lat: -1, lon: -1 },
    { lat: 20, lon: 20 },
  ];

  const results = await readShadeFractionsForPoints({
    image,
    points,
    monthIndex: 6,
  });

  assert.strictEqual(image.calls.length, 0);
  assert.strictEqual(results.length, 2);
  assert(results.every((result) => result.fractions === null));
  assert(results.every((result) => result.debug.reason === "coordinate_outside_bbox"));
}

async function testOneBulkReadPerOrderedMonthWithBoundedDownloads() {
  const urls = Array.from({ length: 12 }, (_, monthIndex) => `month-${monthIndex}`);
  const processedMonths = [];
  const images = [];
  let activeDownloads = 0;
  let maxActiveDownloads = 0;

  await processGeoTiffMonthsInBatches({
    hourlyShadeUrls: urls,
    apiKey: "test-key",
    fetchImage: async (url) => {
      const monthIndex = Number(url.split("-")[1]);
      activeDownloads += 1;
      maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
      await delay((2 - (monthIndex % 3)) * 2);
      activeDownloads -= 1;
      const image = createMockImage();
      images[monthIndex] = image;
      return image;
    },
    processImage: async ({ image, monthIndex }) => {
      await readShadeFractionsForPoints({
        image,
        points: [
          { lat: 8.2, lon: 1.4 },
          { lat: 6.1, lon: 4.7 },
          { lat: 7.4, lon: 2.6 },
        ],
        monthIndex,
      });
      processedMonths.push(monthIndex);
    },
  });

  assert(maxActiveDownloads <= 3);
  assert.strictEqual(maxActiveDownloads, 3);
  assert.deepStrictEqual(processedMonths, Array.from({ length: 12 }, (_, index) => index));
  assert(images.every((image) => image.calls.length === 1));
}

async function main() {
  await testBulkMatchesLegacyExactly();
  await testNoValidPointsSkipsRasterRead();
  await testOneBulkReadPerOrderedMonthWithBoundedDownloads();
  console.log("Google shade bulk sampling tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
