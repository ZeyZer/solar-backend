//===================
// Main Quote Route
//===================

const express = require("express");

const { CONFIG } = require("../config/quoteConfig");

const {
  validateAndNormalisePostcode,
} = require("../utils/postcodeUtils");

const {
  calculateQuote,
} = require("../services/quoteBaseService");

const {
  averageHourlyArrays,
  averageMonthlyArrays,
  sum12,
} = require("../utils/arrayUtils");

const {
  getLatLonFromUkPostcode,
  getTotalPvgisHourlySeries,
  runHourlyModelForYear,
  getTotalPvgisAnnualKWh,
} = require("../services/pvgisService");

const {
  normalizeTariff,
  isRetailRateTariff,
  computeHourlyBilling,
} = require("../services/tariffService");

const {
  buildDailyUsageProfile,
} = require("../services/loadProfileService");

const {
  round2,
  solarDegradationMultiplier,
  makePaybackAndLifetimeSeries,
} = require("../services/financialService");

const {
  simulateHourByHour,
} = require("../services/batterySimulationService");

const {
  buildBatteryRecommendations,
} = require("../services/batteryRecommendationService");

const {
  extractDaySlice,
} = require("../services/hourlyDebugService");

const {
  readLeads,
  saveLeads,
} = require("../services/leadStorageService");

