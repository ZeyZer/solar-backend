require("dotenv").config();

const fs = require("fs");

const {
  analyseSolarTargetBuildings,
} = require(
  "../services/roof/solarTargetBuildingService"
);

const {
  buildHybridPvgisProductionBenchmark,
} = require(
  "../services/roof/roofBenchmarkHybridPvgisProductionService"
);

const {
  buildGoogleHourlyShadeFactorAudit,
} = require(
  "../services/roof/roofBenchmarkGoogleHourlyShadeFactorService"
);

const {
  buildSegmentShadeAdjustedPvgisProductionBenchmark,
} = require(
  "../services/roof/roofBenchmarkSegmentShadeAdjustedPvgisProductionService"
);

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

function round1(value) {
  const number = numberOrNull(value);

  return number === null
    ? null
    : Math.round(number * 10) / 10;
}

function round2(value) {
  const number = numberOrNull(value);

  return number === null
    ? null
    : Math.round(number * 100) / 100;
}

function percentDelta(estimate, reference) {
  const e = numberOrNull(estimate);
  const r = numberOrNull(reference);

  if (
    e === null ||
    r === null ||
    r === 0
  ) {
    return null;
  }

  return round1(
    ((e - r) / r) * 100
  );
}

function circularDistanceDegrees(a, b) {
  const aa = numberOrNull(a);
  const bb = numberOrNull(b);

  if (aa === null || bb === null) {
    return null;
  }

  const diff =
    Math.abs(aa - bb) % 360;

  return Math.min(
    diff,
    360 - diff
  );
}

function googleAzimuthToPvgisAspect(
  googleAzimuthDegrees
) {
  const azimuth =
    numberOrNull(googleAzimuthDegrees);

  if (azimuth === null) {
    return 0;
  }

  let aspect = azimuth - 180;

  while (aspect > 180) {
    aspect -= 360;
  }

  while (aspect < -180) {
    aspect += 360;
  }

  return round1(aspect);
}

function getInstallerMonthlyKwh(item = {}) {
  const value =
    item.installerDesignTruth
      ?.monthlyProductionKwh;

  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.length === 12
      ? value.map(numberOrNull)
      : null;
  }

  const keys = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];

  const out = keys.map(
    (key) => numberOrNull(value[key])
  );

  return out.every(
    (entry) => entry !== null
  )
    ? out
    : null;
}

function getCandidateSegments(model = {}) {
  const groups = [
    model.recommendedSegments,
    model.optionalSegments,
    model.notRecommendedSegments,
  ];

  const unique = new Map();

  for (const group of groups) {
    if (!Array.isArray(group)) {
      continue;
    }

    for (const segment of group) {
      const segmentIndex =
        numberOrNull(
          segment?.segmentIndex
        );

      if (segmentIndex === null) {
        continue;
      }

      if (!unique.has(segmentIndex)) {
        unique.set(
          segmentIndex,
          segment
        );
      }
    }
  }

  return Array.from(
    unique.values()
  );
}

