try {
  require("dotenv").config();
} catch {
  // dotenv is optional for this script.
}

const fs = require("fs");
const path = require("path");

const {
  analyseSolarTargetBuildings,
} = require("./services/roof/solarTargetBuildingService");

const {
  buildAutoFilteredRoofEstimate,
} = require("./services/roof/roofBenchmarkAutoFilteredEstimateService");

const {
  buildPanelAssumptionAudit,
} = require("./services/roof/roofBenchmarkPanelAssumptionAuditService");

const {
  buildSegmentPanelAudit,
} = require("./services/roof/roofBenchmarkSegmentPanelAuditService");

const {
  buildSegmentSelectorAudit,
} = require("./services/roof/roofBenchmarkSegmentSelectorService");

const {
  buildPracticalPanelEstimate,
} = require("./services/roof/roofBenchmarkPracticalPanelEstimateService");

const {
  buildProductionDeltaDiagnostic,
} = require("./services/roof/roofBenchmarkProductionDeltaDiagnosticService");

const {
  buildBenchmarkTargetEvaluation,
} = require("./services/roof/roofBenchmarkTargetEvaluationService");

const {
  buildHybridPvgisProductionBenchmark,
} = require("./services/roof/roofBenchmarkHybridPvgisProductionService");

const {
  buildGoogleShadeDataLayersAudit,
} = require("./services/roof/roofBenchmarkGoogleShadeDataLayersAuditService");

const {
  buildGoogleHourlyShadeFactorAudit,
} = require("./services/roof/roofBenchmarkGoogleHourlyShadeFactorService");

const {
  buildSegmentShadeAdjustedPvgisProductionBenchmark,
} = require("./services/roof/roofBenchmarkSegmentShadeAdjustedPvgisProductionService");

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
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Benchmark file not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getTargetCoordinates(property = {}) {
  const latitude =
    property.targetLatitude ??
    property.latitude ??
    property.location?.latitude ??
    property.location?.lat;

  const longitude =
    property.targetLongitude ??
    property.longitude ??
    property.location?.longitude ??
    property.location?.lng;

  return {
    latitude: numberOrNull(latitude),
    longitude: numberOrNull(longitude),
  };
}

function buildTargetFromBenchmark(item) {
  const coords = getTargetCoordinates(item.property || {});

  return {
    id: `${item.id}-target-1`,
    label: item.label || item.id,
    source: "benchmark_property_target",
    latitude: coords.latitude,
    longitude: coords.longitude,
  };
}

function getInstallerPanelCount(item) {
  return numberOrNull(item.installerDesignTruth?.panelCount);
}

function getInstallerAnnualProduction(item) {
  return numberOrNull(item.installerDesignTruth?.annualProductionKwh);
}

function getGooglePanelConfigs(building) {
  if (Array.isArray(building?.googlePanelConfigs)) {
    return building.googlePanelConfigs;
  }

  if (Array.isArray(building?.googlePanelConfigsSample)) {
    return building.googlePanelConfigsSample;
  }

  return [];
}

function getGoogleMaxPanels(analysis) {
  const buildings = Array.isArray(analysis?.solarBuildingModels)
    ? analysis.solarBuildingModels
    : [];

  return buildings.reduce((sum, building) => {
    return (
      sum +
      (numberOrNull(building?.solarPotential?.maxArrayPanelsCount) || 0)
    );
  }, 0);
}

function getGoogleAnnualEnergyKwh(analysis) {
  const buildings = Array.isArray(analysis?.solarBuildingModels)
    ? analysis.solarBuildingModels
    : [];

  return buildings.reduce((sum, building) => {
    const configs = getGooglePanelConfigs(building);

    const maxConfig = configs.reduce((best, config) => {
      const panels = numberOrNull(config?.panelsCount) || 0;
      const bestPanels = numberOrNull(best?.panelsCount) || 0;

      return panels > bestPanels ? config : best;
    }, null);

    return sum + (numberOrNull(maxConfig?.yearlyEnergyDcKwh) || 0);
  }, 0);
}

