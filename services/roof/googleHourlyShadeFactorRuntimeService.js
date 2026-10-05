const {
  getApiKey,
  fetchDataLayers,
  fetchGeoTiff,

  chooseSamplePanelPositions,
  getPanelCentroid,

  readShadeFractionsForPoints,
  averageHourlyFractions,
  summariseMonthlyShadeFactors,
  summariseSegmentMonthlyShadeFactors,
} = require("./googleHourlyShadeFactorCoreService");

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function normaliseFallbackLocation(
  fallbackLocation
) {
  const lat =
    numberOrNull(
      fallbackLocation?.lat ??
      fallbackLocation?.latitude
    );

  const lon =
    numberOrNull(
      fallbackLocation?.lon ??
      fallbackLocation?.lng ??
      fallbackLocation?.longitude
    );

  if (
    lat === null ||
    lon === null
  ) {
    return null;
  }

  return {
    lat,
    lon,
  };
}

function resolveShadeRequestLocation({
  samplePanels,
  fallbackLocation,
}) {
  const selectedPanelCentroid =
    getPanelCentroid(
      samplePanels
    );

  if (selectedPanelCentroid) {
    return {
      source:
        "selected_panel_centroid",

      lat:
        selectedPanelCentroid.lat,

      lon:
        selectedPanelCentroid.lon,
    };
  }

  const fallback =
    normaliseFallbackLocation(
      fallbackLocation
    );

  if (!fallback) {
    return null;
  }

  return {
    source:
      "explicit_live_roof_fallback",

    lat:
      fallback.lat,

    lon:
      fallback.lon,
  };
}

async function processGeoTiffMonthsInBatches({
  hourlyShadeUrls,
  apiKey,
  fetchImage = fetchGeoTiff,
  processImage,
}) {
  const batchSize = 3;
  let downloadDurationMs = 0;
  let processingDurationMs = 0;

  try {
    for (
      let batchStart = 0;
      batchStart < hourlyShadeUrls.length;
      batchStart += batchSize
    ) {
      const monthIndexes = [];

      for (
        let monthIndex = batchStart;
        monthIndex < Math.min(batchStart + batchSize, hourlyShadeUrls.length);
        monthIndex += 1
      ) {
        monthIndexes.push(monthIndex);
      }

      const downloadStartedAt = Date.now();
      let images;

      try {
        images = await Promise.all(
          monthIndexes.map((monthIndex) =>
            fetchImage(hourlyShadeUrls[monthIndex], apiKey)
          )
        );
      } finally {
        downloadDurationMs += Date.now() - downloadStartedAt;
      }

      const processingStartedAt = Date.now();

      try {
        for (let index = 0; index < monthIndexes.length; index += 1) {
          await processImage({
            image: images[index],
            monthIndex: monthIndexes[index],
          });
        }
      } finally {
        processingDurationMs += Date.now() - processingStartedAt;
      }
    }
  } finally {
    console.log(`[PERF] Shade V2 GeoTIFF downloads: ${downloadDurationMs}ms`);
    console.log(`[PERF] Shade V2 raster sampling: ${processingDurationMs}ms`);
  }
}