function buildReferenceSegmentInputs({
  item,
  model,
}) {
  const roofSpaces =
    item.installerDesignTruth
      ?.roofSpacesUsed;

  const panelWattage =
    numberOrNull(
      item.installerDesignTruth
        ?.panelWattage
    );

  if (
    !Array.isArray(roofSpaces) ||
    !roofSpaces.length
  ) {
    throw new Error(
      "Installer reference has no roofSpacesUsed."
    );
  }

  if (!panelWattage) {
    throw new Error(
      "Installer reference has no panelWattage."
    );
  }

  const candidates =
    getCandidateSegments(model);

  if (!candidates.length) {
    throw new Error(
      "No Google/Zeyzer roof segments available for reference mapping."
    );
  }

  const usedSegmentIndexes =
    new Set();

  return roofSpaces.map(
    (referenceRoof) => {
      const referenceAzimuth =
        numberOrNull(
          referenceRoof
            .azimuthDegreesFromProposal
        );

      const referencePitch =
        numberOrNull(
          referenceRoof.pitchDegrees
        );

      const referencePanels =
        numberOrNull(
          referenceRoof.panelCount
        );

      if (
        referenceAzimuth === null ||
        referencePanels === null ||
        referencePanels <= 0
      ) {
        throw new Error(
          `Invalid installer roof group: ${
            referenceRoof.label ||
            "unnamed"
          }`
        );
      }

      const unusedCandidates =
        candidates.filter((segment) => {
          const index =
            numberOrNull(
              segment.segmentIndex
            );

          return (
            index !== null &&
            !usedSegmentIndexes.has(
              index
            )
          );
        });

      const capacityCompatibleCandidates =
        unusedCandidates.filter(
          (segment) => {
            const capacityPanels =
              numberOrNull(
                segment.maxPanels ??
                segment.googleMaxConfigPanels
              ) || 0;

            return (
              capacityPanels >=
              referencePanels
            );
          }
        );

      // Prefer a roof segment that can physically represent
      // the installer reference panel group. Only fall back
      // to an undersized segment when no compatible segment
      // exists at all.
      const rankingPool =
        capacityCompatibleCandidates.length
          ? capacityCompatibleCandidates
          : unusedCandidates;

      const ranked =
        rankingPool
          .map((segment) => {
            const azimuthDelta =
              circularDistanceDegrees(
                referenceAzimuth,
                segment.azimuthDegrees
              );

            const pitchDelta =
              referencePitch === null
                ? 0
                : Math.abs(
                    referencePitch -
                    Number(
                      segment.pitchDegrees ||
                      0
                    )
                  );

            const availableCapacityPanels =
              numberOrNull(
                segment.maxPanels ??
                segment.googleMaxConfigPanels
              ) || 0;

            const capacityShortfallPanels =
              Math.max(
                0,
                referencePanels -
                  availableCapacityPanels
              );

            return {
              segment,
              azimuthDelta,
              pitchDelta,
              availableCapacityPanels,
              capacityShortfallPanels,

              matchScore:
                Number(
                  azimuthDelta || 0
                ) +
                Number(
                  pitchDelta || 0
                ) * 0.5,
            };
          })
          .sort(
            (a, b) =>
              a.matchScore -
              b.matchScore
          );

      const best = ranked[0];

      if (!best) {
        throw new Error(
          `Could not match installer roof group: ${
            referenceRoof.label ||
            "unnamed"
          }`
        );
      }

      const segment = best.segment;

      usedSegmentIndexes.add(
        Number(segment.segmentIndex)
      );

      const peakPowerKwp =
        (
          referencePanels *
          panelWattage
        ) / 1000;

      return {
        segmentIndex:
          Number(
            segment.segmentIndex
          ),

        allocatedPanels:
          referencePanels,

        capacityPanels:
          numberOrNull(
            segment.maxPanels ??
            segment.googleMaxConfigPanels
          ),

        capacityAnnualKwh:
          numberOrNull(
            segment.maxConfigAnnualKwh
          ),

        tiltDeg:
          referencePitch ??
          numberOrNull(
            segment.pitchDegrees
          ),

        googleAzimuthDegrees:
          referenceAzimuth,

        pvgisAspectDeg:
          googleAzimuthToPvgisAspect(
            referenceAzimuth
          ),

        panelWattage,

        peakPowerKwp:
          Math.round(
            peakPowerKwp * 1000
          ) / 1000,

        orientationClass:
          segment.orientationClass ||
          null,

        sunshineClass:
          segment.sunshineClass ||
          null,

        referenceMapping: {
          referenceLabel:
            referenceRoof.label ||
            null,

          referenceAzimuthDegrees:
            referenceAzimuth,

          googleSegmentAzimuthDegrees:
            numberOrNull(
              segment.azimuthDegrees
            ),

          azimuthDeltaDegrees:
            round1(
              best.azimuthDelta
            ),

          referencePitchDegrees:
            referencePitch,

          googleSegmentPitchDegrees:
            numberOrNull(
              segment.pitchDegrees
            ),

          pitchDeltaDegrees:
            round1(
              best.pitchDelta
            ),

          matchScore:
            round1(
              best.matchScore
            ),

          googleSegmentCapacityPanels:
            best.availableCapacityPanels,

          capacityShortfallPanels:
            best.capacityShortfallPanels,
        },
      };
    }
  );
}

function monthlyWapePercent(
  estimate,
  reference
) {
  if (
    !Array.isArray(estimate) ||
    !Array.isArray(reference) ||
    estimate.length !== 12 ||
    reference.length !== 12
  ) {
    return null;
  }

  let absoluteError = 0;
  let referenceTotal = 0;

  for (let i = 0; i < 12; i++) {
    const e =
      Number(estimate[i] || 0);

    const r =
      Number(reference[i] || 0);

    absoluteError +=
      Math.abs(e - r);

    referenceTotal += r;
  }

  if (!referenceTotal) {
    return null;
  }

  return round1(
    (
      absoluteError /
      referenceTotal
    ) * 100
  );
}

