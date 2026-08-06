const DESIGN_OPTIMISATION_FUNNEL_POLICY_VERSION = "2026-beta-1";

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normaliseId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getRoofs(input = {}) {
  return asArray(input.roofs || input.roofDetails || input.arrays);
}

function getPanelCount(roof = {}) {
  return numberOrZero(
    roof.panels ??
      roof.panelCount ??
      roof.numberOfPanels ??
      roof.modules ??
      0
  );
}

function getShadingLevel(roof = {}) {
  return String(roof.shading || roof.shade || "unknown").toLowerCase();
}

function isMeaningfullyShaded(roof = {}) {
  const shading = getShadingLevel(roof);

  return [
    "some",
    "medium",
    "moderate",
    "high",
    "a_lot",
    "heavy",
    "row_shading",
    "partial",
  ].includes(shading);
}

function getOrientation(roof = {}) {
  return String(roof.orientation || roof.azimuthLabel || "unknown").toUpperCase();
}

function getTilt(roof = {}) {
  return roof.tilt ?? roof.pitch ?? null;
}

function getRoofGroupKey(roof = {}) {
  return [
    getOrientation(roof),
    getTilt(roof) ?? "unknown_tilt",
    getShadingLevel(roof),
  ].join("__");
}

function detectRoofTopologyRisks(input = {}) {
  const roofs = getRoofs(input);

  const risks = [];

  const groups = new Map();

  for (const roof of roofs) {
    const panelCount = getPanelCount(roof);
    const roofId = roof.id || roof.roofId || `roof-${risks.length + 1}`;

    if (panelCount > 0 && panelCount <= 3) {
      risks.push({
        riskId: `short_string_risk__${normaliseId(roofId)}`,
        riskType: "short_string_voltage_risk",
        severity: "high",
        roofId,
        panelCount,
        reason:
          "This roof section may only support a very short string. Higher-voltage panels, optimisers, microinverters, or a different inverter MPPT window may be needed.",
      });
    }

    if (panelCount > 3 && panelCount <= 5) {
      risks.push({
        riskId: `marginal_string_risk__${normaliseId(roofId)}`,
        riskType: "marginal_string_voltage_risk",
        severity: "medium",
        roofId,
        panelCount,
        reason:
          "This roof section may create a marginal string length. Panel Vmp, MPPT operating range and hot-condition voltage should be checked before pruning panel options.",
      });
    }

    if (isMeaningfullyShaded(roof)) {
      risks.push({
        riskId: `shade_group_risk__${normaliseId(roofId)}`,
        riskType: "shade_zone_mismatch_risk",
        severity: "medium",
        roofId,
        panelCount,
        reason:
          "This roof section has shading risk. The optimiser should consider separate MPPTs, alternative stringing, optimisers or microinverters before final pruning.",
      });
    }

    const groupKey = getRoofGroupKey(roof);

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }

    groups.get(groupKey).push(roof);
  }

  if (groups.size > 1) {
    risks.push({
      riskId: "mixed_array_group_risk",
      riskType: "mixed_orientation_tilt_or_shading_risk",
      severity: "medium",
      groupCount: groups.size,
      reason:
        "The design appears to have multiple array groups with different orientation, tilt or shading. The optimiser should consider MPPT allocation and string grouping before inverter pruning.",
    });
  }

  return risks;
}

function buildPanelPreservationRules({ topologyRisks = [] } = {}) {
  const hasShortStringRisk = topologyRisks.some((risk) =>
    [
      "short_string_voltage_risk",
      "marginal_string_voltage_risk",
    ].includes(risk.riskType)
  );

  const hasShadeRisk = topologyRisks.some(
    (risk) => risk.riskType === "shade_zone_mismatch_risk"
  );

  return [
    {
      categoryId: "best_value",
      label: "Best value panel family",
      preserveAtLeast: 1,
      reason:
        "Keep the strongest £/kWp option so the optimiser can still recommend a low-cost system.",
    },
    {
      categoryId: "maximum_kwp",
      label: "Maximum kWp panel family",
      preserveAtLeast: 1,
      reason:
        "Keep high-output panels so the optimiser can compare maximum roof utilisation against best economics.",
    },
    {
      categoryId: "high_voltage_rescue",
      label: "High-voltage electrical rescue panel family",
      preserveAtLeast: hasShortStringRisk ? 2 : 1,
      reason:
        "Keep panels with stronger voltage characteristics because they may make short or marginal strings viable with certain inverter MPPT windows.",
    },
    {
      categoryId: "compact_layout_rescue",
      label: "Compact layout rescue panel family",
      preserveAtLeast: 1,
      reason:
        "Keep compact panel options because smaller modules can sometimes increase panel count or solve awkward roof-space constraints.",
    },
    {
      categoryId: "premium_aesthetic",
      label: "Premium/aesthetic panel family",
      preserveAtLeast: 1,
      reason:
        "Keep premium all-black or aesthetic options for customers who value appearance, especially on visible roof faces.",
    },
    {
      categoryId: "long_warranty",
      label: "Long-warranty panel family",
      preserveAtLeast: 1,
      reason:
        "Keep high-warranty panel options for customers prioritising long-term durability and premium specification.",
    },
    {
      categoryId: "shade_resilience",
      label: "Shade-resilient panel/topology family",
      preserveAtLeast: hasShadeRisk ? 2 : 1,
      reason:
        "Keep options that may work better with shaded strings, optimisers, microinverters or separate MPPTs.",
    },
  ];
}

