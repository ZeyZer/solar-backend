// backend/server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 4000;
const pdfQuoteDataById = new Map();

// ======== IMPORTED FUNCTIONS, FILES & ROUTES =========
// MCS TABLES
const MCS_TABLES = require("./data/mcs_self_consumption_tables.json")?.tables;

// POSTCODE HELPERS
const {validateAndNormalisePostcode, getPostcodeArea,} = require("./utils/postcodeUtils");

// QUOTE CONFIG
const { CONFIG } = require("./config/quoteConfig");

// LEAD STORAGE
const {readLeads, saveLeads,} = require("./services/leadStorageService");

// LEAD CAPTURE AND EMAILS
const leadRoutes = require("./routes/leadRoutes");

// PDF SETUP
const pdfRoutes = require("./routes/pdfRoutes");

// TARIFF STUFF
const {normalizeTariff, isRetailRateTariff, computeHourlyBilling,} = require("./services/tariffService");

// LOAD PROFILES
const {buildDailyUsageProfile, buildHourlyLoadForSeries,} = require("./services/loadProfileService");

// FINANCIAL SERVICES
const {round2, solarDegradationMultiplier, makePaybackAndLifetimeSeries,} = require("./services/financialService");

// BATTERY RECOMMENDATIONS CALCULATIONS
const {buildBatteryRecommendations,} = require("./services/batteryRecommendationService");

// BATTERY SIMULATIONS
const {simulateHourByHour,} = require("./services/batterySimulationService");

// PVGIS SERVICES
const {PVGIS, orientationToPvgisAspect, getLatLonFromUkPostcode, getPvgisAnnualKWhForRoof, getTotalPvgisAnnualKWh, getTotalPvgisHourlyKWh,} = require("./services/pvgisService");

// RECALC IMPORT
const quoteRecalcRoutes = require("./routes/quoteRecalcRoutes");

// DAY SLICE SERVICE
const {extractDaySlice,} = require("./services/hourlyDebugService");

// QUOTE CALCULATIONS
const {calculateQuote,} = require("./services/quoteBaseService");

// MAIN QUOTE
const quoteRoutes = require("./routes/quoteRoutes");



// ====== EXPRESS SETUP ======
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/api/lead", leadRoutes);
app.use("/api/quote", pdfRoutes);
app.use("/api/quote", quoteRecalcRoutes);
app.use("/api/quote", quoteRoutes);


console.log("[MCS] Loaded tables keys:", MCS_TABLES ? Object.keys(MCS_TABLES) : "❌ NOT LOADED");

// ====== LEADS STORAGE SETUP ======
const LEADS_FILE = path.join(__dirname, "leads.json");


// ====== TARIFF SETUP ======
function getTariffPreset(type = "standard") {
  // Rates in £/kWh (not pence)
  if (type === "overnight") {
    return {
      type: "overnight",
      name: "Cheap overnight",
      importDay: 0.28,
      importNight: 0.08,
      nightStartHour: 0,
      nightEndHour: 7, // 00:00–07:00
      exportFlat: 0.12,
      gridChargeEnabled: false,
      gridChargeTargetPct: 80, // default
    };
  }

  if (type === "flux") {
    return {
      type: "flux",
      name: "Time-of-use (Flux style)",
      // simple 3-band example — you can adjust later
      importOffPeak: 0.15, // e.g., night
      importDay: 0.28,
      importPeak: 0.40,    // evening peak
      exportOffPeak: 0.08,
      exportDay: 0.15,
      exportPeak: 0.30,
      offPeakStartHour: 0,
      offPeakEndHour: 6,   // 00:00–06:00
      peakStartHour: 16,
      peakEndHour: 19,     // 16:00–19:00
      gridChargeEnabled: false,
      gridChargeTargetPct: 70,
    };
  }

  // default: standard variable
  return {
    type: "standard",
    name: "Standard variable",
    importFlat: 0.28,
    exportFlat: 0.12,
    gridChargeEnabled: false,
    gridChargeTargetPct: 0,
  };
}

function daysInYear(year) {
  // leap year if divisible by 4 and (not by 100 unless by 400)
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  return isLeap ? 366 : 365;
}


