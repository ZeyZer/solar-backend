const {
  getDefaultTariff,
} = require("../config/tariffPresets");

function isHourInWindow(hod, startHour, endHour) {
  const hour = Number(hod ?? 0);
  const start = Number(startHour ?? 0);
  const end = Number(endHour ?? 0);

  if (start < end) {
    return hour >= start && hour < end;
  }

  if (start > end) {
    return hour >= start || hour < end;
  }

  return false;
}

function normalizeTariff(raw, kind /* "before" | "after" */) {
  const rawTariff = raw && typeof raw === "object" ? raw : {};

  // Defensive cleanup: ignore accidentally nested tariff buckets from old frontend state.
  const { before, after, tariff, ...t } = rawTariff;

  const base = getDefaultTariff(kind);

  const out = {
    ...base,
    ...t,
  };

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

  const validTariffTypes = ["standard", "overnight", "flux"];
  out.tariffType = String(out.tariffType || "standard").toLowerCase();

  if (!validTariffTypes.includes(out.tariffType)) {
    out.tariffType = "standard";
  }

  out.exportFromBatteryEnabled = !!out.exportFromBatteryEnabled;
  out.allowGridCharging = !!out.allowGridCharging;
  out.allowEnergyTrading = !!out.allowEnergyTrading;

  if (!Number.isFinite(out.importPrice)) {
    out.importPrice = base.importPrice;
  }

  if (!Number.isFinite(out.segPrice)) {
    out.segPrice = base.segPrice;
  }

  if (!Number.isFinite(out.standingChargePerDay)) {
    out.standingChargePerDay = base.standingChargePerDay;
  }

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

  // Cheap overnight / EV-style tariff
  if (tt === "overnight") {
    const isNight = isHourInWindow(
      hod,
      tariff?.nightStartHour ?? 0,
      tariff?.nightEndHour ?? 7
    );

    const importNight = Number(tariff?.importNight ?? 0.08);
    const importDay = Number(tariff?.importDay ?? importFlat);

    if (kind === "import") return isNight ? importNight : importDay;

    return exportFlat;
  }

  // Simplified Flux-style tariff
  if (tt === "flux") {
    const isOffPeak = isHourInWindow(
      hod,
      tariff?.offPeakStartHour ?? 0,
      tariff?.offPeakEndHour ?? 6
    );

    const isPeak = isHourInWindow(
      hod,
      tariff?.peakStartHour ?? 16,
      tariff?.peakEndHour ?? 19
    );

    const importOffPeak = Number(tariff?.importOffPeak ?? 0.15);
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

  return kind === "import" ? importFlat : exportFlat;
}

/**
 * Computes baseline + after-solar bills using hourly TOU rates.
 * Assumes arrays aligned, hourOfDay and monthIdx aligned with n hours.
 */
function computeHourlyBilling({
  loadKWh,
  importKWh,
  exportKWh,
  hourOfDay,
  monthIdx,
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