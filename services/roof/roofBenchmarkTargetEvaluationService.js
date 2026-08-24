function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function percentDelta(estimate, reference) {
  const estimateNumber = numberOrNull(estimate);
  const referenceNumber = numberOrNull(reference);

  if (
    estimateNumber === null ||
    referenceNumber === null ||
    referenceNumber === 0
  ) {
    return null;
  }

  return round1(((estimateNumber - referenceNumber) / referenceNumber) * 100);
}

function isBetween(value, low, high) {
  const number = numberOrNull(value);
  const lowNumber = numberOrNull(low);
  const highNumber = numberOrNull(high);

  if (number === null || lowNumber === null || highNumber === null) {
    return false;
  }

  return number >= lowNumber && number <= highNumber;
}

function withinAbsolutePercent(deltaPercent, limitPercent) {
  const delta = numberOrNull(deltaPercent);

  if (delta === null) {
    return false;
  }

  return Math.abs(delta) <= limitPercent;
}

function buildBenchmarkTargetEvaluation({
  benchmarkItem,
  practicalPanelEstimate,
  productionDeltaDiagnostic,
}) {
  const truth = benchmarkItem?.installerDesignTruth || {};

  const installerPanels = numberOrNull(truth.panelCount);
  const installerAnnualKwh = numberOrNull(truth.annualProductionKwh);

  const practicalPanels = practicalPanelEstimate?.practicalPanels || {};
  const practicalAnnual = practicalPanelEstimate?.practicalAnnualKwh || {};

  const expectedPanelDeltaPercent = percentDelta(
    practicalPanels.expected,
    installerPanels
  );

  const expectedAnnualDeltaPercent = percentDelta(
    practicalAnnual.expected,
    installerAnnualKwh
  );

  const panelTruthInRange = isBetween(
    installerPanels,
    practicalPanels.low,
    practicalPanels.high
  );

  const annualTruthInRange = isBetween(
    installerAnnualKwh,
    practicalAnnual.low,
    practicalAnnual.high
  );

  const panelExpectedWithin10Percent = withinAbsolutePercent(
    expectedPanelDeltaPercent,
    10
  );

  const annualExpectedWithin15Percent = withinAbsolutePercent(
    expectedAnnualDeltaPercent,
    15
  );

  const overallTargetPass =
    panelTruthInRange &&
    annualTruthInRange &&
    panelExpectedWithin10Percent &&
    annualExpectedWithin15Percent;

  const warnings = [];

  const productionFlag =
    productionDeltaDiagnostic?.productionModelDelta?.flag || null;

  const productionSeverity =
    productionDeltaDiagnostic?.productionModelDelta?.severity || null;

  if (productionSeverity === "medium" || productionSeverity === "high") {
    warnings.push(
      `Production-model delta flagged: ${productionFlag}.`
    );
  }

  if (!overallTargetPass) {
    warnings.push("One or more benchmark target checks failed.");
  }

  return {
    source: "zeyzer_benchmark_target_evaluation_v1",
    status: "complete",

    targets: {
      panelExpectedTolerancePercent: 10,
      annualExpectedTolerancePercent: 15,
    },

    checks: {
      panelTruthInRange,
      annualTruthInRange,
      panelExpectedWithin10Percent,
      annualExpectedWithin15Percent,
      overallTargetPass,
    },

    deltas: {
      expectedPanelDeltaPercent,
      expectedAnnualDeltaPercent,
      expectedSystemSizeDeltaPercent:
        productionDeltaDiagnostic?.deltas?.expectedSystemSizeDeltaPercent ??
        null,
      specificYieldDeltaPercent:
        productionDeltaDiagnostic?.deltas?.specificYieldDeltaPercent ?? null,
    },

    reference: {
      installerPanels,
      installerAnnualKwh: round1(installerAnnualKwh),
    },

    estimate: {
      practicalPanels: {
        low: numberOrNull(practicalPanels.low),
        expected: numberOrNull(practicalPanels.expected),
        high: numberOrNull(practicalPanels.high),
      },
      practicalAnnualKwh: {
        low: round1(practicalAnnual.low),
        expected: round1(practicalAnnual.expected),
        high: round1(practicalAnnual.high),
      },
    },

    warnings,
  };
}

module.exports = {
  buildBenchmarkTargetEvaluation,
};
