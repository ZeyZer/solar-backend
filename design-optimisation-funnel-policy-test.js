const {
  buildOptimisationFunnelPolicy,
  detectRoofTopologyRisks,
} = require("./services/candidates/designOptimisationFunnelPolicyService");

const {
  buildCandidateSetFromInputs,
} = require("./services/candidates/designCandidateSetService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildMonthIdx() {
  const daysByMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const result = [];

  daysByMonth.forEach((days, monthIndex) => {
    for (let i = 0; i < days * 24; i++) {
      result.push(monthIndex);
    }
  });

  return result;
}

function buildHourOfDay(length = 8760) {
  return Array.from({ length }, (_, index) => index % 24);
}

function buildSyntheticPvHourly({ annualKWh = 4300 } = {}) {
  const raw = Array.from({ length: 8760 }, (_, index) => {
    const hour = index % 24;
    const day = Math.floor(index / 24);

    const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const seasonal =
      0.35 + 0.65 * Math.max(0, Math.sin(((day - 20) / 365) * Math.PI));

    return daylight * seasonal;
  });

  const rawTotal = raw.reduce((sum, value) => sum + value, 0);
  const scale = rawTotal > 0 ? annualKWh / rawTotal : 0;

  return raw.map((value) => value * scale);
}

function buildFlatLoadHourly({ annualKWh = 3500 } = {}) {
  return Array(8760).fill(annualKWh / 8760);
}

function buildQuoteWithRoofProfile({
  annualPvKWh = 4300,
  annualLoadKWh = 3500,
  baseSystemSizeKwp = 4.3,
} = {}) {
  const monthIdx = buildMonthIdx();
  const hourOfDay = buildHourOfDay();
  const pvHourly = buildSyntheticPvHourly({ annualKWh: annualPvKWh });
  const loadHourly = buildFlatLoadHourly({ annualKWh: annualLoadKWh });

  return {
    systemSizeKwp: baseSystemSizeKwp,
    priceLow: 7500,
    priceHigh: 9500,

    tariffBefore: {
      tariffType: "standard",
      importPrice: 0.28,
      standingChargePerDay: 0.6,
    },

    tariffAfter: {
      tariffType: "standard",
      importPrice: 0.28,
      standingChargePerDay: 0.6,
      segPrice: 0.12,
    },

    hourlyModel: {
      _pvHourlyKWh: pvHourly,
      _loadHourlyKWh: loadHourly,
      _monthIdx: monthIdx,
      _hourOfDay: hourOfDay,
      _batteryKWh: 5,
      _pvgisRoofProfiles: [
        {
          id: "roof-1-pvgis-avg-2021-2023",
          roofId: "roof-1",
          index: 0,
          year: "avg_2021_2023",
          source: "pvgis_hourly_3yr_avg_roof_array",
          baseSystemSizeKwp,
          hourlyGenerationKWh: pvHourly,
          monthIdx,
          hourOfDay,
          annualGenerationKWh: Math.round(
            pvHourly.reduce((sum, value) => sum + Number(value || 0), 0)
          ),
        },
      ],
    },
  };
}

function runTopologyRiskDetectionTest() {
  console.log("\n▶ Topology risk detection");

  const risks = detectRoofTopologyRisks({
    roofs: [
      {
        id: "roof-short",
        orientation: "S",
        tilt: 40,
        shading: "none",
        panels: 3,
      },
      {
        id: "roof-shaded-row",
        orientation: "S",
        tilt: 40,
        shading: "some",
        panels: 5,
      },
      {
        id: "roof-east",
        orientation: "E",
        tilt: 30,
        shading: "none",
        panels: 6,
      },
    ],
  });

  assert(Array.isArray(risks), "Risks should be an array.");
  assert(
    risks.some((risk) => risk.riskType === "short_string_voltage_risk"),
    "Expected short string voltage risk."
  );
  assert(
    risks.some((risk) => risk.riskType === "shade_zone_mismatch_risk"),
    "Expected shade zone mismatch risk."
  );
  assert(
    risks.some((risk) => risk.riskType === "mixed_orientation_tilt_or_shading_risk"),
    "Expected mixed array group risk."
  );

  console.log("  ✓ Topology risk detection OK:", {
    riskCount: risks.length,
    riskTypes: risks.map((risk) => risk.riskType),
  });
}

