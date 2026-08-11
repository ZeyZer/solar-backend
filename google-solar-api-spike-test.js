try {
  require("dotenv").config();
} catch {
  // dotenv is optional for this script.
}

const fs = require("fs");
const path = require("path");

const {
  findClosestBuildingInsights,
} = require("./services/roof/googleSolarApiService");

const {
  normaliseGoogleSolarBuildingInsights,
} = require("./services/roof/solarBuildingModelNormalisationService");

function usage() {
  console.log(`
Usage:
  node google-solar-api-spike-test.js <latitude> <longitude> "<label>"

Example:
  node google-solar-api-spike-test.js 51.2362 -0.5704 "Guildford test"
`);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function main() {
  const latitude = numberOrNull(process.argv[2]);
  const longitude = numberOrNull(process.argv[3]);
  const label = process.argv[4] || "Google Solar API spike target";

  if (latitude === null || longitude === null) {
    usage();
    process.exit(1);
  }

  console.log("Testing Google Solar API Building Insights...");
  console.log({
    latitude,
    longitude,
    label,
    requiredQuality: process.env.SOLAR_API_REQUIRED_QUALITY || "BASE",
    hasApiKey: Boolean(process.env.GOOGLE_SOLAR_API_KEY),
  });

  const providerResponse = await findClosestBuildingInsights({
    latitude,
    longitude,
    requiredQuality: process.env.SOLAR_API_REQUIRED_QUALITY || "BASE",
  });

  const normalised = normaliseGoogleSolarBuildingInsights(providerResponse, {
    target: {
      id: "spike-target-1",
      label,
      latitude,
      longitude,
    },
  });

  console.log("\nSimplified roof model summary:");
  console.log(
    JSON.stringify(
      {
        found: true,
        providerBuildingName: normalised.providerBuildingName,
        imagery: normalised.imagery,
        postalCode: normalised.postalCode,
        regionCode: normalised.regionCode,
        roofSegmentCount: normalised.roofSegmentCount,
        solarPotential: normalised.solarPotential,
        roofSegments: normalised.roofSegments,
        googlePanelPositionsCount: normalised.googlePanelPositionsCount,
        googlePanelConfigsCount: normalised.googlePanelConfigsCount,
        warnings: normalised.warnings,
      },
      null,
      2
    )
  );

  const outputDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(
    outputDir,
    `google-solar-spike-${Date.now()}.json`
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        providerResponse,
        normalised,
      },
      null,
      2
    )
  );

  console.log(`\nFull diagnostic saved to: ${outputPath}`);
}

main().catch((error) => {
  console.error("\nGoogle Solar API spike failed.");

  console.error({
    message: error?.message,
    googleStatus: error?.googleStatus,
    googleError: error?.googleError,
  });

  process.exit(1);
});
