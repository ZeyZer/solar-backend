// backend/server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");
const MCS_TABLES = require("./data/mcs_self_consumption_tables.json")?.tables;

const app = express();
const PORT = process.env.PORT || 4000;

console.log("[MCS] Loaded tables keys:", MCS_TABLES ? Object.keys(MCS_TABLES) : "❌ NOT LOADED");

// ====== LEADS STORAGE SETUP ======
const LEADS_FILE = path.join(__dirname, "leads.json");

// node fetch fallback
let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
}

function readLeads() {
  try {
    if (!fs.existsSync(LEADS_FILE)) {
      console.log("leads.json does not exist yet, starting with empty array.");
      return [];
    }
    const data = fs.readFileSync(LEADS_FILE, "utf8");
    if (!data.trim()) {
      console.log("leads.json is empty, starting with empty array.");
      return [];
    }
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading leads file:", err.message);
    return [];
  }
}

function saveLeads(leads) {
  try {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    console.log(`Saved leads to ${LEADS_FILE}. Total leads: ${leads.length}`);
  } catch (err) {
    console.error("Error writing leads file:", err.message);
  }
}

// ====== BREVO SETUP ======
const brevoClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = brevoClient.authentications["api-key"];
apiKey.apiKey = process.env.BREVO_API_KEY || "";

const brevoContactsApi = new SibApiV3Sdk.ContactsApi();
const brevoEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

const BREVO_TEMPLATE_ID = process.env.BREVO_TEMPLATE_ID
  ? Number(process.env.BREVO_TEMPLATE_ID)
  : undefined;

const BREVO_LIST_ID = process.env.BREVO_LIST_ID
  ? Number(process.env.BREVO_LIST_ID)
  : undefined;

async function syncLeadToBrevo(contact, quote, input) {
  try {
    if (!process.env.BREVO_API_KEY) {
      console.log("No BREVO_API_KEY set, skipping Brevo sync.");
      return;
    }
    if (!contact.email) {
      console.log("No email on contact, skipping Brevo sync.");
      return;
    }

    const createContact = new SibApiV3Sdk.CreateContact();
    createContact.email = contact.email;
    createContact.attributes = {
      FIRSTNAME: contact.name || "",
      ADDRESS: contact.address || "",
      PHONE: contact.phone || "",
    };

    if (BREVO_LIST_ID) createContact.listIds = [BREVO_LIST_ID];

    try {
      await brevoContactsApi.createContact(createContact);
      console.log("Brevo contact created:", contact.email);
    } catch (err) {
      if (err.response && err.response.body && err.response.body.code === "duplicate_parameter") {
        const updateContact = new SibApiV3Sdk.UpdateContact();
        updateContact.attributes = createContact.attributes;
        await brevoContactsApi.updateContact(contact.email, updateContact);
        console.log("Brevo contact updated:", contact.email);
      } else {
        console.error("Error creating/updating Brevo contact:", err.message);
      }
    }

    if (!BREVO_TEMPLATE_ID) {
      console.log("No BREVO_TEMPLATE_ID set, skipping Brevo email send.");
      return;
    }

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.to = [{ email: contact.email, name: contact.name || "" }];
    sendSmtpEmail.templateId = BREVO_TEMPLATE_ID;
    sendSmtpEmail.params = {
      name: contact.name || "",
      address: contact.address || "",
      system_kwp: quote.systemSizeKwp,
      panel_count: quote.panelCount,
      panel_watt: quote.panelWatt,
      annual_kwh: quote.estAnnualGenerationKWh,
      price_low: quote.priceLow,
      price_high: quote.priceHigh,

      battery_kwh: input?.batteryKWh || 0,
      bird_protection: input?.extras?.birdProtection ? "Yes" : "No",
      ev_charger: input?.extras?.evCharger ? "Yes" : "No",

      annual_savings: quote.annualBillSavings || 0,
      seg_income: quote.annualSegIncome || 0,
      total_benefit: quote.totalAnnualBenefit || 0,
      payback_years: quote.simplePaybackYears || "",
    };

    await brevoEmailApi.sendTransacEmail(sendSmtpEmail);
    console.log("Brevo quote email sent to:", contact.email);
  } catch (err) {
    console.error("Error syncing lead to Brevo:", err.message);
  }
}

