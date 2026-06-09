const API_BASE = process.env.API_BASE || "http://localhost:4000";

const EXPECTED_VERSIONS = {
  calculationVersion: "1.1.0-beta",
  assumptionsVersion: "2026-beta-2",
  tariffModelVersion: "1.0.0-beta",
  batteryModelVersion: "1.1.0-beta",
};

const DEFAULT_TARIFF_BEFORE = {
  tariffType: "standard",
  importPrice: 0.28,
  standingChargePerDay: 0.6,
};

const DEFAULT_TARIFF_AFTER = {
  tariffType: "standard",
  importPrice: 0.28,
  standingChargePerDay: 0.6,
  segPrice: 0.12,
  exportFromBatteryEnabled: true,
};

const baseInput = {
  name: "Regression Test Customer",
  email: "test@example.com",
  phone: "07123456789",

  _testMode: {
    skipLeadStorage: true,
  },

  homeOwnership: "owner",
  houseNumber: "10",
  postcode: "SW1A 1AA",

  annualKWh: 3500,
  monthlyBill: 100,
  roofSize: "medium",
  shading: "none",
  occupancyProfile: "half_day",

  panelOption: "value",
  batteryKWh: 5,
  birdProtection: false,
  evCharger: false,

  roofs: [
    {
      id: "test-roof-1",
      orientation: "S",
      tilt: 40,
      shading: "none",
      roofSize: "medium",
      panels: 10,
    },
  ],

  tariffBefore: DEFAULT_TARIFF_BEFORE,
  tariffAfter: DEFAULT_TARIFF_AFTER,
};

