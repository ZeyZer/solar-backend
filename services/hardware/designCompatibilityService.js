const {
  listActivePanels,
  listActiveInverters,
  findPanelById,
  findInverterById,
  findBatteryById,
  findClosestBatteryByUsableKWh,
} = require("./hardwareCatalogService");

const DESIGN_COMPATIBILITY_VERSION = "2026-beta-1";

const DEFAULT_DESIGN_COMPATIBILITY_ASSUMPTIONS = {
  minCellTempC: -10,
  maxCellTempC: 70,
  shortTariffWindowHours: 3,

  dcAcRatio: {
    warningAbove: 1.35,
    failAbove: 1.60,
  },

  optimiserRules: {
    flagIfAnyRoofHasShading: true,
    flagIfMixedOrientations: true,
    flagIfMixedTilts: true,
    flagIfArraysExceedMppts: true,
    flagIfStringVoltageTooLow: true,
  },

  notes:
    "Design compatibility checks are diagnostic only. They do not yet change quote pricing, PV generation, battery dispatch or product recommendations.",
};

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function round1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function makeCheck({
  code,
  category,
  status,
  severity = "info",
  title,
  message,
  values = {},
}) {
  return {
    code,
    category,
    status,
    severity,
    title,
    message,
    values,
  };
}

function passCheck(args) {
  return makeCheck({ ...args, status: "pass", severity: args.severity || "info" });
}

function warnCheck(args) {
  return makeCheck({ ...args, status: "warn", severity: args.severity || "warning" });
}

function failCheck(args) {
  return makeCheck({ ...args, status: "fail", severity: args.severity || "error" });
}

function infoCheck(args) {
  return makeCheck({ ...args, status: "info", severity: args.severity || "info" });
}

function notApplicableCheck(args) {
  return makeCheck({ ...args, status: "not_applicable", severity: args.severity || "info" });
}

function getActivePanelByOption(panelOption = "value") {
  const option = String(panelOption || "value");
  const panels = listActivePanels();

  return (
    panels.find((panel) => panel.panelOption === option) ||
    panels[0] ||
    null
  );
}

function getPanelForDesign({ panelId, panelOption }) {
  if (panelId) {
    return findPanelById(panelId);
  }

  return getActivePanelByOption(panelOption);
}

function getTotalPanels(roofs = []) {
  return (Array.isArray(roofs) ? roofs : []).reduce(
    (sum, roof) => sum + Number(roof.panels || 0),
    0
  );
}

function getActiveArrays(roofs = []) {
  return (Array.isArray(roofs) ? roofs : [])
    .filter((roof) => Number(roof.panels || 0) > 0)
    .map((roof, index) => ({
      id: roof.id || `array_${index + 1}`,
      index,
      orientation: roof.orientation || "unknown",
      tilt: Number(roof.tilt || 0),
      shading: roof.shading || "none",
      panels: Number(roof.panels || 0),
      roof,
    }));
}

function getSystemSizeKwp({ panel, totalPanels, fallbackSystemSizeKwp }) {
  const fallback = Number(fallbackSystemSizeKwp || 0);

  if (!panel || !Number.isFinite(Number(panel.wattage))) {
    return round2(fallback);
  }

  return round2((Number(panel.wattage || 0) * Number(totalPanels || 0)) / 1000);
}

function chooseInverterForDesign({
  inverterId,
  systemSizeKwp,
  batteryKWh = 0,
}) {
  if (inverterId) {
    return findInverterById(inverterId);
  }

  const inverters = listActiveInverters()
    .filter((inverter) => Number(inverter.maxPvInputKW || 0) > 0)
    .filter((inverter) => {
      if (Number(batteryKWh || 0) > 0) {
        return inverter.batteryCompatible !== false;
      }
      return true;
    })
    .sort((a, b) => {
      const aFits = Number(a.maxPvInputKW || 0) >= Number(systemSizeKwp || 0);
      const bFits = Number(b.maxPvInputKW || 0) >= Number(systemSizeKwp || 0);

      if (aFits !== bFits) return aFits ? -1 : 1;

      const aCost = Number(a.pricing?.estimatedInstalledAdder || a.pricing?.materialCost || 0);
      const bCost = Number(b.pricing?.estimatedInstalledAdder || b.pricing?.materialCost || 0);

      if (aCost !== bCost) return aCost - bCost;

      return Number(a.maxAcOutputKW || 0) - Number(b.maxAcOutputKW || 0);
    });

  return inverters[0] || null;
}

function chooseBatteryForDesign({ batteryId, batteryKWh }) {
  if (batteryId) {
    return findBatteryById(batteryId);
  }

  if (Number(batteryKWh || 0) <= 0) {
    return null;
  }

  return findClosestBatteryByUsableKWh(batteryKWh);
}

