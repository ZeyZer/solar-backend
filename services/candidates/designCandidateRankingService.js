const DESIGN_CANDIDATE_RANKING_VERSION = "2026-beta-1";

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function clamp(value, min = 0, max = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function getCandidateStatus(candidate = {}) {
  return candidate?.filtering?.status || "unknown";
}

function isEligible(candidate = {}) {
  return candidate?.filtering?.eligibleForFutureOptimiser === true;
}

function isActiveFinancial(candidate = {}) {
  return (
    candidate?.financialModel?.mode === "candidate_hourly_financial_model_beta"
  );
}

function isFinitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function getInstalledCost(candidate = {}) {
  return numberOrZero(
    candidate?.financialModel?.systemCost?.estimatedInstalledCost ??
      candidate?.costModel?.estimatedInstalledCost ??
      candidate?.costModel?.estimatedHardwareAdder ??
      0
  );
}

function getAnnualBenefit(candidate = {}) {
  return numberOrZero(candidate?.financialModel?.annual?.totalAnnualBenefit);
}

function getSimplePayback(candidate = {}) {
  return numberOrZero(
    candidate?.financialModel?.payback?.simplePaybackYears ??
      candidate?.financialModel?.payback?.paybackYear
  );
}

function getLifetimeSavings(candidate = {}) {
  return numberOrZero(candidate?.financialModel?.payback?.lifetimeSavings);
}

function getAnnualGeneration(candidate = {}) {
  return numberOrZero(
    candidate?.dispatchModel?.annual?.generationKWh ??
      candidate?.performanceModel?.generation?.annualAfterClippingKWh ??
      candidate?.performanceModel?.generation?.annualGrossGenerationKWh
  );
}

function getSelfUsed(candidate = {}) {
  return numberOrZero(candidate?.dispatchModel?.annual?.selfUsedKWh);
}

function getSelfConsumptionPercent(candidate = {}) {
  const generation = getAnnualGeneration(candidate);
  const selfUsed = getSelfUsed(candidate);

  if (generation <= 0) return 0;

  return round2((selfUsed / generation) * 100);
}

function getSelectedSystemTypeFit(candidate = {}, selectedSystemType = "balanced") {
  const selected =
    candidate?.systemTypeFits?.[selectedSystemType] ||
    candidate?.selectedSystemTypeFit ||
    candidate?.systemTypeFits?.balanced ||
    null;

  return selected
    ? {
        systemType: selected.systemType,
        label: selected.label,
        score: round2(selected.score),
      }
    : null;
}

function getSelectedSystemTypeScore(candidate = {}, selectedSystemType = "balanced") {
  return numberOrZero(
    getSelectedSystemTypeFit(candidate, selectedSystemType)?.score
  );
}

function getBestFitSystemType(candidate = {}) {
  const best = candidate?.bestFitSystemType;

  return best
    ? {
        systemType: best.systemType,
        label: best.label,
        score: round2(best.score),
      }
    : null;
}

function getProductSummary(candidate = {}) {
  return {
    panel: candidate?.products?.panel || null,
    inverter: candidate?.products?.inverter || null,
    battery: candidate?.products?.battery || null,
  };
}

function getBatteryControlStrategy(candidate = {}) {
  return (
    candidate?.financialModel?.batteryControlStrategy ||
    candidate?.dispatchModel?.batteryControlStrategy ||
    null
  );
}

function summarizeCandidate(candidate = {}, rankingType = null, rankingScore = null) {
  const financial = candidate?.financialModel || {};
  const annual = financial?.annual || {};
  const payback = financial?.payback || {};

  return {
    candidateId: candidate?.candidateId || null,
    rankingType,
    rankingScore: round2(rankingScore),

    status: getCandidateStatus(candidate),
    eligibleForFutureOptimiser: isEligible(candidate),

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    products: getProductSummary(candidate),

    system: {
      totalPanels: candidate?.panelLayout?.totalPanels ?? null,
      systemSizeKwp: candidate?.panelLayout?.systemSizeKwp ?? null,
      arrayCount: Array.isArray(candidate?.panelLayout?.arrays)
        ? candidate.panelLayout.arrays.length
        : 0,
      batteryKWh:
        candidate?.dispatchModel?.battery?.usableCapacityKWh ??
        candidate?.financialModel?.batteryControlStrategy?.battery?.usableCapacityKWh ??
        null,
    },

    financial: {
      mode: financial?.mode || null,
      source: financial?.source || null,
      estimatedInstalledCost: getInstalledCost(candidate),
      annualBenefit: round2(annual?.totalAnnualBenefit),
      billSavings: round2(annual?.billSavings),
      segIncome: round2(annual?.segIncome),
      simplePaybackYears: round2(payback?.simplePaybackYears ?? payback?.paybackYear),
      lifetimeSavings: round2(payback?.lifetimeSavings),
      confidence: financial?.confidence?.level || null,
    },

    performance: {
      source: candidate?.performanceModel?.source || null,
      annualGenerationKWh: round2(getAnnualGeneration(candidate)),
      annualSelfUsedKWh: round2(getSelfUsed(candidate)),
      annualExportedKWh: round2(candidate?.dispatchModel?.annual?.exportedKWh),
      annualImportedKWh: round2(candidate?.dispatchModel?.annual?.importedKWh),
      selfConsumptionPercent: getSelfConsumptionPercent(candidate),
    },

    tariffAndControl: {
      tariffType:
        financial?.tariff?.after?.tariffType ||
        candidate?.dispatchModel?.tariff?.tariffType ||
        null,
      batteryControlStrategy: getBatteryControlStrategy(candidate),
    },

    selectedSystemTypeFit: null,
    bestFitSystemType: getBestFitSystemType(candidate),
  };
}

function summarizeCandidateWithFit(candidate, selectedSystemType, rankingType, rankingScore) {
  return {
    ...summarizeCandidate(candidate, rankingType, rankingScore),
    selectedSystemTypeFit: getSelectedSystemTypeFit(candidate, selectedSystemType),
  };
}

function pickLowest(candidates = [], getter, isValid = isFinitePositive) {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      value: Number(getter(candidate)),
    }))
    .filter((row) => isValid(row.value))
    .sort((a, b) => a.value - b.value);

  return ranked[0] || null;
}

