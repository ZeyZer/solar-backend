const assert = require("assert");

const {
  getTotalPvgisHourlyKWh,
  runHourlyModelsForYears,
} = require("./services/integrations/pvgisService");

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    async json() {
      return data;
    },
  };
}

function makeHourlyResponse() {
  return jsonResponse({
    outputs: {
      hourly: [
        {
          time: "20230101:0000",
          P: 1000,
        },
      ],
    },
  });
}

async function testResolvedLocationSkipsPostcodeLookup() {
  const originalFetch = global.fetch;
  const urls = [];

  global.fetch = async (url) => {
    urls.push(String(url));
    return makeHourlyResponse();
  };

  try {
    const result = await getTotalPvgisHourlyKWh({
      postcode: "SW1A 1AA",
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 35,
          shading: "none",
          panels: 2,
        },
      ],
      panelWatt: 400,
      year: 2023,
      resolvedLocation: {
        lat: 51.501,
        lon: -0.141,
      },
    });

    assert.strictEqual(urls.length, 1);
    assert.ok(urls[0].startsWith("https://re.jrc.ec.europa.eu/api/v5_3/seriescalc"));
    assert.ok(!urls.some((url) => url.includes("api.postcodes.io")));
    assert.deepStrictEqual(result.pvHourly, [1]);
    assert.strictEqual(result.roofProfiles[0].shadingDerate, 1);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testLegacyPostcodeLookupStillWorks() {
  const originalFetch = global.fetch;
  const urls = [];

  global.fetch = async (url) => {
    const requestUrl = String(url);
    urls.push(requestUrl);

    if (requestUrl.includes("api.postcodes.io")) {
      return jsonResponse({
        status: 200,
        result: {
          latitude: 51.501,
          longitude: -0.141,
        },
      });
    }

    return makeHourlyResponse();
  };

  try {
    const result = await getTotalPvgisHourlyKWh({
      postcode: "SW1A 1AA",
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 35,
          shading: "some",
          panels: 2,
        },
      ],
      panelWatt: 400,
      year: 2023,
    });

    assert.strictEqual(urls.length, 2);
    assert.ok(urls[0].includes("api.postcodes.io"));
    assert.ok(urls[1].startsWith("https://re.jrc.ec.europa.eu/api/v5_3/seriescalc"));
    assert.deepStrictEqual(result.pvHourly, [0.9]);
    assert.strictEqual(result.roofProfiles[0].shadingDerate, 0.9);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testConcurrentYearsPreserveInputOrder() {
  const startedYears = [];
  const completedYears = [];
  const delays = {
    2021: 30,
    2022: 20,
    2023: 10,
  };
  const input = { postcode: "SW1A 1AA", roofs: [{ id: "roof-1" }] };
  const resolvedLocation = { lat: 51.501, lon: -0.141 };

  const results = await runHourlyModelsForYears({
    years: [2021, 2022, 2023],
    input,
    panelWatt: 400,
    includeHourlyArrays: true,
    resolvedLocation,
    runYear: async (args) => {
      startedYears.push(args.year);
      assert.strictEqual(args.input, input);
      assert.strictEqual(args.panelWatt, 400);
      assert.strictEqual(args.includeHourlyArrays, true);
      assert.strictEqual(args.resolvedLocation, resolvedLocation);

      await new Promise((resolve) => setTimeout(resolve, delays[args.year]));
      completedYears.push(args.year);
      return { year: args.year };
    },
  });

  assert.deepStrictEqual(startedYears, [2021, 2022, 2023]);
  assert.deepStrictEqual(completedYears, [2023, 2022, 2021]);
  assert.deepStrictEqual(results.map((result) => result.year), [2021, 2022, 2023]);
}

async function testYearFailureRejectsWholeOperation() {
  await assert.rejects(
    runHourlyModelsForYears({
      years: [2021, 2022, 2023],
      input: { postcode: "SW1A 1AA", roofs: [] },
      panelWatt: 400,
      resolvedLocation: { lat: 51.501, lon: -0.141 },
      runYear: async ({ year }) => {
        if (year === 2022) {
          throw new Error("year failed");
        }

        return { year };
      },
    }),
    /year failed/
  );
}

async function main() {
  await testResolvedLocationSkipsPostcodeLookup();
  await testLegacyPostcodeLookupStillWorks();
  await testConcurrentYearsPreserveInputOrder();
  await testYearFailureRejectsWholeOperation();
  console.log("PVGIS performance orchestration tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
