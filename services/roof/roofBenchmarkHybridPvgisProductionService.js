const {
  getLatLonFromUkPostcode,
  getPvgisHourlyKWhForRoof,
} = require("../integrations/pvgisService");

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function round2(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 100) / 100;
}

function percentDelta(estimate, reference) {
  const estimateNumber = numberOrNull(estimate);
  const referenceNumber = numberOrNull(reference);

  if (
    estimateNumber === null ||
    referenceNumber === null ||
    referenceNumber === 0
  ) {
    return null;
  }

  return round1(((estimateNumber - referenceNumber) / referenceNumber) * 100);
}

function googleAzimuthToPvgisAspect(googleAzimuthDegrees) {
  const azimuth = numberOrNull(googleAzimuthDegrees);

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

function getInstallerPanelWattage(benchmarkItem = {}, panelAssumptionAudit = {}) {
  return numberOrNull(
    benchmarkItem?.installerDesignTruth?.panelWattage ??
      panelAssumptionAudit?.firstBuilding?.installerPanel?.wattage
  );
}

function getInstallerAnnualKwh(benchmarkItem = {}) {
  return numberOrNull(
    benchmarkItem?.installerDesignTruth?.annualProductionKwh ??
      benchmarkItem?.installerDesignTruth?.annualGenerationKwh ??
      benchmarkItem?.installerDesignTruth?.openSolarAnnualKwh
  );
}

function getInstallerMonthlyKwh(benchmarkItem = {}) {
  const truth = benchmarkItem?.installerDesignTruth || {};

  const possible =
    truth.monthlyProductionKwh ||
    truth.monthlyGenerationKwh ||
    truth.openSolarMonthlyKwh ||
    truth.monthlyKwh ||
    truth.monthly;

  if (Array.isArray(possible)) {
    const out = possible.map((value) => round1(value));
    return out.length === 12 ? out : null;
  }

  if (possible && typeof possible === "object") {
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

    const out = keys.map((key) => round1(possible[key]));

    if (out.every((value) => value !== null)) {
      return out;
    }
  }

  return null;
}

function getSegmentSelector(segmentSelectorAudit = {}) {
  return segmentSelectorAudit?.firstBuilding || null;
}

function getRecommendedConfigSummaries(selector = {}) {
  return Array.isArray(selector?.recommendedConfig?.roofSegmentSummaries)
    ? selector.recommendedConfig.roofSegmentSummaries
    : [];
}

function getScoredSegmentByIndex(selector = {}) {
  const map = new Map();

  for (const segment of selector?.scoredSegments || []) {
    const index = numberOrNull(segment.segmentIndex);
    if (index !== null) {
      map.set(index, segment);
    }
  }

  return map;
}

function allocateIntegerPanelsByCapacity({ totalPanels, segmentCapacityRows }) {
  const total = numberOrNull(totalPanels);

  if (total === null || total <= 0 || !segmentCapacityRows.length) {
    return [];
  }

  const totalCapacity = segmentCapacityRows.reduce(
    (sum, row) => sum + (numberOrNull(row.capacityPanels) || 0),
    0
  );

  if (totalCapacity <= 0) {
    return [];
  }

  const initial = segmentCapacityRows.map((row) => {
    const rawPanels = (total * row.capacityPanels) / totalCapacity;
    const floorPanels = Math.floor(rawPanels);

    return {
      ...row,
      rawPanels,
      allocatedPanels: floorPanels,
      remainder: rawPanels - floorPanels,
    };
  });

  let allocated = initial.reduce(
    (sum, row) => sum + row.allocatedPanels,
    0
  );

  const sortedByRemainder = [...initial].sort(
    (a, b) => b.remainder - a.remainder
  );

  let cursor = 0;
  while (allocated < total && sortedByRemainder.length > 0) {
    sortedByRemainder[cursor % sortedByRemainder.length].allocatedPanels += 1;
    allocated += 1;
    cursor += 1;
  }

  return initial
    .map((row) => {
      const updated = sortedByRemainder.find(
        (candidate) => candidate.segmentIndex === row.segmentIndex
      );

      return {
        ...row,
        allocatedPanels: updated?.allocatedPanels ?? row.allocatedPanels,
      };
    })
    .filter((row) => row.allocatedPanels > 0);
}

function buildSegmentInputs({
  segmentSelectorAudit,
  practicalPanelEstimate,
  panelWattage,
}) {
  const selector = getSegmentSelector(segmentSelectorAudit);

  if (!selector) {
    return [];
  }

  const expectedPanels = numberOrNull(
    practicalPanelEstimate?.practicalPanels?.expected
  );

  const scoredByIndex = getScoredSegmentByIndex(selector);

  const capacityRows = getRecommendedConfigSummaries(selector)
    .map((summary) => {
      const segmentIndex = numberOrNull(summary.segmentIndex);
      const scored = scoredByIndex.get(segmentIndex);

      return {
        segmentIndex,
        capacityPanels: numberOrNull(summary.panelsCount) || 0,
        capacityAnnualKwh: numberOrNull(summary.yearlyEnergyDcKwh) || 0,
        pitchDegrees: numberOrNull(summary.pitchDegrees ?? scored?.pitchDegrees),
        googleAzimuthDegrees: numberOrNull(
          summary.azimuthDegrees ?? scored?.azimuthDegrees
        ),
        scoredSegment: scored || null,
      };
    })
    .filter(
      (row) =>
        row.segmentIndex !== null &&
        row.capacityPanels > 0 &&
        numberOrNull(row.pitchDegrees) !== null &&
        numberOrNull(row.googleAzimuthDegrees) !== null
    );

  const allocations = allocateIntegerPanelsByCapacity({
    totalPanels: expectedPanels,
    segmentCapacityRows: capacityRows,
  });

  return allocations.map((row) => {
    const peakPowerKwp =
      (row.allocatedPanels * numberOrNull(panelWattage)) / 1000;

    return {
      segmentIndex: row.segmentIndex,
      allocatedPanels: row.allocatedPanels,
      capacityPanels: row.capacityPanels,
      capacityAnnualKwh: round1(row.capacityAnnualKwh),

      tiltDeg: round1(row.pitchDegrees),
      googleAzimuthDegrees: round1(row.googleAzimuthDegrees),
      pvgisAspectDeg: googleAzimuthToPvgisAspect(row.googleAzimuthDegrees),

      panelWattage: numberOrNull(panelWattage),
      peakPowerKwp: round2(peakPowerKwp),

      orientationClass: row.scoredSegment?.orientationClass || null,
      sunshineClass: row.scoredSegment?.sunshineClass || null,
    };
  });
}

function monthlyFromHourly(kWh = [], monthIdx = []) {
  const monthly = Array(12).fill(0);

  for (let i = 0; i < kWh.length; i += 1) {
    const month = Number(monthIdx[i]);
    if (month >= 0 && month <= 11) {
      monthly[month] += Number(kWh[i] || 0);
    }
  }

  return monthly.map(round1);
}

function sumHourlyProfiles(profiles = []) {
  const usableProfiles = profiles.filter(
    (profile) => Array.isArray(profile?.kWh) && profile.kWh.length > 0
  );

  if (!usableProfiles.length) {
    return null;
  }

  const baseLength = usableProfiles[0].kWh.length;
  const total = Array(baseLength).fill(0);

  for (const profile of usableProfiles) {
    if (profile.kWh.length !== baseLength) {
      throw new Error("PVGIS hourly profile length mismatch.");
    }

    for (let i = 0; i < baseLength; i += 1) {
      total[i] += Number(profile.kWh[i] || 0);
    }
  }

  return {
    kWh: total.map((value) => round2(value)),
    monthIdx: usableProfiles[0].monthIdx,
    hourOfDay: usableProfiles[0].hourOfDay,
  };
}

function averageMonthly(monthlySets = []) {
  if (!monthlySets.length) {
    return null;
  }

  const out = Array(12).fill(0);

  for (const monthly of monthlySets) {
    for (let i = 0; i < 12; i += 1) {
      out[i] += Number(monthly[i] || 0);
    }
  }

  return out.map((value) => round1(value / monthlySets.length));
}

function averageAnnual(annualValues = []) {
  if (!annualValues.length) {
    return null;
  }

  const total = annualValues.reduce((sum, value) => sum + Number(value || 0), 0);
  return round1(total / annualValues.length);
}

function monthlyDeltaPercent(estimateMonthly, referenceMonthly) {
  if (!Array.isArray(estimateMonthly) || !Array.isArray(referenceMonthly)) {
    return null;
  }

  if (estimateMonthly.length !== 12 || referenceMonthly.length !== 12) {
    return null;
  }

  return estimateMonthly.map((estimate, index) =>
    percentDelta(estimate, referenceMonthly[index])
  );
}

async function buildHybridPvgisProductionBenchmark({
  benchmarkItem,
  panelAssumptionAudit,
  segmentSelectorAudit,
  practicalPanelEstimate,
  years = [2021, 2022, 2023],
}) {
  const postcode = getBenchmarkPostcode(benchmarkItem);
  const panelWattage = getInstallerPanelWattage(
    benchmarkItem,
    panelAssumptionAudit
  );

  if (!postcode) {
    return {
      source: "zeyzer_hybrid_google_roof_pvgis_production_v1",
      status: "missing_postcode",
      error: "Benchmark item is missing postcode.",
    };
  }

  if (!panelWattage) {
    return {
      source: "zeyzer_hybrid_google_roof_pvgis_production_v1",
      status: "missing_panel_wattage",
      error: "Benchmark item is missing panel wattage.",
    };
  }

  const segmentInputs = buildSegmentInputs({
    segmentSelectorAudit,
    practicalPanelEstimate,
    panelWattage,
  });

  if (!segmentInputs.length) {
    return {
      source: "zeyzer_hybrid_google_roof_pvgis_production_v1",
      status: "missing_segment_inputs",
      postcode,
      panelWattage,
      error: "No valid selected segment inputs were available.",
    };
  }

  const { lat, lon } = await getLatLonFromUkPostcode(postcode);

  const yearlyResults = [];

  for (const year of years) {
    const segmentProfiles = [];

    for (const segment of segmentInputs) {
      const profile = await getPvgisHourlyKWhForRoof({
        lat,
        lon,
        tiltDeg: segment.tiltDeg,
        aspectDeg: segment.pvgisAspectDeg,
        peakPowerKwp: segment.peakPowerKwp,
        year,
      });

      segmentProfiles.push({
        ...segment,
        year,
        ...profile,
        annualKwh: round1(
          profile.kWh.reduce((sum, value) => sum + Number(value || 0), 0)
        ),
        monthlyKwh: monthlyFromHourly(profile.kWh, profile.monthIdx),
      });
    }

    const summed = sumHourlyProfiles(segmentProfiles);

    const monthlyKwh = monthlyFromHourly(summed.kWh, summed.monthIdx);
    const annualKwh = round1(
      summed.kWh.reduce((sum, value) => sum + Number(value || 0), 0)
    );

    yearlyResults.push({
      year,
      annualKwh,
      monthlyKwh,
      segmentProfiles: segmentProfiles.map((profile) => ({
        segmentIndex: profile.segmentIndex,
        allocatedPanels: profile.allocatedPanels,
        peakPowerKwp: profile.peakPowerKwp,
        tiltDeg: profile.tiltDeg,
        googleAzimuthDegrees: profile.googleAzimuthDegrees,
        pvgisAspectDeg: profile.pvgisAspectDeg,
        annualKwh: profile.annualKwh,
        monthlyKwh: profile.monthlyKwh,
      })),
    });
  }

  const pvgisAnnualKwh = averageAnnual(
    yearlyResults.map((result) => result.annualKwh)
  );

  const pvgisMonthlyKwh = averageMonthly(
    yearlyResults.map((result) => result.monthlyKwh)
  );

  const installerAnnualKwh = getInstallerAnnualKwh(benchmarkItem);
  const installerMonthlyKwh = getInstallerMonthlyKwh(benchmarkItem);

  return {
    source: "zeyzer_hybrid_google_roof_pvgis_production_v1",
    status: "complete",

    postcode,
    latitude: lat,
    longitude: lon,
    years,

    segmentInputs,
    allocatedPanelTotal: segmentInputs.reduce(
      (sum, segment) => sum + Number(segment.allocatedPanels || 0),
      0
    ),
    systemSizeKwp: round2(
      segmentInputs.reduce(
        (sum, segment) => sum + Number(segment.peakPowerKwp || 0),
        0
      )
    ),

    pvgis: {
      annualKwh: pvgisAnnualKwh,
      monthlyKwh: pvgisMonthlyKwh,
    },

    installerReference: {
      annualKwh: round1(installerAnnualKwh),
      monthlyKwh: installerMonthlyKwh,
    },

    deltas: {
      annualDeltaPercent: percentDelta(pvgisAnnualKwh, installerAnnualKwh),
      monthlyDeltaPercent: monthlyDeltaPercent(
        pvgisMonthlyKwh,
        installerMonthlyKwh
      ),
    },

    yearlyResults,
  };
}

module.exports = {
  buildHybridPvgisProductionBenchmark,
};
