const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");

const phaseTokens = {
  googleMs: "google",
  googleHeadersMs: "google_headers",
  googleBodyMs: "google_body",
  googleParseMs: "google_parse",
  normaliseMs: "normalise",
  boundaryMs: "boundary",
  selectionMs: "selection",
};

const jsonEscapes = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026" };

function diagnosticsEnabled() {
  return process.env.ROOF_PERF_DIAGNOSTICS === "1";
}

function measurePhase(target, phase, work) {
  if (!target) {
    return work();
  }

  const start = performance.now();
  try {
    return work();
  } finally {
    target[phase] = performance.now() - start;
  }
}

function allowedTimingOrigin(origin) {
  if (!origin) {
    return false;
  }

  const configured = [
    process.env.FRONTEND_URL,
    process.env.PDF_FRONTEND_URL,
    ...(process.env.ROOF_PERF_ALLOWED_ORIGINS || "").split(","),
  ];
  const local = process.env.NODE_ENV !== "production" &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  return local || configured.some((value) => value?.trim() === origin);
}

function createRoofPerformanceMiddleware() {
  let firstProcessRequest = true;
  let firstRoofRequest = true;

  return (req, res, next) => {
    const isFirstProcessRequest = firstProcessRequest;
    firstProcessRequest = false;

    if (!diagnosticsEnabled() || req.method !== "POST" ||
        !/^\/api\/solar-roof\/building-insights(?:\/batch)?\/?$/i.test(req.path)) {
      return next();
    }

    const timing = {
      requestId: randomUUID(),
      startedAt: performance.now(),
      processUptimeMs: process.uptime() * 1000,
      firstProcessRequest: isFirstProcessRequest,
      firstRoofRequest,
      targets: [],
    };
    firstRoofRequest = false;
    res.locals.roofPerformance = timing;

    res.set("X-Roof-Request-Id", timing.requestId);
    res.vary("Origin");
    if (allowedTimingOrigin(req.get("Origin"))) {
      res.set("Timing-Allow-Origin", req.get("Origin"));
      res.append("Access-Control-Expose-Headers", "Server-Timing, X-Roof-Request-Id");
    }

    const log = (closedEarly) => {
      console.info("[roof-perf]", JSON.stringify({
        requestId: timing.requestId,
        processUptimeMs: timing.processUptimeMs,
        firstProcessRequest: timing.firstProcessRequest,
        firstRoofRequest: timing.firstRoofRequest,
        status: res.statusCode,
        outcome: closedEarly ? "client_closed" : timing.outcome || "unmeasured_response",
        totalMs: performance.now() - timing.startedAt,
        handlerMs: timing.handlerMs,
        serializeMs: timing.serializeMs,
        payloadBytes: timing.payloadBytes,
        targetCount: timing.targets.length,
        targets: timing.targets,
      }));
    };
    res.once("finish", () => log(false));
    res.once("close", () => {
      if (!res.writableFinished) {
        log(true);
      }
    });

    return next();
  };
}

function startTargetTiming(timing) {
  if (!timing) {
    return undefined;
  }

  const target = { index: timing.targets.length };
  timing.targets.push(target);
  return target;
}

function sendRoofJson(res, data, outcome) {
  const timing = res.locals.roofPerformance;
  if (!timing) {
    return res.json(data);
  }

  // Match Express JSON settings and serialize once, before sending timing headers.
  const body = measurePhase(timing, "serializeMs", () => {
    const json = JSON.stringify(data, res.app.get("json replacer"), res.app.get("json spaces"));
    return res.app.get("json escape")
      ? json.replace(/[<>&]/g, (character) => jsonEscapes[character])
      : json;
  });

  timing.outcome = outcome;
  timing.payloadBytes = Buffer.byteLength(body);
  timing.handlerMs = performance.now() - timing.startedAt;
  const phases = [
    ["roof", timing.handlerMs],
    ["serialize", timing.serializeMs],
  ];

  for (const [field, token] of Object.entries(phaseTokens)) {
    const measured = timing.targets.filter((target) => Number.isFinite(target[field]));
    if (measured.length) {
      phases.push([token, measured.reduce((sum, target) => sum + target[field], 0)]);
    }
  }

  res.set("Server-Timing", phases.map(([name, ms]) => `${name};dur=${ms.toFixed(2)}`).join(", "));
  if (!res.get("Content-Type")) {
    res.type("application/json");
  }
  return res.send(body);
}

module.exports = {
  createRoofPerformanceMiddleware,
  diagnosticsEnabled,
  measurePhase,
  sendRoofJson,
  startTargetTiming,
};