const scenarios = [
  {
    name: "Standard tariff, no battery",
    input: {
      ...baseInput,
      batteryKWh: 0,
      tariffBefore: DEFAULT_TARIFF_BEFORE,
      tariffAfter: DEFAULT_TARIFF_AFTER,
    },
    expectations: {
      requireLeadId: true,
      requireVersions: true,
      requireHourlyModel: true,
      requireFinancialSeries: true,
      requirePaybackYearly: true,
      requireBatteryRecommendations: false,

      panelCount: 10,
      systemSizeKwpMin: 4.0,
      systemSizeKwpMax: 4.8,

      annualGenerationMin: 3600,
      annualGenerationMax: 4900,

      annualBillSavingsMin: 250,
      annualBillSavingsMax: 550,

      annualSegIncomeMin: 80,
      annualSegIncomeMax: 450,

      totalAnnualBenefitMin: 550,
      totalAnnualBenefitMax: 1100,

      paybackYearsMin: 4.5,
      paybackYearsMax: 10.5,

      annualImportedKWhMin: 1000,
      annualImportedKWhMax: 3500,

      annualExportedKWhMin: 500,
      annualExportedKWhMax: 3500,

      annualSelfUsedKWhMin: 1000,
      annualSelfUsedKWhMax: 3800,
    },
  },

  {
    name: "Standard tariff, 5 kWh battery",
    input: {
      ...baseInput,
      batteryKWh: 5,
      tariffBefore: DEFAULT_TARIFF_BEFORE,
      tariffAfter: DEFAULT_TARIFF_AFTER,
    },
    expectations: {
      requireLeadId: true,
      requireVersions: true,
      requireHourlyModel: true,
      requireFinancialSeries: true,
      requirePaybackYearly: true,
      requireBatteryRecommendations: true,

      panelCount: 10,
      systemSizeKwpMin: 4.0,
      systemSizeKwpMax: 4.8,

      annualGenerationMin: 3600,
      annualGenerationMax: 4900,

      annualBillSavingsMin: 650,
      annualBillSavingsMax: 1200,

      annualSegIncomeMin: 40,
      annualSegIncomeMax: 250,

      totalAnnualBenefitMin: 700,
      totalAnnualBenefitMax: 1300,

      paybackYearsMin: 4.5,
      paybackYearsMax: 11.0,

      annualImportedKWhMin: 300,
      annualImportedKWhMax: 2500,

      annualExportedKWhMin: 300,
      annualExportedKWhMax: 2800,

      annualSelfUsedKWhMin: 1600,
      annualSelfUsedKWhMax: 4200,

      annualBatteryChargeKWhMin: 300,
      annualBatteryChargeKWhMax: 2500,
    },
  },

  {
    name: "Cheap overnight tariff, 5 kWh battery",
    input: {
      ...baseInput,
      batteryKWh: 5,
      tariffBefore: {
        tariffType: "standard",
        importPrice: 0.28,
        standingChargePerDay: 0.6,
      },
      tariffAfter: {
        tariffType: "overnight",
        importNight: 0.08,
        importDay: 0.28,
        importPrice: 0.28,
        standingChargePerDay: 0.6,
        segPrice: 0.12,
        nightStartHour: 0,
        nightEndHour: 7,
        exportFromBatteryEnabled: true,
      },
    },
    expectations: {
      requireLeadId: true,
      requireVersions: true,
      requireHourlyModel: true,
      requireFinancialSeries: true,
      requirePaybackYearly: true,
      requireBatteryRecommendations: true,

      panelCount: 10,
      systemSizeKwpMin: 4.0,
      systemSizeKwpMax: 4.8,

      annualGenerationMin: 3600,
      annualGenerationMax: 4900,

      annualBillSavingsMin: 650,
      annualBillSavingsMax: 1300,

      annualSegIncomeMin: 40,
      annualSegIncomeMax: 300,

      totalAnnualBenefitMin: 750,
      totalAnnualBenefitMax: 1400,

      paybackYearsMin: 4.0,
      paybackYearsMax: 11.0,

      annualImportedKWhMin: 200,
      annualImportedKWhMax: 2800,

      annualExportedKWhMin: 300,
      annualExportedKWhMax: 3000,

      annualSelfUsedKWhMin: 1600,
      annualSelfUsedKWhMax: 4300,

      annualBatteryChargeKWhMin: 300,
      annualBatteryChargeKWhMax: 2800,
    },
  },

  {
    name: "Flux-style tariff, battery export enabled",
    input: {
      ...baseInput,
      batteryKWh: 5,
      tariffBefore: {
        tariffType: "standard",
        importPrice: 0.28,
        standingChargePerDay: 0.6,
      },
      tariffAfter: {
        tariffType: "flux",
        importPrice: 0.28,
        standingChargePerDay: 0.6,

        importOffPeak: 0.17,
        importPeak: 0.4,
        exportOffPeak: 0.04,
        exportPeak: 0.3,

        segPrice: 0.12,

        offPeakStartHour: 2,
        offPeakEndHour: 5,
        peakStartHour: 16,
        peakEndHour: 19,

        exportFromBatteryEnabled: true,
        allowGridCharging: true,
        allowEnergyTrading: false,
      },
    },
    expectations: {
      requireLeadId: true,
      requireVersions: true,
      requireHourlyModel: true,
      requireFinancialSeries: true,
      requirePaybackYearly: true,
      requireBatteryRecommendations: true,

      panelCount: 10,
      systemSizeKwpMin: 4.0,
      systemSizeKwpMax: 4.8,

      annualGenerationMin: 3600,
      annualGenerationMax: 4900,

      annualBillSavingsMin: 550,
      annualBillSavingsMax: 1300,

      annualSegIncomeMin: 50,
      annualSegIncomeMax: 500,

      totalAnnualBenefitMin: 700,
      totalAnnualBenefitMax: 1500,

      paybackYearsMin: 4.0,
      paybackYearsMax: 12.0,

      annualImportedKWhMin: 100,
      annualImportedKWhMax: 3200,

      annualExportedKWhMin: 300,
      annualExportedKWhMax: 3500,

      annualSelfUsedKWhMin: 1400,
      annualSelfUsedKWhMax: 4500,

      annualBatteryChargeKWhMin: 300,
      annualBatteryChargeKWhMax: 3200,
    },
  },

  {
    name: "East/west multi-roof system",
    input: {
      ...baseInput,
      annualKWh: 4500,
      batteryKWh: 5,
      roofSize: "large",
      roofs: [
        {
          id: "east-roof",
          orientation: "E",
          tilt: 35,
          shading: "none",
          roofSize: "medium",
          panels: 6,
        },
        {
          id: "west-roof",
          orientation: "W",
          tilt: 35,
          shading: "none",
          roofSize: "medium",
          panels: 6,
        },
      ],
      tariffBefore: DEFAULT_TARIFF_BEFORE,
      tariffAfter: DEFAULT_TARIFF_AFTER,
    },
    expectations: {
      requireLeadId: true,
      requireVersions: true,
      requireHourlyModel: true,
      requireFinancialSeries: true,
      requirePaybackYearly: true,
      requireBatteryRecommendations: true,

      panelCount: 12,
      systemSizeKwpMin: 4.8,
      systemSizeKwpMax: 5.8,

      annualGenerationMin: 2800,
      annualGenerationMax: 6200,

      annualBillSavingsMin: 550,
      annualBillSavingsMax: 1400,

      annualSegIncomeMin: 30,
      annualSegIncomeMax: 450,

      totalAnnualBenefitMin: 650,
      totalAnnualBenefitMax: 1600,

      paybackYearsMin: 4.0,
      paybackYearsMax: 13.0,

      annualImportedKWhMin: 300,
      annualImportedKWhMax: 3600,

      annualExportedKWhMin: 200,
      annualExportedKWhMax: 4500,

      annualSelfUsedKWhMin: 1200,
      annualSelfUsedKWhMax: 5200,

      annualBatteryChargeKWhMin: 200,
      annualBatteryChargeKWhMax: 3200,
    },
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function arrayHasLength(value, length) {
  return Array.isArray(value) && value.length === length;
}

function getPaybackYears(quote) {
  const value =
    quote?.financialSeries?.payback?.paybackYear ??
    quote?.simplePaybackYears ??
    null;

  return Number(value);
}

function getAnnualBatteryChargeKWh(quote) {
  const hm = quote?.hourlyModel || {};

  if (isNumber(hm.annualBatteryChargeKWh)) {
    return hm.annualBatteryChargeKWh;
  }

  if (Array.isArray(hm.monthlyBatteryChargeKWh)) {
    return hm.monthlyBatteryChargeKWh.reduce(
      (sum, value) => sum + Number(value || 0),
      0
    );
  }

  if (Array.isArray(hm.monthlyBatteryChargeFromPVKWh)) {
    return hm.monthlyBatteryChargeFromPVKWh.reduce(
      (sum, value) => sum + Number(value || 0),
      0
    );
  }

  return null;
}

function getAnnualMetric(quote, key, monthlyKey) {
  const hm = quote?.hourlyModel || {};

  if (isNumber(hm[key])) {
    return hm[key];
  }

  if (Array.isArray(hm[monthlyKey])) {
    return hm[monthlyKey].reduce((sum, value) => sum + Number(value || 0), 0);
  }

  return null;
}

function checkApproxEqual(label, actual, expected, tolerance = 1) {
  assert(
    isNumber(actual),
    `${label} actual value is missing or not a number: ${actual}`
  );

  assert(
    isNumber(expected),
    `${label} expected value is missing or not a number: ${expected}`
  );

  const difference = Math.abs(actual - expected);

  assert(
    difference <= tolerance,
    `${label} mismatch: actual ${actual}, expected ${expected}, difference ${difference}`
  );

  console.log(
    `    ✓ ${label}: ${roundForLog(actual)} ≈ ${roundForLog(expected)}`
  );
}

function checkRange(label, value, min, max) {
  if (min == null && max == null) return;

  assert(
    isNumber(value),
    `${label} is missing or not a number: ${value}`
  );

  if (min != null) {
    assert(
      value >= min,
      `${label} too low: ${value} < ${min}`
    );
  }

  if (max != null) {
    assert(
      value <= max,
      `${label} too high: ${value} > ${max}`
    );
  }

  console.log(`    ✓ ${label}: ${roundForLog(value)} within ${min ?? "—"}–${max ?? "—"}`);
}

function checkGreaterThan(label, actual, comparison, minimumDifference = 0) {
  assert(
    isNumber(actual),
    `${label} actual value is missing or not a number: ${actual}`
  );

  assert(
    isNumber(comparison),
    `${label} comparison value is missing or not a number: ${comparison}`
  );

  const difference = actual - comparison;

  assert(
    difference > minimumDifference,
    `${label} expected ${actual} to be greater than ${comparison} by more than ${minimumDifference}, difference was ${difference}`
  );

  console.log(
    `    ✓ ${label}: ${roundForLog(actual)} > ${roundForLog(comparison)}`
  );
}

function checkLessThan(label, actual, comparison, minimumDifference = 0) {
  assert(
    isNumber(actual),
    `${label} actual value is missing or not a number: ${actual}`
  );

  assert(
    isNumber(comparison),
    `${label} comparison value is missing or not a number: ${comparison}`
  );

  const difference = comparison - actual;

  assert(
    difference > minimumDifference,
    `${label} expected ${actual} to be less than ${comparison} by more than ${minimumDifference}, difference was ${difference}`
  );

  console.log(
    `    ✓ ${label}: ${roundForLog(actual)} < ${roundForLog(comparison)}`
  );
}

function checkGreaterThanOrNear(label, actual, comparison, tolerance = 0) {
  assert(
    isNumber(actual),
    `${label} actual value is missing or not a number: ${actual}`
  );

  assert(
    isNumber(comparison),
    `${label} comparison value is missing or not a number: ${comparison}`
  );

  assert(
    actual + tolerance >= comparison,
    `${label} expected ${actual} to be at least near ${comparison} with tolerance ${tolerance}`
  );

  console.log(
    `    ✓ ${label}: ${roundForLog(actual)} is near/above ${roundForLog(comparison)}`
  );
}

function roundForLog(value) {
  if (!isNumber(value)) return value;
  return Math.round(value * 100) / 100;
}

function shouldRetryError(err) {
  const message = String(err?.message || err || "").toLowerCase();

  return (
    message.includes("fetch failed") ||
    message.includes("socket") ||
    message.includes("timeout") ||
    message.includes("http 500") ||
    message.includes("missing hourlymodel") ||
    message.includes("expected hourly selfconsumptionmodel")
  );
}

async function postJson(path, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function checkQuoteVersions(quote) {
  assert(
    quote.calculationVersion === EXPECTED_VERSIONS.calculationVersion,
    `Unexpected calculationVersion: ${quote.calculationVersion}`
  );

  assert(
    quote.assumptionsVersion === EXPECTED_VERSIONS.assumptionsVersion,
    `Unexpected assumptionsVersion: ${quote.assumptionsVersion}`
  );

  assert(
    quote.tariffModelVersion === EXPECTED_VERSIONS.tariffModelVersion,
    `Unexpected tariffModelVersion: ${quote.tariffModelVersion}`
  );

  assert(
    quote.batteryModelVersion === EXPECTED_VERSIONS.batteryModelVersion,
    `Unexpected batteryModelVersion: ${quote.batteryModelVersion}`
  );

  assert(
    quote.quoteEngineVersion &&
      typeof quote.quoteEngineVersion === "object",
    "Missing quoteEngineVersion object."
  );

  assert(
    quote.hardwareCatalog &&
      typeof quote.hardwareCatalog === "object",
    "Missing hardwareCatalog object."
  );

  assert(
    typeof quote.hardwareCatalog.version === "string" &&
      quote.hardwareCatalog.version.length > 0,
    "Missing hardware catalog version."
  );

  assert(
    quote.hardwareCatalogVersion === quote.hardwareCatalog.version,
    "hardwareCatalogVersion should match hardwareCatalog.version."
  );

  assert(
    quote.hardwareCatalog.assumptions &&
      typeof quote.hardwareCatalog.assumptions === "object",
    "Missing hardware catalog assumptions."
  );

  assert(
    quote.hardwareCatalog.assumptions.usedForPricing === false,
    "Hardware catalogue should not yet be used for pricing."
  );

  assert(
    quote.hardwareCatalog.assumptions.usedForBatteryRecommendations === false,
    "Hardware catalogue should not yet be used for battery recommendations."
  );

  assert(
    quote.hardwareCatalog.summary?.batteries?.active > 0,
    "Hardware catalogue summary should include active batteries."
  );

  assert(
    quote.hardwareCatalog.summary?.panels?.active > 0,
    "Hardware catalogue summary should include active panels."
  );

  assert(
    quote.hardwareCatalog.summary?.inverters?.active > 0,
    "Hardware catalogue summary should include active inverters."
  );

  assert(
    quote.tariffModelAssumptions &&
      typeof quote.tariffModelAssumptions === "object",
    "Missing tariffModelAssumptions object."
  );

  assert(
    quote.tariffModelAssumptions.timeResolution === "hourly",
    `Unexpected tariff timeResolution: ${quote.tariffModelAssumptions.timeResolution}`
  );

  assert(
    quote.tariffModelAssumptions.supportsHalfHourly === false,
    "Expected supportsHalfHourly to be false for current beta tariff model."
  );

  assert(
    quote.tariffModelAssumptions.presets &&
      quote.tariffModelAssumptions.presets.standard,
    "Missing standard tariff preset assumptions."
  );

  assert(
    isNumber(quote.tariffModelAssumptions.presets.standard.importPrice),
    "Missing standard tariff importPrice assumption."
  );

  assert(
    isNumber(quote.tariffModelAssumptions.presets.standard.segPrice),
    "Missing standard tariff segPrice assumption."
  );

  assert(
    quote.tariffModelAssumptions.presets.flux,
    "Missing flux tariff preset assumptions."
  );

  assert(
    quote.tariffWarnings &&
      typeof quote.tariffWarnings === "object",
    "Missing tariffWarnings object."
  );

  assert(
    Array.isArray(quote.tariffWarnings.warnings),
    "tariffWarnings.warnings must be an array."
  );

  assert(
    quote.tariffWarnings.warnings.length > 0,
    "tariffWarnings.warnings should contain at least one notice."
  );

  assert(
    quote.tariffWarnings.timeResolution === "hourly",
    `Unexpected tariffWarnings.timeResolution: ${quote.tariffWarnings.timeResolution}`
  );

  assert(
    quote.tariffWarnings.warnings.some((warning) => warning.code === "HOURLY_TARIFF_MODEL"),
    "Missing hourly tariff model warning."
  );
}

function checkQuoteShape(quote, expectations) {
  assert(quote && typeof quote === "object", "Quote response is not an object.");

  if (expectations.requireLeadId) {
    assert(
      typeof quote.leadId === "string" && quote.leadId.startsWith("lead_"),
      `Missing or invalid leadId: ${quote.leadId}`
    );
  }

  if (expectations.requireVersions) {
    checkQuoteVersions(quote);
  }

  assert(isNumber(quote.systemSizeKwp), "Missing or invalid systemSizeKwp.");
  assert(isNumber(quote.panelCount), "Missing or invalid panelCount.");
  assert(
    isNumber(quote.estAnnualGenerationKWh),
    "Missing or invalid estAnnualGenerationKWh."
  );
  assert(isNumber(quote.priceLow), "Missing or invalid priceLow.");
  assert(isNumber(quote.priceHigh), "Missing or invalid priceHigh.");
  assert(
    isNumber(quote.totalAnnualBenefit),
    "Missing or invalid totalAnnualBenefit."
  );

  if (expectations.panelCount != null) {
    assert(
      quote.panelCount === expectations.panelCount,
      `Expected panelCount ${expectations.panelCount}, got ${quote.panelCount}`
    );
  }

  checkRange(
    "systemSizeKwp",
    quote.systemSizeKwp,
    expectations.systemSizeKwpMin,
    expectations.systemSizeKwpMax
  );

  checkRange(
    "annualGenerationKWh",
    quote.estAnnualGenerationKWh,
    expectations.annualGenerationMin,
    expectations.annualGenerationMax
  );

  checkRange(
    "annualBillSavings",
    quote.annualBillSavings,
    expectations.annualBillSavingsMin,
    expectations.annualBillSavingsMax
  );

  checkRange(
    "annualSegIncome",
    quote.annualSegIncome,
    expectations.annualSegIncomeMin,
    expectations.annualSegIncomeMax
  );

  checkRange(
    "totalAnnualBenefit",
    quote.totalAnnualBenefit,
    expectations.totalAnnualBenefitMin,
    expectations.totalAnnualBenefitMax
  );

  checkApproxEqual(
    "annualBillSavings + annualSegIncome = totalAnnualBenefit",
    Number(quote.annualBillSavings || 0) + Number(quote.annualSegIncome || 0),
    Number(quote.totalAnnualBenefit || 0),
    2
  );

  checkRange(
    "paybackYears",
    getPaybackYears(quote),
    expectations.paybackYearsMin,
    expectations.paybackYearsMax
  );

  if (expectations.requireHourlyModel) {
    assert(quote.hourlyModel, "Missing hourlyModel.");
    assert(
      quote.selfConsumptionModel === "hourly",
      `Expected hourly selfConsumptionModel, got ${quote.selfConsumptionModel}`
    );
    assert(
      arrayHasLength(quote.hourlyModel.monthlyGenerationKWh, 12),
      "hourlyModel.monthlyGenerationKWh must be 12 months."
    );
    assert(
      arrayHasLength(quote.hourlyModel.monthlyImportedKWh, 12),
      "hourlyModel.monthlyImportedKWh must be 12 months."
    );
    assert(
      arrayHasLength(quote.hourlyModel.monthlyExportedKWh, 12),
      "hourlyModel.monthlyExportedKWh must be 12 months."
    );

    assert(
      Array.isArray(quote.hourlyModel._pvgisRoofProfiles),
      "hourlyModel._pvgisRoofProfiles must be an array."
    );

    assert(
      quote.hourlyModel._pvgisRoofProfiles.length > 0,
      "Expected at least one PVGIS roof profile."
    );

    for (const profile of quote.hourlyModel._pvgisRoofProfiles) {
      assert(profile.roofId, "PVGIS roof profile missing roofId.");
      assert(
        Array.isArray(profile.hourlyGenerationKWh),
        `${profile.roofId} missing hourlyGenerationKWh.`
      );
      assert(
        profile.hourlyGenerationKWh.length === 8760,
        `${profile.roofId} hourlyGenerationKWh should contain 8760 values.`
      );
      assert(
        profile.source === "pvgis_hourly_3yr_avg_roof_array",
        `${profile.roofId} has unexpected PVGIS roof profile source.`
      );
    }

    checkRange(
      "annualImportedKWh",
      getAnnualMetric(quote, "annualImportedKWh", "monthlyImportedKWh"),
      expectations.annualImportedKWhMin,
      expectations.annualImportedKWhMax
    );

    checkRange(
      "annualExportedKWh",
      getAnnualMetric(quote, "annualExportedKWh", "monthlyExportedKWh"),
      expectations.annualExportedKWhMin,
      expectations.annualExportedKWhMax
    );

    checkRange(
      "annualSelfUsedKWh",
      getAnnualMetric(quote, "annualSelfUsedKWh", "monthlySelfUsedKWh"),
      expectations.annualSelfUsedKWhMin,
      expectations.annualSelfUsedKWhMax
    );

    if (
      expectations.annualBatteryChargeKWhMin != null ||
      expectations.annualBatteryChargeKWhMax != null
    ) {
      checkRange(
        "annualBatteryChargeKWh",
        getAnnualBatteryChargeKWh(quote),
        expectations.annualBatteryChargeKWhMin,
        expectations.annualBatteryChargeKWhMax
      );
    }
  }

  if (expectations.requireHourlyModel) {
    assert(
      quote.designCandidateSet,
      "Missing designCandidateSet."
    );

    assert(
      quote.designCandidateSet.mode === "candidate_set_foundation",
      `Unexpected designCandidateSet mode: ${quote.designCandidateSet.mode}`
    );

    assert(
      quote.designCandidateSet.usedForCalculation === false,
      "designCandidateSet should not be used for calculation."
    );

    assert(
      quote.designCandidateSet.usedForPricing === false,
      "designCandidateSet should not be used for pricing."
    );

    assert(
      quote.designCandidateSet.usedForRecommendation === false,
      "designCandidateSet should not be used for recommendation."
    );

    assert(
      quote.designCandidateSet.productSearchSpace?.candidateCount > 0,
      "Expected at least one design candidate."
    );

    assert(
      Array.isArray(quote.designCandidateSet.candidates),
      "designCandidateSet.candidates should be an array."
    );

    assert(
      quote.designCandidateSet.shortlist,
      "designCandidateSet missing shortlist."
    );

    assert(
      quote.designCandidateSet.shortlist.viabilitySummary,
      "designCandidateSet shortlist missing viability summary."
    );
  }

  if (expectations.requireFinancialSeries) {
    assert(quote.financialSeries, "Missing financialSeries.");
    assert(quote.financialSeries.monthly, "Missing financialSeries.monthly.");
    assert(quote.financialSeries.payback, "Missing financialSeries.payback.");

    const monthly = quote.financialSeries.monthly;

    assert(
      arrayHasLength(monthly.monthlyBaseline, 12),
      "monthlyBaseline must be 12 months."
    );
    assert(
      arrayHasLength(monthly.monthlyAfterImportAndStanding, 12) ||
        arrayHasLength(monthly.systemMonthlyCostBeforeSEG, 12),
      "Missing monthly import/standing cost array."
    );
    assert(
      arrayHasLength(monthly.monthlyExportCredit, 12) ||
        arrayHasLength(monthly.exportCreditMonthly, 12),
      "Missing monthly export credit array."
    );
    assert(
      arrayHasLength(monthly.monthlyAfterNet, 12) ||
        arrayHasLength(monthly.systemMonthlyNet, 12) ||
        arrayHasLength(monthly.monthlyAfter, 12),
      "Missing monthly after-net array."
    );
  }

  if (expectations.requirePaybackYearly) {
    assert(
      Array.isArray(quote.financialSeries?.payback?.yearly),
      "Missing financialSeries.payback.yearly."
    );
    assert(
      quote.financialSeries.payback.yearly.length === 25,
      `Expected 25 yearly rows, got ${quote.financialSeries.payback.yearly.length}`
    );

    const firstYear = quote.financialSeries.payback.yearly[0];

    assert(isNumber(firstYear.billBefore), "Yearly row missing billBefore.");
    assert(isNumber(firstYear.billAfter), "Yearly row missing billAfter.");
    assert(isNumber(firstYear.billSavings), "Yearly row missing billSavings.");
  }

  if (expectations.requireBatteryRecommendations) {
    assert(
      quote.batteryRecommendations,
      "Missing batteryRecommendations."
    );
    assert(
      quote.batteryRecommendations.bestPayback,
      "Missing batteryRecommendations.bestPayback."
    );
    assert(
      Array.isArray(quote.batteryRecommendations.curve),
      "batteryRecommendations.curve must be an array."
    );
    assert(
      quote.batteryRecommendations.curve.length > 0,
      "batteryRecommendations.curve is empty."
    );

    const noBatteryComparison = quote.batteryRecommendations.noBatteryComparison;

    assert(
      noBatteryComparison,
      "Missing batteryRecommendations.noBatteryComparison."
    );

    assert(
      noBatteryComparison.noBattery,
      "Missing noBatteryComparison.noBattery."
    );

    assert(
      noBatteryComparison.selectedBattery,
      "Missing noBatteryComparison.selectedBattery."
    );

    assert(
      noBatteryComparison.incremental,
      "Missing noBatteryComparison.incremental."
    );

    assert(
      noBatteryComparison.verdict,
      "Missing noBatteryComparison.verdict."
    );

    assert(
      isNumber(noBatteryComparison.noBattery.annualBenefit),
      "No-battery annualBenefit must be a number."
    );

    assert(
      isNumber(noBatteryComparison.selectedBattery.annualBenefit),
      "Selected-battery annualBenefit must be a number."
    );

    assert(
      isNumber(noBatteryComparison.incremental.annualBenefit),
      "Incremental annualBenefit must be a number."
    );

    assert(
      quote.batteryRecommendations.assumptions?.batteryDegradationRate != null,
      "Missing battery degradation rate in battery recommendation assumptions."
    );

    assert(
      quote.batteryRecommendations.assumptions?.minBatteryCapacityFraction != null,
      "Missing minimum battery capacity fraction in battery recommendation assumptions."
    );

    const batteryModel = quote.batteryRecommendations.assumptions?.batteryModel;

    assert(
      batteryModel && typeof batteryModel === "object",
      "Missing battery model assumptions object."
    );

    assert(
      isNumber(batteryModel.roundTripEfficiency),
      "Missing battery model roundTripEfficiency."
    );

    assert(
      isNumber(batteryModel.smallBatteryMaxChargeKW),
      "Missing battery model smallBatteryMaxChargeKW."
    );

    assert(
      isNumber(batteryModel.smallBatteryMaxDischargeKW),
      "Missing battery model smallBatteryMaxDischargeKW."
    );

    assert(
      isNumber(batteryModel.largeBatteryMaxChargeKW),
      "Missing battery model largeBatteryMaxChargeKW."
    );

    assert(
      isNumber(batteryModel.largeBatteryMaxDischargeKW),
      "Missing battery model largeBatteryMaxDischargeKW."
    );

    assert(
      isNumber(batteryModel.recommendationMaxBatteryKWh),
      "Missing battery model recommendationMaxBatteryKWh."
    );

    const bestPaybackProduct =
      quote.batteryRecommendations.bestPayback?.batteryProduct;

    assert(
      bestPaybackProduct && typeof bestPaybackProduct === "object",
      "Missing battery product metadata on bestPayback recommendation."
    );

    assert(
      typeof bestPaybackProduct.id === "string" && bestPaybackProduct.id.length > 0,
      "Best payback battery product is missing an id."
    );

    assert(
      isNumber(bestPaybackProduct.usableCapacityKWh),
      "Best payback battery product is missing usableCapacityKWh."
    );

    assert(
      bestPaybackProduct.mapping?.usedForCalculation === false,
      "Best payback battery product mapping should not be used for calculation yet."
    );

    assert(
      bestPaybackProduct.mapping?.usedForDisplayOnly === true,
      "Best payback battery product mapping should be display-only."
    );

    const selectedBatteryProduct =
      quote.batteryRecommendations.noBatteryComparison?.selectedBattery?.batteryProduct;

    assert(
      selectedBatteryProduct && typeof selectedBatteryProduct === "object",
      "Missing battery product metadata on selected battery comparison."
    );

    assert(
      typeof selectedBatteryProduct.id === "string" &&
        selectedBatteryProduct.id.length > 0,
      "Selected battery product is missing an id."
    );

    const hardwareProductMapping =
      quote.batteryRecommendations.assumptions?.hardwareProductMapping;

    assert(
      hardwareProductMapping && hardwareProductMapping.enabled === true,
      "Missing hardware product mapping assumptions."
    );

    assert(
      hardwareProductMapping.usedForCalculation === false,
      "Hardware product mapping should not be used for calculation yet."
    );
  }

  assert(
    quote.designCompatibility &&
      typeof quote.designCompatibility === "object",
    "Missing designCompatibility object."
  );

  assert(
    quote.designCompatibility.mode === "diagnostic_only",
    `Unexpected designCompatibility.mode: ${quote.designCompatibility.mode}`
  );

  assert(
    quote.designCompatibility.usedForCalculation === false,
    "designCompatibility should not be used for calculation yet."
  );

  assert(
    quote.designCompatibility.summary &&
      typeof quote.designCompatibility.summary === "object",
    "Missing designCompatibility.summary."
  );

  assert(
    Array.isArray(quote.designCompatibility.checks),
    "designCompatibility.checks must be an array."
  );

  assert(
    quote.designCompatibility.checks.length > 0,
    "designCompatibility.checks should not be empty."
  );

  assert(
    quote.designCompatibility.selectedProducts &&
      typeof quote.designCompatibility.selectedProducts === "object",
    "Missing designCompatibility.selectedProducts."
  );

  assert(
    quote.designCompatibility.selectedProducts.panel,
    "Missing selected design panel product."
  );

  assert(
    quote.designCompatibility.selectedProducts.inverter,
    "Missing selected design inverter product."
  );

  assert(
    Array.isArray(quote.designCompatibility.optimisationFlags),
    "designCompatibility.optimisationFlags must be an array."
  );

  assert(
    quote.designCompatibility.checks.some(
      (check) => check.code === "MPPT_COUNT_VS_ARRAYS"
    ),
    "Missing MPPT count diagnostic check."
  );

  assert(
    quote.designCompatibility.checks.some(
      (check) => check.code === "INVERTER_MAX_PV_INPUT"
    ),
    "Missing inverter max PV input diagnostic check."
  );

  assert(
    quote.designCompatibility.checks.some(
      (check) => check.code === "DC_AC_RATIO"
    ),
    "Missing DC/AC ratio diagnostic check."
  );
}

async function runQuoteScenario(scenario) {
  const quote = await postJson("/api/quote", scenario.input);

  checkQuoteShape(quote, scenario.expectations);

  return quote;
}

async function runQuoteScenarioWithRetry(scenario, maxAttempts = 2) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`  Retrying scenario (${attempt}/${maxAttempts})...`);
      }

      return await runQuoteScenario(scenario);
    } catch (err) {
      lastError = err;

      if (attempt >= maxAttempts || !shouldRetryError(err)) {
        throw err;
      }

      console.warn("  Scenario failed with retryable error:", err.message || err);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }

  throw lastError;
}

