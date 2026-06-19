const {
  listActivePanels,
  listActiveInverters,
  listActiveBatteries,
} = require("./hardwareCatalogService");

const {
  buildDesignCandidateFromInputs,
} = require("./designCandidateService");

const {
  buildCandidateShortlist,
} = require("./designCandidateShortlistService");

const {
  applyCandidateFiltering,
  summarizeFilteredCandidates,
} = require("./designCandidateFilterService");

const {
  buildDesignCandidateRankingResults,
} = require("./designCandidateRankingService");

const {
  buildCandidateScenarioSet,
} = require("./designCandidateScenarioService");

const {
  buildScenarioExpansionPlan,
} = require("./designCandidateScenarioExpansionService");

const {
  buildOptimisationFunnelPolicy,
} = require("./designOptimisationFunnelPolicyService");

const {
  buildDesignPreferenceProfile,
} = require("./designPreferenceProfileService");

const {
  applyDesignPreferenceConstraintEvaluations,
} = require("./designPreferenceConstraintEvaluationService");

const {
  applyHardwareMetadataNormalisationToCandidates,
  buildHardwareMetadataNormalisationSummary,
} = require("./hardwareMetadataNormalisationService");

const {
  buildPreferenceConstraintEnforcementReadiness,
} = require("./designPreferenceConstraintEnforcementReadinessService");

const {
  applyDesignPreferenceScoringToCandidates,
  buildDesignPreferenceScoringSummary,
} = require("./designPreferenceScoringService");

const {
  applyDiagnosticPruningPreviewToCandidates,
  buildDiagnosticPruningPreviewSummary,
} = require("./diagnosticCandidatePruningPreviewService");

const {
  attachSystemTypeFits,
} = require("./systemTypeFitService");

const {
  buildRoofGeometryInputModel,
  applyRoofGeometryAssumptionsToCandidates,
  buildRoofGeometryInputSummary,
} = require("./roofGeometryInputService");

const {
  buildManualRoofPolygonModel,
} = require("./manualRoofPolygonModelService");

const {
  applyRoofDesignConfidenceToCandidates,
  buildRoofDesignConfidenceSummary,
} = require("./roofDesignConfidenceService");

const {
  applyAreaPanelCapacityEstimatesToCandidates,
  buildAreaPanelCapacityEstimateSummary,
} = require("./areaPanelCapacityEstimatorService");

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
  return candidate?.filtering?.status || "unknown";
}

function getCandidateCost(candidate) {
  return numberOrZero(candidate?.costModel?.estimatedHardwareAdder);
}