function correctedVoltageAtTemp({
  voltageSTC,
  tempCoeffPctPerC,
  cellTempC,
}) {
  const voltage = Number(voltageSTC || 0);
  const coeff = Number(tempCoeffPctPerC || 0) / 100;
  const delta = Number(cellTempC || 25) - 25;

  return voltage * (1 + coeff * delta);
}

function buildArrayElectricalValues({
  panel,
  array,
  assumptions,
}) {
  const electrical = panel?.electrical || {};
  const panelsInSeries = Number(array.panels || 0);

  const vocColdPerPanel = correctedVoltageAtTemp({
    voltageSTC: electrical.vocSTC,
    tempCoeffPctPerC: electrical.tempCoeffVocPctPerC,
    cellTempC: assumptions.minCellTempC,
  });

  const vmpHotPerPanel = correctedVoltageAtTemp({
    voltageSTC: electrical.vmpSTC,
    tempCoeffPctPerC: electrical.tempCoeffVocPctPerC,
    cellTempC: assumptions.maxCellTempC,
  });

  return {
    panelsInSeries,

    stringVocSTC: round2(Number(electrical.vocSTC || 0) * panelsInSeries),
    stringVmpSTC: round2(Number(electrical.vmpSTC || 0) * panelsInSeries),

    stringVocCold: round2(vocColdPerPanel * panelsInSeries),
    stringVmpHot: round2(vmpHotPerPanel * panelsInSeries),

    stringIscA: round2(Number(electrical.iscSTC || 0)),
    stringImpA: round2(Number(electrical.impSTC || 0)),

    panelMaxSystemVoltageV: Number(electrical.maxSystemVoltageV || 0),
  };
}

function checkMpptCapacity({ arrays, inverter }) {
  const dcInput = inverter?.dcInput || {};
  const mpptCount = Number(dcInput.mpptCount || 0);
  const arrayCount = arrays.length;

  if (arrayCount === 0) {
    return notApplicableCheck({
      code: "NO_PV_ARRAYS",
      category: "pv_design",
      title: "No PV arrays to check",
      message: "No roof arrays were provided for PV compatibility checks.",
      values: { arrayCount, mpptCount },
    });
  }

  if (mpptCount >= arrayCount) {
    return passCheck({
      code: "MPPT_COUNT_VS_ARRAYS",
      category: "pv_design",
      title: "MPPT count supports roof arrays",
      message: "The selected inverter has at least as many MPPTs as the current roof arrays.",
      values: { arrayCount, mpptCount },
    });
  }

  return failCheck({
    code: "MPPT_COUNT_VS_ARRAYS",
    category: "pv_design",
    title: "Not enough MPPTs for roof arrays",
    message:
      "The number of roof arrays exceeds the inverter MPPT count. This may require a different inverter, combined arrays, optimisers or microinverters.",
    values: { arrayCount, mpptCount },
  });
}

function checkTotalDcInput({ systemSizeKwp, inverter }) {
  const maxPvInputKW = Number(inverter?.dcInput?.maxPvInputKW ?? inverter?.maxPvInputKW ?? 0);

  if (maxPvInputKW <= 0) {
    return failCheck({
      code: "INVERTER_MAX_PV_INPUT",
      category: "pv_design",
      title: "Inverter has no PV input capacity",
      message: "The selected inverter does not have PV input capacity for this solar array.",
      values: { systemSizeKwp, maxPvInputKW },
    });
  }

  if (Number(systemSizeKwp || 0) <= maxPvInputKW) {
    return passCheck({
      code: "INVERTER_MAX_PV_INPUT",
      category: "pv_design",
      title: "Total DC input within inverter limit",
      message: "The estimated PV array size is within the inverter maximum PV input power.",
      values: { systemSizeKwp, maxPvInputKW },
    });
  }

  return failCheck({
    code: "INVERTER_MAX_PV_INPUT",
    category: "pv_design",
    title: "Total DC input exceeds inverter limit",
    message: "The estimated PV array size exceeds the inverter maximum PV input power.",
    values: { systemSizeKwp, maxPvInputKW },
  });
}

