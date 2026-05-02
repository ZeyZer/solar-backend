const { CONFIG } = require("../config/quoteConfig");
const MCS_TABLES = require("../data/mcs_self_consumption_tables.json")?.tables;

const {
  PVGIS,
  getLatLonFromUkPostcode,
  orientationToPvgisAspect,
  getPvgisAnnualKWhForRoof,
} = require("../services/pvgisService");

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

module.exports = {
  lookupMcsSelfConsumptionFraction,
  getMcsRoofGroupData,
  estimateSelfConsumptionAndSavings,
};