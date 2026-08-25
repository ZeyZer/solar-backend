const fs = require("fs");
const path = require("path");

const {
  getPvgisHourlyKWhForRoof,
} = require("../services/integrations/pvgisService");

const FLOORS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
const OFFSETS = [-2, -1, 0, 1, 2];

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
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
  const e = numberOrNull(estimate);
  const r = numberOrNull(reference);
  if (e === null || r === null || r === 0) return null;
  return round1(((e - r) / r) * 100);
}

function latestBenchmarkFile() {
  const dir = "data/roof-benchmark/results";

  const latest = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => name.startsWith("roof-model-benchmark-"))
    .map((name) => ({
      name,
      fullPath: path.join(dir, name),
      mtime: fs.statSync(path.join(dir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)[0];

  if (!latest) {
    throw new Error("No roof benchmark result JSON found.");
  }

  return latest.fullPath;
}

function sum(values = []) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function average(values = []) {
  const valid = values.map(numberOrNull).filter((value) => value !== null);
  if (!valid.length) return null;
  return sum(valid) / valid.length;
}

function monthlyFromHourly(kwh = [], monthIdx = []) {
  const monthly = Array(12).fill(0);

  for (let i = 0; i < kwh.length; i += 1) {
    const month = Number(monthIdx[i]);
    if (month >= 0 && month <= 11) {
      monthly[month] += Number(kwh[i] || 0);
    }
  }

  return monthly.map(round1);
}

function averageMonthly(monthlySets = []) {
  if (!monthlySets.length) return null;

  const out = Array(12).fill(0);

  for (const monthly of monthlySets) {
    for (let i = 0; i < 12; i += 1) {
      out[i] += Number(monthly[i] || 0);
    }
  }

  return out.map((value) => round1(value / monthlySets.length));
}

function clamp01(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Math.max(0, Math.min(1, number));
}

function getShadeFactor({ matrix, monthIdx, hourOfDay, hourOffset }) {
  const month = Number(monthIdx);
  const hour = (Number(hourOfDay) + Number(hourOffset) + 24) % 24;

  if (month < 0 || month > 11 || hour < 0 || hour > 23) {
    return 1;
  }

  const factor = clamp01(matrix?.[month]?.[hour]);

  return factor === null ? 1 : factor;
}

function applyDiffuseFloor({ shadeFactor, diffuseFloor }) {
  const shade = clamp01(shadeFactor);
  const floor = clamp01(diffuseFloor) ?? 0;

  if (shade === null) return 1;

  return floor + (1 - floor) * shade;
}

function sumHourlyArrays(arrays = []) {
  const usable = arrays.filter((arr) => Array.isArray(arr) && arr.length > 0);
  if (!usable.length) return null;

  const length = usable[0].length;
  const total = Array(length).fill(0);

  for (const arr of usable) {
    if (arr.length !== length) {
      throw new Error("Hourly array length mismatch.");
    }

    for (let i = 0; i < length; i += 1) {
      total[i] += Number(arr[i] || 0);
    }
  }

  return total.map(round2);
}

function weightedMonthlyAbsErrorPercent(estimateMonthly, referenceMonthly, referenceAnnual) {
  if (!Array.isArray(estimateMonthly) || !Array.isArray(referenceMonthly)) return null;

  const annualRef = numberOrNull(referenceAnnual) || sum(referenceMonthly);
  if (!annualRef) return null;

  const absError = estimateMonthly.reduce((total, estimate, index) => {
    const ref = Number(referenceMonthly[index] || 0);
    return total + Math.abs(Number(estimate || 0) - ref);
  }, 0);

  return round1((absError / annualRef) * 100);
}

function filteredMeanAbsMonthlyDeltaPercent(estimateMonthly, referenceMonthly, referenceAnnual) {
  if (!Array.isArray(estimateMonthly) || !Array.isArray(referenceMonthly)) return null;

  const annualRef = numberOrNull(referenceAnnual) || sum(referenceMonthly);
  const threshold = Math.max(50, annualRef * 0.01);

  const deltas = [];

  for (let i = 0; i < 12; i += 1) {
    const ref = Number(referenceMonthly[i] || 0);
    if (ref < threshold) continue;

    const delta = percentDelta(estimateMonthly[i], ref);
    if (delta !== null) deltas.push(Math.abs(delta));
  }

  if (!deltas.length) return null;

  return round1(average(deltas));
}

function worstMonthlyAbsKwhError(estimateMonthly, referenceMonthly) {
  if (!Array.isArray(estimateMonthly) || !Array.isArray(referenceMonthly)) return null;

  return round1(
    Math.max(
      ...estimateMonthly.map((estimate, index) =>
        Math.abs(Number(estimate || 0) - Number(referenceMonthly[index] || 0))
      )
    )
  );
}

function winterDeltaPercent(estimateMonthly, referenceMonthly) {
  if (!Array.isArray(estimateMonthly) || !Array.isArray(referenceMonthly)) return null;

  const estimateWinter =
    Number(estimateMonthly[11] || 0) +
    Number(estimateMonthly[0] || 0) +
    Number(estimateMonthly[1] || 0);

  const referenceWinter =
    Number(referenceMonthly[11] || 0) +
    Number(referenceMonthly[0] || 0) +
    Number(referenceMonthly[1] || 0);

  return percentDelta(estimateWinter, referenceWinter);
}

function variantName({ diffuseFloor, hourOffset }) {
  return `floor_${diffuseFloor.toFixed(2)}_offset_${hourOffset}`;
}

async function buildBaseProfiles({ hybrid, segmentInputs }) {
  const years = Array.isArray(hybrid?.years) ? hybrid.years : [2021, 2022, 2023];

  const lat = numberOrNull(hybrid?.latitude);
  const lon = numberOrNull(hybrid?.longitude);

  if (lat === null || lon === null) {
    throw new Error("Hybrid benchmark is missing latitude/longitude.");
  }

  const yearlyProfiles = [];

  for (const year of years) {
    const segmentProfiles = [];

    for (const segment of segmentInputs) {
      const profile = await getPvgisHourlyKWhForRoof({
        lat,
        lon,
        tiltDeg: numberOrNull(segment.tiltDeg),
        aspectDeg: numberOrNull(segment.pvgisAspectDeg),
        peakPowerKwp: numberOrNull(segment.peakPowerKwp),
        year,
      });

      segmentProfiles.push({
        year,
        segmentIndex: segment.segmentIndex,
        allocatedPanels: segment.allocatedPanels,
        peakPowerKwp: segment.peakPowerKwp,
        kWh: profile.kWh,
        monthIdx: profile.monthIdx,
        hourOfDay: profile.hourOfDay,
      });
    }

    yearlyProfiles.push({
      year,
      segmentProfiles,
    });
  }

  return yearlyProfiles;
}

function evaluateVariant({
  yearlyProfiles,
  segmentMatrices,
  installerAnnual,
  installerMonthly,
  diffuseFloor,
  hourOffset,
}) {
  const yearlyResults = [];

  for (const yearData of yearlyProfiles) {
    const adjustedSegmentHourly = [];

    for (const segmentProfile of yearData.segmentProfiles) {
      const segmentKey = String(segmentProfile.segmentIndex);
      const matrix = segmentMatrices[segmentKey];

      const adjusted = segmentProfile.kWh.map((original, index) => {
        const shadeFactor = getShadeFactor({
          matrix,
          monthIdx: segmentProfile.monthIdx[index],
          hourOfDay: segmentProfile.hourOfDay[index],
          hourOffset,
        });

        const multiplier = applyDiffuseFloor({
          shadeFactor,
          diffuseFloor,
        });

        return round2(Number(original || 0) * multiplier);
      });

      adjustedSegmentHourly.push(adjusted);
    }

    const totalHourly = sumHourlyArrays(adjustedSegmentHourly);
    const monthIdx = yearData.segmentProfiles[0]?.monthIdx || [];
    const monthly = monthlyFromHourly(totalHourly, monthIdx);
    const annual = round1(sum(totalHourly));

    yearlyResults.push({
      year: yearData.year,
      annual,
      monthly,
    });
  }

  const monthly = averageMonthly(yearlyResults.map((row) => row.monthly));
  const annual = round1(average(yearlyResults.map((row) => row.annual)));

  const annualDelta = percentDelta(annual, installerAnnual);
  const weightedMonthlyError = weightedMonthlyAbsErrorPercent(
    monthly,
    installerMonthly,
    installerAnnual
  );
  const filteredMonthlyError = filteredMeanAbsMonthlyDeltaPercent(
    monthly,
    installerMonthly,
    installerAnnual
  );
  const worstMonthlyKwhError = worstMonthlyAbsKwhError(monthly, installerMonthly);
  const winterDelta = winterDeltaPercent(monthly, installerMonthly);

  const score = round1(
    Math.abs(Number(annualDelta || 0)) +
      Number(weightedMonthlyError || 0)
  );

  return {
    variant: variantName({ diffuseFloor, hourOffset }),
    diffuseFloor,
    hourOffset,
    annualKwh: annual,
    annualDeltaPercent: annualDelta,
    weightedMonthlyAbsErrorPercent: weightedMonthlyError,
    filteredMeanAbsMonthlyDeltaPercent: filteredMonthlyError,
    worstMonthlyAbsKwhError: worstMonthlyKwhError,
    winterDeltaPercent: winterDelta,
    score,
    monthlyKwh: monthly,
    yearlyResults,
  };
}

function requiredShadeLossPercent({ originalHybridAnnual, installerAnnual }) {
  const original = numberOrNull(originalHybridAnnual);
  const installer = numberOrNull(installerAnnual);

  if (!original || installer === null) return null;

  return round1(((original - installer) / original) * 100);
}

function appliedShadeLossPercent({ originalHybridAnnual, adjustedAnnual }) {
  const original = numberOrNull(originalHybridAnnual);
  const adjusted = numberOrNull(adjustedAnnual);

  if (!original || adjusted === null) return null;

  return round1(((original - adjusted) / original) * 100);
}

async function main() {
  const latestFile = latestBenchmarkFile();
  const data = JSON.parse(fs.readFileSync(latestFile, "utf8"));

  console.log("Reading:", latestFile);

  const allSiteRows = [];
  const allVariantRows = [];
  const shadeLossRows = [];

  for (const result of data.results) {
    const summary = result.summary;
    const google = summary?.googleSolarApi || {};
    const hybrid = google.hybridPvgisProductionBenchmark;
    const shadeAudit = google.googleHourlyShadeFactorAudit;
    const currentAdjusted = google.segmentShadeAdjustedPvgisProductionBenchmark;

    const segmentInputs = hybrid?.segmentInputs || [];
    const segmentMatrices = shadeAudit?.segmentMonthlyByHourShadeFactor || {};

    const installerAnnual = numberOrNull(hybrid?.installerReference?.annualKwh);
    const installerMonthly = hybrid?.installerReference?.monthlyKwh;

    if (
      !segmentInputs.length ||
      !Object.keys(segmentMatrices).length ||
      !installerAnnual ||
      !Array.isArray(installerMonthly)
    ) {
      allSiteRows.push({
        id: summary.id,
        label: summary.label,
        status: "skipped_missing_inputs",
      });
      continue;
    }

    const yearlyProfiles = await buildBaseProfiles({
      hybrid,
      segmentInputs,
    });

    const variants = [];

    for (const diffuseFloor of FLOORS) {
      for (const hourOffset of OFFSETS) {
        variants.push(
          evaluateVariant({
            yearlyProfiles,
            segmentMatrices,
            installerAnnual,
            installerMonthly,
            diffuseFloor,
            hourOffset,
          })
        );
      }
    }

    variants.sort((a, b) => Number(a.score || 9999) - Number(b.score || 9999));

    const best = variants[0];
    const currentDirect =
      variants.find(
        (row) => row.diffuseFloor === 0 && row.hourOffset === 0
      ) || null;

    allSiteRows.push({
      id: summary.id,
      label: summary.label,

      installerAnnualKwh: installerAnnual,
      originalHybridAnnualKwh: hybrid?.pvgis?.annualKwh,

      currentDirectAnnualKwh: currentDirect?.annualKwh,
      currentDirectAnnualDelta: currentDirect?.annualDeltaPercent,
      currentDirectWeightedMonthlyError:
        currentDirect?.weightedMonthlyAbsErrorPercent,

      bestVariant: best?.variant,
      bestAnnualKwh: best?.annualKwh,
      bestAnnualDelta: best?.annualDeltaPercent,
      bestWeightedMonthlyError: best?.weightedMonthlyAbsErrorPercent,
      bestFilteredMonthlyError: best?.filteredMeanAbsMonthlyDeltaPercent,
      bestWinterDelta: best?.winterDeltaPercent,
      bestScore: best?.score,
    });

    shadeLossRows.push({
      id: summary.id,
      label: summary.label,
      originalHybridAnnualKwh: hybrid?.pvgis?.annualKwh,
      installerAnnualKwh: installerAnnual,
      currentAdjustedAnnualKwh:
        currentAdjusted?.pvgisSegmentShadeAdjusted?.annualKwh,
      requiredShadeLossPercent: requiredShadeLossPercent({
        originalHybridAnnual: hybrid?.pvgis?.annualKwh,
        installerAnnual,
      }),
      directGoogleAppliedShadeLossPercent: appliedShadeLossPercent({
        originalHybridAnnual: hybrid?.pvgis?.annualKwh,
        adjustedAnnual: currentAdjusted?.pvgisSegmentShadeAdjusted?.annualKwh,
      }),
      currentAnnualDeltaPercent:
        currentAdjusted?.deltas?.segmentShadeAdjustedAnnualDeltaPercent,
    });

    allVariantRows.push(
      ...variants.map((variant) => ({
        id: summary.id,
        label: summary.label,
        ...variant,
      }))
    );
  }

  const aggregateByVariant = new Map();

  for (const row of allVariantRows) {
    const key = row.variant;

    if (!aggregateByVariant.has(key)) {
      aggregateByVariant.set(key, []);
    }

    aggregateByVariant.get(key).push(row);
  }

  const aggregateRows = [...aggregateByVariant.entries()]
    .map(([variant, rows]) => ({
      variant,
      diffuseFloor: rows[0]?.diffuseFloor,
      hourOffset: rows[0]?.hourOffset,
      sites: rows.length,
      meanAbsAnnualDelta: round1(
        average(rows.map((row) => Math.abs(Number(row.annualDeltaPercent || 0))))
      ),
      meanWeightedMonthlyError: round1(
        average(rows.map((row) => row.weightedMonthlyAbsErrorPercent))
      ),
      meanFilteredMonthlyError: round1(
        average(rows.map((row) => row.filteredMeanAbsMonthlyDeltaPercent))
      ),
      annualWithin10Count: rows.filter(
        (row) => Math.abs(Number(row.annualDeltaPercent || 999)) <= 10
      ).length,
      score: round1(
        average(
          rows.map(
            (row) =>
              Math.abs(Number(row.annualDeltaPercent || 0)) +
              Number(row.weightedMonthlyAbsErrorPercent || 0)
          )
        )
      ),
    }))
    .sort((a, b) => Number(a.score || 9999) - Number(b.score || 9999));

  const output = {
    source: "zeyzer_roof_benchmark_shade_model_diagnostics_v1",
    generatedAt: new Date().toISOString(),
    latestBenchmarkFile: latestFile,
    floors: FLOORS,
    hourOffsets: OFFSETS,
    shadeLossRows,
    siteBestRows: allSiteRows,
    aggregateRows,
    variantRows: allVariantRows,
  };

  const outputPath = path.join(
    "data/roof-benchmark/results",
    `shade-model-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log("\nShade loss comparison");
  console.table(shadeLossRows);

  console.log("\nBest variant per site");
  console.table(allSiteRows);

  console.log("\nBest aggregate variants");
  console.table(aggregateRows.slice(0, 12));

  console.log("\nWrote:", outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
