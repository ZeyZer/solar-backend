const HARDWARE_METADATA_NORMALISATION_VERSION = "2026-beta-1";

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function booleanOrNull(value) {
  if (value === true || value === false) return value;

  const normalised = String(value ?? "").trim().toLowerCase();

  if (["true", "yes", "y", "1", "required", "supported"].includes(normalised)) {
    return true;
  }

  if (["false", "no", "n", "0", "not_required", "unsupported"].includes(normalised)) {
    return false;
  }

  return null;
}

function normaliseString(value, fallback = null) {
  const str = String(value ?? "").trim();
  return str || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readPath(object = {}, path = "") {
  const parts = path.split(".");
  let current = object;

  for (const part of parts) {
    if (current && Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return current;
}

function readFirst(object = {}, paths = []) {
  for (const path of paths) {
    const value = readPath(object, path);

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function readFirstNumber(object = {}, paths = []) {
  return numberOrNull(readFirst(object, paths));
}

function readFirstBoolean(object = {}, paths = []) {
  return booleanOrNull(readFirst(object, paths));
}

function getTags(product = {}) {
  return [
    ...asArray(product.tags),
    ...asArray(product.features),
    ...asArray(product.capabilities),
    ...asArray(product.labels),
  ]
    .map((tag) => String(tag || "").trim().toLowerCase())
    .filter(Boolean);
}

function getTextBlob(product = {}) {
  return [
    product.id,
    product.brand,
    product.model,
    product.name,
    product.description,
    product.category,
    product.panelOption,
    product.inverterType,
    product.batteryType,
    product.technology,
    product.aesthetic,
    product.appearance,
    product.colour,
    product.color,
    product.notes,
    ...getTags(product),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function textContainsAny(text = "", needles = []) {
  const safeText = String(text || "").toLowerCase();

  return needles.some((needle) =>
    safeText.includes(String(needle || "").toLowerCase())
  );
}

function inferAllBlackPanel(panel = {}) {
  const explicit = readFirstBoolean(panel, [
    "allBlack",
    "isAllBlack",
    "aesthetic.allBlack",
    "appearance.allBlack",
  ]);

  if (explicit !== null) return explicit;

  const text = getTextBlob(panel);

  if (
    textContainsAny(text, [
      "all black",
      "all-black",
      "full black",
      "full-black",
      "black aesthetic",
      "black frame black backsheet",
    ])
  ) {
    return true;
  }

  if (
    textContainsAny(text, [
      "silver frame",
      "white backsheet",
      "silver",
    ])
  ) {
    return false;
  }

  return null;
}

function inferHybridInverter(inverter = {}) {
  const explicit = readFirstBoolean(inverter, [
    "hybrid",
    "isHybrid",
    "hybridInverter",
    "capabilities.hybrid",
  ]);

  if (explicit !== null) return explicit;

  const inverterType = String(inverter.inverterType || "").toLowerCase();

  if (inverterType === "hybrid") return true;
  if (inverterType === "string" || inverterType === "ac_coupled") return false;

  return textContainsAny(getTextBlob(inverter), ["hybrid"]) || null;
}

function inferBackupCompatible(inverter = {}) {
  const explicit = readFirstBoolean(inverter, [
    "backupCompatible",
    "backupCapable",
    "supportsBackup",
    "backup",
    "eps",
    "hasEps",
    "capabilities.backup",
    "capabilities.backupCompatible",
    "capabilities.eps",
  ]);

  if (explicit !== null) return explicit;

  const text = getTextBlob(inverter);

  if (
    textContainsAny(text, [
      "backup",
      "eps",
      "whole home backup",
      "backup gateway",
    ])
  ) {
    return true;
  }

  return null;
}

function inferMonitoringCapability(product = {}) {
  const explicit = readFirstBoolean(product, [
    "monitoring",
    "monitoringCompatible",
    "supportsMonitoring",
    "capabilities.monitoring",
  ]);

  if (explicit !== null) return explicit;

  const text = getTextBlob(product);

  if (textContainsAny(text, ["monitoring", "app", "smart control", "portal"])) {
    return true;
  }

  return null;
}

function normalisePricing(product = {}) {
  return {
    currency: normaliseString(product?.pricing?.currency, "GBP"),
    materialCost: numberOrNull(product?.pricing?.materialCost),
    estimatedInstalledAdder:
      numberOrNull(product?.pricing?.estimatedInstalledAdder),
    estimatedInstalledCost:
      numberOrNull(product?.pricing?.estimatedInstalledCost),
    notes: product?.pricing?.notes || null,
  };
}

function buildDataQuality(requiredFields = []) {
  const missing = requiredFields
    .filter((field) => field.value === null || field.value === undefined || field.value === "")
    .map((field) => field.field);

  const present = requiredFields.length - missing.length;

  return {
    requiredFieldCount: requiredFields.length,
    presentRequiredFieldCount: present,
    missingRequiredFieldCount: missing.length,
    missingRequiredFields: missing,
    completenessScore:
      requiredFields.length === 0
        ? 100
        : Math.round((present / requiredFields.length) * 100),
  };
}

function normalisePanelMetadata(panel = null) {
  if (!panel) {
    return {
      exists: false,
      category: "panel",
      dataQuality: buildDataQuality([]),
    };
  }

  const wattage = readFirstNumber(panel, ["wattage", "watts", "powerW", "ratedPowerW"]);

  const productWarrantyYears = readFirstNumber(panel, [
    "productWarrantyYears",
    "warrantyYears",
    "warranty.productYears",
    "warranty.product",
    "productWarranty",
  ]);

  const performanceWarrantyYears = readFirstNumber(panel, [
    "performanceWarrantyYears",
    "warranty.performanceYears",
    "warranty.performance",
    "performanceWarranty",
  ]);

  const lengthMm = readFirstNumber(panel, [
    "dimensions.lengthMm",
    "lengthMm",
    "moduleLengthMm",
  ]);

  const widthMm = readFirstNumber(panel, [
    "dimensions.widthMm",
    "widthMm",
    "moduleWidthMm",
  ]);

  const metadata = {
    exists: true,
    category: "panel",

    identifiers: {
      id: panel.id || null,
      brand: panel.brand || null,
      model: panel.model || panel.name || null,
      isPlaceholder: panel.isPlaceholder === true,
      isActive: panel.isActive !== false,
    },

    classification: {
      panelOption: panel.panelOption || null,
      technology: panel.technology || null,
    },

    power: {
      wattage,
      efficiency: numberOrNull(panel.efficiency),
    },

    warranties: {
      productYears: productWarrantyYears,
      performanceYears: performanceWarrantyYears,
    },

    aesthetics: {
      allBlack: inferAllBlackPanel(panel),
      colour: panel.colour || panel.color || null,
      frameColour: panel.frameColour || panel.frameColor || null,
      backsheetColour:
        panel.backsheetColour || panel.backsheetColor || null,
    },

    electrical: {
      voc: readFirstNumber(panel, ["voc", "Voc", "electrical.voc", "electrical.Voc"]),
      vmp: readFirstNumber(panel, ["vmp", "Vmp", "electrical.vmp", "electrical.Vmp"]),
      isc: readFirstNumber(panel, ["isc", "Isc", "electrical.isc", "electrical.Isc"]),
      imp: readFirstNumber(panel, ["imp", "Imp", "electrical.imp", "electrical.Imp"]),
      temperatureCoefficientVoc:
        readFirstNumber(panel, [
          "temperatureCoefficientVoc",
          "tempCoeffVoc",
          "electrical.temperatureCoefficientVoc",
        ]),
    },

    dimensions: {
      lengthMm,
      widthMm,
      areaM2:
        lengthMm && widthMm
          ? Math.round(((lengthMm * widthMm) / 1000000) * 1000) / 1000
          : null,
    },

    degradation: {
      firstYearDegradation: numberOrNull(panel.firstYearDegradation),
      annualDegradationRate: numberOrNull(panel.annualDegradationRate),
    },

    pricing: normalisePricing(panel),

    rawTags: getTags(panel),
  };

  metadata.dataQuality = buildDataQuality([
    { field: "panel.id", value: metadata.identifiers.id },
    { field: "panel.brand", value: metadata.identifiers.brand },
    { field: "panel.model", value: metadata.identifiers.model },
    { field: "panel.wattage", value: metadata.power.wattage },
    { field: "panel.productWarrantyYears", value: metadata.warranties.productYears },
    { field: "panel.materialCost", value: metadata.pricing.materialCost },
  ]);

  return metadata;
}

function normaliseInverterMetadata(inverter = null) {
  if (!inverter) {
    return {
      exists: false,
      category: "inverter",
      dataQuality: buildDataQuality([]),
    };
  }

  const inverterType = inverter.inverterType || inverter.type || null;
  const maxAcOutputKW = readFirstNumber(inverter, [
    "maxAcOutputKW",
    "maxAcPowerKW",
    "acOutputKW",
    "ratedPowerKW",
  ]);

  const maxPvInputKW = readFirstNumber(inverter, [
    "maxPvInputKW",
    "maxDcInputKW",
    "pvInputKW",
  ]);

  const metadata = {
    exists: true,
    category: "inverter",

    identifiers: {
      id: inverter.id || null,
      brand: inverter.brand || null,
      model: inverter.model || inverter.name || null,
      isPlaceholder: inverter.isPlaceholder === true,
      isActive: inverter.isActive !== false,
    },

    classification: {
      inverterType,
      phase: inverter.phase || null,
    },

    power: {
      maxAcOutputKW,
      maxPvInputKW,
      maxChargeKW: readFirstNumber(inverter, [
        "maxChargeKW",
        "battery.maxChargeKW",
      ]),
      maxDischargeKW: readFirstNumber(inverter, [
        "maxDischargeKW",
        "battery.maxDischargeKW",
      ]),
    },

    dcElectrical: {
      mpptCount: readFirstNumber(inverter, [
        "mpptCount",
        "numberOfMppts",
        "dc.mpptCount",
      ]),
      maxDcVoltage: readFirstNumber(inverter, [
        "maxDcVoltage",
        "maxInputVoltage",
        "dc.maxVoltage",
      ]),
      startupVoltage: readFirstNumber(inverter, [
        "startupVoltage",
        "startVoltage",
        "dc.startupVoltage",
      ]),
      minMpptVoltage: readFirstNumber(inverter, [
        "minMpptVoltage",
        "mpptMinVoltage",
        "dc.minMpptVoltage",
      ]),
      maxMpptVoltage: readFirstNumber(inverter, [
        "maxMpptVoltage",
        "mpptMaxVoltage",
        "dc.maxMpptVoltage",
      ]),
      maxInputCurrent: readFirstNumber(inverter, [
        "maxInputCurrent",
        "maxStringCurrent",
        "dc.maxInputCurrent",
      ]),
    },

    capabilities: {
      hybrid: inferHybridInverter(inverter),
      batteryCompatible:
        readFirstBoolean(inverter, [
          "batteryCompatible",
          "supportsBattery",
          "capabilities.batteryCompatible",
        ]) ?? inferHybridInverter(inverter),
      backupCompatible: inferBackupCompatible(inverter),
      monitoring: inferMonitoringCapability(inverter),
      exportControl:
        readFirstBoolean(inverter, [
          "exportControlCompatible",
          "g100Compatible",
          "capabilities.exportControl",
          "capabilities.g100",
        ]),
    },

    warranties: {
      productYears: readFirstNumber(inverter, [
        "warrantyYears",
        "productWarrantyYears",
        "warranty.productYears",
        "standardWarrantyYears",
      ]),
    },

    pricing: normalisePricing(inverter),

    rawTags: getTags(inverter),
  };

  metadata.dataQuality = buildDataQuality([
    { field: "inverter.id", value: metadata.identifiers.id },
    { field: "inverter.brand", value: metadata.identifiers.brand },
    { field: "inverter.model", value: metadata.identifiers.model },
    { field: "inverter.inverterType", value: metadata.classification.inverterType },
    { field: "inverter.maxAcOutputKW", value: metadata.power.maxAcOutputKW },
    { field: "inverter.maxPvInputKW", value: metadata.power.maxPvInputKW },
    { field: "inverter.materialCost", value: metadata.pricing.materialCost },
  ]);

  return metadata;
}

function normaliseBatteryMetadata(battery = null) {
  if (!battery || battery === "no-battery" || battery?.id === "no-battery") {
    return {
      exists: false,
      category: "battery",
      dataQuality: buildDataQuality([]),
    };
  }

  const usableKWh = readFirstNumber(battery, [
    "usableCapacityKWh",
    "usableKWh",
    "usableCapacity",
  ]);

  const nominalKWh = readFirstNumber(battery, [
    "nominalCapacityKWh",
    "nominalKWh",
    "capacityKWh",
  ]);

  const metadata = {
    exists: true,
    category: "battery",

    identifiers: {
      id: battery.id || null,
      brand: battery.brand || null,
      model: battery.model || battery.name || null,
      isPlaceholder: battery.isPlaceholder === true,
      isActive: battery.isActive !== false,
    },

    classification: {
      batteryType: battery.batteryType || battery.type || null,
      compatibleInverterTypes:
        asArray(battery.compatibleInverterTypes),
    },

    capacity: {
      nominalKWh,
      usableKWh,
    },

    power: {
      maxChargeKW: readFirstNumber(battery, ["maxChargeKW", "chargeKW"]),
      maxDischargeKW: readFirstNumber(battery, ["maxDischargeKW", "dischargeKW"]),
    },

    performance: {
      roundTripEfficiency: numberOrNull(battery.roundTripEfficiency),
      degradationRatePerYear: numberOrNull(battery.degradationRatePerYear),
      minCapacityFraction: numberOrNull(battery.minCapacityFraction),
    },

    warranties: {
      productYears: readFirstNumber(battery, [
        "warrantyYears",
        "productWarrantyYears",
        "warranty.productYears",
      ]),
    },

    pricing: normalisePricing(battery),

    rawTags: getTags(battery),
  };

  metadata.dataQuality = buildDataQuality([
    { field: "battery.id", value: metadata.identifiers.id },
    { field: "battery.brand", value: metadata.identifiers.brand },
    { field: "battery.model", value: metadata.identifiers.model },
    { field: "battery.usableCapacityKWh", value: metadata.capacity.usableKWh },
    { field: "battery.maxChargeKW", value: metadata.power.maxChargeKW },
    { field: "battery.maxDischargeKW", value: metadata.power.maxDischargeKW },
    { field: "battery.warrantyYears", value: metadata.warranties.productYears },
    { field: "battery.materialCost", value: metadata.pricing.materialCost },
  ]);

  return metadata;
}

function combineDataQuality(items = []) {
  const qualities = items
    .map((item) => item?.dataQuality)
    .filter(Boolean);

  const requiredFieldCount = qualities.reduce(
    (sum, quality) => sum + Number(quality.requiredFieldCount || 0),
    0
  );

  const presentRequiredFieldCount = qualities.reduce(
    (sum, quality) => sum + Number(quality.presentRequiredFieldCount || 0),
    0
  );

  const missingRequiredFields = qualities.flatMap(
    (quality) => quality.missingRequiredFields || []
  );

  return {
    requiredFieldCount,
    presentRequiredFieldCount,
    missingRequiredFieldCount: missingRequiredFields.length,
    missingRequiredFields,
    completenessScore:
      requiredFieldCount === 0
        ? 100
        : Math.round((presentRequiredFieldCount / requiredFieldCount) * 100),
  };
}

function buildCandidateHardwareMetadataNormalisation(candidate = {}) {
  const panel = normalisePanelMetadata(candidate?.products?.panel || null);
  const inverter = normaliseInverterMetadata(candidate?.products?.inverter || null);
  const battery = normaliseBatteryMetadata(candidate?.products?.battery || null);

  const dataQuality = combineDataQuality([panel, inverter, battery]);

  return {
    version: HARDWARE_METADATA_NORMALISATION_VERSION,
    mode: "candidate_hardware_metadata_normalisation_beta",

    candidateId: candidate?.candidateId || null,

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    appliedToFiltering: false,
    appliedToRanking: false,

    products: {
      panel,
      inverter,
      battery,
    },

    summary: {
      hasPanel: panel.exists === true,
      hasInverter: inverter.exists === true,
      hasBattery: battery.exists === true,
      panelWattage: panel.power?.wattage ?? null,
      inverterType: inverter.classification?.inverterType ?? null,
      inverterHybrid: inverter.capabilities?.hybrid ?? null,
      inverterBackupCompatible:
        inverter.capabilities?.backupCompatible ?? null,
      batteryUsableKWh: battery.capacity?.usableKWh ?? null,
      dataCompletenessScore: dataQuality.completenessScore,
      missingRequiredFieldCount:
        dataQuality.missingRequiredFieldCount,
    },

    dataQuality,

    assumptions: {
      note:
        "Hardware metadata normalisation is diagnostic only. It standardises catalogue fields for future filtering and scoring but does not yet reject or rank products.",
    },
  };
}

function applyHardwareMetadataNormalisationToCandidates({ candidates = [] } = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  return safeCandidates.map((candidate) => ({
    ...candidate,
    hardwareMetadataNormalisation:
      buildCandidateHardwareMetadataNormalisation(candidate),
  }));
}

function buildHardwareMetadataNormalisationSummary({ candidates = [] } = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  const normalisations = safeCandidates
    .map((candidate) => candidate.hardwareMetadataNormalisation)
    .filter(Boolean);

  const scores = normalisations
    .map((item) => numberOrNull(item?.summary?.dataCompletenessScore))
    .filter((score) => score !== null);

  const averageCompletenessScore =
    scores.length === 0
      ? null
      : Math.round(
          scores.reduce((sum, score) => sum + score, 0) / scores.length
        );

  return {
    version: HARDWARE_METADATA_NORMALISATION_VERSION,
    mode: "hardware_metadata_normalisation_summary_beta",

    usedForCalculation: false,
    usedForPricing: false,
    usedForRecommendation: false,

    candidateCount: safeCandidates.length,
    normalisedCandidateCount: normalisations.length,

    averageCompletenessScore,

    candidatesWithMissingRequiredFields: normalisations.filter(
      (item) => Number(item?.summary?.missingRequiredFieldCount || 0) > 0
    ).length,

    productPresence: {
      withPanel: normalisations.filter((item) => item.summary?.hasPanel).length,
      withInverter: normalisations.filter((item) => item.summary?.hasInverter).length,
      withBattery: normalisations.filter((item) => item.summary?.hasBattery).length,
    },

    assumptions: {
      note:
        "This summary measures catalogue metadata readiness for future constraint enforcement and optimiser pruning.",
    },
  };
}

module.exports = {
  HARDWARE_METADATA_NORMALISATION_VERSION,
  normalisePanelMetadata,
  normaliseInverterMetadata,
  normaliseBatteryMetadata,
  buildCandidateHardwareMetadataNormalisation,
  applyHardwareMetadataNormalisationToCandidates,
  buildHardwareMetadataNormalisationSummary,
};