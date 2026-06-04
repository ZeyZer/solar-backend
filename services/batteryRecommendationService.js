const {
  makeBatteryAwarePaybackAndLifetimeSeries,
} = require("./financialService");

function round1(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function roundMoney(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n);
}

function selectBestPaybackCandidate(candidates, curve) {
  const viablePayback = candidates.filter(
    (x) =>
      typeof x.paybackYears === "number" &&
      Number.isFinite(x.paybackYears) &&
      x.annualBenefit > 0
  );

  let bestPayback = null;

  if (viablePayback.length > 0) {
    bestPayback = viablePayback.reduce((best, cur) => {
      if (cur.paybackYears < best.paybackYears) return cur;

      if (
        cur.paybackYears === best.paybackYears &&
        cur.annualBenefit > best.annualBenefit
      ) {
        return cur;
      }

      return best;
    }, viablePayback[0]);
  } else if (candidates.length > 0) {
    bestPayback = candidates.reduce(
      (best, cur) => (cur.annualBenefit > best.annualBenefit ? cur : best),
      candidates[0]
    );
  }

  return bestPayback || candidates[0] || curve[0] || null;
}

function selectBestLifetimeSavingsCandidate(candidates) {
  const viableLifetime = candidates.filter(
    (x) =>
      typeof x.lifetimeNetSavings === "number" &&
      Number.isFinite(x.lifetimeNetSavings)
  );

  let bestLifetimeSavings = null;

  if (viableLifetime.length > 0) {
    bestLifetimeSavings = viableLifetime.reduce((best, cur) => {
      if (cur.lifetimeNetSavings > best.lifetimeNetSavings) return cur;

      if (cur.lifetimeNetSavings === best.lifetimeNetSavings) {
        const bestPay =
          typeof best.paybackYears === "number" ? best.paybackYears : Infinity;

        const curPay =
          typeof cur.paybackYears === "number" ? cur.paybackYears : Infinity;

        if (curPay < bestPay) return cur;

        if (curPay === bestPay && cur.annualBenefit > best.annualBenefit) {
          return cur;
        }
      }

      return best;
    }, viableLifetime[0]);
  }

  if (bestLifetimeSavings && bestLifetimeSavings.lifetimeNetSavings <= 0) {
    bestLifetimeSavings = null;
  }

  return bestLifetimeSavings;
}

function findBatteryCandidate(curve, targetBatteryKWh) {
  const safeCurve = Array.isArray(curve) ? curve : [];

  if (!safeCurve.length) return null;

  const target = Number(targetBatteryKWh || 0);

  const exact = safeCurve.find(
    (x) => Number(x.batteryKWhUsable || 0) === target
  );

  if (exact) return exact;

  return safeCurve.reduce((best, cur) => {
    const bestDistance = Math.abs(Number(best.batteryKWhUsable || 0) - target);
    const curDistance = Math.abs(Number(cur.batteryKWhUsable || 0) - target);

    if (curDistance < bestDistance) return cur;

    return best;
  }, safeCurve[0]);
}

function applyBatteryDegradationToCurve({
  curve,
  lifetimeYears = 25,
  panelOption = "",
  energyInflationRate = 0.06,
  batteryDegradationRate = 0.02,
  minBatteryCapacityFraction = 0.70,
}) {
  const safeCurve = Array.isArray(curve) ? curve : [];

  if (!safeCurve.length) return [];

  const noBatteryCandidate = findBatteryCandidate(safeCurve, 0);
  const noBatteryAnnualBenefit = Number(noBatteryCandidate?.annualBenefit || 0);

  return safeCurve.map((candidate) => {
    const candidateMidPrice = Number(candidate.candidateMidPrice || 0);
    const candidateAnnualBenefit = Number(candidate.annualBenefit || 0);

    if (!Number.isFinite(candidateMidPrice) || candidateMidPrice <= 0) {
      return candidate;
    }

    const batteryAwareSeries = makeBatteryAwarePaybackAndLifetimeSeries({
      systemCostMid: candidateMidPrice,
      noBatteryAnnualBenefit,
      candidateAnnualBenefit,
      years: lifetimeYears,
      panelOption,
      energyInflationRate,
      batteryDegradationRate,
      minBatteryCapacityFraction,
    });

    const lifetimeNetSavings = Math.round(
      Number(batteryAwareSeries.lifetimeSavings || 0)
    );

    const lifetimeGrossBenefit = Math.round(
      lifetimeNetSavings + candidateMidPrice
    );

    return {
      ...candidate,
      paybackYears: batteryAwareSeries.paybackYear,
      lifetimeYears,
      lifetimeGrossBenefit,
      lifetimeNetSavings,
      degradationApplied: true,
      batteryDegradationAssumptions: {
        batteryDegradationRate,
        minBatteryCapacityFraction,
      },
    };
  });
}

