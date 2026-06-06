const {
  listActivePanels,
  listActiveInverters,
  listActiveBatteries,
} = require("./hardwareCatalogService");

const {
  buildDesignCandidateFromInputs,
} = require("./designCandidateService");

const DESIGN_CANDIDATE_SET_VERSION = "2026-beta-1";

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function getBatteryKWh({ quote = {}, input = {} } = {}) {
  return Number(
    input.batteryKWh ??
      quote?.hourlyModel?._batteryKWh ??
      0
  );
}

function getActiveRoofs({ input = {}, roofs = null } = {}) {
  const sourceRoofs = Array.isArray(roofs)
    ? roofs
    : Array.isArray(input.roofs)
      ? input.roofs
      : [];

  return sourceRoofs.filter((roof) => Number(roof.panels || 0) > 0);
}

function getPanelCandidates({ input = {}, includeAlternativePanels = true } = {}) {
  const panels = listActivePanels();

  if (includeAlternativePanels) {
    return panels;
  }

  const preferred = String(input.panelOption || "value");

  return panels.filter((panel) => String(panel.panelOption || "") === preferred);
}

function getInverterCandidates({ batteryKWh = 0 } = {}) {
  return listActiveInverters()
    .filter((inverter) => Number(inverter.maxPvInputKW || 0) > 0)
    .filter((inverter) => {
      if (Number(batteryKWh || 0) > 0) {
        return inverter.batteryCompatible !== false;
      }

      return true;
    });
}

function getBatteryCandidates({
  batteryKWh = 0,
  maxBatteryCandidates = 5,
} = {}) {
  if (Number(batteryKWh || 0) <= 0) {
    return [null];
  }

  return listActiveBatteries()
    .sort((a, b) => {
      const target = Number(batteryKWh || 0);

      const aDistance = Math.abs(Number(a.usableCapacityKWh || 0) - target);
      const bDistance = Math.abs(Number(b.usableCapacityKWh || 0) - target);

      if (aDistance !== bDistance) return aDistance - bDistance;

      return Number(a.usableCapacityKWh || 0) - Number(b.usableCapacityKWh || 0);
    })
    .slice(0, maxBatteryCandidates);
}

function getCandidateCompatibilityStatus(candidate) {
  const summary = candidate?.compatibility?.summary || {};

  if (numberOrZero(summary.fail) > 0) return "fail";
  if (numberOrZero(summary.warn) > 0) return "warn";

  return "pass";
}

function getCandidateCost(candidate) {
  return numberOrZero(candidate?.costModel?.estimatedHardwareAdder);
}

function getCandidateSortScore(candidate) {
  const summary = candidate?.compatibility?.summary || {};
  const fail = numberOrZero(summary.fail);
  const warn = numberOrZero(summary.warn);
  const pass = numberOrZero(summary.pass);
  const cost = getCandidateCost(candidate);

  // This is not a recommendation score yet.
  // It is just a stable diagnostic sort order.
  return round2(
    1000 -
      fail * 200 -
      warn * 40 +
      pass * 2 -
      cost / 500
  );
}

function summarizeCandidateSet(candidates) {
  return candidates.reduce(
    (summary, candidate) => {
      summary.total += 1;

      const status = getCandidateCompatibilityStatus(candidate);

      summary[status] = (summary[status] || 0) + 1;

      return summary;
    },
    {
      total: 0,
      pass: 0,
      warn: 0,
      fail: 0,
    }
  );
}

function buildCandidateSetFromInputs({
  quote = null,
  input = null,
  roofs = null,
  includeAlternativePanels = true,
  maxBatteryCandidates = 5,
  maxCandidates = 50,
} = {}) {
  const safeQuote = quote || {};
  const safeInput = input || {};
  const activeRoofs = getActiveRoofs({ input: safeInput, roofs });

  const batteryKWh = getBatteryKWh({
    quote: safeQuote,
    input: safeInput,
  });

  const panelCandidates = getPanelCandidates({
    input: safeInput,
    includeAlternativePanels,
  });

  const inverterCandidates = getInverterCandidates({
    batteryKWh,
  });

  const batteryCandidates = getBatteryCandidates({
    batteryKWh,
    maxBatteryCandidates,
  });

  const candidates = [];

  for (const panel of panelCandidates) {
    for (const inverter of inverterCandidates) {
      for (const battery of batteryCandidates) {
        if (candidates.length >= maxCandidates) break;

        const candidate = buildDesignCandidateFromInputs({
          quote: safeQuote,
          input: safeInput,
          roofs: activeRoofs,
          panelId: panel?.id || null,
          inverterId: inverter?.id || null,
          batteryId: battery?.id || null,
        });

        candidates.push({
          ...candidate,

          candidateSetMetadata: {
            generatedBy: "designCandidateSetService",
            diagnosticSortScore: getCandidateSortScore(candidate),
            compatibilityStatus: getCandidateCompatibilityStatus(candidate),
            usedForCalculation: false,
            usedForRecommendation: false,
          },
        });
      }
    }
  }

  const sortedCandidates = [...candidates].sort((a, b) => {
    const aStatus = getCandidateCompatibilityStatus(a);
    const bStatus = getCandidateCompatibilityStatus(b);

    const statusRank = {
      pass: 0,
      warn: 1,
      fail: 2,
    };

    if (statusRank[aStatus] !== statusRank[bStatus]) {
      return statusRank[aStatus] - statusRank[bStatus];
    }

    const aScore = numberOrZero(a.candidateSetMetadata?.diagnosticSortScore);
    const bScore = numberOrZero(b.candidateSetMetadata?.diagnosticSortScore);

    if (aScore !== bScore) return bScore - aScore;

    return getCandidateCost(a) - getCandidateCost(b);
  });

  const summary = summarizeCandidateSet(sortedCandidates);

  return {
    version: DESIGN_CANDIDATE_SET_VERSION,
    mode: "candidate_set_foundation",
    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    inputSummary: {
      batteryKWh: round2(batteryKWh),
      roofArrayCount: activeRoofs.length,
      includeAlternativePanels,
      maxBatteryCandidates,
      maxCandidates,
    },

    productSearchSpace: {
      panelCandidateCount: panelCandidates.length,
      inverterCandidateCount: inverterCandidates.length,
      batteryCandidateCount: batteryCandidates.length,
      candidateCount: sortedCandidates.length,
    },

    summary,

    candidates: sortedCandidates,

    placeholders: {
      bestPaybackCandidate: null,
      bestLifetimeSavingsCandidate: null,
      balancedCandidate: null,
      lowestUpfrontCostCandidate: null,
      premiumIntegratedCandidate: null,
      shadedRoofOptimisedCandidate: null,
    },

    assumptions: {
      note:
        "Candidate set generation is backend-only and diagnostic. It does not yet change quote calculations, pricing, PV generation, battery dispatch or recommendations.",
    },
  };
}

module.exports = {
  DESIGN_CANDIDATE_SET_VERSION,
  buildCandidateSetFromInputs,
};