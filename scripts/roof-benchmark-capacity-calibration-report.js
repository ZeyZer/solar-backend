try {
  require("dotenv").config();
} catch {
  // dotenv is optional for this script.
}

const fs = require("fs");
const path = require("path");

const {
  analyseSolarTargetBuildings,
} = require("../services/roof/solarTargetBuildingService");

const DEFAULT_INPUT_PATH = path.join(
  process.cwd(),
  "data",
  "roof-benchmark",
  "benchmark-properties.local.json"
);

const RESULTS_DIR = path.join(
  process.cwd(),
  "data",
  "roof-benchmark",
  "results"
);

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round3(value) {
  const number = numberOrNull(value);

  if (number === null) {
    return null;
  }

  return Math.round(number * 1000) / 1000;
}

function percentageDifference(actual, expected) {
  const cleanActual = numberOrNull(actual);
  const cleanExpected = numberOrNull(expected);

  if (
    cleanActual === null ||
    cleanExpected === null ||
    cleanExpected === 0
  ) {
    return null;
  }

  return (
    Math.round(
      ((cleanActual - cleanExpected) / cleanExpected) *
        1000
    ) / 10
  );
}

function utilisationRatio(referenceValue, capacityValue) {
  const reference = numberOrNull(referenceValue);
  const capacity = numberOrNull(capacityValue);

  if (
    reference === null ||
    capacity === null ||
    capacity <= 0
  ) {
    return null;
  }

  return round3(reference / capacity);
}

function kwpFromPanels(panelCount, panelWatts) {
  const panels = numberOrNull(panelCount);
  const watts = numberOrNull(panelWatts);

  if (
    panels === null ||
    watts === null ||
    panels < 0 ||
    watts <= 0
  ) {
    return null;
  }

  return round3((panels * watts) / 1000);
}

function getInstallerPanelWatts(item = {}) {
  return (
    numberOrNull(
      item.installerDesignTruth?.panelWattage
    ) ??
    numberOrNull(
      item.installerDesignTruth?.panel?.wattage
    )
  );
}

function getInstallerSystemSizeKwp(item = {}) {
  const statedSystemSize = numberOrNull(
    item.installerDesignTruth?.systemSizeKwp
  );

  if (statedSystemSize !== null) {
    return statedSystemSize;
  }

  return kwpFromPanels(
    item.installerDesignTruth?.panelCount,
    getInstallerPanelWatts(item)
  );
}

function getCoordinates(item = {}) {
  const property = item.property || {};

  return {
    latitude: numberOrNull(
      property.latitude ??
        item.targetLatitude ??
        item.googleSolarApiTest?.targetLatitude
    ),
    longitude: numberOrNull(
      property.longitude ??
        item.targetLongitude ??
        item.googleSolarApiTest?.targetLongitude
    ),
  };
}

function getAllRoofSegments(model = {}) {
  const groups = [
    model.recommendedSegments,
    model.optionalSegments,
    model.notRecommendedSegments,
    model.hiddenSegments,
  ];

  return groups.flatMap((group) =>
    Array.isArray(group) ? group : []
  );
}

function getDiagnosticRoofAreaM2(model = {}) {
  const segments = getAllRoofSegments(model);

  if (!segments.length) {
    return null;
  }

  const total = segments.reduce((sum, segment) => {
    return sum + (numberOrNull(segment?.areaM2) || 0);
  }, 0);

  return round3(total);
}