function softenMorningPeakHourly(fractions24, startHour = 6, endHour = 9, factor = 0.75) {
  // Reduces demand between startHour..endHour inclusive by factor (e.g. 0.75 = 25% reduction)
  const out = fractions24.slice();
  for (let h = startHour; h <= endHour; h++) {
    out[h] = (Number(out[h]) || 0) * factor;
  }
  return normalizeToOne(out);
}


function average8760Arrays(hourlyYearData) {
  if (!Array.isArray(hourlyYearData) || hourlyYearData.length === 0) {
    throw new Error("No hourlyYearData available for averaging");
  }

  const nYears = hourlyYearData.length;
  const base = hourlyYearData[0];

  const len = base.pvHourlyKWh.length;

  const avgPV = Array(len).fill(0);
  const avgLoad = Array(len).fill(0);

  for (const yd of hourlyYearData) {
    for (let i = 0; i < len; i++) {
      avgPV[i] += Number(yd.pvHourlyKWh[i] || 0);
      avgLoad[i] += Number(yd.loadHourlyKWh[i] || 0);
    }
  }

  for (let i = 0; i < len; i++) {
    avgPV[i] /= nYears;
    avgLoad[i] /= nYears;
  }

  return {
    pvHourlyKWh: avgPV,
    loadHourlyKWh: avgLoad,
    monthIdx: base.monthIdx,
    hourOfDay: base.hourOfDay,
  };
}

function averageHourlyArrays(listOf8760) {
  if (!Array.isArray(listOf8760) || listOf8760.length === 0) return null;
  const n = listOf8760[0]?.length || 0;
  if (n === 0) return null;

  const out = Array(n).fill(0);
  for (const arr of listOf8760) {
    if (!Array.isArray(arr) || arr.length !== n) return null;
    for (let i = 0; i < n; i++) out[i] += Number(arr[i] || 0);
  }
  for (let i = 0; i < n; i++) out[i] /= listOf8760.length;
  return out;
}


function averageMonthlyArrays(monthlyArrays) {
  // monthlyArrays: [ [12], [12], [12] ... ]
  if (!Array.isArray(monthlyArrays) || monthlyArrays.length === 0) return Array(12).fill(0);

  const out = Array(12).fill(0);
  const n = monthlyArrays.length;

  for (const arr of monthlyArrays) {
    for (let i = 0; i < 12; i++) {
      out[i] += Number(arr?.[i] || 0);
    }
  }

  return out.map((v) => Math.round((v / n) * 100) / 100); // keep 2dp
}

function sum12(arr) {
  return (arr || []).reduce((s, v) => s + Number(v || 0), 0);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// ===============================
// Heuristic battery uplift shaped like MCS tables
// ===============================

// simple linear interpolation
function lerp(x, x1, y1, x2, y2) {
  if (x <= x1) return y1;
  if (x >= x2) return y2;
  return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
}

// piecewise interpolation based on ratio points
function piecewiseRatioValue(ratio, points) {
  if (ratio <= points[0].r) return points[0].v;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (ratio >= a.r && ratio <= b.r) {
      return lerp(ratio, a.r, a.v, b.r, b.v);
    }
  }
  return points[points.length - 1].v;
}

// MCS-shaped battery uplift curve
function batteryUpliftMcsTrend({ occupancyProfile, ratio, batteryKWh }) {
  const b = Math.max(0, Number(batteryKWh || 0));
  if (b <= 0) return 0;

  const r = Math.max(0.5, Math.min(2, Number(ratio || 1)));

  let scale;
  let points;

  switch (occupancyProfile) {
    case "home_all_day":
      scale = 2.4;
      points = [
        { r: 0.6, v: 0.49 },
        { r: 0.9, v: 0.46 },
        { r: 1.1, v: 0.41 },
        { r: 1.35, v: 0.37 },
        { r: 1.75, v: 0.30 },
      ];
      break;

    case "out_all_day":
      scale = 4.3;
      points = [
        { r: 0.6, v: 0.68 },
        { r: 0.9, v: 0.64 },
        { r: 1.1, v: 0.58 },
        { r: 1.35, v: 0.47 },
        { r: 1.75, v: 0.38 },
      ];
      break;

    default: // half_day
      scale = 3.0;
      points = [
        { r: 0.6, v: 0.57 },
        { r: 0.9, v: 0.53 },
        { r: 1.1, v: 0.48 },
        { r: 1.35, v: 0.41 },
        { r: 1.75, v: 0.34 },
      ];
      break;
  }

  const maxAdd = piecewiseRatioValue(r, points);

  // Saturating curve (fast early gains, diminishing returns)
  const uplift = maxAdd * (1 - Math.exp(-b / scale));

  return Math.max(0, Math.min(uplift, 0.80));
}