function buildElectricalTopologyRules({ topologyRisks = [] } = {}) {
  return {
    groupingPrinciple:
      "Panels should be grouped by materially similar irradiance and electrical behaviour, not just by roof face.",

    arrayGroupSignals: [
      "orientation",
      "tilt",
      "row-level shading",
      "shade timing",
      "string length",
      "roof face",
      "panel electrical characteristics",
    ],

    mpptAllocationRules: [
      {
        ruleId: "separate_materially_different_shade_zones",
        label: "Separate materially different shade zones where worthwhile",
        reason:
          "Two rows on the same roof face may deserve separate MPPTs if one row is shaded often and the other is not.",
      },
      {
        ruleId: "avoid_short_string_pruning",
        label: "Do not prune high-voltage panels too early",
        reason:
          "A higher-voltage panel may make a short string viable on an inverter that would otherwise be rejected.",
      },
      {
        ruleId: "compare_single_string_vs_split_string",
        label: "Compare single-string and split-string topologies",
        reason:
          "A 10-panel array may perform better as two 5-panel strings if one row is regularly shaded, provided voltage and MPPT limits work.",
      },
      {
        ruleId: "optimiser_microinverter_fallback",
        label: "Preserve optimiser and microinverter fallback paths",
        reason:
          "Where MPPT separation is not practical, module-level electronics may provide better annual yield despite higher cost.",
      },
    ],

    riskSummary: topologyRisks.map((risk) => ({
      riskId: risk.riskId,
      riskType: risk.riskType,
      severity: risk.severity,
      reason: risk.reason,
    })),
  };
}

function buildInverterEnvelopeRules() {
  return {
    purpose:
      "Use roof layout skeletons and electrical topology risks to reduce the inverter catalogue before final product-level solving.",

    requiredChecks: [
      "single-phase or three-phase suitability",
      "estimated DC system size range",
      "acceptable DC/AC oversizing range",
      "number of useful independent MPPTs",
      "MPPT operating voltage range",
      "startup voltage",
      "maximum cold-weather string Voc",
      "maximum string current",
      "hybrid battery compatibility",
      "backup capability",
      "export control / G100 capability",
      "optimiser or microinverter compatibility where required",
    ],

    pruningWarning:
      "The inverter envelope should narrow the catalogue but should not remove all options for a difficult roof section until high-voltage panels, compact panels, optimisers and microinverters have been considered.",
  };
}

function buildBatterySizingRules() {
  return {
    principle:
      "Battery sizing should be target-led before product matching. The optimiser should estimate useful capacity targets by tariff family, then map those targets to real battery stacks.",

    targetInputs: [
      "annual and hourly household load",
      "PV generation profile",
      "tariff family",
      "export rate",
      "grid charging availability",
      "battery round-trip efficiency",
      "battery cost",
      "battery power limits",
      "backup requirement",
    ],

    tariffFamilies: [
      {
        family: "standard",
        likelyControl: "self_consumption",
        sizingAim:
          "Size mainly to absorb excess daytime solar for evening/night household use.",
      },
      {
        family: "time_of_use",
        likelyControl: "timed_grid_charge",
        sizingAim:
          "Size to combine solar storage with off-peak grid charging and peak-rate avoidance.",
      },
      {
        family: "smart_import_export",
        likelyControl: "smart_import_export",
        sizingAim:
          "Size for solar storage, grid charging, export windows and higher cycling potential.",
      },
      {
        family: "backup_ready",
        likelyControl: "backup_reserve",
        sizingAim:
          "Size for resilience needs as well as financial return.",
      },
    ],

    productMatching:
      "After estimating the target usable capacity, test the nearest real battery stack below and above the target rather than every possible battery size.",
  };
}

