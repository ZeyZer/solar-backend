// node fetch fallback
let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
}

const {
  normalizeTariff, 
  isRetailRateTariff,
} = require("../services/tariffService");

const {
  buildHourlyLoadForSeries,
} = require("../services/loadProfileService");

const {
  simulateHourByHour,
} = require("../services/batterySimulationService");

const {
  sum12,
} = require("../utils/arrayUtils");

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

module.exports = {
  PVGIS,
  orientationToPvgisAspect,
  getLatLonFromUkPostcode,
  getPvgisAnnualKWhForRoof,
  getTotalPvgisMonthlyKWh,
  getPvgisMonthlyKWhForRoof,
  getTotalPvgisAnnualKWh,
  getPvgisHourlyKWhForRoof,
  getTotalPvgisHourlyKWh,
  runHourlyModelForYear,
};