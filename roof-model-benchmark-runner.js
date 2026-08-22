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
    const configs = Array.isArray(building?.googlePanelConfigsSample)
      ? building.googlePanelConfigsSample
      : [];

    const maxConfig = configs.reduce((best, config) => {
      const panels = numberOrNull(config?.panelsCount) || 0;
      const bestPanels = numberOrNull(best?.panelsCount) || 0;

      return panels > bestPanels ? config : best;
    }, null);

    return (
      sum +
      (numberOrNull(maxConfig?.yearlyEnergyDcKwh) ||
        numberOrNull(building?.solarPotential?.maxArrayEnergyKwh) ||
        0)
    );
  }, 0);
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

function summariseBenchmarkResult(item, analysis) {
  const installerPanelCount = getInstallerPanelCount(item);
  const installerAnnualProductionKwh = getInstallerAnnualProduction(item);

  const googleMaxPanels = getGoogleMaxPanels(analysis);
  const googleAnnualEnergyKwh = getGoogleAnnualEnergyKwh(analysis);

  const panelDeltaPercent = percentageDifference(
    googleMaxPanels,
    installerPanelCount
  );

  const annualEnergyDeltaPercent = percentageDifference(
    googleAnnualEnergyKwh,
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

    const summary = summariseBenchmarkResult(item, analysis);

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
          panelCountAccuracy: summary.comparison.panelCountAccuracy,
          installerAnnualProductionKwh:
            summary.installerTruth.annualProductionKwh,
          googleAnnualEnergyKwh: summary.googleSolarApi.annualEnergyKwh,
          annualEnergyDeltaPercent:
            summary.comparison.annualEnergyDeltaPercent,
          imagery: summary.googleSolarApi.buildings?.[0]?.imagery,
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
        googlePanels: row.googleSolarApi?.maxPanels,
        panelDeltaPercent: row.comparison?.panelDeltaPercent,
        panelAccuracy: row.comparison?.panelCountAccuracy,
        installerAnnualKwh: row.installerTruth?.annualProductionKwh,
        googleAnnualKwh: row.googleSolarApi?.annualEnergyKwh,
        energyDeltaPercent: row.comparison?.annualEnergyDeltaPercent,
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