function buildScenarioTestingRules() {
  return {
    principle:
      "Run expensive hourly tariff/control scenario simulations late, and only on shortlisted candidates.",

    recommendedLimits: {
      maxCandidatesForScenarioExpansion: 8,
      maxScenarioFamiliesPerCandidate: 3,
    },

    scenarioFamilies: [
      "selected tariff / resolved control",
      "standard tariff / self-consumption",
      "time-of-use tariff / timed grid charging",
      "smart import-export tariff / smart import-export control",
      "no-battery comparator where useful",
    ],

    rankingUnit:
      "The final optimiser should rank candidate scenarios, not just physical hardware candidates.",
  };
}

function buildOptimisationFunnelPolicy({
  input = {},
  quote = {},
  candidates = [],
  shortlist = null,
  optimiserResults = null,
  scenarioExpansionPlan = null,
} = {}) {
  const topologyRisks = detectRoofTopologyRisks(input);

  const panelPreservationRules = buildPanelPreservationRules({
    topologyRisks,
  });

  const electricalTopologyRules = buildElectricalTopologyRules({
    topologyRisks,
  });

  const inverterEnvelopeRules = buildInverterEnvelopeRules();
  const batterySizingRules = buildBatterySizingRules();
  const scenarioTestingRules = buildScenarioTestingRules();

  const safeCandidates = asArray(candidates);

  return {
    version: DESIGN_OPTIMISATION_FUNNEL_POLICY_VERSION,
    mode: "design_optimisation_funnel_policy_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    policyStatus: "diagnostic_policy_only",

    funnelStages: [
      "user_constraints_and_preferences",
      "initial_roof_layout_skeletons",
      "shade_zone_and_electrical_topology_risk_detection",
      "panel_family_preservation",
      "inverter_envelope_generation",
      "final_panel_inverter_topology_solve",
      "tariff_aware_battery_target_sizing",
      "battery_product_matching",
      "candidate_pruning_and_pareto_frontier",
      "shortlisted_candidate_scenario_testing",
      "candidate_scenario_ranking",
    ],

    currentImplementationStatus: {
      scenarioExpansionPlanAvailable:
        !!scenarioExpansionPlan,
      optimiserResultsAvailable:
        !!optimiserResults,
      shortlistAvailable:
        !!shortlist,
      candidateCount:
        safeCandidates.length,
      hasQuoteHourlyModel:
        Array.isArray(quote?.hourlyModel?._pvHourlyKWh) ||
        Array.isArray(quote?.hourlyModel?._loadHourlyKWh),
    },

    topologyRiskSummary: {
      riskCount: topologyRisks.length,
      risks: topologyRisks,
    },

    panelPreservationRules,
    electricalTopologyRules,
    inverterEnvelopeRules,
    batterySizingRules,
    scenarioTestingRules,

    pruningPrinciples: [
      {
        principleId: "do_not_prune_electrical_rescue_options_too_early",
        label: "Do not prune electrical rescue options too early",
        explanation:
          "A panel that is slightly more expensive may still be necessary if its voltage or dimensions make a difficult string, roof area or inverter topology viable.",
      },
      {
        principleId: "use_pareto_pruning",
        label: "Use Pareto pruning",
        explanation:
          "Only remove an option when another option is equal or better across cost, generation, compatibility, warranty, aesthetics and electrical usefulness.",
      },
      {
        principleId: "cheap_filters_before_hourly_simulation",
        label: "Use cheap filters before hourly simulation",
        explanation:
          "Run preference, compatibility, topology and rough economic filters before expensive 8760-hour tariff/control simulations.",
      },
      {
        principleId: "rank_scenarios_not_just_candidates",
        label: "Rank scenarios, not just hardware",
        explanation:
          "The final recommendation should compare physical system + tariff + battery control settings together.",
      },
    ],

    readiness:
      topologyRisks.length > 0
        ? "policy_ready_with_topology_risks_detected"
        : "policy_ready_no_major_topology_risks_detected",

    assumptions: {
      note:
        "This is a diagnostic policy layer. It documents the intended optimiser funnel and pruning rules but does not yet solve roof layouts or change recommendations.",
    },

    limitations: [
      "No roof geometry solver is implemented in this phase.",
      "No row-level shading model is implemented in this phase.",
      "No inverter envelope calculation is executed in this phase.",
      "No additional scenario simulations are run in this phase.",
      "This policy should guide future implementation of layout, topology and pruning services.",
    ],
  };
}

module.exports = {
  DESIGN_OPTIMISATION_FUNNEL_POLICY_VERSION,
  buildOptimisationFunnelPolicy,
  detectRoofTopologyRisks,
};