const {
  estimateSelfConsumptionAndSavings,
  getMcsRoofGroupData,
} = require("../services/selfConsumptionService");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const input = req.body || {};

    // ==============================
    // Tariffs: BEFORE vs AFTER (define ONCE, early)
    // ==============================
    const energyInflationRate = Number(CONFIG.energyInflationRate || 0.06);

    const tariffBefore = input?.tariffBefore || {
      tariffType: "standard",
      importPrice: Number(CONFIG.assumedPricePerKWh || 0.29),
      standingChargePerDay: Number(CONFIG.standingChargePerDay || 0.60),
    };

    const tariffAfter = input?.tariffAfter || input?.tariff || {
      tariffType: "standard",
      importPrice: Number(CONFIG.assumedPricePerKWh || 0.29),
      standingChargePerDay: Number(CONFIG.standingChargePerDay || 0.60),
      segPrice: Number(CONFIG.assumedSegPricePerKWh || 0.15),
    };
    
    const importPriceBefore = Number(tariffBefore.importPrice || CONFIG.assumedPricePerKWh || 0.29);

    // For “after solar”, import/export can be TOU; these are fallback values
    const importPriceAfter = Number(tariffAfter.importPrice || CONFIG.assumedPricePerKWh || 0.29);
    const segPriceAfter = Number(tariffAfter.segPrice || CONFIG.assumedSegPricePerKWh || 0.15);

    const standingChargePerDayAfter = Number(
      tariffAfter.standingChargePerDay ?? CONFIG.standingChargePerDay ?? 0.60
    );

    console.log("Received quote request with input:", input);

    // ✅ Normalise panelOption no matter what arrives
    input.panelOption = input.panelOption || input.PanelOption || "value";
    delete input.PanelOption;

    // ✅ Normalise postcode
    try {
      input.postcode = validateAndNormalisePostcode(input.postcode);
    } catch (addrErr) {
      console.warn("Postcode validation failed:", addrErr.message);
      return res.status(400).json({ error: addrErr.message });
    }

    const houseNumber = (input.houseNumber || "").trim();
    if (!houseNumber) {
      return res.status(400).json({ error: "House number / name is required." });
    }

    // ✅ Determine panel wattage from panel option (single source of truth)
    const panelOpt = CONFIG.panelOptions[input.panelOption] || CONFIG.panelOptions.value;
    const panelWatt = panelOpt.watt;

    // Prices (use user tariff if provided, otherwise fallback to CONFIG)
    const userTariff = input.tariff || {};


    // PVGIS outputs
    let pvgisAnnualKWh = null;
    let hourlyModel = null;

    // ------------------------------
    // 1) Try PVGIS HOURLY simulation (3-year average)
    // ------------------------------
    let hourlyYearData = null; // keep in outer scope for later use
    try {
      if (input.postcode && Array.isArray(input.roofs) && input.roofs.length > 0) {
        const years = [2021, 2022, 2023];

        const results = [];
        for (const y of years) {
          console.log(`Running PVGIS hourly simulation for year ${y}...`);
          const r = await runHourlyModelForYear({
            input,
            panelWatt,
            year: y,
            includeHourlyArrays: true,
          });
          results.push(r);
        }

        // ---- Monthly averages (for UI cards) ----
        const avgMonthlyGeneration   = averageMonthlyArrays(results.map(r => r.monthlyGenerationKWh));
        const avgMonthlySelfUsed     = averageMonthlyArrays(results.map(r => r.monthlySelfUsedKWh));
        const avgMonthlyExported     = averageMonthlyArrays(results.map(r => r.monthlyExportedKWh));
        const avgMonthlyImported     = averageMonthlyArrays(results.map(r => r.monthlyImportedKWh));
        const avgMonthlyBattCharge   = averageMonthlyArrays(results.map(r => r.monthlyBatteryChargeKWh));
        const avgMonthlyBattDischarge= averageMonthlyArrays(results.map(r => r.monthlyBatteryDischargeKWh));
        const avgMonthlyDirect       = averageMonthlyArrays(results.map(r => r.monthlyDirectToHomeKWh));
        const avgMonthlyBattChargeFromPV = averageMonthlyArrays(results.map(r => r.monthlyBatteryChargeFromPVKWh));
        const avgMonthlyBattDischargeFromPVToLoad = averageMonthlyArrays(results.map(r => r.monthlyBatteryDischargeFromPVToLoadKWh));
        const avgMonthlyBattDischargeFromGridToLoad = averageMonthlyArrays(results.map(r => r.monthlyBatteryDischargeFromGridToLoadKWh));
        const avgMonthlyPVExportDirect = averageMonthlyArrays(results.map(r => r.monthlyPVExportedDirectKWh));

        const avgAnnualGeneration = Math.round(sum12(avgMonthlyGeneration));
        pvgisAnnualKWh = avgAnnualGeneration;

        // ---- Canonical 8760 arrays used for ALL downstream calcs (recalc + battery recs) ----
        // Average PV across the 3 years; use load/monthIdx/hourOfDay from year[0] (they should align)
        const base = results[0];

        const avgPv8760 = averageHourlyArrays(results.map(r => r._pvHourlyKWh));
        const load8760  = base._loadHourlyKWh;
        const monthIdx8760 = base._monthIdx;
        const hod8760 = base._hourOfDay || (Array.isArray(avgPv8760) ? avgPv8760.map((_, i) => i % 24) : null);

        // Defensive checks (prevents silent weird graphs)
        if (!Array.isArray(avgPv8760) || avgPv8760.length !== 8760) throw new Error("avgPv8760 missing/invalid");
        if (!Array.isArray(load8760)  || load8760.length  !== 8760) throw new Error("load8760 missing/invalid");
        if (!Array.isArray(monthIdx8760) || monthIdx8760.length !== 8760) throw new Error("monthIdx8760 missing/invalid");
        if (!Array.isArray(hod8760) || hod8760.length !== 8760) throw new Error("hod8760 missing/invalid");

        // Store one “averaged year” record for downstream functions expecting hourlyYearData[0]
        hourlyYearData = [{
          year: "avg_2021_2023",
          pvHourlyKWh: avgPv8760,
          loadHourlyKWh: load8760,
          monthIdx: monthIdx8760,
          hourOfDay: hod8760,
        }];

        hourlyModel = {
          model: "hourly_pvgis_3yr_avg_2021_2023",
          years,
          monthlyGenerationKWh: avgMonthlyGeneration,
          monthlySelfUsedKWh: avgMonthlySelfUsed,
          monthlyExportedKWh: avgMonthlyExported,
          monthlyImportedKWh: avgMonthlyImported,

          monthlyBatteryChargeKWh: avgMonthlyBattCharge,
          monthlyBatteryDischargeKWh: avgMonthlyBattDischarge,
          monthlyBatteryChargeFromPVKWh: avgMonthlyBattChargeFromPV,
          monthlyBatteryDischargeFromPVToLoadKWh: avgMonthlyBattDischargeFromPVToLoad,
          monthlyBatteryDischargeFromGridToLoadKWh: avgMonthlyBattDischargeFromGridToLoad,
          monthlyPVExportedDirectKWh: avgMonthlyPVExportDirect,

          monthlyDirectToHomeKWh: avgMonthlyDirect,
          annualGenerationKWh: avgAnnualGeneration,
          annualSelfUsedKWh: Math.round(sum12(avgMonthlySelfUsed)),
          annualExportedKWh: Math.round(sum12(avgMonthlyExported)),
          annualImportedKWh: Math.round(sum12(avgMonthlyImported)),

          // IMPORTANT: attach the canonical 8760 arrays so /recalc uses the SAME inputs
          _pvHourlyKWh: avgPv8760,
          _loadHourlyKWh: load8760,
          _monthIdx: monthIdx8760,
          _hourOfDay: hod8760,
          _batteryKWh: Number(input.batteryKWh || 0),
        };

        console.log("3-year average annual PV kWh:", pvgisAnnualKWh);
      }
    } catch (e) {
      console.warn("PVGIS hourly 3-year simulation failed, falling back to PVcalc annual:", e.message);
      pvgisAnnualKWh = null;
      hourlyModel = null;
      hourlyYearData = null;
    }


    // ------------------------------
    // 2) If hourly didn't work, try PVGIS annual (existing method)
    // ------------------------------
    if (pvgisAnnualKWh === null) {
      try {
        if (input.postcode && Array.isArray(input.roofs) && input.roofs.length > 0) {
          pvgisAnnualKWh = await getTotalPvgisAnnualKWh({
            postcode: input.postcode,
            roofs: input.roofs,
            panelWatt,
          });
          console.log("PVGIS annual kWh (sum of roofs):", pvgisAnnualKWh);
        }
      } catch (e) {
        console.warn("PVGIS lookup failed, using fallback generation:", e.message);
        pvgisAnnualKWh = null;
      }
    }

    console.log("Incoming roofs:", input.roofs);

    // ------------------------------
    // 3) Base quote + fallback self-consumption/savings
    // ------------------------------
    const baseQuote = calculateQuote(input, {
      annualGenerationOverrideKWh: pvgisAnnualKWh,
    });

    const savings = estimateSelfConsumptionAndSavings(input, baseQuote);
    const quote = {
      ...baseQuote,
      ...savings,

      // ✅ store both
      tariffBefore: input.tariffBefore || null,
      tariffAfter: input.tariffAfter || input.tariff || null,

      // ✅ keep backward compatibility with your existing QuotePage UI
      tariff: input.tariffAfter || input.tariff || null,
    };


    const midPrice = (quote.priceLow + quote.priceHigh) / 2;
    const selectedBatteryUsable = Math.max(0, Number(input.batteryKWh || 0)); // user-entered is usable kWh

    // ------------------------------
    // 4) If hourlyModel exists, prefer it for savings + monthly financial charts
    // ------------------------------
    if (
      hourlyModel &&
      Array.isArray(hourlyModel.monthlyImportedKWh) &&
      hourlyModel.monthlyImportedKWh.length === 12 &&
      Array.isArray(hourlyModel.monthlyExportedKWh) &&
      hourlyModel.monthlyExportedKWh.length === 12 &&
      Array.isArray(hourlyModel.monthlySelfUsedKWh) &&
      hourlyModel.monthlySelfUsedKWh.length === 12
    ) {

      // Attach hourlyModel to quote ONCE
      quote.hourlyModel = hourlyModel;

      // Canonical averaged 8760 arrays for ALL downstream calcs
      const pv8760   = hourlyModel._pvHourlyKWh;
      const load8760 = hourlyModel._loadHourlyKWh;
      const mIdx8760 = hourlyModel._monthIdx;
      const hod8760  = hourlyModel._hourOfDay;

      if (!Array.isArray(pv8760)   || pv8760.length   !== 8760) throw new Error("hourlyModel._pvHourlyKWh missing/invalid");
      if (!Array.isArray(load8760) || load8760.length !== 8760) throw new Error("hourlyModel._loadHourlyKWh missing/invalid");
      if (!Array.isArray(mIdx8760) || mIdx8760.length !== 8760) throw new Error("hourlyModel._monthIdx missing/invalid");
      if (!Array.isArray(hod8760)  || hod8760.length  !== 8760) throw new Error("hourlyModel._hourOfDay missing/invalid");

      // Monthly household demand: load = selfUsed + imported
      const monthlyLoadKWh = Array(12).fill(0);
      for (let i = 0; i < load8760.length; i++) {
        const m = Number(mIdx8760[i] || 0);
        monthlyLoadKWh[m] += Number(load8760[i] || 0);
      }
      for (let m = 0; m < 12; m++) {
        monthlyLoadKWh[m] = round2(monthlyLoadKWh[m]);
      }

      quote.hourlyModel.monthlyLoadKWh = monthlyLoadKWh;

      // ===============================
      // Re-simulate hourly with tariff-aware dispatch (overnight/flux)
      // ===============================
      const tb = normalizeTariff(input.tariffBefore || {}, "before");
      const ta = normalizeTariff((input.tariffAfter || input.tariff || {}), "after");
      const retail = isRetailRateTariff(ta);

      let simTariff = null;

      simTariff = simulateHourByHour({
        pvHourlyKWh: pv8760,
        loadHourlyKWh: load8760,
        monthIdx: mIdx8760,
        hourOfDay: hod8760,

        batteryKWh: Number(input.batteryKWh || 0),

        tariff: ta,
        dispatchMode: retail ? "retail_rate" : "self_consumption",

        allowGridCharge: retail && !!ta.allowGridCharging,
        allowEnergyTrading: retail && !!ta.allowEnergyTrading,
        exportFromBatteryEnabled: retail && !!ta.exportFromBatteryEnabled,
      });

      quote.hourlyModel = {
        ...hourlyModel,

        // Use tariff-aware re-simulated monthly outputs
        monthlyGenerationKWh: simTariff.monthly.generation,
        monthlySelfUsedKWh: simTariff.monthly.selfUsed,
        monthlyExportedKWh: simTariff.monthly.exported,
        monthlyImportedKWh: simTariff.monthly.imported,

        monthlyBatteryChargeKWh: simTariff.monthly.batteryCharge,
        monthlyBatteryDischargeKWh: simTariff.monthly.batteryDischarge,

        monthlyBatteryChargeFromPVKWh: simTariff.monthly.batteryChargeFromPV,
        monthlyBatteryChargeFromGridKWh: simTariff.monthly.batteryChargeFromGrid,
        monthlyBatteryDischargeFromPVToLoadKWh: simTariff.monthly.batteryDischargeFromPVToLoad,
        monthlyBatteryDischargeFromGridToLoadKWh: simTariff.monthly.batteryDischargeFromGridToLoad,
        monthlyPVExportedDirectKWh: simTariff.monthly.pvExportDirect,

        // keep monthly load from the household demand model
        monthlyLoadKWh,

        // keep canonical averaged 8760 arrays for recalc
        _pvHourlyKWh: pv8760,
        _loadHourlyKWh: load8760,
        _monthIdx: mIdx8760,
        _hourOfDay: hod8760,
        _batteryKWh: Number(input.batteryKWh || 0),
      };

      const billing = computeHourlyBilling({
        loadKWh: load8760,
        importKWh: simTariff.hourly.importKWh,
        exportKWh: simTariff.hourly.exportKWh,
        hourOfDay: hod8760,
        monthIdx: mIdx8760,
        tariffBefore: tb,
        tariffAfter: ta,
      });

      const mcsRoofGroups = await getMcsRoofGroupData({
        postcode: input.postcode,
        roofs: input.roofs,
        panelWatt,
      });

      quote.mcsRoofGroups = mcsRoofGroups;

      // ✅ Use hourly billing as single source of truth
      const annualBaseline = round2(billing.annualBaseline);
      const annualAfterImportAndStanding = round2(billing.annualAfterImportAndStanding);
      const annualExportCredit = round2(billing.annualExportCredit);

      const annualSystemNet = round2(
        annualAfterImportAndStanding - annualExportCredit
      );

      quote.financialSeries = {
        ...quote.financialSeries,
        monthly: {
          annualBaseline,
          annualSystemBeforeSEG: annualAfterImportAndStanding,
          annualExportCredit,
          annualSystemNet,

          // UI expects this alias
          annualSystem: annualSystemNet,
        },
      };

      // These are the canonical numbers now
      const annualBillSavings = Math.max(0, round2(billing.annualBaseline - billing.annualAfterImportAndStanding));
      const annualSegIncome = round2(billing.annualExportCredit);
      const totalAnnualBenefit = round2(annualBillSavings + annualSegIncome);

      quote.annualBillSavings = annualBillSavings;
      quote.annualSegIncome = annualSegIncome;
      quote.totalAnnualBenefit = totalAnnualBenefit;

      quote.simplePaybackYears =
        totalAnnualBenefit > 0 ? Number((midPrice / totalAnnualBenefit).toFixed(1)) : null;

      quote.selfConsumptionModel = "hourly";

      // Build a monthly finance object in the shape your UI already expects
      const monthlyFinance = {
        // Keep the full billing object so /api/quote matches /api/quote/recalc more closely
        ...billing,

        // Monthly fields expected by frontend tables/charts
        monthlyBaseline: billing.monthlyBaseline,
        monthlyAfterImportAndStanding: billing.monthlyAfterImportAndStanding,
        monthlyExportCredit: billing.monthlyExportCredit,
        monthlyAfterNet: billing.monthlyAfterNet,

        // Backward-compatible monthly aliases
        monthlyAfter: billing.monthlyAfterNet,
        baselineMonthlyCost: billing.monthlyBaseline,
        systemMonthlyCostBeforeSEG: billing.monthlyAfterImportAndStanding,
        exportCreditMonthly: billing.monthlyExportCredit,
        systemMonthlyNet: billing.monthlyAfterNet,

        // Annual fields expected by frontend
        annualBaseline: round2(Number(billing.annualBaseline || 0)),
        annualAfterImportAndStanding: round2(Number(billing.annualAfterImportAndStanding || 0)),
        annualExportCredit: round2(Number(billing.annualExportCredit || 0)),
        annualAfterNet: round2(Number(billing.annualAfterNet || 0)),

        // Backward-compatible annual aliases
        annualSystemBeforeSEG: round2(Number(billing.annualAfterImportAndStanding || 0)),
        annualSystemNet: round2(Number(billing.annualAfterNet || 0)),
        annualSystem: round2(Number(billing.annualAfterNet || 0)),
      };

      // ---- Debug days (24h) for visualisation ----
      try {
        const pv = quote.hourlyModel._pvHourlyKWh;
        const load = quote.hourlyModel._loadHourlyKWh;
        const monthIdx = quote.hourlyModel._monthIdx;
        const hourOfDay = quote.hourlyModel._hourOfDay;

        if (Array.isArray(pv) && Array.isArray(load) && Array.isArray(monthIdx) && Array.isArray(hourOfDay)) {
          const tAfter = tariffAfter || {};

          const simDebug = simulateHourByHour({
            pvHourlyKWh: pv,
            loadHourlyKWh: load,
            monthIdx,
            hourOfDay,
            batteryKWh: Number(input.batteryKWh || 0),

            tariff: ta,
            dispatchMode: retail ? "retail_rate" : "self_consumption",
            allowGridCharge: retail && !!ta.allowGridCharging,
            allowEnergyTrading: retail && !!ta.allowEnergyTrading,
            exportFromBatteryEnabled: retail && !!ta.exportFromBatteryEnabled,
          });

          console.log("simDebug.hourly keys:", Object.keys(simDebug.hourly || {}));
          console.log("sample hour 0:", Object.fromEntries(
            Object.entries(simDebug.hourly || {}).map(([k,v]) => [k, Array.isArray(v) ? v[0] : v])
          ));

          // Pick a “winter” day (Jan = monthIdx 0) and “summer” day (Jun = monthIdx 5)
          const pickDayStartBest = (targetMonth, scoreFn) => {
            let bestStart = 0;
            let bestScore = -Infinity;

            for (let start = 0; start <= monthIdx.length - 24; start += 24) {
              if (monthIdx[start] !== targetMonth) continue;

              let score = 0;
              for (let j = 0; j < 24; j++) {
                score += scoreFn(start + j);
              }

              if (score > bestScore) {
                bestScore = score;
                bestStart = start;
              }
            }

            return bestStart;
          };

          function pickDayStartByMedianPV(targetMonthIdx, monthIdxArr, pvArr) {
            const candidates = [];

            for (let start = 0; start <= monthIdxArr.length - 24; start += 24) {
              if (monthIdxArr[start] !== targetMonthIdx) continue;

              let pvSum = 0;
              for (let k = 0; k < 24; k++) pvSum += Math.max(0, Number(pvArr[start + k] || 0));

              candidates.push({ start, pvSum });
            }

            if (!candidates.length) return 0;

            // median PV day
            candidates.sort((a, b) => a.pvSum - b.pvSum);
            return candidates[Math.floor(candidates.length / 2)].start;
          }

          // example: Jan = 0, Jun = 5 (based on your monthIdx)
          //const winterStart = pickDayStartByMedianPV(0, monthIdx, pv);
          //const summerStart = pickDayStartByMedianPV(5, monthIdx, pv);


          // Winter: choose the Jan day with the MOST grid charging (shows overnight behaviour)
          const winterStart = pickDayStartBest(0, (idx) => Number(simDebug.hourly.battChargeFromGridKWh?.[idx] || 0));

          // Summer: choose the Jun day with the MOST PV (shows PV charging + export behaviour)
          const summerStart = pickDayStartBest(5, (idx) => Number(simDebug.hourly.pvKWh?.[idx] || 0));


          if (!Array.isArray(simDebug?.hourly?.pvKWh)) {
            throw new Error("simulateHourByHour did not return hourly.pvKWh array");
          }

          quote.hourlyModel.debugWinterDay = extractDaySlice(simDebug.hourly, winterStart);
          quote.hourlyModel.debugSummerDay = extractDaySlice(simDebug.hourly, summerStart);

          console.log("WINTER slice chargeFromGrid sum:",
            quote.hourlyModel.debugWinterDay.battChargeFromGridKWh.reduce((a,b)=>a+b,0)
          );
          console.log("WINTER slice chargeFromPV sum:",
            quote.hourlyModel.debugWinterDay.battChargeFromPVKWh.reduce((a,b)=>a+b,0)
          );
        }
      } catch (e) {
        console.warn("Debug day slice failed:", e.message);
      }

      console.log("WINTER import sum:", quote.hourlyModel.debugWinterDay.importKWh.reduce((a,b)=>a+b,0));
      console.log("WINTER gridCharge sum:", quote.hourlyModel.debugWinterDay.battChargeFromGridKWh.reduce((a,b)=>a+b,0));
      console.log("WINTER export sum:", quote.hourlyModel.debugWinterDay.exportKWh.reduce((a,b)=>a+b,0));
      console.log("WINTER dischargeToExport sum:", quote.hourlyModel.debugWinterDay.battDischargeToExportKWh.reduce((a,b)=>a+b,0));



      // ✅ Store both on quote (frontend can show “before” + “after” if different)
      quote.tariffBefore = { ...tb, importPrice: importPriceBefore, energyInflationRate };
      quote.tariffAfter = {
        ...ta,
        importPrice: importPriceAfter,
        segPrice: segPriceAfter,
        standingChargePerDay: standingChargePerDayAfter,
        energyInflationRate,
      };

      // ✅ Keep backward-compat UI field: quote.tariff = AFTER
      quote.tariff = quote.tariffAfter;

      quote.dailyUsageProfile = buildDailyUsageProfile(
        quote.assumedAnnualConsumptionKWh,
        input?.occupancyProfile || "balanced"
      );

      // Payback + lifetime series
      const payback = makePaybackAndLifetimeSeries({
        systemCostMid: midPrice,
        annualBenefit: totalAnnualBenefit,
        years: 25,
        panelOption: input.panelOption || input?.panelOption || "",
        energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
      });

      // Build a yearly table for "financial calculation details" popup
      {
        const inflationRate = Number(CONFIG.energyInflationRate || 0.06);
        const years = 25;

        const annualBaselineY1 = Number(monthlyFinance.annualBaseline || 0);
        const annualSystemY1 = Number(
          monthlyFinance.annualAfterNet ??
          monthlyFinance.annualSystemNet ??
          monthlyFinance.annualSystem ??
          0
        );

        // Use PVGIS hourly annual gen if available; fallback to estimated annual gen
        const annualSolarGen = Math.round(
          (hourlyModel?.monthlyGenerationKWh || []).reduce((s, v) => s + Number(v || 0), 0) ||
          Number(quote?.estAnnualGenerationKWh || 0) ||
          0
        );

        const yearly = [];
        let cumulative = 0;

        for (let y = 1; y <= years; y++) {
          const m = Math.pow(1 + inflationRate, y - 1);

          // Degradation based on selected panel type
          const d = solarDegradationMultiplier(y, input.panelOption || input?.panelOption || "");

          // Bills inflate with energy costs
          const billBefore = annualBaselineY1 * m;

          // Savings shrink as solar output degrades (simple projection)
          const year1Savings = (annualBaselineY1 - annualSystemY1);
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

        // Optional debug (remove later)
        console.log("✅ yearly rows:", yearly.length, "first row:", yearly[0]);
      }

      quote.financialSeries = {
        monthly: monthlyFinance,
        payback,
      };

      // ------------------------------
      // 5) Battery recommendation (fastest payback only)
      //    Uses same PV/load hours already fetched; no extra PVGIS calls
      // ------------------------------
      if (hourlyYearData && Array.isArray(hourlyYearData) && hourlyYearData.length > 0) {
        const MAX_BAT = 35;
        const STEP = 1;
        const MIN_RECOMMENDED_BAT = 2;

        // ✅ Make sure this exists in-scope
        const batteryCostPerKWh = Number(CONFIG.batteryCostPerKwh || 0);

        function simulateForBatterySizeUsable(batteryUsableKWh) {
          // 1) Run each PVGIS year with this battery, then average annual outputs
          const annualBenefits = [];
          const annualSelfUsed = [];
          const annualExported = [];
          const annualImported = [];

          // ✅ Use averaged 8760 dataset (same as recalc)

          const yd = {
            pvHourlyKWh: pv8760,
            loadHourlyKWh: load8760,
            monthIdx: mIdx8760,
            hourOfDay: hod8760,
          };

          const sim = simulateHourByHour({
            pvHourlyKWh: yd.pvHourlyKWh,
            loadHourlyKWh: yd.loadHourlyKWh,
            monthIdx: yd.monthIdx,
            hourOfDay: yd.hourOfDay,
            batteryKWh: batteryUsableKWh,

            tariff: ta,
            dispatchMode: retail ? "retail_rate" : "self_consumption",
            allowGridCharge: retail && !!ta.allowGridCharging,
            allowEnergyTrading: retail && !!ta.allowEnergyTrading,
            exportFromBatteryEnabled: retail && !!ta.exportFromBatteryEnabled,
          });

          if (!sim || !sim.monthly) {
            throw new Error("Hourly simulation failed for battery optimisation");
          }

          const billing = computeHourlyBilling({
            loadKWh: yd.loadHourlyKWh,
            importKWh: sim.hourly.importKWh,
            exportKWh: sim.hourly.exportKWh,
            hourOfDay: yd.hourOfDay,
            monthIdx: yd.monthIdx,
            tariffBefore: tb,
            tariffAfter: ta,
          });

          const annualBillSavings = Math.max(
            0,
            billing.annualBaseline - billing.annualAfterImportAndStanding
          );

          const annualSegIncome = billing.annualExportCredit;

          annualBenefits.push(annualBillSavings + annualSegIncome);
          annualSelfUsed.push(sum12(sim.monthly.selfUsed));
          annualExported.push(sum12(sim.monthly.exported));
          annualImported.push(sum12(sim.monthly.imported));


          const avg = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

          const avgBenefit = avg(annualBenefits);
          const avgSelf = avg(annualSelfUsed);
          const avgExp = avg(annualExported);
          const avgImp = avg(annualImported);

          // 2) Price the system using the SAME pricing logic as the real quote
          const candidateInput = {
            ...input,
            batteryCapacity: batteryUsableKWh,
            batteryKWh: batteryUsableKWh, // backward compatibility
            roofs: input.roofs,
            extras: input.extras,
          };

          const candidateBaseQuote = calculateQuote(candidateInput, {
            annualGenerationOverrideKWh: pvgisAnnualKWh,
            silent: true,
          });

          const candidateMidPrice = (candidateBaseQuote.priceLow + candidateBaseQuote.priceHigh) / 2;

          // 3) Use the SAME payback + lifetime projection model as the main quote
          const paybackSeries = makePaybackAndLifetimeSeries({
            systemCostMid: candidateMidPrice,
            annualBenefit: avgBenefit,
            years: 25,
            panelOption: input?.panelOption || "",
            energyInflationRate: Number(CONFIG.energyInflationRate || 0.06),
          });

          const paybackYears = paybackSeries.paybackYear; // decimal (1dp) or null
          const lifetimeNetSavings = Math.round(Number(paybackSeries.lifetimeSavings || 0)); // net of system cost
          const lifetimeGrossBenefit = Math.round(lifetimeNetSavings + candidateMidPrice);

          return {
            annualBenefit: Math.round(avgBenefit),
            paybackYears,
            annualSelfUsedKWh: Math.round(avgSelf),
            annualExportedKWh: Math.round(avgExp),
            annualImportedKWh: Math.round(avgImp),
            candidateMidPrice: Math.round(candidateMidPrice),

            // Used for “max lifetime savings”
            lifetimeYears: 25,
            lifetimeGrossBenefit,
            lifetimeNetSavings,
          };
        }


        // BATTERY RECOMMENDATIONS
        const curve = [];
        for (let b = 0; b <= MAX_BAT; b += STEP) {
          try {
            const r = simulateForBatterySizeUsable(b);
            curve.push({ batteryKWhUsable: b, ...r });
          } catch (e) {
            console.warn(`Battery optimisation: failed for ${b} kWh:`, e);
          }
        }

        quote.batteryRecommendations = buildBatteryRecommendations({
          curve,
          batteryCostPerKWh,
          minRecommendedBatteryKWh: MIN_RECOMMENDED_BAT,
          maxBatteryKWh: MAX_BAT,
          stepKWh: STEP,
          lifetimeYears: 25,
        });

      }
    } else {
      quote.hourlyModel = null;
    }

    console.log("Battery rec exists?", !!quote.batteryRecommendations);
    console.log("Battery rec keys:", quote.batteryRecommendations ? Object.keys(quote.batteryRecommendations) : null);


    // ------------------------------
    // Logging
    // ------------------------------
    console.log(
      "Self-consumption model:",
      quote.selfConsumptionModel || (
        quote.estAnnualGenerationKWh <= 6000 && quote.assumedAnnualConsumptionKWh <= 6000
          ? "MCS table"
          : "Heuristic"
      )
    );

    console.log("Hourly model attached?:", !!quote.hourlyModel);
    if (quote.hourlyModel) {
      console.log("Self-consumption model: Hourly PVGIS simulation");
      console.log("Hourly model:", quote.hourlyModel.model);
      console.log("Hourly monthly generation:", quote.hourlyModel.monthlyGenerationKWh);
      console.log("Hourly monthly direct:", quote.hourlyModel.monthlyDirectToHomeKWh);
      console.log("Hourly monthly charge:", quote.hourlyModel.monthlyBatteryChargeKWh);
      console.log("Hourly monthly export:", quote.hourlyModel.monthlyExportedKWh);
      console.log("Hourly monthly import:", quote.hourlyModel.monthlyImportedKWh);
      console.log("Hourly monthly load:", quote.hourlyModel.monthlyLoadKWh);
      console.log("Financial series attached?:", !!quote.financialSeries);
      console.log("Battery recommendations attached?:", !!quote.batteryRecommendations);
      console.log("Best payback recommendation:", quote.batteryRecommendations?.bestPayback);
      console.log("hourlyModel keys:", Object.keys(quote.hourlyModel || {}));
      console.log("has _pvHourlyKWh?", Array.isArray(quote?.hourlyModel?._pvHourlyKWh), quote?.hourlyModel?._pvHourlyKWh?.length);
      console.log("has _loadHourlyKWh?", Array.isArray(quote?.hourlyModel?._loadHourlyKWh), quote?.hourlyModel?._loadHourlyKWh?.length);
      console.log("has _monthIdx?", Array.isArray(quote?.hourlyModel?._monthIdx), quote?.hourlyModel?._monthIdx?.length);
      console.log("has _hourOfDay?", Array.isArray(quote?.hourlyModel?._hourOfDay), quote?.hourlyModel?._hourOfDay?.length);

    }

    // ------------------------------
    // Optional local lead save
    // ------------------------------
    const { name, email, address, phone } = input;

    const leads = readLeads();

    leads.push({
      createdAt: new Date().toISOString(),
      contact: { name, email, address, phone },
      inputSummary: {
        postcode: input.postcode,
        annualKWh: input.annualKWh,
        monthlyBill: input.monthlyBill,
        roofSize: input.roofSize,
        shading: input.shading,
        occupancyProfile: input.occupancyProfile,
        panelOption: input.panelOption,
        batteryKWh: input.batteryKWh,
        panelCount: input.panelCount,
        roofs: input.roofs,
        extras: input.extras,
        tariffBefore: input.tariffBefore,
        tariffAfter: input.tariffAfter,
      },
      quoteSummary: {
        systemSizeKwp: quote.systemSizeKwp,
        panelCount: quote.panelCount,
        panelWatt: quote.panelWatt,
        estAnnualGenerationKWh: quote.estAnnualGenerationKWh,
        priceLow: quote.priceLow,
        priceHigh: quote.priceHigh,
        annualBillSavings: quote.annualBillSavings,
        annualSegIncome: quote.annualSegIncome,
        totalAnnualBenefit: quote.totalAnnualBenefit,
        simplePaybackYears: quote.simplePaybackYears,
        selfConsumptionModel: quote.selfConsumptionModel,
        recommendedBatteryKWh:
          quote.batteryRecommendations?.bestPayback?.batteryKWhUsable ?? null,
      },
    });

    // Keep only the latest 200 local quote records so this file cannot grow forever.
    saveLeads(leads.slice(-200));

    res.json(quote);

  } catch (err) {
    console.error("Error in /api/quote:", err);
    res.status(500).json({ error: "Something went wrong calculating and saving the quote." });
  }
});

module.exports = router;