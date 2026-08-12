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

function usage() {
  console.log(`
Usage:
  node google-solar-api-multi-target-test.js <lat> <lng> "<label>" [<lat> <lng> "<label>"]

Example:
  node google-solar-api-multi-target-test.js 51.265010 -0.590874 "Main house" 51.265032 -0.590764 "Garage"
`);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseTargets(args) {
  if (!args.length || args.length % 3 !== 0) {
    return null;
  }

  const targets = [];

  for (let i = 0; i < args.length; i += 3) {
    const latitude = numberOrNull(args[i]);
    const longitude = numberOrNull(args[i + 1]);
    const label = args[i + 2];

    if (latitude === null || longitude === null || !label) {
      return null;
    }

    targets.push({
      id: `target-${targets.length + 1}`,
      label,
      source: "terminal_spike_test",
      latitude,
      longitude,
    });
  }

  return targets;
}

async function main() {
  const targets = parseTargets(process.argv.slice(2));

  if (!targets) {
    usage();
    process.exit(1);
  }

  console.log("Testing multi-target Google Solar API Building Insights...");
  console.log({
    targetCount: targets.length,
    requiredQuality: process.env.SOLAR_API_REQUIRED_QUALITY || "BASE",
    hasApiKey: Boolean(process.env.GOOGLE_SOLAR_API_KEY),
  });

  const result = await analyseSolarTargetBuildings(targets, {
    requiredQuality: process.env.SOLAR_API_REQUIRED_QUALITY || "BASE",
  });

  console.log("\nMulti-target summary:");
  console.log(
    JSON.stringify(
      {
        success: result.success,
        summary: result.summary,
        warnings: result.warnings,
        targetResults: result.targetResults.map((item) => ({
          success: item.success,
          found: item.found,
          duplicate: item.duplicate,
          duplicateOfBuildingId: item.duplicateOfBuildingId,
          buildingModelId: item.buildingModelId,
          target: item.target,
          error: item.error,
          warnings: item.warnings,
          providerError: item.providerError,
        })),
        solarBuildingModels: result.solarBuildingModels.map((model) => ({
          id: model.id,
          targetId: model.targetId,
          targetLabel: model.targetLabel,
          providerBuildingName: model.providerBuildingName,
          imagery: model.imagery,
          postalCode: model.postalCode,
          regionCode: model.regionCode,
          roofSegmentCount: model.roofSegmentCount,
          maxArrayPanelsCount: model.solarPotential?.maxArrayPanelsCount,
          panelCapacityWatts: model.solarPotential?.panelCapacityWatts,
          googlePanelPositionsCount: model.googlePanelPositionsCount,
          googlePanelConfigsCount: model.googlePanelConfigsCount,
        })),
      },
      null,
      2
    )
  );

  const outputDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(
    outputDir,
    `google-solar-multi-target-spike-${Date.now()}.json`
  );

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log(`\nFull diagnostic saved to: ${outputPath}`);
}

main().catch((error) => {
  console.error("\nGoogle Solar API multi-target spike failed.");

  console.error({
    message: error?.message,
    stack: error?.stack,
  });

  process.exit(1);
});