async function buildCalibrationDiagnostic(item) {
  const coords = getCoordinates(item);

  if (
    coords.latitude === null ||
    coords.longitude === null
  ) {
    return {
      id: item.id,
      label: item.label,
      status: "skipped",
      reason: "missing_coordinates",
    };
  }

  const propertyType =
    item.property?.propertyType ||
    "unknown";

  const propertyBoundary =
    item.roofModelInput?.propertyBoundary ||
    null;

  const target = {
    id: `${item.id}-target-1`,
    label: item.label || item.id,
    source: "roof_capacity_calibration_benchmark",
    latitude: coords.latitude,
    longitude: coords.longitude,
    propertyType,
  };

  const analysis =
    await analyseSolarTargetBuildings([target], {
      requiredQuality:
        process.env.SOLAR_API_REQUIRED_QUALITY ||
        "BASE",
      includeDetectedArrays: false,
      maxTargets: 1,
      propertyType,
      propertyBoundary,
    });

  const buildings = Array.isArray(
    analysis?.solarBuildingModels
  )
    ? analysis.solarBuildingModels
    : [];

  if (!buildings.length) {
    return {
      id: item.id,
      label: item.label,
      status: "failed",
      reason: "no_solar_building_model",
    };
  }

  const building = buildings[0];

  const boundaryFilter =
    building.propertyBoundaryFilter || {};

  const model =
    building.roofSelectionModel || {};

  const summary =
    model.summary || {};

  const installerPanels = numberOrNull(
    item.installerDesignTruth?.panelCount
  );

  const installerPanelWatts =
    getInstallerPanelWatts(item);

  const installerSystemSizeKwp =
    getInstallerSystemSizeKwp(item);

  const knownPhysicalCapacityPanels =
    numberOrNull(
      item.installerDesignTruth?.physicalRoofCapacityPanels
    );

  const knownPhysicalCapacityReferenceKwp =
    kwpFromPanels(
      knownPhysicalCapacityPanels,
      installerPanelWatts
    );

  const zeyzerPanelWatts =
    numberOrNull(
      summary.panelAssumption?.panelWatts
    );

  const recommendedCapacityPanels =
    numberOrNull(
      summary.recommendedCapacityPanels
    );

  const optionalCapacityPanels =
    numberOrNull(
      summary.optionalCapacityPanels
    );

  const selectableCapacityPanels =
    numberOrNull(
      summary.selectableCapacityPanels
    );

  const defaultSelectedCapacityPanels =
    numberOrNull(
      summary.defaultSelectedCapacityPanels
    );

  const currentSuggestedPanels =
    numberOrNull(
      model.suggestedPanelRange?.expected
    ) ??
    numberOrNull(
      summary.currentAutoExpectedPanels
    );

  const googlePanelWatts =
    numberOrNull(
      summary.googlePanelAssumption?.panelWatts
    ) ??
    numberOrNull(
      model.googlePanelAssumption?.panelWatts
    );

  const recommendedCapacityKwp =
    kwpFromPanels(
      recommendedCapacityPanels,
      zeyzerPanelWatts
    );

  const selectableCapacityKwp =
    kwpFromPanels(
      selectableCapacityPanels,
      zeyzerPanelWatts
    );

  const defaultSelectedCapacityKwp =
    kwpFromPanels(
      defaultSelectedCapacityPanels,
      zeyzerPanelWatts
    );

  const defaultSelectedGooglePanelCount =
    Array.isArray(model.defaultSelectedSegments)
      ? model.defaultSelectedSegments.reduce(
          (sum, segment) =>
            sum +
            (numberOrNull(
              segment?.googleMaxConfigPanels
            ) || 0),
          0
        )
      : null;

  const defaultSelectedGoogleCapacityKwp =
    kwpFromPanels(
      defaultSelectedGooglePanelCount,
      googlePanelWatts
    );

  const currentSuggestedSystemSizeKwp =
    kwpFromPanels(
      currentSuggestedPanels,
      zeyzerPanelWatts
    );

  return {
    id: item.id,
    label: item.label,
    status: "complete",

    propertyType,

    installerReference: {
      panelCount: installerPanels,
      panelWatts: installerPanelWatts,
      systemSizeKwp: installerSystemSizeKwp,
      annualProductionKwh:
        numberOrNull(
          item.installerDesignTruth
            ?.annualProductionKwh
        ) ??
        numberOrNull(
          item.installerDesignTruth
            ?.annualGenerationKwh
        ),

      knownPhysicalCapacityPanels,
      knownPhysicalCapacityReferenceKwp,

      referenceWarning:
        "Installer design is a reference system, not automatically a maximum physical roof capacity.",
    },

    boundaryFilter: {
      applied:
        boundaryFilter.applied === true,
      source:
        boundaryFilter.source || null,
      originalPanelCount:
        numberOrNull(
          boundaryFilter.originalPanelCount
        ),
      keptPanelCount:
        numberOrNull(
          boundaryFilter.keptPanelCount
        ),
      excludedPanelCount:
        numberOrNull(
          boundaryFilter.excludedPanelCount
        ),
      keptPanelsBySegment:
        boundaryFilter.keptPanelsBySegment ||
        null,
    },

    roofCapacity: {
      googleMaxPanels:
        numberOrNull(
          summary.googleMaxPanels
        ),

      zeyzerPanelWatts,

      recommendedCapacityPanels,
      recommendedCapacityKwp,

      optionalCapacityPanels,

      selectableCapacityPanels,
      selectableCapacityKwp,

      defaultSelectedCapacityPanels,
      defaultSelectedCapacityKwp,

      defaultSelectedSegmentCount:
        numberOrNull(
          summary.defaultSelectedSegmentCount
        ),

      defaultSelectedSegmentIndexes:
        Array.isArray(model.defaultSelectedSegments)
          ? model.defaultSelectedSegments.map(
              (segment) => segment.segmentIndex
            )
          : [],

      googleCapacityBasis: {
        googlePanelWatts,
        defaultSelectedGooglePanelCount,
        defaultSelectedGoogleCapacityKwp,
      },

      recommendedSegmentCount:
        numberOrNull(
          summary.recommendedSegmentCount
        ),
      optionalSegmentCount:
        numberOrNull(
          summary.optionalSegmentCount
        ),
      totalSegmentCount:
        numberOrNull(
          summary.totalSegmentCount
        ),

      diagnosticGoogleRoofAreaM2:
        getDiagnosticRoofAreaM2(model),
      roofAreaWarning:
        "Diagnostic only. Google roof-segment area may still include adjoining property area after boundary filtering.",
    },

    currentSuggestion: {
      panels: currentSuggestedPanels,
      systemSizeKwp:
        currentSuggestedSystemSizeKwp,

      panelCountReferenceDeltaPercent:
        percentageDifference(
          currentSuggestedPanels,
          installerPanels
        ),

      systemSizeReferenceDeltaPercent:
        percentageDifference(
          currentSuggestedSystemSizeKwp,
          installerSystemSizeKwp
        ),
    },

    calibrationObservation: {
      primaryMetric:
        "system_size_kwp",

      installerReferenceSystemSizeKwp:
        installerSystemSizeKwp,

      recommendedCapacityKwp,
      selectableCapacityKwp,
      defaultSelectedCapacityKwp,
      defaultSelectedGoogleCapacityKwp,

      candidateCapacityBases: {
        zeyzerAdjustedDefaultSelectedKwp:
          defaultSelectedCapacityKwp,

        googleDefaultSelectedKwp:
          defaultSelectedGoogleCapacityKwp,
      },

      requiredUtilisationOfDefaultSelectedZeyzerCapacityKwp:
        utilisationRatio(
          installerSystemSizeKwp,
          defaultSelectedCapacityKwp
        ),

      requiredUtilisationOfDefaultSelectedGoogleCapacityKwp:
        utilisationRatio(
          installerSystemSizeKwp,
          defaultSelectedGoogleCapacityKwp
        ),

      requiredUtilisationOfRecommendedCapacityKwp:
        utilisationRatio(
          installerSystemSizeKwp,
          recommendedCapacityKwp
        ),

      requiredUtilisationOfSelectableCapacityKwp:
        utilisationRatio(
          installerSystemSizeKwp,
          selectableCapacityKwp
        ),

      panelCountDiagnostics: {
        installerPanels,

        requiredUtilisationOfRecommendedPanelCapacity:
          utilisationRatio(
            installerPanels,
            recommendedCapacityPanels
          ),

        requiredUtilisationOfSelectablePanelCapacity:
          utilisationRatio(
            installerPanels,
            selectableCapacityPanels
          ),
      },
    },
  };
}

