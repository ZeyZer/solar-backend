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

  // Do not recommend a lifetime option that loses money overall.
  if (bestLifetimeSavings && bestLifetimeSavings.lifetimeNetSavings <= 0) {
    bestLifetimeSavings = null;
  }

  return bestLifetimeSavings;
}

function buildBatteryRecommendations({
  curve,
  batteryCostPerKWh,
  minRecommendedBatteryKWh,
  maxBatteryKWh,
  stepKWh,
  lifetimeYears = 25,
}) {
  const safeCurve = Array.isArray(curve) ? curve : [];

  const minRecommended = Number(minRecommendedBatteryKWh || 0);

  const candidates = safeCurve.filter(
    (x) => Number(x.batteryKWhUsable || 0) >= minRecommended
  );

  const bestPayback = selectBestPaybackCandidate(candidates, safeCurve);

  const bestLifetimeSavings =
    selectBestLifetimeSavingsCandidate(candidates);

  return {
    bestPayback,
    bestLifetimeSavings,
    curve: safeCurve,
    assumptions: {
      batteryCostPerKWh,
      minRecommendedBatteryKWh,
      maxBatteryKWh,
      stepKWh,
      lifetimeYears,
      note:
        "Includes recommendations for fastest payback and maximum lifetime net savings.",
    },
  };
}

module.exports = {
  buildBatteryRecommendations,
  selectBestPaybackCandidate,
  selectBestLifetimeSavingsCandidate,
};