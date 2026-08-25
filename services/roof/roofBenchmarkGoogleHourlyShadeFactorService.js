// R1.7b.1
// Downloads Google Solar hourly shade GeoTIFFs and samples selected panel positions.
// Output is a monthly/hour-of-day shade factor matrix: 12 months × 24 hours.

const {
  getLatLonFromUkPostcode,
} = require("../integrations/pvgisService");

const proj4 = require("proj4");

// British National Grid. Useful for UK GeoTIFFs if Google returns EPSG:27700.
proj4.defs(
  "EPSG:27700",
  "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 " +
    "+x_0=400000 +y_0=-100000 +ellps=airy " +
    "+towgs84=446.448,-125.157,542.06,0.1502,0.247,0.8421,-20.4894 " +
    "+units=m +no_defs"
);

let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round3(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 1000) / 1000;
}

function getApiKey() {
  return (
    process.env.GOOGLE_SOLAR_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.REACT_APP_GOOGLE_MAPS_API_KEY ||
    null
  );
}

function getBenchmarkPostcode(benchmarkItem = {}) {
  return (
    benchmarkItem.postcode ||
    benchmarkItem.postCode ||

    benchmarkItem.property?.postcode ||
    benchmarkItem.property?.postCode ||

    benchmarkItem.address?.postcode ||
    benchmarkItem.address?.postCode ||

    benchmarkItem.input?.postcode ||
    benchmarkItem.input?.postCode ||

    benchmarkItem.customerInput?.postcode ||
    benchmarkItem.customerInput?.postCode ||

    null
  );
}

function buildDataLayersUrl({
  lat,
  lon,
  apiKey,
  radiusMeters = 100,
  view = "FULL_LAYERS",
  requiredQuality = process.env.SOLAR_API_REQUIRED_QUALITY || "BASE",
  pixelSizeMeters = 1,
}) {
  const params = new URLSearchParams({
    "location.latitude": String(lat),
    "location.longitude": String(lon),
    radiusMeters: String(radiusMeters),
    view,
    requiredQuality,
    pixelSizeMeters: String(pixelSizeMeters),
    key: apiKey,
  });

  return `https://solar.googleapis.com/v1/dataLayers:get?${params.toString()}`;
}

function addApiKeyToGeoTiffUrl(url, apiKey) {
  const separator = String(url).includes("?") ? "&" : "?";
  return `${url}${separator}key=${encodeURIComponent(apiKey)}`;
}

