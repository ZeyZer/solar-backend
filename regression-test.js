const API_BASE = process.env.API_BASE || "http://localhost:4000";

const EXPECTED_VERSIONS = {
  calculationVersion: "1.0.0-beta",
  assumptionsVersion: "2026-beta-1",
  tariffModelVersion: "1.0.0-beta",
  batteryModelVersion: "1.0.0-beta",
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
  }
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

async function runRecalcCheck(originalQuote, originalInput) {
  const recalcPayload = {
    quote: originalQuote,
    input: {
      ...originalInput,
      batteryKWh: 5,
      tariffBefore: originalInput.tariffBefore,
      tariffAfter: {
        ...originalInput.tariffAfter,
        segPrice: 0.15,
      },
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

  for (const scenario of scenarios) {
    console.log(`\n▶ ${scenario.name}`);

    const quote = await runQuoteScenarioWithRetry(scenario);

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

  console.log("\n▶ Recalc check from standard battery scenario");

  const standardBatteryQuote = await runQuoteScenarioWithRetry(scenarios[1]);
  const recalculatedQuote = await runRecalcCheck(
    standardBatteryQuote,
    scenarios[1].input
  );

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