function checkDcAcRatio({ systemSizeKwp, inverter, assumptions }) {
  const acOutput = Number(inverter?.maxAcOutputKW || 0);

  if (acOutput <= 0) {
    return failCheck({
      code: "DC_AC_RATIO",
      category: "pv_design",
      title: "Missing inverter AC output",
      message: "The inverter AC output is missing, so DC/AC ratio cannot be assessed.",
      values: { systemSizeKwp, acOutput },
    });
  }

  const ratio = Number(systemSizeKwp || 0) / acOutput;

  if (ratio > assumptions.dcAcRatio.failAbove) {
    return failCheck({
      code: "DC_AC_RATIO",
      category: "pv_design",
      title: "DC/AC ratio very high",
      message:
        "The PV array is heavily oversized compared with inverter AC output. This may increase clipping and may not be suitable.",
      values: {
        systemSizeKwp,
        acOutput,
        dcAcRatio: round2(ratio),
        failAbove: assumptions.dcAcRatio.failAbove,
      },
    });
  }

  if (ratio > assumptions.dcAcRatio.warningAbove) {
    return warnCheck({
      code: "DC_AC_RATIO",
      category: "pv_design",
      title: "DC/AC ratio high",
      message:
        "The PV array is oversized compared with inverter AC output. This can be acceptable, but clipping should be reviewed.",
      values: {
        systemSizeKwp,
        acOutput,
        dcAcRatio: round2(ratio),
        warningAbove: assumptions.dcAcRatio.warningAbove,
      },
    });
  }

  return passCheck({
    code: "DC_AC_RATIO",
    category: "pv_design",
    title: "DC/AC ratio within beta range",
    message: "The PV array size is within the current beta DC/AC ratio range.",
    values: {
      systemSizeKwp,
      acOutput,
      dcAcRatio: round2(ratio),
    },
  });
}

