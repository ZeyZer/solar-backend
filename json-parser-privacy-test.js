const assert = require("node:assert/strict");
const http = require("node:http");
const { Duplex } = require("node:stream");
const { test } = require("node:test");
const dotenv = require("dotenv");

const roofPath = "/api/solar-roof/building-insights/batch";
const privateMarker = "ROOF-PRIVATE-FIXTURE";
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

// Exercise real Express and Node HTTP request/response streams without opening a port.
function request(app, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, done) {
        chunks.push(chunk);
        done();
      },
    });
    const req = new http.IncomingMessage(socket);
    Object.assign(req, {
      method: "POST",
      url: path,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        ...extraHeaders,
      },
    });
    const res = new http.ServerResponse(req);
    res.assignSocket(socket);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`In-memory response did not finish (status ${res.statusCode}, bytes ${chunks.length})`));
    }, 3000);
    res.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    res.once("finish", () => {
      clearTimeout(timeout);
      const response = Buffer.concat(chunks).toString("utf8");
      const bodyStart = response.indexOf("\r\n\r\n") + 4;
      resolve({
        status: res.statusCode,
        headers: res.getHeaders(),
        body: response.slice(bodyStart),
        response,
      });
      socket.destroy();
    });

    app(req, res);
    req.push(body);
    req.complete = true;
    req.push(null);
  });
}

test("production JSON parser returns safe errors with diagnostics off and on", async (t) => {
  const keys = ["NODE_ENV", "ROOF_PERF_DIAGNOSTICS", "GOOGLE_SOLAR_API_KEY"];
  const previousEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });
  process.env.NODE_ENV = "production";
  process.env.GOOGLE_SOLAR_API_KEY = "fixture-key";

  // Keep test configuration isolated from the local .env file.
  t.mock.method(dotenv, "config", () => ({}));
  let app;
  t.mock.method(http.Server.prototype, "listen", function () {
    [app] = this.listeners("request");
    return this;
  });
  require("./server");
  assert.equal(app.get("env"), "production");

  app.post("/test-unrelated-error", (_req, _res, next) => {
    next(new Error("unrelated-runtime-error"));
  });

  const provider = t.mock.method(global, "fetch", async () => new Response(
    JSON.stringify({ name: "fixture-provider-building", solarPotential: {} })
  ));
  const stdout = [];
  const stderr = [];
  const out = t.mock.method(process.stdout, "write", (chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  const err = t.mock.method(process.stderr, "write", (chunk) => {
    stderr.push(String(chunk));
    return true;
  });

  try {
    for (const enabled of ["0", "1"]) {
      process.env.ROOF_PERF_DIAGNOSTICS = enabled;
      const previousCalls = provider.mock.callCount();
      const [outStart, errStart] = [stdout.length, stderr.length];
      const valid = await request(app, roofPath, JSON.stringify({
        solarTargetBuildings: [{ latitude: 51, longitude: 0 }],
      }));
      const malformed = await request(app, roofPath, privateMarker);
      const oversized = await request(app, roofPath, JSON.stringify({
        fixture: privateMarker + "x".repeat(2 * 1024 * 1024),
      }));
      const unsupported = await request(app, roofPath, "{}", {
        "content-encoding": privateMarker,
      });
      await nextTurn();

      assert.equal(valid.status, 200);
      assert.equal(JSON.parse(valid.body).summary.uniqueBuildingsReturned, 1);
      assert.equal(provider.mock.callCount(), previousCalls + 1);
      assert.equal(Boolean(valid.headers["server-timing"]), enabled === "1");

      const failures = [
        [malformed, 400, "Invalid JSON request body."],
        [oversized, 413, "JSON request body is too large."],
        [unsupported, 415, "Unsupported JSON request body encoding."],
      ];
      for (const [failure, status, message] of failures) {
        assert.equal(failure.status, status);
        assert.match(failure.headers["content-type"], /^application\/json/);
        assert.deepEqual(JSON.parse(failure.body), { success: false, error: message });
        assert.equal(failure.response.includes(privateMarker), false);
        assert.equal(Boolean(failure.headers["x-roof-request-id"]), enabled === "1");
      }

      const capturedOut = stdout.slice(outStart).join("");
      const capturedErr = stderr.slice(errStart).join("");
      assert.equal(capturedOut.includes(privateMarker), false);
      assert.equal(capturedErr, "");
      assert.equal(capturedOut.includes("json_parser_error"), enabled === "1");
    }

    const unrelated = await request(app, "/test-unrelated-error", "{}");
    await nextTurn();
    assert.equal(unrelated.status, 500);
    assert.equal(unrelated.body.includes("unrelated-runtime-error"), false);
    assert.equal(stderr.some((line) => line.includes("unrelated-runtime-error")), true);
  } finally {
    out.mock.restore();
    err.mock.restore();
  }
});