function getConfigClosestToPanelCount(building, targetPanelCount) {
  const cleanTarget = numberOrNull(targetPanelCount);

  if (cleanTarget === null) {
    return null;
  }

  const configs = getGooglePanelConfigs(building);

  return configs.reduce((best, config) => {
    const panels = numberOrNull(config?.panelsCount);

    if (panels === null) {
      return best;
    }

    if (!best) {
      return config;
    }

    const currentDelta = Math.abs(panels - cleanTarget);
    const bestDelta = Math.abs(
      (numberOrNull(best?.panelsCount) || 0) - cleanTarget
    );

    if (currentDelta < bestDelta) {
      return config;
    }

    if (
      currentDelta === bestDelta &&
      (numberOrNull(config?.yearlyEnergyDcKwh) || 0) >
        (numberOrNull(best?.yearlyEnergyDcKwh) || 0)
    ) {
      return config;
    }

    return best;
  }, null);
}

function getGoogleClosestInstallerConfigSummary(analysis, installerPanelCount) {
  const buildings = Array.isArray(analysis?.solarBuildingModels)
    ? analysis.solarBuildingModels
    : [];

  if (buildings.length !== 1) {
    return null;
  }

  const building = buildings[0];
  const config = getConfigClosestToPanelCount(building, installerPanelCount);

  if (!config) {
    return null;
  }

  return {
    panelsCount: numberOrNull(config.panelsCount),
    yearlyEnergyDcKwh: numberOrNull(config.yearlyEnergyDcKwh),
    roofSegmentSummaries: config.roofSegmentSummaries || [],
  };
}

function percentageDifference(actual, expected) {
  const cleanActual = numberOrNull(actual);
  const cleanExpected = numberOrNull(expected);

  if (cleanActual === null || cleanExpected === null || cleanExpected === 0) {
    return null;
  }

  return Math.round(((cleanActual - cleanExpected) / cleanExpected) * 1000) / 10;
}

function classifyPanelCountAccuracy(panelDeltaPercent) {
  if (panelDeltaPercent === null) {
    return "unknown";
  }

  const absolute = Math.abs(panelDeltaPercent);

  if (absolute <= 10) {
    return "pass_target";
  }

  if (absolute <= 20) {
    return "near_target";
  }

  return "outside_target";
}