function checkArrayAgainstMppt({
  panel,
  array,
  inverter,
  mppt,
  assumptions,
}) {
  const checks = [];

  if (!mppt) {
    checks.push(
      failCheck({
        code: "ARRAY_MPPT_ASSIGNMENT",
        category: "pv_design",
        title: `Array ${array.index + 1} has no MPPT assignment`,
        message: "There are more arrays than available MPPTs.",
        values: {
          arrayId: array.id,
          arrayIndex: array.index,
        },
      })
    );

    return checks;
  }

  const values = buildArrayElectricalValues({
    panel,
    array,
    assumptions,
  });

  const dcInput = inverter?.dcInput || {};
  const mpptRange = dcInput.mpptVoltageRangeV || {};

  const maxDcVoltage = Number(dcInput.maxDcVoltageV || 0);
  const mpptVoltageMax = Number(mpptRange.max || 0);
  const mpptVoltageMin = Number(mpptRange.min || 0);
  const startupVoltage = Number(dcInput.startupVoltageV || 0);

  if (values.stringVocCold <= maxDcVoltage) {
    checks.push(
      passCheck({
        code: "STRING_COLD_VOC_VS_INVERTER_MAX_DC",
        category: "pv_design",
        title: `Array ${array.index + 1}: cold Voc within inverter max DC voltage`,
        message: "The string cold-weather open-circuit voltage is within the inverter maximum DC voltage.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          stringVocCold: values.stringVocCold,
          maxDcVoltage,
          minCellTempC: assumptions.minCellTempC,
        },
      })
    );
  } else {
    checks.push(
      failCheck({
        code: "STRING_COLD_VOC_VS_INVERTER_MAX_DC",
        category: "pv_design",
        title: `Array ${array.index + 1}: cold Voc exceeds inverter max DC voltage`,
        message:
          "The string cold-weather open-circuit voltage exceeds the inverter maximum DC voltage.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          stringVocCold: values.stringVocCold,
          maxDcVoltage,
          minCellTempC: assumptions.minCellTempC,
        },
      })
    );
  }

  if (values.stringVocCold <= values.panelMaxSystemVoltageV) {
    checks.push(
      passCheck({
        code: "STRING_COLD_VOC_VS_PANEL_MAX_SYSTEM_VOLTAGE",
        category: "pv_design",
        title: `Array ${array.index + 1}: cold Voc within panel max system voltage`,
        message: "The string cold-weather voltage is within the panel maximum system voltage.",
        values: {
          arrayId: array.id,
          stringVocCold: values.stringVocCold,
          panelMaxSystemVoltageV: values.panelMaxSystemVoltageV,
        },
      })
    );
  } else {
    checks.push(
      failCheck({
        code: "STRING_COLD_VOC_VS_PANEL_MAX_SYSTEM_VOLTAGE",
        category: "pv_design",
        title: `Array ${array.index + 1}: cold Voc exceeds panel max system voltage`,
        message: "The string voltage exceeds the panel maximum system voltage.",
        values: {
          arrayId: array.id,
          stringVocCold: values.stringVocCold,
          panelMaxSystemVoltageV: values.panelMaxSystemVoltageV,
        },
      })
    );
  }

  if (values.stringVocCold <= mpptVoltageMax) {
    checks.push(
      passCheck({
        code: "STRING_COLD_VOC_VS_MPPT_MAX",
        category: "pv_design",
        title: `Array ${array.index + 1}: cold Voc within MPPT max voltage`,
        message: "The string cold-weather voltage is within the MPPT maximum voltage range.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          stringVocCold: values.stringVocCold,
          mpptVoltageMax,
        },
      })
    );
  } else {
    checks.push(
      failCheck({
        code: "STRING_COLD_VOC_VS_MPPT_MAX",
        category: "pv_design",
        title: `Array ${array.index + 1}: cold Voc exceeds MPPT max voltage`,
        message: "The string cold-weather voltage exceeds the MPPT maximum voltage range.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          stringVocCold: values.stringVocCold,
          mpptVoltageMax,
        },
      })
    );
  }

  if (values.stringVmpHot >= mpptVoltageMin) {
    checks.push(
      passCheck({
        code: "STRING_HOT_VMP_VS_MPPT_MIN",
        category: "pv_design",
        title: `Array ${array.index + 1}: hot Vmp above MPPT minimum voltage`,
        message: "The string hot-weather operating voltage is above the MPPT minimum voltage.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          stringVmpHot: values.stringVmpHot,
          mpptVoltageMin,
          maxCellTempC: assumptions.maxCellTempC,
        },
      })
    );
  } else {
    checks.push(
      failCheck({
        code: "STRING_HOT_VMP_VS_MPPT_MIN",
        category: "pv_design",
        title: `Array ${array.index + 1}: hot Vmp below MPPT minimum voltage`,
        message:
          "The string hot-weather operating voltage is below the MPPT minimum voltage. This string may be too short.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          stringVmpHot: values.stringVmpHot,
          mpptVoltageMin,
          maxCellTempC: assumptions.maxCellTempC,
        },
      })
    );
  }

  if (values.stringVmpSTC >= startupVoltage) {
    checks.push(
      passCheck({
        code: "STRING_VMP_VS_STARTUP_VOLTAGE",
        category: "pv_design",
        title: `Array ${array.index + 1}: string voltage above startup voltage`,
        message: "The string STC operating voltage is above the inverter startup voltage.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          stringVmpSTC: values.stringVmpSTC,
          startupVoltage,
        },
      })
    );
  } else {
    checks.push(
      failCheck({
        code: "STRING_VMP_VS_STARTUP_VOLTAGE",
        category: "pv_design",
        title: `Array ${array.index + 1}: string voltage below startup voltage`,
        message: "The string STC operating voltage is below the inverter startup voltage.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          stringVmpSTC: values.stringVmpSTC,
          startupVoltage,
        },
      })
    );
  }

  if (values.stringImpA <= Number(mppt.maxInputCurrentA || 0)) {
    checks.push(
      passCheck({
        code: "STRING_IMP_VS_MPPT_INPUT_CURRENT",
        category: "pv_design",
        title: `Array ${array.index + 1}: operating current within MPPT limit`,
        message: "The string operating current is within the MPPT input current limit.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          stringImpA: values.stringImpA,
          maxInputCurrentA: Number(mppt.maxInputCurrentA || 0),
        },
      })
    );
  } else {
    checks.push(
      failCheck({
        code: "STRING_IMP_VS_MPPT_INPUT_CURRENT",
        category: "pv_design",
        title: `Array ${array.index + 1}: operating current exceeds MPPT limit`,
        message: "The string operating current exceeds the MPPT input current limit.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          stringImpA: values.stringImpA,
          maxInputCurrentA: Number(mppt.maxInputCurrentA || 0),
        },
      })
    );
  }

  if (values.stringIscA <= Number(mppt.maxShortCircuitCurrentA || 0)) {
    checks.push(
      passCheck({
        code: "STRING_ISC_VS_MPPT_SHORT_CIRCUIT_CURRENT",
        category: "pv_design",
        title: `Array ${array.index + 1}: short-circuit current within MPPT limit`,
        message: "The string short-circuit current is within the MPPT short-circuit current limit.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          stringIscA: values.stringIscA,
          maxShortCircuitCurrentA: Number(mppt.maxShortCircuitCurrentA || 0),
        },
      })
    );
  } else {
    checks.push(
      failCheck({
        code: "STRING_ISC_VS_MPPT_SHORT_CIRCUIT_CURRENT",
        category: "pv_design",
        title: `Array ${array.index + 1}: short-circuit current exceeds MPPT limit`,
        message: "The string short-circuit current exceeds the MPPT short-circuit current limit.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          stringIscA: values.stringIscA,
          maxShortCircuitCurrentA: Number(mppt.maxShortCircuitCurrentA || 0),
        },
      })
    );
  }

  const arrayDcPowerKW = round2((Number(panel?.wattage || 0) * Number(array.panels || 0)) / 1000);

  if (arrayDcPowerKW <= Number(mppt.maxDcPowerKW || 0)) {
    checks.push(
      passCheck({
        code: "ARRAY_DC_POWER_VS_MPPT_POWER",
        category: "pv_design",
        title: `Array ${array.index + 1}: DC power within MPPT power assumption`,
        message: "The array DC power is within the current MPPT DC power assumption.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          arrayDcPowerKW,
          maxDcPowerKW: Number(mppt.maxDcPowerKW || 0),
        },
      })
    );
  } else {
    checks.push(
      warnCheck({
        code: "ARRAY_DC_POWER_VS_MPPT_POWER",
        category: "pv_design",
        title: `Array ${array.index + 1}: DC power above MPPT power assumption`,
        message:
          "The array DC power is above the current MPPT DC power assumption. This may be acceptable for some inverters but should be checked.",
        values: {
          arrayId: array.id,
          mpptId: mppt.id,
          arrayDcPowerKW,
          maxDcPowerKW: Number(mppt.maxDcPowerKW || 0),
        },
      })
    );
  }

  return checks;
}