function checkScenarioComparisons(quotesByName) {
  console.log("\n▶ Behaviour comparison checks");

  const noBattery = quotesByName.get("Standard tariff, no battery");
  const standardBattery = quotesByName.get("Standard tariff, 5 kWh battery");
  const cheapOvernight = quotesByName.get("Cheap overnight tariff, 5 kWh battery");
  const flux = quotesByName.get("Flux-style tariff, battery export enabled");
  const eastWest = quotesByName.get("East/west multi-roof system");

  assert(noBattery, "Missing no-battery quote for comparison checks.");
  assert(standardBattery, "Missing standard battery quote for comparison checks.");
  assert(cheapOvernight, "Missing cheap overnight quote for comparison checks.");
  assert(flux, "Missing flux quote for comparison checks.");
  assert(eastWest, "Missing east/west quote for comparison checks.");

  const noBatteryImport = getAnnualMetric(
    noBattery,
    "annualImportedKWh",
    "monthlyImportedKWh"
  );

  const standardBatteryImport = getAnnualMetric(
    standardBattery,
    "annualImportedKWh",
    "monthlyImportedKWh"
  );

  const noBatteryExport = getAnnualMetric(
    noBattery,
    "annualExportedKWh",
    "monthlyExportedKWh"
  );

  const standardBatteryExport = getAnnualMetric(
    standardBattery,
    "annualExportedKWh",
    "monthlyExportedKWh"
  );

  const noBatterySelfUsed = getAnnualMetric(
    noBattery,
    "annualSelfUsedKWh",
    "monthlySelfUsedKWh"
  );

  const standardBatterySelfUsed = getAnnualMetric(
    standardBattery,
    "annualSelfUsedKWh",
    "monthlySelfUsedKWh"
  );

  const standardBatteryCharge = getAnnualBatteryChargeKWh(standardBattery);

  checkLessThan(
    "Battery reduces annual grid import",
    standardBatteryImport,
    noBatteryImport,
    100
  );

  checkLessThan(
    "Battery reduces annual export",
    standardBatteryExport,
    noBatteryExport,
    100
  );

  checkGreaterThan(
    "Battery increases annual self-used solar",
    standardBatterySelfUsed,
    noBatterySelfUsed,
    100
  );

  checkGreaterThan(
    "Battery charges from solar/grid during the year",
    standardBatteryCharge,
    0,
    100
  );

  checkGreaterThan(
    "Battery increases total annual benefit compared with no battery",
    Number(standardBattery.totalAnnualBenefit || 0),
    Number(noBattery.totalAnnualBenefit || 0),
    25
  );

  checkGreaterThanOrNear(
    "Cheap overnight tariff benefit is near or above standard battery benefit",
    Number(cheapOvernight.totalAnnualBenefit || 0),
    Number(standardBattery.totalAnnualBenefit || 0),
    75
  );

  checkGreaterThanOrNear(
    "Flux-style tariff benefit is near or above standard battery benefit",
    Number(flux.totalAnnualBenefit || 0),
    Number(standardBattery.totalAnnualBenefit || 0),
    125
  );

  checkGreaterThan(
    "East/west scenario has larger system size than 10-panel standard scenario",
    Number(eastWest.systemSizeKwp || 0),
    Number(standardBattery.systemSizeKwp || 0),
    0.3
  );

  assert(
    eastWest.panelCount === 12,
    `East/west scenario expected 12 panels, got ${eastWest.panelCount}`
  );

  console.log("    ✓ East/west scenario panel count: 12");
}