async function main() {
  const requestedId =
    process.argv[2] || null;

  if (!fs.existsSync(DEFAULT_INPUT_PATH)) {
    throw new Error(
      `Benchmark file not found: ${DEFAULT_INPUT_PATH}`
    );
  }

  const items = JSON.parse(
    fs.readFileSync(
      DEFAULT_INPUT_PATH,
      "utf8"
    )
  );

  if (!Array.isArray(items)) {
    throw new Error(
      "Benchmark file must contain an array."
    );
  }

  const selectedItems = requestedId
    ? items.filter(
        (item) => item.id === requestedId
      )
    : items;

  if (!selectedItems.length) {
    throw new Error(
      requestedId
        ? `Benchmark not found: ${requestedId}`
        : "No benchmark properties found."
    );
  }

  const results = [];

  for (const item of selectedItems) {
    console.log(
      `\nRunning capacity calibration diagnostic: ${item.id} — ${item.label}`
    );

    try {
      const diagnostic =
        await buildCalibrationDiagnostic(item);

      results.push(diagnostic);

      console.log("\nCALIBRATION DIAGNOSTIC");
      console.log(
        JSON.stringify(
          diagnostic,
          null,
          2
        )
      );
    } catch (error) {
      console.error(
        `Failed ${item.id}:`,
        error.message
      );

      results.push({
        id: item.id,
        label: item.label,
        status: "failed",
        reason: error.message,
      });
    }
  }

  const runId = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  fs.mkdirSync(
    RESULTS_DIR,
    { recursive: true }
  );

  const outputPath = path.join(
    RESULTS_DIR,
    `roof-capacity-calibration-${runId}.json`
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        runId,
        createdAt:
          new Date().toISOString(),
        requestedId,
        results,
      },
      null,
      2
    )
  );

  console.log(
    `\nSaved calibration diagnostics to: ${outputPath}`
  );
}

main().catch((error) => {
  console.error(
    "\nCapacity calibration benchmark failed."
  );
  console.error(error);
  process.exit(1);
});
