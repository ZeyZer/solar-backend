const GOOGLE_SOLAR_BUILDING_INSIGHTS_URL =
  "https://solar.googleapis.com/v1/buildingInsights:findClosest";

const VALID_IMAGERY_QUALITIES = new Set(["HIGH", "MEDIUM", "BASE"]);

function getGoogleSolarApiKey() {
  return (
    process.env.GOOGLE_SOLAR_API_KEY ||
    process.env.GOOGLE_MAPS_SOLAR_API_KEY ||
    ""
  );
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normaliseRequiredQuality(value) {
  const quality = String(value || process.env.SOLAR_API_REQUIRED_QUALITY || "BASE")
    .trim()
    .toUpperCase();

  return VALID_IMAGERY_QUALITIES.has(quality) ? quality : "BASE";
}

function parseLatLng({ latitude, longitude }) {
  const lat = numberOrNull(latitude);
  const lng = numberOrNull(longitude);

  if (lat === null || lng === null) {
    throw new Error("Latitude and longitude are required.");
  }

  if (lat < -90 || lat > 90) {
    throw new Error("Latitude must be between -90 and 90.");
  }

  if (lng < -180 || lng > 180) {
    throw new Error("Longitude must be between -180 and 180.");
  }

  return {
    latitude: lat,
    longitude: lng,
  };
}

async function fetchJson(url) {
  if (typeof fetch !== "function") {
    throw new Error(
      "Global fetch is not available. Use Node 18+ for this backend spike."
    );
  }

  const response = await fetch(url);

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const googleError = data?.error || data || {};
    const message =
      googleError?.message ||
      `Google Solar API request failed with status ${response.status}`;

    const error = new Error(message);
    error.googleStatus = response.status;
    error.googleError = googleError;
    throw error;
  }

  return data;
}

async function findClosestBuildingInsights({
  latitude,
  longitude,
  requiredQuality,
  includeDetectedArrays = false,
} = {}) {
  const apiKey = getGoogleSolarApiKey();

  if (!apiKey) {
    throw new Error("GOOGLE_SOLAR_API_KEY is missing.");
  }

  const location = parseLatLng({ latitude, longitude });
  const quality = normaliseRequiredQuality(requiredQuality);

  const params = new URLSearchParams();

  params.set("location.latitude", String(location.latitude));
  params.set("location.longitude", String(location.longitude));
  params.set("requiredQuality", quality);
  params.set("key", apiKey);

  if (includeDetectedArrays) {
    params.append("additionalInsights", "DETECTED_ARRAYS");
  }

  const url = `${GOOGLE_SOLAR_BUILDING_INSIGHTS_URL}?${params.toString()}`;

  return fetchJson(url);
}

module.exports = {
  findClosestBuildingInsights,
  normaliseRequiredQuality,
  parseLatLng,
};