async function summariseBenchmarkResult(item, analysis) {
  const installerPanelCount = getInstallerPanelCount(item);
  const installerAnnualProductionKwh = getInstallerAnnualProduction(item);

  const googleMaxPanels = getGoogleMaxPanels(analysis);
  const googleAnnualEnergyKwh = getGoogleAnnualEnergyKwh(analysis);

  const googleClosestInstallerConfig = getGoogleClosestInstallerConfigSummary(
    analysis,
    installerPanelCount
  );

  const autoFilteredEstimate = buildAutoFilteredRoofEstimate(analysis, item);
  const panelAssumptionAudit = buildPanelAssumptionAudit(analysis, item);
  const segmentPanelAudit = buildSegmentPanelAudit(analysis, item);
  const segmentSelectorAudit = buildSegmentSelectorAudit(analysis);
  const practicalPanelEstimate = buildPracticalPanelEstimate(segmentSelectorAudit);
  const productionDeltaDiagnostic = buildProductionDeltaDiagnostic({
    benchmarkItem: item,
    panelAssumptionAudit,
    practicalPanelEstimate,
  });

  const targetEvaluation = buildBenchmarkTargetEvaluation({
    benchmarkItem: item,
    practicalPanelEstimate,
    productionDeltaDiagnostic,
  });

  const hybridPvgisProductionBenchmark =
    await buildHybridPvgisProductionBenchmark({
      benchmarkItem: item,
      panelAssumptionAudit,
      segmentSelectorAudit,
      practicalPanelEstimate,
    });

  const googleShadeDataLayersAudit =
    await buildGoogleShadeDataLayersAudit({
      benchmarkItem: item,
    });

  const googleHourlyShadeFactorAudit =
    await buildGoogleHourlyShadeFactorAudit({
      benchmarkItem: item,
      analysis,
      hybridPvgisProductionBenchmark,
    });

  const segmentShadeAdjustedPvgisProductionBenchmark =
    await buildSegmentShadeAdjustedPvgisProductionBenchmark({
      benchmarkItem: item,
      hybridPvgisProductionBenchmark,
      googleHourlyShadeFactorAudit,
    });

  const panelDeltaPercent = percentageDifference(
    googleMaxPanels,
    installerPanelCount
  );

  const annualEnergyDeltaPercent = percentageDifference(
    googleAnnualEnergyKwh,
    installerAnnualProductionKwh
  );

  const autoFilteredPanelDeltaPercent = percentageDifference(
    autoFilteredEstimate?.panelsCount,
    installerPanelCount
  );

  const autoFilteredEnergyDeltaPercent = percentageDifference(
    autoFilteredEstimate?.annualEnergyKwh,
    installerAnnualProductionKwh
  );

  return {
    id: item.id,
    label: item.label,

    installerTruth: {
      panelCount: installerPanelCount,
      annualProductionKwh: installerAnnualProductionKwh,
      systemSizeKwp: item.installerDesignTruth?.systemSizeKwp ?? null,
      panelWattage: item.installerDesignTruth?.panelWattage ?? null,
      shadeFactor: item.installerDesignTruth?.shadeFactor ?? null,
      shadingLossPercent: item.installerDesignTruth?.shadingLossPercent ?? null,
    },

    googleSolarApi: {
      success: analysis?.success ?? null,
      summary: analysis?.summary ?? null,
      maxPanels: googleMaxPanels || null,
      annualEnergyKwh: googleAnnualEnergyKwh || null,
      closestInstallerPanelCountConfig: googleClosestInstallerConfig,
      autoFilteredEstimate,
      panelAssumptionAudit,
      segmentPanelAudit,
      segmentSelectorAudit,
      practicalPanelEstimate,
      productionDeltaDiagnostic,
      targetEvaluation,
      hybridPvgisProductionBenchmark,
      googleShadeDataLayersAudit,
      googleHourlyShadeFactorAudit,
      segmentShadeAdjustedPvgisProductionBenchmark,
      buildings: (analysis?.solarBuildingModels || []).map((building) => ({
        id: building.id,
        targetLabel: building.targetLabel,
        providerBuildingName: building.providerBuildingName,
        imagery: building.imagery,
        postalCode: building.postalCode,
        roofSegmentCount: building.roofSegmentCount,
        maxArrayPanelsCount:
          building.solarPotential?.maxArrayPanelsCount ?? null,
        panelCapacityWatts:
          building.solarPotential?.panelCapacityWatts ?? null,
        panelHeightMeters:
          building.solarPotential?.panelHeightMeters ?? null,
        panelWidthMeters:
          building.solarPotential?.panelWidthMeters ?? null,
        maxSunshineHoursPerYear:
          building.solarPotential?.maxSunshineHoursPerYear ?? null,
      })),
    },

    comparison: {
      panelDeltaPercent,
      annualEnergyDeltaPercent,
      panelCountAccuracy: classifyPanelCountAccuracy(panelDeltaPercent),
      targetPanelCountWithin10Percent:
        panelDeltaPercent !== null && Math.abs(panelDeltaPercent) <= 10,
      targetAnnualEnergyWithin15Percent:
        annualEnergyDeltaPercent !== null &&
        Math.abs(annualEnergyDeltaPercent) <= 15,

      closestConfigPanelDeltaPercent: percentageDifference(
        googleClosestInstallerConfig?.panelsCount,
        installerPanelCount
      ),
      closestConfigAnnualEnergyDeltaPercent: percentageDifference(
        googleClosestInstallerConfig?.yearlyEnergyDcKwh,
        installerAnnualProductionKwh
      ),

      autoFilteredPanelDeltaPercent,
      autoFilteredEnergyDeltaPercent,
      autoFilteredPanelCountAccuracy: classifyPanelCountAccuracy(
        autoFilteredPanelDeltaPercent
      ),
      autoFilteredPanelCountWithin10Percent:
        autoFilteredPanelDeltaPercent !== null &&
        Math.abs(autoFilteredPanelDeltaPercent) <= 10,
      autoFilteredEnergyWithin15Percent:
        autoFilteredEnergyDeltaPercent !== null &&
        Math.abs(autoFilteredEnergyDeltaPercent) <= 15,
    },

    benchmarkNotes: item.benchmarkNotes || "",
    siteComplexity: item.siteComplexity || {},
  };
}