function checkRecalcBehaviour(originalQuote, recalculatedQuote) {
  console.log("\n▶ Recalc behaviour checks");

  checkApproxEqual(
    "Recalc preserves annual generation",
    Number(recalculatedQuote.estAnnualGenerationKWh || 0),
    Number(originalQuote.estAnnualGenerationKWh || 0),
    1
  );

  checkApproxEqual(
    "Recalc preserves system size",
    Number(recalculatedQuote.systemSizeKwp || 0),
    Number(originalQuote.systemSizeKwp || 0),
    0.01
  );

  checkApproxEqual(
    "Recalc preserves panel count",
    Number(recalculatedQuote.panelCount || 0),
    Number(originalQuote.panelCount || 0),
    0
  );

  const originalSeg = Number(originalQuote.annualSegIncome || 0);
  const recalculatedSeg = Number(recalculatedQuote.annualSegIncome || 0);

  checkGreaterThan(
    "Increasing SEG rate increases annual SEG income",
    recalculatedSeg,
    originalSeg,
    10
  );

  checkApproxEqual(
    "Recalc annualBillSavings + annualSegIncome = totalAnnualBenefit",
    Number(recalculatedQuote.annualBillSavings || 0) +
      Number(recalculatedQuote.annualSegIncome || 0),
    Number(recalculatedQuote.totalAnnualBenefit || 0),
    2
  );

  assert(
    recalculatedQuote.designCompatibility &&
      typeof recalculatedQuote.designCompatibility === "object",
    "Recalc response missing designCompatibility."
  );

  assert(
    recalculatedQuote.designCompatibility.usedForCalculation === false,
    "Recalc designCompatibility should not be used for calculation yet."
  );

  assert(
    Array.isArray(recalculatedQuote.designCompatibility.checks) &&
      recalculatedQuote.designCompatibility.checks.length > 0,
    "Recalc designCompatibility checks should not be empty."
  );

  console.log("    ✓ Recalc includes diagnostic design compatibility checks");
}

