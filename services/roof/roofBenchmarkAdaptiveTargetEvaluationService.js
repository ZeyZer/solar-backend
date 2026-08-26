// R1.7b.9
// Evaluates adaptive Google-shade-adjusted PVGIS against benchmark targets.

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function percentDelta(estimate, reference) {
  const e = numberOrNull(estimate);
  const r = numberOrNull(reference);

  if (e === null || r === null || r === 0) {
    return null;
  }

  return round1(((e - r) / r) * 100);
}

function sum(values = []) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function weightedMonthlyAbsErrorPercent(estimateMonthly, referenceMonthly, referenceAnnual) {
  if (!Array.isArray(estimateMonthly) || !Array.isArray(referenceMonthly)) {
    return null;
  }

  if (estimateMonthly.length !== 12 || referenceMonthly.length !== 12) {
    return null;
  }

  const annualRef = numberOrNull(referenceAnnual) || sum(referenceMonthly);
  if (!annualRef) return null;

  const absoluteMonthlyError = estimateMonthly.reduce((total, estimate, index) => {
    const ref = Number(referenceMonthly[index] || 0);
    return total + Math.abs(Number(estimate || 0) - ref);
  }, 0);

  return round1((absoluteMonthlyError / annualRef) * 100);
}

function filteredMeanAbsMonthlyDeltaPercent(estimateMonthly, referenceMonthly, referenceAnnual) {
  if (!Array.isArray(estimateMonthly) || !Array.isArray(referenceMonthly)) {
    return null;
  }

  if (estimateMonthly.length !== 12 || referenceMonthly.length !== 12) {
    return null;
  }

  const annualRef = numberOrNull(referenceAnnual) || sum(referenceMonthly);
  const threshold = Math.max(50, annualRef * 0.01);

  const deltas = [];

  for (let i = 0; i < 12; i += 1) {
    const ref = Number(referenceMonthly[i] || 0);
    if (ref < threshold) continue;

    const delta = percentDelta(estimateMonthly[i], ref);
    if (delta !== null) {
      deltas.push(Math.abs(delta));
    }
  }

  if (!deltas.length) return null;

  return round1(deltas.reduce((total, value) => total + value, 0) / deltas.length);
}

function maxAbsMonthlyKwhError(estimateMonthly, referenceMonthly) {
  if (!Array.isArray(estimateMonthly) || !Array.isArray(referenceMonthly)) {
    return null;
  }

  if (estimateMonthly.length !== 12 || referenceMonthly.length !== 12) {
    return null;
  }

  return round1(
    Math.max(
      ...estimateMonthly.map((estimate, index) =>
        Math.abs(Number(estimate || 0) - Number(referenceMonthly[index] || 0))
      )
    )
  );
}

function buildAdaptiveTargetEvaluation({
  benchmarkItem,
  practicalPanelEstimate,
  segmentShadeAdjustedPvgisProductionBenchmark,
}) {
  const truth = benchmarkItem?.installerDesignTruth || {};

  const installerPanels = numberOrNull(truth.panelCount);
  const expectedPanels = numberOrNull(
    practicalPanelEstimate?.practicalPanels?.expected
  );

  const installerAnnual = numberOrNull(
    segmentShadeAdjustedPvgisProductionBenchmark?.installerReference?.annualKwh
  );

  const adaptiveAnnual = numberOrNull(
    segmentShadeAdjustedPvgisProductionBenchmark?.pvgisAdaptiveShadeAdjusted
      ?.annualKwh
  );

  const installerMonthly =
    segmentShadeAdjustedPvgisProductionBenchmark?.installerReference?.monthlyKwh;

  const adaptiveMonthly =
    segmentShadeAdjustedPvgisProductionBenchmark?.pvgisAdaptiveShadeAdjusted
      ?.monthlyKwh;

  const panelDeltaPercent = percentDelta(expectedPanels, installerPanels);
  const annualDeltaPercent = percentDelta(adaptiveAnnual, installerAnnual);

  const weightedMonthlyErrorPercent = weightedMonthlyAbsErrorPercent(
    adaptiveMonthly,
    installerMonthly,
    installerAnnual
  );

  const filteredMeanMonthlyErrorPercent = filteredMeanAbsMonthlyDeltaPercent(
    adaptiveMonthly,
    installerMonthly,
    installerAnnual
  );

  const worstMonthlyKwhError = maxAbsMonthlyKwhError(
    adaptiveMonthly,
    installerMonthly
  );

  const panelExpectedWithin10 =
    panelDeltaPercent !== null ? Math.abs(panelDeltaPercent) <= 10 : null;

  const annualExpectedWithin15 =
    annualDeltaPercent !== null ? Math.abs(annualDeltaPercent) <= 15 : null;

  const monthlyWeightedWithin15 =
    weightedMonthlyErrorPercent !== null
      ? weightedMonthlyErrorPercent <= 15
      : null;

  const overallPass =
    panelExpectedWithin10 === true &&
    annualExpectedWithin15 === true &&
    monthlyWeightedWithin15 === true;

  const warnings = [];

  if (panelExpectedWithin10 === false) {
    warnings.push("expected_panel_count_outside_10_percent");
  }

  if (annualExpectedWithin15 === false) {
    warnings.push("adaptive_annual_production_outside_15_percent");
  }

  if (monthlyWeightedWithin15 === false) {
    warnings.push("adaptive_weighted_monthly_error_outside_15_percent");
  }

  return {
    source: "zeyzer_adaptive_target_evaluation_v1",

    panel: {
      installerPanels,
      expectedPanels,
      deltaPercent: panelDeltaPercent,
      expectedWithin10Percent: panelExpectedWithin10,
    },

    annualProduction: {
      installerAnnualKwh: installerAnnual,
      adaptiveAnnualKwh: adaptiveAnnual,
      deltaPercent: annualDeltaPercent,
      expectedWithin15Percent: annualExpectedWithin15,
    },

    monthlyProduction: {
      hasMonthlyReference: Array.isArray(installerMonthly),
      weightedMonthlyAbsErrorPercent: weightedMonthlyErrorPercent,
      filteredMeanAbsMonthlyDeltaPercent: filteredMeanMonthlyErrorPercent,
      worstMonthlyKwhError,
      weightedWithin15Percent: monthlyWeightedWithin15,
    },

    overallPass,
    warnings,
  };
}

module.exports = {
  buildAdaptiveTargetEvaluation,
};
