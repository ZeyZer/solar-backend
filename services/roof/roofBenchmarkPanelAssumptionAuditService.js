function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round3(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 1000) / 1000;
}

function round1(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function metersFromPossibleValues({ meters, millimetres }) {
  const metresValue = numberOrNull(meters);
  if (metresValue !== null) {
    return metresValue;
  }

  const millimetresValue = numberOrNull(millimetres);
  if (millimetresValue !== null) {
    return millimetresValue / 1000;
  }

  return null;
}

function getInstallerPanelAssumptions(benchmarkItem = {}) {
  const truth = benchmarkItem.installerDesignTruth || {};
  const panel = truth.panel || {};

  const model = firstPresent(
    truth.panelModel,
    truth.moduleModel,
    truth.panelName,
    truth.moduleName,
    panel.model,
    panel.name
  ) || null;

  const wattage = numberOrNull(
    firstPresent(
      truth.panelWattage,
      truth.panelWatts,
      truth.moduleWattage,
      truth.moduleWatts,
      panel.wattage,
      panel.watts
    )
  );

  const widthMeters = metersFromPossibleValues({
    meters: firstPresent(
      truth.panelWidthMeters,
      truth.moduleWidthMeters,
      panel.widthMeters
    ),
    millimetres: firstPresent(
      truth.panelWidthMm,
      truth.moduleWidthMm,
      panel.widthMm
    ),
  });

  const heightMeters = metersFromPossibleValues({
    meters: firstPresent(
      truth.panelHeightMeters,
      truth.moduleHeightMeters,
      panel.heightMeters
    ),
    millimetres: firstPresent(
      truth.panelHeightMm,
      truth.moduleHeightMm,
      panel.heightMm
    ),
  });

  const footprintM2 =
    widthMeters !== null && heightMeters !== null
      ? widthMeters * heightMeters
      : null;

  const wattsPerM2 =
    wattage !== null && footprintM2 !== null && footprintM2 > 0
      ? wattage / footprintM2
      : null;

  return {
    model,
    wattage,
    widthMeters: round3(widthMeters),
    heightMeters: round3(heightMeters),
    footprintM2: round3(footprintM2),
    wattsPerM2: round1(wattsPerM2),
    hasDimensions: widthMeters !== null && heightMeters !== null,
  };
}

function getGooglePanelAssumptions(building = {}) {
  const solarPotential = building.solarPotential || {};

  const wattage = numberOrNull(solarPotential.panelCapacityWatts);
  const widthMeters = numberOrNull(solarPotential.panelWidthMeters);
  const heightMeters = numberOrNull(solarPotential.panelHeightMeters);

  const footprintM2 =
    widthMeters !== null && heightMeters !== null
      ? widthMeters * heightMeters
      : null;

  const wattsPerM2 =
    wattage !== null && footprintM2 !== null && footprintM2 > 0
      ? wattage / footprintM2
      : null;

  return {
    wattage,
    widthMeters: round3(widthMeters),
    heightMeters: round3(heightMeters),
    footprintM2: round3(footprintM2),
    wattsPerM2: round1(wattsPerM2),
    hasDimensions: widthMeters !== null && heightMeters !== null,
  };
}

function buildBuildingPanelAssumptionAudit(building, benchmarkItem) {
  const google = getGooglePanelAssumptions(building);
  const installer = getInstallerPanelAssumptions(benchmarkItem);

  const googleMaxPanels = numberOrNull(
    building?.solarPotential?.maxArrayPanelsCount
  );

  const googleMaxPanelAreaM2 =
    googleMaxPanels !== null && google.footprintM2 !== null
      ? googleMaxPanels * google.footprintM2
      : null;

  const footprintAdjustedInstallerEquivalentPanels =
    googleMaxPanelAreaM2 !== null &&
    installer.footprintM2 !== null &&
    installer.footprintM2 > 0
      ? googleMaxPanelAreaM2 / installer.footprintM2
      : null;

  const googleToInstallerFootprintRatio =
    google.footprintM2 !== null &&
    installer.footprintM2 !== null &&
    installer.footprintM2 > 0
      ? google.footprintM2 / installer.footprintM2
      : null;

  const googleToInstallerWattageRatio =
    google.wattage !== null &&
    installer.wattage !== null &&
    installer.wattage > 0
      ? google.wattage / installer.wattage
      : null;

  const googleToInstallerWattsPerM2Ratio =
    google.wattsPerM2 !== null &&
    installer.wattsPerM2 !== null &&
    installer.wattsPerM2 > 0
      ? google.wattsPerM2 / installer.wattsPerM2
      : null;

  const missing = [];

  if (!google.hasDimensions) {
    missing.push("google_panel_dimensions");
  }

  if (!installer.hasDimensions) {
    missing.push("installer_panel_dimensions");
  }

  if (installer.wattage === null) {
    missing.push("installer_panel_wattage");
  }

  return {
    buildingId: building?.id ?? null,
    providerBuildingName: building?.providerBuildingName ?? null,
    googleMaxPanels,

    googlePanel: google,
    installerPanel: installer,

    googleMaxPanelAreaM2: round3(googleMaxPanelAreaM2),
    footprintAdjustedInstallerEquivalentPanels: round1(
      footprintAdjustedInstallerEquivalentPanels
    ),

    ratios: {
      googleToInstallerFootprintRatio: round3(googleToInstallerFootprintRatio),
      googleToInstallerWattageRatio: round3(googleToInstallerWattageRatio),
      googleToInstallerWattsPerM2Ratio: round3(
        googleToInstallerWattsPerM2Ratio
      ),
    },

    status: missing.length === 0 ? "complete" : "missing_data",
    missing,
  };
}

function buildPanelAssumptionAudit(analysis, benchmarkItem = {}) {
  const buildings = Array.isArray(analysis?.solarBuildingModels)
    ? analysis.solarBuildingModels
    : [];

  const buildingAudits = buildings.map((building) =>
    buildBuildingPanelAssumptionAudit(building, benchmarkItem)
  );

  const firstAudit = buildingAudits[0] || null;

  return {
    source: "zeyzer_panel_assumption_audit_v1",
    status:
      buildingAudits.length === 0
        ? "no_buildings"
        : buildingAudits.some((audit) => audit.status === "missing_data")
          ? "missing_data"
          : "complete",
    buildingAudits,
    firstBuilding: firstAudit,
  };
}

module.exports = {
  buildPanelAssumptionAudit,
};