async function runRecalcCheck(originalQuote, originalInput) {
  const changedTariffAfter = {
    ...originalInput.tariffAfter,
    segPrice: 0.15,
  };

  const recalcPayload = {
    quote: originalQuote,

    // Important: quoteRecalcRoutes expects these at top level,
    // matching the real frontend recalculateQuote() call.
    tariffBefore: originalInput.tariffBefore,
    tariffAfter: changedTariffAfter,

    input: {
      ...originalInput,
      batteryKWh: 5,
      tariffBefore: originalInput.tariffBefore,
      tariffAfter: changedTariffAfter,
    },
  };

  const recalculatedQuote = await postJson("/api/quote/recalc", recalcPayload);

  checkQuoteShape(recalculatedQuote, {
    requireLeadId: false,
    requireVersions: true,
    requireHourlyModel: true,
    requireFinancialSeries: true,
    requirePaybackYearly: true,
    requireBatteryRecommendations: true,

    panelCount: 10,
    systemSizeKwpMin: 4.0,
    systemSizeKwpMax: 4.8,

    annualGenerationMin: 3600,
    annualGenerationMax: 4900,

    annualBillSavingsMin: 650,
    annualBillSavingsMax: 1300,

    annualSegIncomeMin: 40,
    annualSegIncomeMax: 350,

    totalAnnualBenefitMin: 700,
    totalAnnualBenefitMax: 1450,

    paybackYearsMin: 4.0,
    paybackYearsMax: 11.0,

    annualImportedKWhMin: 200,
    annualImportedKWhMax: 2800,

    annualExportedKWhMin: 300,
    annualExportedKWhMax: 3200,

    annualSelfUsedKWhMin: 1600,
    annualSelfUsedKWhMax: 4300,

    annualBatteryChargeKWhMin: 300,
    annualBatteryChargeKWhMax: 2800,
  });

  return recalculatedQuote;
}