function checkBatteryCompatibility({ battery, inverter }) {
  if (!battery) {
    return [
      notApplicableCheck({
        code: "NO_BATTERY_SELECTED",
        category: "battery_design",
        title: "No battery selected",
        message: "Battery compatibility checks are not applicable because no battery was selected.",
      }),
    ];
  }

  const checks = [];
  const batteryPort = inverter?.batteryPort || {};

  const supportedTypes = Array.isArray(batteryPort.supportedBatteryTypes)
    ? batteryPort.supportedBatteryTypes
    : [];

  const compatibleBatteryIds = Array.isArray(batteryPort.compatibleBatteryIds)
    ? batteryPort.compatibleBatteryIds
    : [];

  const batteryCompatibleInverterIds = Array.isArray(battery.compatibleInverterIds)
    ? battery.compatibleInverterIds
    : [];

  const typeCompatible =
    supportedTypes.length === 0 || supportedTypes.includes(battery.batteryType);

  const idCompatible =
    compatibleBatteryIds.length === 0 ||
    compatibleBatteryIds.includes(battery.id) ||
    batteryCompatibleInverterIds.includes(inverter.id);

  if (typeCompatible && idCompatible) {
    checks.push(
      passCheck({
        code: "BATTERY_INVERTER_COMPATIBILITY",
        category: "battery_design",
        title: "Battery/inverter compatibility data passes",
        message: "The battery type and compatibility fields are acceptable for the selected inverter.",
        values: {
          batteryId: battery.id,
          inverterId: inverter.id,
          batteryType: battery.batteryType,
          supportedBatteryTypes: supportedTypes,
        },
      })
    );
  } else {
    checks.push(
      failCheck({
        code: "BATTERY_INVERTER_COMPATIBILITY",
        category: "battery_design",
        title: "Battery/inverter compatibility issue",
        message: "The battery type or product compatibility fields do not match the selected inverter.",
        values: {
          batteryId: battery.id,
          inverterId: inverter.id,
          batteryType: battery.batteryType,
          supportedBatteryTypes: supportedTypes,
          compatibleBatteryIds,
          batteryCompatibleInverterIds,
        },
      })
    );
  }

  const sameBrand =
    String(battery.brand || "").toLowerCase() === String(inverter.brand || "").toLowerCase();

  if (sameBrand) {
    checks.push(
      passCheck({
        code: "BATTERY_INVERTER_BRAND_ALIGNMENT",
        category: "battery_design",
        title: "Battery and inverter brand aligned",
        message: "The selected battery and inverter have the same catalogue brand.",
        values: {
          batteryBrand: battery.brand,
          inverterBrand: inverter.brand,
        },
      })
    );
  } else {
    checks.push(
      warnCheck({
        code: "BATTERY_INVERTER_BRAND_ALIGNMENT",
        category: "battery_design",
        title: "Battery and inverter brands differ",
        message:
          "The selected battery and inverter brands differ. Manufacturer compatibility should be confirmed.",
        values: {
          batteryBrand: battery.brand,
          inverterBrand: inverter.brand,
        },
      })
    );
  }

  return checks;
}

