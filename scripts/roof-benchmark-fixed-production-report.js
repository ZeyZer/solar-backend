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

const {
  buildShadeStrengthV2Benchmark,
  blendProduction,
} = require(
  "../services/roof/roofBenchmarkShadeStrengthV2Service"
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
  const legacyRoofSpaces =
    item.installerDesignTruth
      ?.roofSpacesUsed;

  const newerRoofGroups =
    item.installerDesignTruth
      ?.roofGroups;

  const roofSpaces =
    Array.isArray(legacyRoofSpaces) &&
    legacyRoofSpaces.length
      ? legacyRoofSpaces
      : Array.isArray(newerRoofGroups)
      ? newerRoofGroups.map(
          (group, index) => ({
            ...group,

            label:
              group.label ||
              group.name ||
              `Roof group ${index + 1}`,

            panelCount:
              group.panelCount,

            azimuthDegreesFromProposal:
              group.azimuthDegreesFromProposal ??
              group.azimuthDeg,

            pitchDegrees:
              group.pitchDegrees ??
              group.tiltDeg,
          })
        )
      : [];

  const installerTruth =
    item.installerDesignTruth || {};

  const explicitPanelWattage =
    numberOrNull(
      installerTruth.panelWattage ??
      installerTruth.panel?.wattage
    );

  const referenceSystemSizeKwp =
    numberOrNull(
      installerTruth.systemSizeKwp
    );

  const referencePanelCountTotal =
    numberOrNull(
      installerTruth.panelCount
    );

  const derivedPanelWattage =
    referenceSystemSizeKwp &&
    referencePanelCountTotal
      ? (
          referenceSystemSizeKwp *
          1000
        ) /
        referencePanelCountTotal
      : null;

  const panelWattage =
    explicitPanelWattage ||
    derivedPanelWattage;

  if (!roofSpaces.length) {
    throw new Error(
      "Installer reference has no roofSpacesUsed or roofGroups."
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

  const REFERENCE_CLUSTER_AZIMUTH_TOLERANCE_DEG =
    10;

  const REFERENCE_CLUSTER_PITCH_TOLERANCE_DEG =
    8;

  const MAX_GOOGLE_AZIMUTH_DELTA_DEG =
    30;

  const MAX_GOOGLE_PITCH_DELTA_DEG =
    20;

  const referenceRoofs =
    roofSpaces.map(
      (referenceRoof, index) => {
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

        return {
          sourceIndex: index,

          label:
            referenceRoof.label ||
            `Roof group ${index + 1}`,

          referenceAzimuth,
          referencePitch,
          referencePanels,
        };
      }
    );

  const candidateRows =
    candidates
      .map((segment) => {
        const segmentIndex =
          numberOrNull(
            segment.segmentIndex
          );

        const azimuthDegrees =
          numberOrNull(
            segment.azimuthDegrees
          );

        const pitchDegrees =
          numberOrNull(
            segment.pitchDegrees
          );

        const capacityPanels =
          numberOrNull(
            segment.maxPanels ??
            segment.googleMaxConfigPanels
          ) || 0;

        if (
          segmentIndex === null ||
          azimuthDegrees === null ||
          capacityPanels <= 0
        ) {
          return null;
        }

        return {
          segment,
          segmentIndex,
          azimuthDegrees,
          pitchDegrees,
          capacityPanels,
        };
      })
      .filter(Boolean);

  if (!candidateRows.length) {
    throw new Error(
      "No Google roof segments with usable shade-sample panel capacity."
    );
  }

  function weightedCircularMeanDegrees(
    rows = []
  ) {
    let x = 0;
    let y = 0;

    for (const row of rows) {
      const radians =
        (
          Number(
            row.referenceAzimuth
          ) *
          Math.PI
        ) / 180;

      const weight =
        Number(
          row.referencePanels || 0
        );

      x +=
        Math.cos(radians) *
        weight;

      y +=
        Math.sin(radians) *
        weight;
    }

    let degrees =
      (
        Math.atan2(y, x) *
        180
      ) / Math.PI;

    if (degrees < 0) {
      degrees += 360;
    }

    return degrees;
  }

  function weightedPitchDegrees(
    rows = []
  ) {
    const valid =
      rows.filter(
        (row) =>
          row.referencePitch !== null
      );

    if (!valid.length) {
      return null;
    }

    const totalWeight =
      valid.reduce(
        (sum, row) =>
          sum +
          Number(
            row.referencePanels || 0
          ),
        0
      );

    if (!totalWeight) {
      return null;
    }

    return (
      valid.reduce(
        (sum, row) =>
          sum +
          Number(
            row.referencePitch
          ) *
          Number(
            row.referencePanels || 0
          ),
        0
      ) /
      totalWeight
    );
  }

  function getClusterGeometry(
    cluster
  ) {
    return {
      azimuthDegrees:
        weightedCircularMeanDegrees(
          cluster.referenceRoofs
        ),

      pitchDegrees:
        weightedPitchDegrees(
          cluster.referenceRoofs
        ),
    };
  }

  const referenceClusters = [];

  for (
    const referenceRoof
    of referenceRoofs
  ) {
    let bestCluster = null;

    for (
      const cluster
      of referenceClusters
    ) {
      const geometry =
        getClusterGeometry(
          cluster
        );

      const azimuthDelta =
        circularDistanceDegrees(
          referenceRoof.referenceAzimuth,
          geometry.azimuthDegrees
        );

      const pitchDelta =
        referenceRoof.referencePitch ===
          null ||
        geometry.pitchDegrees === null
          ? 0
          : Math.abs(
              referenceRoof.referencePitch -
              geometry.pitchDegrees
            );

      if (
        azimuthDelta >
          REFERENCE_CLUSTER_AZIMUTH_TOLERANCE_DEG ||
        pitchDelta >
          REFERENCE_CLUSTER_PITCH_TOLERANCE_DEG
      ) {
        continue;
      }

      const score =
        azimuthDelta +
        pitchDelta * 0.5;

      if (
        !bestCluster ||
        score <
          bestCluster.score
      ) {
        bestCluster = {
          cluster,
          score,
        };
      }
    }

    if (bestCluster) {
      bestCluster
        .cluster
        .referenceRoofs
        .push(
          referenceRoof
        );
    } else {
      referenceClusters.push({
        clusterIndex:
          referenceClusters.length,

        referenceRoofs: [
          referenceRoof,
        ],
      });
    }
  }

  const sampledPanelsBySegment =
    new Map();

  const segmentInputs = [];

  for (
    const cluster
    of referenceClusters
  ) {
    const clusterGeometry =
      getClusterGeometry(
        cluster
      );

    const clusterReferencePanels =
      cluster.referenceRoofs.reduce(
        (sum, roof) =>
          sum +
          Number(
            roof.referencePanels || 0
          ),
        0
      );

    const compatibleRows =
      candidateRows
        .map((row) => {
          const alreadySampled =
            sampledPanelsBySegment.get(
              row.segmentIndex
            ) || 0;

          const remainingCapacityPanels =
            Math.max(
              0,
              row.capacityPanels -
              alreadySampled
            );

          const azimuthDelta =
            circularDistanceDegrees(
              clusterGeometry
                .azimuthDegrees,
              row.azimuthDegrees
            );

          const pitchDelta =
            clusterGeometry
                .pitchDegrees ===
                null ||
            row.pitchDegrees === null
              ? 0
              : Math.abs(
                  clusterGeometry
                    .pitchDegrees -
                  row.pitchDegrees
                );

          return {
            ...row,

            alreadySampled,
            remainingCapacityPanels,
            azimuthDelta,
            pitchDelta,

            matchScore:
              Number(
                azimuthDelta || 0
              ) +
              Number(
                pitchDelta || 0
              ) *
              0.5,
          };
        })
        .filter(
          (row) =>
            row
              .remainingCapacityPanels >
              0 &&
            row.azimuthDelta <=
              MAX_GOOGLE_AZIMUTH_DELTA_DEG &&
            row.pitchDelta <=
              MAX_GOOGLE_PITCH_DELTA_DEG
        )
        .sort(
          (a, b) =>
            a.matchScore -
            b.matchScore
        );

    if (!compatibleRows.length) {
      const labels =
        cluster.referenceRoofs
          .map(
            (roof) =>
              roof.label
          )
          .join(", ");

      throw new Error(
        `No geometry-compatible Google segment for installer roof group(s): ${labels}`
      );
    }

    const selectedRows = [];

    let selectedCapacity = 0;

    for (
      const row
      of compatibleRows
    ) {
      selectedRows.push(
        row
      );

      selectedCapacity +=
        row.remainingCapacityPanels;

      if (
        selectedCapacity >=
        clusterReferencePanels
      ) {
        break;
      }
    }

    const shadeSampleTarget =
      Math.min(
        Math.round(
          clusterReferencePanels
        ),
        selectedCapacity
      );

    const totalSelectedCapacity =
      selectedRows.reduce(
        (sum, row) =>
          sum +
          row.remainingCapacityPanels,
        0
      );

    const provisionalAllocations =
      selectedRows.map(
        (row) => {
          const exactSamples =
            (
              shadeSampleTarget *
              row.remainingCapacityPanels
            ) /
            totalSelectedCapacity;

          const baseSamples =
            Math.min(
              row
                .remainingCapacityPanels,
              Math.floor(
                exactSamples
              )
            );

          return {
            ...row,

            exactSamples,

            shadeSamplePanels:
              baseSamples,

            remainder:
              exactSamples -
              baseSamples,
          };
        }
      );

    let allocatedSamplePanels =
      provisionalAllocations.reduce(
        (sum, row) =>
          sum +
          row.shadeSamplePanels,
        0
      );

    const byRemainder =
      [
        ...provisionalAllocations,
      ].sort(
        (a, b) =>
          b.remainder -
            a.remainder ||
          a.matchScore -
            b.matchScore
      );

    while (
      allocatedSamplePanels <
      shadeSampleTarget
    ) {
      let changed = false;

      for (
        const row
        of byRemainder
      ) {
        if (
          allocatedSamplePanels >=
          shadeSampleTarget
        ) {
          break;
        }

        if (
          row.shadeSamplePanels >=
          row
            .remainingCapacityPanels
        ) {
          continue;
        }

        row.shadeSamplePanels +=
          1;

        allocatedSamplePanels +=
          1;

        changed = true;
      }

      if (!changed) {
        break;
      }
    }

    const allocations =
      provisionalAllocations.filter(
        (row) =>
          row.shadeSamplePanels >
          0
      );

    const actualShadeSamplePanels =
      allocations.reduce(
        (sum, row) =>
          sum +
          row.shadeSamplePanels,
        0
      );

    if (!actualShadeSamplePanels) {
      throw new Error(
        "Geometry-compatible Google segments had no usable shade sample positions."
      );
    }

    for (
      const allocation
      of allocations
    ) {
      sampledPanelsBySegment.set(
        allocation.segmentIndex,
        (
          sampledPanelsBySegment.get(
            allocation.segmentIndex
          ) || 0
        ) +
        allocation
          .shadeSamplePanels
      );
    }

    const sampleCoverageRatio =
      actualShadeSamplePanels /
      clusterReferencePanels;

    for (
      let roofIndex = 0;
      roofIndex <
      cluster.referenceRoofs
        .length;
      roofIndex += 1
    ) {
      const referenceRoof =
        cluster.referenceRoofs[
          roofIndex
        ];

      for (
        const allocation
        of allocations
      ) {
        const sampleShare =
          allocation
            .shadeSamplePanels /
          actualShadeSamplePanels;

        const referenceEquivalentPanels =
          referenceRoof
            .referencePanels *
          sampleShare;

        const peakPowerKwp =
          (
            referenceEquivalentPanels *
            panelWattage
          ) /
          1000;

        segmentInputs.push({
          segmentIndex:
            allocation
              .segmentIndex,

          allocatedPanels:
            referenceEquivalentPanels,

          referenceEquivalentPanels,

          shadeSamplePanels:
            roofIndex === 0
              ? allocation
                  .shadeSamplePanels
              : 0,

          capacityPanels:
            allocation
              .capacityPanels,

          capacityAnnualKwh:
            numberOrNull(
              allocation
                .segment
                .maxConfigAnnualKwh
            ),

          tiltDeg:
            referenceRoof
              .referencePitch ??
            allocation
              .pitchDegrees,

          googleAzimuthDegrees:
            referenceRoof
              .referenceAzimuth,

          pvgisAspectDeg:
            googleAzimuthToPvgisAspect(
              referenceRoof
                .referenceAzimuth
            ),

          panelWattage,

          peakPowerKwp:
            Math.round(
              peakPowerKwp *
              1000000
            ) /
            1000000,

          orientationClass:
            allocation
              .segment
              .orientationClass ||
            null,

          sunshineClass:
            allocation
              .segment
              .sunshineClass ||
            null,

          referenceMapping: {
            referenceLabel:
              referenceRoof.label,

            referenceClusterIndex:
              cluster
                .clusterIndex,

            clusterReferencePanels:
              clusterReferencePanels,

            referenceEquivalentPanels:
              round2(
                referenceEquivalentPanels
              ),

            shadeSamplePanels:
              roofIndex === 0
                ? allocation
                    .shadeSamplePanels
                : 0,

            clusterShadeSamplePanels:
              actualShadeSamplePanels,

            sampleCoveragePercent:
              round1(
                sampleCoverageRatio *
                100
              ),

            referenceAzimuthDegrees:
              referenceRoof
                .referenceAzimuth,

            googleSegmentAzimuthDegrees:
              allocation
                .azimuthDegrees,

            azimuthDeltaDegrees:
              round1(
                circularDistanceDegrees(
                  referenceRoof
                    .referenceAzimuth,
                  allocation
                    .azimuthDegrees
                )
              ),

            referencePitchDegrees:
              referenceRoof
                .referencePitch,

            googleSegmentPitchDegrees:
              allocation
                .pitchDegrees,

            pitchDeltaDegrees:
              referenceRoof
                  .referencePitch ===
                  null ||
              allocation
                  .pitchDegrees ===
                  null
                ? null
                : round1(
                    Math.abs(
                      referenceRoof
                        .referencePitch -
                      allocation
                        .pitchDegrees
                    )
                  ),

            matchScore:
              round1(
                allocation
                  .matchScore
              ),

            googleSegmentCapacityPanels:
              allocation
                .capacityPanels,

            googleSegmentRemainingCapacityBeforeSampling:
              allocation
                .remainingCapacityPanels,

            capacityShortfallPanels:
              Math.max(
                0,
                clusterReferencePanels -
                actualShadeSamplePanels
              ),
          },
        });
      }
    }
  }

  const mappedReferencePanels =
    segmentInputs.reduce(
      (sum, segment) =>
        sum +
        Number(
          segment
            .referenceEquivalentPanels ||
          0
        ),
      0
    );

  const expectedReferencePanels =
    referenceRoofs.reduce(
      (sum, roof) =>
        sum +
        roof.referencePanels,
      0
    );

  if (
    Math.abs(
      mappedReferencePanels -
      expectedReferencePanels
    ) > 0.001
  ) {
    throw new Error(
      "Reference panel-equivalent allocation did not preserve total system capacity."
    );
  }

  return segmentInputs;
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

  const componentAwareShadeMonthly =
    shadeAdjusted
      ?.pvgisComponentAwareShadeAdjusted
      ?.monthlyKwh ||
    null;

  const componentAwareShadeAnnual =
    numberOrNull(
      shadeAdjusted
        ?.pvgisComponentAwareShadeAdjusted
        ?.annualKwh
    );

  const shadeStrengthV2 =
    buildShadeStrengthV2Benchmark({
      baselineMonthlyKwh:
        hybrid.pvgis
          ?.monthlyKwh,

      directMonthlyKwh:
        directShadeMonthly,

      componentAwareMonthlyKwh:
        componentAwareShadeMonthly,

      directAnnualShadeLossPercentOverride:
        shadeAdjusted
          ?.shadeImpact
          ?.directAnnualShadeLossPercent,

      componentAnnualShadeLossPercentOverride:
        shadeAdjusted
          ?.shadeImpact
          ?.componentAwareAnnualShadeLossPercent,
    });

  const shadeStrengthV2Annual =
    blendProduction({
      baselineKwh: [
        hybrid.pvgis
          ?.annualKwh,
      ],

      directShadeKwh: [
        directShadeAnnual,
      ],

      shadeStrength:
        shadeStrengthV2
          .prediction
          .shadeStrength,
    })[0];

  const shadeStrengthV2Monthly =
    shadeStrengthV2
      .monthly
      .blendedKwh;

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
            ?.panelWattage ??
          item.installerDesignTruth
            ?.panel?.wattage ??
          segmentInputsOverride?.[0]
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
            round2(
              segment.allocatedPanels
            ),

          referenceEquivalentPanels:
            round2(
              segment.referenceEquivalentPanels ??
              segment.allocatedPanels
            ),

          shadeSamplePanels:
            numberOrNull(
              segment.shadeSamplePanels
            ),

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

      componentAwareAnnualShadeLossPercent:
        numberOrNull(
          shadeAdjusted
            ?.shadeImpact
            ?.componentAwareAnnualShadeLossPercent
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

    fixedReferencePvgisPlusGoogleComponentAwareShade: {
      status:
        shadeAdjusted.status,

      annualKwh:
        componentAwareShadeAnnual,

      annualDeltaPercent:
        percentDelta(
          componentAwareShadeAnnual,
          referenceAnnual
        ),

      monthlyKwh:
        componentAwareShadeMonthly,

      monthlyDeltaPercent:
        Array.isArray(
          componentAwareShadeMonthly
        ) &&
        Array.isArray(
          referenceMonthly
        )
          ? componentAwareShadeMonthly.map(
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
          componentAwareShadeMonthly,
          referenceMonthly
        ),

      monthlyShareMaePercentagePoints:
        monthlyShareMaePercentagePoints(
          componentAwareShadeMonthly,
          referenceMonthly
        ),

      componentAwareAnnualShadeLossPercent:
        numberOrNull(
          shadeAdjusted
            ?.shadeImpact
            ?.componentAwareAnnualShadeLossPercent
        ),

      hourOffset: 0,
    },

    fixedReferencePvgisPlusGoogleShadeStrengthV2: {
      status:
        shadeStrengthV2.status,

      modelVersion:
        shadeStrengthV2.modelVersion,

      runtimeSignals:
        shadeStrengthV2.runtimeSignals,

      prediction:
        shadeStrengthV2.prediction,

      annualKwh:
        shadeStrengthV2Annual,

      annualDeltaPercent:
        percentDelta(
          shadeStrengthV2Annual,
          referenceAnnual
        ),

      monthlyKwh:
        shadeStrengthV2Monthly,

      monthlyDeltaPercent:
        Array.isArray(
          shadeStrengthV2Monthly
        ) &&
        Array.isArray(
          referenceMonthly
        )
          ? shadeStrengthV2Monthly.map(
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
          shadeStrengthV2Monthly,
          referenceMonthly
        ),

      monthlyShareMaePercentagePoints:
        monthlyShareMaePercentagePoints(
          shadeStrengthV2Monthly,
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
