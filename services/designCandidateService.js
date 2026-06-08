const {
  listActivePanels,
  listActiveInverters,
  findPanelById,
  findInverterById,
  findBatteryById,
  findClosestBatteryByUsableKWh,
} = require("./hardwareCatalogService");

const {
  buildDesignCompatibilityPreview,
} = require("./designCompatibilityService");

const {
  buildDesignCandidateCostModel,
} = require("./designCandidateCostService");

const DESIGN_CANDIDATE_SCHEMA_VERSION = "2026-beta-1";

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getActiveArrays(roofs = []) {
  return (Array.isArray(roofs) ? roofs : [])
    .filter((roof) => Number(roof.panels || 0) > 0)
    .map((roof, index) => ({
      id: roof.id || `array_${index + 1}`,
      index,
      orientation: roof.orientation || "unknown",
      tilt: Number(roof.tilt || 0),
      shading: roof.shading || "none",
      panels: Number(roof.panels || 0),
      sourceRoof: roof,
    }));
}

function getTotalPanels(arrays = []) {
  return arrays.reduce((sum, array) => sum + Number(array.panels || 0), 0);
}

function getPanelForCandidate({ panelId, panelOption = "value" } = {}) {
  if (panelId) {
    return findPanelById(panelId);
  }

  const panels = listActivePanels();
  const option = String(panelOption || "value");

  return (
    panels.find((panel) => String(panel.panelOption || "") === option) ||
    panels[0] ||
    null
  );
}

function getSystemSizeKwp({ panel, totalPanels, fallbackSystemSizeKwp }) {
  if (panel?.wattage && totalPanels > 0) {
    return round2((Number(panel.wattage) * Number(totalPanels)) / 1000);
  }

  return round2(fallbackSystemSizeKwp || 0);
}

function chooseInverterForCandidate({
  inverterId,
  systemSizeKwp,
  batteryKWh,
} = {}) {
  if (inverterId) {
    return findInverterById(inverterId);
  }

  const inverters = listActiveInverters()
    .filter((inverter) => Number(inverter.maxPvInputKW || 0) > 0)
    .filter((inverter) => {
      if (Number(batteryKWh || 0) > 0) {
        return inverter.batteryCompatible !== false;
      }

      return true;
    })
    .sort((a, b) => {
      const aFits = Number(a.maxPvInputKW || 0) >= Number(systemSizeKwp || 0);
      const bFits = Number(b.maxPvInputKW || 0) >= Number(systemSizeKwp || 0);

      if (aFits !== bFits) return aFits ? -1 : 1;

      const aCost = Number(a.pricing?.estimatedInstalledAdder || a.pricing?.materialCost || 0);
      const bCost = Number(b.pricing?.estimatedInstalledAdder || b.pricing?.materialCost || 0);

      if (aCost !== bCost) return aCost - bCost;

      return Number(a.maxAcOutputKW || 0) - Number(b.maxAcOutputKW || 0);
    });

  return inverters[0] || null;
}

function chooseBatteryForCandidate({ batteryId, batteryKWh } = {}) {
  if (batteryId) {
    return findBatteryById(batteryId);
  }

  if (Number(batteryKWh || 0) <= 0) {
    return null;
  }

  return findClosestBatteryByUsableKWh(batteryKWh);
}

function sanitizeProduct(product) {
  if (!product) return null;

  return {
    id: product.id,
    brand: product.brand,
    model: product.model,
    category: product.category,
    isPlaceholder: !!product.isPlaceholder,
  };
}

function buildPanelLayout({ arrays, panel, systemSizeKwp }) {
  const totalPanels = getTotalPanels(arrays);

  return {
    layoutMode: "roof_array_from_user_inputs",
    source: "quote_roof_inputs",
    usedForCalculation: false,

    panelProductId: panel?.id || null,
    totalPanels,
    systemSizeKwp,

    arrays: arrays.map((array) => ({
      id: array.id,
      roofIndex: array.index,
      orientation: array.orientation,
      tilt: array.tilt,
      shading: array.shading,
      panelCount: array.panels,
      panelProductId: panel?.id || null,
      estimatedArrayKwp: panel?.wattage
        ? round2((Number(panel.wattage) * Number(array.panels || 0)) / 1000)
        : null,
    })),

    limitations: [
      "Panel layout is currently based on user-selected roof panel counts.",
      "No roof dimensions, obstacle placement or physical panel layout optimisation is applied yet.",
      "This layout does not yet check mounting type, fire setbacks, access zones or row spacing.",
    ],
  };
}

function buildStringPlan({ arrays, inverter }) {
  const mppts = inverter?.dcInput?.mppts || [];

  return {
    stringPlanMode: "one_roof_array_per_mppt_beta",
    usedForCalculation: false,

    inverterProductId: inverter?.id || null,
    mpptCount: Number(inverter?.dcInput?.mpptCount || 0),
    arrayCount: arrays.length,

    strings: arrays.map((array, index) => {
      const mppt = mppts[index] || null;

      return {
        id: `string_${index + 1}`,
        sourceArrayId: array.id,
        panelsInSeries: array.panels,
        parallelStrings: 1,
        assignedMpptId: mppt?.id || null,
        assignmentStatus: mppt ? "assigned" : "no_mppt_available",
      };
    }),

    limitations: [
      "Each roof array is currently treated as one string.",
      "The service does not yet split large arrays across multiple strings.",
      "The service does not yet combine matching arrays onto one MPPT.",
      "The service does not yet optimise stringing for exact inverter manufacturer rules.",
    ],
  };
}