function checkBatteryPowerWindows({
  battery,
  inverter,
  assumptions,
  tariffAfter,
}) {
  if (!battery) {
    return [];
  }

  const checks = [];
  const port = inverter?.batteryPort || {};

  const effectiveChargeKW = Math.min(
    Number(battery.maxChargeKW || 0),
    Number(port.maxChargeKW || battery.maxChargeKW || 0)
  );

  const effectiveDischargeKW = Math.min(
    Number(battery.maxDischargeKW || 0),
    Number(port.maxDischargeKW || battery.maxDischargeKW || 0)
  );

  const usableKWh = Number(battery.usableCapacityKWh || 0);

  const fullChargeHours =
    effectiveChargeKW > 0 ? usableKWh / effectiveChargeKW : Infinity;

  const fullDischargeHours =
    effectiveDischargeKW > 0 ? usableKWh / effectiveDischargeKW : Infinity;

  const afterType = String(tariffAfter?.tariffType || "standard").toLowerCase();
  const hasShortWindowTariff =
    afterType === "flux" ||
    afterType === "overnight" ||
    !!tariffAfter?.allowGridCharging ||
    !!tariffAfter?.exportFromBatteryEnabled;

  if (fullChargeHours <= assumptions.shortTariffWindowHours) {
    checks.push(
      passCheck({
        code: "BATTERY_FULL_CHARGE_WITHIN_SHORT_WINDOW",
        category: "battery_design",
        title: "Battery can charge within short tariff window",
        message: "The selected battery can theoretically charge within the short tariff window assumption.",
        values: {
          usableKWh,
          effectiveChargeKW: round2(effectiveChargeKW),
          fullChargeHours: round2(fullChargeHours),
          shortTariffWindowHours: assumptions.shortTariffWindowHours,
        },
      })
    );
  } else {
    checks.push(
      hasShortWindowTariff
        ? warnCheck({
            code: "BATTERY_FULL_CHARGE_WITHIN_SHORT_WINDOW",
            category: "battery_design",
            title: "Battery may be too large to fully charge in short tariff window",
            message:
              "The selected battery may not fully charge within the short tariff window assumption.",
            values: {
              usableKWh,
              effectiveChargeKW: round2(effectiveChargeKW),
              fullChargeHours: round2(fullChargeHours),
              shortTariffWindowHours: assumptions.shortTariffWindowHours,
            },
          })
        : infoCheck({
            code: "BATTERY_FULL_CHARGE_WITHIN_SHORT_WINDOW",
            category: "battery_design",
            title: "Battery charge window noted",
            message:
              "The selected battery takes longer than the short tariff window assumption to fully charge, but the current tariff may not require full short-window charging.",
            values: {
              usableKWh,
              effectiveChargeKW: round2(effectiveChargeKW),
              fullChargeHours: round2(fullChargeHours),
              shortTariffWindowHours: assumptions.shortTariffWindowHours,
            },
          })
    );
  }

  if (fullDischargeHours <= assumptions.shortTariffWindowHours) {
    checks.push(
      passCheck({
        code: "BATTERY_FULL_DISCHARGE_WITHIN_SHORT_WINDOW",
        category: "battery_design",
        title: "Battery can discharge within short tariff window",
        message: "The selected battery can theoretically discharge within the short tariff window assumption.",
        values: {
          usableKWh,
          effectiveDischargeKW: round2(effectiveDischargeKW),
          fullDischargeHours: round2(fullDischargeHours),
          shortTariffWindowHours: assumptions.shortTariffWindowHours,
        },
      })
    );
  } else {
    checks.push(
      hasShortWindowTariff
        ? warnCheck({
            code: "BATTERY_FULL_DISCHARGE_WITHIN_SHORT_WINDOW",
            category: "battery_design",
            title: "Battery may be too large to fully discharge in short tariff window",
            message:
              "The selected battery may not fully discharge within the short tariff window assumption.",
            values: {
              usableKWh,
              effectiveDischargeKW: round2(effectiveDischargeKW),
              fullDischargeHours: round2(fullDischargeHours),
              shortTariffWindowHours: assumptions.shortTariffWindowHours,
            },
          })
        : infoCheck({
            code: "BATTERY_FULL_DISCHARGE_WITHIN_SHORT_WINDOW",
            category: "battery_design",
            title: "Battery discharge window noted",
            message:
              "The selected battery takes longer than the short tariff window assumption to fully discharge, but the current tariff may not require full short-window discharge.",
            values: {
              usableKWh,
              effectiveDischargeKW: round2(effectiveDischargeKW),
              fullDischargeHours: round2(fullDischargeHours),
              shortTariffWindowHours: assumptions.shortTariffWindowHours,
            },
          })
    );
  }

  return checks;
}