function getOccupancyKey(occupancyProfile) {
  // map your frontend values -> JSON keys (adjust if needed)
  switch (occupancyProfile) {
    case "home_all_day":
      return "home_all_day";
    case "half_day":
      return "half_day";
    case "out_all_day":
      return "out_all_day";
    default:
      return "half_day";
  }
}

// Pick the matching consumption band table for a given annual consumption
function pickConsumptionBand(tablesForOcc, annualConsumptionKWh) {
  if (!Array.isArray(tablesForOcc) || tablesForOcc.length === 0) return null;

  // Try to find band where min <= consumption <= max
  const match = tablesForOcc.find((t) => {
    const min = Number(t?.consumption_min_kwh);
    const max = Number(t?.consumption_max_kwh);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
    return annualConsumptionKWh >= min && annualConsumptionKWh <= max;
  });

  // If not found, fall back to closest band (edge cases)
  if (match) return match;

  // Closest by distance to band midpoint
  let best = null;
  let bestDist = Infinity;

  for (const t of tablesForOcc) {
    const min = Number(t?.consumption_min_kwh);
    const max = Number(t?.consumption_max_kwh);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;

    const mid = (min + max) / 2;
    const dist = Math.abs(annualConsumptionKWh - mid);
    if (dist < bestDist) {
      best = t;
      bestDist = dist;
    }
  }

  return best;
}

// Parse row label like "0-299" into [0, 299]
function parseGenRange(label) {
  const s = String(label || "").trim();
  const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

// Pick the row for a given generation kWh
function pickGenerationRow(rows, annualGenerationKWh) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  for (const r of rows) {
    const range = parseGenRange(r?.gen_range_kwh);
    if (!range) continue;

    const [min, max] = range;
    if (annualGenerationKWh >= min && annualGenerationKWh <= max) return r;
  }

  // If not found, fall back to closest row by midpoint
  let best = null;
  let bestDist = Infinity;

  for (const r of rows) {
    const range = parseGenRange(r?.gen_range_kwh);
    if (!range) continue;

    const [min, max] = range;
    const mid = (min + max) / 2;
    const dist = Math.abs(annualGenerationKWh - mid);
    if (dist < bestDist) {
      best = r;
      bestDist = dist;
    }
  }

  return best;
}

// Pick nearest battery column from the table
function pickBatteryIndex(batteryColumns, batteryKWh) {
  if (!Array.isArray(batteryColumns) || batteryColumns.length === 0) return 0;

  const b = Number(batteryKWh || 0);
  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < batteryColumns.length; i++) {
    const colVal = Number(batteryColumns[i]);
    if (!Number.isFinite(colVal)) continue;

    const dist = Math.abs(b - colVal);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  return bestIdx;
}


// ====== ROUTES ======
app.get("/", (req, res) => {
  res.send("Solar quote API is running");
});