function buildNoBatteryComparison({ curve, selectedBatteryKWh }) {
  const safeCurve = Array.isArray(curve) ? curve : [];

  if (!safeCurve.length) {
    return null;
  }

  const noBatteryCandidate = findBatteryCandidate(safeCurve, 0);
  const selectedCandidate = findBatteryCandidate(safeCurve, selectedBatteryKWh);

  if (!noBatteryCandidate || !selectedCandidate) {
    return null;
  }

  const noBatteryAnnualBenefit = Number(noBatteryCandidate.annualBenefit || 0);
  const selectedBatteryAnnualBenefit = Number(selectedCandidate.annualBenefit || 0);

  const noBatterySystemCost = Number(noBatteryCandidate.candidateMidPrice || 0);
  const selectedBatterySystemCost = Number(selectedCandidate.candidateMidPrice || 0);

  const noBatteryLifetimeNetSavings = Number(noBatteryCandidate.lifetimeNetSavings || 0);
  const selectedBatteryLifetimeNetSavings = Number(selectedCandidate.lifetimeNetSavings || 0);

  const incrementalAnnualBenefit =
    selectedBatteryAnnualBenefit - noBatteryAnnualBenefit;

  const incrementalSystemCost =
    selectedBatterySystemCost - noBatterySystemCost;

  const incrementalLifetimeNetSavings =
    selectedBatteryLifetimeNetSavings - noBatteryLifetimeNetSavings;

  const incrementalBatteryPaybackYears =
    incrementalAnnualBenefit > 0 && incrementalSystemCost > 0
      ? round1(incrementalSystemCost / incrementalAnnualBenefit)
      : null;

  return {
    noBattery: {
      batteryKWhUsable: Number(noBatteryCandidate.batteryKWhUsable || 0),
      annualBenefit: roundMoney(noBatteryAnnualBenefit),
      lifetimeNetSavings: roundMoney(noBatteryLifetimeNetSavings),
      candidateMidPrice: roundMoney(noBatterySystemCost),
      annualImportedKWh: roundMoney(Number(noBatteryCandidate.annualImportedKWh || 0)),
      annualExportedKWh: roundMoney(Number(noBatteryCandidate.annualExportedKWh || 0)),
      annualSelfUsedKWh: roundMoney(Number(noBatteryCandidate.annualSelfUsedKWh || 0)),
    },

    selectedBattery: {
      batteryKWhUsable: Number(selectedCandidate.batteryKWhUsable || 0),
      requestedBatteryKWhUsable: Number(selectedBatteryKWh || 0),
      annualBenefit: roundMoney(selectedBatteryAnnualBenefit),
      lifetimeNetSavings: roundMoney(selectedBatteryLifetimeNetSavings),
      candidateMidPrice: roundMoney(selectedBatterySystemCost),
      annualImportedKWh: roundMoney(Number(selectedCandidate.annualImportedKWh || 0)),
      annualExportedKWh: roundMoney(Number(selectedCandidate.annualExportedKWh || 0)),
      annualSelfUsedKWh: roundMoney(Number(selectedCandidate.annualSelfUsedKWh || 0)),
    },

    incremental: {
      annualBenefit: roundMoney(incrementalAnnualBenefit),
      lifetimeNetSavings: roundMoney(incrementalLifetimeNetSavings),
      systemCost: roundMoney(incrementalSystemCost),
      estimatedBatteryCost: roundMoney(incrementalSystemCost),
      batteryPaybackYears: incrementalBatteryPaybackYears,
    },

    verdict: {
      batteryAddsAnnualValue: incrementalAnnualBenefit > 0,
      batteryAddsLifetimeValue: incrementalLifetimeNetSavings > 0,
      batteryHasPositivePayback: incrementalBatteryPaybackYears !== null,
    },

    note:
      "Compares the selected usable battery size against the same system with 0 kWh battery. Lifetime values include simple battery degradation assumptions. Costs are based on the current abstract pricing model, not a real hardware database.",
  };
}

function buildBatteryRecommendations({
  curve,
  batteryCostPerKWh,
  minRecommendedBatteryKWh,
  maxBatteryKWh,
  stepKWh,
  lifetimeYears = 25,
  selectedBatteryKWh = 0,
  panelOption = "",
  energyInflationRate = 0.06,
  batteryDegradationRate = 0.02,
  minBatteryCapacityFraction = 0.70,
  batteryModelAssumptions = null,
}) {
  const safeCurve = Array.isArray(curve) ? curve : [];

  const adjustedCurve = applyBatteryDegradationToCurve({
    curve: safeCurve,
    lifetimeYears,
    panelOption,
    energyInflationRate,
    batteryDegradationRate,
    minBatteryCapacityFraction,
  });

  const minRecommended = Number(minRecommendedBatteryKWh || 0);

  const candidates = adjustedCurve.filter(
    (x) => Number(x.batteryKWhUsable || 0) >= minRecommended
  );

  const bestPayback = selectBestPaybackCandidate(candidates, adjustedCurve);

  const bestLifetimeSavings =
    selectBestLifetimeSavingsCandidate(candidates);

  const noBatteryComparison = buildNoBatteryComparison({
    curve: adjustedCurve,
    selectedBatteryKWh,
  });

  return {
    bestPayback,
    bestLifetimeSavings,
    noBatteryComparison,
    curve: adjustedCurve,
    assumptions: {
      batteryCostPerKWh,
      minRecommendedBatteryKWh,
      maxBatteryKWh,
      stepKWh,
      lifetimeYears,
      selectedBatteryKWh,
      panelOption,
      energyInflationRate,
      batteryDegradationRate,
      minBatteryCapacityFraction,
      batteryModel: batteryModelAssumptions,
      note:
        "Includes fastest payback, maximum lifetime net savings, selected battery vs no-battery comparison, and simple battery degradation.",
    },
  };
}

module.exports = {
  buildBatteryRecommendations,
  buildNoBatteryComparison,
  findBatteryCandidate,
  applyBatteryDegradationToCurve,
  selectBestPaybackCandidate,
  selectBestLifetimeSavingsCandidate,
};