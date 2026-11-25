const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const express = require("express");
const routes = require("./routes/solarRoofRoutes");
const { createRoofPerformanceMiddleware } = require("./services/roof/roofPerformance");

function runRoute(middleware, path, origin, body, app) {
  const headers = new Map();
  const req = {
    method: "POST",
    path: `/api/solar-roof${path}`,
    body,
    get: (name) => name === "Origin" ? origin : undefined,
  };

  const res = new EventEmitter();
  Object.assign(res, {
    app,
    locals: {},
    statusCode: 200,
    json: express.response.json,
    getHeader: (name) => headers.get(name.toLowerCase()),
    setHeader: (name, value) => headers.set(name.toLowerCase(), value),
    get: express.response.get,
    set: express.response.set,
    append: express.response.append,
    type: express.response.type,
    vary: express.response.vary,
    status: express.response.status,
    send(json) {
      this.body = json;
      this.emit("finish");
      return this;
    },
  });

  const route = routes.stack.find((layer) => layer.route.path === path);
  return Promise.resolve(middleware(req, res, () => route.route.stack[0].handle(req, res)))
    .then(() => ({ res, headers }));
}

test("instrumented roof routes preserve JSON, record phases, and scope timing exposure", async (t) => {
  const origin = "https://qa.example.test";
  const priorFlag = process.env.ROOF_PERF_DIAGNOSTICS;
  const priorOrigins = process.env.ROOF_PERF_ALLOWED_ORIGINS;
  t.after(() => {
    if (priorFlag === undefined) delete process.env.ROOF_PERF_DIAGNOSTICS;
    else process.env.ROOF_PERF_DIAGNOSTICS = priorFlag;
    if (priorOrigins === undefined) delete process.env.ROOF_PERF_ALLOWED_ORIGINS;
    else process.env.ROOF_PERF_ALLOWED_ORIGINS = priorOrigins;
  });
  process.env.ROOF_PERF_ALLOWED_ORIGINS = origin;
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "log", () => {});
  // The Google service reads the configured key even when fetch is mocked.
  t.mock.method(global, "fetch", async (url) => {
    const latitude = new URL(url).searchParams.get("location.latitude");
    if (latitude === "53") {
      return new Response(JSON.stringify({ error: {
        status: "UNAVAILABLE", message: "sensitive-provider-marker",
      } }), { status: 503 });
    }
    return new Response(JSON.stringify({
      name: "private-building-marker",
      solarPotential: {
        solarPanels: [
          { center: { latitude: 51, longitude: 0 }, segmentIndex: 0, yearlyEnergyDcKwh: 100 },
          { center: { latitude: 51, longitude: 2 }, segmentIndex: 0, yearlyEnergyDcKwh: 90 },
        ],
        solarPanelConfigs: [],
      },
    }));
  });
  const previousKey = process.env.GOOGLE_SOLAR_API_KEY;
  process.env.GOOGLE_SOLAR_API_KEY = "fixture-key";
  t.after(() => {
    if (previousKey === undefined) delete process.env.GOOGLE_SOLAR_API_KEY;
    else process.env.GOOGLE_SOLAR_API_KEY = previousKey;
  });

  const app = express();
  app.set("json escape", true);
  app.set("json spaces", 2);
  const middleware = createRoofPerformanceMiddleware();
  const path = "/building-insights/batch";
  const body = {
    propertyBoundary: { boundaryLines: [[{ lat: 50, lng: 1 }, { lat: 54, lng: 1 }]] },
    solarTargetBuildings: [
      { latitude: 51, longitude: 0, label: "sensitive<é>&" },
      { latitude: 52, longitude: 0 },
      { latitude: 53, longitude: 0 },
    ],
  };

  process.env.ROOF_PERF_DIAGNOSTICS = "0";
  const baseline = await runRoute(middleware, path, origin, body, app);
  assert.equal(baseline.headers.has("server-timing"), false);
  assert.equal(console.info.mock.callCount(), 0);

  process.env.ROOF_PERF_DIAGNOSTICS = "1";
  const enabled = await runRoute(middleware, path, origin, body, app);
  assert.equal(enabled.res.body, baseline.res.body);
  const [model] = JSON.parse(enabled.res.body).solarBuildingModels;
  assert.equal(model.propertyBoundaryFilter.keptPanelCount, 1);
  assert.equal(model.propertyBoundaryFilter.excludedPanelCount, 1);
  assert.equal(enabled.res.statusCode, baseline.res.statusCode);
  assert.equal(global.fetch.mock.callCount(), 6);
  assert.equal(enabled.headers.get("timing-allow-origin"), origin);
  assert.match(enabled.headers.get("access-control-expose-headers"), /X-Roof-Request-Id/);
  assert.match(enabled.headers.get("vary"), /Origin/);
  const header = enabled.headers.get("server-timing");
  for (const name of ["roof", "serialize", "google", "google_headers", "google_body",
    "google_parse", "normalise", "boundary", "selection"]) {
    assert.match(header, new RegExp(`(?:^|, )${name};dur=\\d+\\.\\d+`));
  }

  const log = console.info.mock.calls[0].arguments[1];
  const record = JSON.parse(log);
  assert.equal(record.requestId, enabled.headers.get("x-roof-request-id"));
  assert.equal(record.firstProcessRequest, false);
  assert.equal(record.firstRoofRequest, true);
  assert.equal(record.payloadBytes, Buffer.byteLength(enabled.res.body));
  assert.equal(record.outcome, "target_failure");
  assert.deepEqual(record.targets.map((target) => target.outcome), ["found", "duplicate", "failed"]);
  assert.ok(record.totalMs >= record.handlerMs);
  assert.doesNotMatch(log, /sensitive|private-building-marker|fixture-key|latitude|longitude/);

  const denied = await runRoute(middleware, "/building-insights", "https://denied.example.test",
    body.solarTargetBuildings[0], app);
  assert.equal(denied.headers.has("timing-allow-origin"), false);
  assert.equal(denied.headers.has("access-control-expose-headers"), false);
  assert.equal(JSON.parse(console.info.mock.calls[1].arguments[1]).firstRoofRequest, false);
});