function runDirectPolicyTest() {
  console.log("\n▶ Direct optimisation funnel policy");

  const policy = buildOptimisationFunnelPolicy({
    input: {
      roofs: [
        {
          id: "roof-short",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 3,
        },
        {
          id: "roof-shaded-row",
          orientation: "S",
          tilt: 40,
          shading: "some",
          panels: 5,
        },
      ],
    },
    quote: buildQuoteWithRoofProfile(),
    candidates: [{ candidateId: "candidate-1" }],
  });

  assert(policy, "Missing optimisation funnel policy.");
  assert(
    policy.mode === "design_optimisation_funnel_policy_beta",
    "Unexpected policy mode."
  );

  assert(policy.usedForCalculation === false, "Policy should not be used for calculation.");
  assert(policy.usedForPricing === false, "Policy should not be used for pricing.");
  assert(policy.usedForRecommendation === false, "Policy should not be used for recommendation.");

  assert(Array.isArray(policy.funnelStages), "Expected funnel stages.");
  assert(policy.funnelStages.length > 0, "Expected at least one funnel stage.");

  assert(
    policy.topologyRiskSummary.riskCount > 0,
    "Expected topology risks in policy."
  );

  assert(
    policy.panelPreservationRules.some(
      (rule) => rule.categoryId === "high_voltage_rescue"
    ),
    "Expected high voltage rescue preservation rule."
  );

  assert(policy.electricalTopologyRules, "Missing electrical topology rules.");
  assert(policy.inverterEnvelopeRules, "Missing inverter envelope rules.");
  assert(policy.batterySizingRules, "Missing battery sizing rules.");
  assert(policy.scenarioTestingRules, "Missing scenario testing rules.");

  console.log("  ✓ Direct policy OK:", {
    readiness: policy.readiness,
    riskCount: policy.topologyRiskSummary.riskCount,
  });
}

function runCandidateSetIncludesPolicyTest() {
  console.log("\n▶ Candidate set includes optimisation funnel policy");

  const candidateSet = buildCandidateSetFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
      systemType: "balanced",
      roofs: [
        {
          id: "roof-short",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 3,
        },
        {
          id: "roof-shaded-row",
          orientation: "S",
          tilt: 40,
          shading: "some",
          panels: 5,
        },
      ],
    },
  });

  assert(candidateSet.optimisationFunnelPolicy, "Candidate set missing optimisationFunnelPolicy.");
  assert(
    candidateSet.optimisationFunnelPolicy.mode === "design_optimisation_funnel_policy_beta",
    "Unexpected optimisationFunnelPolicy mode."
  );

  assert(
    candidateSet.optimisationFunnelPolicy.topologyRiskSummary.riskCount > 0,
    "Expected candidate set policy to detect topology risks."
  );

  assert(
    candidateSet.optimisationFunnelPolicy.currentImplementationStatus.scenarioExpansionPlanAvailable === true,
    "Expected scenario expansion plan to be available."
  );

  console.log("  ✓ Candidate set policy OK:", {
    readiness: candidateSet.optimisationFunnelPolicy.readiness,
    risks: candidateSet.optimisationFunnelPolicy.topologyRiskSummary.riskCount,
  });
}

function main() {
  console.log("Running design optimisation funnel policy tests");

  runTopologyRiskDetectionTest();
  runDirectPolicyTest();
  runCandidateSetIncludesPolicyTest();

  console.log("\n✅ Design optimisation funnel policy tests passed");
}

main();