// R1.7b.0
// Checks whether Google Solar Data Layers are available for benchmark properties.
// This does not download or decode GeoTIFFs yet.

const {
  getLatLonFromUkPostcode,
} = require("../integrations/pvgisService");

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

function getSolarApiKey() {
  return (
    process.env.GOOGLE_SOLAR_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.REACT_APP_GOOGLE_MAPS_API_KEY ||
    null
  );
}

function buildDataLayersUrl({
  lat,
  lon,
  radiusMeters = 50,
  view = "FULL_LAYERS",
  requiredQuality = "BASE",
  pixelSizeMeters = 1,
  apiKey,
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

function summariseDataLayers(data = {}) {
  const hourlyShadeUrls = Array.isArray(data.hourlyShadeUrls)
    ? data.hourlyShadeUrls
    : [];

  return {
    imageryQuality: data.imageryQuality || null,
    imageryDate: data.imageryDate || null,
    imageryProcessedDate: data.imageryProcessedDate || null,

    hasDsmUrl: Boolean(data.dsmUrl),
    hasRgbUrl: Boolean(data.rgbUrl),
    hasMaskUrl: Boolean(data.maskUrl),
    hasAnnualFluxUrl: Boolean(data.annualFluxUrl),
    hasMonthlyFluxUrl: Boolean(data.monthlyFluxUrl),

    hourlyShadeUrlCount: hourlyShadeUrls.length,
    hasHourlyShadeUrls: hourlyShadeUrls.length === 12,

    // Do not persist temporary GeoTIFF URLs in benchmark output.
    // They are short-lived and not useful in committed diagnostics.
    storesRawUrls: false,
  };
}

async function buildGoogleShadeDataLayersAudit({
  benchmarkItem,
  radiusMeters = 50,
  view = "FULL_LAYERS",
  requiredQuality = process.env.SOLAR_API_REQUIRED_QUALITY || "BASE",
  pixelSizeMeters = 1,
}) {
  const apiKey = getSolarApiKey();

  if (!apiKey) {
    return {
      source: "zeyzer_google_shade_data_layers_audit_v1",
      status: "missing_api_key",
      error:
        "Missing GOOGLE_SOLAR_API_KEY / GOOGLE_MAPS_API_KEY. Cannot call Google Solar Data Layers.",
    };
  }

  const postcode = getBenchmarkPostcode(benchmarkItem);

  if (!postcode) {
    return {
      source: "zeyzer_google_shade_data_layers_audit_v1",
      status: "missing_postcode",
      error: "Benchmark item is missing postcode.",
    };
  }

  try {
    const { lat, lon } = await getLatLonFromUkPostcode(postcode);

    const url = buildDataLayersUrl({
      lat,
      lon,
      radiusMeters,
      view,
      requiredQuality,
      pixelSizeMeters,
      apiKey,
    });

    const response = await fetchFn(url);

    if (!response.ok) {
      const text = await response.text().catch(() => "");

      return {
        source: "zeyzer_google_shade_data_layers_audit_v1",
        status: "request_failed",
        postcode,
        request: {
          lat,
          lon,
          radiusMeters,
          view,
          requiredQuality,
          pixelSizeMeters,
        },
        httpStatus: response.status,
        error: text.slice(0, 500),
      };
    }

    const data = await response.json();
    const summary = summariseDataLayers(data);

    return {
      source: "zeyzer_google_shade_data_layers_audit_v1",
      status: "complete",
      postcode,
      request: {
        lat,
        lon,
        radiusMeters,
        view,
        requiredQuality,
        pixelSizeMeters,
      },
      dataLayers: summary,
      nextStep:
        summary.hasMonthlyFluxUrl || summary.hasHourlyShadeUrls
          ? "Decode GeoTIFF data into monthly/hourly shade factors."
          : "No usable shade/flux layers returned for this benchmark location.",
    };
  } catch (error) {
    return {
      source: "zeyzer_google_shade_data_layers_audit_v1",
      status: "error",
      postcode,
      error: error?.message || String(error),
    };
  }
}

module.exports = {
  buildGoogleShadeDataLayersAudit,
};