function pickHighest(candidates = [], getter, isValid = (value) => Number.isFinite(Number(value))) {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      value: Number(getter(candidate)),
    }))
    .filter((row) => isValid(row.value))
    .sort((a, b) => b.value - a.value);

  return ranked[0] || null;
}

function normaliseHigh(value, min, max) {
  if (!Number.isFinite(Number(value))) return 0;
  if (max <= min) return 0.5;
  return clamp((Number(value) - min) / (max - min), 0, 1);
}

function normaliseLow(value, min, max) {
  if (!Number.isFinite(Number(value))) return 0;
  if (max <= min) return 0.5;
  return clamp((max - Number(value)) / (max - min), 0, 1);
}

function getMinMax(candidates = [], getter) {
  const values = candidates
    .map((candidate) => Number(getter(candidate)))
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return { min: 0, max: 0 };
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function buildBalancedScores(candidates = [], selectedSystemType = "balanced") {
  const paybackRange = getMinMax(candidates, getSimplePayback);
  const lifetimeRange = getMinMax(candidates, getLifetimeSavings);
  const benefitRange = getMinMax(candidates, getAnnualBenefit);
  const costRange = getMinMax(candidates, getInstalledCost);
  const selfConsumptionRange = getMinMax(candidates, getSelfConsumptionPercent);

  return candidates.map((candidate) => {
    const status = getCandidateStatus(candidate);

    const statusScore =
      status === "viable" ? 1 :
      status === "viable_with_warnings" ? 0.75 :
      0;

    const payback = getSimplePayback(candidate);
    const paybackScore = isFinitePositive(payback)
      ? normaliseLow(payback, paybackRange.min, paybackRange.max)
      : 0;

    const lifetimeScore = normaliseHigh(
      getLifetimeSavings(candidate),
      lifetimeRange.min,
      lifetimeRange.max
    );

    const benefitScore = normaliseHigh(
      getAnnualBenefit(candidate),
      benefitRange.min,
      benefitRange.max
    );

    const costScore = normaliseLow(
      getInstalledCost(candidate),
      costRange.min,
      costRange.max
    );

    const selfConsumptionScore = normaliseHigh(
      getSelfConsumptionPercent(candidate),
      selfConsumptionRange.min,
      selfConsumptionRange.max
    );

    const selectedFitScore = clamp(
      getSelectedSystemTypeScore(candidate, selectedSystemType) / 100,
      0,
      1
    );

    const score = round2(
      (
        paybackScore * 0.22 +
        lifetimeScore * 0.20 +
        benefitScore * 0.18 +
        costScore * 0.14 +
        selfConsumptionScore * 0.10 +
        selectedFitScore * 0.10 +
        statusScore * 0.06
      ) * 100
    );

    return {
      candidate,
      score,
      components: {
        paybackScore: round2(paybackScore * 100),
        lifetimeScore: round2(lifetimeScore * 100),
        benefitScore: round2(benefitScore * 100),
        costScore: round2(costScore * 100),
        selfConsumptionScore: round2(selfConsumptionScore * 100),
        selectedFitScore: round2(selectedFitScore * 100),
        statusScore: round2(statusScore * 100),
      },
    };
  });
}

function buildDesignCandidateRankingResults({
  candidates = [],
  selectedSystemType = "balanced",
} = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  const eligibleCandidates = safeCandidates.filter(isEligible);
  const activeFinancialCandidates = eligibleCandidates.filter(isActiveFinancial);

  const bestPayback = pickLowest(
    activeFinancialCandidates,
    getSimplePayback,
    isFinitePositive
  );

  const bestLifetimeSavings = pickHighest(
    activeFinancialCandidates,
    getLifetimeSavings,
    (value) => Number.isFinite(Number(value))
  );

  const lowestUpfrontCost = pickLowest(
    eligibleCandidates,
    getInstalledCost,
    isFinitePositive
  );

  const bestAnnualBenefit = pickHighest(
    activeFinancialCandidates,
    getAnnualBenefit,
    isFinitePositive
  );

  const bestSelectedSystemTypeFit = pickHighest(
    eligibleCandidates,
    (candidate) => getSelectedSystemTypeScore(candidate, selectedSystemType),
    isFinitePositive
  );

  const balancedRankings = buildBalancedScores(
    activeFinancialCandidates,
    selectedSystemType
  ).sort((a, b) => b.score - a.score);

  const balanced = balancedRankings[0] || null;

  const rankingResults = {
    bestPayback: bestPayback
      ? summarizeCandidateWithFit(
          bestPayback.candidate,
          selectedSystemType,
          "best_payback",
          bestPayback.value
        )
      : null,

    bestLifetimeSavings: bestLifetimeSavings
      ? summarizeCandidateWithFit(
          bestLifetimeSavings.candidate,
          selectedSystemType,
          "best_lifetime_savings",
          bestLifetimeSavings.value
        )
      : null,

    lowestUpfrontCost: lowestUpfrontCost
      ? summarizeCandidateWithFit(
          lowestUpfrontCost.candidate,
          selectedSystemType,
          "lowest_upfront_cost",
          lowestUpfrontCost.value
        )
      : null,

    bestAnnualBenefit: bestAnnualBenefit
      ? summarizeCandidateWithFit(
          bestAnnualBenefit.candidate,
          selectedSystemType,
          "best_annual_benefit",
          bestAnnualBenefit.value
        )
      : null,

    bestSelectedSystemTypeFit: bestSelectedSystemTypeFit
      ? summarizeCandidateWithFit(
          bestSelectedSystemTypeFit.candidate,
          selectedSystemType,
          "best_selected_system_type_fit",
          bestSelectedSystemTypeFit.value
        )
      : null,

    balanced: balanced
      ? {
          ...summarizeCandidateWithFit(
            balanced.candidate,
            selectedSystemType,
            "balanced",
            balanced.score
          ),
          balancedScoreComponents: balanced.components,
        }
      : null,
  };

  return {
    version: DESIGN_CANDIDATE_RANKING_VERSION,
    mode: "candidate_ranking_selected_tariff_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    selectedSystemType,

    counts: {
      totalCandidates: safeCandidates.length,
      eligibleCandidates: eligibleCandidates.length,
      activeFinancialCandidates: activeFinancialCandidates.length,
    },

    readiness:
      safeCandidates.length === 0
        ? "no_candidates_generated"
        : eligibleCandidates.length === 0
          ? "no_eligible_candidates"
          : activeFinancialCandidates.length === 0
            ? "no_active_financial_candidates"
            : "ranked_for_selected_tariff",

    rankings: rankingResults,

    keyCandidateIds: {
      bestPayback: rankingResults.bestPayback?.candidateId || null,
      bestLifetimeSavings: rankingResults.bestLifetimeSavings?.candidateId || null,
      lowestUpfrontCost: rankingResults.lowestUpfrontCost?.candidateId || null,
      bestAnnualBenefit: rankingResults.bestAnnualBenefit?.candidateId || null,
      bestSelectedSystemTypeFit:
        rankingResults.bestSelectedSystemTypeFit?.candidateId || null,
      balanced: rankingResults.balanced?.candidateId || null,
    },

    assumptions: {
      selectedTariffOnly: true,
      multiTariffScenarioOptimisation: false,
      note:
        "Candidate ranking is diagnostic only. It ranks candidates using the currently selected tariff and resolved battery control strategy. It does not yet change quote calculations, pricing, PDF output, frontend display or customer recommendations.",
    },

    limitations: [
      "Ranking uses beta candidate cost data, not live supplier pricing.",
      "Ranking uses one selected-tariff battery control strategy per candidate.",
      "It does not yet test multiple tariffs or multiple control strategies per candidate.",
      "The balanced score is an early diagnostic score and should be validated before being shown to customers.",
    ],
  };
}

module.exports = {
  DESIGN_CANDIDATE_RANKING_VERSION,
  buildDesignCandidateRankingResults,
};