function buildOptimisationFlags({ arrays, inverter, checks }) {
  const flags = [];

  const shadedArrays = arrays.filter(
    (array) => String(array.shading || "none").toLowerCase() !== "none"
  );

  const orientations = new Set(arrays.map((array) => String(array.orientation || "")));
  const tilts = new Set(arrays.map((array) => String(array.tilt || "")));

  if (shadedArrays.length > 0) {
    flags.push({
      code: "SHADED_ARRAY_OPTIMISATION_REVIEW",
      reason: "One or more roof arrays has shading.",
      possibleSolutions: ["optimisers", "microinverters", "separate MPPTs", "avoid shaded roof area"],
      severity: "warning",
    });
  }

  if (orientations.size > 1) {
    flags.push({
      code: "MIXED_ORIENTATION_OPTIMISATION_REVIEW",
      reason: "Multiple roof orientations are present.",
      possibleSolutions: ["separate MPPTs", "optimisers", "microinverters"],
      severity: "info",
    });
  }

  if (tilts.size > 1) {
    flags.push({
      code: "MIXED_TILT_OPTIMISATION_REVIEW",
      reason: "Multiple roof tilts are present.",
      possibleSolutions: ["separate MPPTs", "optimisers", "microinverters"],
      severity: "info",
    });
  }

  const mpptCount = Number(inverter?.dcInput?.mpptCount || 0);

  if (arrays.length > mpptCount) {
    flags.push({
      code: "ARRAYS_EXCEED_MPPTS_OPTIMISATION_REVIEW",
      reason: "The number of arrays exceeds the selected inverter MPPT count.",
      possibleSolutions: ["different inverter", "optimisers", "microinverters", "split across inverters"],
      severity: "warning",
    });
  }

  const voltageTooLow = checks.some(
    (check) =>
      check.code === "STRING_HOT_VMP_VS_MPPT_MIN" &&
      check.status === "fail"
  );

  if (voltageTooLow) {
    flags.push({
      code: "SHORT_STRING_OPTIMISATION_REVIEW",
      reason: "At least one string may be too short for the MPPT voltage window.",
      possibleSolutions: ["change inverter", "microinverters", "optimisers", "change string layout"],
      severity: "warning",
    });
  }

  return flags;
}

function buildComparisonAxes({ panel, inverter, battery }) {
  return {
    upfrontCost: {
      panelInstalledAdder: panel?.pricing?.estimatedInstalledAdder ?? null,
      inverterInstalledAdder: inverter?.pricing?.estimatedInstalledAdder ?? null,
      batteryInstalledAdder: battery?.pricing?.estimatedInstalledAdder ?? null,
      note:
        "Cost comparison is not yet used for final product selection. It is provided as a future scoring axis.",
    },

    warranty: {
      panelProductWarrantyYears: panel?.warranty?.productWarrantyYears ?? null,
      panelPerformanceWarrantyYears: panel?.warranty?.performanceWarrantyYears ?? null,
      inverterWarrantyYears: inverter?.warrantyYears ?? null,
      batteryWarrantyYears: battery?.warrantyYears ?? null,
      note:
        "Warranty comparison is not yet used for final product selection. It is provided as a future scoring axis.",
    },

    optimisationCapability: {
      inverterType: inverter?.inverterType || null,
      backupCompatible: inverter?.backupCompatible === true,
      batteryCompatible: inverter?.batteryCompatible === true,
      mpptCount: inverter?.dcInput?.mpptCount ?? null,
      softwareOptimisationScore: inverter?.softwareOptimisationScore ?? null,
      ecosystemScore: inverter?.ecosystemScore ?? null,
      note:
        "Optimisation capability is not yet scored. Later this can compare systems such as SigEnergy, FoxESS, SolarEdge, Enphase and others.",
    },
  };
}

function summarizeChecks(checks) {
  return checks.reduce(
    (summary, check) => {
      summary.total += 1;
      summary[check.status] = (summary[check.status] || 0) + 1;
      return summary;
    },
    {
      total: 0,
      pass: 0,
      warn: 0,
      fail: 0,
      info: 0,
      not_applicable: 0,
    }
  );
}

