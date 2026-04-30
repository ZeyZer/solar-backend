// backend/server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 4000;
const pdfQuoteDataById = new Map();

// ======== IMPORTED FUNCTIONS AND FILES =========
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

// BREVO SERVICES
const {BREVO_TEMPLATE_ID_QUOTE, BREVO_TEMPLATE_ID_CALL, BREVO_QUOTE_LIST_ID, BREVO_CALL_LIST_ID, upsertBrevoContact, sendQuoteEmailWithAttachment,} = require("./services/brevoService");

// PDF SETUP
const {generateQuotePdfBuffer, getLatestPdfQuoteData,} = require("./services/pdfService");


// ====== EXPRESS SETUP ======
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/api/lead", leadRoutes);

console.log("[MCS] Loaded tables keys:", MCS_TABLES ? Object.keys(MCS_TABLES) : "❌ NOT LOADED");

// ====== LEADS STORAGE SETUP ======
const LEADS_FILE = path.join(__dirname, "leads.json");

// node fetch fallback
let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
}


// ====================
// PDF STUFF
// ====================
console.log("Registering /api/quote/pdf route");

app.post("/api/quote/pdf", async (req, res) => {
  try {
    const { quote, form, roofs } = req.body || {};

    const pdf = await generateQuotePdfBuffer({
      quote,
      form,
      roofs: roofs || [],
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="solar-quote.pdf"',
    });

    res.send(pdf);
  } catch (err) {
    console.error("PDF generation failed:", err);
    res.status(500).json({ error: "PDF generation failed." });
  }
});

app.get("/api/quote/pdf-data", (req, res) => {
  const latestPdfQuoteData = getLatestPdfQuoteData();

  if (!latestPdfQuoteData) {
    return res.status(404).json({ error: "No PDF quote data found." });
  }

  res.json(latestPdfQuoteData);
});


// ==============================
// Quote progress (SSE) plumbing
// ==============================
const activeProgressStreams = new Map(); // progressId -> res
const lastProgressById = new Map(); // progressId -> payload


app.get("/api/quote/progress/:id", (req, res) => {
  const { id } = req.params;
  console.log("✅ SSE client connected:", req.params.id);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // If you have compression middleware, this helps flush
  res.flushHeaders?.();

  activeProgressStreams.set(id, res);

  // Send an initial progress event
  res.write(`event: progress\ndata: ${JSON.stringify({ step: "starting", pct: 5, label: "Starting…" })}\n\n`);

  req.on("close", () => {
    activeProgressStreams.delete(id);
  });
});

function pushQuoteProgress(progressId, payload) {
  if (!progressId) return;
  lastProgressById.set(progressId, payload);

  const res = activeProgressStreams.get(progressId);
  if (!res) return;

  res.write(`event: progress\ndata: ${JSON.stringify(payload)}\n\n`);
}


function closeQuoteProgress(progressId) {
  if (!progressId) return;
  const res = activeProgressStreams.get(progressId);
  if (!res) return;
  res.write(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  res.end();
  activeProgressStreams.delete(progressId);
}

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


// ===== PVGIS =====
const PVGIS = {
  // Keep existing PVcalc (used for your current annual fallback)
  endpoint: "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc",

  // NEW: Hourly time-series tool (PVGIS 5.3)
  seriesEndpoint: "https://re.jrc.ec.europa.eu/api/v5_3/seriescalc",

  lossPercent: 14,
  useHorizon: 1,

  shadingDerate: {
    none: 1.0,
    some: 0.9,
    a_lot: 0.8,
  },
};

// ------------------------------
// Battery optimisation (runs simulation repeatedly with same PV/load)
// ------------------------------
function recommendBatterySizes({
  simulateFn,                 // function(batteryKWhUsable) => { annualBenefit, simplePaybackYears, annualImportedKWh, annualExportedKWh, annualSelfUsedKWh }
  minBatteryKWh = 1,          // ✅ new: force minimum
  maxBatteryKWh = 39,         // ✅ new: cap at 28
  stepKWh = 1,                // ✅ new: step 1kWh
}) {
  const results = [];

  // Safety
  const minB = Math.max(0, Number(minBatteryKWh || 0));
  const maxB = Math.max(minB, Number(maxBatteryKWh || 0));
  const step = Math.max(1, Number(stepKWh || 1));

  for (let b = minB; b <= maxB; b += step) {
    const r = simulateFn(b) || {};

    results.push({
      batteryKWhUsable: b,
      annualBenefit: Number(r.annualBenefit || 0),
      paybackYears:
        r.simplePaybackYears == null ? null : Number(r.simplePaybackYears),
      annualImportedKWh: Number(r.annualImportedKWh || 0),
      annualExportedKWh: Number(r.annualExportedKWh || 0),
      annualSelfUsedKWh: Number(r.annualSelfUsedKWh || 0),
    });
  }

  // ✅ Choose best payback (lowest payback where annualBenefit > 0)
  const viable = results.filter(
    (r) =>
      typeof r.paybackYears === "number" &&
      Number.isFinite(r.paybackYears) &&
      r.annualBenefit > 0
  );

  // If nothing is viable, fall back to the first simulated result (min battery)
  const bestPayback =
    viable.length > 0
      ? viable.reduce((best, cur) => {
          // lowest payback wins; if tie, higher annual benefit wins
          if (cur.paybackYears < best.paybackYears) return cur;
          if (cur.paybackYears === best.paybackYears && cur.annualBenefit > best.annualBenefit) return cur;
          return best;
        }, viable[0])
      : (results[0] || null);

  return {
    bestPayback,  // ✅ only recommendation we keep
    curve: results,
  };
}


// ------------------------------
// Financial helpers (monthly bills + payback + lifetime savings)
// ------------------------------
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function getPanelDegradationRate(panelOption) {
  const s = String(panelOption || "").toLowerCase();
  if (s.includes("premium")) return 0.0035; // 0.35%
  if (s.includes("value")) return 0.0040; // 0.40%
  // default
  return 0.0040;
}

function solarDegradationMultiplier(year, panelOption) {
  // year is 1..N
  const firstYearDrop = 0.01; // 1% drop applies AFTER year 1 (i.e. starting year 2)
  const annualRate = getPanelDegradationRate(panelOption);

  if (year <= 0) return 1;

  // Year 1: no degradation yet (it happens at end of year)
  if (year === 1) return 1;

  // Year 2: apply the 1% first-year drop
  if (year === 2) return 1 - firstYearDrop;

  // Year 3+: keep the first-year drop, then compound ongoing degradation
  return (1 - firstYearDrop) * Math.pow(1 - annualRate, year - 2);
}


function makeMonthlyFinancialSeries({
  monthlyLoadKWh,
  monthlyImportedKWh,
  monthlyExportedKWh,

  // ✅ split tariffs
  importPriceBefore,     // baseline £/kWh
  importPriceAfter,      // after-solar £/kWh
  segPriceAfter,         // after-solar export £/kWh

  // Backward compatibility (if older callers still pass importPrice/segPrice)
  importPrice,
  segPrice,

  standingChargePerDay = 0,
}) {
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const monthlyStandingCharge = daysInMonth.map((d) => round2(d * Number(standingChargePerDay || 0)));

  const impBefore = Number.isFinite(importPriceBefore) ? importPriceBefore : Number(importPrice || 0);
  const impAfter  = Number.isFinite(importPriceAfter)  ? importPriceAfter  : Number(importPrice || 0);
  const expAfter  = Number.isFinite(segPriceAfter)     ? segPriceAfter     : Number(segPrice || 0);

  // Baseline bill (before solar) = load * BEFORE import rate + standing charge
  const baselineMonthlyCost = monthlyLoadKWh.map((kwh, i) =>
    round2((Number(kwh || 0) * impBefore) + monthlyStandingCharge[i])
  );

  // After-solar import-only bill (what you pay your supplier) = imports * AFTER import rate + standing charge
  const systemMonthlyCostBeforeSEG = monthlyImportedKWh.map((imp, i) =>
    round2((Number(imp || 0) * impAfter) + monthlyStandingCharge[i])
  );

  // Export income (paid out) = exports * AFTER export rate
  const exportCreditMonthly = monthlyExportedKWh.map((exp) =>
    round2(Number(exp || 0) * expAfter)
  );

  // Optional net (import bill minus export income) - useful for internal comparisons
  const systemMonthlyNet = systemMonthlyCostBeforeSEG.map((c, i) =>
    round2(c - exportCreditMonthly[i])
  );

  const annualBaseline = round2(baselineMonthlyCost.reduce((a, b) => a + Number(b || 0), 0));
  const annualSystemBeforeSEG = round2(systemMonthlyCostBeforeSEG.reduce((a, b) => a + Number(b || 0), 0));
  const annualExportCredit = round2(exportCreditMonthly.reduce((a, b) => a + Number(b || 0), 0));
  const annualSystemNet = round2(systemMonthlyNet.reduce((a, b) => a + Number(b || 0), 0));

  return {
    baselineMonthlyCost,
    systemMonthlyCostBeforeSEG,
    exportCreditMonthly,
    systemMonthlyNet,

    // legacy names used by UI
    monthlyBaseline: baselineMonthlyCost,
    monthlyAfter: systemMonthlyNet,

    annualBaseline,
    annualSystemBeforeSEG,
    annualExportCredit,
    annualSystemNet,

    // ✅ UI expects this
    annualSystem: annualSystemNet,
  };
}


function makePaybackAndLifetimeSeries({
  systemCostMid,          // £
  annualBenefit,          // £/yr (bill savings + SEG income)
  years = 25,
  panelOption = "",  // for degradation calcs
  energyInflationRate = 0.06, // 6%/yr
}) {
  // Series for charts: year 0..years
  const labels = Array.from({ length: years + 1 }, (_, i) => `${i}`);
  const cumulativeSavings = [];
  let cum = 0;

  for (let y = 0; y <= years; y++) {
    if (y === 0) {
      cumulativeSavings.push(0);
      continue;
    }

    const inflationMultiplier = Math.pow(1 + energyInflationRate, y - 1);
    const degradationMultiplier = solarDegradationMultiplier(y, panelOption);

    const benefitThisYear = annualBenefit * inflationMultiplier * degradationMultiplier;

    cum += benefitThisYear;
    cumulativeSavings.push(round2(cum));
  }

  // Payback (decimal years): interpolate between years for smoother values
  let paybackYear = null;
  let paybackYearIndex = null;

  for (let i = 1; i < cumulativeSavings.length; i++) {
    const prev = cumulativeSavings[i - 1];
    const cur = cumulativeSavings[i];

    if (cur >= systemCostMid) {
      // Linear interpolation between (i-1) and i
      const gap = cur - prev;
      const needed = systemCostMid - prev;
      const frac = gap > 0 ? (needed / gap) : 0;
      const paybackDecimal = Math.round(((i - 1) + frac) * 10) / 10; // 1dp
      paybackYear = paybackDecimal;
      paybackYearIndex = i; // integer year where it first crosses (used for chart marker)
      break;
    }
  }

  // Lifetime savings (net) = total cumulative - cost
  const lifetimeNetSavings = round2((cumulativeSavings[cumulativeSavings.length - 1] || 0) - systemCostMid);

  return {
    labels,
    cumulativeSavings,
    systemCostMid: round2(systemCostMid),
    paybackYear,
    paybackYearIndex,
    lifetimeSavings: lifetimeNetSavings, // keep field name to avoid breaking frontend
    assumptions: {
      annualBenefit: round2(annualBenefit),
      energyInflationRate,
      panelOption,
      firstYearDegradation: 0.01,
      ongoingDegradationRate: getPanelDegradationRate(panelOption),
    }
  };
}


// ✅ Supports "N/NE/E/SE/S/SW/W/NW" AND "south/south_east" etc
function orientationToPvgisAspect(orientation) {
  const raw = String(orientation || "").trim();

  const compact = raw.toUpperCase();
  const mapCompass = {
    S: 0,
    SE: -45,
    E: -90,
    NE: -135,
    N: 180,
    NW: 135,
    W: 90,
    SW: 45,
  };
  if (mapCompass[compact] !== undefined) return mapCompass[compact];

  const key = raw.toLowerCase();
  const mapWords = {
    south: 0,
    south_east: -45,
    southeast: -45,
    east: -90,
    north_east: -135,
    northeast: -135,
    north: 180,
    north_west: 135,
    northwest: 135,
    west: 90,
    south_west: 45,
    southwest: 45,
  };

  return mapWords[key] ?? 0;
}

async function getLatLonFromUkPostcode(postcodeRaw) {
  const postcode = String(postcodeRaw || "").trim();
  if (!postcode) throw new Error("Missing postcode for PVGIS lookup.");

  const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error("Postcode lookup failed. Please check the postcode.");

  const data = await res.json();
  if (!data || data.status !== 200 || !data.result) {
    throw new Error("Postcode lookup failed. Please check the postcode.");
  }

  const { latitude, longitude } = data.result;
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    throw new Error("Postcode lookup failed. Please check the postcode.");
  }

  return { lat: latitude, lon: longitude };
}

async function getPvgisAnnualKWhForRoof({ lat, lon, tiltDeg, aspectDeg, peakPowerKwp }) {
  const angle = Number.isFinite(tiltDeg) ? tiltDeg : 30;
  const aspect = Number.isFinite(aspectDeg) ? aspectDeg : 0;
  const peakpower = Number.isFinite(peakPowerKwp) ? peakPowerKwp : 0;

  if (peakpower <= 0) return 0;

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    peakpower: String(peakpower),
    loss: String(PVGIS.lossPercent),
    angle: String(angle),
    aspect: String(aspect),
    usehorizon: String(PVGIS.useHorizon),
    outputformat: "json",
  });

  const url = `${PVGIS.endpoint}?${params.toString()}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error("PVGIS request failed.");

  const data = await res.json();
  const annual = data?.outputs?.totals?.fixed?.E_y;

  if (typeof annual !== "number") throw new Error("PVGIS response missing annual output.");
  return annual;
}

async function getTotalPvgisMonthlyKWh({ postcode, roofs, panelWatt }) {
  const { lat, lon } = await getLatLonFromUkPostcode(postcode);

  if (!Array.isArray(roofs) || roofs.length === 0) return null;

  const watt = Number(panelWatt || 0);
  const totalMonthly = Array(12).fill(0);

  for (const roof of roofs) {
    const panels = Number(roof?.panels || 0);
    if (panels <= 0) continue;

    const tilt = Number(roof?.tilt);
    const aspect = orientationToPvgisAspect(roof?.orientation);
    const peakPowerKwp = (panels * watt) / 1000;

    const roofMonthly = await getPvgisMonthlyKWhForRoof({
      lat,
      lon,
      tiltDeg: tilt,
      aspectDeg: aspect,
      peakPowerKwp,
    });

    const shadingKey = String(roof?.shading || "none");
    const derate = PVGIS.shadingDerate[shadingKey] ?? 1.0;

    for (let i = 0; i < 12; i++) {
      totalMonthly[i] += roofMonthly[i] * derate;
    }
  }

  // Round to whole kWh
  return totalMonthly.map((v) => Math.round(v));
}

async function getPvgisMonthlyKWhForRoof({ lat, lon, tiltDeg, aspectDeg, peakPowerKwp }) {
  const angle = Number.isFinite(tiltDeg) ? tiltDeg : 30;
  const aspect = Number.isFinite(aspectDeg) ? aspectDeg : 0;
  const peakpower = Number.isFinite(peakPowerKwp) ? peakPowerKwp : 0;

  if (peakpower <= 0) return Array(12).fill(0);

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    peakpower: String(peakpower),
    loss: String(PVGIS.lossPercent),
    angle: String(angle),
    aspect: String(aspect),
    usehorizon: String(PVGIS.useHorizon),
    outputformat: "json",
  });

  const url = `${PVGIS.endpoint}?${params.toString()}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error("PVGIS request failed.");

  const data = await res.json();

  // PVGIS typically returns monthly values in outputs.monthly.fixed (array of 12 objects)
  // Some variants return outputs.monthly directly. We'll support both.
  const monthlyRaw =
    data?.outputs?.monthly?.fixed ||
    data?.outputs?.monthly ||
    null;

  if (!Array.isArray(monthlyRaw)) {
    throw new Error("PVGIS response missing monthly output.");
  }

  // Build [Jan..Dec]
  const out = Array(12).fill(0);

  for (const row of monthlyRaw) {
    const m = Number(row?.month); // 1..12
    const Em = Number(row?.E_m);  // kWh/month for PV energy
    if (m >= 1 && m <= 12 && Number.isFinite(Em)) {
      out[m - 1] = Em;
    }
  }

  // If PVGIS changed field names unexpectedly, this protects you:
  if (out.every((v) => v === 0)) {
    // attempt fallbacks if E_m wasn't found
    for (const row of monthlyRaw) {
      const m = Number(row?.month);
      const Em2 = Number(row?.E_m ?? row?.E_m_kWh ?? row?.E);
      if (m >= 1 && m <= 12 && Number.isFinite(Em2)) out[m - 1] = Em2;
    }
  }

  return out.map((v) => Math.max(0, v));
}


async function getTotalPvgisAnnualKWh({ postcode, roofs, panelWatt }) {
  const { lat, lon } = await getLatLonFromUkPostcode(postcode);

  if (!Array.isArray(roofs) || roofs.length === 0) return null;

  let total = 0;
  const watt = Number(panelWatt || 0);

  for (const roof of roofs) {
    const panels = Number(roof?.panels || 0);
    if (panels <= 0) continue;

    const tilt = Number(roof?.tilt);
    const aspect = orientationToPvgisAspect(roof?.orientation);
    const peakPowerKwp = (panels * watt) / 1000;

    const roofAnnual = await getPvgisAnnualKWhForRoof({
      lat,
      lon,
      tiltDeg: tilt,
      aspectDeg: aspect,
      peakPowerKwp,
    });

    const shadingKey = String(roof?.shading || "none");
    const derate = PVGIS.shadingDerate[shadingKey] ?? 1.0;

    total += roofAnnual * derate;
  }

  return Math.round(total);
}

