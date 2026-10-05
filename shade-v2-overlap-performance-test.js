const assert = require("assert");

const {
  startSettledShadeStrengthV2Runtime,
} = require("./routes/quoteRoutes");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function testRuntimeOverlapsBaseWorkAndIsReused() {
  const runtimeGate = deferred();
  const baseGate = deferred();
  const years = [2021, 2022, 2023];
  const runtime = { status: "complete", marker: "precomputed-runtime" };
  const timeline = [];
  let runtimeCalls = 0;
  let capturedRuntimeArgs;

  const prestarted = startSettledShadeStrengthV2Runtime({
    enabled: true,
    input: {
      postcode: "SW1A 1AA",
      roofs: [{ id: "roof-1" }],
    },
    panelWatt: 465,
    years,
    runtimeBuilder: async (args) => {
      runtimeCalls += 1;
      capturedRuntimeArgs = args;
      timeline.push("shade-start");
      await runtimeGate.promise;
      timeline.push("shade-finish");
      return runtime;
    },
  });

  const baseWork = (async () => {
    timeline.push("base-start");
    await baseGate.promise;
    timeline.push("base-finish");
    return {
      model: "hourly_pvgis_3yr_avg_2021_2023",
      years: [...years],
      annualGenerationKWh: 4564,
    };
  })();

  assert.deepStrictEqual(timeline, ["shade-start", "base-start"]);

  runtimeGate.resolve();
  await runtimeGate.promise;
  baseGate.resolve();
  const hourlyModel = await baseWork;

  timeline.push("candidate-start");
  assert(hourlyModel);
  const candidateRuntime = await prestarted.dependency();
  timeline.push("candidate-finish");

  assert.strictEqual(candidateRuntime, runtime);
  assert.strictEqual(runtimeCalls, 1);
  assert.deepStrictEqual(capturedRuntimeArgs.years, years);
  assert.deepStrictEqual(hourlyModel, {
    model: "hourly_pvgis_3yr_avg_2021_2023",
    years: [2021, 2022, 2023],
    annualGenerationKWh: 4564,
  });
  assert(timeline.indexOf("candidate-start") > timeline.indexOf("base-finish"));
}

async function testRuntimeFailureIsHandledAndRethrownLater() {
  const expectedError = new Error("shade runtime failed");
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);

  try {
    const prestarted = startSettledShadeStrengthV2Runtime({
      enabled: true,
      input: {
        postcode: "SW1A 1AA",
        roofs: [{ id: "roof-1" }],
      },
      panelWatt: 465,
      years: [2021, 2022, 2023],
      runtimeBuilder: async () => {
        throw expectedError;
      },
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(unhandled, []);

    let candidateOutcome;
    try {
      await prestarted.dependency();
      candidateOutcome = { status: "complete" };
    } catch (error) {
      candidateOutcome = {
        status: "fallback",
        reason: error.message,
      };
    }

    assert.deepStrictEqual(candidateOutcome, {
      status: "fallback",
      reason: "shade runtime failed",
    });
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
}

async function testDisabledOrIneligibleRuntimeDoesNotStart() {
  let runtimeCalls = 0;
  const runtimeBuilder = async () => {
    runtimeCalls += 1;
    return { status: "complete" };
  };

  assert.strictEqual(
    startSettledShadeStrengthV2Runtime({
      enabled: false,
      input: { postcode: "SW1A 1AA", roofs: [{ id: "roof-1" }] },
      panelWatt: 465,
      years: [2021, 2022, 2023],
      runtimeBuilder,
    }),
    null
  );

  assert.strictEqual(
    startSettledShadeStrengthV2Runtime({
      enabled: true,
      input: { postcode: "SW1A 1AA", roofs: [] },
      panelWatt: 465,
      years: [2021, 2022, 2023],
      runtimeBuilder,
    }),
    null
  );

  assert.strictEqual(runtimeCalls, 0);
}

async function main() {
  await testRuntimeOverlapsBaseWorkAndIsReused();
  await testRuntimeFailureIsHandledAndRethrownLater();
  await testDisabledOrIneligibleRuntimeDoesNotStart();
  console.log("Shade V2 P4 overlap tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
