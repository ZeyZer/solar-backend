function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalisePoint(point) {
  if (!point || typeof point !== "object") {
    return null;
  }

  const lat = numberOrNull(point.lat ?? point.latitude);
  const lng = numberOrNull(point.lng ?? point.longitude);

  if (lat === null || lng === null) {
    return null;
  }

  return { lat, lng };
}

function getPanelPoint(panel) {
  return normalisePoint(panel?.center);
}

function projectPoint(point, referenceLat) {
  const lat = numberOrNull(point?.lat);
  const lng = numberOrNull(point?.lng);

  if (lat === null || lng === null) {
    return null;
  }

  const latRadians = (Number(referenceLat || lat) * Math.PI) / 180;

  return {
    x: lng * Math.cos(latRadians),
    y: lat,
  };
}

function signedSideOfLine(point, line) {
  const p = normalisePoint(point);
  const a = normalisePoint(line?.[0]);
  const b = normalisePoint(line?.[1]);

  if (!p || !a || !b) {
    return null;
  }

  const referenceLat = (a.lat + b.lat + p.lat) / 3;

  const pp = projectPoint(p, referenceLat);
  const aa = projectPoint(a, referenceLat);
  const bb = projectPoint(b, referenceLat);

  if (!pp || !aa || !bb) {
    return null;
  }

  return ((bb.x - aa.x) * (pp.y - aa.y)) - ((bb.y - aa.y) * (pp.x - aa.x));
}

const BOUNDARY_SIDE_TOLERANCE = 1e-12;

function sameSideOrOnLine(point, referencePoint, line) {
  const pointSide = signedSideOfLine(point, line);
  const referenceSide = signedSideOfLine(referencePoint, line);

  if (pointSide === null || referenceSide === null) {
    return false;
  }

  if (Math.abs(pointSide) <= BOUNDARY_SIDE_TOLERANCE) {
    return true;
  }

  if (Math.abs(referenceSide) <= BOUNDARY_SIDE_TOLERANCE) {
    return true;
  }

  return Math.sign(pointSide) === Math.sign(referenceSide);
}

function getBoundaryLines(propertyBoundary) {
  const lines = Array.isArray(propertyBoundary?.boundaryLines)
    ? propertyBoundary.boundaryLines
    : [];

  return lines
    .map((line) => {
      const a = normalisePoint(line?.[0]);
      const b = normalisePoint(line?.[1]);

      if (!a || !b) {
        return null;
      }

      return [a, b];
    })
    .filter(Boolean);
}

function buildReferencePoint({ referencePoint, buildingModel }) {
  return (
    normalisePoint(referencePoint) ||
    normalisePoint(buildingModel?.requestedLocation) ||
    normalisePoint(buildingModel?.center)
  );
}

function shouldApplyBoundaryFilter(propertyBoundary) {
  return (
    propertyBoundary &&
    Array.isArray(propertyBoundary.boundaryLines) &&
    propertyBoundary.boundaryLines.length > 0
  );
}

