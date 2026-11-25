const express = require("express");
const { measurePhase, sendRoofJson, startTargetTiming } = require("../services/roof/roofPerformance");

const {
  findClosestBuildingInsights,
} = require("../services/roof/googleSolarApiService");

const {
  normaliseGoogleSolarBuildingInsights,
} = require("../services/roof/solarBuildingModelNormalisationService");

const {
  analyseSolarTargetBuildings,
} = require("../services/roof/solarTargetBuildingService");

const {
  buildRoofSelectionModelFromBuildingModel,
} = require("../services/roof/roofSelectionModelService");

const router = express.Router();

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getRequestLocation(body = {}) {
  const latitude =
    body.latitude ??
    body.lat ??
    body.location?.latitude ??
    body.location?.lat;

  const longitude =
    body.longitude ??
    body.lng ??
    body.location?.longitude ??
    body.location?.lng;

  return {
    latitude: numberOrNull(latitude),
    longitude: numberOrNull(longitude),
  };
}

function makeTargetFromBody(body = {}) {
  const location = getRequestLocation(body);

  return {
    id: body.targetId || body.id || "target-1",
    label: body.label || "Solar target building",
    source: body.source || "single_building_insights_request",
    latitude: location.latitude,
    longitude: location.longitude,
    propertyType:
      body.propertyType ||
      body.property?.propertyType ||
      body.context?.propertyType ||
      null,
  };
}

function getGoogleErrorCode(error) {
  return (
    error?.googleError?.status ||
    error?.googleError?.code ||
    error?.googleError?.error?.status ||
    null
  );
}

router.post("/building-insights", async (req, res) => {
  const body = req.body || {};
  const target = makeTargetFromBody(body);

  if (target.latitude === null || target.longitude === null) {
    return sendRoofJson(res.status(400), {
      success: false,
      diagnosticOnly: true,
      error: "Latitude and longitude are required.",
    }, "invalid_input");
  }

  const timing = startTargetTiming(res.locals.roofPerformance);
  try {
    const providerResponse = await findClosestBuildingInsights({
      latitude: target.latitude,
      longitude: target.longitude,
      requiredQuality: body.requiredQuality,
      includeDetectedArrays: Boolean(body.includeDetectedArrays),
      timing,
    });

    const buildingModel = measurePhase(timing, "normaliseMs", () =>
      normaliseGoogleSolarBuildingInsights(providerResponse, { target })
    );

    buildingModel.roofSelectionModel = measurePhase(timing, "selectionMs", () =>
      buildRoofSelectionModelFromBuildingModel(buildingModel, {
        propertyType: target.propertyType,
      })
    );

    if (timing) {
      timing.outcome = "found";
    }
    return sendRoofJson(res, {
      success: true,
      diagnosticOnly: true,
      found: true,
      target,
      buildingModel,
    }, "found");
  } catch (error) {
    const googleStatus = error?.googleStatus || null;
    const googleErrorCode = getGoogleErrorCode(error);
    const message = error?.message || "Google Solar API request failed.";

    const notFound =
      googleStatus === 404 ||
      googleErrorCode === "NOT_FOUND" ||
      /not found/i.test(message);

    if (notFound) {
      if (timing) {
        timing.outcome = "not_found";
      }
      return sendRoofJson(res, {
        success: true,
        diagnosticOnly: true,
        found: false,
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
      }, "not_found");
    }

    if (timing) {
      timing.outcome = "failed";
    }
    return sendRoofJson(res.status(502), {
      success: false,
      diagnosticOnly: true,
      found: false,
      target,
      error: message,
      providerError: {
        status: googleStatus,
        code: googleErrorCode,
        message,
      },
    }, "failed");
  }
});

router.post("/building-insights/batch", async (req, res) => {
  const body = req.body || {};
  const targets = body.solarTargetBuildings || body.targets || [];

  if (!Array.isArray(targets) || targets.length === 0) {
    return sendRoofJson(res.status(400), {
      success: false,
      diagnosticOnly: true,
      error: "Provide at least one solar target building.",
      expectedBody: {
        solarTargetBuildings: [
          {
            id: "target-1",
            label: "Main house",
            latitude: 51.26501,
            longitude: -0.590874,
          },
        ],
      },
    }, "invalid_input");
  }

  try {
    const result = await analyseSolarTargetBuildings(targets, {
      requiredQuality: body.requiredQuality,
      includeDetectedArrays: Boolean(body.includeDetectedArrays),
      maxTargets: body.maxTargets,
      requestTiming: res.locals.roofPerformance,
      propertyType: body.propertyType || body?.roofGeometry?.propertyType || "unknown",
      propertyBoundary:
        body.propertyBoundary ||
        body?.roofGeometry?.propertyBoundary ||
        null,
    });

    return sendRoofJson(res, result, result.success ? "completed" : "target_failure");
  } catch (error) {
    return sendRoofJson(res.status(500), {
      success: false,
      diagnosticOnly: true,
      error: error?.message || "Batch Solar roof analysis failed.",
    }, "failed");
  }
});

module.exports = router;