async function fetchDataLayers({ lat, lon, apiKey }) {
  const url = buildDataLayersUrl({ lat, lon, apiKey });
  const response = await fetchFn(url);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google Data Layers failed (${response.status}): ${text.slice(0, 250)}`);
  }

  return response.json();
}

async function fetchGeoTiff(url, apiKey) {
  const { fromArrayBuffer } = await import("geotiff");

  const response = await fetchFn(addApiKeyToGeoTiffUrl(url, apiKey));

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GeoTIFF download failed (${response.status}): ${text.slice(0, 250)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const tiff = await fromArrayBuffer(arrayBuffer);
  return tiff.getImage();
}

function getPanelLatitude(panel = {}) {
  return numberOrNull(
    panel.latitude ??
    panel.lat ??
    panel.centerLatitude ??
    panel.centerLat ??
    panel.center?.latitude ??
    panel.center?.lat ??
    panel.latLng?.latitude ??
    panel.location?.latitude
  );
}

function getPanelLongitude(panel = {}) {
  return numberOrNull(
    panel.longitude ??
    panel.lon ??
    panel.lng ??
    panel.centerLongitude ??
    panel.centerLon ??
    panel.centerLng ??
    panel.center?.longitude ??
    panel.center?.lng ??
    panel.latLng?.longitude ??
    panel.latLng?.lng ??
    panel.location?.longitude
  );
}

function getPanelSegmentIndex(panel = {}) {
  return numberOrNull(
    panel.segmentIndex ??
    panel.roofSegmentIndex ??
    panel.sourceSegmentIndex ??
    panel.roofSegmentSummaryIndex
  );
}

function getPanelAnnualKwh(panel = {}) {
  return numberOrNull(
    panel.yearlyEnergyDcKwh ??
    panel.annualKwh ??
    panel.annualEnergyKwh ??
    panel.energyKwh
  );
}

function getGooglePanelPositions(analysis = {}) {
  const buildings = Array.isArray(analysis?.solarBuildingModels)
    ? analysis.solarBuildingModels
    : [];

  const firstBuilding = buildings[0] || {};

  if (Array.isArray(firstBuilding.googlePanelPositions)) {
    return firstBuilding.googlePanelPositions;
  }

  if (Array.isArray(firstBuilding.googlePanelPositionsSample)) {
    return firstBuilding.googlePanelPositionsSample;
  }

  if (Array.isArray(firstBuilding.solarPanels)) {
    return firstBuilding.solarPanels;
  }

  if (Array.isArray(firstBuilding.solarPotential?.solarPanels)) {
    return firstBuilding.solarPotential.solarPanels;
  }

  return [];
}

function getSegmentInputs(hybridPvgisProductionBenchmark = {}) {
  return Array.isArray(hybridPvgisProductionBenchmark.segmentInputs)
    ? hybridPvgisProductionBenchmark.segmentInputs
    : [];
}

function chooseSamplePanelPositions({ analysis, hybridPvgisProductionBenchmark }) {
  const allPanels = getGooglePanelPositions(analysis);
  const segmentInputs = getSegmentInputs(hybridPvgisProductionBenchmark);

  const selected = [];

  for (const segment of segmentInputs) {
    const segmentIndex = numberOrNull(segment.segmentIndex);
    const requiredCount = numberOrNull(segment.allocatedPanels) || 0;

    if (segmentIndex === null || requiredCount <= 0) {
      continue;
    }

    const candidates = allPanels
      .filter((panel) => getPanelSegmentIndex(panel) === segmentIndex)
      .map((panel) => ({
        panel,
        lat: getPanelLatitude(panel),
        lon: getPanelLongitude(panel),
        segmentIndex,
        annualKwh: getPanelAnnualKwh(panel),
      }))
      .filter((row) => row.lat !== null && row.lon !== null)
      .sort((a, b) => Number(b.annualKwh || 0) - Number(a.annualKwh || 0));

    selected.push(...candidates.slice(0, requiredCount));
  }

  return selected;
}

function getPanelCentroid(samplePanels = []) {
  const valid = samplePanels.filter(
    (panel) => numberOrNull(panel.lat) !== null && numberOrNull(panel.lon) !== null
  );

  if (!valid.length) {
    return null;
  }

  return {
    lat:
      valid.reduce((sum, panel) => sum + Number(panel.lat), 0) /
      valid.length,
    lon:
      valid.reduce((sum, panel) => sum + Number(panel.lon), 0) /
      valid.length,
  };
}

function getImageProjectionInfo(image) {
  const geoKeys = image.getGeoKeys ? image.getGeoKeys() : {};
  const bbox = image.getBoundingBox();

  return {
    bbox,
    width: image.getWidth(),
    height: image.getHeight(),
    geoKeys,
    projectedCrsCode: numberOrNull(geoKeys.ProjectedCSTypeGeoKey),
    geographicCrsCode: numberOrNull(geoKeys.GeographicTypeGeoKey),
    modelType: numberOrNull(geoKeys.GTModelTypeGeoKey),
  };
}

function isLonLatBBox(bbox = []) {
  const [minX, minY, maxX, maxY] = bbox.map(Number);

  return (
    Number.isFinite(minX) &&
    Number.isFinite(minY) &&
    Number.isFinite(maxX) &&
    Number.isFinite(maxY) &&
    minX >= -180 &&
    maxX <= 180 &&
    minY >= -90 &&
    maxY <= 90
  );
}

function getProj4DefinitionForProjectedCode(projectedCode) {
  const code = numberOrNull(projectedCode);

  if (code === null) {
    return null;
  }

  if (code === 27700) {
    return "EPSG:27700";
  }

  if (code === 3857) {
    return "EPSG:3857";
  }

  if (code >= 32601 && code <= 32660) {
    const zone = code - 32600;
    const key = `EPSG:${code}`;
    proj4.defs(
      key,
      `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`
    );
    return key;
  }

  if (code >= 32701 && code <= 32760) {
    const zone = code - 32700;
    const key = `EPSG:${code}`;
    proj4.defs(
      key,
      `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`
    );
    return key;
  }

  return null;
}

function coordinateInsideBbox({ xCoord, yCoord, bbox }) {
  const [minX, minY, maxX, maxY] = bbox.map(Number);

  return (
    Number.isFinite(xCoord) &&
    Number.isFinite(yCoord) &&
    xCoord >= minX &&
    xCoord <= maxX &&
    yCoord >= minY &&
    yCoord <= maxY
  );
}

function getImageCoordinatesForLatLon({ image, lat, lon }) {
  const info = getImageProjectionInfo(image);
  const bbox = info.bbox;

  if (isLonLatBBox(bbox)) {
    return {
      xCoord: lon,
      yCoord: lat,
      strategy: "native_lon_lat_bbox",
      projectionInfo: info,
    };
  }

  const projectionDef = getProj4DefinitionForProjectedCode(
    info.projectedCrsCode
  );

  if (projectionDef) {
    const [xCoord, yCoord] = proj4("EPSG:4326", projectionDef, [lon, lat]);

    return {
      xCoord,
      yCoord,
      strategy: `projected_${projectionDef}`,
      projectionInfo: info,
    };
  }

  return {
    xCoord: lon,
    yCoord: lat,
    strategy: "fallback_lon_lat_without_known_projection",
    projectionInfo: info,
  };
}

function pixelFromLatLon({ image, lat, lon }) {
  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox();

  const { xCoord, yCoord, strategy, projectionInfo } =
    getImageCoordinatesForLatLon({ image, lat, lon });

  const [minX, minY, maxX, maxY] = bbox;

  if (!coordinateInsideBbox({ xCoord, yCoord, bbox })) {
    return {
      pixel: null,
      debug: {
        reason: "coordinate_outside_bbox",
        strategy,
        lat,
        lon,
        xCoord,
        yCoord,
        bbox,
        projectionInfo: {
          projectedCrsCode: projectionInfo.projectedCrsCode,
          geographicCrsCode: projectionInfo.geographicCrsCode,
          modelType: projectionInfo.modelType,
          width: projectionInfo.width,
          height: projectionInfo.height,
        },
      },
    };
  }

  const x = Math.floor(((xCoord - minX) / (maxX - minX)) * width);
  const y = Math.floor(((maxY - yCoord) / (maxY - minY)) * height);

  if (x < 0 || x >= width || y < 0 || y >= height) {
    return {
      pixel: null,
      debug: {
        reason: "pixel_outside_image",
        strategy,
        lat,
        lon,
        xCoord,
        yCoord,
        x,
        y,
        bbox,
        width,
        height,
      },
    };
  }

  return {
    pixel: { x, y },
    debug: {
      strategy,
      lat,
      lon,
      xCoord,
      yCoord,
      x,
      y,
      bbox,
      projectionInfo: {
        projectedCrsCode: projectionInfo.projectedCrsCode,
        geographicCrsCode: projectionInfo.geographicCrsCode,
        modelType: projectionInfo.modelType,
        width: projectionInfo.width,
        height: projectionInfo.height,
      },
    },
  };
}

function daysInMonthIndex(monthIndex) {
  // Non-leap year convention is fine for shade-factor averaging.
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthIndex] || 30;
}

async function readShadeFractionsForPoint({ image, lat, lon, monthIndex }) {
  const pixelResult = pixelFromLatLon({ image, lat, lon });

  if (!pixelResult.pixel) {
    return {
      fractions: null,
      debug: pixelResult.debug,
    };
  }

  const { x, y } = pixelResult.pixel;
  const days = daysInMonthIndex(monthIndex);

  const rasters = await image.readRasters({
    window: [x, y, x + 1, y + 1],
  });

  const hourlyFractions = Array(24).fill(null);

  for (let hour = 0; hour < 24; hour += 1) {
    const raw = Number(rasters?.[hour]?.[0]);

    // Google stores invalid locations as -9999.
    if (!Number.isFinite(raw) || raw < 0) {
      hourlyFractions[hour] = null;
      continue;
    }

    let sunnyDays = 0;

    for (let day = 1; day <= days; day += 1) {
      const bit = 1 << (day - 1);
      if ((raw & bit) !== 0) {
        sunnyDays += 1;
      }
    }

    hourlyFractions[hour] = sunnyDays / days;
  }

  const validHourCount = hourlyFractions.filter((value) => value !== null).length;

  return {
    fractions: validHourCount > 0 ? hourlyFractions : null,
    debug: {
      ...pixelResult.debug,
      validHourCount,
    },
  };
}

function averageHourlyFractions(samples = []) {
  if (!samples.length) {
    return Array(24).fill(null);
  }

  const out = Array(24).fill(0);
  const counts = Array(24).fill(0);

  for (const sample of samples) {
    for (let hour = 0; hour < 24; hour += 1) {
      const value = sample[hour];

      if (value === null || value === undefined) {
        continue;
      }

      out[hour] += Number(value || 0);
      counts[hour] += 1;
    }
  }

  return out.map((value, hour) =>
    counts[hour] > 0 ? round3(value / counts[hour]) : null
  );
}

function summariseMonthlyShadeFactors(monthlyByHour = []) {
  return monthlyByHour.map((hours) => {
    const valid = hours.filter((value) => value !== null);

    if (!valid.length) {
      return null;
    }

    return round3(
      valid.reduce((sum, value) => sum + Number(value || 0), 0) / valid.length
    );
  });
}

function summariseSegmentMonthlyShadeFactors(segmentMonthlyByHour = {}) {
  return Object.fromEntries(
    Object.entries(segmentMonthlyByHour).map(([segmentIndex, matrix]) => [
      segmentIndex,
      summariseMonthlyShadeFactors(matrix),
    ])
  );
}

async function buildGoogleHourlyShadeFactorAudit({
  benchmarkItem,
  analysis,
  hybridPvgisProductionBenchmark,
}) {
  const apiKey = getApiKey();

  if (!apiKey) {
    return {
      source: "zeyzer_google_hourly_shade_factor_audit_v1",
      status: "missing_api_key",
      error: "Missing Google Solar API key.",
    };
  }

  const postcode = getBenchmarkPostcode(benchmarkItem);

  if (!postcode) {
    return {
      source: "zeyzer_google_hourly_shade_factor_audit_v1",
      status: "missing_postcode",
      error: "Benchmark item is missing postcode.",
    };
  }

  const samplePanels = chooseSamplePanelPositions({
    analysis,
    hybridPvgisProductionBenchmark,
  });

  if (!samplePanels.length) {
    return {
      source: "zeyzer_google_hourly_shade_factor_audit_v1",
      status: "missing_panel_positions",
      postcode,
      panelPositionCount: getGooglePanelPositions(analysis).length,
      segmentInputs: getSegmentInputs(hybridPvgisProductionBenchmark),
      error:
        "Could not find selected Google panel positions with lat/lon and segmentIndex.",
    };
  }

  try {
    const postcodeLocation = await getLatLonFromUkPostcode(postcode);
    const selectedPanelCentroid = getPanelCentroid(samplePanels);

    const requestLocation = selectedPanelCentroid || postcodeLocation;

    const dataLayers = await fetchDataLayers({
      lat: requestLocation.lat,
      lon: requestLocation.lon,
      apiKey,
    });

    const hourlyShadeUrls = Array.isArray(dataLayers.hourlyShadeUrls)
      ? dataLayers.hourlyShadeUrls
      : [];

    if (hourlyShadeUrls.length !== 12) {
      return {
        source: "zeyzer_google_hourly_shade_factor_audit_v1",
        status: "missing_hourly_shade_urls",
        postcode,
        hourlyShadeUrlCount: hourlyShadeUrls.length,
        error: "Expected 12 hourly shade URLs.",
      };
    }

    const monthlyByHourShadeFactor = [];
    const monthlyValidPointSampleCounts = [];

    const segmentMonthlyByHourShadeFactor = {};
    const segmentMonthlyValidPointSampleCounts = {};

    const selectedSegmentKeys = [
      ...new Set(samplePanels.map((panel) => String(panel.segmentIndex))),
    ];

    for (const key of selectedSegmentKeys) {
      segmentMonthlyByHourShadeFactor[key] = [];
      segmentMonthlyValidPointSampleCounts[key] = [];
    }

    const debugSamples = [];

    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const image = await fetchGeoTiff(hourlyShadeUrls[monthIndex], apiKey);

      const pointSamples = [];
      const pointSamplesBySegment = new Map();

      for (const panel of samplePanels) {
        const result = await readShadeFractionsForPoint({
          image,
          lat: panel.lat,
          lon: panel.lon,
          monthIndex,
        });

        if (result?.debug && debugSamples.length < 5) {
          debugSamples.push({
            monthIndex,
            segmentIndex: panel.segmentIndex,
            ...result.debug,
          });
        }

        if (result?.fractions) {
          pointSamples.push(result.fractions);

          const segmentKey = String(panel.segmentIndex);
          if (!pointSamplesBySegment.has(segmentKey)) {
            pointSamplesBySegment.set(segmentKey, []);
          }

          pointSamplesBySegment.get(segmentKey).push(result.fractions);
        }
      }

      monthlyValidPointSampleCounts.push(pointSamples.length);
      monthlyByHourShadeFactor.push(averageHourlyFractions(pointSamples));

      for (const segmentKey of selectedSegmentKeys) {
        const segmentSamples = pointSamplesBySegment.get(segmentKey) || [];

        segmentMonthlyValidPointSampleCounts[segmentKey].push(
          segmentSamples.length
        );

        segmentMonthlyByHourShadeFactor[segmentKey].push(
          averageHourlyFractions(segmentSamples)
        );
      }
    }

    return {
      source: "zeyzer_google_hourly_shade_factor_audit_v1",
      status: "complete",
      postcode,
      requestLocation: {
        source: selectedPanelCentroid ? "selected_panel_centroid" : "postcode",
        lat: requestLocation.lat,
        lon: requestLocation.lon,
      },
      postcodeLocation,
      imageryQuality: dataLayers.imageryQuality || null,

      selectedPanelSampleCount: samplePanels.length,
      selectedPanelSamplesBySegment: samplePanels.reduce((acc, panel) => {
        const key = String(panel.segmentIndex);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),

      // Site-wide diagnostic only.
      monthlyValidPointSampleCounts,
      monthlyByHourShadeFactor,
      monthlyAverageShadeFactor: summariseMonthlyShadeFactors(
        monthlyByHourShadeFactor
      ),

      // Production model should use this segment-level matrix.
      segmentMonthlyValidPointSampleCounts,
      segmentMonthlyByHourShadeFactor,
      segmentMonthlyAverageShadeFactor: summariseSegmentMonthlyShadeFactors(
        segmentMonthlyByHourShadeFactor
      ),

      debugSamples,

      note:
        "Shade factors are sun-exposure fractions sampled at selected Google panel positions. Production modelling should use segmentMonthlyByHourShadeFactor, not the site-wide monthly average.",
    };
  } catch (error) {
    return {
      source: "zeyzer_google_hourly_shade_factor_audit_v1",
      status: "error",
      postcode,
      selectedPanelSampleCount: samplePanels.length,
      error: error?.message || String(error),
    };
  }
}

module.exports = {
  buildGoogleHourlyShadeFactorAudit,
};