function round1(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function buildFilteredRoofSegmentSummaries({ buildingModel, keptPanels }) {
  const roofSegments = Array.isArray(buildingModel?.roofSegments)
    ? buildingModel.roofSegments
    : [];

  const bySegment = new Map();

  keptPanels.forEach((panel) => {
    const segmentIndex = Number.isInteger(panel.segmentIndex)
      ? panel.segmentIndex
      : null;

    if (segmentIndex === null) {
      return;
    }

    const current = bySegment.get(segmentIndex) || {
      panelsCount: 0,
      yearlyEnergyDcKwh: 0,
    };

    current.panelsCount += 1;
    current.yearlyEnergyDcKwh += Number(panel.yearlyEnergyDcKwh || 0);

    bySegment.set(segmentIndex, current);
  });

  return roofSegments.map((segment) => {
    const segmentIndex = segment.sourceIndex;
    const counts = bySegment.get(segmentIndex) || {
      panelsCount: 0,
      yearlyEnergyDcKwh: 0,
    };

    return {
      sourceIndex: segmentIndex,
      pitchDegrees: segment.pitchDegrees ?? null,
      azimuthDegrees: segment.azimuthDegrees ?? null,
      panelsCount: counts.panelsCount,
      yearlyEnergyDcKwh: round1(counts.yearlyEnergyDcKwh) || 0,
      segmentIndex,
    };
  });
}

function summarisePanelsBySegment(panels = []) {
  return panels.reduce((acc, panel) => {
    const key = Number.isInteger(panel.segmentIndex)
      ? String(panel.segmentIndex)
      : "unknown";

    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function buildBoundarySideDiagnostics({ panels = [], reference, lines = [] }) {
  return lines.map((line, lineIndex) => {
    const referenceSide = signedSideOfLine(reference, line);

    let positiveSideCount = 0;
    let negativeSideCount = 0;
    let zeroSideCount = 0;
    let unclassifiedPanelCount = 0;

    const samplePanelSides = [];
    const samplePanelCenters = [];

    panels.forEach((panel) => {
      const point = getPanelPoint(panel);
      const side = point ? signedSideOfLine(point, line) : null;

      if (side === null) {
        unclassifiedPanelCount += 1;
      } else if (Math.abs(side) <= BOUNDARY_SIDE_TOLERANCE) {
        zeroSideCount += 1;
      } else if (side > 0) {
        positiveSideCount += 1;
      } else {
        negativeSideCount += 1;
      }

      if (samplePanelSides.length < 10) {
        samplePanelSides.push({
          segmentIndex: Number.isInteger(panel?.segmentIndex)
            ? panel.segmentIndex
            : null,
          side,
          sideSign:
            side === null
              ? null
              : Math.abs(side) <= BOUNDARY_SIDE_TOLERANCE
                ? 0
                : Math.sign(side),
        });

        samplePanelCenters.push(point);
      }
    });

    return {
      lineIndex,
      tolerance: BOUNDARY_SIDE_TOLERANCE,
      referenceSide,
      referenceSideSign:
        referenceSide === null
          ? null
          : Math.abs(referenceSide) <= BOUNDARY_SIDE_TOLERANCE
            ? 0
            : Math.sign(referenceSide),
      positiveSideCount,
      negativeSideCount,
      zeroSideCount,
      unclassifiedPanelCount,
      samplePanelSides,
      samplePanelCenters,
      normalisedReferencePoint: reference,
      normalisedBoundaryLine: line,
    };
  });
}

function buildBoundarySideLogSummary(boundarySideDiagnostics = []) {
  return boundarySideDiagnostics.map((diagnostic) => ({
    lineIndex: diagnostic.lineIndex,
    referenceSideSign: diagnostic.referenceSideSign,
    positiveSideCount: diagnostic.positiveSideCount,
    negativeSideCount: diagnostic.negativeSideCount,
    zeroSideCount: diagnostic.zeroSideCount,
    unclassifiedPanelCount: diagnostic.unclassifiedPanelCount,
  }));
}

function applyPropertyBoundaryFilter(
  buildingModel = {},
  {
    propertyBoundary = null,
    propertyType = "unknown",
    referencePoint = null,
  } = {}
) {
  if (!shouldApplyBoundaryFilter(propertyBoundary)) {
    return buildingModel;
  }

  const lines = getBoundaryLines(propertyBoundary);
  const reference = buildReferencePoint({ referencePoint, buildingModel });

  if (!lines.length || !reference) {
    return {
      ...buildingModel,
      propertyBoundaryFilter: {
        applied: false,
        reason: "invalid_boundary_or_reference_point",
        propertyType,
        source: propertyBoundary?.source || null,
      },
    };
  }

  const originalPanels = Array.isArray(buildingModel.googlePanelPositions)
    ? buildingModel.googlePanelPositions
    : [];

  const boundarySideDiagnostics = buildBoundarySideDiagnostics({
    panels: originalPanels,
    reference,
    lines,
  });

  console.log(
    "Property boundary side diagnostic:",
    buildBoundarySideLogSummary(boundarySideDiagnostics)
  );

  const keptPanels = originalPanels.filter((panel) => {
    const point = getPanelPoint(panel);

    if (!point) {
      return false;
    }

    return lines.every((line) => sameSideOrOnLine(point, reference, line));
  });

  const excludedPanels = originalPanels.filter(
    (panel) => !keptPanels.includes(panel)
  );

  const roofSegmentSummaries = buildFilteredRoofSegmentSummaries({
    buildingModel,
    keptPanels,
  });

  const yearlyEnergyDcKwh = roofSegmentSummaries.reduce(
    (sum, summary) => sum + Number(summary.yearlyEnergyDcKwh || 0),
    0
  );

  const boundaryFilteredConfig = {
    id: "boundary-filtered-panel-config-1",
    sourceIndex: -1,
    source: "user_property_boundary_filter",
    panelsCount: keptPanels.length,
    yearlyEnergyDcKwh: round1(yearlyEnergyDcKwh) || 0,
    roofSegmentSummaries,
  };

  const googlePanelAreaM2 =
    Number(buildingModel?.solarPotential?.panelHeightMeters || 0) *
    Number(buildingModel?.solarPotential?.panelWidthMeters || 0);

  return {
    ...buildingModel,

    googlePanelPositionsOriginalCount: originalPanels.length,
    googlePanelPositions: keptPanels,
    googlePanelPositionsBoundaryExcludedSample: excludedPanels.slice(0, 20),

    googlePanelConfigsOriginal: Array.isArray(buildingModel.googlePanelConfigs)
      ? buildingModel.googlePanelConfigs
      : [],
    googlePanelConfigs: [boundaryFilteredConfig],
    googlePanelConfigsSample: [boundaryFilteredConfig],
    googlePanelConfigsCount: 1,

    solarPotential: {
      ...(buildingModel.solarPotential || {}),
      originalMaxArrayPanelsCount:
        buildingModel?.solarPotential?.maxArrayPanelsCount ?? originalPanels.length,
      maxArrayPanelsCount: keptPanels.length,
      maxArrayAreaM2: googlePanelAreaM2
        ? Math.round(keptPanels.length * googlePanelAreaM2 * 100) / 100
        : buildingModel?.solarPotential?.maxArrayAreaM2 ?? null,
    },

    propertyBoundaryFilter: {
      applied: true,
      source: propertyBoundary?.source || "user_drawn_on_google_map",
      propertyType,
      geometryType: propertyBoundary?.geometryType || null,
      boundaryLineCount: lines.length,
      originalPanelCount: originalPanels.length,
      keptPanelCount: keptPanels.length,
      excludedPanelCount: excludedPanels.length,
      originalPanelsBySegment: summarisePanelsBySegment(originalPanels),
      keptPanelsBySegment: summarisePanelsBySegment(keptPanels),
      referencePoint: reference,
      boundarySideDiagnostics,
      filteringMethod: "panel_centres_same_side_as_target",
    },

    warnings: [
      ...(Array.isArray(buildingModel.warnings) ? buildingModel.warnings : []),
      "Property boundary filter applied to Google panel centres. This is an estimate and should be confirmed by survey.",
    ],
  };
}

module.exports = {
  applyPropertyBoundaryFilter,
};
