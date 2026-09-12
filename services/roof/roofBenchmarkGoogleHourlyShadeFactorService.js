// R1.7b.1
// Benchmark wrapper around the shared Google hourly shade-factor core.

const {
  getLatLonFromUkPostcode,
} = require("../integrations/pvgisService");

const {
  getApiKey,
  fetchDataLayers,
  fetchGeoTiff,

  chooseSamplePanelPositions,
  getPanelCentroid,

  readShadeFractionsForPoint,
  averageHourlyFractions,
  summariseMonthlyShadeFactors,
  summariseSegmentMonthlyShadeFactors,
} = require("./googleHourlyShadeFactorCoreService");

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

  const googlePanelPositions =
    getGooglePanelPositions(
      analysis
    );

  const segmentInputs =
    getSegmentInputs(
      hybridPvgisProductionBenchmark
    );

  const samplePanels =
    chooseSamplePanelPositions({
      googlePanelPositions,
      segmentInputs,
    });

  if (!samplePanels.length) {
    return {
      source: "zeyzer_google_hourly_shade_factor_audit_v1",
      status: "missing_panel_positions",
      postcode,
      panelPositionCount: googlePanelPositions.length,
      segmentInputs,
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