async function runBenchmark(items) {
  const results = [];

  for (const item of items) {
    console.log(`\nRunning benchmark: ${item.id} — ${item.label}`);

    const target = buildTargetFromBenchmark(item);

    if (target.latitude === null || target.longitude === null) {
      console.log("Skipped: missing target latitude/longitude.");

      results.push({
        id: item.id,
        label: item.label,
        skipped: true,
        reason: "Missing target latitude/longitude.",
      });

      continue;
    }

    console.log({
      latitude: target.latitude,
      longitude: target.longitude,
    });

    const analysis = await analyseSolarTargetBuildings([target], {
      requiredQuality: process.env.SOLAR_API_REQUIRED_QUALITY || "BASE",
      includeDetectedArrays: false,
      maxTargets: 1,
    });

    const summary = await summariseBenchmarkResult(item, analysis);

    results.push({
      benchmark: item,
      googleSolarAnalysis: analysis,
      summary,
    });

    console.log("Summary:");
    console.log(
      JSON.stringify(
        {
          installerPanelCount: summary.installerTruth.panelCount,
          googleMaxPanels: summary.googleSolarApi.maxPanels,
          panelDeltaPercent: summary.comparison.panelDeltaPercent,

          closestConfigPanels:
            summary.googleSolarApi.closestInstallerPanelCountConfig
              ?.panelsCount,
          closestConfigAnnualKwh:
            summary.googleSolarApi.closestInstallerPanelCountConfig
              ?.yearlyEnergyDcKwh,
          closestConfigEnergyDeltaPercent:
            summary.comparison.closestConfigAnnualEnergyDeltaPercent,

          autoFilteredPanels:
            summary.googleSolarApi.autoFilteredEstimate?.panelsCount,
          autoFilteredAnnualKwh:
            summary.googleSolarApi.autoFilteredEstimate?.annualEnergyKwh,
          autoFilteredPanelDeltaPercent:
            summary.comparison.autoFilteredPanelDeltaPercent,
          autoFilteredEnergyDeltaPercent:
            summary.comparison.autoFilteredEnergyDeltaPercent,
          autoFilteredConfidence:
            summary.googleSolarApi.autoFilteredEstimate?.confidence,
          autoFilteredConfidenceReasons:
            summary.googleSolarApi.autoFilteredEstimate?.confidenceReasons,
        },
        null,
        2
      )
    );
  }

  return results;
}