async function buildGoogleHourlyShadeFactorsRuntime({
  googlePanelPositions,
  segmentInputs,
  fallbackLocation,
  apiKey: explicitApiKey = null,
}) {
  const source =
    "zeyzer_google_hourly_shade_factor_runtime_v1";

  const apiKey =
    explicitApiKey ||
    getApiKey();

  if (!apiKey) {
    return {
      source,
      mode: "shadow",
      status: "missing_api_key",
      canonicalProduction: false,
      error:
        "Missing Google Solar API key.",
    };
  }

  const cleanGooglePanelPositions =
    Array.isArray(
      googlePanelPositions
    )
      ? googlePanelPositions
      : [];

  const cleanSegmentInputs =
    Array.isArray(segmentInputs)
      ? segmentInputs
      : [];

  const samplePanels =
    chooseSamplePanelPositions({
      googlePanelPositions:
        cleanGooglePanelPositions,

      segmentInputs:
        cleanSegmentInputs,
    });

  if (!samplePanels.length) {
    return {
      source,
      mode: "shadow",
      status:
        "missing_panel_positions",
      canonicalProduction: false,

      panelPositionCount:
        cleanGooglePanelPositions.length,

      segmentInputs:
        cleanSegmentInputs,

      error:
        "Could not find selected Google panel positions with lat/lon and segmentIndex.",
    };
  }

  const requestLocation =
    resolveShadeRequestLocation({
      samplePanels,
      fallbackLocation,
    });

  if (!requestLocation) {
    return {
      source,
      mode: "shadow",
      status:
        "missing_request_location",
      canonicalProduction: false,

      selectedPanelSampleCount:
        samplePanels.length,

      error:
        "Could not resolve a Google Data Layers request location.",
    };
  }

  const runtimeStartedAt = Date.now();

  try {
    const dataLayersStartedAt = Date.now();
    let dataLayers;

    try {
      dataLayers = await fetchDataLayers({
        lat:
          requestLocation.lat,

        lon:
          requestLocation.lon,

        apiKey,
      });
    } finally {
      console.log(
        `[PERF] Shade V2 Google Data Layers: ${Date.now() - dataLayersStartedAt}ms`
      );
    }

    const hourlyShadeUrls =
      Array.isArray(
        dataLayers.hourlyShadeUrls
      )
        ? dataLayers.hourlyShadeUrls
        : [];

    if (
      hourlyShadeUrls.length !== 12
    ) {
      return {
        source,
        mode: "shadow",
        status:
          "missing_hourly_shade_urls",
        canonicalProduction: false,

        requestLocation,

        hourlyShadeUrlCount:
          hourlyShadeUrls.length,

        error:
          "Expected 12 hourly shade URLs.",
      };
    }

    const monthlyByHourShadeFactor =
      [];

    const monthlyValidPointSampleCounts =
      [];

    const segmentMonthlyByHourShadeFactor =
      {};

    const segmentMonthlyValidPointSampleCounts =
      {};

    const selectedSegmentKeys = [
      ...new Set(
        samplePanels.map(
          (panel) =>
            String(
              panel.segmentIndex
            )
        )
      ),
    ];

    for (
      const segmentKey
      of selectedSegmentKeys
    ) {
      segmentMonthlyByHourShadeFactor[
        segmentKey
      ] = [];

      segmentMonthlyValidPointSampleCounts[
        segmentKey
      ] = [];
    }

    const debugSamples = [];

    const geoTiffStageStartedAt = Date.now();

    try {
      await processGeoTiffMonthsInBatches({
        hourlyShadeUrls,
        apiKey,
        processImage: async ({ image, monthIndex }) => {

          const pointSamples =
            [];

          const pointSamplesBySegment =
            new Map();

          const results =
            await readShadeFractionsForPoints({
              image,
              points: samplePanels,
              monthIndex,
            });

          for (let panelIndex = 0; panelIndex < samplePanels.length; panelIndex += 1) {
            const panel = samplePanels[panelIndex];
            const result = results[panelIndex];

            if (
              result?.debug &&
              debugSamples.length < 5
            ) {
              debugSamples.push({
                monthIndex,

                segmentIndex:
                  panel.segmentIndex,

                ...result.debug,
              });
            }

            if (
              result?.fractions
            ) {
              pointSamples.push(
                result.fractions
              );

              const segmentKey =
                String(
                  panel.segmentIndex
                );

              if (
                !pointSamplesBySegment.has(
                  segmentKey
                )
              ) {
                pointSamplesBySegment.set(
                  segmentKey,
                  []
                );
              }

              pointSamplesBySegment
                .get(segmentKey)
                .push(
                  result.fractions
                );
            }
          }

          monthlyValidPointSampleCounts.push(
            pointSamples.length
          );

          monthlyByHourShadeFactor.push(
            averageHourlyFractions(
              pointSamples
            )
          );

          for (
            const segmentKey
            of selectedSegmentKeys
          ) {
            const segmentSamples =
              pointSamplesBySegment.get(
                segmentKey
              ) || [];

            segmentMonthlyValidPointSampleCounts[
              segmentKey
            ].push(
              segmentSamples.length
            );

            segmentMonthlyByHourShadeFactor[
              segmentKey
            ].push(
              averageHourlyFractions(
                segmentSamples
              )
            );
          }
        },
      });
    } finally {
      console.log(
        `[PERF] Shade V2 GeoTIFF stage: ${Date.now() - geoTiffStageStartedAt}ms`
      );
    }

    return {
      source,
      mode: "shadow",
      status: "complete",
      canonicalProduction: false,

      requestLocation,

      imageryQuality:
        dataLayers.imageryQuality ||
        null,

      selectedPanelSampleCount:
        samplePanels.length,

      selectedPanelSamplesBySegment:
        samplePanels.reduce(
          (acc, panel) => {
            const key =
              String(
                panel.segmentIndex
              );

            acc[key] =
              (acc[key] || 0) + 1;

            return acc;
          },
          {}
        ),

      monthlyValidPointSampleCounts,

      monthlyByHourShadeFactor,

      monthlyAverageShadeFactor:
        summariseMonthlyShadeFactors(
          monthlyByHourShadeFactor
        ),

      segmentMonthlyValidPointSampleCounts,

      segmentMonthlyByHourShadeFactor,

      segmentMonthlyAverageShadeFactor:
        summariseSegmentMonthlyShadeFactors(
          segmentMonthlyByHourShadeFactor
        ),

      debugSamples,

      note:
        "Production modelling should use segmentMonthlyByHourShadeFactor. Site-wide averages are diagnostic only.",
    };
  } catch (error) {
    return {
      source,
      mode: "shadow",
      status: "error",
      canonicalProduction: false,

      requestLocation,

      selectedPanelSampleCount:
        samplePanels.length,

      error:
        error?.message ||
        String(error),
    };
  } finally {
    console.log(
      `[PERF] Shade V2 Google shade total: ${Date.now() - runtimeStartedAt}ms`
    );
  }
}

module.exports = {
  normaliseFallbackLocation,
  resolveShadeRequestLocation,
  processGeoTiffMonthsInBatches,
  buildGoogleHourlyShadeFactorsRuntime,
};
