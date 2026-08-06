function getTariffType(tariff) {
  return String(tariff?.tariffType || "standard").toLowerCase();
}

function buildTariffWarnings({
  tariffBefore,
  tariffAfter,
  tariffModelAssumptions,
} = {}) {
  const beforeType = getTariffType(tariffBefore);
  const afterType = getTariffType(tariffAfter);

  const warnings = [];

  warnings.push({
    code: "HOURLY_TARIFF_MODEL",
    severity: "info",
    title: "Hourly tariff modelling",
    message:
      "This beta model uses hourly tariff windows. Half-hour tariff slots are not yet supported.",
  });

  warnings.push({
    code: "TARIFF_PRESETS_ARE_ASSUMPTIONS",
    severity: "info",
    title: "Tariff presets are assumptions",
    message:
      "Tariff rates and windows are modelling assumptions, not guaranteed live supplier tariffs. Check current supplier rates before relying on savings figures.",
  });

  if (afterType === "overnight") {
    warnings.push({
      code: "OVERNIGHT_TARIFF_SIMPLIFIED",
      severity: "info",
      title: "Cheap overnight tariff",
      message:
        "Cheap overnight modelling assumes the selected night import window and rates apply consistently across the year.",
    });
  }

  if (afterType === "flux") {
    warnings.push({
      code: "FLUX_TARIFF_SIMPLIFIED",
      severity: "info",
      title: "Flux-style tariff",
      message:
        "Flux-style modelling uses simplified off-peak, day and peak windows. Real supplier tariffs may use half-hourly pricing or different rules.",
    });
  }

  if (tariffAfter?.allowGridCharging) {
    warnings.push({
      code: "GRID_CHARGING_DEPENDS_ON_TARIFF_AND_HARDWARE",
      severity: "caution",
      title: "Grid charging assumption",
      message:
        "Grid charging is modelled as enabled, but real savings depend on the battery/inverter settings and the supplier tariff rules.",
    });
  }

  if (tariffAfter?.exportFromBatteryEnabled) {
    warnings.push({
      code: "BATTERY_EXPORT_DEPENDS_ON_TARIFF_AND_HARDWARE",
      severity: "caution",
      title: "Battery export assumption",
      message:
        "Battery export is modelled as allowed, but real-world operation depends on the battery system, export tariff and installer configuration.",
    });
  }

  return {
    beforeTariffType: beforeType,
    afterTariffType: afterType,
    model: tariffModelAssumptions?.model || "hourly-tou-v1",
    timeResolution: tariffModelAssumptions?.timeResolution || "hourly",
    supportsHalfHourly: tariffModelAssumptions?.supportsHalfHourly === true,
    warnings,
  };
}

module.exports = {
  buildTariffWarnings,
};