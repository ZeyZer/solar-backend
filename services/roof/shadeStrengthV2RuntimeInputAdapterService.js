const {
  getRoofPvgisInput,
} = require("../integrations/pvgisService");

const SOURCE =
  "zeyzer_shade_strength_v2_runtime_input_adapter_v1";

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

function round3(value) {
  const number =
    numberOrNull(value);

  return number === null
    ? null
    : Math.round(number * 1000) / 1000;
}

function getLiveSegmentIndex(
  roof = {}
) {
  return numberOrNull(
    roof.sourceSegmentIndex ??
    roof.segmentIndex ??
    roof.aiRoofData
      ?.sourceSegmentIndex ??
    roof.aiRoofData
      ?.segmentIndex
  );
}

function buildRuntimeSegmentInputs({
  roofs,
  fallbackPanelWatt = 0,
}) {
  const cleanRoofs =
    Array.isArray(roofs)
      ? roofs
      : [];

  if (!cleanRoofs.length) {
    return {
      source: SOURCE,
      status: "missing_roofs",
      segmentInputs: [],
      issues: [],
    };
  }

  const segmentInputs = [];
  const issues = [];
  const seenSegmentIndexes =
    new Set();

  for (
    let roofIndex = 0;
    roofIndex < cleanRoofs.length;
    roofIndex += 1
  ) {
    const roof =
      cleanRoofs[roofIndex] || {};

    const roofInput =
      getRoofPvgisInput({
        roof,
        fallbackPanelWatt,
      });

    // Ignore genuinely unused roof cards.
    if (
      !roofInput.panels ||
      roofInput.panels <= 0
    ) {
      continue;
    }

    const segmentIndex =
      getLiveSegmentIndex(
        roof
      );

    const googlePitchDegrees =
      numberOrNull(
        roof.aiRoofData
          ?.pitchDegrees
      );

    const googleAzimuthDegrees =
      numberOrNull(
        roof.aiRoofData
          ?.azimuthDegrees
      );

    const roofId =
      roof.id ||
      roof.roofId ||
      `roof-${roofIndex + 1}`;

    if (segmentIndex === null) {
      issues.push({
        roofIndex,
        roofId,
        code:
          "missing_google_segment_index",
      });

      continue;
    }

    if (
      googlePitchDegrees === null
    ) {
      issues.push({
        roofIndex,
        roofId,
        segmentIndex,
        code:
          "missing_google_pitch",
      });

      continue;
    }

    if (
      googleAzimuthDegrees ===
      null
    ) {
      issues.push({
        roofIndex,
        roofId,
        segmentIndex,
        code:
          "missing_google_azimuth",
      });

      continue;
    }

    if (
      !roofInput.panelWatt ||
      roofInput.panelWatt <= 0
    ) {
      issues.push({
        roofIndex,
        roofId,
        segmentIndex,
        code:
          "missing_panel_watt",
      });

      continue;
    }

    if (
      seenSegmentIndexes.has(
        segmentIndex
      )
    ) {
      issues.push({
        roofIndex,
        roofId,
        segmentIndex,
        code:
          "duplicate_google_segment_index",
      });

      continue;
    }

    seenSegmentIndexes.add(
      segmentIndex
    );

    segmentInputs.push({
      segmentIndex,

      allocatedPanels:
        roofInput.panels,

      panelWattage:
        roofInput.panelWatt,

      panelWattSource:
        roofInput.panelWattSource,

      peakPowerKwp:
        round3(
          roofInput.peakPowerKwp
        ),

      tiltDeg:
        googlePitchDegrees,

      googleAzimuthDegrees,

      pvgisAspectDeg:
        roofInput.aspectDeg,

      sourceRoofIndex:
        roofIndex,

      sourceRoofId:
        roofId,

      inputSource:
        "live_ai_roof",
    });
  }

  if (issues.length) {
    return {
      source: SOURCE,
      status:
        "invalid_live_roof_inputs",

      segmentInputs: [],

      issues,

      acceptedSegmentInputs:
        segmentInputs,
    };
  }

  if (!segmentInputs.length) {
    return {
      source: SOURCE,
      status:
        "missing_segment_inputs",

      segmentInputs: [],
      issues: [],
    };
  }

  const totalPanels =
    segmentInputs.reduce(
      (sum, segment) =>
        sum +
        Number(
          segment.allocatedPanels ||
          0
        ),
      0
    );

  const systemSizeKwp =
    segmentInputs.reduce(
      (sum, segment) =>
        sum +
        Number(
          segment.peakPowerKwp ||
          0
        ),
      0
    );

  return {
    source: SOURCE,
    status: "complete",

    segmentInputs,

    summary: {
      inputRoofCount:
        cleanRoofs.length,

      selectedRoofCount:
        segmentInputs.length,

      totalPanels,

      systemSizeKwp:
        round3(systemSizeKwp),

      panelWattSources: [
        ...new Set(
          segmentInputs.map(
            (segment) =>
              segment.panelWattSource
          )
        ),
      ],
    },

    issues: [],
  };
}

module.exports = {
  getLiveSegmentIndex,
  buildRuntimeSegmentInputs,
};
