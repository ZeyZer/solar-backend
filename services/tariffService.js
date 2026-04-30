function normalizeTariff(raw, kind /* "before" | "after" */) {
  const rawTariff = raw && typeof raw === "object" ? raw : {};

  // Defensive cleanup: ignore accidentally nested tariff buckets from old frontend state.
  const { before, after, tariff, ...t } = rawTariff;

  // Defaults match your recalc defaults + your UI.
  const base = {
    tariffType: "standard",

    // Flat defaults
    importPrice: 0.28,
    segPrice: 0.12,

    standingChargePerDay: 0.60,

    // Overnight
    importNight: 0.08,
    importDay: 0.20,
    nightStartHour: 0,
    nightEndHour: 7,

    // Flux
    importOffPeak: 0.15,
    importPeak: 0.40,
    exportOffPeak: 0.08,
    exportPeak: 0.30,
    offPeakStartHour: 0,
    offPeakEndHour: 6,
    peakStartHour: 16,
    peakEndHour: 19,

    // Toggles
    exportFromBatteryEnabled: true,
    allowGridCharging: false,
    allowEnergyTrading: false,
  };

  const out = { ...base, ...t };

  const numKeys = [
    "importPrice",
    "segPrice",
    "standingChargePerDay",
    "importNight",
    "importDay",
    "nightStartHour",
    "nightEndHour",
    "importOffPeak",
    "importPeak",
    "exportOffPeak",
    "exportPeak",
    "offPeakStartHour",
    "offPeakEndHour",
    "peakStartHour",
    "peakEndHour",
  ];

  for (const k of numKeys) {
    if (out[k] != null) out[k] = Number(out[k]);
  }

  out.tariffType = String(out.tariffType || "standard");
  out.exportFromBatteryEnabled = !!out.exportFromBatteryEnabled;
  out.allowGridCharging = !!out.allowGridCharging;
  out.allowEnergyTrading = !!out.allowEnergyTrading;

  if (out.tariffType === "overnight") {
    if (!Number.isFinite(out.importNight)) out.importNight = base.importNight;
    if (!Number.isFinite(out.importDay)) {
      out.importDay = out.importPrice || base.importDay;
    }
  }

  if (out.tariffType === "flux") {
    if (!Number.isFinite(out.importOffPeak)) {
      out.importOffPeak = base.importOffPeak;
    }

    if (!Number.isFinite(out.importPeak)) {
      out.importPeak = base.importPeak;
    }

    if (!Number.isFinite(out.exportOffPeak)) {
      out.exportOffPeak = base.exportOffPeak;
    }

    if (!Number.isFinite(out.exportPeak)) {
      out.exportPeak = base.exportPeak;
    }
  }

  return out;
}

function isRetailRateTariff(tariff) {
  const tt = String(tariff?.tariffType || "standard");
  return tt === "overnight" || tt === "flux";
}

function rateForHour(tariff, hod, kind /* "import" | "export" */) {
  const tt = tariff?.tariffType || "standard";

  const importFlat = Number(tariff?.importPrice ?? 0.28);
  const exportFlat = Number(tariff?.segPrice ?? 0.12);

  if (tt === "standard") {
    return kind === "import" ? importFlat : exportFlat;
  }

  // Cheap overnight (e.g. EV style)
  if (tt === "overnight") {
    const nightStart = Number(tariff?.nightStartHour ?? 0);
    const nightEnd = Number(tariff?.nightEndHour ?? 7);
    const isNight = hod >= nightStart && hod < nightEnd;

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

    const isOffPeak = hod >= offPeakStart && hod < offPeakEnd;
    const isPeak = hod >= peakStart && hod < peakEnd;

    const importOffPeak = Number(tariff?.importOffPeak ?? 0.17);
    const importDay = Number(tariff?.importPrice ?? importFlat);
    const importPeak = Number(tariff?.importPeak ?? 0.40);

    const exportOffPeak = Number(tariff?.exportOffPeak ?? exportFlat);
    const exportDay = Number(tariff?.segPrice ?? exportFlat);
    const exportPeak = Number(tariff?.exportPeak ?? 0.30);

    if (kind === "import") {
      return isOffPeak ? importOffPeak : isPeak ? importPeak : importDay;
    }

    return isOffPeak ? exportOffPeak : isPeak ? exportPeak : exportDay;
  }

  // Fallback
  return kind === "import" ? importFlat : exportFlat;
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
    const hod = hourOfDay[i] ?? i % 24;

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
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  const standingBeforeMonthly = daysInMonth.map(
    (d) => d * Number(tb.standingChargePerDay || 0)
  );

  const standingAfterMonthly = daysInMonth.map(
    (d) => d * Number(ta.standingChargePerDay || 0)
  );

  const monthlyAfterImportAndStanding = monthlyAfterImportOnly.map(
    (v, i) => v + standingAfterMonthly[i]
  );

  const monthlyBaselineWithStanding = monthlyBaseline.map(
    (v, i) => v + standingBeforeMonthly[i]
  );

  const monthlyAfterNet = monthlyAfterImportAndStanding.map(
    (v, i) => v - monthlyExportIncome[i]
  );

  const annualBaseline = monthlyBaselineWithStanding.reduce((a, b) => a + b, 0);
  const annualAfterImportAndStanding = monthlyAfterImportAndStanding.reduce(
    (a, b) => a + b,
    0
  );
  const annualExportCredit = monthlyExportIncome.reduce((a, b) => a + b, 0);
  const annualAfterNet = monthlyAfterNet.reduce((a, b) => a + b, 0);

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

module.exports = {
  normalizeTariff,
  isRetailRateTariff,
  rateForHour,
  computeHourlyBilling,
};