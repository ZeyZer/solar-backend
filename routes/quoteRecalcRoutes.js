const {
  attachQuoteEngineVersion,
} = require("../config/calculationVersions");

const express = require("express");

const { CONFIG } = require("../config/quoteConfig");

const {
  getBatteryModelAssumptions,
} = require("../config/batteryModelConfig");

const {
  getTariffModelAssumptions,
} = require("../config/tariffPresets");

const {
  buildTariffWarnings,
} = require("../services/tariffWarningService");

const {
  getHardwareCatalogForQuote,
} = require("../services/hardwareCatalogService");

const {
  normalizeTariff,
  isRetailRateTariff,
  computeHourlyBilling,
} = require("../services/tariffService");

const {
  round2,
  solarDegradationMultiplier,
  makePaybackAndLifetimeSeries,
  makeBatteryAwarePaybackAndLifetimeSeries,
  makeYearlyRowsFromPaybackSeries,
} = require("../services/financialService");

const {
  simulateHourByHour,
} = require("../services/batterySimulationService");

const {
  extractDaySlice,
} = require("../services/hourlyDebugService");

const {
  calculateQuote,
} = require("../services/quoteBaseService");

const {
  buildBatteryRecommendations,
} = require("../services/batteryRecommendationService");

const router = express.Router();

