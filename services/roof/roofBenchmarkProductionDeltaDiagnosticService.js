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

function round2(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 100) / 100;
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

function specificYield(annualKwh, systemSizeKwp) {
  const annual = numberOrNull(annualKwh);
  const size = numberOrNull(systemSizeKwp);

  if (annual === null || size === null || size <= 0) {
    return null;
  }

  return round1(annual / size);
}

function getInstallerPanelWattage(benchmarkItem, panelAssumptionAudit) {
  return numberOrNull(
    benchmarkItem?.installerDesignTruth?.panelWattage ??
      panelAssumptionAudit?.firstBuilding?.installerPanel?.wattage
  );
}

function getInstallerSystemSizeKwp(benchmarkItem, panelAssumptionAudit) {
  const truth = benchmarkItem?.installerDesignTruth || {};

  const explicitSystemSize = numberOrNull(
    truth.systemSizeKwp ?? truth.systemSizeKw ?? truth.arraySizeKwp
  );

  if (explicitSystemSize !== null) {
    return explicitSystemSize;
  }

  const panelCount = numberOrNull(truth.panelCount);
  const panelWattage = getInstallerPanelWattage(
    benchmarkItem,
    panelAssumptionAudit
  );

  if (panelCount === null || panelWattage === null) {
    return null;
  }

  return panelCount * panelWattage / 1000;
}

function buildSystemSizeFromPanels(panelCount, panelWattage) {
  const panels = numberOrNull(panelCount);
  const watts = numberOrNull(panelWattage);

  if (panels === null || watts === null) {
    return null;
  }

  return panels * watts / 1000;
}

function classifyProductionDelta(specificYieldDeltaPercent) {
  const delta = numberOrNull(specificYieldDeltaPercent);

  if (delta === null) {
    return {
      flag: "insufficient_data",
      severity: "unknown",
      reason:
        "Specific-yield comparison could not be calculated because system size or annual production data is missing.",
    };
  }

  if (delta <= -15) {
    return {
      flag: "google_derived_yield_much_lower_than_installer_reference",
      severity: "high",
      reason:
        "Google-derived specific yield is more than 15% lower than the installer/OpenSolar reference.",
    };
  }

  if (delta <= -7.5) {
    return {
      flag: "google_derived_yield_lower_than_installer_reference",
      severity: "medium",
      reason:
        "Google-derived specific yield is moderately lower than the installer/OpenSolar reference.",
    };
  }

  if (delta >= 15) {
    return {
      flag: "google_derived_yield_much_higher_than_installer_reference",
      severity: "high",
      reason:
        "Google-derived specific yield is more than 15% higher than the installer/OpenSolar reference.",
    };
  }

  if (delta >= 7.5) {
    return {
      flag: "google_derived_yield_higher_than_installer_reference",
      severity: "medium",
      reason:
        "Google-derived specific yield is moderately higher than the installer/OpenSolar reference.",
    };
  }

  return {
    flag: "normal",
    severity: "low",
    reason:
      "Google-derived specific yield is close to the installer/OpenSolar reference.",
  };
}

function buildProductionDeltaDiagnostic({
  benchmarkItem,
  panelAssumptionAudit,
  practicalPanelEstimate,
}) {
  const truth = benchmarkItem?.installerDesignTruth || {};

  const installerPanels = numberOrNull(truth.panelCount);
  const installerAnnualKwh = numberOrNull(truth.annualProductionKwh);
  const installerPanelWattage = getInstallerPanelWattage(
    benchmarkItem,
    panelAssumptionAudit
  );

  const installerSystemSizeKwp = getInstallerSystemSizeKwp(
    benchmarkItem,
    panelAssumptionAudit
  );

  const practicalPanels = practicalPanelEstimate?.practicalPanels || {};
  const practicalAnnual = practicalPanelEstimate?.practicalAnnualKwh || {};

  const practicalSystemSizeKwpLow = buildSystemSizeFromPanels(
    practicalPanels.low,
    installerPanelWattage
  );

  const practicalSystemSizeKwpExpected = buildSystemSizeFromPanels(
    practicalPanels.expected,
    installerPanelWattage
  );

  const practicalSystemSizeKwpHigh = buildSystemSizeFromPanels(
    practicalPanels.high,
    installerPanelWattage
  );

  const installerSpecificYieldKwhPerKwp = specificYield(
    installerAnnualKwh,
    installerSystemSizeKwp
  );

  const practicalSpecificYieldLow = specificYield(
    practicalAnnual.low,
    practicalSystemSizeKwpLow
  );

  const practicalSpecificYieldExpected = specificYield(
    practicalAnnual.expected,
    practicalSystemSizeKwpExpected
  );

  const practicalSpecificYieldHigh = specificYield(
    practicalAnnual.high,
    practicalSystemSizeKwpHigh
  );

  const expectedPanelDeltaPercent = percentDelta(
    practicalPanels.expected,
    installerPanels
  );

  const expectedSystemSizeDeltaPercent = percentDelta(
    practicalSystemSizeKwpExpected,
    installerSystemSizeKwp
  );

  const expectedAnnualDeltaPercent = percentDelta(
    practicalAnnual.expected,
    installerAnnualKwh
  );

  const specificYieldDeltaPercent = percentDelta(
    practicalSpecificYieldExpected,
    installerSpecificYieldKwhPerKwp
  );

  const productionDeltaClassification = classifyProductionDelta(
    specificYieldDeltaPercent
  );

  return {
    source: "zeyzer_production_delta_diagnostic_v1",
    status:
      installerPanels !== null &&
      installerAnnualKwh !== null &&
      installerSystemSizeKwp !== null &&
      practicalPanels.expected !== undefined &&
      practicalAnnual.expected !== undefined
        ? "complete"
        : "missing_data",

    installerReference: {
      panels: installerPanels,
      panelWattage: installerPanelWattage,
      systemSizeKwp: round2(installerSystemSizeKwp),
      annualKwh: round1(installerAnnualKwh),
      specificYieldKwhPerKwp: installerSpecificYieldKwhPerKwp,
    },

    practicalEstimate: {
      panels: {
        low: numberOrNull(practicalPanels.low),
        expected: numberOrNull(practicalPanels.expected),
        high: numberOrNull(practicalPanels.high),
      },
      systemSizeKwp: {
        low: round2(practicalSystemSizeKwpLow),
        expected: round2(practicalSystemSizeKwpExpected),
        high: round2(practicalSystemSizeKwpHigh),
      },
      annualKwh: {
        low: round1(practicalAnnual.low),
        expected: round1(practicalAnnual.expected),
        high: round1(practicalAnnual.high),
      },
      specificYieldKwhPerKwp: {
        low: practicalSpecificYieldLow,
        expected: practicalSpecificYieldExpected,
        high: practicalSpecificYieldHigh,
      },
    },

    deltas: {
      expectedPanelDeltaPercent,
      expectedSystemSizeDeltaPercent,
      expectedAnnualDeltaPercent,
      specificYieldDeltaPercent,
    },

    productionModelDelta: productionDeltaClassification,
  };
}

module.exports = {
  buildProductionDeltaDiagnostic,
};
