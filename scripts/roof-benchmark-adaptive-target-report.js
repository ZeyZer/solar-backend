const fs = require("fs");
const path = require("path");

const dir = "data/roof-benchmark/results";

const latestFile = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .filter((name) => name.startsWith("roof-model-benchmark-"))
  .map((name) => ({
    name,
    fullPath: path.join(dir, name),
    mtime: fs.statSync(path.join(dir, name)).mtimeMs,
  }))
  .sort((a, b) => b.mtime - a.mtime)[0];

if (!latestFile) {
  throw new Error("No roof-model-benchmark result file found.");
}

const data = JSON.parse(fs.readFileSync(latestFile.fullPath, "utf8"));

console.log("Reading:", latestFile.fullPath);

if (!Array.isArray(data.results)) {
  console.log("Result file keys:", Object.keys(data));
  throw new Error("Latest benchmark file does not contain data.results array.");
}

const rows = data.results.map((result, index) => {
  const summary = result?.summary || result || {};
  const google = summary?.googleSolarApi || result?.googleSolarApi || {};

  const adaptive = google?.adaptiveTargetEvaluation;
  const adjusted = google?.segmentShadeAdjustedPvgisProductionBenchmark;

  return {
    index,
    id:
      summary?.id ||
      result?.id ||
      result?.benchmarkId ||
      result?.benchmarkItem?.id ||
      `row_${index}`,

    label:
      summary?.label ||
      result?.label ||
      result?.benchmarkItem?.label ||
      result?.benchmarkItem?.property?.address ||
      "",

    hasSummary: Boolean(result?.summary),
    rowStatus:
      result?.status ||
      summary?.status ||
      google?.status ||
      adjusted?.status ||
      "",

    policyReason: adjusted?.adaptivePolicy?.reason,
    floor: adjusted?.adaptivePolicy?.diffuseFloor,
    offset: adjusted?.adaptivePolicy?.hourOffset,

    panelDeltaPercent: adaptive?.panel?.deltaPercent,
    panelWithin10: adaptive?.panel?.expectedWithin10Percent,

    annualDeltaPercent: adaptive?.annualProduction?.deltaPercent,
    annualWithin15: adaptive?.annualProduction?.expectedWithin15Percent,

    weightedMonthlyError:
      adaptive?.monthlyProduction?.weightedMonthlyAbsErrorPercent,
    monthlyWithin15:
      adaptive?.monthlyProduction?.weightedWithin15Percent,

    filteredMeanMonthlyError:
      adaptive?.monthlyProduction?.filteredMeanAbsMonthlyDeltaPercent,
    worstMonthlyKwhError:
      adaptive?.monthlyProduction?.worstMonthlyKwhError,

    overallPass: adaptive?.overallPass,
    warnings: JSON.stringify(adaptive?.warnings || []),

    error:
      String(
        result?.error ||
          summary?.error ||
          google?.error ||
          adjusted?.error ||
          ""
      ).slice(0, 180),

    resultKeys: Object.keys(result || {}).join(",").slice(0, 120),
  };
});

console.table(rows);

const totals = rows.reduce(
  (acc, row) => {
    acc.count += 1;

    if (row.hasSummary) acc.hasSummary += 1;
    if (row.error) acc.rowsWithError += 1;

    if (row.panelWithin10 === true) acc.panelWithin10 += 1;
    if (row.annualWithin15 === true) acc.annualWithin15 += 1;
    if (row.monthlyWithin15 === true) acc.monthlyWithin15 += 1;
    if (row.overallPass === true) acc.overallPass += 1;

    return acc;
  },
  {
    count: 0,
    hasSummary: 0,
    rowsWithError: 0,
    panelWithin10: 0,
    annualWithin15: 0,
    monthlyWithin15: 0,
    overallPass: 0,
  }
);

console.log("\nTotals");
console.table([totals]);

const failedOrIncomplete = rows.filter(
  (row) => !row.hasSummary || row.error || row.overallPass === false
);

if (failedOrIncomplete.length) {
  console.log("\nFailed or incomplete rows");
  console.table(failedOrIncomplete);
}