async function getMcsRoofGroupData({ postcode, roofs, panelWatt }) {
  const { lat, lon } = await getLatLonFromUkPostcode(postcode);

  if (!Array.isArray(roofs) || roofs.length === 0) return [];

  const watt = Number(panelWatt || 0);

  return Promise.all(
    roofs.map(async (roof, idx) => {
      const panels = Number(roof?.panels || 0);
      if (panels <= 0 || !watt) {
        return {
          group: idx + 1,
          panels: 0,
          kwp: 0,
          orientation: roof?.orientation || "—",
          tilt: roof?.tilt ?? null,
          shading: roof?.shading || "none",
          shadeFactor: 1.0,
          annualPreShadeKWh: 0,
          annualOutputKWh: 0,
          kk: 0,
        };
      }

      const tilt = Number(roof?.tilt);
      const aspect = orientationToPvgisAspect(roof?.orientation);
      const kwp = (panels * watt) / 1000;

      // PRE-SHADE annual PVGIS generation
      const annualPreShadeKWh = await getPvgisAnnualKWhForRoof({
        lat,
        lon,
        tiltDeg: tilt,
        aspectDeg: aspect,
        peakPowerKwp: kwp,
      });

      const shadingKey = String(roof?.shading || "none");
      const shadeFactor = PVGIS.shadingDerate[shadingKey] ?? 1.0;

      // POST-SHADE annual output for this roof group
      const annualOutputKWh = annualPreShadeKWh * shadeFactor;

      // Option A: Kk is PRE-SHADE specific yield
      const kk = kwp > 0 ? annualPreShadeKWh / kwp : 0;

      return {
        group: idx + 1,
        panels,
        kwp: Math.round(kwp * 1000) / 1000,
        orientation: roof?.orientation || "—",
        tilt: roof?.tilt ?? null,
        shading: roof?.shading || "none",
        shadeFactor: Math.round(shadeFactor * 1000) / 1000,
        annualPreShadeKWh: Math.round(annualPreShadeKWh),
        annualOutputKWh: Math.round(annualOutputKWh),
        kk: Math.round(kk),
      };
    })
  );
}

function daysInYear(year) {
  // leap year if divisible by 4 and (not by 100 unless by 400)
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  return isLeap ? 366 : 365;
}


function buildDailyUsageProfile(annualKWh, occupancyProfile) {
  // 24 points: every hour
  const labels = Array.from({ length: 24 }, (_, h) =>
    `${String(h).padStart(2, "0")}:00`
  );

  let fractions = getDailyProfileFractions(occupancyProfile) || [];

  // If we got 48 half-hourly points, collapse into 24 hourly points
  if (fractions.length === 48) {
    const collapsed = [];
    for (let i = 0; i < 48; i += 2) {
      collapsed.push((Number(fractions[i]) || 0) + (Number(fractions[i + 1]) || 0));
    }
    fractions = collapsed;
  }

  // If we still don't have 24 points, use a non-flat fallback (24 values)
  if (fractions.length !== 24) {
    fractions = [
      0.015,0.012,0.011,0.012,0.015,0.025,
      0.040,0.050,0.045,0.040,0.038,0.036,
      0.034,0.033,0.034,0.040,0.055,0.070,
      0.080,0.075,0.055,0.040,0.028,0.020
    ];
  }

  // Normalize fractions to sum to 1
  const sum = fractions.reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  const norm = fractions.map(f => (Number(f) || 0) / sum);

  // Annual -> daily
  const annual = Number(annualKWh) || 0;
  const dailyTotalKWh = annual / 365;

  // kWh per hour (24 points)
  const kWh = norm.map(f => f * dailyTotalKWh);

  const maxVal = Math.max(...kWh, 0);
  const yMax = maxVal > 0 ? Math.ceil(maxVal * 1.2 * 10) / 10 : 1; // round up to 0.1

  return { labels, kWh, yMax };
}



/**
 * Fetch hourly PV output (kWh per hour) for a single roof for a single year.
 * PVGIS seriescalc returns hourly power P [W]. We convert to kWh by: (P / 1000) * 1 hour.
 * Times are returned as UTC strings e.g. "20230101:0000".
 */
