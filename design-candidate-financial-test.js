const {
  buildDesignCandidateFromInputs,
} = require("./services/designCandidateService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function buildMonthIdx() {
  const daysByMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const result = [];

  daysByMonth.forEach((days, monthIndex) => {
    for (let i = 0; i < days * 24; i++) {
      result.push(monthIndex);
    }
  });

  return result;
}

function buildHourOfDay(length = 8760) {
  return Array.from({ length }, (_, index) => index % 24);
}

function buildSyntheticPvHourly({ annualKWh = 4200 } = {}) {
  const raw = Array.from({ length: 8760 }, (_, index) => {
    const hour = index % 24;
    const day = Math.floor(index / 24);

    const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const seasonal =
      0.35 + 0.65 * Math.max(0, Math.sin(((day - 20) / 365) * Math.PI));

    return daylight * seasonal;
  });

  const rawTotal = raw.reduce((sum, value) => sum + value, 0);
  const scale = rawTotal > 0 ? annualKWh / rawTotal : 0;

  return raw.map((value) => value * scale);
}

function buildFlatLoadHourly({ annualKWh = 3500 } = {}) {
  const hourly = annualKWh / 8760;
  return Array(8760).fill(hourly);
}

function buildQuoteWithRoofProfile({
  annualPvKWh = 4221,
  annualLoadKWh = 3500,
  baseSystemSizeKwp = 4.3,
} = {}) {
  const monthIdx = buildMonthIdx();
  const hourOfDay = buildHourOfDay();
  const pvHourly = buildSyntheticPvHourly({ annualKWh: annualPvKWh });
  const loadHourly = buildFlatLoadHourly({ annualKWh: annualLoadKWh });

  return {
    systemSizeKwp: baseSystemSizeKwp,

    tariffBefore: {
      tariffType: "standard",
      importPrice: 0.28,
      standingChargePerDay: 0.6,
    },

    tariffAfter: {
      tariffType: "standard",
      importPrice: 0.28,
      standingChargePerDay: 0.6,
      segPrice: 0.12,
    },

    hourlyModel: {
      _pvHourlyKWh: pvHourly,
      _loadHourlyKWh: loadHourly,
      _monthIdx: monthIdx,
      _hourOfDay: hourOfDay,
      _batteryKWh: 5,
      _pvgisRoofProfiles: [
        {
          id: "roof-1-pvgis-avg-2021-2023",
          roofId: "roof-1",
          index: 0,
          year: "avg_2021_2023",
          source: "pvgis_hourly_3yr_avg_roof_array",
          baseSystemSizeKwp,
          hourlyGenerationKWh: pvHourly,
          monthIdx,
          hourOfDay,
          annualGenerationKWh: Math.round(
            pvHourly.reduce((sum, value) => sum + Number(value || 0), 0)
          ),
        },
      ],
    },
  };
}