async function main() {
  const inputPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_INPUT_PATH;

  const benchmarks = readJsonFile(inputPath);

  if (!Array.isArray(benchmarks)) {
    throw new Error("Benchmark file must contain an array.");
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");

  console.log("Roof model benchmark runner");
  console.log({
    inputPath,
    benchmarkCount: benchmarks.length,
    hasApiKey: Boolean(process.env.GOOGLE_SOLAR_API_KEY),
    requiredQuality: process.env.SOLAR_API_REQUIRED_QUALITY || "BASE",
  });

  const results = await runBenchmark(benchmarks);

  const summaryRows = results.map((result) => result.summary || result);

  const output = {
    runId,
    createdAt: new Date().toISOString(),
    inputPath,
    summaryRows,
    results,
  };

  const outputPath = path.join(
    RESULTS_DIR,
    `roof-model-benchmark-${runId}.json`
  );

  writeJsonFile(outputPath, output);

  console.log(`\nBenchmark complete.`);
  console.log(`Full results saved to: ${outputPath}`);

  console.log("\nCompact summary:");
  console.log(
    JSON.stringify(
      summaryRows.map((row) => ({
        id: row.id,
        label: row.label,

        installerPanels: row.installerTruth?.panelCount,
        installerAnnualKwh: row.installerTruth?.annualProductionKwh,

        googlePanels: row.googleSolarApi?.maxPanels,
        googleAnnualKwh: row.googleSolarApi?.annualEnergyKwh,
        googlePanelDeltaPercent: row.comparison?.panelDeltaPercent,
        googleEnergyDeltaPercent: row.comparison?.annualEnergyDeltaPercent,

        closestConfigPanels:
          row.googleSolarApi?.closestInstallerPanelCountConfig?.panelsCount,
        closestConfigAnnualKwh:
          row.googleSolarApi?.closestInstallerPanelCountConfig
            ?.yearlyEnergyDcKwh,
        closestConfigPanelDeltaPercent:
          row.comparison?.closestConfigPanelDeltaPercent,
        closestConfigEnergyDeltaPercent:
          row.comparison?.closestConfigAnnualEnergyDeltaPercent,

        autoFilteredPanels:
          row.googleSolarApi?.autoFilteredEstimate?.panelsCount,
        autoFilteredAnnualKwh:
          row.googleSolarApi?.autoFilteredEstimate?.annualEnergyKwh,
        autoFilteredPanelDeltaPercent:
          row.comparison?.autoFilteredPanelDeltaPercent,
        autoFilteredEnergyDeltaPercent:
          row.comparison?.autoFilteredEnergyDeltaPercent,
        autoFilteredPanelAccuracy:
          row.comparison?.autoFilteredPanelCountAccuracy,
        autoFilteredConfidence:
          row.googleSolarApi?.autoFilteredEstimate?.confidence,
        autoFilteredConfidenceScore:
          row.googleSolarApi?.autoFilteredEstimate?.confidenceScore,
        autoFilteredConfidenceReasons:
          row.googleSolarApi?.autoFilteredEstimate?.confidenceReasons,

        panelAuditStatus:
          row.googleSolarApi?.panelAssumptionAudit?.status,

        googlePanelWatts:
          row.googleSolarApi?.panelAssumptionAudit?.firstBuilding?.googlePanel
            ?.wattage,
        googlePanelWidthM:
          row.googleSolarApi?.panelAssumptionAudit?.firstBuilding?.googlePanel
            ?.widthMeters,
        googlePanelHeightM:
          row.googleSolarApi?.panelAssumptionAudit?.firstBuilding?.googlePanel
            ?.heightMeters,
        googlePanelFootprintM2:
          row.googleSolarApi?.panelAssumptionAudit?.firstBuilding?.googlePanel
            ?.footprintM2,

        installerPanelModel:
          row.googleSolarApi?.panelAssumptionAudit?.firstBuilding
            ?.installerPanel?.model,
        installerPanelWatts:
          row.googleSolarApi?.panelAssumptionAudit?.firstBuilding
            ?.installerPanel?.wattage,
        installerPanelWidthM:
          row.googleSolarApi?.panelAssumptionAudit?.firstBuilding
            ?.installerPanel?.widthMeters,
        installerPanelHeightM:
          row.googleSolarApi?.panelAssumptionAudit?.firstBuilding
            ?.installerPanel?.heightMeters,
        installerPanelFootprintM2:
          row.googleSolarApi?.panelAssumptionAudit?.firstBuilding
            ?.installerPanel?.footprintM2,

        footprintAdjustedGoogleMaxPanels:
          row.googleSolarApi?.panelAssumptionAudit?.firstBuilding
            ?.footprintAdjustedInstallerEquivalentPanels,
        googleToInstallerFootprintRatio:
          row.googleSolarApi?.panelAssumptionAudit?.firstBuilding?.ratios
            ?.googleToInstallerFootprintRatio,
        panelAuditMissing:
          row.googleSolarApi?.panelAssumptionAudit?.firstBuilding?.missing,

        segmentAuditStatus:
          row.googleSolarApi?.segmentPanelAudit?.status,
        maxOnlySegmentIndexes:
          row.googleSolarApi?.segmentPanelAudit?.firstBuilding
            ?.maxOnlySegmentIndexes,
        closestInstallerSegmentIndexes:
          row.googleSolarApi?.segmentPanelAudit?.firstBuilding
            ?.closestInstallerSegmentIndexes,
        segmentRows:
          row.googleSolarApi?.segmentPanelAudit?.firstBuilding?.segmentRows,

        selectorStrategy:
          row.googleSolarApi?.segmentSelectorAudit?.firstBuilding?.strategy,
        selectorRecommendedSegmentIndexes:
          row.googleSolarApi?.segmentSelectorAudit?.firstBuilding
            ?.recommendedSegmentIndexes,
        selectorOptionalSegmentIndexes:
          row.googleSolarApi?.segmentSelectorAudit?.firstBuilding
            ?.optionalSegmentIndexes,
        selectorExcludedSegmentIndexes:
          row.googleSolarApi?.segmentSelectorAudit?.firstBuilding
            ?.excludedSegmentIndexes,
        selectorRecommendedPanels:
          row.googleSolarApi?.segmentSelectorAudit?.firstBuilding
            ?.recommendedConfig?.panelsCount,
        selectorRecommendedAnnualKwh:
          row.googleSolarApi?.segmentSelectorAudit?.firstBuilding
            ?.recommendedConfig?.yearlyEnergyDcKwh,
        selectorRecommendedConfigSource:
          row.googleSolarApi?.segmentSelectorAudit?.firstBuilding
            ?.recommendedConfig?.source,
        selectorScoredSegments:
          row.googleSolarApi?.segmentSelectorAudit?.firstBuilding
            ?.scoredSegments,

        practicalEstimateStatus:
          row.googleSolarApi?.practicalPanelEstimate?.status,
        practicalCapacityPanels:
          row.googleSolarApi?.practicalPanelEstimate?.capacity?.panels,
        practicalCapacityAnnualKwh:
          row.googleSolarApi?.practicalPanelEstimate?.capacity?.annualKwh,
        practicalPanelsLow:
          row.googleSolarApi?.practicalPanelEstimate?.practicalPanels?.low,
        practicalPanelsExpected:
          row.googleSolarApi?.practicalPanelEstimate?.practicalPanels
            ?.expected,
        practicalPanelsHigh:
          row.googleSolarApi?.practicalPanelEstimate?.practicalPanels?.high,
        practicalAnnualKwhLow:
          row.googleSolarApi?.practicalPanelEstimate?.practicalAnnualKwh?.low,
        practicalAnnualKwhExpected:
          row.googleSolarApi?.practicalPanelEstimate?.practicalAnnualKwh
            ?.expected,
        practicalAnnualKwhHigh:
          row.googleSolarApi?.practicalPanelEstimate?.practicalAnnualKwh?.high,
        practicalConfidence:
          row.googleSolarApi?.practicalPanelEstimate?.confidence?.level,
        practicalConfidenceScore:
          row.googleSolarApi?.practicalPanelEstimate?.confidence?.score,
        practicalEstimateReasons:
          row.googleSolarApi?.practicalPanelEstimate?.reasons,

        productionDiagnosticStatus:
          row.googleSolarApi?.productionDeltaDiagnostic?.status,
        installerSystemSizeKwp:
          row.googleSolarApi?.productionDeltaDiagnostic?.installerReference
            ?.systemSizeKwp,
        practicalSystemSizeKwpExpected:
          row.googleSolarApi?.productionDeltaDiagnostic?.practicalEstimate
            ?.systemSizeKwp?.expected,
        installerSpecificYieldKwhPerKwp:
          row.googleSolarApi?.productionDeltaDiagnostic?.installerReference
            ?.specificYieldKwhPerKwp,
        practicalSpecificYieldKwhPerKwpExpected:
          row.googleSolarApi?.productionDeltaDiagnostic?.practicalEstimate
            ?.specificYieldKwhPerKwp?.expected,
        expectedSystemSizeDeltaPercent:
          row.googleSolarApi?.productionDeltaDiagnostic?.deltas
            ?.expectedSystemSizeDeltaPercent,
        specificYieldDeltaPercent:
          row.googleSolarApi?.productionDeltaDiagnostic?.deltas
            ?.specificYieldDeltaPercent,
        productionModelDeltaFlag:
          row.googleSolarApi?.productionDeltaDiagnostic?.productionModelDelta
            ?.flag,
        productionModelDeltaSeverity:
          row.googleSolarApi?.productionDeltaDiagnostic?.productionModelDelta
            ?.severity,
        productionModelDeltaReason:
          row.googleSolarApi?.productionDeltaDiagnostic?.productionModelDelta
            ?.reason,

        targetPanelTruthInRange:
          row.googleSolarApi?.targetEvaluation?.checks?.panelTruthInRange,
        targetAnnualTruthInRange:
          row.googleSolarApi?.targetEvaluation?.checks?.annualTruthInRange,
        targetPanelExpectedWithin10Percent:
          row.googleSolarApi?.targetEvaluation?.checks
            ?.panelExpectedWithin10Percent,
        targetAnnualExpectedWithin15Percent:
          row.googleSolarApi?.targetEvaluation?.checks
            ?.annualExpectedWithin15Percent,
        targetOverallPass:
          row.googleSolarApi?.targetEvaluation?.checks?.overallTargetPass,
        targetWarnings:
          row.googleSolarApi?.targetEvaluation?.warnings,

        hybridPvgisStatus:
          row.googleSolarApi?.hybridPvgisProductionBenchmark?.status,
        hybridPvgisPanels:
          row.googleSolarApi?.hybridPvgisProductionBenchmark
            ?.allocatedPanelTotal,
        hybridPvgisSystemSizeKwp:
          row.googleSolarApi?.hybridPvgisProductionBenchmark?.systemSizeKwp,
        hybridPvgisAnnualKwh:
          row.googleSolarApi?.hybridPvgisProductionBenchmark?.pvgis
            ?.annualKwh,
        hybridPvgisAnnualDeltaPercent:
          row.googleSolarApi?.hybridPvgisProductionBenchmark?.deltas
            ?.annualDeltaPercent,
        hybridPvgisMonthlyKwh:
          row.googleSolarApi?.hybridPvgisProductionBenchmark?.pvgis
            ?.monthlyKwh,
        hybridPvgisInstallerMonthlyKwh:
          row.googleSolarApi?.hybridPvgisProductionBenchmark
            ?.installerReference?.monthlyKwh,
        hybridPvgisMonthlyDeltaPercent:
          row.googleSolarApi?.hybridPvgisProductionBenchmark?.deltas
            ?.monthlyDeltaPercent,
        hybridPvgisSegmentInputs:
          row.googleSolarApi?.hybridPvgisProductionBenchmark?.segmentInputs,

        googleShadeDataLayersStatus:
          row.googleSolarApi?.googleShadeDataLayersAudit?.status,
        googleShadeImageryQuality:
          row.googleSolarApi?.googleShadeDataLayersAudit?.dataLayers
            ?.imageryQuality,
        googleShadeHasMonthlyFlux:
          row.googleSolarApi?.googleShadeDataLayersAudit?.dataLayers
            ?.hasMonthlyFluxUrl,
        googleShadeHourlyShadeUrlCount:
          row.googleSolarApi?.googleShadeDataLayersAudit?.dataLayers
            ?.hourlyShadeUrlCount,
        googleShadeHasHourlyShade:
          row.googleSolarApi?.googleShadeDataLayersAudit?.dataLayers
            ?.hasHourlyShadeUrls,
        googleShadeRequestRadiusMeters:
          row.googleSolarApi?.googleShadeDataLayersAudit?.request
            ?.radiusMeters,
        googleShadeAuditError:
          row.googleSolarApi?.googleShadeDataLayersAudit?.error,

        googleHourlyShadeStatus:
          row.googleSolarApi?.googleHourlyShadeFactorAudit?.status,
        googleHourlyShadeImageryQuality:
          row.googleSolarApi?.googleHourlyShadeFactorAudit?.imageryQuality,
        googleHourlyShadePanelSampleCount:
          row.googleSolarApi?.googleHourlyShadeFactorAudit
            ?.selectedPanelSampleCount,
        googleHourlyShadeRequestLocation:
          row.googleSolarApi?.googleHourlyShadeFactorAudit?.requestLocation,
        googleHourlyShadeSamplesBySegment:
          row.googleSolarApi?.googleHourlyShadeFactorAudit
            ?.selectedPanelSamplesBySegment,
        googleMonthlyAverageShadeFactor:
          row.googleSolarApi?.googleHourlyShadeFactorAudit
            ?.monthlyAverageShadeFactor,
        googleMonthlyValidPointSampleCounts:
          row.googleSolarApi?.googleHourlyShadeFactorAudit
            ?.monthlyValidPointSampleCounts,
        googleSegmentMonthlyAverageShadeFactor:
          row.googleSolarApi?.googleHourlyShadeFactorAudit
            ?.segmentMonthlyAverageShadeFactor,
        googleSegmentMonthlyValidPointSampleCounts:
          row.googleSolarApi?.googleHourlyShadeFactorAudit
            ?.segmentMonthlyValidPointSampleCounts,
        googleHourlyShadeDebugSamples:
          row.googleSolarApi?.googleHourlyShadeFactorAudit?.debugSamples,
        googleHourlyShadeAuditError:
          row.googleSolarApi?.googleHourlyShadeFactorAudit?.error,

        segmentShadeAdjustedPvgisStatus:
          row.googleSolarApi?.segmentShadeAdjustedPvgisProductionBenchmark
            ?.status,
        segmentShadeAdjustedPvgisUnshadedAnnualKwh:
          row.googleSolarApi?.segmentShadeAdjustedPvgisProductionBenchmark
            ?.pvgisUnshaded?.annualKwh,
        segmentShadeAdjustedPvgisAnnualKwh:
          row.googleSolarApi?.segmentShadeAdjustedPvgisProductionBenchmark
            ?.pvgisSegmentShadeAdjusted?.annualKwh,
        segmentShadeAdjustedPvgisAnnualDeltaPercent:
          row.googleSolarApi?.segmentShadeAdjustedPvgisProductionBenchmark
            ?.deltas?.segmentShadeAdjustedAnnualDeltaPercent,
        segmentShadeAdjustedPvgisShadeLossKwh:
          row.googleSolarApi?.segmentShadeAdjustedPvgisProductionBenchmark
            ?.shadeImpact?.annualShadeLossKwh,
        segmentShadeAdjustedPvgisShadeLossPercent:
          row.googleSolarApi?.segmentShadeAdjustedPvgisProductionBenchmark
            ?.shadeImpact?.annualShadeLossPercent,
        segmentShadeAdjustedPvgisMonthlyKwh:
          row.googleSolarApi?.segmentShadeAdjustedPvgisProductionBenchmark
            ?.pvgisSegmentShadeAdjusted?.monthlyKwh,
        segmentShadeAdjustedPvgisMonthlyDeltaPercent:
          row.googleSolarApi?.segmentShadeAdjustedPvgisProductionBenchmark
            ?.deltas?.segmentShadeAdjustedMonthlyDeltaPercent,
        segmentShadeAdjustedPvgisError:
          row.googleSolarApi?.segmentShadeAdjustedPvgisProductionBenchmark
            ?.error,
      })),
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("\nRoof benchmark failed.");
  console.error(error);
  process.exit(1);
});