function buildDesignCompatibilityPreview({
  quote = null,
  input = null,
  roofs = null,
  panelId = null,
  inverterId = null,
  batteryId = null,
  assumptions = {},
} = {}) {
  const source = input || {};
  const activeRoofs = getActiveArrays(roofs || source.roofs || []);

  const mergedAssumptions = {
    ...DEFAULT_DESIGN_COMPATIBILITY_ASSUMPTIONS,
    ...(assumptions || {}),
    dcAcRatio: {
      ...DEFAULT_DESIGN_COMPATIBILITY_ASSUMPTIONS.dcAcRatio,
      ...(assumptions?.dcAcRatio || {}),
    },
    optimiserRules: {
      ...DEFAULT_DESIGN_COMPATIBILITY_ASSUMPTIONS.optimiserRules,
      ...(assumptions?.optimiserRules || {}),
    },
  };

  const panel = getPanelForDesign({
    panelId,
    panelOption: source.panelOption || quote?.panelOption || "value",
  });

  const totalPanels =
    getTotalPanels(activeRoofs) ||
    Number(source.panelCount || quote?.panelCount || 0);

  const systemSizeKwp = getSystemSizeKwp({
    panel,
    totalPanels,
    fallbackSystemSizeKwp: quote?.systemSizeKwp,
  });

  const batteryKWh = Number(source.batteryKWh ?? quote?.hourlyModel?._batteryKWh ?? 0);

  const inverter = chooseInverterForDesign({
    inverterId,
    systemSizeKwp,
    batteryKWh,
  });

  const battery = chooseBatteryForDesign({
    batteryId,
    batteryKWh,
  });

  const checks = [];

  if (!panel) {
    checks.push(
      failCheck({
        code: "PANEL_PRODUCT_SELECTED",
        category: "catalogue",
        title: "No panel product selected",
        message: "No active panel product could be selected from the catalogue.",
      })
    );
  } else {
    checks.push(
      passCheck({
        code: "PANEL_PRODUCT_SELECTED",
        category: "catalogue",
        title: "Panel product selected",
        message: "A panel product is available for design compatibility checks.",
        values: {
          panelId: panel.id,
          wattage: panel.wattage,
          panelOption: panel.panelOption,
        },
      })
    );
  }

  if (!inverter) {
    checks.push(
      failCheck({
        code: "INVERTER_PRODUCT_SELECTED",
        category: "catalogue",
        title: "No inverter product selected",
        message: "No active inverter product could be selected from the catalogue.",
      })
    );
  } else {
    checks.push(
      passCheck({
        code: "INVERTER_PRODUCT_SELECTED",
        category: "catalogue",
        title: "Inverter product selected",
        message: "An inverter product is available for design compatibility checks.",
        values: {
          inverterId: inverter.id,
          maxAcOutputKW: inverter.maxAcOutputKW,
          maxPvInputKW: inverter.maxPvInputKW,
        },
      })
    );
  }

  if (!panel || !inverter) {
    return {
      version: DESIGN_COMPATIBILITY_VERSION,
      mode: "diagnostic_only",
      usedForCalculation: false,
      assumptions: mergedAssumptions,
      selectedProducts: {
        panel,
        inverter,
        battery,
      },
      summary: summarizeChecks(checks),
      checks,
      optimisationFlags: [],
      comparisonAxes: buildComparisonAxes({ panel, inverter, battery }),
    };
  }

  checks.push(checkMpptCapacity({ arrays: activeRoofs, inverter }));
  checks.push(checkTotalDcInput({ systemSizeKwp, inverter }));
  checks.push(checkDcAcRatio({ systemSizeKwp, inverter, assumptions: mergedAssumptions }));

  const mppts = inverter?.dcInput?.mppts || [];

  for (let i = 0; i < activeRoofs.length; i++) {
    const array = activeRoofs[i];
    const mppt = mppts[i] || null;

    checks.push(
      ...checkArrayAgainstMppt({
        panel,
        array,
        inverter,
        mppt,
        assumptions: mergedAssumptions,
      })
    );
  }

  checks.push(
    ...checkBatteryCompatibility({
      battery,
      inverter,
    })
  );

  checks.push(
    ...checkBatteryPowerWindows({
      battery,
      inverter,
      assumptions: mergedAssumptions,
      tariffAfter: source.tariffAfter || quote?.tariffAfter || quote?.tariff || null,
    })
  );

  const optimisationFlags = buildOptimisationFlags({
    arrays: activeRoofs,
    inverter,
    checks,
  });

  return {
    version: DESIGN_COMPATIBILITY_VERSION,
    mode: "diagnostic_only",
    usedForCalculation: false,
    assumptions: mergedAssumptions,

    selectedProducts: {
      panel: panel
        ? {
            id: panel.id,
            brand: panel.brand,
            model: panel.model,
            wattage: panel.wattage,
            panelOption: panel.panelOption,
            isPlaceholder: !!panel.isPlaceholder,
          }
        : null,

      inverter: inverter
        ? {
            id: inverter.id,
            brand: inverter.brand,
            model: inverter.model,
            inverterType: inverter.inverterType,
            maxAcOutputKW: inverter.maxAcOutputKW,
            maxPvInputKW: inverter.maxPvInputKW,
            mpptCount: inverter.dcInput?.mpptCount ?? null,
            isPlaceholder: !!inverter.isPlaceholder,
          }
        : null,

      battery: battery
        ? {
            id: battery.id,
            brand: battery.brand,
            model: battery.model,
            usableCapacityKWh: battery.usableCapacityKWh,
            maxChargeKW: battery.maxChargeKW,
            maxDischargeKW: battery.maxDischargeKW,
            isPlaceholder: !!battery.isPlaceholder,
          }
        : null,
    },

    designInputs: {
      totalPanels,
      arrayCount: activeRoofs.length,
      systemSizeKwp,
      batteryKWh,
      arrays: activeRoofs.map((array) => ({
        id: array.id,
        orientation: array.orientation,
        tilt: array.tilt,
        shading: array.shading,
        panels: array.panels,
      })),
    },

    summary: summarizeChecks(checks),
    checks,
    optimisationFlags,
    comparisonAxes: buildComparisonAxes({ panel, inverter, battery }),
  };
}

module.exports = {
  DESIGN_COMPATIBILITY_VERSION,
  DEFAULT_DESIGN_COMPATIBILITY_ASSUMPTIONS,
  buildDesignCompatibilityPreview,
};