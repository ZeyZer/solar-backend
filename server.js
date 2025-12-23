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
  batteryCostPerKwh: 440,
  scaffolding: {
    firstRoof: 600,
    additionalRoof: 400,
  },
  priceRangeFactor: 0.10,
  assumedPricePerKWh: 0.28,
  assumedSegPricePerKWh: 0.12,
  irradianceFactor: 0.85,
  roofKwpCaps: {
    small: 2.5,
    medium: 4.0,
    large: 6.5,
  },
  panelOptions: {
    value: { watt: 430, multiplier: 1.0 },
    premium: { watt: 460, multiplier: 1.12 },
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
  endpoint: "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc",
  lossPercent: 14,
  useHorizon: 1,
  shadingDerate: {
    none: 1.0,
    some: 0.9,
    a_lot: 0.8,
  },
};

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
    console.log("Using manual panel count:", panelCount);
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

  const panelsCost = baseSystemCost * 0.5;
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

app.post("/api/quote", async (req, res) => {
  try {
    const input = req.body || {};
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

    // Try PVGIS annual generation (non-fatal)
    let pvgisAnnualKWh = null;
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

    console.log("Incoming roofs:", input.roofs);

    const baseQuote = calculateQuote(input, {
      annualGenerationOverrideKWh: pvgisAnnualKWh,
    });

    const savings = estimateSelfConsumptionAndSavings(input, baseQuote);

    const quote = { ...baseQuote, ...savings };

    console.log(
      "Self-consumption model:",
      quote.estAnnualGenerationKWh <= 6000 &&
      quote.assumedAnnualConsumptionKWh <= 6000
        ? "MCS table"
        : "Heuristic"
    );

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
