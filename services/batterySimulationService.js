const {
  normalizeTariff,
  isRetailRateTariff,
  rateForHour,
} = require("./tariffService");

function simulateHourByHour({
  pvHourlyKWh,
  loadHourlyKWh,
  monthIdx,
  hourOfDay: hourOfDayIn,
  batteryKWh = 0,
  tariff = null,
  dispatchMode = "self_consumption",
  allowGridCharge = false,
  exportFromBatteryEnabled = false,
  allowEnergyTrading = false,
  gridChargeTargetPct = 80,
}) {
  let hourOfDay = hourOfDayIn;

  // ===============================
  // Debug controls
  // Turn DEBUG_SIM to true only when diagnosing dispatch behaviour
  // ===============================
  const DEBUG_SIM = false;
  const DEBUG_DAY_START = 3600;

  function debugSim(...args) {
    if (DEBUG_SIM) console.log(...args);
  }

  const n = Math.min(
    pvHourlyKWh?.length || 0,
    loadHourlyKWh?.length || 0,
    monthIdx?.length || 0,
    hourOfDay?.length || (pvHourlyKWh?.length || 0)
  );
  if (n === 0) return null;

  if (!hourOfDay || hourOfDay.length < n) {
    hourOfDay = Array.from({ length: n }, (_, i) => i % 24);
  }

  // Usable capacity (kWh)
  const capUsable = Math.max(0, Number(batteryKWh || 0));
  const socMin = 0;
  const socMax = capUsable;

  //====================
  // New Helper Function
  //====================
    function isHourInWindow(hod, startHour, endHour) {
    const start = Number(startHour ?? 0);
    const end = Number(endHour ?? 0);

    // Normal same-day window, e.g. 00 -> 05
    if (start < end) {
      return hod >= start && hod < end;
    }

    // Cross-midnight window, e.g. 23 -> 05
    if (start > end) {
      return hod >= start || hod < end;
    }

    // If start === end, treat as no active window
    return false;
  }

  function isCheapImportWindow(tariff, hod) {
    const tt = String(tariff?.tariffType || "standard");

    if (tt === "overnight") {
      const ns = Number(tariff?.nightStartHour ?? 0);
      const ne = Number(tariff?.nightEndHour ?? 7);
      return isHourInWindow(hod, ns, ne);
    }

    if (tt === "flux") {
      const os = Number(tariff?.offPeakStartHour ?? 0);
      const oe = Number(tariff?.offPeakEndHour ?? 6);
      return isHourInWindow(hod, os, oe);
    }

    return false;
  }

  // ===============================
  // Realistic inverter power limits
  // ===============================
  // < 8 kWh battery → 3.7 kW
  // ≥ 8 kWh battery → 6 kW

  let maxChargeKW = 0;
  let maxDischargeKW = 0;

  if (capUsable > 0) {
    if (capUsable < 8) {
      maxChargeKW = 3.7;
      maxDischargeKW = 3.7;
    } else {
      maxChargeKW = 5;
      maxDischargeKW = 6;
    }
  }

  // Efficiency
  const roundTripEff = 0.90;
  const chargeEff = Math.sqrt(roundTripEff);
  const dischargeEff = Math.sqrt(roundTripEff);

  // Start SOC at 50% (realistic default, prevents “battery always full”)
  // This also allows grid-charge behaviour to show up in debug days.
  let soc = socMin;

  // Track stored energy origin (kWh stored inside battery)
  let socFromPV = 0;
  let socFromGrid = soc; // assume initial SOC is grid-origin


  // Hourly outputs (8760)
  const importHourly = Array(n).fill(0);
  const exportHourly = Array(n).fill(0);
  const battChargeHourly_fromPV = Array(n).fill(0);   // PV -> battery (kWh PV input)
  const battChargeHourly_fromGrid = Array(n).fill(0); // Grid -> battery (kWh grid input)
  const battDischargeHourly_toLoad = Array(n).fill(0);// Battery -> load (kWh delivered)
  const directPVtoLoadHourly = Array(n).fill(0);
  const battDischargeFromPVToLoadHourly = Array(n).fill(0);
  const battDischargeFromGridToLoadHourly = Array(n).fill(0);

  const monthly = {
    generation: Array(12).fill(0),
    selfUsed: Array(12).fill(0),
    exported: Array(12).fill(0),
    imported: Array(12).fill(0),
    batteryCharge: Array(12).fill(0),
    batteryDischarge: Array(12).fill(0),
    batteryDischargeFromPVToLoad: Array(12).fill(0),
    batteryDischargeFromGridToLoad: Array(12).fill(0),
    batteryChargeFromPV: Array(12).fill(0),
    batteryChargeFromGrid: Array(12).fill(0),
    pvExportDirect: Array(12).fill(0)
  };

  const hourly = {
    pv: Array(n).fill(0),
    load: Array(n).fill(0),
    soc: Array(n).fill(0),
    importKWh: Array(n).fill(0),
    exportKWh: Array(n).fill(0),

    // optional but very useful
    battChargeFromPV: Array(n).fill(0),     // kWh INTO battery from PV (input)
    battChargeFromGrid: Array(n).fill(0),   // kWh INTO battery from grid (input)
    battDischargeToLoad: Array(n).fill(0),  // kWh delivered to load
    battDischargeToExport: Array(n).fill(0), // kWh delivered to export
    battDischargeFromPVToLoad: Array(n).fill(0),
    battDischargeFromGridToLoad: Array(n).fill(0)
  };

  // ---- SAM-like day-ahead plan for retail rate dispatch ----
  // We plan desired battery discharge to cover the most expensive hours of NET LOAD (load - PV),
  // and (optionally) grid-charge in cheapest hours to ensure energy is available.
  function planDayRetailRate(dayStart, dayLen) {
    const planDischargeToLoad = Array(dayLen).fill(0);   // kWh delivered to load
    const planGridChargeIn = Array(dayLen).fill(0);      // kWh drawn from grid into battery (input)
    const planDischargeToExport = Array(dayLen).fill(0); // kWh delivered to export
    const planStorePV = Array(dayLen).fill(false);       // whether PV surplus should be stored this hour

    // If no battery or not retail mode, do nothing special
    if (capUsable <= 0 || dispatchMode !== "retail_rate" || !tariff) {
      return { planDischargeToLoad, planGridChargeIn, planDischargeToExport, planStorePV };
    }

    // Build hourly forecast arrays for this day
    const hours = [];
    for (let i = 0; i < dayLen; i++) {
      const tAbs = dayStart + i;
      const pv = Math.max(0, Number(pvHourlyKWh[tAbs] || 0));
      const load = Math.max(0, Number(loadHourlyKWh[tAbs] || 0));
      const hod = hourOfDay[tAbs];

      const imp = rateForHour(tariff, hod, "import");
      const exp = rateForHour(tariff, hod, "export");

      const netLoad = Math.max(0, load - pv);      // demand not met directly by PV
      const pvSurplus = Math.max(0, pv - load);    // PV available to charge battery / export

      hours.push({ i, tAbs, pv, load, hod, imp, exp, netLoad, pvSurplus });
    }

    // Identify cheap import window hours (used for charging + arbitrage logic)
    const cheapImportHours = hours.filter((h) => {
      return isCheapImportWindow(tariff, h.hod);
    });

    // ------------------------------
    // Phase 1 planning inputs
    //
    // We want two separate budgets:
    // 1) battery room to keep for low-value PV later in the day
    // 2) battery energy we may want to buy overnight for later expensive home demand
    // ------------------------------

    // Cheapest import rate available in the cheap window
    const cheapestImport = cheapImportHours.length
      ? Math.min(...cheapImportHours.map(h => h.imp))
      : Math.min(...hours.map(h => h.imp)); // fallback

    const rtEff = chargeEff * dischargeEff;

    // A) PV surplus that is better STORED than EXPORTED immediately
    //
    // We now reserve battery room for two kinds of solar:
    //
    // 1) Solar where exporting now is worse than avoiding later imports
    //    (current export < cheapest off-peak import)
    //
    // 2) Solar where there is a better export opportunity later in the same day
    //    (store now, export later at a higher export price)
    let pvReserveInput = 0;

    for (let j = 0; j < hours.length; j++) {
      const h = hours[j];
      if (h.pvSurplus <= 0.001) continue;

      const pvCouldChargeThisHour = Math.min(h.pvSurplus, maxChargeKW);

      // Best export value from this hour onward
      const laterBestExport = Math.max(
        ...hours.slice(j).map((x) => Number(x.exp || 0))
      );

      // What is 1 kWh of solar worth if we store it for later home use?
      // Benchmark it against the cheapest off-peak import we could buy instead.
      const valueOfStoringForHome = cheapestImport * rtEff;

      // Case 1: store PV for later home use
      const shouldStoreForHome = valueOfStoringForHome > h.exp + 0.0005;

      // Case 2: store PV because there is a genuinely better export hour later
      const shouldStoreForLaterExport = laterBestExport > h.exp + 0.0005;

      const shouldReserveRoomForThisPv = shouldStoreForHome || shouldStoreForLaterExport;

      // Save the planner decision for the hourly execution layer
      planStorePV[j] = shouldReserveRoomForThisPv;

      if (dayStart === DEBUG_DAY_START) {
        debugSim("PV RESERVE DECISION", {
          hod: h.hod,
          pvSurplus: h.pvSurplus,
          exportNow: h.exp,
          cheapestImport,
          valueOfStoringForHome,
          laterBestExport,
          shouldStoreForHome,
          shouldStoreForLaterExport,
          shouldReserveRoomForThisPv,
        });
      }

      if (shouldReserveRoomForThisPv) {
        pvReserveInput += pvCouldChargeThisHour;
      }
    }

    // Convert PV input into stored kWh inside the battery
    const pvReserveStored = Math.min(pvReserveInput * chargeEff, socMax);

    // B) Future expensive home-demand hours that are worth serving from the battery
    // We only count hours where import later is more expensive than cheap off-peak import.
    let futureExpensiveDemandDeliver = 0;

    for (const h of hours) {
      if (h.netLoad <= 0.001) continue;
      if (h.imp <= cheapestImport + 0.0005) continue;

      futureExpensiveDemandDeliver += Math.min(h.netLoad, maxDischargeKW);
    }

    // Convert deliverable battery output into stored kWh needed
    const homeDemandReserveStored = Math.min(
      futureExpensiveDemandDeliver / dischargeEff,
      socMax
    );


    // ---- A) Plan discharge-to-load: cover most expensive import hours first ----
    // IMPORTANT: do NOT limit planning to current SOC only.
    // PV later in the day can fill the battery, so we plan as if the battery could
    // reach full at some point during the day, and the real hour loop will cap by SOC.
    const byExpensiveImport = [...hours].sort((a, b) => {
      // highest import price first; if tied, larger net load first
      if (b.imp !== a.imp) return b.imp - a.imp;
      return b.netLoad - a.netLoad;
    });

    // Max energy the battery could deliver in a day if it became full at some point
    let deliverableBudget = Math.max(0, (socMax - socMin)) * dischargeEff;

    // If grid charging is OFF, estimate additional energy that can be stored from PV later today
    if (!allowGridCharge) {
      let socTemp = soc;

      for (const h of hours) {
        // PV surplus can charge battery
        if (h.pvSurplus > 0 && socTemp < socMax) {
          const roomStored = socMax - socTemp;
          const pvToBattIn = Math.min(h.pvSurplus, maxChargeKW, roomStored / chargeEff);
          socTemp += pvToBattIn * chargeEff;
        }
      }

      // Use the best SOC we can reach from PV as today's discharge budget
      deliverableBudget = Math.max(0, (socTemp - socMin)) * dischargeEff;
    }


    for (const h of byExpensiveImport) {
      if (deliverableBudget <= 0) break;
      if (h.netLoad <= 0) continue;

      const deliver = Math.min(h.netLoad, maxDischargeKW, deliverableBudget);
      planDischargeToLoad[h.i] = deliver;
      deliverableBudget -= deliver;
    }

    // ---- B) Plan grid charging, but leave room for expected PV surplus ----
    // ALSO: if arbitrage is profitable (cheap import < high export), allow charging for export.

    if (allowGridCharge && capUsable > 0 && dispatchMode === "retail_rate" && tariff) {

      // 1) Base overnight target from the UI setting
      const pctTargetSOC = socMax * (gridChargeTargetPct / 100);

      // 2) If energy trading is enabled, work out how much EXTRA spare capacity
      // could be used for profitable arbitrage later.
      let arbitrageReserveStored = 0;

      if (allowEnergyTrading && exportFromBatteryEnabled) {
        const profitableExportHours = hours.filter((h) => {
          return h.exp > 0 && (h.exp * rtEff) > (cheapestImport + 0.005);
        });

        let arbitrageReserveDeliver = 0;
        for (const h of profitableExportHours) {
          arbitrageReserveDeliver += maxDischargeKW;
        }

        arbitrageReserveStored = Math.min(
          arbitrageReserveDeliver / dischargeEff,
          socMax
        );
      }

      // 3) Keep room for low-value / better-later solar
      const maxAllowedSOCForSolarRoom = Math.max(socMin, socMax - pvReserveStored);

      // 4) First reserve battery for future expensive home demand
      let targetSOC = Math.min(pctTargetSOC, homeDemandReserveStored);

      // 5) If energy trading is ON, allow extra overnight charge for arbitrage,
      // but only using spare capacity beyond the home-demand reserve.
      if (allowEnergyTrading && exportFromBatteryEnabled) {
        const spareCapacityAfterHomeReserve = Math.max(0, socMax - homeDemandReserveStored);
        const usableArbitrageStored = Math.min(arbitrageReserveStored, spareCapacityAfterHomeReserve);

        targetSOC = Math.max(
          targetSOC,
          Math.min(pctTargetSOC, homeDemandReserveStored + usableArbitrageStored)
        );
      }

      // 6) Never exceed the level that would block solar we want to keep
      targetSOC = Math.min(targetSOC, maxAllowedSOCForSolarRoom);

      if (dayStart === DEBUG_DAY_START) {
        debugSim("----- PHASE 3 DAY PLAN DEBUG -----");
        debugSim("dayStart:", dayStart);
        debugSim("cheapestImport:", cheapestImport);
        debugSim("pvReserveStored:", pvReserveStored);
        debugSim("homeDemandReserveStored:", homeDemandReserveStored);
        debugSim("arbitrageReserveStored:", arbitrageReserveStored);
        debugSim("pctTargetSOC:", pctTargetSOC);
        debugSim("maxAllowedSOCForSolarRoom:", maxAllowedSOCForSolarRoom);
        debugSim("targetSOC:", targetSOC);
        debugSim("allowEnergyTrading:", allowEnergyTrading);
        debugSim("exportFromBatteryEnabled:", exportFromBatteryEnabled);
        debugSim(
          "planGridChargeIn:",
          planGridChargeIn.map((v) => Math.round((v || 0) * 1000) / 1000)
        );
      }

      // 6) Only grid-charge if targetSOC is above current SOC
      // IMPORTANT: do NOT mutate the real `soc` inside planning.
      // Use `socAt` (planner's simulated SOC).
      let socAt = soc; // start planning from current real SOC

      if (socAt < targetSOC) {
        const byCheapestImport = [...cheapImportHours].sort((a, b) => a.imp - b.imp);

        for (const h of byCheapestImport) {
          if (socAt >= targetSOC) break;

          const roomStored = targetSOC - socAt;
          if (roomStored <= 0) break;

          // convert stored-room to grid input limit
          const maxGridIn = roomStored / chargeEff;

          const gridToBattery = Math.min(maxChargeKW, maxGridIn);
          if (gridToBattery <= 0) continue;

          planGridChargeIn[h.i] = gridToBattery;

          // Update ONLY the planned SOC (socAt), NOT the real SOC.
          socAt += gridToBattery * chargeEff;
        }
      }

    }


    // ---- C) Plan export-from-battery (reserve for future expensive imports) ----
    // Export is allowed, but only the portion that is truly surplus after reserving energy
    // to avoid future imports that cost MORE than exporting now.
    if (exportFromBatteryEnabled) {
      const rtEff = chargeEff * dischargeEff;

      // For "is this export hour worth considering?"
      const bestExport = Math.max(...hours.map(h => h.exp));

      for (let idx = 0; idx < dayLen; idx++) {
        const current = hours[idx];

        if (current.exp <= 0.01) continue;

        // Don’t export from battery during cheap import windows (especially overnight),
        // because it leads to silly behaviour when export is flat.
        // (If you REALLY want to allow it, remove this.)
        if (isCheapImportWindow(tariff, current.hod)) continue;

        // Optional: only bother exporting in "high export" hours (helps Flux behave nicely)
        // If export is flat all day, this will allow all hours (since bestExport == exp).
        if (current.exp < bestExport - 0.001) continue;

        // If energy trading is OFF, only export from battery in hours that are
        // genuinely better than earlier PV-surplus export hours.
        //
        // This prevents silly "store then export later at the same flat export rate" behaviour.
        if (!allowEnergyTrading) {
          const earlierPvWithLowerExport = hours
            .slice(0, idx)
            .some((h) => h.pvSurplus > 0.001 && h.exp < current.exp - 0.0005);

          if (!earlierPvWithLowerExport) continue;
        }

        // ------------------------------------------------------------
        // 1) Reserve deliverable energy for future HOME demand first.
        //
        // We should only export battery energy that is genuinely surplus after
        // protecting later household demand.
        // ------------------------------------------------------------
        let reserveDeliver = 0;
        for (let j = idx; j < dayLen; j++) {
          const h = hours[j];

          if (h.netLoad <= 0) continue;

          const needDeliver = allowGridCharge
            ? Math.max(0, Number(planDischargeToLoad[h.i] || 0))
            : Math.min(h.netLoad, maxDischargeKW);

          reserveDeliver += Math.min(needDeliver, maxDischargeKW);
        }
        const reserveStored = reserveDeliver / dischargeEff;

        // ------------------------------------------------------------
        // 2) Estimate SOC at this hour (socAt) using the day plan up to idx
        //    NOTE: include planned export discharge too (this was missing in your code).
        // ------------------------------------------------------------
        let socAt = soc;

        for (let k = 0; k <= idx; k++) {
          const h = hours[k];

          // grid charge in (stored)
          const gIn = Number(planGridChargeIn[h.i] || 0);
          if (gIn > 0 && socAt < socMax) {
            const roomStored = socMax - socAt;
            const gUsed = Math.min(gIn, maxChargeKW, roomStored / chargeEff);
            socAt += gUsed * chargeEff;
          }

          // PV charge in (stored)
          if (h.pvSurplus > 0 && socAt < socMax) {
            const roomStored = socMax - socAt;
            const pvToBattIn = Math.min(h.pvSurplus, maxChargeKW, roomStored / chargeEff);
            socAt += pvToBattIn * chargeEff;
          }

          // discharge-to-load (stored out)
          const dLoad = Number(planDischargeToLoad[h.i] || 0);
          if (dLoad > 0) {
            socAt -= dLoad / dischargeEff;
            if (socAt < socMin) socAt = socMin;
          }

          // discharge-to-export already planned earlier in the day (stored out)
          const dExp = Number(planDischargeToExport[h.i] || 0);
          if (dExp > 0) {
            socAt -= dExp / dischargeEff;
            if (socAt < socMin) socAt = socMin;
          }
        }

        // ------------------------------------------------------------
        // 3) Only export what’s surplus beyond reserve + socMin
        // ------------------------------------------------------------
        const surplusStored = Math.max(0, socAt - socMin - reserveStored);
        if (surplusStored <= 0) continue;

        const deliverableExport = surplusStored * dischargeEff;
        let exportDeliver = Math.min(deliverableExport, maxDischargeKW);

        // ------------------------------------------------------------
        // 4) If this is true arbitrage (charging from cheap import), require profitability.
        //    (We ONLY apply this profitability rule when grid charging is enabled.)
        // ------------------------------------------------------------
        if (allowGridCharge) {
          const cheapestImp = cheapImportHours.length
            ? Math.min(...cheapImportHours.map(h => h.imp))
            : Math.min(...hours.map(h => h.imp));

          const profitable = (current.exp * rtEff) > (cheapestImp + 0.005);
          if (!profitable) continue;
        }

        planDischargeToExport[current.i] = exportDeliver;
      }
    }

    return { planDischargeToLoad, planGridChargeIn, planDischargeToExport, planStorePV };
  }


  // Walk the year in day chunks
  let t = 0;
  while (t < n) {
    const dayStart = t;
    const dayLen = Math.min(24, n - dayStart);
    const { planDischargeToLoad, planGridChargeIn, planDischargeToExport, planStorePV } = planDayRetailRate(dayStart, dayLen);

    for (let i = 0; i < dayLen; i++) {
      const idx = dayStart + i;

      const pv = Math.max(0, Number(pvHourlyKWh[idx] || 0));
      const load = Math.max(0, Number(loadHourlyKWh[idx] || 0));

      // ✅ Correct indexing: use absolute hour index
      hourly.pv[idx] = pv;
      hourly.load[idx] = load;

      const m = monthIdx[idx] ?? 0;

      // 1) Direct PV to load
      const direct = Math.min(pv, load);
      let pvLeft = pv - direct;
      let loadLeft = load - direct;

      // 2) Planned grid charge (retail dispatch)
      // Charge from grid first so SOC is ready for expensive hours.
      // (This is a simplification; SAM uses iterative planning with forecasts.)
      let chargedFromGrid = 0;
      if (capUsable > 0 && dispatchMode === "retail_rate" && allowGridCharge) {
        const gridIn = Math.max(0, Number(planGridChargeIn[i] || 0));
        if (gridIn > 0 && soc < socMax) {
          const roomStored = socMax - soc; // kWh stored room
          const maxGridIn = roomStored / chargeEff; // grid kWh we can input this hour
          const gridToBattery = Math.min(gridIn, maxChargeKW, maxGridIn);

          const stored = gridToBattery * chargeEff;
          soc += stored;
          socFromGrid += stored;

          chargedFromGrid = gridToBattery;
          battChargeHourly_fromGrid[idx] = gridToBattery;
          
          hourly.battChargeFromGrid[idx] = gridToBattery;

          // grid charging increases import later
          // We’ll account by adding to loadLeft (grid import)
          loadLeft += gridToBattery;
        }
      }

      // 3) Charge battery from remaining PV only if the planner says this PV is worth storing
      let chargedFromPV = 0;
      const shouldStorePVNow = !allowGridCharge || !!planStorePV[i];

      if (idx >= DEBUG_DAY_START && idx < DEBUG_DAY_START + 24) {
        debugSim("PV STORE EXECUTION", {
          idx,
          hod: hourOfDay[idx],
          shouldStorePVNow,
          pvLeftBeforeStore: pvLeft,
        });
      }

      if (capUsable > 0 && pvLeft > 0 && soc < socMax && shouldStorePVNow) {
        const room = socMax - soc;
        const pvToBattery = Math.min(pvLeft, maxChargeKW, room / chargeEff);
        const stored = pvToBattery * chargeEff;

        soc += stored;
        socFromPV += stored;

        pvLeft -= pvToBattery;
        chargedFromPV = pvToBattery;

        battChargeHourly_fromPV[idx] = pvToBattery;
      }

      hourly.battChargeFromPV[idx] = chargedFromPV;
      monthly.batteryChargeFromPV[m] += chargedFromPV;


      // 4) Discharge battery to meet load
      // Goal:
      // - Never discharge during cheap import windows (save for expensive hours)
      // - If grid charging is OFF, do NOT cap discharge by the day-ahead plan,
      //   because the plan doesn't "know" the battery will be refilled by PV later.
      let dischargedToLoad = 0;

      if (capUsable > 0 && loadLeft > 0 && soc > socMin) {
        const availableStored = soc - socMin;
        const canDeliver = availableStored * dischargeEff;

        const hodNow = hourOfDay[idx];

        // Are we in a "cheap import window" (overnight night window / flux off-peak)?
        const cheapNow =
          (dispatchMode === "retail_rate" && tariff)
            ? isCheapImportWindow(tariff, hodNow)
            : false;

        // Do not discharge during cheap hours (regardless of grid-charging toggle)
        if (!cheapNow) {
          // In retail-rate mode, the planner tells us *where* to discharge.
          // But if grid charging is OFF, the planner underestimates energy available later
          // (because PV can refill the battery), so we must allow discharge even if plan=0.
          const planned = Math.max(0, Number(planDischargeToLoad[i] || 0));

          let capByPlan;
          const tariffTypeNow = String(tariff?.tariffType || "");

          // Flux: preserve charge for peak import hours
          if (dispatchMode === "retail_rate" && tariff && tariffTypeNow === "flux") {
            capByPlan = planned;
          }
          // Overnight: once outside cheap hours, behave like normal self-consumption
          else if (dispatchMode === "retail_rate" && tariff && tariffTypeNow === "overnight") {
            capByPlan = loadLeft;
          }
          // Non-retail / default
          else {
            capByPlan = loadLeft;
          }

          const deliver = Math.min(loadLeft, canDeliver, maxDischargeKW, capByPlan);

          if (deliver > 0) {
            const storedOut = deliver / dischargeEff;

            // Work out current PV/grid mix inside the battery
            const totalStoredTracked = socFromPV + socFromGrid;

            const pvShare = totalStoredTracked > 0 ? socFromPV / totalStoredTracked : 0;
            const gridShare = totalStoredTracked > 0 ? socFromGrid / totalStoredTracked : 0;

            // Split delivered energy by source
            const pvDeliveredToLoad = deliver * pvShare;
            const gridDeliveredToLoad = deliver * gridShare;

            // Split stored energy removed by source
            const pvStoredOut = storedOut * pvShare;
            const gridStoredOut = storedOut * gridShare;

            // Update actual SOC
            soc -= storedOut;

            // Update tracked source balances
            socFromPV = Math.max(0, socFromPV - pvStoredOut);
            socFromGrid = Math.max(0, socFromGrid - gridStoredOut);

            loadLeft -= deliver;
            dischargedToLoad = deliver;

            battDischargeHourly_toLoad[idx] = deliver;
            hourly.battDischargeToLoad[idx] = deliver;
            hourly.battDischargeFromPVToLoad[idx] = pvDeliveredToLoad;
            hourly.battDischargeFromGridToLoad[idx] = gridDeliveredToLoad;

            // NEW: source-aware discharge tracking
            battDischargeFromPVToLoadHourly[idx] = pvDeliveredToLoad;
            battDischargeFromGridToLoadHourly[idx] = gridDeliveredToLoad;
          }
        }
      }


      // 4b) Optional discharge to export (only if planned and battery has energy)
      // SAFETY: never export battery while the home still has unmet load in the same hour
      let dischargedToExport = 0;

      if (
        capUsable > 0 &&
        dispatchMode === "retail_rate" &&
        exportFromBatteryEnabled &&
        loadLeft <= 0 // ✅ critical safeguard
      ) {
        const plannedExp = Math.max(0, Number(planDischargeToExport[i] || 0));

        if (plannedExp > 0 && soc > socMin) {
          let deliver = 0;
          let storedOut = 0;

          if (allowEnergyTrading) {
            // Phase 3 behaviour will allow exporting any surplus battery energy
            const availableStored = soc - socMin;
            const canDeliver = availableStored * dischargeEff;

            deliver = Math.min(plannedExp, canDeliver, maxDischargeKW);

            if (deliver > 0) {
              storedOut = deliver / dischargeEff;

              const totalStoredTracked = socFromPV + socFromGrid;
              const pvShare = totalStoredTracked > 0 ? socFromPV / totalStoredTracked : 0;
              const gridShare = totalStoredTracked > 0 ? socFromGrid / totalStoredTracked : 0;

              const pvStoredOut = storedOut * pvShare;
              const gridStoredOut = storedOut * gridShare;

              soc -= storedOut;
              socFromPV = Math.max(0, socFromPV - pvStoredOut);
              socFromGrid = Math.max(0, socFromGrid - gridStoredOut);

              dischargedToExport = deliver;
              hourly.battDischargeToExport[idx] = deliver;
            }
          } else {
            // Phase 2 behaviour:
            // only export solar-origin energy from the battery
            const availablePvStored = Math.max(0, socFromPV);
            const canDeliverPv = availablePvStored * dischargeEff;

            deliver = Math.min(plannedExp, canDeliverPv, maxDischargeKW);

            if (deliver > 0) {
              storedOut = deliver / dischargeEff;

              soc -= storedOut;
              socFromPV = Math.max(0, socFromPV - storedOut);

              dischargedToExport = deliver;
              hourly.battDischargeToExport[idx] = deliver;
            }
          }
        }
      }


      // 5) Export / import
      const exported = Math.max(0, pvLeft) + dischargedToExport;
      const imported = Math.max(0, loadLeft);

      hourly.exportKWh[idx] = exported;
      hourly.importKWh[idx] = imported;
      hourly.soc[idx] = soc;

      exportHourly[idx] = exported;
      importHourly[idx] = imported;
      directPVtoLoadHourly[idx] = direct;

      // 6) Monthly accounting
      const selfUsed = direct + dischargedToLoad;

      monthly.generation[m] += pv;
      monthly.selfUsed[m] += selfUsed;
      monthly.exported[m] += exported;
      monthly.imported[m] += imported;
      monthly.batteryCharge[m] += (chargedFromPV + chargedFromGrid);
      monthly.batteryDischarge[m] += dischargedToLoad;
      monthly.batteryDischargeFromPVToLoad[m] += Number(battDischargeFromPVToLoadHourly[idx] || 0);
      monthly.batteryDischargeFromGridToLoad[m] += Number(battDischargeFromGridToLoadHourly[idx] || 0);
      monthly.pvExportDirect[m] += Math.max(0,
        Number(pv || 0) -
        Number(direct || 0) -
        Number(chargedFromPV || 0)
      );
      // Debug first summer-like day block if needed
      if (idx >= DEBUG_DAY_START && idx < DEBUG_DAY_START + 24) {
        debugSim("SUMMER FLOW DEBUG", {
          idx,
          hod: hourOfDay[idx],
          pv,
          load,
          direct,
          chargedFromPV,
          chargedFromGrid,
          dischargedToLoad,
          dischargedToExport,
          pvLeft,
          loadLeft,
          exported,
          imported,
          soc,
          socFromPV,
          socFromGrid,
        });
      }
    }

    t += dayLen;
  }

  // Round monthly for stable charts
  for (const k of Object.keys(monthly)) {
    monthly[k] = monthly[k].map((v) => Math.round(v * 100) / 100);
  }

  const annual = {
    generation: monthly.generation.reduce((s, v) => s + v, 0),
    selfUsed: monthly.selfUsed.reduce((s, v) => s + v, 0),
    exported: monthly.exported.reduce((s, v) => s + v, 0),
    imported: monthly.imported.reduce((s, v) => s + v, 0),
  };

  if (hourly.soc.some((v) => v < -1e-6)) {
    console.warn("SOC went negative (should not happen).");
  }


  return {
    monthly,
    annual,
    hourly: {
      // 0–23 repeated for charts
      hours: Array.from({ length: n }, (_, i) => i % 24),

      // Core series for plotting
      pvKWh: hourly.pv,
      loadKWh: hourly.load,
      socKWh: hourly.soc,

      // Grid flows
      importKWh: importHourly,
      exportKWh: exportHourly,

      // Battery flows
      battChargeFromPVKWh: battChargeHourly_fromPV,
      battChargeFromGridKWh: battChargeHourly_fromGrid,
      battDischargeToLoadKWh: battDischargeHourly_toLoad,
      battDischargeToExportKWh: hourly.battDischargeToExport,
      battDischargeFromPVToLoadKWh: battDischargeFromPVToLoadHourly,
      battDischargeFromGridToLoadKWh: battDischargeFromGridToLoadHourly,

      // PV direct
      directPVToLoadKWh: directPVtoLoadHourly,
    },
  };
}

// ===============================
// Tariff normalization + hourly billing (single source of truth)
// ===============================

function simulateWithTariff({ pv, load, monthIdx, hourOfDay, batteryKWh, tariff }) {
  const t = normalizeTariff(tariff, "after");
  const retail = isRetailRateTariff(t);
  const allowGridCharge = retail && !!t.allowGridCharging;

  return simulateHourByHour({
    pvHourlyKWh: pv,
    loadHourlyKWh: load,
    monthIdx,
    hourOfDay,
    batteryKWh: Number(batteryKWh || 0),
    tariff: t,
    dispatchMode: retail ? "retail_rate" : "self_consumption",
    allowGridCharge,
    exportFromBatteryEnabled: !!t.exportFromBatteryEnabled,
  });
}

module.exports = {
  simulateHourByHour,
  simulateWithTariff,
};