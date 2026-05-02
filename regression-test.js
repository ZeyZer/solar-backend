const API_BASE = process.env.API_BASE || "http://localhost:4000";

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
      requireHourlyModel: true,
      requireFinancialSeries: true,
      requirePaybackYearly: true,
      requireBatteryRecommendations: false,
      annualGenerationMin: 3000,
      annualGenerationMax: 5200,
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
      requireHourlyModel: true,
      requireFinancialSeries: true,
      requirePaybackYearly: true,
      requireBatteryRecommendations: true,
      annualGenerationMin: 3000,
      annualGenerationMax: 5200,
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
      requireHourlyModel: true,
      requireFinancialSeries: true,
      requirePaybackYearly: true,
      requireBatteryRecommendations: true,
      annualGenerationMin: 3000,
      annualGenerationMax: 5200,
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
      requireHourlyModel: true,
      requireFinancialSeries: true,
      requirePaybackYearly: true,
      requireBatteryRecommendations: true,
      annualGenerationMin: 3000,
      annualGenerationMax: 5200,
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
      requireHourlyModel: true,
      requireFinancialSeries: true,
      requirePaybackYearly: true,
      requireBatteryRecommendations: true,
      annualGenerationMin: 2800,
      annualGenerationMax: 6200,
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

function checkQuoteShape(quote, expectations) {
  assert(quote && typeof quote === "object", "Quote response is not an object.");

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

  assert(
    quote.estAnnualGenerationKWh >= expectations.annualGenerationMin,
    `Annual generation too low: ${quote.estAnnualGenerationKWh}`
  );

  assert(
    quote.estAnnualGenerationKWh <= expectations.annualGenerationMax,
    `Annual generation too high: ${quote.estAnnualGenerationKWh}`
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
    requireHourlyModel: true,
    requireFinancialSeries: true,
    requirePaybackYearly: true,
    requireBatteryRecommendations: true,
    annualGenerationMin: 3000,
    annualGenerationMax: 5200,
  });

  return recalculatedQuote;
}

async function main() {
  console.log(`Running regression tests against ${API_BASE}`);

  let passed = 0;

  for (const scenario of scenarios) {
    console.log(`\n▶ ${scenario.name}`);

    const quote = await runQuoteScenario(scenario);

    console.log("  Quote OK:", {
      systemSizeKwp: quote.systemSizeKwp,
      panelCount: quote.panelCount,
      annualGeneration: quote.estAnnualGenerationKWh,
      totalAnnualBenefit: quote.totalAnnualBenefit,
      paybackYears: quote.simplePaybackYears,
      selfConsumptionModel: quote.selfConsumptionModel,
      batteryRecommendation: quote.batteryRecommendations?.bestPayback
        ?.batteryKWhUsable,
    });

    passed += 1;
  }

  console.log("\n▶ Recalc check from standard battery scenario");

  const standardBatteryQuote = await runQuoteScenario(scenarios[1]);
  const recalculatedQuote = await runRecalcCheck(
    standardBatteryQuote,
    scenarios[1].input
  );

  console.log("  Recalc OK:", {
    annualGeneration: recalculatedQuote.estAnnualGenerationKWh,
    totalAnnualBenefit: recalculatedQuote.totalAnnualBenefit,
    paybackYears: recalculatedQuote.simplePaybackYears,
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