// ====== EXPRESS SETUP ======
app.use(express.json());
app.use(cors());

// ====== QUOTE CONFIG ======
const CONFIG = {
  baseCostPerKwp: 800,
  batteryCostPerKwh: 340,
  scaffolding: {
    firstRoof: 600,
    additionalRoof: 400,
  },
  priceRangeFactor: 0.10,
  assumedPricePerKWh: 0.28,
  assumedSegPricePerKWh: 0.12,

  standingChargePerDay: 0.60,
  energyInflationRate: 0.06,

  irradianceFactor: 0.85,
  roofKwpCaps: {
    small: 2.5,
    medium: 4.0,
    large: 6.5,
  },
  panelOptions: {
    value: { watt: 430, multiplier: 1.0 },
    premium: { watt: 460, multiplier: 1.1 },
  },
  regionalMultipliers: {
    default: 1.0,
    london: 1.1,
    scotland: 0.95,
  },
};

// ====== POSTCODE HELPERS ======
function validateAndNormalisePostcode(rawPostcode) {
  if (!rawPostcode || typeof rawPostcode !== "string") {
    throw new Error("Postcode is required.");
  }

  const cleaned = rawPostcode.toUpperCase().replace(/\s+/g, "");
  if (cleaned.length < 5) throw new Error("Postcode looks too short.");

  const formatted = `${cleaned.slice(0, -3)} ${cleaned.slice(-3)}`;
  const re = /^[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}$/;

  if (!re.test(formatted)) throw new Error("Postcode format is not recognised.");
  return formatted;
}

