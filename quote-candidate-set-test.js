const API_BASE = process.env.API_BASE || "http://localhost:4000";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

const payload = {
  _testMode: {
    skipLeadStorage: true,
  },

  name: "Candidate Set Test Customer",
  email: "test@example.com",
  phone: "07123456789",

  homeOwnership: "owner",
  houseNumber: "10",
  postcode: "SW1A 1AA",

  annualKWh: 3500,
  monthlyBill: 100,
  roofSize: "medium",
  shading: "none",
  occupancyProfile: "half_day",

  panelOption: "value",
  batteryKWh: 5,
  birdProtection: false,
  evCharger: false,

  roofs: [
    {
      id: "test-roof-1",
      orientation: "S",
      tilt: 40,
      shading: "none",
      roofSize: "medium",
      panels: 10,
    },
  ],

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
    exportFromBatteryEnabled: true,
  },
};

async function postJson(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function findCandidateWithPvgisPerformance(candidates = []) {
  return candidates.find((candidate) => {
    return (
      candidate?.performanceModel?.mode ===
        "candidate_pvgis_performance_model_beta" &&
      candidate?.performanceModel?.source ===
        "scaled_from_pvgis_roof_array_profiles"
    );
  });
}

async function main() {
  console.log(`Testing quote candidate set at ${API_BASE}/api/quote`);

  const quote = await postJson("/api/quote", payload);

  assert(quote, "Missing quote response.");
  assert(quote.hourlyModel, "Quote missing hourlyModel.");

  assert(
    Array.isArray(quote.hourlyModel._pvgisRoofProfiles),
    "Quote hourlyModel missing _pvgisRoofProfiles."
  );

  assert(
    quote.hourlyModel._pvgisRoofProfiles.length > 0,
    "Expected at least one roof-array PVGIS profile."
  );

  assert(quote.designCandidateSet, "Quote missing designCandidateSet.");
  assert(
    quote.designCandidateSet.mode === "candidate_set_foundation",
    `Unexpected designCandidateSet mode: ${quote.designCandidateSet.mode}`
  );

  assert(
    quote.designCandidateSet.usedForCalculation === false,
    "designCandidateSet should not be used for calculation."
  );

  assert(
    quote.designCandidateSet.usedForPricing === false,
    "designCandidateSet should not be used for pricing."
  );

  assert(
    quote.designCandidateSet.usedForRecommendation === false,
    "designCandidateSet should not be used for recommendation."
  );

  assert(
    quote.designCandidateSet.productSearchSpace?.candidateCount > 0,
    "Expected generated design candidates."
  );

  assert(
    Array.isArray(quote.designCandidateSet.candidates),
    "designCandidateSet.candidates should be an array."
  );

  assert(
    quote.designCandidateSet.candidates.length ===
      quote.designCandidateSet.productSearchSpace.candidateCount,
    "Candidate count mismatch."
  );

  assert(
    quote.designCandidateSet.shortlist,
    "designCandidateSet missing shortlist."
  );

  assert(
    quote.designCandidateSet.shortlist.viabilitySummary,
    "designCandidateSet shortlist missing viabilitySummary."
  );

  assert(
    quote.designCandidateSet.shortlist.viabilitySummary.total ===
      quote.designCandidateSet.candidates.length,
    "Shortlist viability total should match candidate count."
  );

  assert(
    quote.designCandidateSet.optimiserResults,
    "designCandidateSet missing optimiserResults."
  );

  assert(
    quote.designCandidateSet.optimiserResults.mode ===
      "candidate_ranking_selected_tariff_beta",
    `Unexpected optimiserResults mode: ${quote.designCandidateSet.optimiserResults.mode}`
  );

  assert(
    quote.designCandidateSet.optimiserResults.usedForCalculation === false,
    "optimiserResults should not be used for calculation."
  );

  assert(
    quote.designCandidateSet.optimiserResults.usedForRecommendation === false,
    "optimiserResults should not be used for recommendation."
  );

  assert(
    quote.designCandidateSet.optimiserResults.counts.activeFinancialCandidates > 0,
    "Expected active financial candidates in quote-level optimiser results."
  );

  assert(
    quote.designCandidateSet.optimiserResults.rankings.bestPayback,
    "Expected quote-level bestPayback ranking."
  );

  assert(
    quote.designCandidateSet.optimiserResults.rankings.balanced,
    "Expected quote-level balanced ranking."
  );

  assert(
    quote.designCandidateSet.scenarioSet,
    "designCandidateSet missing scenarioSet."
  );

  assert(
    quote.designCandidateSet.scenarioSet.mode ===
      "candidate_scenario_set_selected_tariff_beta",
    `Unexpected scenarioSet mode: ${quote.designCandidateSet.scenarioSet.mode}`
  );

  assert(
    quote.designCandidateSet.scenarioSet.usedForCalculation === false,
    "scenarioSet should not be used for calculation."
  );

  assert(
    quote.designCandidateSet.scenarioSet.usedForRecommendation === false,
    "scenarioSet should not be used for recommendation."
  );

  assert(
    quote.designCandidateSet.scenarioSet.summary.totalScenarios ===
      quote.designCandidateSet.candidates.length,
    "Quote scenario count should match candidate count."
  );

  assert(
    quote.designCandidateSet.scenarioSet.summary.activeFinancialScenarios > 0,
    "Expected active financial scenarios in quote-level scenario set."
  );

  const pvgisCandidate = findCandidateWithPvgisPerformance(
    quote.designCandidateSet.candidates
  );

  assert(
    pvgisCandidate,
    "Expected at least one candidate using roof-array PVGIS performance."
  );

  const performance = pvgisCandidate.performanceModel;

  assert(
    performance.pvgis?.usesRoofArrayProfiles === true,
    "Candidate should use roof-array PVGIS profiles."
  );

  assert(
    performance.pvgis?.usesAggregateProfile === false,
    "Candidate should not need aggregate PVGIS fallback."
  );

  assert(
    isNumber(performance.generation?.annualGrossGenerationKWh),
    "Candidate missing annual gross generation."
  );

  assert(
    performance.generation.annualGrossGenerationKWh > 0,
    "Candidate annual gross generation should be positive."
  );

  
  const financial = pvgisCandidate.financialModel;

  assert(financial, "Candidate missing financial model.");

  assert(
    financial.mode === "candidate_hourly_financial_model_beta",
    `Unexpected candidate financial model mode: ${financial.mode}`
  );

  assert(
    financial.usedForCalculation === false,
    "Candidate financial model should not be used for calculation."
  );

  assert(
    financial.usedForPricing === false,
    "Candidate financial model should not be used for pricing."
  );

  assert(
    financial.usedForRecommendation === false,
    "Candidate financial model should not be used for recommendation."
  );

  assert(
    isNumber(financial.annual?.totalAnnualBenefit),
    "Candidate financial model missing total annual benefit."
  );

  assert(
    financial.systemCost?.estimatedInstalledCost > 0,
    "Candidate financial model missing installed cost."
  );

  assert(
    financial.batteryControlStrategy,
    "Candidate financial model missing battery control strategy."
  );

  assert(
    financial.batteryControlStrategy.strategyId,
    "Candidate financial model missing battery control strategy ID."
  );

  console.log("✅ Quote candidate set test passed.");
  console.log({
    quoteAnnualGeneration: quote.estAnnualGenerationKWh,
    roofProfiles: quote.hourlyModel._pvgisRoofProfiles.length,
    candidates: quote.designCandidateSet.productSearchSpace.candidateCount,
    shortlisted:
      quote.designCandidateSet.shortlist.shortlistSummary?.shortlistedCount,
    candidatePerformanceSource: performance.source,
    candidateAnnualGrossGeneration:
      performance.generation.annualGrossGenerationKWh,
    candidateAnnualBenefit:
      financial.annual.totalAnnualBenefit,
    candidateInstalledCost:
      financial.systemCost.estimatedInstalledCost,
    candidateBatteryControlStrategy:
      financial.batteryControlStrategy.strategyId,
    optimiserReadiness:
      quote.designCandidateSet.optimiserResults.readiness,
    bestPaybackCandidate:
      quote.designCandidateSet.optimiserResults.keyCandidateIds.bestPayback,
    balancedCandidate:
      quote.designCandidateSet.optimiserResults.keyCandidateIds.balanced,
    scenarioReadiness:
      quote.designCandidateSet.scenarioSet.readiness,
    scenarios:
      quote.designCandidateSet.scenarioSet.summary.totalScenarios,
    activeFinancialScenarios:
      quote.designCandidateSet.scenarioSet.summary.activeFinancialScenarios,
  });
}

main().catch((err) => {
  console.error("Quote candidate set test failed:");
  console.error(err);
  process.exit(1);
});