async function main() {
  console.log(`Running regression tests against ${API_BASE}`);

  let passed = 0;
  const quotesByName = new Map();

  for (const scenario of scenarios) {
    console.log(`\n▶ ${scenario.name}`);

    const quote = await runQuoteScenarioWithRetry(scenario);
    quotesByName.set(scenario.name, quote);

    console.log("  Quote OK:", {
      calculationVersion: quote.calculationVersion,
      assumptionsVersion: quote.assumptionsVersion,
      systemSizeKwp: quote.systemSizeKwp,
      panelCount: quote.panelCount,
      annualGeneration: quote.estAnnualGenerationKWh,
      annualImportedKWh: roundForLog(
        getAnnualMetric(quote, "annualImportedKWh", "monthlyImportedKWh")
      ),
      annualExportedKWh: roundForLog(
        getAnnualMetric(quote, "annualExportedKWh", "monthlyExportedKWh")
      ),
      annualSelfUsedKWh: roundForLog(
        getAnnualMetric(quote, "annualSelfUsedKWh", "monthlySelfUsedKWh")
      ),
      totalAnnualBenefit: quote.totalAnnualBenefit,
      paybackYears: getPaybackYears(quote),
      selfConsumptionModel: quote.selfConsumptionModel,
      batteryRecommendation: quote.batteryRecommendations?.bestPayback
        ?.batteryKWhUsable,
    });

    passed += 1;
  }

  checkScenarioComparisons(quotesByName);
  console.log("\n▶ Recalc check from standard battery scenario");

  const standardBatteryQuote = await runQuoteScenarioWithRetry(scenarios[1]);
  const recalculatedQuote = await runRecalcCheck(
    standardBatteryQuote,
    scenarios[1].input
  );

  checkRecalcBehaviour(standardBatteryQuote, recalculatedQuote);

  console.log("  Recalc OK:", {
    calculationVersion: recalculatedQuote.calculationVersion,
    assumptionsVersion: recalculatedQuote.assumptionsVersion,
    annualGeneration: recalculatedQuote.estAnnualGenerationKWh,
    annualImportedKWh: roundForLog(
      getAnnualMetric(recalculatedQuote, "annualImportedKWh", "monthlyImportedKWh")
    ),
    annualExportedKWh: roundForLog(
      getAnnualMetric(recalculatedQuote, "annualExportedKWh", "monthlyExportedKWh")
    ),
    annualSelfUsedKWh: roundForLog(
      getAnnualMetric(recalculatedQuote, "annualSelfUsedKWh", "monthlySelfUsedKWh")
    ),
    totalAnnualBenefit: recalculatedQuote.totalAnnualBenefit,
    paybackYears: getPaybackYears(recalculatedQuote),
    batteryRecommendation: recalculatedQuote.batteryRecommendations?.bestPayback
      ?.batteryKWhUsable,
  });

  passed += 1;

  console.log(`\n✅ Regression tests passed: ${passed}/${scenarios.length + 1}`);
}

main().catch((err) => {
  console.error("\n❌ Regression test failed:");
  console.error(err.message || err);
  process.exit(1);
});