function getPostcodeArea(postcode) {
  if (!postcode) return null;
  const outward = postcode.trim().toUpperCase().split(" ")[0];
  const match = outward.match(/^[A-Z]{1,2}/);
  return match ? match[0] : null;
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
  minBatteryKWh = 5,          // ✅ new: force minimum
  maxBatteryKWh = 28,         // ✅ new: cap at 28
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
  monthlyLoadKWh,       // array[12] household demand
  monthlyImportedKWh,   // array[12] grid import (after solar/battery)
  monthlyExportedKWh,   // array[12] grid export
  importPrice,          // £/kWh
  segPrice,             // £/kWh
  standingChargePerDay = 0, // £/day
}) {
  const daysInMonth = [31,28,31,30,31,30,31,31,30,31,30,31];
  const monthlyStandingCharge = daysInMonth.map((d) => round2(d * Number(standingChargePerDay || 0)));

  // Baseline = (load * import) + standing charge
  const baselineMonthlyCost = monthlyLoadKWh.map((kwh, i) =>
    round2((kwh * importPrice) + monthlyStandingCharge[i])
  );

  // "After solar" bill = imports cost - export credit (SEG) + standing charge
  const systemMonthlyCost = monthlyImportedKWh.map((imp, i) =>
    round2((imp * importPrice) - (monthlyExportedKWh[i] * segPrice) + monthlyStandingCharge[i])
  );

  const monthlySavings = baselineMonthlyCost.map((base, i) =>
    round2(base - systemMonthlyCost[i])
  );

  const annualBaseline = round2(baselineMonthlyCost.reduce((a,b)=>a+b,0));
  const annualSystem = round2(systemMonthlyCost.reduce((a,b)=>a+b,0));
  const annualSavings = round2(monthlySavings.reduce((a,b)=>a+b,0));

  return {
    labels: MONTH_LABELS,
    baselineMonthlyCost,
    systemMonthlyCost,
    monthlySavings,
    monthlyStandingCharge,
    annualBaseline,
    annualSystem,
    annualSavings,
    assumptions: {
      importPrice,
      segPrice,
      standingChargePerDay: Number(standingChargePerDay || 0),
    }
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

  const sim = simulateHourByHour({
    pvHourlyKWh: pvHourly,
    loadHourlyKWh: loadHourly,
    monthIdx,
    batteryKWh: input.batteryKWh || 0,
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
  // 24 values that sum to ~1. These are simple “shape” profiles.
  // You can tweak later. For now: morning + evening peaks, daytime varies.
  const homeAllDay = [
    // 0–5
    0.030, 0.025, 0.022, 0.022, 0.023, 0.028,
    // 6–11
    0.040, 0.052, 0.058, 0.055, 0.050, 0.047,
    // 12–17
    0.046, 0.046, 0.048, 0.055, 0.060, 0.075,
    // 18–23
    0.080, 0.085, 0.080, 0.070, 0.055, 0.040
  ];

  const outAllDay = [
    // 0–5
    0.028, 0.024, 0.021, 0.021, 0.022, 0.026,
    // 6–11
    0.035, 0.045, 0.050, 0.047, 0.045, 0.044,
    // 12–17
    0.044, 0.044, 0.045, 0.050, 0.060, 0.075,
    // 18–23
    0.090, 0.095, 0.090, 0.080, 0.065, 0.050
  ];

  const halfDay = [
    // 0–5
    0.030, 0.026, 0.024, 0.024, 0.026, 0.030,
    // 6–11
    0.038, 0.048, 0.058, 0.062, 0.065, 0.067,
    // 12–17
    0.068, 0.068, 0.070, 0.075, 0.082, 0.088,
    // 18–23
    0.090, 0.088, 0.082, 0.075, 0.065, 0.055
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

  // ✅ Work on a copy, then normalize/smooth/normalize
  let fractions = normalizeToOne(arr);

  // Smooth overall profile (reduces sharp spikes)
  fractions = smoothArrayWeighted(fractions, 2);

  // Ensure it sums to 1 again
  fractions = normalizeToOne(fractions);

  return fractions;
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


function simulateHourByHour({ pvHourlyKWh, loadHourlyKWh, monthIdx, batteryKWh = 0 }) {
  const n = Math.min(pvHourlyKWh.length, loadHourlyKWh.length);
  if (n === 0) return null;

  if (!Array.isArray(monthIdx) || monthIdx.length < n) {
    throw new Error("simulateHourByHour requires monthIdx array aligned to pv/load.");
  }

  // ✅ Battery input is treated as *usable* kWh (no hidden usable fraction)
  const capUsable = Math.max(0, Number(batteryKWh || 0)); // usable kWh
  const socMin = 0;
  const socMax = capUsable;

  // round-trip efficiency (kept, realistic + explainable)
  const roundTripEff = 0.90;
  const chargeEff = Math.sqrt(roundTripEff);
  const dischargeEff = Math.sqrt(roundTripEff);

  // Start year at 50% SOC (neutral start)
  let soc = capUsable > 0 ? capUsable * 0.5 : 0;

  const monthly = {
    generation: Array(12).fill(0),
    selfUsed: Array(12).fill(0),
    exported: Array(12).fill(0),
    imported: Array(12).fill(0),
    batteryCharge: Array(12).fill(0),    // PV diverted to battery (kWh from PV)
    batteryDischarge: Array(12).fill(0), // battery delivered to load (kWh to home)
  };

  for (let t = 0; t < n; t++) {
    const pv = Math.max(0, Number(pvHourlyKWh[t] || 0));
    const load = Math.max(0, Number(loadHourlyKWh[t] || 0));
    const m = monthIdx[t] ?? 0;

    // 1) Direct PV to load
    const direct = Math.min(pv, load);
    let pvLeft = pv - direct;
    let loadLeft = load - direct;

    // 2) Charge battery from remaining PV
    let chargedFromPV = 0;
    if (capUsable > 0 && pvLeft > 0 && soc < socMax) {
      const room = socMax - soc;                 // space inside battery (kWh stored)
      const pvToBattery = Math.min(pvLeft, room / chargeEff); // PV kWh that can be sent to battery
      const stored = pvToBattery * chargeEff;    // stored kWh after efficiency

      soc += stored;
      pvLeft -= pvToBattery;
      chargedFromPV = pvToBattery;
    }

    // 3) Discharge battery to meet remaining load
    let dischargedToLoad = 0;
    if (capUsable > 0 && loadLeft > 0 && soc > socMin) {
      const availableStored = soc - socMin;         // kWh stored available
      const canDeliver = availableStored * dischargeEff; // kWh that can be delivered to load
      const deliver = Math.min(loadLeft, canDeliver);

      soc -= deliver / dischargeEff;
      loadLeft -= deliver;
      dischargedToLoad = deliver;
    }

    // 4) Export / import after battery actions
    const exported = Math.max(0, pvLeft);
    const imported = Math.max(0, loadLeft);

    // Define self-used as energy that actually served load
    const selfUsed = direct + dischargedToLoad;

    monthly.generation[m] += pv;
    monthly.selfUsed[m] += selfUsed;
    monthly.exported[m] += exported;
    monthly.imported[m] += imported;
    monthly.batteryCharge[m] += chargedFromPV;
    monthly.batteryDischarge[m] += dischargedToLoad;
  }

  // Round to 2dp for nice charts & stable totals
  for (const k of Object.keys(monthly)) {
    monthly[k] = monthly[k].map((v) => Math.round(v * 100) / 100);
  }

  const annual = {
    generation: monthly.generation.reduce((s, v) => s + v, 0),
    selfUsed: monthly.selfUsed.reduce((s, v) => s + v, 0),
    exported: monthly.exported.reduce((s, v) => s + v, 0),
    imported: monthly.imported.reduce((s, v) => s + v, 0),
  };

  return { monthly, annual };
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
  const labourAndMargin = directCosts * 0.3;
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

// ------------------------------
// Lead capture + Brevo email
// ------------------------------
app.post("/api/lead/email-quote", async (req, res) => {
  try {
    const { contact, quote, input } = req.body || {};
    console.log("✅ /api/lead/email-quote hit", req.body?.contact?.email);

    if (!contact || !quote || !input) {
      return res.status(400).json({ ok: false, error: "Missing contact, quote, or input." });
    }

    if (!contact.email || typeof contact.email !== "string") {
      return res.status(400).json({ ok: false, error: "Email is required." });
    }

    // Optional: basic name validation
    if (!contact.name || typeof contact.name !== "string") {
      return res.status(400).json({ ok: false, error: "Name is required." });
    }

    // This will create/update contact + send the transactional email (if configured)
    await syncLeadToBrevo(contact, quote, input);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Error in /api/lead/email-quote:", err);
    return res.status(500).json({ ok: false, error: "Server error sending quote email." });
  }
});

app.post("/api/lead/request-call", async (req, res) => {
  try {
    const { contact, quote, input } = req.body || {};
    console.log("✅ /api/lead/request-call hit", req.body?.contact?.email);

    if (!contact || !quote || !input) {
      return res.status(400).json({ ok: false, error: "Missing contact, quote, or input." });
    }

    if (!contact.email || typeof contact.email !== "string") {
      return res.status(400).json({ ok: false, error: "Email is required." });
    }

    if (!contact.name || typeof contact.name !== "string") {
      return res.status(400).json({ ok: false, error: "Name is required." });
    }

    if (!contact.phone || typeof contact.phone !== "string") {
      return res.status(400).json({ ok: false, error: "Phone is required." });
    }

    // Same email action for now (as you requested)
    await syncLeadToBrevo(contact, quote, input);

    // Optional: log callback request (simple)
    console.log("Callback requested:", {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      address: contact.address || "",
      ts: new Date().toISOString(),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Error in /api/lead/request-call:", err);
    return res.status(500).json({ ok: false, error: "Server error requesting call." });
  }
});


app.post("/api/quote", async (req, res) => {
  try {
    const input = req.body || {};
    console.log("Received quote request with input:", input);

    const { form } = req.body;

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

    // Prices
    const importPrice = CONFIG.assumedPricePerKWh;     // £/kWh
    const segPrice = CONFIG.assumedSegPricePerKWh;     // £/kWh
    const batteryCostPerKWh = CONFIG.batteryCostPerKWh || 0; // you may add this to CONFIG

    // PVGIS outputs
    let pvgisAnnualKWh = null;
    let hourlyModel = null;

    // ------------------------------
    // 1) Try PVGIS HOURLY simulation (3-year average)
    // ------------------------------
    try {
      if (input.postcode && Array.isArray(input.roofs) && input.roofs.length > 0) {
        const years = [2021, 2022, 2023];

        const results = [];
        for (const y of years) {
          console.log(`Running PVGIS hourly simulation for year ${y}...`);
          // IMPORTANT: runHourlyModelForYear should return monthly + hourly arrays (see step 2 below)
          const r = await runHourlyModelForYear({ input, panelWatt, year: y, includeHourlyArrays: true });
          results.push(r);
        }

        // Average monthly series across years
        const avgMonthlyGeneration = averageMonthlyArrays(results.map(r => r.monthlyGenerationKWh));
        const avgMonthlySelfUsed = averageMonthlyArrays(results.map(r => r.monthlySelfUsedKWh));
        const avgMonthlyExported = averageMonthlyArrays(results.map(r => r.monthlyExportedKWh));
        const avgMonthlyImported = averageMonthlyArrays(results.map(r => r.monthlyImportedKWh));
        const avgMonthlyBattCharge = averageMonthlyArrays(results.map(r => r.monthlyBatteryChargeKWh));
        const avgMonthlyBattDischarge = averageMonthlyArrays(results.map(r => r.monthlyBatteryDischargeKWh));
        const avgMonthlyDirect = averageMonthlyArrays(results.map(r => r.monthlyDirectToHomeKWh));

        const avgAnnualGeneration = Math.round(sum12(avgMonthlyGeneration));
        pvgisAnnualKWh = avgAnnualGeneration;

        hourlyModel = {
          model: "hourly_pvgis_3yr_avg_2021_2023",
          years,
          monthlyGenerationKWh: avgMonthlyGeneration,
          monthlySelfUsedKWh: avgMonthlySelfUsed,
          monthlyExportedKWh: avgMonthlyExported,
          monthlyImportedKWh: avgMonthlyImported,
          monthlyBatteryChargeKWh: avgMonthlyBattCharge,
          monthlyBatteryDischargeKWh: avgMonthlyBattDischarge,
          monthlyDirectToHomeKWh: avgMonthlyDirect,
          annualGenerationKWh: avgAnnualGeneration,
          annualSelfUsedKWh: Math.round(sum12(avgMonthlySelfUsed)),
          annualExportedKWh: Math.round(sum12(avgMonthlyExported)),
          annualImportedKWh: Math.round(sum12(avgMonthlyImported)),
        };

        // Keep these in memory for optimisation (do NOT send to client)
        // We'll store per-year hourly arrays in a local variable for use below.
        var hourlyYearData = results.map(r => ({
          year: r.year,
          pvHourlyKWh: r._pvHourlyKWh,
          loadHourlyKWh: r._loadHourlyKWh,
          monthIdx: r._monthIdx,
        }));

        console.log("3-year average annual PV kWh:", pvgisAnnualKWh);
      }
    } catch (e) {
      console.warn("PVGIS hourly 3-year simulation failed, falling back to PVcalc annual:", e.message);
      pvgisAnnualKWh = null;
      hourlyModel = null;
      var hourlyYearData = null;
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
    const quote = { ...baseQuote, ...savings };

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
      quote.hourlyModel = hourlyModel;

      // Monthly household demand: load = selfUsed + imported
      const monthlyLoadKWh = hourlyModel.monthlySelfUsedKWh.map((v, i) =>
        round2(Number(v || 0) + Number(hourlyModel.monthlyImportedKWh[i] || 0))
      );
      quote.hourlyModel.monthlyLoadKWh = monthlyLoadKWh;

      // Annual benefit from hourly results (simple, consistent)
      const annualSelfUsedKWh = sum12(hourlyModel.monthlySelfUsedKWh);
      const annualExportedKWh = sum12(hourlyModel.monthlyExportedKWh);

      const annualBillSavings = Math.round(annualSelfUsedKWh * importPrice);
      const annualSegIncome = Math.round(annualExportedKWh * segPrice);
      const totalAnnualBenefit = annualBillSavings + annualSegIncome;

      quote.annualBillSavings = annualBillSavings;
      quote.annualSegIncome = annualSegIncome;
      quote.totalAnnualBenefit = totalAnnualBenefit;

      quote.simplePaybackYears = totalAnnualBenefit > 0 ? Number((midPrice / totalAnnualBenefit).toFixed(1)) : null;
      quote.selfConsumptionModel = "hourly";

      // Monthly bill series
      const monthlyFinance = makeMonthlyFinancialSeries({
        monthlyLoadKWh,
        monthlyImportedKWh: hourlyModel.monthlyImportedKWh,
        monthlyExportedKWh: hourlyModel.monthlyExportedKWh,
        importPrice,
        segPrice,
        standingChargePerDay: Number(CONFIG.standingChargePerDay || 0),
      });

      // ------------------------------
      // Tariff assumptions (for MCS display)
      // ------------------------------
      quote.tariff = {
        importPrice,
        segPrice,
        standingChargePerDay: Number(CONFIG.standingChargePerDay || 0),
        energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
        tariffType: "Standard Residential Electricity Tariff",
      };

      quote.dailyUsageProfile = buildDailyUsageProfile(
        quote.assumedAnnualConsumptionKWh,
        input?.occupancyProfile || "balanced"
      );

      // Payback + lifetime series
      const payback = makePaybackAndLifetimeSeries({
        systemCostMid: midPrice,
        annualBenefit: totalAnnualBenefit,
        years: 25,
        panelOption: form?.panelOption || input?.panelOption || "",
        energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
      });

      // Build a yearly table for "financial calculation details" popup
      {
        const inflationRate = Number(CONFIG.energyInflationRate || 0.06);
        const years = 25;

        const annualBaselineY1 = Number(monthlyFinance.annualBaseline || 0);
        const annualSystemY1 = Number(monthlyFinance.annualSystem || 0);

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
          const d = solarDegradationMultiplier(y, form?.panelOption || input?.panelOption || "");

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
        const MAX_BAT = 28;
        const STEP = 1;
        const MIN_RECOMMENDED_BAT = 5;

        // ✅ Make sure this exists in-scope
        const batteryCostPerKWh = Number(CONFIG.batteryCostPerKwh || 0);

        function simulateForBatterySizeUsable(batteryUsableKWh) {
          // 1) Run each PVGIS year with this battery, then average annual outputs
          const annualBenefits = [];
          const annualSelfUsed = [];
          const annualExported = [];
          const annualImported = [];

          for (const yd of hourlyYearData) {
            const sim = simulateHourByHour({
              pvHourlyKWh: yd.pvHourlyKWh,
              loadHourlyKWh: yd.loadHourlyKWh,
              monthIdx: yd.monthIdx,
              batteryKWh: batteryUsableKWh, // usable kWh
            });

            const selfUsedKWh = sum12(sim.monthly.selfUsed);
            const exportedKWh = sum12(sim.monthly.exported);
            const importedKWh = sum12(sim.monthly.imported);

            // Year-1 annual benefit estimate for this battery size
            const billSavings = selfUsedKWh * importPrice;
            const segIncome = exportedKWh * segPrice;

            annualBenefits.push(billSavings + segIncome);
            annualSelfUsed.push(selfUsedKWh);
            annualExported.push(exportedKWh);
            annualImported.push(importedKWh);
          }

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
      console.log("Best payback recommendation:", quote.batteryRecommendations?.finalBestPayback);

    }

    // ------------------------------
    // Lead saving + Brevo
    // ------------------------------
    const { name, email, address, phone } = input;

    const leads = readLeads();
    leads.push({
      createdAt: new Date().toISOString(),
      contact: { name, email, address, phone },
      inputs: input,
      quote,
    });
    saveLeads(leads);

    const contact = { name, email, address, phone };
    syncLeadToBrevo(contact, quote, input);

    res.json(quote);

  } catch (err) {
    console.error("Error in /api/quote:", err);
    res.status(500).json({ error: "Something went wrong calculating and saving the quote." });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Leads will be stored in: ${LEADS_FILE}`);
});
