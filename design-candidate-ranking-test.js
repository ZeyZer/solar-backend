const {
  buildCandidateSetFromInputs,
} = require("./services/designCandidateSetService");

const {
  buildDesignCandidateRankingResults,
} = require("./services/designCandidateRankingService");

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

function runRankingServiceDirectTest() {
  console.log("\n▶ Direct candidate ranking service");

  const candidateSet = buildCandidateSetFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
      systemType: "balanced",
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
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 10,
        },
      ],
    },
  });

  const ranking = buildDesignCandidateRankingResults({
    candidates: candidateSet.candidates,
    selectedSystemType: "balanced",
  });

  assert(ranking, "Missing ranking result.");
  assert(
    ranking.mode === "candidate_ranking_selected_tariff_beta",
    "Unexpected ranking mode."
  );
  assert(ranking.usedForCalculation === false, "Ranking should not be used for calculation.");
  assert(ranking.usedForPricing === false, "Ranking should not be used for pricing.");
  assert(ranking.usedForRecommendation === false, "Ranking should not be used for recommendation.");

  assert(ranking.counts.totalCandidates === candidateSet.candidates.length, "Total candidate count mismatch.");
  assert(ranking.counts.eligibleCandidates > 0, "Expected eligible candidates.");
  assert(ranking.counts.activeFinancialCandidates > 0, "Expected active financial candidates.");

  assert(ranking.rankings.bestPayback, "Expected best payback ranking.");
  assert(ranking.rankings.bestLifetimeSavings, "Expected best lifetime savings ranking.");
  assert(ranking.rankings.lowestUpfrontCost, "Expected lowest upfront cost ranking.");
  assert(ranking.rankings.bestAnnualBenefit, "Expected best annual benefit ranking.");
  assert(ranking.rankings.bestSelectedSystemTypeFit, "Expected selected system type fit ranking.");
  assert(ranking.rankings.balanced, "Expected balanced ranking.");

  assert(ranking.keyCandidateIds.bestPayback, "Missing bestPayback key candidate ID.");
  assert(ranking.keyCandidateIds.balanced, "Missing balanced key candidate ID.");

  console.log("  ✓ Direct ranking OK:", {
    readiness: ranking.readiness,
    activeFinancialCandidates: ranking.counts.activeFinancialCandidates,
    bestPayback: ranking.keyCandidateIds.bestPayback,
    balanced: ranking.keyCandidateIds.balanced,
  });
}

function runCandidateSetIncludesRankingTest() {
  console.log("\n▶ Candidate set includes optimiser ranking");

  const candidateSet = buildCandidateSetFromInputs({
    quote: buildQuoteWithRoofProfile(),
    input: {
      panelOption: "value",
      batteryKWh: 5,
      systemType: "balanced",
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 10,
        },
      ],
    },
  });

  assert(candidateSet.optimiserResults, "Candidate set missing optimiserResults.");
  assert(
    candidateSet.optimiserResults.mode === "candidate_ranking_selected_tariff_beta",
    "Unexpected optimiserResults mode."
  );

  assert(candidateSet.placeholders.bestPaybackCandidate, "Expected bestPaybackCandidate placeholder to be populated.");
  assert(candidateSet.placeholders.balancedCandidate, "Expected balancedCandidate placeholder to be populated.");

  console.log("  ✓ Candidate set ranking OK:", {
    bestPayback: candidateSet.optimiserResults.keyCandidateIds.bestPayback,
    bestLifetimeSavings:
      candidateSet.optimiserResults.keyCandidateIds.bestLifetimeSavings,
    balanced: candidateSet.optimiserResults.keyCandidateIds.balanced,
  });
}

function runUnavailableFinancialRankingTest() {
  console.log("\n▶ Ranking with unavailable financial models");

  const candidateSet = buildCandidateSetFromInputs({
    input: {
      panelOption: "value",
      batteryKWh: 5,
      systemType: "balanced",
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 40,
          shading: "none",
          panels: 10,
        },
      ],
    },
  });

  const ranking = candidateSet.optimiserResults;

  assert(ranking, "Missing ranking result.");
  assert(ranking.counts.totalCandidates === candidateSet.candidates.length, "Total candidate count mismatch.");
  assert(ranking.counts.eligibleCandidates > 0, "Expected eligible candidates.");
  assert(ranking.counts.activeFinancialCandidates === 0, "Expected no active financial candidates.");
  assert(ranking.rankings.bestPayback === null, "Best payback should be null without active financials.");
  assert(ranking.rankings.balanced === null, "Balanced should be null without active financials.");
  assert(ranking.rankings.lowestUpfrontCost, "Lowest upfront cost can still be ranked from candidate cost data.");

  console.log("  ✓ Unavailable-financial ranking OK:", {
    readiness: ranking.readiness,
    lowestUpfrontCost: ranking.keyCandidateIds.lowestUpfrontCost,
  });
}

function main() {
  console.log("Running design candidate ranking tests");

  runRankingServiceDirectTest();
  runCandidateSetIncludesRankingTest();
  runUnavailableFinancialRankingTest();

  console.log("\n✅ Design candidate ranking tests passed");
}

main();