router.post("/recalc", async (req, res) => {
  try {
    const { quote, tariffBefore, tariffAfter, input, batteryRecommendationLifetimeYears } = req.body || {};

    const batteryModelAssumptions = getBatteryModelAssumptions();
    const tariffModelAssumptions = getTariffModelAssumptions();
    const hardwareCatalog = quote?.hardwareCatalog || getHardwareCatalogForQuote();

    if (!quote) return res.status(400).json({ error: "Missing quote." });

    const recommendationLifetimeYears =
      Number.isFinite(Number(batteryRecommendationLifetimeYears)) &&
      Number(batteryRecommendationLifetimeYears) > 0
        ? Number(batteryRecommendationLifetimeYears)
        : 25;

    const hm = quote?.hourlyModel;
    if (!hm) return res.status(400).json({ error: "Missing hourlyModel on quote." });

    const pv = hm._pvHourlyKWh;
    const load = hm._loadHourlyKWh;
    const monthIdx = hm._monthIdx;
    const hourOfDay = hm._hourOfDay;

    if (!Array.isArray(pv) || !Array.isArray(load) || !Array.isArray(monthIdx) || !Array.isArray(hourOfDay)) {
      return res.status(400).json({ error: "Quote missing hourly arrays for tariff recalculation." });
    }

    // -----------------------
    // 1) Normalize tariffs
    // -----------------------
    const tb = normalizeTariff(
      tariffBefore || quote?.tariffBefore || {},
      "before"
    );
    const ta = normalizeTariff(
      tariffAfter || quote?.tariffAfter || quote?.tariff || {},
      "after"
    );

    const retail = isRetailRateTariff(ta);

    // -----------------------
    // 2) Re-simulate hourly with toggles (NO PVGIS)
    // -----------------------
    const sim = simulateHourByHour({
      pvHourlyKWh: pv,
      loadHourlyKWh: load,
      monthIdx,
      hourOfDay,
      batteryKWh: Number(hm?._batteryKWh || 0),

      tariff: ta,
      dispatchMode: retail ? "retail_rate" : "self_consumption",

      // these MUST respect toggles
      allowGridCharge: retail && !!ta.allowGridCharging,
      allowEnergyTrading: retail && !!ta.allowEnergyTrading,

      exportFromBatteryEnabled: !!ta.exportFromBatteryEnabled,
      batteryModelAssumptions,
    });

    if (!sim?.hourly?.importKWh || !sim?.hourly?.exportKWh) {
      return res.status(500).json({ error: "Recalc simulation did not return hourly flows." });
    }

    // -----------------------
    // 3) Hourly billing (baseline + after)
    // -----------------------
    const billing = computeHourlyBilling({
      loadKWh: load,
      importKWh: sim.hourly.importKWh,
      exportKWh: sim.hourly.exportKWh,
      hourOfDay,
      monthIdx,
      tariffBefore: tb,
      tariffAfter: ta,
    });

    const annualBillSavings = Math.max(
      0,
      round2(Number(billing.annualBaseline || 0) - Number(billing.annualAfterImportAndStanding || 0))
    );
    const annualSegIncome = round2(Number(billing.annualExportCredit || 0));
    const totalAnnualBenefit = round2(annualBillSavings + annualSegIncome);

    // -----------------------
    // 4) Payback + yearly table (this drives your charts)
    // -----------------------
    const midPrice = (Number(quote.priceLow || 0) + Number(quote.priceHigh || 0)) / 2;
    const simplePaybackYears =
      totalAnnualBenefit > 0 ? Number((midPrice / totalAnnualBenefit).toFixed(1)) : null;

    const payback = makePaybackAndLifetimeSeries({
      systemCostMid: midPrice,
      annualBenefit: totalAnnualBenefit,
      years: recommendationLifetimeYears,
      panelOption: quote?.panelOption || "",
      energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
    });

    // yearly table used by “cumulative savings” etc
    {
      const inflationRate = Number(CONFIG.energyInflationRate || 0.06);
      const years = 25;

      const annualBaselineY1 = Number(billing.annualBaseline || 0);
      const annualAfterY1 = Number(billing.annualAfterNet || 0); // after net = after import+standing - export credit
      const year1Savings = annualBaselineY1 - annualAfterY1;

      // use the simulated annual generation (or fallback)
      const annualSolarGen = Math.round(
        (sim?.monthly?.generation || []).reduce((s, v) => s + Number(v || 0), 0) ||
        (quote?.estAnnualGenerationKWh || 0) ||
        0
      );

      const yearly = [];
      let cumulative = 0;

      for (let y = 1; y <= years; y++) {
        const m = Math.pow(1 + inflationRate, y - 1);
        const d = solarDegradationMultiplier(y, quote?.panelOption || "");

        const billBefore = annualBaselineY1 * m;
        const billSavings = year1Savings * m * d;
        const billAfter = billBefore - billSavings;

        cumulative += billSavings;

        yearly.push({
          year: y,
          solarGenerationKWh: Math.round(annualSolarGen * d),
          billBefore: round2(billBefore),
          billAfter: round2(billAfter),
          billSavings: round2(billSavings),
          cumulativeSavings: round2(cumulative),
          netPosition: round2(cumulative - Number(payback.systemCostMid || 0)),
        });
      }

      payback.yearly = yearly;
    }

    // -----------------------
    // 5) Debug day slices so graphs refresh instantly
    //    IMPORTANT: choose the same kind of “representative” days as /api/quote
    // -----------------------
    function pickDayStartBest(targetMonth, scoreFn) {
      let bestStart = 0;
      let bestScore = -Infinity;

      for (let start = 0; start <= monthIdx.length - 24; start += 24) {
        if (monthIdx[start] !== targetMonth) continue;

        let score = 0;
        for (let j = 0; j < 24; j++) score += scoreFn(start + j);

        if (score > bestScore) {
          bestScore = score;
          bestStart = start;
        }
      }

      return bestStart;
    }

    // Match /api/quote behaviour:
    // - Winter: Jan (0) day showing the MOST grid charging (if present)
    // - Summer: Jun (5) day showing the MOST PV generation
    const winterStart = pickDayStartBest(0, (idx) => Number(sim.hourly.battChargeFromGridKWh?.[idx] || 0));
    const summerStart = pickDayStartBest(5, (idx) => Number(sim.hourly.pvKWh?.[idx] || 0));

    const debugWinterDay = extractDaySlice(sim.hourly, winterStart);
    const debugSummerDay = extractDaySlice(sim.hourly, summerStart);


    // -----------------------
    // 6) Battery recommendations (fast enough, no PVGIS)
    //    Uses the same single 8760 arrays on the quote.
    // -----------------------
    const MAX_BAT = batteryModelAssumptions.recommendationMaxBatteryKWh;
    const STEP = batteryModelAssumptions.recommendationStepKWh;
    const MIN_RECOMMENDED_BAT = batteryModelAssumptions.recommendationMinBatteryKWh;

    const curve = [];
    for (let b = 0; b <= MAX_BAT; b += STEP) {
      const simB = simulateHourByHour({
        pvHourlyKWh: pv,
        loadHourlyKWh: load,
        monthIdx,
        hourOfDay,
        batteryKWh: b,
        tariff: ta,
        dispatchMode: retail ? "retail_rate" : "self_consumption",
        allowGridCharge: retail && !!ta.allowGridCharging,
        allowEnergyTrading: retail && !!ta.allowEnergyTrading,
        exportFromBatteryEnabled: !!ta.exportFromBatteryEnabled,
        batteryModelAssumptions,
      });

      const billingB = computeHourlyBilling({
        loadKWh: load,
        importKWh: simB.hourly.importKWh,
        exportKWh: simB.hourly.exportKWh,
        hourOfDay,
        monthIdx,
        tariffBefore: tb,
        tariffAfter: ta,
      });

      const benefitB =
        Math.max(0, (billingB.annualBaseline || 0) - (billingB.annualAfterImportAndStanding || 0)) +
        (billingB.annualExportCredit || 0);

      const candidateInput = {
        ...input,
        batteryCapacity: b,
        batteryKWh: b,
        roofs: input?.roofs || [],
        extras: input?.extras || {},
        panelOption: input?.panelOption || quote?.panelOption || "value",
        annualKWh: input?.annualKWh || quote?.assumedAnnualConsumptionKWh || 0,
        occupancyProfile: input?.occupancyProfile || "half_day",
      };

      const annualGenerationForCandidate = Math.round(
        (simB?.monthly?.generation || []).reduce((s, v) => s + Number(v || 0), 0)
      );

      const candidateBaseQuote = calculateQuote(candidateInput, {
        annualGenerationOverrideKWh: annualGenerationForCandidate,
        silent: true,
      });

      const candidateMidPrice = (candidateBaseQuote.priceLow + candidateBaseQuote.priceHigh) / 2;

      const pb = makePaybackAndLifetimeSeries({
        systemCostMid: candidateMidPrice,
        annualBenefit: benefitB,
        years: recommendationLifetimeYears,
        panelOption: input?.panelOption || quote?.panelOption || "",
        energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
      });

      const annualSelf = Math.round((simB?.monthly?.selfUsed || []).reduce((s, v) => s + Number(v || 0), 0));
      const annualExp = Math.round((simB?.monthly?.exported || []).reduce((s, v) => s + Number(v || 0), 0));
      const annualImp = Math.round((simB?.monthly?.imported || []).reduce((s, v) => s + Number(v || 0), 0));
      const lifetimeNetSavings = Math.round(Number(pb.lifetimeSavings || 0));
      const lifetimeGrossBenefit = Math.round(lifetimeNetSavings + candidateMidPrice);

      curve.push({
        batteryKWhUsable: b,
        annualBenefit: Math.round(benefitB),
        paybackYears: pb.paybackYear,
        annualSelfUsedKWh: Math.round((simB?.monthly?.selfUsed || []).reduce((s, v) => s + Number(v || 0), 0)),
        annualExportedKWh: Math.round((simB?.monthly?.exported || []).reduce((s, v) => s + Number(v || 0), 0)),
        annualImportedKWh: Math.round((simB?.monthly?.imported || []).reduce((s, v) => s + Number(v || 0), 0)),
        candidateMidPrice: Math.round(candidateMidPrice),
        lifetimeYears: recommendationLifetimeYears,
        lifetimeGrossBenefit: Math.round(Number(pb.lifetimeSavings || 0) + candidateMidPrice),
        lifetimeNetSavings: Math.round(Number(pb.lifetimeSavings || 0)),
      });
    }

    const selectedBatteryKWh = Number(
      hm?._batteryKWh ??
      input?.batteryKWh ??
      quote?.batteryKWh ??
      0
    );

    const batteryCostPerKWh = batteryModelAssumptions.batteryCostPerKWh;

    const batteryRecommendations = buildBatteryRecommendations({
      curve,
      batteryCostPerKWh,
      selectedBatteryKWh,
      minRecommendedBatteryKWh: MIN_RECOMMENDED_BAT,
      maxBatteryKWh: MAX_BAT,
      stepKWh: STEP,
      lifetimeYears: recommendationLifetimeYears,
      panelOption: input?.panelOption || quote?.panelOption || "",
      energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
      batteryDegradationRate: batteryModelAssumptions.degradationRate,
      minBatteryCapacityFraction: batteryModelAssumptions.minCapacityFraction,
      batteryModelAssumptions,
    });

    const noBatteryAnnualBenefitRaw =
      batteryRecommendations?.noBatteryComparison?.noBattery?.annualBenefit;

    const noBatteryAnnualBenefitForPayback = Number.isFinite(
      Number(noBatteryAnnualBenefitRaw)
    )
      ? Number(noBatteryAnnualBenefitRaw)
      : Number(totalAnnualBenefit || 0);

    const batteryAwarePayback = makeBatteryAwarePaybackAndLifetimeSeries({
      systemCostMid: midPrice,
      noBatteryAnnualBenefit: noBatteryAnnualBenefitForPayback,
      candidateAnnualBenefit: Number(totalAnnualBenefit || 0),
      years: recommendationLifetimeYears,
      panelOption: input?.panelOption || quote?.panelOption || "",
      energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
      batteryDegradationRate: batteryModelAssumptions.degradationRate,
      minBatteryCapacityFraction: batteryModelAssumptions.minCapacityFraction,
    });

    const annualSolarGenForBatteryAwarePayback = Math.round(
      (sim?.monthly?.generation || []).reduce(
        (sum, value) => sum + Number(value || 0),
        0
      ) ||
        Number(quote?.estAnnualGenerationKWh || 0) ||
        0
    );

    batteryAwarePayback.yearly = makeYearlyRowsFromPaybackSeries({
      paybackSeries: batteryAwarePayback,
      annualBaselineY1: Number(billing?.annualBaseline || 0),
      annualSolarGenerationKWh: annualSolarGenForBatteryAwarePayback,
      panelOption: input?.panelOption || quote?.panelOption || "",
      energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
    });

    const batteryAwareSimplePaybackYears =
      batteryAwarePayback.paybackYear ?? simplePaybackYears;

    // -----------------------
    // 7) Return updated quote
    // -----------------------
    const tariffWarnings = buildTariffWarnings({
      tariffBefore: tb,
      tariffAfter: ta,
      tariffModelAssumptions,
    });

    const updated = {
      ...quote,

      tariffBefore: tb,
      tariffAfter: ta,
      tariff: ta,
      tariffModelAssumptions,
      tariffWarnings,
      hardwareCatalog,
      hardwareCatalogVersion: hardwareCatalog.version,

      annualBillSavings,
      annualSegIncome,
      totalAnnualBenefit,
      simplePaybackYears: batteryAwareSimplePaybackYears,

      financialSeries: {
        monthly: {
          // keep anything else you already use from billing (optional)
          ...billing,

          // ✅ explicitly provide the fields the UI expects
          annualBaseline: round2(Number(billing.annualBaseline || 0)),
          annualSystemBeforeSEG: round2(Number(billing.annualAfterImportAndStanding || 0)),
          annualExportCredit: round2(Number(billing.annualExportCredit || 0)),

          // net = import+standing - export credit
          annualSystemNet: round2(
            Number(billing.annualAfterImportAndStanding || 0) - Number(billing.annualExportCredit || 0)
          ),

          // ✅ UI alias (some parts of your UI use annualSystem)
          annualSystem: round2(
            Number(billing.annualAfterImportAndStanding || 0) - Number(billing.annualExportCredit || 0)
          ),
        },
        payback: batteryAwarePayback,
      },
      
      batteryRecommendations,
      
      hourlyModel: {
        ...hm,

        monthlyGenerationKWh: sim.monthly.generation,
        monthlySelfUsedKWh: sim.monthly.selfUsed,
        monthlyExportedKWh: sim.monthly.exported,
        monthlyImportedKWh: sim.monthly.imported,

        monthlyBatteryChargeKWh: sim.monthly.batteryCharge,
        monthlyBatteryDischargeKWh: sim.monthly.batteryDischarge,

        // NEW: source-aware monthly battery flow fields
        monthlyBatteryChargeFromPVKWh: sim.monthly.batteryChargeFromPV,
        monthlyBatteryChargeFromGridKWh: sim.monthly.batteryChargeFromGrid,
        monthlyBatteryDischargeFromPVToLoadKWh: sim.monthly.batteryDischargeFromPVToLoad,
        monthlyBatteryDischargeFromGridToLoadKWh: sim.monthly.batteryDischargeFromGridToLoad,

        // NEW: direct PV export at generation time
        monthlyPVExportedDirectKWh: sim.monthly.pvExportDirect,

        // KEEP / PRESERVE the household demand profile
        monthlyLoadKWh: hm.monthlyLoadKWh,

        debugWinterDay,
        debugSummerDay,
      },
    };

    res.json(attachQuoteEngineVersion(updated));
  } catch (e) {
    console.error("recalc error:", e);
    return res.status(500).json({ error: e?.message || "Failed to recalculate." });
  }
});

module.exports = router;
