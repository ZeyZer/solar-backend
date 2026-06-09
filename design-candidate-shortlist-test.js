const {
  buildCandidateSetFromInputs,
} = require("./services/designCandidateSetService");

const {
  buildCandidateShortlist,
} = require("./services/designCandidateShortlistService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runStandardShortlistTest() {
  console.log("\n▶ Standard candidate shortlist");

  const candidateSet = buildCandidateSetFromInputs({
    input: {
      panelOption: "value",
      batteryKWh: 5,
      systemType: "balanced",
      tariffAfter: {
        tariffType: "standard",
        allowGridCharging: false,
        exportFromBatteryEnabled: true,
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

  assert(candidateSet.shortlist, "Candidate set missing shortlist.");
  assert(candidateSet.shortlist.mode === "candidate_shortlist_diagnostic", "Unexpected shortlist mode.");
  assert(candidateSet.shortlist.usedForCalculation === false, "Shortlist should not be used for calculation.");
  assert(candidateSet.shortlist.usedForRecommendation === false, "Shortlist should not be used for recommendation.");

  assert(candidateSet.shortlist.viabilitySummary, "Shortlist missing viability summary.");
  assert(candidateSet.shortlist.viabilitySummary.total === candidateSet.candidates.length, "Viability total mismatch.");
  assert(candidateSet.shortlist.shortlistSummary, "Shortlist missing shortlistSummary.");

  assert(Array.isArray(candidateSet.shortlist.shortlistedCandidates), "shortlistedCandidates should be an array.");
  assert(
    candidateSet.shortlist.shortlistedCandidates.length <= 8,
    "Shortlist should not exceed maxShortlist."
  );

  for (const candidate of candidateSet.shortlist.shortlistedCandidates) {
    assert(candidate.candidateId, "Shortlisted candidate missing candidateId.");
    assert(candidate.status !== "rejected", `${candidate.candidateId} should not be rejected.`);
    assert(candidate.eligibleForFutureOptimiser === true, `${candidate.candidateId} should be eligible.`);
    assert(candidate.usedForCalculation === false, `${candidate.candidateId} should not be used for calculation.`);
    assert(candidate.usedForRecommendation === false, `${candidate.candidateId} should not be used for recommendation.`);
    assert(candidate.selectedSystemTypeFit, `${candidate.candidateId} missing selectedSystemTypeFit.`);
    assert(candidate.bestFitSystemType, `${candidate.candidateId} missing bestFitSystemType.`);

    assert(candidate.performance, `${candidate.candidateId} missing performance summary.`);
    assert(candidate.performance.mode, `${candidate.candidateId} missing performance mode.`);
    assert(candidate.performance.source, `${candidate.candidateId} missing performance source.`);

    assert(candidate.dispatch, `${candidate.candidateId} missing dispatch summary.`);
    assert(candidate.dispatch.mode, `${candidate.candidateId} missing dispatch mode.`);

    assert(candidate.financial, `${candidate.candidateId} missing financial summary.`);
    assert(candidate.financial.mode, `${candidate.candidateId} missing financial mode.`);
  }

  console.log("  ✓ Standard shortlist OK:", {
    total: candidateSet.shortlist.viabilitySummary.total,
    eligible: candidateSet.shortlist.shortlistSummary.eligibleCount,
    shortlisted: candidateSet.shortlist.shortlistSummary.shortlistedCount,
    readiness: candidateSet.shortlist.viabilitySummary.readiness,
  });
}

function runRejectedHeavyShortlistTest() {
  console.log("\n▶ Rejected-heavy candidate shortlist");

  const candidateSet = buildCandidateSetFromInputs({
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
      ],
    },
  });

  assert(candidateSet.shortlist, "Candidate set missing shortlist.");
  assert(candidateSet.shortlist.viabilitySummary.total === candidateSet.candidates.length, "Viability total mismatch.");

  assert(
    candidateSet.shortlist.viabilitySummary.rejected > 0,
    "Expected at least one rejected candidate."
  );

  assert(
    Array.isArray(candidateSet.shortlist.rejectedExamples),
    "rejectedExamples should be an array."
  );

  if (candidateSet.shortlist.rejectedExamples.length > 0) {
    const firstRejected = candidateSet.shortlist.rejectedExamples[0];

    assert(firstRejected.status === "rejected", "Rejected example should have rejected status.");
    assert(firstRejected.rejectionCodes.length > 0, "Rejected example should include rejection codes.");
  }

  console.log("  ✓ Rejected-heavy shortlist OK:", {
    rejected: candidateSet.shortlist.viabilitySummary.rejected,
    commonRejectionReasons:
      candidateSet.shortlist.viabilitySummary.commonRejectionReasons.map((r) => r.code),
  });
}

function runDirectShortlistBuilderTest() {
  console.log("\n▶ Direct shortlist builder");

  const candidateSet = buildCandidateSetFromInputs({
    input: {
      panelOption: "premium",
      batteryKWh: 10,
      systemType: "premium_integrated",
      roofs: [
        {
          id: "roof-1",
          orientation: "S",
          tilt: 40,
          shading: "some",
          panels: 10,
        },
      ],
    },
  });

  const shortlist = buildCandidateShortlist({
    candidates: candidateSet.candidates,
    selectedSystemType: "premium_integrated",
    maxShortlist: 3,
    maxRejectedExamples: 2,
  });

  assert(shortlist.selectedSystemType === "premium_integrated", "Selected system type mismatch.");
  assert(shortlist.shortlistedCandidates.length <= 3, "Direct shortlist should respect maxShortlist.");
  assert(shortlist.rejectedExamples.length <= 2, "Direct shortlist should respect maxRejectedExamples.");
  assert(shortlist.viabilitySummary.total === candidateSet.candidates.length, "Direct shortlist total mismatch.");

  console.log("  ✓ Direct shortlist builder OK:", {
    selectedSystemType: shortlist.selectedSystemType,
    shortlisted: shortlist.shortlistedCandidates.length,
    rejectedExamples: shortlist.rejectedExamples.length,
  });
}

function main() {
  console.log("Running design candidate shortlist tests");

  runStandardShortlistTest();
  runRejectedHeavyShortlistTest();
  runDirectShortlistBuilderTest();

  console.log("\n✅ Design candidate shortlist tests passed");
}

main();