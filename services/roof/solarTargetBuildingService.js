const {
  findClosestBuildingInsights,
} = require("./googleSolarApiService");

const {
  normaliseGoogleSolarBuildingInsights,
} = require("./solarBuildingModelNormalisationService");

const {
  buildRoofSelectionModelFromBuildingModel,
} = require("./roofSelectionModelService");

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, decimals = 6) {
  const number = numberOrNull(value);

  if (number === null) {
    return null;
  }

  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function getMaxTargets(value) {
  const requested = Number(value);
  const envValue = Number(process.env.SOLAR_API_MAX_TARGET_BUILDINGS || 5);

  const max = Number.isFinite(requested) && requested > 0
    ? requested
    : envValue;

  if (!Number.isFinite(max) || max <= 0) {
    return 5;
  }

  return Math.min(Math.floor(max), 10);
}

function normaliseSolarTargetBuilding(target = {}, index = 0) {
  const latitude =
    target.latitude ??
    target.lat ??
    target.location?.latitude ??
    target.location?.lat;

  const longitude =
    target.longitude ??
    target.lng ??
    target.location?.longitude ??
    target.location?.lng;

  return {
    id: target.id || target.targetId || `target-${index + 1}`,
    label: target.label || `Solar target ${index + 1}`,
    source: target.source || "manual_or_selected_target",
    latitude: numberOrNull(latitude),
    longitude: numberOrNull(longitude),
    propertyType:
      target.propertyType ||
      target.property?.propertyType ||
      target.context?.propertyType ||
      null,
  };
}

function validateTarget(target) {
  const issues = [];

  if (target.latitude === null || target.longitude === null) {
    issues.push("Latitude and longitude are required.");
  }

  if (target.latitude !== null && (target.latitude < -90 || target.latitude > 90)) {
    issues.push("Latitude must be between -90 and 90.");
  }

  if (target.longitude !== null && (target.longitude < -180 || target.longitude > 180)) {
    issues.push("Longitude must be between -180 and 180.");
  }

  return issues;
}

function getGoogleErrorCode(error) {
  return (
    error?.googleError?.status ||
    error?.googleError?.code ||
    error?.googleError?.error?.status ||
    null
  );
}

function isNotFoundError(error) {
  const googleStatus = error?.googleStatus || null;
  const googleErrorCode = getGoogleErrorCode(error);
  const message = error?.message || "";

  return (
    googleStatus === 404 ||
    googleErrorCode === "NOT_FOUND" ||
    /not found/i.test(message)
  );
}

function getDuplicateKey(buildingModel) {
  if (buildingModel?.providerBuildingName) {
    return `provider:${buildingModel.providerBuildingName}`;
  }

  const lat = round(buildingModel?.center?.latitude, 6);
  const lng = round(buildingModel?.center?.longitude, 6);

  if (lat !== null && lng !== null) {
    return `center:${lat},${lng}`;
  }

  return null;
}

function findDuplicateBuilding(existingModels, nextModel) {
  const nextKey = getDuplicateKey(nextModel);

  if (!nextKey) {
    return null;
  }

  return existingModels.find((model) => getDuplicateKey(model) === nextKey) || null;
}

async function analyseSingleTarget(target, options = {}) {
  const issues = validateTarget(target);

  if (issues.length > 0) {
    return {
      success: false,
      found: false,
      duplicate: false,
      target,
      errors: issues,
    };
  }

  try {
    const providerResponse = await findClosestBuildingInsights({
      latitude: target.latitude,
      longitude: target.longitude,
      requiredQuality: options.requiredQuality,
      includeDetectedArrays: Boolean(options.includeDetectedArrays),
    });

    const buildingModel = normaliseGoogleSolarBuildingInsights(providerResponse, {
      id: options.nextBuildingId,
      target,
    });

    buildingModel.roofSelectionModel = buildRoofSelectionModelFromBuildingModel(
      buildingModel,
      {
        propertyType: target.propertyType,
      }
    );

    return {
      success: true,
      found: true,
      duplicate: false,
      target,
      buildingModel,
    };
  } catch (error) {
    const googleStatus = error?.googleStatus || null;
    const googleErrorCode = getGoogleErrorCode(error);
    const message = error?.message || "Google Solar API request failed.";

    if (isNotFoundError(error)) {
      return {
        success: true,
        found: false,
        duplicate: false,
        target,
        warnings: [
          "Google Solar API did not find a known building close enough to this point.",
          "Try clicking closer to the centre of the building or use manual roof drawing fallback.",
        ],
        providerError: {
          status: googleStatus,
          code: googleErrorCode,
          message,
        },
      };
    }

    return {
      success: false,
      found: false,
      duplicate: false,
      target,
      error: message,
      providerError: {
        status: googleStatus,
        code: googleErrorCode,
        message,
      },
    };
  }
}

async function analyseSolarTargetBuildings(targets = [], options = {}) {
  const maxTargets = getMaxTargets(options.maxTargets);
  const inputTargets = Array.isArray(targets) ? targets : [];

  const acceptedTargets = inputTargets
    .slice(0, maxTargets)
    .map(normaliseSolarTargetBuilding);

  const truncatedTargets = Math.max(inputTargets.length - acceptedTargets.length, 0);

  const solarBuildingModels = [];
  const targetResults = [];
  const warnings = [];

  if (truncatedTargets > 0) {
    warnings.push(
      `Only the first ${maxTargets} target buildings were analysed. ${truncatedTargets} target(s) were ignored.`
    );
  }

  for (const target of acceptedTargets) {
    const nextBuildingId = `solar-building-${solarBuildingModels.length + 1}`;

    const result = await analyseSingleTarget(target, {
      ...options,
      nextBuildingId,
    });

    if (!result.found || !result.buildingModel) {
      targetResults.push(result);
      continue;
    }

    const duplicate = findDuplicateBuilding(
      solarBuildingModels,
      result.buildingModel
    );

    if (duplicate) {
      targetResults.push({
        ...result,
        duplicate: true,
        duplicateOfBuildingId: duplicate.id,
        buildingModel: undefined,
        buildingModelId: duplicate.id,
        warnings: [
          `This target appears to match the same Google building as ${duplicate.id}.`,
        ],
      });

      continue;
    }

    solarBuildingModels.push(result.buildingModel);

    targetResults.push({
      ...result,
      buildingModelId: result.buildingModel.id,
    });
  }

  const buildingsFound = targetResults.filter((item) => item.found).length;
  const duplicateBuildingsRemoved = targetResults.filter(
    (item) => item.duplicate
  ).length;
  const failedTargets = targetResults.filter((item) => item.success === false).length;
  const notFoundTargets = targetResults.filter(
    (item) => item.success === true && item.found === false
  ).length;

  return {
    success: failedTargets === 0,
    diagnosticOnly: true,

    solarBuildingModels,

    targetResults: targetResults.map((item) => ({
      ...item,
      buildingModel: item.duplicate ? undefined : item.buildingModel,
    })),

    summary: {
      requestedTargets: inputTargets.length,
      acceptedTargets: acceptedTargets.length,
      truncatedTargets,
      maxTargets,
      buildingsFound,
      uniqueBuildingsReturned: solarBuildingModels.length,
      duplicateBuildingsRemoved,
      notFoundTargets,
      failedTargets,
    },

    warnings,
  };
}

module.exports = {
  analyseSolarTargetBuildings,
  normaliseSolarTargetBuilding,
};
