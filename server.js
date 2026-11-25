// backend/server.js
require("dotenv").config({
  path: process.env.NODE_ENV === "production" ? ".env" : ".env.local",
});

const express = require("express");
const cors = require("cors");
const {
  createRoofPerformanceMiddleware,
  diagnosticsEnabled,
} = require("./services/roof/roofPerformance");

const app = express();
const PORT = process.env.PORT || 4000;


// ======== ROUTES =========
const leadRoutes = require("./routes/leadRoutes");
const pdfRoutes = require("./routes/pdfRoutes");
const quoteRecalcRoutes = require("./routes/quoteRecalcRoutes");
const quoteRoutes = require("./routes/quoteRoutes");
const solarRoofRoutes = require("./routes/solarRoofRoutes");

// ====== EXPRESS SETUP ======
app.use(createRoofPerformanceMiddleware());
app.use(cors());

const parseJson = express.json({ limit: "2mb" });
app.use((req, res, next) => {
  parseJson(req, res, (error) => {
    if (!error) {
      return next();
    }

    // Parser errors can carry submitted text in both the message and stack.
    const parserStatus = error.status;
    const status = Number.isInteger(parserStatus) && parserStatus >= 400 && parserStatus <= 599
      ? parserStatus
      : 500;
    const message = status === 413
      ? "JSON request body is too large."
      : status === 415
        ? "Unsupported JSON request body encoding."
        : status >= 500
          ? "Could not read the JSON request body."
          : "Invalid JSON request body.";

    if (res.locals.roofPerformance) {
      res.locals.roofPerformance.outcome = "json_parser_error";
    }

    return res.status(status).json({ success: false, error: message });
  });
});

app.use("/api/lead", leadRoutes);
app.use("/api/quote", pdfRoutes);
app.use("/api/quote", quoteRecalcRoutes);
app.use("/api/quote", quoteRoutes);
app.use("/api/solar-roof", solarRoofRoutes);


// ====== ROUTES ======
app.get("/", (req, res) => {
  res.send("Solar quote API is running");
});


app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  if (diagnosticsEnabled()) {
    console.info("[roof-perf startup]", JSON.stringify({
      processUptimeMs: process.uptime() * 1000,
    }));
  }
});