function buildEmptyPerformanceModel() {
  return {
    mode: "not_modelled_in_candidate_yet",
    usedForCalculation: false,
    note:
      "Candidate-specific PV generation, clipping, battery dispatch and tariff performance are not yet modelled here. The existing quote engine still provides performance calculations.",
  };
}

function buildEmptyFinancialModel() {
  return {
    mode: "not_modelled_in_candidate_yet",
    usedForCalculation: false,
    note:
      "Candidate-specific payback, lifetime savings and balanced scoring are not yet modelled here. The existing quote engine still provides financial calculations.",
  };
}

function buildScoringPlaceholder() {
  return {
    mode: "schema_placeholder",
    usedForRecommendation: false,

    scores: {
      payback: null,
      lifetimeSavings: null,
      balanced: null,
      upfrontCost: null,
      warranty: null,
      optimisation: null,
      compatibility: null,
    },

    futureOutputs: [
      "bestPaybackCandidate",
      "bestLifetimeSavingsCandidate",
      "balancedCandidate",
      "lowestUpfrontCostCandidate",
      "premiumIntegratedCandidate",
      "shadedRoofOptimisedCandidate",
    ],

    note:
      "Scoring will be added once candidate-level cost, performance and financial models are connected.",
  };
}

function buildDesignCandidateFromInputs({
  quote = null,
  input = null,
  roofs = null,
  panelId = null,
  inverterId = null,
  batteryId = null,
} = {}) {
  const safeQuote = quote || {};
  const safeInput = input || {};

  const activeRoofs = Array.isArray(roofs)
    ? roofs
    : Array.isArray(safeInput.roofs)
      ? safeInput.roofs
      : [];

  const arrays = getActiveArrays(activeRoofs);

  const batteryKWh = Number(
    safeInput.batteryKWh ??
      safeQuote?.hourlyModel?._batteryKWh ??
      0
  );

  const panel = getPanelForCandidate({
    panelId,
    panelOption: safeInput.panelOption || safeQuote.panelOption || "value",
  });

  const totalPanels =
    getTotalPanels(arrays) ||
    Number(safeInput.panelCount || 0) ||
    Number(safeQuote.panelCount || 0);

  const systemSizeKwp = getSystemSizeKwp({
    panel,
    totalPanels,
    fallbackSystemSizeKwp: safeQuote.systemSizeKwp,
  });

  const inverter = chooseInverterForCandidate({
    inverterId,
    systemSizeKwp,
    batteryKWh,
  });

  const battery = chooseBatteryForCandidate({
    batteryId,
    batteryKWh,
  });

  const compatibility = buildDesignCompatibilityPreview({
    quote: safeQuote,
    input: safeInput,
    roofs: activeRoofs,
    panelId: panel?.id || null,
    inverterId: inverter?.id || null,
    batteryId: battery?.id || null,
  });

  const panelLayout = buildPanelLayout({
    arrays,
    panel,
    systemSizeKwp,
  });

  const stringPlan = buildStringPlan({
    arrays,
    inverter,
  });

  const costModel = buildDesignCandidateCostModel({
    candidate: {
      compatibility: {
        summary: compatibility.summary,
        optimisationFlags: compatibility.optimisationFlags,
      },
    },
    panel,
    inverter,
    battery,
    arrays,
    roofs: activeRoofs,
    totalPanels,
  });

  return {
    version: DESIGN_CANDIDATE_SCHEMA_VERSION,
    mode: "candidate_schema_foundation",
    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    candidateId: [
      panel?.id || "no-panel",
      inverter?.id || "no-inverter",
      battery?.id || "no-battery",
      `${totalPanels || 0}-panels`,
    ].join("__"),

    inputs: {
      source: "quote_inputs",
      panelOption: safeInput.panelOption || safeQuote.panelOption || "value",
      requestedBatteryKWh: round2(batteryKWh),
      totalPanels,
      arrayCount: arrays.length,
    },

    systemType: {
      selected: safeInput.systemType || "not_selected",
      filtersApplied: false,
      note:
        "System type filtering is not implemented yet. Later this can narrow candidates by budget, premium, backup, monitoring, warranty, aesthetics, G100/export control or shaded-roof optimisation.",
    },

    panelLayout,
    stringPlan,

    products: {
      panel: sanitizeProduct(panel),
      inverter: sanitizeProduct(inverter),
      battery: sanitizeProduct(battery),
    },

    compatibility: {
      mode: compatibility.mode,
      usedForCalculation: compatibility.usedForCalculation,
      summary: compatibility.summary,
      checks: compatibility.checks,
      optimisationFlags: compatibility.optimisationFlags,
    },

    costModel,
    performanceModel: buildEmptyPerformanceModel(),
    financialModel: buildEmptyFinancialModel(),
    scoring: buildScoringPlaceholder(),

    roadmap: {
      nextSteps: [
        "Generate multiple candidate panel layouts",
        "Generate multiple string plans per layout",
        "Filter compatible inverter and battery products",
        "Connect candidate-level cost model",
        "Connect candidate-level PV and battery simulation",
        "Score candidates for payback, lifetime savings and balanced recommendation",
      ],
    },
  };
}

module.exports = {
  DESIGN_CANDIDATE_SCHEMA_VERSION,
  buildDesignCandidateFromInputs,
};