async function getPvgisHourlyKWhForRoof({ lat, lon, tiltDeg, aspectDeg, peakPowerKwp, year = 2023 }) {
  const angle = Number.isFinite(tiltDeg) ? tiltDeg : 30;
  const aspect = Number.isFinite(aspectDeg) ? aspectDeg : 0;
  const peakpower = Number.isFinite(peakPowerKwp) ? peakPowerKwp : 0;

  if (peakpower <= 0) return { kWh: [], monthIdx: [], hourOfDay: [] };

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),

    startyear: String(year),
    endyear: String(year),

    pvcalculation: "1",
    peakpower: String(peakpower),
    pvtechchoice: "crystSi",
    mountingplace: "building",
    loss: String(PVGIS.lossPercent),

    trackingtype: "0",
    angle: String(angle),
    aspect: String(aspect),

    usehorizon: String(PVGIS.useHorizon),
    outputformat: "json",
  });

  const url = `${PVGIS.seriesEndpoint}?${params.toString()}`;
  const res = await fetchFn(url);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PVGIS seriescalc failed (${res.status}). ${text?.slice(0, 200) || ""}`);
  }

  const data = await res.json();
  const hourly = data?.outputs?.hourly;

  if (!Array.isArray(hourly) || hourly.length === 0) {
    throw new Error("PVGIS hourly response missing outputs.hourly array.");
  }

  const kWh = new Array(hourly.length);
  const monthIdx = new Array(hourly.length);
  const hourOfDay = new Array(hourly.length);

  for (let i = 0; i < hourly.length; i++) {
    const row = hourly[i];

    // PV power in W (when pvcalculation=1). Convert to kWh for the hour.
    const P = Number(row?.P);
    kWh[i] = Number.isFinite(P) ? Math.max(0, P / 1000) : 0;

    // PVGIS time is typically like "YYYYMMDD:HHMM" in local time.
    const t = String(row?.time || "");
    // month is chars 4-6 (01..12), hour is chars 9-11 (00..23)
    const mm = Number(t.slice(4, 6));  // 1..12
    const hh = Number(t.slice(9, 11)); // 0..23

    monthIdx[i] = (mm >= 1 && mm <= 12) ? (mm - 1) : 0;
    hourOfDay[i] = (hh >= 0 && hh <= 23) ? hh : 0;
  }

  return { kWh, monthIdx, hourOfDay };
}


/**
 * Get total hourly PV generation across all roofs for a single year.
 * IMPORTANT: shading derate is applied per-hour per-roof BEFORE summing (as requested).
 */
async function getTotalPvgisHourlyKWh({ postcode, roofs, panelWatt, year = 2023 }) {
  const { lat, lon } = await getLatLonFromUkPostcode(postcode);

  if (!Array.isArray(roofs) || roofs.length === 0) return null;

  const watt = Number(panelWatt || 0);
  if (!watt) return null;

  let totalHourly = null;
  let monthIdx = null;
  let hourOfDay = null;

  for (const roof of roofs) {
    const panels = Number(roof?.panels || 0);
    if (panels <= 0) continue;

    const tilt = Number(roof?.tilt);
    const aspect = orientationToPvgisAspect(roof?.orientation);
    const peakPowerKwp = (panels * watt) / 1000;

    const roofRes = await getPvgisHourlyKWhForRoof({
      lat,
      lon,
      tiltDeg: tilt,
      aspectDeg: aspect,
      peakPowerKwp,
      year,
    });

    const roofHourly = roofRes.kWh;
    if (!Array.isArray(roofHourly) || roofHourly.length === 0) continue;

    if (!totalHourly) {
      totalHourly = Array(roofHourly.length).fill(0);
      monthIdx = roofRes.monthIdx;
      hourOfDay = roofRes.hourOfDay;
    } else if (roofHourly.length !== totalHourly.length) {
      throw new Error("PVGIS hourly length mismatch across roofs (unexpected).");
    }

    const shadingKey = String(roof?.shading || "none");
    const derate = PVGIS.shadingDerate[shadingKey] ?? 1.0;

    // Apply shading PER HOUR PER ROOF (as you requested)
    for (let i = 0; i < roofHourly.length; i++) {
      totalHourly[i] += roofHourly[i] * derate;
    }
  }

  if (!totalHourly) return null;

  // Keep a little precision; you can round for display later
  const pvHourly = totalHourly.map((v) => Math.max(0, Math.round(v * 100) / 100));

  return { pvHourly, monthIdx, hourOfDay };
}

async function runHourlyModelForYear({ input, panelWatt, year, includeHourlyArrays = false }) {
  const pvRes = await getTotalPvgisHourlyKWh({
    postcode: input.postcode,
    roofs: input.roofs,
    panelWatt,
    year,
  });

  if (!pvRes || !Array.isArray(pvRes.pvHourly) || pvRes.pvHourly.length === 0) {
    throw new Error(`No PVGIS hourly data for year ${year}`);
  }

  const pvHourly = pvRes.pvHourly;
  const monthIdx = pvRes.monthIdx;
  const hourOfDay = pvRes.hourOfDay;

  // Annual demand (same as your existing logic)
  let annualKWh = input.annualKWh;
  if (!annualKWh && input.monthlyBill) {
    const annualBill = input.monthlyBill * 12;
    annualKWh = annualBill / CONFIG.assumedPricePerKWh;
  }
  if (!annualKWh) annualKWh = 3000;

  const loadHourly = buildHourlyLoadForSeries({
    annualKWh,
    occupancyProfile: input.occupancyProfile,
    monthIdx,
    hourOfDay,
  });


  // Decide which tariff governs battery behaviour AFTER solar
  const tariffAfter = input?.tariffAfter || input?.tariff || null;

  // IMPORTANT: declare tariffType BEFORE using it
  const tariffTypeAfter = String(tariffAfter?.tariffType || "standard");
  const retailRateModeAfter = tariffTypeAfter === "overnight" || tariffTypeAfter === "flux";

  const ta = normalizeTariff((input?.tariffAfter || input?.tariff || {}), "after");
  const retail = isRetailRateTariff(ta);

  const sim = simulateHourByHour({
    pvHourlyKWh: pvHourly,
    loadHourlyKWh: loadHourly,
    monthIdx,
    hourOfDay,
    batteryKWh: Number(input.batteryKWh || 0),

    tariff: ta,
    dispatchMode: retail ? "retail_rate" : "self_consumption",

    allowGridCharge: retail && !!ta.allowGridCharging,
    allowEnergyTrading: retail && !!ta.allowEnergyTrading,
    exportFromBatteryEnabled: retail && !!ta.exportFromBatteryEnabled,
  });


  if (!sim) throw new Error(`Simulation failed for year ${year}`);

  // Build derived monthly series
  const monthlyDirect = sim.monthly.selfUsed.map((v, i) =>
    Math.max(0, Number(v || 0) - Number(sim.monthly.batteryDischarge[i] || 0))
  );
  
    const result = {
    year,
    monthlyGenerationKWh: sim.monthly.generation,
    monthlySelfUsedKWh: sim.monthly.selfUsed,
    monthlyExportedKWh: sim.monthly.exported,
    monthlyImportedKWh: sim.monthly.imported,
    monthlyBatteryChargeKWh: sim.monthly.batteryCharge,
    monthlyBatteryDischargeKWh: sim.monthly.batteryDischarge,

    monthlyBatteryChargeFromPVKWh: sim.monthly.batteryChargeFromPV,
    monthlyBatteryChargeFromGridKWh: sim.monthly.batteryChargeFromGrid,
    monthlyPVExportedDirectKWh: sim.monthly.pvExportDirect,
    monthlyBatteryDischargeFromPVToLoadKWh: sim.monthly.batteryDischargeFromPVToLoad,
    monthlyBatteryDischargeFromGridToLoadKWh: sim.monthly.batteryDischargeFromGridToLoad,

    monthlyDirectToHomeKWh: monthlyDirect,
    annualGenerationKWh: sum12(sim.monthly.generation),
    annualSelfUsedKWh: sum12(sim.monthly.selfUsed),
    annualExportedKWh: sum12(sim.monthly.exported),
    annualImportedKWh: sum12(sim.monthly.imported),
  };

  if (includeHourlyArrays) {
    result._pvHourlyKWh = pvHourly;
    result._loadHourlyKWh = loadHourly;
    result._monthIdx = monthIdx;
    result._hourOfDay = hourOfDay;

    // NEW: battery + grid flow hourly arrays
    result._importHourlyKWh = sim.hourly.importKWh;
    result._exportHourlyKWh = sim.hourly.exportKWh;
    result._battChargeFromGridHourlyKWh = sim.hourly.battChargeFromGridKWh;
  }

  return result;
}

function smoothArrayWeighted(a, passes = 2) {
  // Weighted moving average: preserves shape but reduces sharp peaks
  let out = a.slice();
  for (let p = 0; p < passes; p++) {
    const next = out.slice();
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length];
      const curr = out[i];
      const nxt  = out[(i + 1) % out.length];
      next[i] = 0.25 * prev + 0.5 * curr + 0.25 * nxt;
    }
    out = next;
  }
  return out;
}

function normalizeToOne(a) {
  const sum = a.reduce((s, v) => s + (Number(v) || 0), 0) || 1;
  return a.map(v => (Number(v) || 0) / sum);
}

function softenMorningPeakHourly(fractions24, startHour = 6, endHour = 9, factor = 0.75) {
  // Reduces demand between startHour..endHour inclusive by factor (e.g. 0.75 = 25% reduction)
  const out = fractions24.slice();
  for (let h = startHour; h <= endHour; h++) {
    out[h] = (Number(out[h]) || 0) * factor;
  }
  return normalizeToOne(out);
}


function getDailyProfileFractions(occupancyProfile) {
  // Calibrated to be closer to MCS-style self-consumption behaviour:
  // less daytime overlap with PV, stronger evening demand.

  const homeAllDay = [
    // 0–5
    0.032, 0.028, 0.025, 0.024, 0.025, 0.029,
    // 6–11
    0.040, 0.050, 0.054, 0.050, 0.044, 0.040,
    // 12–17
    0.038, 0.038, 0.040, 0.046, 0.056, 0.072,
    // 18–23
    0.086, 0.092, 0.088, 0.076, 0.060, 0.045
  ];

  const halfDay = [
    // 0–5
    0.033, 0.029, 0.026, 0.025, 0.026, 0.031,
    // 6–11
    0.042, 0.056, 0.062, 0.050, 0.040, 0.036,
    // 12–17
    0.034, 0.034, 0.036, 0.042, 0.054, 0.075,
    // 18–23
    0.095, 0.102, 0.095, 0.082, 0.066, 0.049
  ];

  const outAllDay = [
    // 0–5
    0.034, 0.030, 0.027, 0.026, 0.027, 0.032,
    // 6–11
    0.046, 0.060, 0.052, 0.034, 0.024, 0.022,
    // 12–17
    0.022, 0.022, 0.024, 0.032, 0.045, 0.068,
    // 18–23
    0.106, 0.115, 0.110, 0.092, 0.074, 0.055
  ];

  let arr;
  switch (String(occupancyProfile || "")) {
    case "home_all_day":
      arr = homeAllDay;
      break;
    case "out_all_day":
      arr = outAllDay;
      break;
    default:
      arr = halfDay;
  }

  // Work on a copy
  let fractions = normalizeToOne(arr);

  // Lighter smoothing than before: your old 2-pass smoothing was
  // spreading demand back into solar hours and increasing self-consumption.
  fractions = smoothArrayWeighted(fractions, 1);

  // Re-normalise to exactly 1.0 total
  fractions = normalizeToOne(fractions);

  return fractions;
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


function monthlySeasonWeightsUK() {
  // Simple seasonality: winter higher than summer.
  // These are multipliers, not fractions. We’ll normalize later.
  // Jan..Dec
  return [1.12,1.08,1.03,0.98,0.95,0.92,0.92,0.93,0.97,1.02,1.07,1.11];
}

function buildHourlyLoadForSeries({ annualKWh, occupancyProfile, monthIdx, hourOfDay }) {
  if (!Array.isArray(monthIdx) || !Array.isArray(hourOfDay) || monthIdx.length !== hourOfDay.length) {
    throw new Error("buildHourlyLoadForSeries requires monthIdx + hourOfDay arrays of same length.");
  }

  const daily = getDailyProfileFractions(occupancyProfile);
  const season = monthlySeasonWeightsUK(); // 12 multipliers

  const n = monthIdx.length;
  const load = Array(n).fill(0);

  // Build unscaled “shape”
  for (let i = 0; i < n; i++) {
    const m = monthIdx[i];           // 0..11
    const h = hourOfDay[i];          // 0..23
    load[i] = daily[h] * season[m];
  }

  // Scale so sum(load) = annualKWh
  const shapeSum = load.reduce((s, v) => s + v, 0) || 1;
  const scale = Number(annualKWh || 0) / shapeSum;

  // Keep 2dp precision
  return load.map((v) => Math.round(v * scale * 100) / 100);
}


function rateForHour(tariff, hod, kind /* "import" | "export" */) {
  const tt = tariff?.tariffType || "standard";

  // Defaults (your current style)
  const importFlat = Number(tariff?.importPrice ?? 0.28);
  const exportFlat = Number(tariff?.segPrice ?? 0.12);

  if (tt === "standard") {
    return kind === "import" ? importFlat : exportFlat;
  }

  // Cheap overnight (e.g. EV style)
  if (tt === "overnight") {
    const nightStart = Number(tariff?.nightStartHour ?? 0);
    const nightEnd = Number(tariff?.nightEndHour ?? 7);
    const isNight = (hod >= nightStart && hod < nightEnd);

    const importNight = Number(tariff?.importNight ?? 0.08);
    const importDay = Number(tariff?.importDay ?? importFlat);

    if (kind === "import") return isNight ? importNight : importDay;
    return exportFlat;
  }

  // Flux-style simplified (3-band)
  if (tt === "flux") {
    const offPeakStart = Number(tariff?.offPeakStartHour ?? 0);
    const offPeakEnd = Number(tariff?.offPeakEndHour ?? 6);
    const peakStart = Number(tariff?.peakStartHour ?? 16);
    const peakEnd = Number(tariff?.peakEndHour ?? 19);

    const isOffPeak = (hod >= offPeakStart && hod < offPeakEnd);
    const isPeak = (hod >= peakStart && hod < peakEnd);
    const isDay = (!isOffPeak && !isPeak);

    const importOffPeak = Number(tariff?.importOffPeak ?? 0.15);
    const importDay = Number(tariff?.importPrice ?? importFlat);
    const importPeak = Number(tariff?.importPeak ?? 0.40);

    const exportOffPeak = Number(tariff?.exportOffPeak ?? exportFlat);
    const exportDay = Number(tariff?.segPrice ?? exportFlat);
    const exportPeak = Number(tariff?.exportPeak ?? 0.30);

    if (kind === "import") return isOffPeak ? importOffPeak : isPeak ? importPeak : importDay;
    return isOffPeak ? exportOffPeak : isPeak ? exportPeak : exportDay;
  }

  // fallback
  return kind === "import" ? importFlat : exportFlat;
}

function extractDaySlice(hourly, startIndex) {
  const start = Math.max(0, Number(startIndex || 0));
  const end = Math.min(start + 24, (hourly?.pvKWh?.length || hourly?.pv?.length || 0));

  const pick = (...keys) => {
    for (const k of keys) {
      const v = hourly?.[k];
      if (Array.isArray(v)) return v;
    }
    return null;
  };

  const slice = (arr) => {
    if (!Array.isArray(arr)) return Array(end - start).fill(0);
    return arr.slice(start, end);
  };

  const hours = Array.from({ length: end - start }, (_, i) => i);

  // Support both “new” keys (pvKWh) and older ones (pv)
  const pvArr = pick("pvKWh", "pv");
  const loadArr = pick("loadKWh", "load");
  const socArr = pick("socKWh", "soc");

  const importArr = pick("importKWh", "import");
  const exportArr = pick("exportKWh", "export");

  const chPVArr = pick("battChargeFromPVKWh", "battChargeFromPV", "batteryChargeFromPV");
  const chGridArr = pick("battChargeFromGridKWh", "battChargeFromGrid", "batteryChargeFromGrid");

  const disLoadArr = pick("battDischargeToLoadKWh", "battDischargeToLoad", "batteryDischargeToLoad");
  const disExpArr = pick("battDischargeToExportKWh", "battDischargeToExport", "batteryDischargeToExport");

  const directArr = pick("directPVToLoadKWh", "directPVToLoad");

  return {
    hours,

    // Standardised names returned to the frontend
    pv: slice(pvArr),
    load: slice(loadArr),
    soc: slice(socArr),

    importKWh: slice(importArr),
    exportKWh: slice(exportArr),

    battChargeFromPVKWh: slice(chPVArr),
    battChargeFromGridKWh: slice(chGridArr),

    battDischargeToLoadKWh: slice(disLoadArr),
    battDischargeToExportKWh: slice(disExpArr),

    directPVToLoadKWh: slice(directArr),
  };
}

// ===============================
// Tariff normalization + hourly billing (single source of truth)
// ===============================
function normalizeTariff(raw, kind /* "before" | "after" */) {
  const t = raw && typeof raw === "object" ? raw : {};

  // defaults match your recalc defaults + your UI
  const base = {
    tariffType: "standard",
    

    // flat defaults
    importPrice: 0.28,
    segPrice: 0.12,

    standingChargePerDay: 0.60,

    // overnight
    importNight: 0.08,
    importDay: 0.20,
    nightStartHour: 0,
    nightEndHour: 7,

    // flux
    importOffPeak: 0.15,
    importPeak: 0.40,
    exportOffPeak: 0.08,
    exportPeak: 0.30,
    offPeakStartHour: 0,
    offPeakEndHour: 6,
    peakStartHour: 16,
    peakEndHour: 19,

    // toggles
    exportFromBatteryEnabled: true,
    allowGridCharging: false,
    allowEnergyTrading: false,
  };

  // "before solar" generally doesn't have segPrice, but we normalize anyway.
  // If kind === "before", export rates are irrelevant in billing because exportKWh is 0.
  const out = { ...base, ...t };

  // Coerce numerics safely
  const numKeys = [
    "importPrice","segPrice","standingChargePerDay",
    "importNight","importDay","nightStartHour","nightEndHour",
    "importOffPeak","importPeak","exportOffPeak","exportPeak",
    "offPeakStartHour","offPeakEndHour","peakStartHour","peakEndHour",
  ];
  for (const k of numKeys) {
    if (out[k] != null) out[k] = Number(out[k]);
  }

  out.tariffType = String(out.tariffType || "standard");
  out.exportFromBatteryEnabled = !!out.exportFromBatteryEnabled;
  out.allowGridCharging = !!out.allowGridCharging;      // default true
  out.allowEnergyTrading = !!out.allowEnergyTrading;            // default false


  // If user picked overnight/flux but left some fields blank, ensure importDay fallback
  if (out.tariffType === "overnight") {
    if (!Number.isFinite(out.importNight)) out.importNight = base.importNight;
    if (!Number.isFinite(out.importDay)) out.importDay = out.importPrice || base.importDay;
  }
  if (out.tariffType === "flux") {
    if (!Number.isFinite(out.importOffPeak)) out.importOffPeak = base.importOffPeak;
    if (!Number.isFinite(out.importPeak)) out.importPeak = base.importPeak;
    if (!Number.isFinite(out.exportOffPeak)) out.exportOffPeak = base.exportOffPeak;
    if (!Number.isFinite(out.exportPeak)) out.exportPeak = base.exportPeak;
  }

  return out;
}

function isRetailRateTariff(tariff) {
  const tt = String(tariff?.tariffType || "standard");
  return tt === "overnight" || tt === "flux";
}

function simulateWithTariff({ pv, load, monthIdx, hourOfDay, batteryKWh, tariff }) {
  const t = normalizeTariff(tariff, "after");
  const retail = isRetailRateTariff(t);
  const allowGridCharge = retail && !!t.allowGridCharging;

  return simulateHourByHour({
    pvHourlyKWh: pv,
    loadHourlyKWh: load,
    monthIdx,
    hourOfDay,
    batteryKWh: Number(batteryKWh || 0),
    tariff: t,
    dispatchMode: retail ? "retail_rate" : "self_consumption",
    allowGridCharge,
    exportFromBatteryEnabled: !!t.exportFromBatteryEnabled,
  });
}

/**
 * Computes baseline + after-solar bills using hourly TOU rates.
 * Assumes arrays aligned, hourOfDay and monthIdx aligned with n hours.
 */
function computeHourlyBilling({
  loadKWh,        // baseline demand (8760)
  importKWh,      // after-solar grid import (8760)
  exportKWh,      // after-solar export (8760)
  hourOfDay,      // (8760) 0..23
  monthIdx,       // (8760) 0..11
  tariffBefore,
  tariffAfter,
}) {
  const n = Math.min(
    loadKWh?.length || 0,
    importKWh?.length || 0,
    exportKWh?.length || 0,
    hourOfDay?.length || 0,
    monthIdx?.length || 0
  );
  if (!n) {
    return {
      annualBaseline: 0,
      annualAfterImportAndStanding: 0,
      annualExportCredit: 0,
      annualAfterNet: 0,
      monthlyBaseline: Array(12).fill(0),
      monthlyAfterImportAndStanding: Array(12).fill(0),
      monthlyExportCredit: Array(12).fill(0),
      monthlyAfterNet: Array(12).fill(0),
    };
  }

  const tb = normalizeTariff(tariffBefore, "before");
  const ta = normalizeTariff(tariffAfter, "after");

  const monthlyBaseline = Array(12).fill(0);
  const monthlyAfterImportOnly = Array(12).fill(0);
  const monthlyExportIncome = Array(12).fill(0);

  for (let i = 0; i < n; i++) {
    const m = monthIdx[i] ?? 0;
    const hod = hourOfDay[i] ?? (i % 24);

    const load = Math.max(0, Number(loadKWh[i] || 0));
    const imp = Math.max(0, Number(importKWh[i] || 0));
    const exp = Math.max(0, Number(exportKWh[i] || 0));

    const beforeRate = rateForHour(tb, hod, "import");
    const afterImpRate = rateForHour(ta, hod, "import");
    const afterExpRate = rateForHour(ta, hod, "export");

    monthlyBaseline[m] += load * beforeRate;
    monthlyAfterImportOnly[m] += imp * afterImpRate;
    monthlyExportIncome[m] += exp * afterExpRate;
  }

  // standing charge allocation per month
  const daysInMonth = [31,28,31,30,31,30,31,31,30,31,30,31];
  const standingBeforeMonthly = daysInMonth.map(d => d * Number(tb.standingChargePerDay || 0));
  const standingAfterMonthly = daysInMonth.map(d => d * Number(ta.standingChargePerDay || 0));

  const monthlyAfterImportAndStanding = monthlyAfterImportOnly.map((v, i) => v + standingAfterMonthly[i]);
  const monthlyBaselineWithStanding = monthlyBaseline.map((v, i) => v + standingBeforeMonthly[i]);

  const monthlyAfterNet = monthlyAfterImportAndStanding.map((v, i) => v - monthlyExportIncome[i]);

  const annualBaseline = monthlyBaselineWithStanding.reduce((a,b)=>a+b,0);
  const annualAfterImportAndStanding = monthlyAfterImportAndStanding.reduce((a,b)=>a+b,0);
  const annualExportCredit = monthlyExportIncome.reduce((a,b)=>a+b,0);
  const annualAfterNet = monthlyAfterNet.reduce((a,b)=>a+b,0);

  // 2dp stable
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

  return {
    monthlyBaseline: monthlyBaselineWithStanding.map(r2),
    monthlyAfterImportAndStanding: monthlyAfterImportAndStanding.map(r2),
    monthlyExportCredit: monthlyExportIncome.map(r2),
    monthlyAfterNet: monthlyAfterNet.map(r2),

    annualBaseline: r2(annualBaseline),
    annualAfterImportAndStanding: r2(annualAfterImportAndStanding),
    annualExportCredit: r2(annualExportCredit),
    annualAfterNet: r2(annualAfterNet),
  };
}


function simulateHourByHour({
  pvHourlyKWh,
  loadHourlyKWh,
  monthIdx,
  hourOfDay: hourOfDayIn,
  batteryKWh = 0,
  tariff = null,
  dispatchMode = "self_consumption",
  allowGridCharge = false,
  exportFromBatteryEnabled = false,
  allowEnergyTrading = false,
  gridChargeTargetPct = 80,
}) {
  let hourOfDay = hourOfDayIn;

  // ===============================
  // Debug controls
  // Turn DEBUG_SIM to true only when diagnosing dispatch behaviour
  // ===============================
  const DEBUG_SIM = false;
  const DEBUG_DAY_START = 3600;

  function debugSim(...args) {
    if (DEBUG_SIM) console.log(...args);
  }

  const n = Math.min(
    pvHourlyKWh?.length || 0,
    loadHourlyKWh?.length || 0,
    monthIdx?.length || 0,
    hourOfDay?.length || (pvHourlyKWh?.length || 0)
  );
  if (n === 0) return null;

  if (!hourOfDay || hourOfDay.length < n) {
    hourOfDay = Array.from({ length: n }, (_, i) => i % 24);
  }

  // Usable capacity (kWh)
  const capUsable = Math.max(0, Number(batteryKWh || 0));
  const socMin = 0;
  const socMax = capUsable;

  //====================
  // New Helper Function
  //====================
    function isHourInWindow(hod, startHour, endHour) {
    const start = Number(startHour ?? 0);
    const end = Number(endHour ?? 0);

    // Normal same-day window, e.g. 00 -> 05
    if (start < end) {
      return hod >= start && hod < end;
    }

    // Cross-midnight window, e.g. 23 -> 05
    if (start > end) {
      return hod >= start || hod < end;
    }

    // If start === end, treat as no active window
    return false;
  }

  function isCheapImportWindow(tariff, hod) {
    const tt = String(tariff?.tariffType || "standard");

    if (tt === "overnight") {
      const ns = Number(tariff?.nightStartHour ?? 0);
      const ne = Number(tariff?.nightEndHour ?? 7);
      return isHourInWindow(hod, ns, ne);
    }

    if (tt === "flux") {
      const os = Number(tariff?.offPeakStartHour ?? 0);
      const oe = Number(tariff?.offPeakEndHour ?? 6);
      return isHourInWindow(hod, os, oe);
    }

    return false;
  }

  // ===============================
  // Realistic inverter power limits
  // ===============================
  // < 8 kWh battery → 3.7 kW
  // ≥ 8 kWh battery → 6 kW

  let maxChargeKW = 0;
  let maxDischargeKW = 0;

  if (capUsable > 0) {
    if (capUsable < 8) {
      maxChargeKW = 3.7;
      maxDischargeKW = 3.7;
    } else {
      maxChargeKW = 5;
      maxDischargeKW = 6;
    }
  }

  // Efficiency
  const roundTripEff = 0.90;
  const chargeEff = Math.sqrt(roundTripEff);
  const dischargeEff = Math.sqrt(roundTripEff);

  // Start SOC at 50% (realistic default, prevents “battery always full”)
  // This also allows grid-charge behaviour to show up in debug days.
  let soc = socMin;

  // Track stored energy origin (kWh stored inside battery)
  let socFromPV = 0;
  let socFromGrid = soc; // assume initial SOC is grid-origin


  // Hourly outputs (8760)
  const importHourly = Array(n).fill(0);
  const exportHourly = Array(n).fill(0);
  const battChargeHourly_fromPV = Array(n).fill(0);   // PV -> battery (kWh PV input)
  const battChargeHourly_fromGrid = Array(n).fill(0); // Grid -> battery (kWh grid input)
  const battDischargeHourly_toLoad = Array(n).fill(0);// Battery -> load (kWh delivered)
  const directPVtoLoadHourly = Array(n).fill(0);
  const battDischargeFromPVToLoadHourly = Array(n).fill(0);
  const battDischargeFromGridToLoadHourly = Array(n).fill(0);

  const monthly = {
    generation: Array(12).fill(0),
    selfUsed: Array(12).fill(0),
    exported: Array(12).fill(0),
    imported: Array(12).fill(0),
    batteryCharge: Array(12).fill(0),
    batteryDischarge: Array(12).fill(0),
    batteryDischargeFromPVToLoad: Array(12).fill(0),
    batteryDischargeFromGridToLoad: Array(12).fill(0),
    batteryChargeFromPV: Array(12).fill(0),
    batteryChargeFromGrid: Array(12).fill(0),
    pvExportDirect: Array(12).fill(0)
  };

  const hourly = {
    pv: Array(n).fill(0),
    load: Array(n).fill(0),
    soc: Array(n).fill(0),
    importKWh: Array(n).fill(0),
    exportKWh: Array(n).fill(0),

    // optional but very useful
    battChargeFromPV: Array(n).fill(0),     // kWh INTO battery from PV (input)
    battChargeFromGrid: Array(n).fill(0),   // kWh INTO battery from grid (input)
    battDischargeToLoad: Array(n).fill(0),  // kWh delivered to load
    battDischargeToExport: Array(n).fill(0), // kWh delivered to export
    battDischargeFromPVToLoad: Array(n).fill(0),
    battDischargeFromGridToLoad: Array(n).fill(0)
  };

  // ---- SAM-like day-ahead plan for retail rate dispatch ----
  // We plan desired battery discharge to cover the most expensive hours of NET LOAD (load - PV),
  // and (optionally) grid-charge in cheapest hours to ensure energy is available.
  function planDayRetailRate(dayStart, dayLen) {
    const planDischargeToLoad = Array(dayLen).fill(0);   // kWh delivered to load
    const planGridChargeIn = Array(dayLen).fill(0);      // kWh drawn from grid into battery (input)
    const planDischargeToExport = Array(dayLen).fill(0); // kWh delivered to export
    const planStorePV = Array(dayLen).fill(false);       // whether PV surplus should be stored this hour

    // If no battery or not retail mode, do nothing special
    if (capUsable <= 0 || dispatchMode !== "retail_rate" || !tariff) {
      return { planDischargeToLoad, planGridChargeIn, planDischargeToExport, planStorePV };
    }

    // Build hourly forecast arrays for this day
    const hours = [];
    for (let i = 0; i < dayLen; i++) {
      const tAbs = dayStart + i;
      const pv = Math.max(0, Number(pvHourlyKWh[tAbs] || 0));
      const load = Math.max(0, Number(loadHourlyKWh[tAbs] || 0));
      const hod = hourOfDay[tAbs];

      const imp = rateForHour(tariff, hod, "import");
      const exp = rateForHour(tariff, hod, "export");

      const netLoad = Math.max(0, load - pv);      // demand not met directly by PV
      const pvSurplus = Math.max(0, pv - load);    // PV available to charge battery / export

      hours.push({ i, tAbs, pv, load, hod, imp, exp, netLoad, pvSurplus });
    }

    // Identify cheap import window hours (used for charging + arbitrage logic)
    const cheapImportHours = hours.filter((h) => {
      return isCheapImportWindow(tariff, h.hod);
    });

    // ------------------------------
    // Phase 1 planning inputs
    //
    // We want two separate budgets:
    // 1) battery room to keep for low-value PV later in the day
    // 2) battery energy we may want to buy overnight for later expensive home demand
    // ------------------------------

    // Cheapest import rate available in the cheap window
    const cheapestImport = cheapImportHours.length
      ? Math.min(...cheapImportHours.map(h => h.imp))
      : Math.min(...hours.map(h => h.imp)); // fallback

    const rtEff = chargeEff * dischargeEff;

    // A) PV surplus that is better STORED than EXPORTED immediately
    //
    // We now reserve battery room for two kinds of solar:
    //
    // 1) Solar where exporting now is worse than avoiding later imports
    //    (current export < cheapest off-peak import)
    //
    // 2) Solar where there is a better export opportunity later in the same day
    //    (store now, export later at a higher export price)
    let pvReserveInput = 0;

    for (let j = 0; j < hours.length; j++) {
      const h = hours[j];
      if (h.pvSurplus <= 0.001) continue;

      const pvCouldChargeThisHour = Math.min(h.pvSurplus, maxChargeKW);

      // Best export value from this hour onward
      const laterBestExport = Math.max(
        ...hours.slice(j).map((x) => Number(x.exp || 0))
      );

      // What is 1 kWh of solar worth if we store it for later home use?
      // Benchmark it against the cheapest off-peak import we could buy instead.
      const valueOfStoringForHome = cheapestImport * rtEff;

      // Case 1: store PV for later home use
      const shouldStoreForHome = valueOfStoringForHome > h.exp + 0.0005;

      // Case 2: store PV because there is a genuinely better export hour later
      const shouldStoreForLaterExport = laterBestExport > h.exp + 0.0005;

      const shouldReserveRoomForThisPv = shouldStoreForHome || shouldStoreForLaterExport;

      // Save the planner decision for the hourly execution layer
      planStorePV[j] = shouldReserveRoomForThisPv;

      if (dayStart === DEBUG_DAY_START) {
        debugSim("PV RESERVE DECISION", {
          hod: h.hod,
          pvSurplus: h.pvSurplus,
          exportNow: h.exp,
          cheapestImport,
          valueOfStoringForHome,
          laterBestExport,
          shouldStoreForHome,
          shouldStoreForLaterExport,
          shouldReserveRoomForThisPv,
        });
      }

      if (shouldReserveRoomForThisPv) {
        pvReserveInput += pvCouldChargeThisHour;
      }
    }

    // Convert PV input into stored kWh inside the battery
    const pvReserveStored = Math.min(pvReserveInput * chargeEff, socMax);

    // B) Future expensive home-demand hours that are worth serving from the battery
    // We only count hours where import later is more expensive than cheap off-peak import.
    let futureExpensiveDemandDeliver = 0;

    for (const h of hours) {
      if (h.netLoad <= 0.001) continue;
      if (h.imp <= cheapestImport + 0.0005) continue;

      futureExpensiveDemandDeliver += Math.min(h.netLoad, maxDischargeKW);
    }

    // Convert deliverable battery output into stored kWh needed
    const homeDemandReserveStored = Math.min(
      futureExpensiveDemandDeliver / dischargeEff,
      socMax
    );


    // ---- A) Plan discharge-to-load: cover most expensive import hours first ----
    // IMPORTANT: do NOT limit planning to current SOC only.
    // PV later in the day can fill the battery, so we plan as if the battery could
    // reach full at some point during the day, and the real hour loop will cap by SOC.
    const byExpensiveImport = [...hours].sort((a, b) => {
      // highest import price first; if tied, larger net load first
      if (b.imp !== a.imp) return b.imp - a.imp;
      return b.netLoad - a.netLoad;
    });

    // Max energy the battery could deliver in a day if it became full at some point
    let deliverableBudget = Math.max(0, (socMax - socMin)) * dischargeEff;

    // If grid charging is OFF, estimate additional energy that can be stored from PV later today
    if (!allowGridCharge) {
      let socTemp = soc;

      for (const h of hours) {
        // PV surplus can charge battery
        if (h.pvSurplus > 0 && socTemp < socMax) {
          const roomStored = socMax - socTemp;
          const pvToBattIn = Math.min(h.pvSurplus, maxChargeKW, roomStored / chargeEff);
          socTemp += pvToBattIn * chargeEff;
        }
      }

      // Use the best SOC we can reach from PV as today's discharge budget
      deliverableBudget = Math.max(0, (socTemp - socMin)) * dischargeEff;
    }


    for (const h of byExpensiveImport) {
      if (deliverableBudget <= 0) break;
      if (h.netLoad <= 0) continue;

      const deliver = Math.min(h.netLoad, maxDischargeKW, deliverableBudget);
      planDischargeToLoad[h.i] = deliver;
      deliverableBudget -= deliver;
    }

    // ---- B) Plan grid charging, but leave room for expected PV surplus ----
    // ALSO: if arbitrage is profitable (cheap import < high export), allow charging for export.

    if (allowGridCharge && capUsable > 0 && dispatchMode === "retail_rate" && tariff) {

      // 1) Base overnight target from the UI setting
      const pctTargetSOC = socMax * (gridChargeTargetPct / 100);

      // 2) If energy trading is enabled, work out how much EXTRA spare capacity
      // could be used for profitable arbitrage later.
      let arbitrageReserveStored = 0;

      if (allowEnergyTrading && exportFromBatteryEnabled) {
        const profitableExportHours = hours.filter((h) => {
          return h.exp > 0 && (h.exp * rtEff) > (cheapestImport + 0.005);
        });

        let arbitrageReserveDeliver = 0;
        for (const h of profitableExportHours) {
          arbitrageReserveDeliver += maxDischargeKW;
        }

        arbitrageReserveStored = Math.min(
          arbitrageReserveDeliver / dischargeEff,
          socMax
        );
      }

      // 3) Keep room for low-value / better-later solar
      const maxAllowedSOCForSolarRoom = Math.max(socMin, socMax - pvReserveStored);

      // 4) First reserve battery for future expensive home demand
      let targetSOC = Math.min(pctTargetSOC, homeDemandReserveStored);

      // 5) If energy trading is ON, allow extra overnight charge for arbitrage,
      // but only using spare capacity beyond the home-demand reserve.
      if (allowEnergyTrading && exportFromBatteryEnabled) {
        const spareCapacityAfterHomeReserve = Math.max(0, socMax - homeDemandReserveStored);
        const usableArbitrageStored = Math.min(arbitrageReserveStored, spareCapacityAfterHomeReserve);

        targetSOC = Math.max(
          targetSOC,
          Math.min(pctTargetSOC, homeDemandReserveStored + usableArbitrageStored)
        );
      }

      // 6) Never exceed the level that would block solar we want to keep
      targetSOC = Math.min(targetSOC, maxAllowedSOCForSolarRoom);

      if (dayStart === DEBUG_DAY_START) {
        debugSim("----- PHASE 3 DAY PLAN DEBUG -----");
        debugSim("dayStart:", dayStart);
        debugSim("cheapestImport:", cheapestImport);
        debugSim("pvReserveStored:", pvReserveStored);
        debugSim("homeDemandReserveStored:", homeDemandReserveStored);
        debugSim("arbitrageReserveStored:", arbitrageReserveStored);
        debugSim("pctTargetSOC:", pctTargetSOC);
        debugSim("maxAllowedSOCForSolarRoom:", maxAllowedSOCForSolarRoom);
        debugSim("targetSOC:", targetSOC);
        debugSim("allowEnergyTrading:", allowEnergyTrading);
        debugSim("exportFromBatteryEnabled:", exportFromBatteryEnabled);
        debugSim(
          "planGridChargeIn:",
          planGridChargeIn.map((v) => Math.round((v || 0) * 1000) / 1000)
        );
      }

      // 6) Only grid-charge if targetSOC is above current SOC
      // IMPORTANT: do NOT mutate the real `soc` inside planning.
      // Use `socAt` (planner's simulated SOC).
      let socAt = soc; // start planning from current real SOC

      if (socAt < targetSOC) {
        const byCheapestImport = [...cheapImportHours].sort((a, b) => a.imp - b.imp);

        for (const h of byCheapestImport) {
          if (socAt >= targetSOC) break;

          const roomStored = targetSOC - socAt;
          if (roomStored <= 0) break;

          // convert stored-room to grid input limit
          const maxGridIn = roomStored / chargeEff;

          const gridToBattery = Math.min(maxChargeKW, maxGridIn);
          if (gridToBattery <= 0) continue;

          planGridChargeIn[h.i] = gridToBattery;

          // Update ONLY the planned SOC (socAt), NOT the real SOC.
          socAt += gridToBattery * chargeEff;
        }
      }

    }


    // ---- C) Plan export-from-battery (reserve for future expensive imports) ----
    // Export is allowed, but only the portion that is truly surplus after reserving energy
    // to avoid future imports that cost MORE than exporting now.
    if (exportFromBatteryEnabled) {
      const rtEff = chargeEff * dischargeEff;

      // For "is this export hour worth considering?"
      const bestExport = Math.max(...hours.map(h => h.exp));

      for (let idx = 0; idx < dayLen; idx++) {
        const current = hours[idx];

        if (current.exp <= 0.01) continue;

        // Don’t export from battery during cheap import windows (especially overnight),
        // because it leads to silly behaviour when export is flat.
        // (If you REALLY want to allow it, remove this.)
        if (isCheapImportWindow(tariff, current.hod)) continue;

        // Optional: only bother exporting in "high export" hours (helps Flux behave nicely)
        // If export is flat all day, this will allow all hours (since bestExport == exp).
        if (current.exp < bestExport - 0.001) continue;

        // If energy trading is OFF, only export from battery in hours that are
        // genuinely better than earlier PV-surplus export hours.
        //
        // This prevents silly "store then export later at the same flat export rate" behaviour.
        if (!allowEnergyTrading) {
          const earlierPvWithLowerExport = hours
            .slice(0, idx)
            .some((h) => h.pvSurplus > 0.001 && h.exp < current.exp - 0.0005);

          if (!earlierPvWithLowerExport) continue;
        }

        // ------------------------------------------------------------
        // 1) Reserve deliverable energy for future HOME demand first.
        //
        // We should only export battery energy that is genuinely surplus after
        // protecting later household demand.
        // ------------------------------------------------------------
        let reserveDeliver = 0;
        for (let j = idx; j < dayLen; j++) {
          const h = hours[j];

          if (h.netLoad <= 0) continue;

          const needDeliver = allowGridCharge
            ? Math.max(0, Number(planDischargeToLoad[h.i] || 0))
            : Math.min(h.netLoad, maxDischargeKW);

          reserveDeliver += Math.min(needDeliver, maxDischargeKW);
        }
        const reserveStored = reserveDeliver / dischargeEff;

        // ------------------------------------------------------------
        // 2) Estimate SOC at this hour (socAt) using the day plan up to idx
        //    NOTE: include planned export discharge too (this was missing in your code).
        // ------------------------------------------------------------
        let socAt = soc;

        for (let k = 0; k <= idx; k++) {
          const h = hours[k];

          // grid charge in (stored)
          const gIn = Number(planGridChargeIn[h.i] || 0);
          if (gIn > 0 && socAt < socMax) {
            const roomStored = socMax - socAt;
            const gUsed = Math.min(gIn, maxChargeKW, roomStored / chargeEff);
            socAt += gUsed * chargeEff;
          }

          // PV charge in (stored)
          if (h.pvSurplus > 0 && socAt < socMax) {
            const roomStored = socMax - socAt;
            const pvToBattIn = Math.min(h.pvSurplus, maxChargeKW, roomStored / chargeEff);
            socAt += pvToBattIn * chargeEff;
          }

          // discharge-to-load (stored out)
          const dLoad = Number(planDischargeToLoad[h.i] || 0);
          if (dLoad > 0) {
            socAt -= dLoad / dischargeEff;
            if (socAt < socMin) socAt = socMin;
          }

          // discharge-to-export already planned earlier in the day (stored out)
          const dExp = Number(planDischargeToExport[h.i] || 0);
          if (dExp > 0) {
            socAt -= dExp / dischargeEff;
            if (socAt < socMin) socAt = socMin;
          }
        }

        // ------------------------------------------------------------
        // 3) Only export what’s surplus beyond reserve + socMin
        // ------------------------------------------------------------
        const surplusStored = Math.max(0, socAt - socMin - reserveStored);
        if (surplusStored <= 0) continue;

        const deliverableExport = surplusStored * dischargeEff;
        let exportDeliver = Math.min(deliverableExport, maxDischargeKW);

        // ------------------------------------------------------------
        // 4) If this is true arbitrage (charging from cheap import), require profitability.
        //    (We ONLY apply this profitability rule when grid charging is enabled.)
        // ------------------------------------------------------------
        if (allowGridCharge) {
          const cheapestImp = cheapImportHours.length
            ? Math.min(...cheapImportHours.map(h => h.imp))
            : Math.min(...hours.map(h => h.imp));

          const profitable = (current.exp * rtEff) > (cheapestImp + 0.005);
          if (!profitable) continue;
        }

        planDischargeToExport[current.i] = exportDeliver;
      }
    }

    return { planDischargeToLoad, planGridChargeIn, planDischargeToExport, planStorePV };
  }


  // Walk the year in day chunks
  let t = 0;
  while (t < n) {
    const dayStart = t;
    const dayLen = Math.min(24, n - dayStart);
    const { planDischargeToLoad, planGridChargeIn, planDischargeToExport, planStorePV } = planDayRetailRate(dayStart, dayLen);

    for (let i = 0; i < dayLen; i++) {
      const idx = dayStart + i;

      const pv = Math.max(0, Number(pvHourlyKWh[idx] || 0));
      const load = Math.max(0, Number(loadHourlyKWh[idx] || 0));

      // ✅ Correct indexing: use absolute hour index
      hourly.pv[idx] = pv;
      hourly.load[idx] = load;

      const m = monthIdx[idx] ?? 0;

      // 1) Direct PV to load
      const direct = Math.min(pv, load);
      let pvLeft = pv - direct;
      let loadLeft = load - direct;

      // 2) Planned grid charge (retail dispatch)
      // Charge from grid first so SOC is ready for expensive hours.
      // (This is a simplification; SAM uses iterative planning with forecasts.)
      let chargedFromGrid = 0;
      if (capUsable > 0 && dispatchMode === "retail_rate" && allowGridCharge) {
        const gridIn = Math.max(0, Number(planGridChargeIn[i] || 0));
        if (gridIn > 0 && soc < socMax) {
          const roomStored = socMax - soc; // kWh stored room
          const maxGridIn = roomStored / chargeEff; // grid kWh we can input this hour
          const gridToBattery = Math.min(gridIn, maxChargeKW, maxGridIn);

          const stored = gridToBattery * chargeEff;
          soc += stored;
          socFromGrid += stored;

          chargedFromGrid = gridToBattery;
          battChargeHourly_fromGrid[idx] = gridToBattery;
          
          hourly.battChargeFromGrid[idx] = gridToBattery;

          // grid charging increases import later
          // We’ll account by adding to loadLeft (grid import)
          loadLeft += gridToBattery;
        }
      }

      // 3) Charge battery from remaining PV only if the planner says this PV is worth storing
      let chargedFromPV = 0;
      const shouldStorePVNow = !allowGridCharge || !!planStorePV[i];

      if (idx >= DEBUG_DAY_START && idx < DEBUG_DAY_START + 24) {
        debugSim("PV STORE EXECUTION", {
          idx,
          hod: hourOfDay[idx],
          shouldStorePVNow,
          pvLeftBeforeStore: pvLeft,
        });
      }

      if (capUsable > 0 && pvLeft > 0 && soc < socMax && shouldStorePVNow) {
        const room = socMax - soc;
        const pvToBattery = Math.min(pvLeft, maxChargeKW, room / chargeEff);
        const stored = pvToBattery * chargeEff;

        soc += stored;
        socFromPV += stored;

        pvLeft -= pvToBattery;
        chargedFromPV = pvToBattery;

        battChargeHourly_fromPV[idx] = pvToBattery;
      }

      hourly.battChargeFromPV[idx] = chargedFromPV;
      monthly.batteryChargeFromPV[m] += chargedFromPV;


      // 4) Discharge battery to meet load
      // Goal:
      // - Never discharge during cheap import windows (save for expensive hours)
      // - If grid charging is OFF, do NOT cap discharge by the day-ahead plan,
      //   because the plan doesn't "know" the battery will be refilled by PV later.
      let dischargedToLoad = 0;

      if (capUsable > 0 && loadLeft > 0 && soc > socMin) {
        const availableStored = soc - socMin;
        const canDeliver = availableStored * dischargeEff;

        const hodNow = hourOfDay[idx];

        // Are we in a "cheap import window" (overnight night window / flux off-peak)?
        const cheapNow =
          (dispatchMode === "retail_rate" && tariff)
            ? isCheapImportWindow(tariff, hodNow)
            : false;

        // Do not discharge during cheap hours (regardless of grid-charging toggle)
        if (!cheapNow) {
          // In retail-rate mode, the planner tells us *where* to discharge.
          // But if grid charging is OFF, the planner underestimates energy available later
          // (because PV can refill the battery), so we must allow discharge even if plan=0.
          const planned = Math.max(0, Number(planDischargeToLoad[i] || 0));

          let capByPlan;
          const tariffTypeNow = String(tariff?.tariffType || "");

          // Flux: preserve charge for peak import hours
          if (dispatchMode === "retail_rate" && tariff && tariffTypeNow === "flux") {
            capByPlan = planned;
          }
          // Overnight: once outside cheap hours, behave like normal self-consumption
          else if (dispatchMode === "retail_rate" && tariff && tariffTypeNow === "overnight") {
            capByPlan = loadLeft;
          }
          // Non-retail / default
          else {
            capByPlan = loadLeft;
          }

          const deliver = Math.min(loadLeft, canDeliver, maxDischargeKW, capByPlan);

          if (deliver > 0) {
            const storedOut = deliver / dischargeEff;

            // Work out current PV/grid mix inside the battery
            const totalStoredTracked = socFromPV + socFromGrid;

            const pvShare = totalStoredTracked > 0 ? socFromPV / totalStoredTracked : 0;
            const gridShare = totalStoredTracked > 0 ? socFromGrid / totalStoredTracked : 0;

            // Split delivered energy by source
            const pvDeliveredToLoad = deliver * pvShare;
            const gridDeliveredToLoad = deliver * gridShare;

            // Split stored energy removed by source
            const pvStoredOut = storedOut * pvShare;
            const gridStoredOut = storedOut * gridShare;

            // Update actual SOC
            soc -= storedOut;

            // Update tracked source balances
            socFromPV = Math.max(0, socFromPV - pvStoredOut);
            socFromGrid = Math.max(0, socFromGrid - gridStoredOut);

            loadLeft -= deliver;
            dischargedToLoad = deliver;

            battDischargeHourly_toLoad[idx] = deliver;
            hourly.battDischargeToLoad[idx] = deliver;
            hourly.battDischargeFromPVToLoad[idx] = pvDeliveredToLoad;
            hourly.battDischargeFromGridToLoad[idx] = gridDeliveredToLoad;

            // NEW: source-aware discharge tracking
            battDischargeFromPVToLoadHourly[idx] = pvDeliveredToLoad;
            battDischargeFromGridToLoadHourly[idx] = gridDeliveredToLoad;
          }
        }
      }


      // 4b) Optional discharge to export (only if planned and battery has energy)
      // SAFETY: never export battery while the home still has unmet load in the same hour
      let dischargedToExport = 0;

      if (
        capUsable > 0 &&
        dispatchMode === "retail_rate" &&
        exportFromBatteryEnabled &&
        loadLeft <= 0 // ✅ critical safeguard
      ) {
        const plannedExp = Math.max(0, Number(planDischargeToExport[i] || 0));

        if (plannedExp > 0 && soc > socMin) {
          let deliver = 0;
          let storedOut = 0;

          if (allowEnergyTrading) {
            // Phase 3 behaviour will allow exporting any surplus battery energy
            const availableStored = soc - socMin;
            const canDeliver = availableStored * dischargeEff;

            deliver = Math.min(plannedExp, canDeliver, maxDischargeKW);

            if (deliver > 0) {
              storedOut = deliver / dischargeEff;

              const totalStoredTracked = socFromPV + socFromGrid;
              const pvShare = totalStoredTracked > 0 ? socFromPV / totalStoredTracked : 0;
              const gridShare = totalStoredTracked > 0 ? socFromGrid / totalStoredTracked : 0;

              const pvStoredOut = storedOut * pvShare;
              const gridStoredOut = storedOut * gridShare;

              soc -= storedOut;
              socFromPV = Math.max(0, socFromPV - pvStoredOut);
              socFromGrid = Math.max(0, socFromGrid - gridStoredOut);

              dischargedToExport = deliver;
              hourly.battDischargeToExport[idx] = deliver;
            }
          } else {
            // Phase 2 behaviour:
            // only export solar-origin energy from the battery
            const availablePvStored = Math.max(0, socFromPV);
            const canDeliverPv = availablePvStored * dischargeEff;

            deliver = Math.min(plannedExp, canDeliverPv, maxDischargeKW);

            if (deliver > 0) {
              storedOut = deliver / dischargeEff;

              soc -= storedOut;
              socFromPV = Math.max(0, socFromPV - storedOut);

              dischargedToExport = deliver;
              hourly.battDischargeToExport[idx] = deliver;
            }
          }
        }
      }


      // 5) Export / import
      const exported = Math.max(0, pvLeft) + dischargedToExport;
      const imported = Math.max(0, loadLeft);

      hourly.exportKWh[idx] = exported;
      hourly.importKWh[idx] = imported;
      hourly.soc[idx] = soc;

      exportHourly[idx] = exported;
      importHourly[idx] = imported;
      directPVtoLoadHourly[idx] = direct;

      // 6) Monthly accounting
      const selfUsed = direct + dischargedToLoad;

      monthly.generation[m] += pv;
      monthly.selfUsed[m] += selfUsed;
      monthly.exported[m] += exported;
      monthly.imported[m] += imported;
      monthly.batteryCharge[m] += (chargedFromPV + chargedFromGrid);
      monthly.batteryDischarge[m] += dischargedToLoad;
      monthly.batteryDischargeFromPVToLoad[m] += Number(battDischargeFromPVToLoadHourly[idx] || 0);
      monthly.batteryDischargeFromGridToLoad[m] += Number(battDischargeFromGridToLoadHourly[idx] || 0);
      monthly.pvExportDirect[m] += Math.max(0,
        Number(pv || 0) -
        Number(direct || 0) -
        Number(chargedFromPV || 0)
      );
      // Debug first summer-like day block if needed
      if (idx >= DEBUG_DAY_START && idx < DEBUG_DAY_START + 24) {
        debugSim("SUMMER FLOW DEBUG", {
          idx,
          hod: hourOfDay[idx],
          pv,
          load,
          direct,
          chargedFromPV,
          chargedFromGrid,
          dischargedToLoad,
          dischargedToExport,
          pvLeft,
          loadLeft,
          exported,
          imported,
          soc,
          socFromPV,
          socFromGrid,
        });
      }
    }

    t += dayLen;
  }

  // Round monthly for stable charts
  for (const k of Object.keys(monthly)) {
    monthly[k] = monthly[k].map((v) => Math.round(v * 100) / 100);
  }

  const annual = {
    generation: monthly.generation.reduce((s, v) => s + v, 0),
    selfUsed: monthly.selfUsed.reduce((s, v) => s + v, 0),
    exported: monthly.exported.reduce((s, v) => s + v, 0),
    imported: monthly.imported.reduce((s, v) => s + v, 0),
  };

  if (hourly.soc.some((v) => v < -1e-6)) {
    console.warn("SOC went negative (should not happen).");
  }


  return {
    monthly,
    annual,
    hourly: {
      // 0–23 repeated for charts
      hours: Array.from({ length: n }, (_, i) => i % 24),

      // Core series for plotting
      pvKWh: hourly.pv,
      loadKWh: hourly.load,
      socKWh: hourly.soc,

      // Grid flows
      importKWh: importHourly,
      exportKWh: exportHourly,

      // Battery flows
      battChargeFromPVKWh: battChargeHourly_fromPV,
      battChargeFromGridKWh: battChargeHourly_fromGrid,
      battDischargeToLoadKWh: battDischargeHourly_toLoad,
      battDischargeToExportKWh: hourly.battDischargeToExport,
      battDischargeFromPVToLoadKWh: battDischargeFromPVToLoadHourly,
      battDischargeFromGridToLoadKWh: battDischargeFromGridToLoadHourly,

      // PV direct
      directPVToLoadKWh: directPVtoLoadHourly,
    },
  };
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




// ===== Region table (unchanged) =====
const REGION_TABLE = [
  { key: "scotland", areas: ["AB", "DD", "FK", "IV", "KW", "KY", "PH", "HS", "ZE"], kWhPerKwp: 875 },
  { key: "north", areas: ["DG", "EH", "G", "KA", "ML", "TD", "NE", "DH", "SR", "TS"], kWhPerKwp: 925 },
  { key: "north_midlands", areas: ["LA", "CA", "DL", "YO", "BB", "BD", "HD", "HG", "HU", "LS", "WF"], kWhPerKwp: 950 },
  { key: "midlands", areas: ["L", "M", "PR", "WN", "BL", "OL", "SK", "CW", "CH", "WA", "SY", "ST", "DE", "NG", "LE", "NN", "CV", "B"], kWhPerKwp: 975 },
  { key: "wales_south_central", areas: ["CF", "NP", "SA", "LD", "HR", "GL", "OX", "SN", "RG"], kWhPerKwp: 1025 },
  { key: "south_west", areas: ["BA", "BS", "TA", "DT", "BH", "SP", "SO", "PO"], kWhPerKwp: 1050 },
  { key: "devon_cornwall", areas: ["EX", "TQ", "TR", "PL"], kWhPerKwp: 1100 },
  { key: "south_east", areas: ["GU", "KT", "SM", "CR", "RH", "BN", "ME", "TN", "BR", "DA"], kWhPerKwp: 1075 },
  { key: "london", areas: ["SW", "SE", "W", "NW", "N", "E", "EC", "WC", "HA", "UB", "TW"], kWhPerKwp: 1050 },
];

function getRegionInfoForPostcode(postcode) {
  const area = getPostcodeArea(postcode);
  if (!area) return { key: "default", kWhPerKwp: 975 };

  const upperArea = area.toUpperCase();
  for (const region of REGION_TABLE) {
    if (region.areas.includes(upperArea)) {
      return { key: region.key, kWhPerKwp: region.kWhPerKwp };
    }
  }
  return { key: "default", kWhPerKwp: 975 };
}

function getShadingFactor(shading) {
  switch (shading) {
    case "none": return 1.0;
    case "some": return 0.9;
    case "a_lot": return 0.8;
    default: return 0.95;
  }
}

function calculateQuote(input, opts = {}) {
  const cfg = CONFIG;

  // ✅ Normalize panelOption (supports legacy PanelOption if ever sent)
  const normalizedPanelOption = input.panelOption || input.PanelOption || "value";
  input.panelOption = normalizedPanelOption;

  const panelOpt = cfg.panelOptions[input.panelOption] || cfg.panelOptions.value;
  const panelKwp = panelOpt.watt / 1000;

  // ✅ Declare panelCount BEFORE using it
  let panelCount;

  // If roofs provided, override panelCount to match roof inputs (unless panelCount already supplied)
  if (!input.panelCount || Number(input.panelCount) <= 0) {
    if (Array.isArray(input.roofs) && input.roofs.length > 0) {
      const totalPanelsFromRoofs = input.roofs.reduce((sum, r) => sum + Number(r?.panels || 0), 0);
      if (totalPanelsFromRoofs > 0) {
        panelCount = totalPanelsFromRoofs;
      }
    }
  }

  // 1) Estimate annual kWh if missing
  let annualKWh = input.annualKWh;
  if (!annualKWh && input.monthlyBill) {
    const annualBill = input.monthlyBill * 12;
    annualKWh = annualBill / cfg.assumedPricePerKWh;
  }
  if (!annualKWh) annualKWh = 3000;

  // 2) If user provided panelCount explicitly, use that
  if (!panelCount && input.panelCount && Number(input.panelCount) > 0) {
    panelCount = Number(input.panelCount);
    if (!opts?.silent) {
      console.log("Using manual panel count:", panelCount);
    }
  }

  // 3) Otherwise auto-size
  if (!panelCount) {
    const sizingKwhPerKwp = 1000;
    let requiredKwp = annualKWh / sizingKwhPerKwp;

    const roofCap = cfg.roofKwpCaps[input.roofSize] || cfg.roofKwpCaps.medium;
    requiredKwp = Math.min(Math.max(requiredKwp, 2), roofCap);

    if (input.shading === "a_lot") requiredKwp *= 0.9;

    panelCount = Math.round(requiredKwp / panelKwp);
    if (panelCount < 6) panelCount = 6;
    console.log("Using automatic panel count:", panelCount);
  }

  const systemSizeKwp = panelCount * panelKwp;

  const regionInfo = getRegionInfoForPostcode(input.postcode);
  const regionKey = regionInfo.key || "default";
  const regionMult = cfg.regionalMultipliers[regionKey] || cfg.regionalMultipliers.default;

  const baseSystemCost = systemSizeKwp * cfg.baseCostPerKwp * panelOpt.multiplier * regionMult;

  const panelsCost = baseSystemCost * 0.65;
  const inverterCost = baseSystemCost * 0.23;
  // ===============================
  // Scaffolding cost based on roof count
  // ===============================
  const roofCount =
    Array.isArray(input.roofs) && input.roofs.length > 0
      ? input.roofs.length
      : 1;

  let scaffoldingCost =
    cfg.scaffolding.firstRoof +
    Math.max(roofCount - 1, 0) * cfg.scaffolding.additionalRoof;

  // Apply regional multiplier
  scaffoldingCost *= regionMult;


  const batteryKWh = input.batteryKWh || 0;
  const batteryCost = batteryKWh > 0 ? batteryKWh * cfg.batteryCostPerKwh * regionMult : 0;

  let extrasCost = 0;
  if (input.extras?.birdProtection) extrasCost += 350 * regionMult;
  if (input.extras?.evCharger) extrasCost += 900 * regionMult;

  const directCosts = panelsCost + inverterCost + scaffoldingCost + batteryCost + extrasCost;
  const labourAndMargin = directCosts * 0.18;
  const total = directCosts + labourAndMargin;

  const priceLow = Math.round(total * (1 - cfg.priceRangeFactor));
  const priceHigh = Math.round(total * (1 + cfg.priceRangeFactor));

  const shadingFactor = getShadingFactor(input.shading);
  const fallbackAnnual = Math.round(systemSizeKwp * cfg.irradianceFactor * 1000);

  const estAnnualGenerationKWh =
    typeof opts.annualGenerationOverrideKWh === "number"
      ? opts.annualGenerationOverrideKWh
      : fallbackAnnual;

  return {
    systemSizeKwp: Number(systemSizeKwp.toFixed(2)),
    panelCount,
    panelWatt: panelOpt.watt,
    priceLow,
    priceHigh,
    breakdown: {
      panels: Math.round(panelsCost),
      inverter: Math.round(inverterCost),
      battery: Math.round(batteryCost),
      scaffolding: Math.round(scaffoldingCost),
      extras: Math.round(extrasCost),
      labourAndMargin: Math.round(labourAndMargin),
    },
    estAnnualGenerationKWh,
    kWhPerKwpRegion: regionInfo.kWhPerKwp,
    shadingFactor,
    assumedAnnualConsumptionKWh: Math.round(annualKWh),
  };
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

// Main function: returns a self-consumption fraction from MCS tables, or null if not possible
function lookupMcsSelfConsumptionFraction({
  annualGenerationKWh,
  annualConsumptionKWh,
  batteryKWh,
  occupancyProfile,
}) {
  if (!MCS_TABLES) {
    console.log("[MCS DEBUG] MCS_TABLES missing (not loaded).");
    return null;
  }

  const gen = Number(annualGenerationKWh);
  const cons = Number(annualConsumptionKWh);
  const batt = Number(batteryKWh || 0);

  if (!Number.isFinite(gen) || gen <= 0) return null;
  if (!Number.isFinite(cons) || cons <= 0) return null;

  const occ = MCS_TABLES[occupancyProfile] ? occupancyProfile : "half_day";
  const tablesForOcc = MCS_TABLES[occ];

  if (!Array.isArray(tablesForOcc) || tablesForOcc.length === 0) {
    console.log("[MCS DEBUG] No tables for occupancy:", occ);
    return null;
  }

  // 1) pick consumption band table
  const table =
    tablesForOcc.find((t) => {
      const min = t?.consumption_range?.min_kwh;
      const max = t?.consumption_range?.max_kwh;
      return typeof min === "number" && typeof max === "number" && cons >= min && cons <= max;
    }) || null;

  if (!table) {
    console.log("[MCS DEBUG] No matching consumption band for cons:", cons, "occ:", occ);
    return null;
  }

  // 2) pick generation bin row
  const row =
    Array.isArray(table.rows)
      ? table.rows.find((r) => {
          const min = r?.generation_bin?.min_kwh;
          const max = r?.generation_bin?.max_kwh;
          return typeof min === "number" && typeof max === "number" && gen >= min && gen <= max;
        })
      : null;

  if (!row) {
    console.log("[MCS DEBUG] No matching generation bin for gen:", gen, "cons:", cons, "occ:", occ);
    return null;
  }

  // 3) pick nearest battery column
  const batteryCols = Array.isArray(table.battery_kwh) ? table.battery_kwh : [];
  if (batteryCols.length === 0) {
    console.log("[MCS DEBUG] battery_kwh columns missing for table", table?.consumption_range);
    return null;
  }

  let bestIdx = 0;
  let bestDiff = Infinity;

  for (let i = 0; i < batteryCols.length; i++) {
    const colVal = Number(batteryCols[i]);
    if (!Number.isFinite(colVal)) continue;

    const diff = Math.abs(colVal - batt);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  const frac = row?.self_consumption_fraction?.[bestIdx];

  if (typeof frac !== "number") {
    console.log("[MCS DEBUG] Fraction missing at battery index:", bestIdx, "battery:", batt);
    console.log("[MCS DEBUG] Row keys:", Object.keys(row || {}));
    return null;
  }

  return frac;
}


function estimateSelfConsumptionAndSavings(input, quote) {
  const cfg = CONFIG;
  const gen = quote.estAnnualGenerationKWh;
  const demand = quote.assumedAnnualConsumptionKWh || input.annualKWh || gen || 0;

  // =========================================================
  // MCS TABLE MODE (only when BOTH gen and demand <= 6000)
  // =========================================================
  const useMcs =
    gen <= 6000 &&
    demand <= 6000;

  if (useMcs) {
    const mcsFrac = lookupMcsSelfConsumptionFraction({
      annualGenerationKWh: gen,
      annualConsumptionKWh: demand,
      batteryKWh: input?.batteryKWh || 0,
      occupancyProfile: input?.occupancyProfile || "half_day",
    });

    console.log("[MCS DEBUG] lookup returned:", mcsFrac);

    if (typeof mcsFrac === "number") {
      const selfFraction = Math.min(Math.max(mcsFrac, 0), 0.95);
      const selfKWh = Math.round(selfFraction * gen);
      const exportKWh = Math.max(gen - selfKWh, 0);

      const importPrice = cfg.assumedPricePerKWh;
      const segPrice = cfg.assumedSegPricePerKWh;

      const annualBillSavings = Math.round(selfKWh * importPrice);
      const annualSegIncome = Math.round(exportKWh * segPrice);
      const totalAnnualBenefit = annualBillSavings + annualSegIncome;

      const midPrice = (quote.priceLow + quote.priceHigh) / 2;
      const simplePaybackYears =
        totalAnnualBenefit > 0
          ? Number((midPrice / totalAnnualBenefit).toFixed(1))
          : null;

      return {
        selfConsumptionFraction: selfFraction,
        selfConsumptionKWh: selfKWh,
        annualBillSavings,
        annualSegIncome,
        totalAnnualBenefit,
        simplePaybackYears,
        selfConsumptionModel: "mcs",
      };
    }

    console.log("MCS lookup failed, falling back to heuristic.");
  }



  if (!gen || !demand) {
    return {
      selfConsumptionFraction: 0,
      selfConsumptionKWh: 0,
      annualBillSavings: 0,
      annualSegIncome: 0,
      totalAnnualBenefit: 0,
      simplePaybackYears: null,
    };
  }

  let ratio = gen / demand;
  if (ratio < 0.5) ratio = 0.5;
  if (ratio > 2) ratio = 2;

  const occ = input.occupancyProfile || "half_day";

  function lerp(x, x1, y1, x2, y2) {
    if (x <= x1) return y1;
    if (x >= x2) return y2;
    return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  }

  let baseAt05, baseAt10, baseAt20;

  switch (occ) {
    case "home_all_day":
      baseAt05 = 0.5;
      baseAt10 = 0.30;
      baseAt20 = 0.25;
      break;
    case "out_all_day":
      baseAt05 = 0.24;
      baseAt10 = 0.18;
      baseAt20 = 0.12;
      break;
    default:
      baseAt05 = 0.40;
      baseAt10 = 0.25;
      baseAt20 = 0.15;
  }

  let baseSelf;
  if (ratio <= 1) baseSelf = lerp(ratio, 0.5, baseAt05, 1.0, baseAt10);
  else baseSelf = lerp(ratio, 1.0, baseAt10, 2.0, baseAt20);

  const batteryKWh = input.batteryKWh || 0;

  // NEW: MCS-shaped saturating battery uplift
  const batteryUplift = batteryUpliftMcsTrend({
    occupancyProfile: occ,
    ratio,
    batteryKWh,
  });

  let selfFraction = baseSelf + batteryUplift;
  if (selfFraction > 0.95) selfFraction = 0.95;
  if (selfFraction < 0) selfFraction = 0;

  const selfKWh = Math.round(selfFraction * gen);
  const exportKWh = Math.max(gen - selfKWh, 0);

  const importPrice = cfg.assumedPricePerKWh;
  const segPrice = cfg.assumedSegPricePerKWh;

  const annualBillSavings = Math.round(selfKWh * importPrice);
  const annualSegIncome = Math.round(exportKWh * segPrice);

  const totalAnnualBenefit = annualBillSavings + annualSegIncome;

  const midPrice = (quote.priceLow + quote.priceHigh) / 2;
  const simplePaybackYears =
    totalAnnualBenefit > 0 ? Number((midPrice / totalAnnualBenefit).toFixed(1)) : null;

  return {
    selfConsumptionFraction: selfFraction,
    selfConsumptionKWh: selfKWh,
    annualBillSavings,
    annualSegIncome,
    totalAnnualBenefit,
    simplePaybackYears,
    selfConsumptionModel: "heuristic",
  };
}

// ====== ROUTES ======
app.get("/", (req, res) => {
  res.send("Solar quote API is running");
});



app.post("/api/quote", async (req, res) => {
  try {
    const input = req.body || {};

    // ==============================
    // Tariffs: BEFORE vs AFTER (define ONCE, early)
    // ==============================
    const energyInflationRate = Number(CONFIG.energyInflationRate || 0.06);

    const tariffBefore = input?.tariffBefore || {
      tariffType: "standard",
      importPrice: Number(CONFIG.assumedPricePerKWh || 0.29),
      standingChargePerDay: Number(CONFIG.standingChargePerDay || 0.60),
    };

    const tariffAfter = input?.tariffAfter || input?.tariff || {
      tariffType: "standard",
      importPrice: Number(CONFIG.assumedPricePerKWh || 0.29),
      standingChargePerDay: Number(CONFIG.standingChargePerDay || 0.60),
      segPrice: Number(CONFIG.assumedSegPricePerKWh || 0.15),
    };
    
    const importPriceBefore = Number(tariffBefore.importPrice || CONFIG.assumedPricePerKWh || 0.29);

    // For “after solar”, import/export can be TOU; these are fallback values
    const importPriceAfter = Number(tariffAfter.importPrice || CONFIG.assumedPricePerKWh || 0.29);
    const segPriceAfter = Number(tariffAfter.segPrice || CONFIG.assumedSegPricePerKWh || 0.15);

    const standingChargePerDayAfter = Number(
      tariffAfter.standingChargePerDay ?? CONFIG.standingChargePerDay ?? 0.60
    );

    console.log("Received quote request with input:", input);

    // ✅ Normalise panelOption no matter what arrives
    input.panelOption = input.panelOption || input.PanelOption || "value";
    delete input.PanelOption;

    // ✅ Normalise postcode
    try {
      input.postcode = validateAndNormalisePostcode(input.postcode);
    } catch (addrErr) {
      console.warn("Postcode validation failed:", addrErr.message);
      return res.status(400).json({ error: addrErr.message });
    }

    const houseNumber = (input.houseNumber || "").trim();
    if (!houseNumber) {
      return res.status(400).json({ error: "House number / name is required." });
    }

    // ✅ Determine panel wattage from panel option (single source of truth)
    const panelOpt = CONFIG.panelOptions[input.panelOption] || CONFIG.panelOptions.value;
    const panelWatt = panelOpt.watt;

    // Prices (use user tariff if provided, otherwise fallback to CONFIG)
    const userTariff = input.tariff || {};


    // PVGIS outputs
    let pvgisAnnualKWh = null;
    let hourlyModel = null;

    // ------------------------------
    // 1) Try PVGIS HOURLY simulation (3-year average)
    // ------------------------------
    let hourlyYearData = null; // keep in outer scope for later use
    try {
      if (input.postcode && Array.isArray(input.roofs) && input.roofs.length > 0) {
        const years = [2021, 2022, 2023];

        const results = [];
        for (const y of years) {
          console.log(`Running PVGIS hourly simulation for year ${y}...`);
          const r = await runHourlyModelForYear({
            input,
            panelWatt,
            year: y,
            includeHourlyArrays: true,
          });
          results.push(r);
        }

        // ---- Monthly averages (for UI cards) ----
        const avgMonthlyGeneration   = averageMonthlyArrays(results.map(r => r.monthlyGenerationKWh));
        const avgMonthlySelfUsed     = averageMonthlyArrays(results.map(r => r.monthlySelfUsedKWh));
        const avgMonthlyExported     = averageMonthlyArrays(results.map(r => r.monthlyExportedKWh));
        const avgMonthlyImported     = averageMonthlyArrays(results.map(r => r.monthlyImportedKWh));
        const avgMonthlyBattCharge   = averageMonthlyArrays(results.map(r => r.monthlyBatteryChargeKWh));
        const avgMonthlyBattDischarge= averageMonthlyArrays(results.map(r => r.monthlyBatteryDischargeKWh));
        const avgMonthlyDirect       = averageMonthlyArrays(results.map(r => r.monthlyDirectToHomeKWh));
        const avgMonthlyBattChargeFromPV = averageMonthlyArrays(results.map(r => r.monthlyBatteryChargeFromPVKWh));
        const avgMonthlyBattDischargeFromPVToLoad = averageMonthlyArrays(results.map(r => r.monthlyBatteryDischargeFromPVToLoadKWh));
        const avgMonthlyBattDischargeFromGridToLoad = averageMonthlyArrays(results.map(r => r.monthlyBatteryDischargeFromGridToLoadKWh));
        const avgMonthlyPVExportDirect = averageMonthlyArrays(results.map(r => r.monthlyPVExportedDirectKWh));

        const avgAnnualGeneration = Math.round(sum12(avgMonthlyGeneration));
        pvgisAnnualKWh = avgAnnualGeneration;

        // ---- Canonical 8760 arrays used for ALL downstream calcs (recalc + battery recs) ----
        // Average PV across the 3 years; use load/monthIdx/hourOfDay from year[0] (they should align)
        const base = results[0];

        const avgPv8760 = averageHourlyArrays(results.map(r => r._pvHourlyKWh));
        const load8760  = base._loadHourlyKWh;
        const monthIdx8760 = base._monthIdx;
        const hod8760 = base._hourOfDay || (Array.isArray(avgPv8760) ? avgPv8760.map((_, i) => i % 24) : null);

        // Defensive checks (prevents silent weird graphs)
        if (!Array.isArray(avgPv8760) || avgPv8760.length !== 8760) throw new Error("avgPv8760 missing/invalid");
        if (!Array.isArray(load8760)  || load8760.length  !== 8760) throw new Error("load8760 missing/invalid");
        if (!Array.isArray(monthIdx8760) || monthIdx8760.length !== 8760) throw new Error("monthIdx8760 missing/invalid");
        if (!Array.isArray(hod8760) || hod8760.length !== 8760) throw new Error("hod8760 missing/invalid");

        // Store one “averaged year” record for downstream functions expecting hourlyYearData[0]
        hourlyYearData = [{
          year: "avg_2021_2023",
          pvHourlyKWh: avgPv8760,
          loadHourlyKWh: load8760,
          monthIdx: monthIdx8760,
          hourOfDay: hod8760,
        }];

        hourlyModel = {
          model: "hourly_pvgis_3yr_avg_2021_2023",
          years,
          monthlyGenerationKWh: avgMonthlyGeneration,
          monthlySelfUsedKWh: avgMonthlySelfUsed,
          monthlyExportedKWh: avgMonthlyExported,
          monthlyImportedKWh: avgMonthlyImported,

          monthlyBatteryChargeKWh: avgMonthlyBattCharge,
          monthlyBatteryDischargeKWh: avgMonthlyBattDischarge,
          monthlyBatteryChargeFromPVKWh: avgMonthlyBattChargeFromPV,
          monthlyBatteryDischargeFromPVToLoadKWh: avgMonthlyBattDischargeFromPVToLoad,
          monthlyBatteryDischargeFromGridToLoadKWh: avgMonthlyBattDischargeFromGridToLoad,
          monthlyPVExportedDirectKWh: avgMonthlyPVExportDirect,

          monthlyDirectToHomeKWh: avgMonthlyDirect,
          annualGenerationKWh: avgAnnualGeneration,
          annualSelfUsedKWh: Math.round(sum12(avgMonthlySelfUsed)),
          annualExportedKWh: Math.round(sum12(avgMonthlyExported)),
          annualImportedKWh: Math.round(sum12(avgMonthlyImported)),

          // IMPORTANT: attach the canonical 8760 arrays so /recalc uses the SAME inputs
          _pvHourlyKWh: avgPv8760,
          _loadHourlyKWh: load8760,
          _monthIdx: monthIdx8760,
          _hourOfDay: hod8760,
          _batteryKWh: Number(input.batteryKWh || 0),
        };

        console.log("3-year average annual PV kWh:", pvgisAnnualKWh);
      }
    } catch (e) {
      console.warn("PVGIS hourly 3-year simulation failed, falling back to PVcalc annual:", e.message);
      pvgisAnnualKWh = null;
      hourlyModel = null;
      hourlyYearData = null;
    }


    // ------------------------------
    // 2) If hourly didn't work, try PVGIS annual (existing method)
    // ------------------------------
    if (pvgisAnnualKWh === null) {
      try {
        if (input.postcode && Array.isArray(input.roofs) && input.roofs.length > 0) {
          pvgisAnnualKWh = await getTotalPvgisAnnualKWh({
            postcode: input.postcode,
            roofs: input.roofs,
            panelWatt,
          });
          console.log("PVGIS annual kWh (sum of roofs):", pvgisAnnualKWh);
        }
      } catch (e) {
        console.warn("PVGIS lookup failed, using fallback generation:", e.message);
        pvgisAnnualKWh = null;
      }
    }

    console.log("Incoming roofs:", input.roofs);

    // ------------------------------
    // 3) Base quote + fallback self-consumption/savings
    // ------------------------------
    const baseQuote = calculateQuote(input, {
      annualGenerationOverrideKWh: pvgisAnnualKWh,
    });

    const savings = estimateSelfConsumptionAndSavings(input, baseQuote);
    const quote = {
      ...baseQuote,
      ...savings,

      // ✅ store both
      tariffBefore: input.tariffBefore || null,
      tariffAfter: input.tariffAfter || input.tariff || null,

      // ✅ keep backward compatibility with your existing QuotePage UI
      tariff: input.tariffAfter || input.tariff || null,
    };


    const midPrice = (quote.priceLow + quote.priceHigh) / 2;
    const selectedBatteryUsable = Math.max(0, Number(input.batteryKWh || 0)); // user-entered is usable kWh

    // ------------------------------
    // 4) If hourlyModel exists, prefer it for savings + monthly financial charts
    // ------------------------------
    if (
      hourlyModel &&
      Array.isArray(hourlyModel.monthlyImportedKWh) &&
      hourlyModel.monthlyImportedKWh.length === 12 &&
      Array.isArray(hourlyModel.monthlyExportedKWh) &&
      hourlyModel.monthlyExportedKWh.length === 12 &&
      Array.isArray(hourlyModel.monthlySelfUsedKWh) &&
      hourlyModel.monthlySelfUsedKWh.length === 12
    ) {

      // Attach hourlyModel to quote ONCE
      quote.hourlyModel = hourlyModel;

      // Canonical averaged 8760 arrays for ALL downstream calcs
      const pv8760   = hourlyModel._pvHourlyKWh;
      const load8760 = hourlyModel._loadHourlyKWh;
      const mIdx8760 = hourlyModel._monthIdx;
      const hod8760  = hourlyModel._hourOfDay;

      if (!Array.isArray(pv8760)   || pv8760.length   !== 8760) throw new Error("hourlyModel._pvHourlyKWh missing/invalid");
      if (!Array.isArray(load8760) || load8760.length !== 8760) throw new Error("hourlyModel._loadHourlyKWh missing/invalid");
      if (!Array.isArray(mIdx8760) || mIdx8760.length !== 8760) throw new Error("hourlyModel._monthIdx missing/invalid");
      if (!Array.isArray(hod8760)  || hod8760.length  !== 8760) throw new Error("hourlyModel._hourOfDay missing/invalid");

      // Monthly household demand: load = selfUsed + imported
      const monthlyLoadKWh = Array(12).fill(0);
      for (let i = 0; i < load8760.length; i++) {
        const m = Number(mIdx8760[i] || 0);
        monthlyLoadKWh[m] += Number(load8760[i] || 0);
      }
      for (let m = 0; m < 12; m++) {
        monthlyLoadKWh[m] = round2(monthlyLoadKWh[m]);
      }

      quote.hourlyModel.monthlyLoadKWh = monthlyLoadKWh;

      // ===============================
      // Re-simulate hourly with tariff-aware dispatch (overnight/flux)
      // ===============================
      const tb = normalizeTariff(input.tariffBefore || {}, "before");
      const ta = normalizeTariff((input.tariffAfter || input.tariff || {}), "after");
      const retail = isRetailRateTariff(ta);

      let simTariff = null;

      simTariff = simulateHourByHour({
        pvHourlyKWh: pv8760,
        loadHourlyKWh: load8760,
        monthIdx: mIdx8760,
        hourOfDay: hod8760,

        batteryKWh: Number(input.batteryKWh || 0),

        tariff: ta,
        dispatchMode: retail ? "retail_rate" : "self_consumption",

        allowGridCharge: retail && !!ta.allowGridCharging,
        allowEnergyTrading: retail && !!ta.allowEnergyTrading,
        exportFromBatteryEnabled: retail && !!ta.exportFromBatteryEnabled,
      });

      quote.hourlyModel = {
        ...hourlyModel,

        // Use tariff-aware re-simulated monthly outputs
        monthlyGenerationKWh: simTariff.monthly.generation,
        monthlySelfUsedKWh: simTariff.monthly.selfUsed,
        monthlyExportedKWh: simTariff.monthly.exported,
        monthlyImportedKWh: simTariff.monthly.imported,

        monthlyBatteryChargeKWh: simTariff.monthly.batteryCharge,
        monthlyBatteryDischargeKWh: simTariff.monthly.batteryDischarge,

        monthlyBatteryChargeFromPVKWh: simTariff.monthly.batteryChargeFromPV,
        monthlyBatteryChargeFromGridKWh: simTariff.monthly.batteryChargeFromGrid,
        monthlyBatteryDischargeFromPVToLoadKWh: simTariff.monthly.batteryDischargeFromPVToLoad,
        monthlyBatteryDischargeFromGridToLoadKWh: simTariff.monthly.batteryDischargeFromGridToLoad,
        monthlyPVExportedDirectKWh: simTariff.monthly.pvExportDirect,

        // keep monthly load from the household demand model
        monthlyLoadKWh,

        // keep canonical averaged 8760 arrays for recalc
        _pvHourlyKWh: pv8760,
        _loadHourlyKWh: load8760,
        _monthIdx: mIdx8760,
        _hourOfDay: hod8760,
        _batteryKWh: Number(input.batteryKWh || 0),
      };

      const billing = computeHourlyBilling({
        loadKWh: load8760,
        importKWh: simTariff.hourly.importKWh,
        exportKWh: simTariff.hourly.exportKWh,
        hourOfDay: hod8760,
        monthIdx: mIdx8760,
        tariffBefore: tb,
        tariffAfter: ta,
      });

      const mcsRoofGroups = await getMcsRoofGroupData({
        postcode: input.postcode,
        roofs: input.roofs,
        panelWatt,
      });

      quote.mcsRoofGroups = mcsRoofGroups;

      // ✅ Use hourly billing as single source of truth
      const annualBaseline = round2(billing.annualBaseline);
      const annualAfterImportAndStanding = round2(billing.annualAfterImportAndStanding);
      const annualExportCredit = round2(billing.annualExportCredit);

      const annualSystemNet = round2(
        annualAfterImportAndStanding - annualExportCredit
      );

      quote.financialSeries = {
        ...quote.financialSeries,
        monthly: {
          annualBaseline,
          annualSystemBeforeSEG: annualAfterImportAndStanding,
          annualExportCredit,
          annualSystemNet,

          // UI expects this alias
          annualSystem: annualSystemNet,
        },
      };

      // These are the canonical numbers now
      const annualBillSavings = Math.max(0, round2(billing.annualBaseline - billing.annualAfterImportAndStanding));
      const annualSegIncome = round2(billing.annualExportCredit);
      const totalAnnualBenefit = round2(annualBillSavings + annualSegIncome);

      quote.annualBillSavings = annualBillSavings;
      quote.annualSegIncome = annualSegIncome;
      quote.totalAnnualBenefit = totalAnnualBenefit;

      quote.simplePaybackYears =
        totalAnnualBenefit > 0 ? Number((midPrice / totalAnnualBenefit).toFixed(1)) : null;

      quote.selfConsumptionModel = "hourly";

      // Build a monthly finance object in the shape your UI already expects
      const monthlyFinance = {
        monthlyBaseline: billing.monthlyBaseline,
        monthlyAfter: billing.monthlyAfterNet, // net after export income

        baselineMonthlyCost: billing.monthlyBaseline,
        systemMonthlyCostBeforeSEG: billing.monthlyAfterImportAndStanding,
        exportCreditMonthly: billing.monthlyExportCredit,
        systemMonthlyNet: billing.monthlyAfterNet,

        annualBaseline: billing.annualBaseline,
        annualSystemBeforeSEG: billing.annualAfterImportAndStanding,
        annualExportCredit: billing.annualExportCredit,
        annualSystemNet: billing.annualAfterNet,

        // legacy name your UI expects
        annualSystem: billing.annualAfterNet,
      };

      // ---- Debug days (24h) for visualisation ----
      try {
        const pv = quote.hourlyModel._pvHourlyKWh;
        const load = quote.hourlyModel._loadHourlyKWh;
        const monthIdx = quote.hourlyModel._monthIdx;
        const hourOfDay = quote.hourlyModel._hourOfDay;

        if (Array.isArray(pv) && Array.isArray(load) && Array.isArray(monthIdx) && Array.isArray(hourOfDay)) {
          const tAfter = tariffAfter || {};

          const simDebug = simulateHourByHour({
            pvHourlyKWh: pv,
            loadHourlyKWh: load,
            monthIdx,
            hourOfDay,
            batteryKWh: Number(input.batteryKWh || 0),

            tariff: ta,
            dispatchMode: retail ? "retail_rate" : "self_consumption",
            allowGridCharge: retail && !!ta.allowGridCharging,
            allowEnergyTrading: retail && !!ta.allowEnergyTrading,
            exportFromBatteryEnabled: retail && !!ta.exportFromBatteryEnabled,
          });

          console.log("simDebug.hourly keys:", Object.keys(simDebug.hourly || {}));
          console.log("sample hour 0:", Object.fromEntries(
            Object.entries(simDebug.hourly || {}).map(([k,v]) => [k, Array.isArray(v) ? v[0] : v])
          ));

          // Pick a “winter” day (Jan = monthIdx 0) and “summer” day (Jun = monthIdx 5)
          const pickDayStartBest = (targetMonth, scoreFn) => {
            let bestStart = 0;
            let bestScore = -Infinity;

            for (let start = 0; start <= monthIdx.length - 24; start += 24) {
              if (monthIdx[start] !== targetMonth) continue;

              let score = 0;
              for (let j = 0; j < 24; j++) {
                score += scoreFn(start + j);
              }

              if (score > bestScore) {
                bestScore = score;
                bestStart = start;
              }
            }

            return bestStart;
          };

          function pickDayStartByMedianPV(targetMonthIdx, monthIdxArr, pvArr) {
            const candidates = [];

            for (let start = 0; start <= monthIdxArr.length - 24; start += 24) {
              if (monthIdxArr[start] !== targetMonthIdx) continue;

              let pvSum = 0;
              for (let k = 0; k < 24; k++) pvSum += Math.max(0, Number(pvArr[start + k] || 0));

              candidates.push({ start, pvSum });
            }

            if (!candidates.length) return 0;

            // median PV day
            candidates.sort((a, b) => a.pvSum - b.pvSum);
            return candidates[Math.floor(candidates.length / 2)].start;
          }

          // example: Jan = 0, Jun = 5 (based on your monthIdx)
          //const winterStart = pickDayStartByMedianPV(0, monthIdx, pv);
          //const summerStart = pickDayStartByMedianPV(5, monthIdx, pv);


          // Winter: choose the Jan day with the MOST grid charging (shows overnight behaviour)
          const winterStart = pickDayStartBest(0, (idx) => Number(simDebug.hourly.battChargeFromGridKWh?.[idx] || 0));

          // Summer: choose the Jun day with the MOST PV (shows PV charging + export behaviour)
          const summerStart = pickDayStartBest(5, (idx) => Number(simDebug.hourly.pvKWh?.[idx] || 0));


          if (!Array.isArray(simDebug?.hourly?.pvKWh)) {
            throw new Error("simulateHourByHour did not return hourly.pvKWh array");
          }

          quote.hourlyModel.debugWinterDay = extractDaySlice(simDebug.hourly, winterStart);
          quote.hourlyModel.debugSummerDay = extractDaySlice(simDebug.hourly, summerStart);

          console.log("WINTER slice chargeFromGrid sum:",
            quote.hourlyModel.debugWinterDay.battChargeFromGridKWh.reduce((a,b)=>a+b,0)
          );
          console.log("WINTER slice chargeFromPV sum:",
            quote.hourlyModel.debugWinterDay.battChargeFromPVKWh.reduce((a,b)=>a+b,0)
          );
        }
      } catch (e) {
        console.warn("Debug day slice failed:", e.message);
      }

      console.log("WINTER import sum:", quote.hourlyModel.debugWinterDay.importKWh.reduce((a,b)=>a+b,0));
      console.log("WINTER gridCharge sum:", quote.hourlyModel.debugWinterDay.battChargeFromGridKWh.reduce((a,b)=>a+b,0));
      console.log("WINTER export sum:", quote.hourlyModel.debugWinterDay.exportKWh.reduce((a,b)=>a+b,0));
      console.log("WINTER dischargeToExport sum:", quote.hourlyModel.debugWinterDay.battDischargeToExportKWh.reduce((a,b)=>a+b,0));



      // ✅ Store both on quote (frontend can show “before” + “after” if different)
      quote.tariffBefore = { ...tb, importPrice: importPriceBefore, energyInflationRate };
      quote.tariffAfter = {
        ...ta,
        importPrice: importPriceAfter,
        segPrice: segPriceAfter,
        standingChargePerDay: standingChargePerDayAfter,
        energyInflationRate,
      };

      // ✅ Keep backward-compat UI field: quote.tariff = AFTER
      quote.tariff = quote.tariffAfter;

      quote.dailyUsageProfile = buildDailyUsageProfile(
        quote.assumedAnnualConsumptionKWh,
        input?.occupancyProfile || "balanced"
      );

      // Payback + lifetime series
      const payback = makePaybackAndLifetimeSeries({
        systemCostMid: midPrice,
        annualBenefit: totalAnnualBenefit,
        years: 25,
        panelOption: input.panelOption || input?.panelOption || "",
        energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
      });

      // Build a yearly table for "financial calculation details" popup
      {
        const inflationRate = Number(CONFIG.energyInflationRate || 0.06);
        const years = 25;

        const annualBaselineY1 = Number(monthlyFinance.annualBaseline || 0);
        const annualSystemY1 = Number(monthlyFinance.annualSystemBeforeSEG || 0);

        // Use PVGIS hourly annual gen if available; fallback to estimated annual gen
        const annualSolarGen = Math.round(
          (hourlyModel?.monthlyGenerationKWh || []).reduce((s, v) => s + Number(v || 0), 0) ||
          Number(quote?.estAnnualGenerationKWh || 0) ||
          0
        );

        const yearly = [];
        let cumulative = 0;

        for (let y = 1; y <= years; y++) {
          const m = Math.pow(1 + inflationRate, y - 1);

          // Degradation based on selected panel type
          const d = solarDegradationMultiplier(y, input.panelOption || input?.panelOption || "");

          // Bills inflate with energy costs
          const billBefore = annualBaselineY1 * m;

          // Savings shrink as solar output degrades (simple projection)
          const year1Savings = (annualBaselineY1 - annualSystemY1);
          const billSavings = year1Savings * m * d;

          const billAfter = billBefore - billSavings;

          cumulative += billSavings;

          yearly.push({
            year: y,
            solarGenerationKWh: Math.round(annualSolarGen * d),
            billBefore: round2(billBefore),
            billAfter: round2(billAfter),
            billSavings: round2(billSavings),
            cumulativeSavings: round2(cumulative),
            netPosition: round2(cumulative - Number(payback.systemCostMid || 0)),
          });
        }

        payback.yearly = yearly;

        // Optional debug (remove later)
        console.log("✅ yearly rows:", yearly.length, "first row:", yearly[0]);
      }

      quote.financialSeries = {
        monthly: monthlyFinance,
        payback,
      };

      // ------------------------------
      // 5) Battery recommendation (fastest payback only)
      //    Uses same PV/load hours already fetched; no extra PVGIS calls
      // ------------------------------
      if (hourlyYearData && Array.isArray(hourlyYearData) && hourlyYearData.length > 0) {
        const MAX_BAT = 35;
        const STEP = 1;
        const MIN_RECOMMENDED_BAT = 2;

        // ✅ Make sure this exists in-scope
        const batteryCostPerKWh = Number(CONFIG.batteryCostPerKwh || 0);

        function simulateForBatterySizeUsable(batteryUsableKWh) {
          // 1) Run each PVGIS year with this battery, then average annual outputs
          const annualBenefits = [];
          const annualSelfUsed = [];
          const annualExported = [];
          const annualImported = [];

          // ✅ Use averaged 8760 dataset (same as recalc)

          const yd = {
            pvHourlyKWh: pv8760,
            loadHourlyKWh: load8760,
            monthIdx: mIdx8760,
            hourOfDay: hod8760,
          };

          const sim = simulateHourByHour({
            pvHourlyKWh: yd.pvHourlyKWh,
            loadHourlyKWh: yd.loadHourlyKWh,
            monthIdx: yd.monthIdx,
            hourOfDay: yd.hourOfDay,
            batteryKWh: batteryUsableKWh,

            tariff: ta,
            dispatchMode: retail ? "retail_rate" : "self_consumption",
            allowGridCharge: retail && !!ta.allowGridCharging,
            allowEnergyTrading: retail && !!ta.allowEnergyTrading,
            exportFromBatteryEnabled: retail && !!ta.exportFromBatteryEnabled,
          });

          if (!sim || !sim.monthly) {
            throw new Error("Hourly simulation failed for battery optimisation");
          }

          const billing = computeHourlyBilling({
            loadKWh: yd.loadHourlyKWh,
            importKWh: sim.hourly.importKWh,
            exportKWh: sim.hourly.exportKWh,
            hourOfDay: yd.hourOfDay,
            monthIdx: yd.monthIdx,
            tariffBefore: tb,
            tariffAfter: ta,
          });

          const annualBillSavings = Math.max(
            0,
            billing.annualBaseline - billing.annualAfterImportAndStanding
          );

          const annualSegIncome = billing.annualExportCredit;

          annualBenefits.push(annualBillSavings + annualSegIncome);
          annualSelfUsed.push(sum12(sim.monthly.selfUsed));
          annualExported.push(sum12(sim.monthly.exported));
          annualImported.push(sum12(sim.monthly.imported));


          const avg = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

          const avgBenefit = avg(annualBenefits);
          const avgSelf = avg(annualSelfUsed);
          const avgExp = avg(annualExported);
          const avgImp = avg(annualImported);

          // 2) Price the system using the SAME pricing logic as the real quote
          const candidateInput = {
            ...input,
            batteryCapacity: batteryUsableKWh,
            batteryKWh: batteryUsableKWh, // backward compatibility
            roofs: input.roofs,
            extras: input.extras,
          };

          const candidateBaseQuote = calculateQuote(candidateInput, {
            annualGenerationOverrideKWh: pvgisAnnualKWh,
            silent: true,
          });

          const candidateMidPrice = (candidateBaseQuote.priceLow + candidateBaseQuote.priceHigh) / 2;

          // 3) Use the SAME payback + lifetime projection model as the main quote
          const paybackSeries = makePaybackAndLifetimeSeries({
            systemCostMid: candidateMidPrice,
            annualBenefit: avgBenefit,
            years: 25,
            panelOption: input?.panelOption || "",
            energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
          });

          const paybackYears = paybackSeries.paybackYear; // decimal (1dp) or null
          const lifetimeNetSavings = Math.round(Number(paybackSeries.lifetimeSavings || 0)); // net of system cost
          const lifetimeGrossBenefit = Math.round(lifetimeNetSavings + candidateMidPrice);

          return {
            annualBenefit: Math.round(avgBenefit),
            paybackYears,
            annualSelfUsedKWh: Math.round(avgSelf),
            annualExportedKWh: Math.round(avgExp),
            annualImportedKWh: Math.round(avgImp),
            candidateMidPrice: Math.round(candidateMidPrice),

            // Used for “max lifetime savings”
            lifetimeYears: 25,
            lifetimeGrossBenefit,
            lifetimeNetSavings,
          };
        }


        // Build curve (skip any battery sizes that error)
        const curve = [];
        for (let b = 0; b <= MAX_BAT; b += STEP) {
          try {
            const r = simulateForBatterySizeUsable(b);
            curve.push({ batteryKWhUsable: b, ...r });
          } catch (e) {
            console.warn(`Battery optimisation: failed for ${b} kWh:`, e);
          }
        }

        // Only consider sizes >= minimum for recommendation
        const candidates = curve.filter((x) => x.batteryKWhUsable >= MIN_RECOMMENDED_BAT);

        // Prefer any candidate with a real payback number
        const viablePayback = candidates.filter(
          (x) => typeof x.paybackYears === "number" && Number.isFinite(x.paybackYears) && x.annualBenefit > 0
        );

        let bestPayback = null;

        if (viablePayback.length > 0) {
          // Lowest payback wins; tie-breaker: higher annual benefit
          bestPayback = viablePayback.reduce((best, cur) => {
            if (cur.paybackYears < best.paybackYears) return cur;
            if (cur.paybackYears === best.paybackYears && cur.annualBenefit > best.annualBenefit) return cur;
            return best;
          }, viablePayback[0]);
        } else if (candidates.length > 0) {
          // If nothing has a numeric payback (rare), pick the highest annual benefit
          bestPayback = candidates.reduce((best, cur) => (cur.annualBenefit > best.annualBenefit ? cur : best), candidates[0]);
        }

        // Final safety fallback
        const finalBestPayback = bestPayback || candidates[0] || curve[0] || null;

        // ------------------------------
        // NEW) Battery recommendation (maximum lifetime net savings)
        // ------------------------------
        const viableLifetime = candidates.filter(
          (x) => typeof x.lifetimeNetSavings === "number" && Number.isFinite(x.lifetimeNetSavings)
        );

        // Prefer the maximum lifetime net savings; tie-breaker: lower payback; then higher annual benefit
        let bestLifetimeSavings = null;

        if (viableLifetime.length > 0) {
          bestLifetimeSavings = viableLifetime.reduce((best, cur) => {
            if (cur.lifetimeNetSavings > best.lifetimeNetSavings) return cur;
            if (cur.lifetimeNetSavings === best.lifetimeNetSavings) {
              const bestPay = typeof best.paybackYears === "number" ? best.paybackYears : Infinity;
              const curPay = typeof cur.paybackYears === "number" ? cur.paybackYears : Infinity;
              if (curPay < bestPay) return cur;
              if (curPay === bestPay && cur.annualBenefit > best.annualBenefit) return cur;
            }
            return best;
          }, viableLifetime[0]);
        }

        // Optional: don’t recommend if it doesn’t make money over lifetime
        if (bestLifetimeSavings && bestLifetimeSavings.lifetimeNetSavings <= 0) {
          bestLifetimeSavings = null;
        }

        quote.batteryRecommendations = {
          bestPayback: finalBestPayback,

          // ✅ NEW: best option for maximum lifetime savings
          bestLifetimeSavings,

          curve,
          assumptions: {
            batteryCostPerKWh,
            minRecommendedBatteryKWh: MIN_RECOMMENDED_BAT,
            maxBatteryKWh: MAX_BAT,
            stepKWh: STEP,
            lifetimeYears: 25,
            note: "Includes recommendations for fastest payback and maximum lifetime net savings.",
          },
        };
      }
    } else {
      quote.hourlyModel = null;
    }

    console.log("Battery rec exists?", !!quote.batteryRecommendations);
    console.log("Battery rec keys:", quote.batteryRecommendations ? Object.keys(quote.batteryRecommendations) : null);


    // ------------------------------
    // Logging
    // ------------------------------
    console.log(
      "Self-consumption model:",
      quote.selfConsumptionModel || (
        quote.estAnnualGenerationKWh <= 6000 && quote.assumedAnnualConsumptionKWh <= 6000
          ? "MCS table"
          : "Heuristic"
      )
    );

    console.log("Hourly model attached?:", !!quote.hourlyModel);
    if (quote.hourlyModel) {
      console.log("Self-consumption model: Hourly PVGIS simulation");
      console.log("Hourly model:", quote.hourlyModel.model);
      console.log("Hourly monthly generation:", quote.hourlyModel.monthlyGenerationKWh);
      console.log("Hourly monthly direct:", quote.hourlyModel.monthlyDirectToHomeKWh);
      console.log("Hourly monthly charge:", quote.hourlyModel.monthlyBatteryChargeKWh);
      console.log("Hourly monthly export:", quote.hourlyModel.monthlyExportedKWh);
      console.log("Hourly monthly import:", quote.hourlyModel.monthlyImportedKWh);
      console.log("Hourly monthly load:", quote.hourlyModel.monthlyLoadKWh);
      console.log("Financial series attached?:", !!quote.financialSeries);
      console.log("Battery recommendations attached?:", !!quote.batteryRecommendations);
      console.log("Best payback recommendation:", quote.batteryRecommendations?.bestPayback);
      console.log("hourlyModel keys:", Object.keys(quote.hourlyModel || {}));
      console.log("has _pvHourlyKWh?", Array.isArray(quote?.hourlyModel?._pvHourlyKWh), quote?.hourlyModel?._pvHourlyKWh?.length);
      console.log("has _loadHourlyKWh?", Array.isArray(quote?.hourlyModel?._loadHourlyKWh), quote?.hourlyModel?._loadHourlyKWh?.length);
      console.log("has _monthIdx?", Array.isArray(quote?.hourlyModel?._monthIdx), quote?.hourlyModel?._monthIdx?.length);
      console.log("has _hourOfDay?", Array.isArray(quote?.hourlyModel?._hourOfDay), quote?.hourlyModel?._hourOfDay?.length);

    }

    // ------------------------------
    // Optional local lead save
    // ------------------------------
    const { name, email, address, phone } = input;

    const leads = readLeads();

    leads.push({
      createdAt: new Date().toISOString(),
      contact: { name, email, address, phone },
      inputSummary: {
        postcode: input.postcode,
        annualKWh: input.annualKWh,
        monthlyBill: input.monthlyBill,
        roofSize: input.roofSize,
        shading: input.shading,
        occupancyProfile: input.occupancyProfile,
        panelOption: input.panelOption,
        batteryKWh: input.batteryKWh,
        panelCount: input.panelCount,
        roofs: input.roofs,
        extras: input.extras,
        tariffBefore: input.tariffBefore,
        tariffAfter: input.tariffAfter,
      },
      quoteSummary: {
        systemSizeKwp: quote.systemSizeKwp,
        panelCount: quote.panelCount,
        panelWatt: quote.panelWatt,
        estAnnualGenerationKWh: quote.estAnnualGenerationKWh,
        priceLow: quote.priceLow,
        priceHigh: quote.priceHigh,
        annualBillSavings: quote.annualBillSavings,
        annualSegIncome: quote.annualSegIncome,
        totalAnnualBenefit: quote.totalAnnualBenefit,
        simplePaybackYears: quote.simplePaybackYears,
        selfConsumptionModel: quote.selfConsumptionModel,
        recommendedBatteryKWh:
          quote.batteryRecommendations?.bestPayback?.batteryKWhUsable ?? null,
      },
    });

    // Keep only the latest 200 local quote records so this file cannot grow forever.
    saveLeads(leads.slice(-200));

    res.json(quote);

  } catch (err) {
    console.error("Error in /api/quote:", err);
    res.status(500).json({ error: "Something went wrong calculating and saving the quote." });
  }
});

app.post("/api/quote/recalc", async (req, res) => {
  try {
    const { quote, tariffBefore, tariffAfter, input, batteryRecommendationLifetimeYears } = req.body || {};
    if (!quote) return res.status(400).json({ error: "Missing quote." });

    const recommendationLifetimeYears =
      Number.isFinite(Number(batteryRecommendationLifetimeYears)) &&
      Number(batteryRecommendationLifetimeYears) > 0
        ? Number(batteryRecommendationLifetimeYears)
        : 25;

    const hm = quote?.hourlyModel;
    if (!hm) return res.status(400).json({ error: "Missing hourlyModel on quote." });

    const pv = hm._pvHourlyKWh;
    const load = hm._loadHourlyKWh;
    const monthIdx = hm._monthIdx;
    const hourOfDay = hm._hourOfDay;

    if (!Array.isArray(pv) || !Array.isArray(load) || !Array.isArray(monthIdx) || !Array.isArray(hourOfDay)) {
      return res.status(400).json({ error: "Quote missing hourly arrays for tariff recalculation." });
    }

    // -----------------------
    // 1) Normalize tariffs
    // -----------------------
    const tb = normalizeTariff(
      tariffBefore || quote?.tariffBefore || {},
      "before"
    );
    const ta = normalizeTariff(
      tariffAfter || quote?.tariffAfter || quote?.tariff || {},
      "after"
    );

    const retail = isRetailRateTariff(ta);

    // -----------------------
    // 2) Re-simulate hourly with toggles (NO PVGIS)
    // -----------------------
    const sim = simulateHourByHour({
      pvHourlyKWh: pv,
      loadHourlyKWh: load,
      monthIdx,
      hourOfDay,
      batteryKWh: Number(hm?._batteryKWh || 0),

      tariff: ta,
      dispatchMode: retail ? "retail_rate" : "self_consumption",

      // these MUST respect toggles
      allowGridCharge: retail && !!ta.allowGridCharging,
      allowEnergyTrading: retail && !!ta.allowEnergyTrading,

      exportFromBatteryEnabled: !!ta.exportFromBatteryEnabled,
    });

    if (!sim?.hourly?.importKWh || !sim?.hourly?.exportKWh) {
      return res.status(500).json({ error: "Recalc simulation did not return hourly flows." });
    }

    // -----------------------
    // 3) Hourly billing (baseline + after)
    // -----------------------
    const billing = computeHourlyBilling({
      loadKWh: load,
      importKWh: sim.hourly.importKWh,
      exportKWh: sim.hourly.exportKWh,
      hourOfDay,
      monthIdx,
      tariffBefore: tb,
      tariffAfter: ta,
    });

    const annualBillSavings = Math.max(
      0,
      round2(Number(billing.annualBaseline || 0) - Number(billing.annualAfterImportAndStanding || 0))
    );
    const annualSegIncome = round2(Number(billing.annualExportCredit || 0));
    const totalAnnualBenefit = round2(annualBillSavings + annualSegIncome);

    // -----------------------
    // 4) Payback + yearly table (this drives your charts)
    // -----------------------
    const midPrice = (Number(quote.priceLow || 0) + Number(quote.priceHigh || 0)) / 2;
    const simplePaybackYears =
      totalAnnualBenefit > 0 ? Number((midPrice / totalAnnualBenefit).toFixed(1)) : null;

    const payback = makePaybackAndLifetimeSeries({
      systemCostMid: midPrice,
      annualBenefit: totalAnnualBenefit,
      years: recommendationLifetimeYears,
      panelOption: quote?.panelOption || "",
      energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
    });

    // yearly table used by “cumulative savings” etc
    {
      const inflationRate = Number(CONFIG.energyInflationRate || 0.06);
      const years = 25;

      const annualBaselineY1 = Number(billing.annualBaseline || 0);
      const annualAfterY1 = Number(billing.annualAfterNet || 0); // after net = after import+standing - export credit
      const year1Savings = annualBaselineY1 - annualAfterY1;

      // use the simulated annual generation (or fallback)
      const annualSolarGen = Math.round(
        (sim?.monthly?.generation || []).reduce((s, v) => s + Number(v || 0), 0) ||
        (quote?.estAnnualGenerationKWh || 0) ||
        0
      );

      const yearly = [];
      let cumulative = 0;

      for (let y = 1; y <= years; y++) {
        const m = Math.pow(1 + inflationRate, y - 1);
        const d = solarDegradationMultiplier(y, quote?.panelOption || "");

        const billBefore = annualBaselineY1 * m;
        const billSavings = year1Savings * m * d;
        const billAfter = billBefore - billSavings;

        cumulative += billSavings;

        yearly.push({
          year: y,
          solarGenerationKWh: Math.round(annualSolarGen * d),
          billBefore: round2(billBefore),
          billAfter: round2(billAfter),
          billSavings: round2(billSavings),
          cumulativeSavings: round2(cumulative),
          netPosition: round2(cumulative - Number(payback.systemCostMid || 0)),
        });
      }

      payback.yearly = yearly;
    }

    // -----------------------
    // 5) Debug day slices so graphs refresh instantly
    //    IMPORTANT: choose the same kind of “representative” days as /api/quote
    // -----------------------
    function pickDayStartBest(targetMonth, scoreFn) {
      let bestStart = 0;
      let bestScore = -Infinity;

      for (let start = 0; start <= monthIdx.length - 24; start += 24) {
        if (monthIdx[start] !== targetMonth) continue;

        let score = 0;
        for (let j = 0; j < 24; j++) score += scoreFn(start + j);

        if (score > bestScore) {
          bestScore = score;
          bestStart = start;
        }
      }

      return bestStart;
    }

    // Match /api/quote behaviour:
    // - Winter: Jan (0) day showing the MOST grid charging (if present)
    // - Summer: Jun (5) day showing the MOST PV generation
    const winterStart = pickDayStartBest(0, (idx) => Number(sim.hourly.battChargeFromGridKWh?.[idx] || 0));
    const summerStart = pickDayStartBest(5, (idx) => Number(sim.hourly.pvKWh?.[idx] || 0));

    const debugWinterDay = extractDaySlice(sim.hourly, winterStart);
    const debugSummerDay = extractDaySlice(sim.hourly, summerStart);


    // -----------------------
    // 6) Battery recommendations (fast enough, no PVGIS)
    //    Uses the same single 8760 arrays on the quote.
    // -----------------------
    const MAX_BAT = 35;
    const STEP = 1;
    const MIN_RECOMMENDED_BAT = 2;

    const curve = [];
    for (let b = 0; b <= MAX_BAT; b += STEP) {
      const simB = simulateHourByHour({
        pvHourlyKWh: pv,
        loadHourlyKWh: load,
        monthIdx,
        hourOfDay,
        batteryKWh: b,
        tariff: ta,
        dispatchMode: retail ? "retail_rate" : "self_consumption",
        allowGridCharge: retail && !!ta.allowGridCharging,
        allowEnergyTrading: retail && !!ta.allowEnergyTrading,
        exportFromBatteryEnabled: !!ta.exportFromBatteryEnabled,
      });

      const billingB = computeHourlyBilling({
        loadKWh: load,
        importKWh: simB.hourly.importKWh,
        exportKWh: simB.hourly.exportKWh,
        hourOfDay,
        monthIdx,
        tariffBefore: tb,
        tariffAfter: ta,
      });

      const benefitB =
        Math.max(0, (billingB.annualBaseline || 0) - (billingB.annualAfterImportAndStanding || 0)) +
        (billingB.annualExportCredit || 0);

      const candidateInput = {
        ...input,
        batteryCapacity: b,
        batteryKWh: b,
        roofs: input?.roofs || [],
        extras: input?.extras || {},
        panelOption: input?.panelOption || quote?.panelOption || "value",
        annualKWh: input?.annualKWh || quote?.assumedAnnualConsumptionKWh || 0,
        occupancyProfile: input?.occupancyProfile || "half_day",
      };

      const annualGenerationForCandidate = Math.round(
        (simB?.monthly?.generation || []).reduce((s, v) => s + Number(v || 0), 0)
      );

      const candidateBaseQuote = calculateQuote(candidateInput, {
        annualGenerationOverrideKWh: annualGenerationForCandidate,
        silent: true,
      });

      const candidateMidPrice = (candidateBaseQuote.priceLow + candidateBaseQuote.priceHigh) / 2;

      const pb = makePaybackAndLifetimeSeries({
        systemCostMid: candidateMidPrice,
        annualBenefit: benefitB,
        years: recommendationLifetimeYears,
        panelOption: input?.panelOption || quote?.panelOption || "",
        energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
      });

      const annualSelf = Math.round((simB?.monthly?.selfUsed || []).reduce((s, v) => s + Number(v || 0), 0));
      const annualExp = Math.round((simB?.monthly?.exported || []).reduce((s, v) => s + Number(v || 0), 0));
      const annualImp = Math.round((simB?.monthly?.imported || []).reduce((s, v) => s + Number(v || 0), 0));
      const lifetimeNetSavings = Math.round(Number(pb.lifetimeSavings || 0));
      const lifetimeGrossBenefit = Math.round(lifetimeNetSavings + candidateMidPrice);

      curve.push({
        batteryKWhUsable: b,
        annualBenefit: Math.round(benefitB),
        paybackYears: pb.paybackYear,
        annualSelfUsedKWh: Math.round((simB?.monthly?.selfUsed || []).reduce((s, v) => s + Number(v || 0), 0)),
        annualExportedKWh: Math.round((simB?.monthly?.exported || []).reduce((s, v) => s + Number(v || 0), 0)),
        annualImportedKWh: Math.round((simB?.monthly?.imported || []).reduce((s, v) => s + Number(v || 0), 0)),
        candidateMidPrice: Math.round(candidateMidPrice),
        lifetimeYears: recommendationLifetimeYears,
        lifetimeGrossBenefit: Math.round(Number(pb.lifetimeSavings || 0) + candidateMidPrice),
        lifetimeNetSavings: Math.round(Number(pb.lifetimeSavings || 0)),
      });
    }

    const candidates = curve.filter((x) => x.batteryKWhUsable >= MIN_RECOMMENDED_BAT);

    const viablePayback = candidates.filter(
      (x) => typeof x.paybackYears === "number" && Number.isFinite(x.paybackYears) && x.annualBenefit > 0
    );

    let bestPayback = null;
    if (viablePayback.length > 0) {
      bestPayback = viablePayback.reduce((best, cur) => {
        if (cur.paybackYears < best.paybackYears) return cur;
        if (cur.paybackYears === best.paybackYears && cur.annualBenefit > best.annualBenefit) return cur;
        return best;
      }, viablePayback[0]);
    } else if (candidates.length > 0) {
      bestPayback = candidates.reduce((best, cur) => (cur.annualBenefit > best.annualBenefit ? cur : best), candidates[0]);
    }

    const finalBestPayback = bestPayback || candidates[0] || curve[0] || null;

    const viableLifetime = candidates.filter(
      (x) => typeof x.lifetimeNetSavings === "number" && Number.isFinite(x.lifetimeNetSavings)
    );

    let bestLifetimeSavings = null;
    if (viableLifetime.length > 0) {
      bestLifetimeSavings = viableLifetime.reduce((best, cur) => {
        if (cur.lifetimeNetSavings > best.lifetimeNetSavings) return cur;
        if (cur.lifetimeNetSavings === best.lifetimeNetSavings) {
          const bestPay = typeof best.paybackYears === "number" ? best.paybackYears : Infinity;
          const curPay = typeof cur.paybackYears === "number" ? cur.paybackYears : Infinity;
          if (curPay < bestPay) return cur;
          if (curPay === bestPay && cur.annualBenefit > best.annualBenefit) return cur;
        }
        return best;
      }, viableLifetime[0]);
    }

    if (bestLifetimeSavings && bestLifetimeSavings.lifetimeNetSavings <= 0) {
      bestLifetimeSavings = null;
    }

    // -----------------------
    // 7) Return updated quote
    // -----------------------
    const updated = {
      ...quote,

      tariffBefore: tb,
      tariffAfter: ta,
      tariff: ta, // backwards compat

      annualBillSavings,
      annualSegIncome,
      totalAnnualBenefit,
      simplePaybackYears,

      financialSeries: {
        monthly: {
          // keep anything else you already use from billing (optional)
          ...billing,

          // ✅ explicitly provide the fields the UI expects
          annualBaseline: round2(Number(billing.annualBaseline || 0)),
          annualSystemBeforeSEG: round2(Number(billing.annualAfterImportAndStanding || 0)),
          annualExportCredit: round2(Number(billing.annualExportCredit || 0)),

          // net = import+standing - export credit
          annualSystemNet: round2(
            Number(billing.annualAfterImportAndStanding || 0) - Number(billing.annualExportCredit || 0)
          ),

          // ✅ UI alias (some parts of your UI use annualSystem)
          annualSystem: round2(
            Number(billing.annualAfterImportAndStanding || 0) - Number(billing.annualExportCredit || 0)
          ),
        },
        payback,
      },

      batteryRecommendations: {
        bestPayback: finalBestPayback,
        bestLifetimeSavings,
        curve,
        assumptions: {
          minRecommendedBatteryKWh: MIN_RECOMMENDED_BAT,
          maxBatteryKWh: MAX_BAT,
          stepKWh: STEP,
          lifetimeYears: recommendationLifetimeYears,
          note: "Recalculated using quote hourly arrays + current tariff toggles (no PVGIS).",
        },
      },

      hourlyModel: {
        ...hm,

        monthlyGenerationKWh: sim.monthly.generation,
        monthlySelfUsedKWh: sim.monthly.selfUsed,
        monthlyExportedKWh: sim.monthly.exported,
        monthlyImportedKWh: sim.monthly.imported,

        monthlyBatteryChargeKWh: sim.monthly.batteryCharge,
        monthlyBatteryDischargeKWh: sim.monthly.batteryDischarge,

        // NEW: source-aware monthly battery flow fields
        monthlyBatteryChargeFromPVKWh: sim.monthly.batteryChargeFromPV,
        monthlyBatteryChargeFromGridKWh: sim.monthly.batteryChargeFromGrid,
        monthlyBatteryDischargeFromPVToLoadKWh: sim.monthly.batteryDischargeFromPVToLoad,
        monthlyBatteryDischargeFromGridToLoadKWh: sim.monthly.batteryDischargeFromGridToLoad,

        // NEW: direct PV export at generation time
        monthlyPVExportedDirectKWh: sim.monthly.pvExportDirect,

        // KEEP / PRESERVE the household demand profile
        monthlyLoadKWh: hm.monthlyLoadKWh,

        debugWinterDay,
        debugSummerDay,
      },
    };

    return res.json(updated);
  } catch (e) {
    console.error("recalc error:", e);
    return res.status(500).json({ error: e?.message || "Failed to recalculate." });
  }
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