const DESIGN_PREFERENCE_SCORING_VERSION = "2026-beta-1";

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getWeights(designPreferenceProfile = null) {
  return (
    designPreferenceProfile?.softPreferences?.weights || {
      lowUpfrontCost: 0.55,
      payback: 0.75,
      lifetimeSavings: 0.75,
      aesthetics: 0.5,
      warranty: 0.55,
      smartControls: 0.55,
      backup: 0.35,
      shadeResilience: 0.55,
    }
  );
}

function getPreferenceSignals(designPreferenceProfile = null) {
  return (
    designPreferenceProfile?.softPreferences?.preferenceSignals || {}
  );
}

function getHardwareMetadata(candidate = {}) {
  return candidate?.hardwareMetadataNormalisation?.products || {};
}

function getEstimatedInstalledCost(candidate = {}) {
  return numberOrNull(
    candidate?.financialModel?.systemCost?.estimatedInstalledCost ??
      candidate?.costModel?.estimatedInstalledCost ??
      candidate?.costModel?.estimatedTotalCost ??
      candidate?.costModel?.totalInstalledCost
  );
}

function getPaybackYears(candidate = {}) {
  return numberOrNull(
    candidate?.financialModel?.payback?.simplePaybackYears ??
      candidate?.financialModel?.payback?.paybackYear
  );
}

function getLifetimeSavings(candidate = {}) {
  return numberOrNull(candidate?.financialModel?.payback?.lifetimeSavings);
}

