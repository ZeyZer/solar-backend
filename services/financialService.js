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
    // Original/internal names
    baselineMonthlyCost,
    systemMonthlyCostBeforeSEG,
    exportCreditMonthly,
    systemMonthlyNet,

    // Monthly aliases expected by frontend tables/charts
    monthlyBaseline: baselineMonthlyCost,
    monthlyAfterImportAndStanding: systemMonthlyCostBeforeSEG,
    monthlyExportCredit: exportCreditMonthly,
    monthlyAfterNet: systemMonthlyNet,
    monthlyAfter: systemMonthlyNet,

    // Annual totals
    annualBaseline,
    annualSystemBeforeSEG,
    annualExportCredit,
    annualSystemNet,

    // Additional aliases used by recalc/hourly billing style
    annualAfterImportAndStanding: annualSystemBeforeSEG,
    annualAfterNet: annualSystemNet,

    // UI compatibility alias
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


module.exports = {
  MONTH_LABELS,
  round2,
  getPanelDegradationRate,
  solarDegradationMultiplier,
  makeMonthlyFinancialSeries,
  makePaybackAndLifetimeSeries,
};