function getCandidateSortScore(candidate) {
  const summary = candidate?.compatibility?.summary || {};
  const filtering = candidate?.filtering || {};

  const fail = numberOrZero(summary.fail);
  const warn = numberOrZero(summary.warn);
  const pass = numberOrZero(summary.pass);
  const cost = getCandidateCost(candidate);

  const rejectedPenalty = filtering.status === "rejected" ? 500 : 0;
  const viableBonus = filtering.status === "viable" ? 100 : 0;

  // This is not a recommendation score yet.
  // It is just a stable diagnostic sort order.
  return round2(
    1000 +
      viableBonus -
      rejectedPenalty -
      fail * 200 -
      warn * 40 +
      pass * 2 -
      cost / 500
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
  const roofGeometryInput = buildRoofGeometryInputModel({
    input: safeInput,
    quote: safeQuote,
  });

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

  const designPreferenceProfile = buildDesignPreferenceProfile({
    input: safeInput,
    quote: safeQuote,
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

        const filteredCandidate = applyCandidateFiltering(candidate);

        const systemTypeCandidate = attachSystemTypeFits(
          filteredCandidate,
          safeInput.systemType || "balanced"
        );

        candidates.push({
          ...systemTypeCandidate,

          candidateSetMetadata: {
            generatedBy: "designCandidateSetService",
            diagnosticSortScore: getCandidateSortScore(systemTypeCandidate),
            compatibilityStatus: getCandidateCompatibilityStatus(systemTypeCandidate),
            selectedSystemType: systemTypeCandidate.selectedSystemTypeFit?.systemType || "balanced",
            selectedSystemTypeFitScore: systemTypeCandidate.selectedSystemTypeFit?.score ?? null,
            bestFitSystemType: systemTypeCandidate.bestFitSystemType?.systemType || null,
            bestFitSystemTypeScore: systemTypeCandidate.bestFitSystemType?.score ?? null,
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
      viable: 0,
      viable_with_warnings: 1,
      rejected: 2,
      unknown: 3,
    };

    if (statusRank[aStatus] !== statusRank[bStatus]) {
      return statusRank[aStatus] - statusRank[bStatus];
    }

    const aScore = numberOrZero(a.candidateSetMetadata?.diagnosticSortScore);
    const bScore = numberOrZero(b.candidateSetMetadata?.diagnosticSortScore);

    if (aScore !== bScore) return bScore - aScore;

    return getCandidateCost(a) - getCandidateCost(b);
  });

  const hardwareMetadataCandidates =
    applyHardwareMetadataNormalisationToCandidates({
      candidates: sortedCandidates,
    });

  const preferenceEvaluatedCandidates =
    applyDesignPreferenceConstraintEvaluations({
      candidates: hardwareMetadataCandidates,
      designPreferenceProfile,
    });

  const preferenceScoredCandidates =
    applyDesignPreferenceScoringToCandidates({
      candidates: preferenceEvaluatedCandidates,
      designPreferenceProfile,
    });

  const pruningPreviewCandidates =
    applyDiagnosticPruningPreviewToCandidates({
      candidates: preferenceScoredCandidates,
    });

  const roofGeometryCandidates =
    applyRoofGeometryAssumptionsToCandidates({
      candidates: pruningPreviewCandidates,
      roofGeometryInput,
    });

  const roofGeometryInputSummary =
    buildRoofGeometryInputSummary({
      roofGeometryInput,
      candidates: roofGeometryCandidates,
    });
  
  const manualRoofPolygonModel = 
    buildManualRoofPolygonModel({
      roofGeometryInput,
    });

  const roofDesignConfidenceCandidates =
    applyRoofDesignConfidenceToCandidates({
      candidates: roofGeometryCandidates,
      roofGeometryInput,
      manualRoofPolygonModel,
    });

  const roofDesignConfidenceSummary =
    buildRoofDesignConfidenceSummary({
      candidates: roofDesignConfidenceCandidates,
    });

  const areaPanelCapacityCandidates =
    applyAreaPanelCapacityEstimatesToCandidates({
      candidates: roofDesignConfidenceCandidates,
      roofGeometryInput,
    });

  const areaPanelCapacityEstimateSummary =
    buildAreaPanelCapacityEstimateSummary({
      candidates: areaPanelCapacityCandidates,
    });

  const hardwareMetadataSummary =
    buildHardwareMetadataNormalisationSummary({
      candidates: pruningPreviewCandidates,
    });

  const preferenceConstraintEnforcementReadiness =
    buildPreferenceConstraintEnforcementReadiness({
      candidates: pruningPreviewCandidates,
      designPreferenceProfile,
    });

  const designPreferenceScoringSummary =
    buildDesignPreferenceScoringSummary({
      candidates: pruningPreviewCandidates,
    });

  const diagnosticPruningPreviewSummary =
    buildDiagnosticPruningPreviewSummary({
      candidates: pruningPreviewCandidates,
      recommendedCarryForwardLimit: 12,
    });

  const summary = summarizeFilteredCandidates(areaPanelCapacityCandidates);

  const selectedSystemType =
    designPreferenceProfile?.selectedSystemType || safeInput.systemType || "balanced";

  const optimiserResults = buildDesignCandidateRankingResults({
    candidates: areaPanelCapacityCandidates,
    selectedSystemType,
  });

  const shortlist = buildCandidateShortlist({
    candidates: areaPanelCapacityCandidates,
    selectedSystemType,
    maxShortlist: 8,
    maxRejectedExamples: 5,
  });

  const scenarioSet = buildCandidateScenarioSet({
    candidates: areaPanelCapacityCandidates,
    selectedSystemType,
  });

  const scenarioExpansionPlan = buildScenarioExpansionPlan({
    candidates: areaPanelCapacityCandidates,
    shortlist,
    optimiserResults,
    maxCandidates: 8,
    maxScenariosPerCandidate: 3,
  });

  const optimisationFunnelPolicy = buildOptimisationFunnelPolicy({
    input: safeInput,
    quote: safeQuote,
    candidates: areaPanelCapacityCandidates,
    shortlist,
    optimiserResults,
    scenarioExpansionPlan,
  });

  return {
    version: DESIGN_CANDIDATE_SET_VERSION,
    mode: "candidate_set_foundation",
    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    inputSummary: {
      batteryKWh: round2(batteryKWh),
      roofArrayCount: activeRoofs.length,
      selectedSystemType,
      includeAlternativePanels,
      maxBatteryCandidates,
      maxCandidates,
    },

    productSearchSpace: {
      panelCandidateCount: panelCandidates.length,
      inverterCandidateCount: inverterCandidates.length,
      batteryCandidateCount: batteryCandidates.length,
      candidateCount: areaPanelCapacityCandidates.length,
    },

    summary,
    designPreferenceProfile,
    hardwareMetadataSummary,
    preferenceConstraintEnforcementReadiness,
    designPreferenceScoringSummary,
    diagnosticPruningPreviewSummary,
    roofGeometryInput,
    roofGeometryInputSummary,
    manualRoofPolygonModel,
    roofDesignConfidenceSummary,
    areaPanelCapacityEstimateSummary,
    shortlist,

    candidates: areaPanelCapacityCandidates,

    optimiserResults,
    scenarioSet,
    scenarioExpansionPlan,
    optimisationFunnelPolicy,

    placeholders: {
      bestPaybackCandidate: optimiserResults.keyCandidateIds.bestPayback,
      bestLifetimeSavingsCandidate:
        optimiserResults.keyCandidateIds.bestLifetimeSavings,
      balancedCandidate: optimiserResults.keyCandidateIds.balanced,
      lowestUpfrontCostCandidate:
        optimiserResults.keyCandidateIds.lowestUpfrontCost,
      bestAnnualBenefitCandidate:
        optimiserResults.keyCandidateIds.bestAnnualBenefit,
      bestSelectedSystemTypeFitCandidate:
        optimiserResults.keyCandidateIds.bestSelectedSystemTypeFit,
      premiumIntegratedCandidate: null,
      shadedRoofOptimisedCandidate: null,
    },

    assumptions: {
      filteringEnabled: true,
      shortlistEnabled: true,
      usedForCalculation: false,
      usedForPricing: false,
      usedForRecommendation: false,
      note:
        "Candidate set generation, filtering and ranking are backend-only and diagnostic. They do not yet change quote calculations, pricing, PV generation, battery dispatch, PDF output or customer-facing recommendations.",
    },
  };
}

module.exports = {
  DESIGN_CANDIDATE_SET_VERSION,
  buildCandidateSetFromInputs,
};