function monthlyShareMaePercentagePoints(
  estimate,
  reference
) {
  if (
    !Array.isArray(estimate) ||
    !Array.isArray(reference) ||
    estimate.length !== 12 ||
    reference.length !== 12
  ) {
    return null;
  }

  const estimateTotal =
    estimate.reduce(
      (sum, value) =>
        sum +
        Number(value || 0),
      0
    );

  const referenceTotal =
    reference.reduce(
      (sum, value) =>
        sum +
        Number(value || 0),
      0
    );

  if (
    !estimateTotal ||
    !referenceTotal
  ) {
    return null;
  }

  let totalDifference = 0;

  for (let i = 0; i < 12; i++) {
    const estimateShare =
      (
        Number(
          estimate[i] || 0
        ) /
        estimateTotal
      ) * 100;

    const referenceShare =
      (
        Number(
          reference[i] || 0
        ) /
        referenceTotal
      ) * 100;

    totalDifference +=
      Math.abs(
        estimateShare -
        referenceShare
      );
  }

  return round2(
    totalDifference / 12
  );
}

async function main() {
  const benchmarkId =
    process.argv[2] ||
    "benchmark-001";

  const items = JSON.parse(
    fs.readFileSync(
      "data/roof-benchmark/benchmark-properties.local.json",
      "utf8"
    )
  );

  const item = items.find(
    (entry) =>
      entry.id === benchmarkId
  );

  if (!item) {
    throw new Error(
      `Benchmark not found: ${benchmarkId}`
    );
  }

  console.log(
    `\nRunning fixed-reference production benchmark: ${item.id} — ${item.label}`
  );

  const latitude =
    numberOrNull(
      item.property?.latitude ??
      item.property
        ?.targetLatitude
    );

  const longitude =
    numberOrNull(
      item.property?.longitude ??
      item.property
        ?.targetLongitude
    );

  const propertyType =
    item.property?.propertyType ||
    item.property?.type ||
    "unknown";

  const propertyBoundary =
    item.roofModelInput
      ?.propertyBoundary ||
    null;

  const target = {
    id:
      `${item.id}-fixed-production-target`,

    label: item.label,

    source:
      "fixed_reference_production_benchmark",

    latitude,
    longitude,
    propertyType,
  };

  const analysis =
    await analyseSolarTargetBuildings(
      [target],
      {
        requiredQuality:
          process.env
            .SOLAR_API_REQUIRED_QUALITY ||
          "BASE",

        includeDetectedArrays:
          false,

        maxTargets: 1,

        propertyType,
        propertyBoundary,
      }
    );

  const building =
    analysis
      ?.solarBuildingModels?.[0];

  if (!building) {
    throw new Error(
      "No Google solar building model returned."
    );
  }

  const model =
    building.roofSelectionModel ||
    {};

  const segmentInputsOverride =
    buildReferenceSegmentInputs({
      item,
      model,
    });

  const hybrid =
    await buildHybridPvgisProductionBenchmark(
      {
        benchmarkItem: item,

        panelAssumptionAudit: {},
        segmentSelectorAudit: {},
        practicalPanelEstimate: {},

        segmentInputsOverride,
      }
    );

  const shadeAudit =
    await buildGoogleHourlyShadeFactorAudit(
      {
        benchmarkItem: item,
        analysis,

        hybridPvgisProductionBenchmark:
          hybrid,
      }
    );

  const shadeAdjusted =
    await buildSegmentShadeAdjustedPvgisProductionBenchmark(
      {
        benchmarkItem: item,

        hybridPvgisProductionBenchmark:
          hybrid,

        googleHourlyShadeFactorAudit:
          shadeAudit,
      }
    );

  const referenceMonthly =
    getInstallerMonthlyKwh(
      item
    );

  const referenceAnnual =
    numberOrNull(
      item.installerDesignTruth
        ?.annualProductionKwh
    );

  const directShadeMonthly =
    shadeAdjusted
      ?.pvgisSegmentShadeAdjusted
      ?.monthlyKwh ||
    null;

  const directShadeAnnual =
    numberOrNull(
      shadeAdjusted
        ?.pvgisSegmentShadeAdjusted
        ?.annualKwh
    );

  const adaptiveShadeMonthly =
    shadeAdjusted
      ?.pvgisAdaptiveShadeAdjusted
      ?.monthlyKwh ||
    null;

  const adaptiveShadeAnnual =
    numberOrNull(
      shadeAdjusted
        ?.pvgisAdaptiveShadeAdjusted
        ?.annualKwh
    );

  const output = {
    id: item.id,
    label: item.label,

    status: "complete",

    referenceDesign: {
      systemSizeKwp:
        numberOrNull(
          item.installerDesignTruth
            ?.systemSizeKwp
        ),

      panelCount:
        numberOrNull(
          item.installerDesignTruth
            ?.panelCount
        ),

      panelWattage:
        numberOrNull(
          item.installerDesignTruth
            ?.panelWattage
        ),

      annualProductionKwh:
        referenceAnnual,

      monthlyProductionKwh:
        referenceMonthly,
    },

    roofMapping:
      segmentInputsOverride.map(
        (segment) => ({
          segmentIndex:
            segment.segmentIndex,

          allocatedPanels:
            segment.allocatedPanels,

          peakPowerKwp:
            segment.peakPowerKwp,

          tiltDeg:
            segment.tiltDeg,

          googleAzimuthDegrees:
            segment.googleAzimuthDegrees,

          mapping:
            segment.referenceMapping,
        })
      ),

    fixedReferencePvgis: {
      status:
        hybrid.status,

      segmentInputMode:
        hybrid.segmentInputMode,

      systemSizeKwp:
        hybrid.systemSizeKwp,

      annualKwh:
        hybrid.pvgis
          ?.annualKwh ??
        null,

      annualDeltaPercent:
        hybrid.deltas
          ?.annualDeltaPercent ??
        null,

      monthlyKwh:
        hybrid.pvgis
          ?.monthlyKwh ??
        null,

      monthlyDeltaPercent:
        hybrid.deltas
          ?.monthlyDeltaPercent ??
        null,

      monthlyWapePercent:
        monthlyWapePercent(
          hybrid.pvgis
            ?.monthlyKwh,
          referenceMonthly
        ),

      monthlyShareMaePercentagePoints:
        monthlyShareMaePercentagePoints(
          hybrid.pvgis
            ?.monthlyKwh,
          referenceMonthly
        ),
    },

    googleHourlyShade: {
      status:
        shadeAudit.status,

      selectedPanelSampleCount:
        shadeAudit
          .selectedPanelSampleCount ??
        null,

      selectedPanelSamplesBySegment:
        shadeAudit
          .selectedPanelSamplesBySegment ??
        null,

      monthlyAverageShadeFactor:
        shadeAudit
          .monthlyAverageShadeFactor ??
        null,
    },

    googleShadeCalibrationDiagnostic: {
      directShadeLossPercent:
        numberOrNull(
          shadeAdjusted
            ?.directShadeLossPercent
        ),

      directAnnualShadeLossPercent:
        numberOrNull(
          shadeAdjusted
            ?.shadeImpact
            ?.directAnnualShadeLossPercent
        ),

      adaptiveAnnualShadeLossPercent:
        numberOrNull(
          shadeAdjusted
            ?.shadeImpact
            ?.adaptiveAnnualShadeLossPercent
        ),

      adaptivePolicy:
        shadeAdjusted
          ?.adaptivePolicy ??
        null,
    },

    fixedReferencePvgisPlusGoogleDirectShade: {
      status:
        shadeAdjusted.status,

      annualKwh:
        directShadeAnnual,

      annualDeltaPercent:
        percentDelta(
          directShadeAnnual,
          referenceAnnual
        ),

      monthlyKwh:
        directShadeMonthly,

      monthlyDeltaPercent:
        Array.isArray(
          directShadeMonthly
        ) &&
        Array.isArray(
          referenceMonthly
        )
          ? directShadeMonthly.map(
              (value, index) =>
                percentDelta(
                  value,
                  referenceMonthly[
                    index
                  ]
                )
            )
          : null,

      monthlyWapePercent:
        monthlyWapePercent(
          directShadeMonthly,
          referenceMonthly
        ),

      monthlyShareMaePercentagePoints:
        monthlyShareMaePercentagePoints(
          directShadeMonthly,
          referenceMonthly
        ),
    },

    fixedReferencePvgisPlusGoogleAdaptiveShade: {
      status:
        shadeAdjusted.status,

      annualKwh:
        adaptiveShadeAnnual,

      annualDeltaPercent:
        percentDelta(
          adaptiveShadeAnnual,
          referenceAnnual
        ),

      monthlyKwh:
        adaptiveShadeMonthly,

      monthlyDeltaPercent:
        Array.isArray(
          adaptiveShadeMonthly
        ) &&
        Array.isArray(
          referenceMonthly
        )
          ? adaptiveShadeMonthly.map(
              (value, index) =>
                percentDelta(
                  value,
                  referenceMonthly[
                    index
                  ]
                )
            )
          : null,

      monthlyWapePercent:
        monthlyWapePercent(
          adaptiveShadeMonthly,
          referenceMonthly
        ),

      monthlyShareMaePercentagePoints:
        monthlyShareMaePercentagePoints(
          adaptiveShadeMonthly,
          referenceMonthly
        ),

      adaptiveAnnualShadeLossPercent:
        numberOrNull(
          shadeAdjusted
            ?.shadeImpact
            ?.adaptiveAnnualShadeLossPercent
        ),

      adaptivePolicy:
        shadeAdjusted
          ?.adaptivePolicy ??
        null,
    },
  };

  console.log(
    "\nFIXED PRODUCTION DIAGNOSTIC"
  );

  console.log(
    JSON.stringify(
      output,
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    "\nFIXED PRODUCTION BENCHMARK FAILED"
  );

  console.error(error);

  process.exit(1);
});