app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Leads will be stored in: ${LEADS_FILE}`);
});


//===============//
// PDF BUILDING  //
//===============//

function fmt(n) {
  return Math.round(Number(n || 0)).toLocaleString("en-GB");
}

function renderMonthlyBars(values = [], colorClass = "gen") {
  const max = Math.max(...values, 1);

  return `
    <div class="monthly-chart">
      ${values.map((v, i) => {
        const h = Math.max(8, (Number(v || 0) / max) * 180);
        const month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i];
        return `
          <div class="bar-col">
            <div class="bar-wrap">
              <div class="bar ${colorClass}" style="height:${h}px;"></div>
            </div>
            <div class="bar-value">${fmt(v)}</div>
            <div class="bar-label">${month}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

function renderBarChart(values = [], barClass = "gen") {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const max = Math.max(...values.map(v => Number(v || 0)), 1);

  return `
    <div class="chart-card">
      <div class="bar-chart">
        ${values.map((v, i) => {
          const val = Number(v || 0);
          const height = Math.max(10, (val / max) * 180);
          return `
            <div class="bar-col">
              <div class="bar-wrap">
                <div class="bar ${barClass}" style="height:${height}px;"></div>
              </div>
              <div class="bar-value">${fmtNum(val)}</div>
              <div class="bar-label">${months[i]}</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function buildQuoteHtml(quote = {}, form = {}) {
  const systemSize = Number(quote.systemSizeKwp || 0);
  const annualGeneration = Math.round(Number(quote.estAnnualGenerationKWh || 0));
  const annualBillSavings = Math.round(Number(quote.annualBillSavings || 0));
  const annualSegIncome = Math.round(Number(quote.annualSegIncome || 0));
  const totalAnnualBenefit = Math.round(Number(quote.totalAnnualBenefit || 0));
  const paybackYears = Number(quote.simplePaybackYears || 0);

  const batterySize = Number(
    quote.hourlyModel?._batteryKWh ||
    quote.batteryKWh ||
    quote.batterySizeKWh ||
    0
  );

  const priceLow = Math.round(Number(quote.priceLow || 0));
  const priceHigh = Math.round(Number(quote.priceHigh || 0));

  const financial = quote.financialSeries?.monthly || {};
  const hourly = quote.hourlyModel || {};

  const monthlyGeneration = hourly.monthlyGenerationKWh || Array(12).fill(0);
  const monthlyImported = hourly.monthlyImportedKWh || Array(12).fill(0);
  const monthlyExported = hourly.monthlyExportedKWh || Array(12).fill(0);

  const annualBaseline = Math.round(Number(financial.annualBaseline || 0));
  const annualAfterNet = Math.round(Number(financial.annualAfterNet || 0));

  console.log("PDF mapped values:", {
    systemSize,
    annualGeneration,
    annualBillSavings,
    annualSegIncome,
    totalAnnualBenefit,
    paybackYears,
    batterySize,
    annualBaseline,
    annualAfterNet
  });

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; }

    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 32px;
      color: #111827;
      background: #ffffff;
    }

    h1, h2, h3, p {
      margin: 0;
    }

    .header {
      padding: 24px;
      border-radius: 16px;
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: white;
      margin-bottom: 24px;
    }

    .header h1 {
      font-size: 30px;
      margin-bottom: 8px;
    }

    .header p {
      font-size: 14px;
      opacity: 0.95;
    }

    .section {
      margin-top: 28px;
      page-break-inside: avoid;
    }

    .section h2 {
      font-size: 20px;
      margin-bottom: 14px;
    }

    .muted {
      color: #6b7280;
      font-size: 13px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
    }

    .card {
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      padding: 16px;
      background: #fff;
    }

    .stat-value {
      font-size: 26px;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .stat-label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .chart-card {
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      padding: 16px;
      background: #fff;
    }

    .bar-chart {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      height: 240px;
    }

    .bar-col {
      width: 48px;
      text-align: center;
      font-size: 11px;
    }

    .bar-wrap {
      height: 180px;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }

    .bar {
      width: 24px;
      border-radius: 8px 8px 0 0;
    }

    .bar.gen { background: #f59e0b; }
    .bar.import { background: #6366f1; }
    .bar.export { background: #10b981; }

    .bar-value {
      margin-top: 8px;
      font-weight: 700;
      font-size: 11px;
    }

    .bar-label {
      margin-top: 4px;
      color: #6b7280;
      font-size: 11px;
    }

    .list {
      margin: 10px 0 0;
      padding-left: 18px;
      color: #374151;
      font-size: 14px;
      line-height: 1.5;
    }

    .footer {
      margin-top: 32px;
      border-top: 1px solid #e5e7eb;
      padding-top: 16px;
      color: #6b7280;
      font-size: 12px;
      line-height: 1.5;
    }
  </style>
</head>
<body>

  <div class="header">
    <h1>Solar Quote</h1>
    <p>Estimated system performance, savings and energy impact for your home</p>
  </div>

  <div class="section">
    <h2>Customer details</h2>
    <div class="grid-2">
      <div class="card">
        <div class="stat-value">${form.name || "Customer"}</div>
        <div class="stat-label">Customer name</div>
      </div>
      <div class="card">
        <div class="stat-value">${form.postcode || "-"}</div>
        <div class="stat-label">Postcode</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Recommended system</h2>
    <div class="grid">
      <div class="card">
        <div class="stat-value">${systemSize} kWp</div>
        <div class="stat-label">System size</div>
      </div>
      <div class="card">
        <div class="stat-value">${batterySize} kWh</div>
        <div class="stat-label">Battery size</div>
      </div>
      <div class="card">
        <div class="stat-value">${fmtNum(annualGeneration)} kWh</div>
        <div class="stat-label">Annual generation</div>
      </div>
      <div class="card">
        <div class="stat-value">${quote.panelCount || 0}</div>
        <div class="stat-label">Panel count</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Financial summary</h2>
    <div class="grid">
      <div class="card">
        <div class="stat-value">£${fmtMoney(annualBillSavings)}</div>
        <div class="stat-label">Bill savings</div>
      </div>
      <div class="card">
        <div class="stat-value">£${fmtMoney(annualSegIncome)}</div>
        <div class="stat-label">SEG income</div>
      </div>
      <div class="card">
        <div class="stat-value">£${fmtMoney(totalAnnualBenefit)}</div>
        <div class="stat-label">Total annual benefit</div>
      </div>
      <div class="card">
        <div class="stat-value">${paybackYears}</div>
        <div class="stat-label">Simple payback (years)</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Estimated annual electricity cost</h2>
    <div class="grid-2">
      <div class="card">
        <div class="stat-value">£${fmtMoney(annualBaseline)}</div>
        <div class="stat-label">Before solar</div>
      </div>
      <div class="card">
        <div class="stat-value">£${fmtMoney(annualAfterNet)}</div>
        <div class="stat-label">After solar and export</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Monthly solar generation</h2>
    <p class="muted">Estimated solar production by month</p>
    ${renderBarChart(monthlyGeneration, "gen")}
  </div>

  <div class="section">
    <h2>Monthly grid import</h2>
    <p class="muted">Electricity still imported from the grid after solar and battery operation</p>
    ${renderBarChart(monthlyImported, "import")}
  </div>

  <div class="section">
    <h2>Monthly export</h2>
    <p class="muted">Excess energy exported back to the grid</p>
    ${renderBarChart(monthlyExported, "export")}
  </div>

  <div class="section">
    <h2>Quote range</h2>
    <div class="grid-2">
      <div class="card">
        <div class="stat-value">£${fmtMoney(priceLow)}</div>
        <div class="stat-label">Lower estimate</div>
      </div>
      <div class="card">
        <div class="stat-value">£${fmtMoney(priceHigh)}</div>
        <div class="stat-label">Upper estimate</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>What this includes</h2>
    <div class="card">
      <ul class="list">
        <li>${quote.panelCount || 0} solar panels rated at ${quote.panelWatt || 0}W each</li>
        <li>Estimated annual generation of ${fmtNum(annualGeneration)} kWh</li>
        <li>Estimated annual bill savings of £${fmtMoney(annualBillSavings)}</li>
        <li>Estimated annual export income of £${fmtMoney(annualSegIncome)}</li>
        <li>Simple payback of around ${paybackYears} years</li>
      </ul>
    </div>
  </div>

  <div class="footer">
    This quote is based on PVGIS generation modelling, tariff assumptions and estimated household electricity usage.
    Actual performance and savings will vary with weather, usage patterns, final system design and future tariff changes.
  </div>

</body>
</html>
`;
}