const {
  round2,
  makeBatteryAwarePaybackAndLifetimeSeries,
  makeYearlyRowsFromPaybackSeries,
} = require("./financialService");

function sum(values = []) {
  return Array.isArray(values)
    ? values.reduce((total, value) => total + Number(value || 0), 0)
    : 0;
}

function buildBatteryScenario({
  batteryKWhUsable,
  candidateBaseQuote,
  billing,
  monthly,
  monthlyLoadKWh = [],
  debugWinterDay = null,
  debugSummerDay = null,
  noBatteryAnnualBenefit,
  annualSolarGenerationKWh,
  lifetimeYears = 25,
  panelOption = "",
  energyInflationRate = 0.06,
  batteryDegradationRate = 0.02,
  minBatteryCapacityFraction = 0.7,
}) {
  if (!candidateBaseQuote || !billing || !monthly) {
    return null;
  }

  const priceLow = Number(candidateBaseQuote.priceLow || 0);
  const priceHigh = Number(candidateBaseQuote.priceHigh || 0);
  const priceMid = (priceLow + priceHigh) / 2;

  const annualBillSavings = Math.max(
    0,
    round2(
      Number(billing.annualBaseline || 0) -
        Number(billing.annualAfterImportAndStanding || 0)
    )
  );

  const annualSegIncome = round2(
    Number(billing.annualExportCredit || 0)
  );

  const totalAnnualBenefit = round2(
    annualBillSavings + annualSegIncome
  );

  const payback =
    makeBatteryAwarePaybackAndLifetimeSeries({
      systemCostMid: priceMid,
      noBatteryAnnualBenefit: Number(
        noBatteryAnnualBenefit || 0
      ),
      candidateAnnualBenefit: totalAnnualBenefit,
      years: lifetimeYears,
      panelOption,
      energyInflationRate,
      batteryDegradationRate,
      minBatteryCapacityFraction,
    });

  payback.yearly = makeYearlyRowsFromPaybackSeries({
    paybackSeries: payback,
    annualBaselineY1: Number(
      billing.annualBaseline || 0
    ),
    annualSolarGenerationKWh: Number(
      annualSolarGenerationKWh || 0
    ),
    panelOption,
    energyInflationRate,
  });

  const monthlyFinancials = {
    ...billing,

    annualBaseline: round2(
      Number(billing.annualBaseline || 0)
    ),

    annualSystemBeforeSEG: round2(
      Number(
        billing.annualAfterImportAndStanding || 0
      )
    ),

    annualExportCredit: round2(
      Number(billing.annualExportCredit || 0)
    ),

    annualSystemNet: round2(
      Number(billing.annualAfterNet || 0)
    ),

    annualSystem: round2(
      Number(billing.annualAfterNet || 0)
    ),
  };

  return {
    batteryKWhUsable: Number(
      batteryKWhUsable || 0
    ),

    priceLow,
    priceHigh,
    priceMid: round2(priceMid),

    annualBillSavings,
    annualSegIncome,
    totalAnnualBenefit,

    simplePaybackYears:
      payback.paybackYear ?? null,

    lifetimeYears,
    lifetimeNetSavings: Math.round(
      Number(payback.lifetimeSavings || 0)
    ),

    annualSelfUsedKWh: Math.round(
      sum(monthly.selfUsed)
    ),

    annualExportedKWh: Math.round(
      sum(monthly.exported)
    ),

    annualImportedKWh: Math.round(
      sum(monthly.imported)
    ),

    financialSeries: {
      monthly: monthlyFinancials,
      payback,
    },

    hourlyModel: {
      monthlyGenerationKWh:
        monthly.generation || [],

      monthlySelfUsedKWh:
        monthly.selfUsed || [],

      monthlyExportedKWh:
        monthly.exported || [],

      monthlyImportedKWh:
        monthly.imported || [],

      monthlyBatteryChargeKWh:
        monthly.batteryCharge || [],

      monthlyBatteryDischargeKWh:
        monthly.batteryDischarge || [],

      monthlyBatteryChargeFromPVKWh:
        monthly.batteryChargeFromPV || [],

      monthlyBatteryChargeFromGridKWh:
        monthly.batteryChargeFromGrid || [],

      monthlyBatteryDischargeFromPVToLoadKWh:
        monthly.batteryDischargeFromPVToLoad || [],

      monthlyBatteryDischargeFromGridToLoadKWh:
        monthly.batteryDischargeFromGridToLoad || [],

      monthlyPVExportedDirectKWh:
        monthly.pvExportDirect || [],

      monthlyLoadKWh:
        monthlyLoadKWh || [],

      debugWinterDay,
      debugSummerDay,
    },
  };
}

module.exports = {
  buildBatteryScenario,
};