function getRange(candidates = [], getter) {
  const values = candidates
    .map(getter)
    .filter((value) => Number.isFinite(Number(value)));

  if (!values.length) {
    return {
      min: null,
      max: null,
    };
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function normaliseHigh(value, range = {}) {
  const n = numberOrNull(value);

  if (n === null) return 50;
  if (range.min === null || range.max === null) return 50;
  if (range.max <= range.min) return 75;

  return clamp(((n - range.min) / (range.max - range.min)) * 100);
}

function normaliseLow(value, range = {}) {
  const n = numberOrNull(value);

  if (n === null) return 50;
  if (range.min === null || range.max === null) return 50;
  if (range.max <= range.min) return 75;

  return clamp(((range.max - n) / (range.max - range.min)) * 100);
}

function scoreAesthetics(candidate = {}, designPreferenceProfile = null) {
  const metadata = getHardwareMetadata(candidate);
  const panel = metadata.panel || {};
  const signals = getPreferenceSignals(designPreferenceProfile);

  const allBlack = panel?.aesthetics?.allBlack;
  const preferredAesthetic = String(
    signals.panelAesthetic || "no_strong_preference"
  ).toLowerCase();

  if (
    preferredAesthetic.includes("black") ||
    preferredAesthetic.includes("premium")
  ) {
    if (allBlack === true) return 100;
    if (allBlack === false) return 20;
    return 50;
  }

  if (allBlack === true) return 85;
  if (allBlack === false) return 55;

  return 60;
}

function scoreWarranty(candidate = {}) {
  const metadata = getHardwareMetadata(candidate);

  const panelYears = numberOrNull(metadata?.panel?.warranties?.productYears);
  const inverterYears = numberOrNull(
    metadata?.inverter?.warranties?.productYears
  );
  const batteryExists = metadata?.battery?.exists === true;
  const batteryYears = numberOrNull(
    metadata?.battery?.warranties?.productYears
  );

  const scores = [];

  if (panelYears !== null) {
    scores.push(clamp((panelYears / 25) * 100));
  }

  if (inverterYears !== null) {
    scores.push(clamp((inverterYears / 10) * 100));
  }

  if (batteryExists && batteryYears !== null) {
    scores.push(clamp((batteryYears / 10) * 100));
  }

  if (!scores.length) return 50;

  return clamp(
    scores.reduce((sum, score) => sum + score, 0) / scores.length
  );
}

function scoreSmartControls(candidate = {}) {
  const metadata = getHardwareMetadata(candidate);
  const inverter = metadata.inverter || {};

  let score = 45;

  if (inverter?.capabilities?.monitoring === true) score += 25;
  if (inverter?.capabilities?.exportControl === true) score += 15;
  if (inverter?.capabilities?.hybrid === true) score += 10;
  if (inverter?.capabilities?.batteryCompatible === true) score += 5;

  if (
    inverter?.capabilities?.monitoring === false &&
    inverter?.capabilities?.exportControl === false
  ) {
    score -= 10;
  }

  return clamp(score);
}

function scoreBackup(candidate = {}) {
  const metadata = getHardwareMetadata(candidate);
  const inverter = metadata.inverter || {};
  const battery = metadata.battery || {};

  const backupCompatible = inverter?.capabilities?.backupCompatible;
  const batteryExists = battery?.exists === true;

  if (backupCompatible === true && batteryExists) return 100;
  if (backupCompatible === true && !batteryExists) return 75;
  if (backupCompatible === false && batteryExists) return 35;
  if (backupCompatible === false && !batteryExists) return 20;

  if (batteryExists) return 55;

  return 45;
}

function hasTag(metadataItem = {}, needles = []) {
  const tags = asArray(metadataItem.rawTags).map((tag) =>
    String(tag || "").toLowerCase()
  );

  return tags.some((tag) =>
    needles.some((needle) => tag.includes(String(needle).toLowerCase()))
  );
}

function scoreShadeResilience(candidate = {}) {
  const metadata = getHardwareMetadata(candidate);
  const inverter = metadata.inverter || {};
  const panel = metadata.panel || {};

  const inverterType = String(
    inverter?.classification?.inverterType || ""
  ).toLowerCase();

  if (
    inverterType.includes("micro") ||
    hasTag(inverter, ["microinverter", "module level"])
  ) {
    return 95;
  }

  if (
    hasTag(inverter, ["optimiser", "optimizer", "shade"]) ||
    hasTag(panel, ["shade", "optimiser", "optimizer"])
  ) {
    return 90;
  }

  const mpptCount = numberOrNull(inverter?.dcElectrical?.mpptCount);

  if (mpptCount !== null) {
    if (mpptCount >= 4) return 90;
    if (mpptCount >= 3) return 82;
    if (mpptCount >= 2) return 70;
    if (mpptCount === 1) return 45;
  }

  return 50;
}

function weightedAverage(componentScores = {}, weights = {}) {
  const rows = Object.entries(weights)
    .map(([key, weight]) => ({
      key,
      weight: numberOrZero(weight),
      score: numberOrNull(componentScores[key]),
    }))
    .filter((row) => row.weight > 0 && row.score !== null);

  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);

  if (totalWeight <= 0) return null;

  const total = rows.reduce(
    (sum, row) => sum + row.score * row.weight,
    0
  );

  return round2(total / totalWeight);
}

function getScoreBand(score) {
  const n = numberOrNull(score);

  if (n === null) return "unknown";
  if (n >= 85) return "excellent_preference_match";
  if (n >= 70) return "good_preference_match";
  if (n >= 55) return "fair_preference_match";
  return "weak_preference_match";
}

function buildPreferenceComponentScores({
  candidate = {},
  designPreferenceProfile = null,
  ranges = {},
} = {}) {
  return {
    lowUpfrontCost: round2(
      normaliseLow(getEstimatedInstalledCost(candidate), ranges.cost)
    ),
    payback: round2(
      normaliseLow(getPaybackYears(candidate), ranges.payback)
    ),
    lifetimeSavings: round2(
      normaliseHigh(getLifetimeSavings(candidate), ranges.lifetimeSavings)
    ),
    aesthetics: round2(
      scoreAesthetics(candidate, designPreferenceProfile)
    ),
    warranty: round2(scoreWarranty(candidate)),
    smartControls: round2(scoreSmartControls(candidate)),
    backup: round2(scoreBackup(candidate)),
    shadeResilience: round2(scoreShadeResilience(candidate)),
  };
}

function buildDesignPreferenceScoreForCandidate({
  candidate = {},
  designPreferenceProfile = null,
  ranges = {},
} = {}) {
  const weights = getWeights(designPreferenceProfile);

  const componentScores = buildPreferenceComponentScores({
    candidate,
    designPreferenceProfile,
    ranges,
  });

  const weightedScore = weightedAverage(componentScores, weights);

  const weightedContributions = Object.entries(weights).map(
    ([priorityId, weight]) => ({
      priorityId,
      weight: round2(weight),
      componentScore: componentScores[priorityId] ?? null,
      weightedContribution:
        componentScores[priorityId] !== null &&
        componentScores[priorityId] !== undefined
          ? round2(componentScores[priorityId] * numberOrZero(weight))
          : null,
    })
  );

  return {
    version: DESIGN_PREFERENCE_SCORING_VERSION,
    mode: "design_preference_soft_scoring_beta",

    candidateId: candidate?.candidateId || null,

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    selectedSystemType:
      designPreferenceProfile?.selectedSystemType || "balanced",

    weightedScore,
    scoreBand: getScoreBand(weightedScore),

    componentScores,
    weights,
    weightedContributions,

    dataInputs: {
      estimatedInstalledCost: getEstimatedInstalledCost(candidate),
      paybackYears: getPaybackYears(candidate),
      lifetimeSavings: getLifetimeSavings(candidate),
      hardwareMetadataAvailable:
        !!candidate?.hardwareMetadataNormalisation,
      financialModelMode:
        candidate?.financialModel?.mode || null,
    },

    assumptions: {
      note:
        "This score is diagnostic only. It measures how well a candidate appears to match soft user preferences but does not yet alter ranking or recommendations.",
    },

    limitations: [
      "Missing financial or catalogue data is treated neutrally rather than as a failure.",
      "The score is not yet used for candidate filtering.",
      "The score is not yet used for final ranking.",
    ],
  };
}

function applyDesignPreferenceScoringToCandidates({
  candidates = [],
  designPreferenceProfile = null,
} = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  const ranges = {
    cost: getRange(safeCandidates, getEstimatedInstalledCost),
    payback: getRange(safeCandidates, getPaybackYears),
    lifetimeSavings: getRange(safeCandidates, getLifetimeSavings),
  };

  return safeCandidates.map((candidate) => ({
    ...candidate,
    designPreferenceScore: buildDesignPreferenceScoreForCandidate({
      candidate,
      designPreferenceProfile,
      ranges,
    }),
  }));
}

function buildDesignPreferenceScoringSummary({ candidates = [] } = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  const scores = safeCandidates
    .map((candidate) => numberOrNull(candidate?.designPreferenceScore?.weightedScore))
    .filter((score) => score !== null);

  const averageScore =
    scores.length === 0
      ? null
      : round2(scores.reduce((sum, score) => sum + score, 0) / scores.length);

  const sorted = [...safeCandidates]
    .filter((candidate) =>
      Number.isFinite(Number(candidate?.designPreferenceScore?.weightedScore))
    )
    .sort(
      (a, b) =>
        Number(b.designPreferenceScore.weightedScore) -
        Number(a.designPreferenceScore.weightedScore)
    );

  const scoreBands = {};

  for (const candidate of safeCandidates) {
    const band = candidate?.designPreferenceScore?.scoreBand || "unknown";
    scoreBands[band] = (scoreBands[band] || 0) + 1;
  }

  return {
    version: DESIGN_PREFERENCE_SCORING_VERSION,
    mode: "design_preference_soft_scoring_summary_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    candidateCount: safeCandidates.length,
    scoredCandidateCount: scores.length,

    averageScore,

    topPreferenceMatchCandidateId:
      sorted[0]?.candidateId || null,
    topPreferenceMatchScore:
      sorted[0]?.designPreferenceScore?.weightedScore ?? null,

    scoreBands,

    assumptions: {
      note:
        "This summary is diagnostic only. It does not change optimiser ranking or recommendations.",
    },
  };
}

module.exports = {
  DESIGN_PREFERENCE_SCORING_VERSION,
  buildDesignPreferenceScoreForCandidate,
  applyDesignPreferenceScoringToCandidates,
  buildDesignPreferenceScoringSummary,
};