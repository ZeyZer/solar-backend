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

const rows = data.results.map((result) => {
  const summary = result.summary;
  const adaptive = summary?.googleSolarApi?.adaptiveTargetEvaluation;
  const adjusted =
    summary?.googleSolarApi?.segmentShadeAdjustedPvgisProductionBenchmark;

  return {
    id: summary.id,
    label: summary.label,

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
  };
});

console.table(rows);

const totals = rows.reduce(
  (acc, row) => {
    acc.count += 1;
    if (row.panelWithin10) acc.panelWithin10 += 1;
    if (row.annualWithin15) acc.annualWithin15 += 1;
    if (row.monthlyWithin15) acc.monthlyWithin15 += 1;
    if (row.overallPass) acc.overallPass += 1;
    return acc;
  },
  {
    count: 0,
    panelWithin10: 0,
    annualWithin15: 0,
    monthlyWithin15: 0,
    overallPass: 0,
  }
);

console.log("\nTotals");
console.table([totals]);