function runStandardFinancialTest() {
  console.log("\n▶ Standard candidate financial model");

  const candidate = buildDesignCandidateFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
      tariffBefore: {
        tariffType: "standard",
        importPrice: 0.28,
        standingChargePerDay: 0.6,
      },
      tariffAfter: {
        tariffType: "standard",
        importPrice: 0.28,
        standingChargePerDay: 0.6,
        segPrice: 0.12,
      },
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 10,
        },
      ],
    },
  });

  const model = candidate.financialModel;

  assert(model, "Candidate missing financialModel.");
  assert(model.mode === "candidate_hourly_financial_model_beta", "Unexpected financial model mode.");
  assert(model.usedForCalculation === false, "Financial model should not be used for calculation.");
  assert(model.usedForPricing === false, "Financial model should not be used for pricing.");
  assert(model.usedForRecommendation === false, "Financial model should not be used for recommendation.");

  assert(model.source === "candidate_hourly_dispatch_billing", "Unexpected financial source.");
  assert(model.performanceSource === "scaled_from_pvgis_roof_array_profiles", "Expected roof-array PVGIS performance source.");

  assert(model.batteryControlStrategy, "Expected battery control strategy.");
  assert(model.batteryControlStrategy.strategyId === "self_consumption", "Expected standard tariff self-consumption strategy.");

  assert(model.systemCost.estimatedInstalledCost > 0, "Expected installed system cost.");

  assert(isNumber(model.annual.baselineBill), "Missing annual baseline bill.");
  assert(isNumber(model.annual.afterImportAndStanding), "Missing after import bill.");
  assert(isNumber(model.annual.exportCredit), "Missing export credit.");
  assert(isNumber(model.annual.afterNetBill), "Missing annual after net bill.");
  assert(isNumber(model.annual.totalAnnualBenefit), "Missing total annual benefit.");

  assert(model.annual.baselineBill > 0, "Baseline bill should be positive.");
  assert(model.annual.totalAnnualBenefit >= 0, "Total annual benefit should not be negative.");

  assert(Array.isArray(model.monthly.baselineBill), "Monthly baseline bill should be an array.");
  assert(model.monthly.baselineBill.length === 12, "Monthly baseline should have 12 values.");

  assert(model.payback, "Missing payback section.");
  assert(model.payback.lifetimeYears === 25, "Expected 25-year lifetime.");
  assert(model.confidence, "Missing financial confidence.");

  console.log("  ✓ Standard financial OK:", {
    installedCost: model.systemCost.estimatedInstalledCost,
    annualBenefit: model.annual.totalAnnualBenefit,
    strategyId: model.batteryControlStrategy.strategyId,
    simplePaybackYears: model.payback.simplePaybackYears,
    confidence: model.confidence.level,
  });
}

function runOvernightControlFinancialTest() {
  console.log("\n▶ Overnight tariff candidate financial model");

  const candidate = buildDesignCandidateFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
      tariffBefore: {
        tariffType: "standard",
        importPrice: 0.28,
        standingChargePerDay: 0.6,
      },
      tariffAfter: {
        tariffType: "overnight",
        importDay: 0.30,
        importNight: 0.09,
        nightStartHour: 0,
        nightEndHour: 5,
        standingChargePerDay: 0.6,
        segPrice: 0.12,
      },
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 10,
        },
      ],
    },
  });

  const model = candidate.financialModel;

  assert(model.mode === "candidate_hourly_financial_model_beta", "Expected active financial model.");
  assert(model.batteryControlStrategy, "Expected battery control strategy.");
  assert(model.batteryControlStrategy.strategyId === "timed_grid_charge", "Expected timed grid charge strategy.");
  assert(model.batteryControlStrategy.dispatch.allowGridCharge === true, "Expected grid charging enabled.");
  assert(model.tariff.after.tariffType === "overnight", "Expected overnight tariff.");

  console.log("  ✓ Overnight financial OK:", {
    strategyId: model.batteryControlStrategy.strategyId,
    allowGridCharge: model.batteryControlStrategy.dispatch.allowGridCharge,
    annualBenefit: model.annual.totalAnnualBenefit,
  });
}

function runUnavailableFinancialTest() {
  console.log("\n▶ Unavailable candidate financial model");

  const candidate = buildDesignCandidateFromInputs({
    input: {
      panelOption: "value",
      batteryKWh: 5,
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 10,
        },
      ],
    },
  });

  const model = candidate.financialModel;

  assert(model, "Candidate missing financialModel.");
  assert(model.mode === "candidate_financial_model_unavailable", "Expected unavailable financial model.");
  assert(model.source === "financial_data_unavailable", "Expected unavailable financial source.");
  assert(model.confidence.level === "unavailable", "Expected unavailable confidence.");
  assert(model.annual.totalAnnualBenefit === 0, "Unavailable benefit should be zero.");

  console.log("  ✓ Unavailable financial OK:", {
    mode: model.mode,
    reason: model.confidence.reason,
  });
}

function main() {
  console.log("Running design candidate financial tests");

  runStandardFinancialTest();
  runOvernightControlFinancialTest();
  runUnavailableFinancialTest();

  console.log("\n✅ Design candidate financial tests passed");
}

main();