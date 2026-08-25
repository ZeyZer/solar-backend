const fs = require("fs");
const path = require("path");

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function average(values = []) {
  const valid = values.map(numberOrNull).filter((value) => value !== null);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function latestDiagnosticsFile() {
  const dir = "data/roof-benchmark/results";

  const latest = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith("shade-model-diagnostics-"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({
      name,
      fullPath: path.join(dir, name),
      mtime: fs.statSync(path.join(dir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)[0];

  if (!latest) {
    throw new Error("No shade-model-diagnostics JSON file found.");
  }

  return latest.fullPath;
}

function makeVariantKey({ floor, offset }) {
  return `floor_${Number(floor).toFixed(2)}_offset_${offset}`;
}

function getVariantForSite({ variantRows, siteId, floor, offset }) {
  const variant = makeVariantKey({ floor, offset });

  return variantRows.find(
    (row) => row.id === siteId && row.variant === variant
  );
}

function evaluatePolicy({ name, diagnostics, choose }) {
  const rows = [];

  for (const shadeLossRow of diagnostics.shadeLossRows || []) {
    const siteId = shadeLossRow.id;
    const directLoss = numberOrNull(
      shadeLossRow.directGoogleAppliedShadeLossPercent
    );

    const choice = choose({ shadeLossRow, directLoss });
    const variant = getVariantForSite({
      variantRows: diagnostics.variantRows || [],
      siteId,
      floor: choice.floor,
      offset: choice.offset,
    });

    if (!variant) {
      rows.push({
        id: siteId,
        label: shadeLossRow.label,
        policy: name,
        status: "missing_variant",
        directLoss,
        chosenFloor: choice.floor,
        chosenOffset: choice.offset,
      });
      continue;
    }

    rows.push({
      id: siteId,
      label: shadeLossRow.label,
      policy: name,
      status: "complete",

      directLoss,
      requiredLoss: shadeLossRow.requiredShadeLossPercent,

      chosenFloor: choice.floor,
      chosenOffset: choice.offset,
      chosenVariant: variant.variant,

      annualDeltaPercent: variant.annualDeltaPercent,
      weightedMonthlyAbsErrorPercent: variant.weightedMonthlyAbsErrorPercent,
      filteredMeanAbsMonthlyDeltaPercent:
        variant.filteredMeanAbsMonthlyDeltaPercent,
      winterDeltaPercent: variant.winterDeltaPercent,

      score: round1(
        Math.abs(Number(variant.annualDeltaPercent || 0)) +
          Number(variant.weightedMonthlyAbsErrorPercent || 0)
      ),
    });
  }

  const completed = rows.filter((row) => row.status === "complete");

  return {
    name,
    rows,
    summary: {
      policy: name,
      sites: completed.length,
      meanAbsAnnualDelta: round1(
        average(
          completed.map((row) => Math.abs(Number(row.annualDeltaPercent || 0)))
        )
      ),
      meanWeightedMonthlyError: round1(
        average(completed.map((row) => row.weightedMonthlyAbsErrorPercent))
      ),
      meanFilteredMonthlyError: round1(
        average(completed.map((row) => row.filteredMeanAbsMonthlyDeltaPercent))
      ),
      annualWithin10Count: completed.filter(
        (row) => Math.abs(Number(row.annualDeltaPercent || 999)) <= 10
      ).length,
      score: round1(
        average(
          completed.map(
            (row) =>
              Math.abs(Number(row.annualDeltaPercent || 0)) +
              Number(row.weightedMonthlyAbsErrorPercent || 0)
          )
        )
      ),
    },
  };
}

function buildPolicies() {
  return [
    {
      name: "baseline_direct_floor_0_offset_0",
      choose: () => ({ floor: 0, offset: 0 }),
    },
    {
      name: "global_floor_0_05_offset_1",
      choose: () => ({ floor: 0.05, offset: 1 }),
    },
    {
      name: "adaptive_a_offset_0",
      choose: ({ directLoss }) => {
        if (directLoss <= 10) return { floor: 0.3, offset: 0 };
        if (directLoss <= 16) return { floor: 0.25, offset: 0 };
        if (directLoss <= 24) return { floor: 0.15, offset: 0 };
        return { floor: 0.05, offset: 0 };
      },
    },
    {
      name: "adaptive_a_offset_1",
      choose: ({ directLoss }) => {
        if (directLoss <= 10) return { floor: 0.3, offset: 1 };
        if (directLoss <= 16) return { floor: 0.25, offset: 1 };
        if (directLoss <= 24) return { floor: 0.15, offset: 1 };
        return { floor: 0.05, offset: 1 };
      },
    },
    {
      name: "adaptive_b_offset_0",
      choose: ({ directLoss }) => {
        if (directLoss <= 12) return { floor: 0.3, offset: 0 };
        if (directLoss <= 18) return { floor: 0.2, offset: 0 };
        if (directLoss <= 25) return { floor: 0.1, offset: 0 };
        return { floor: 0.05, offset: 0 };
      },
    },
    {
      name: "adaptive_b_offset_1",
      choose: ({ directLoss }) => {
        if (directLoss <= 12) return { floor: 0.3, offset: 1 };
        if (directLoss <= 18) return { floor: 0.2, offset: 1 };
        if (directLoss <= 25) return { floor: 0.1, offset: 1 };
        return { floor: 0.05, offset: 1 };
      },
    },
    {
      name: "adaptive_c_complexity_guard",
      choose: ({ shadeLossRow, directLoss }) => {
        const originalAnnual = Number(shadeLossRow.originalHybridAnnualKwh || 0);

        // Large / complex / commercial systems need their own behaviour.
        // For now, avoid applying a high diffuse floor to these.
        if (originalAnnual >= 15000) return { floor: 0, offset: 0 };

        // Heavy-shade domestic roof: Google direct shade is already meaningful.
        if (directLoss >= 24) return { floor: 0.05, offset: 1 };

        // Low-shade domestic roof: preserve diffuse light.
        if (directLoss <= 14) return { floor: 0.3, offset: 1 };

        return { floor: 0.15, offset: 0 };
      },
    },
    {
      name: "adaptive_d_complexity_low_floor",
      choose: ({ shadeLossRow, directLoss }) => {
        const originalAnnual = Number(shadeLossRow.originalHybridAnnualKwh || 0);

        if (originalAnnual >= 15000) return { floor: 0.05, offset: 0 };
        if (directLoss >= 24) return { floor: 0.05, offset: 1 };
        if (directLoss <= 14) return { floor: 0.3, offset: 1 };

        return { floor: 0.15, offset: 0 };
      },
    },
    {
      name: "adaptive_e_complexity_qep_best_test",
      choose: ({ shadeLossRow, directLoss }) => {
        const originalAnnual = Number(shadeLossRow.originalHybridAnnualKwh || 0);

        // Diagnostic only: tests whether the large-roof case prefers the QEP-like best variant.
        if (originalAnnual >= 15000) return { floor: 0.25, offset: -1 };
        if (directLoss >= 24) return { floor: 0.05, offset: 1 };
        if (directLoss <= 14) return { floor: 0.3, offset: 1 };

        return { floor: 0.15, offset: 0 };
      },
    },
    {
      name: "adaptive_clear_high_floor_no_offset",
      choose: ({ directLoss }) => {
        if (directLoss <= 14) return { floor: 0.3, offset: 0 };
        if (directLoss <= 20) return { floor: 0.2, offset: 0 };
        return { floor: 0.05, offset: 0 };
      },
    },
    {
      name: "adaptive_clear_high_floor_offset_1",
      choose: ({ directLoss }) => {
        if (directLoss <= 14) return { floor: 0.3, offset: 1 };
        if (directLoss <= 20) return { floor: 0.2, offset: 1 };
        return { floor: 0.05, offset: 1 };
      },
    },
  ];
}

function main() {
  const latestFile = latestDiagnosticsFile();
  const diagnostics = JSON.parse(fs.readFileSync(latestFile, "utf8"));

  console.log("Reading:", latestFile);

  const policyResults = buildPolicies().map((policy) =>
    evaluatePolicy({
      name: policy.name,
      diagnostics,
      choose: policy.choose,
    })
  );

  const summaryRows = policyResults
    .map((result) => result.summary)
    .sort((a, b) => Number(a.score || 9999) - Number(b.score || 9999));

  console.log("\nPolicy summary");
  console.table(summaryRows);

  for (const result of policyResults) {
    console.log(`\n${result.name}`);
    console.table(
      result.rows.map((row) => ({
        id: row.id,
        label: row.label,
        directLoss: row.directLoss,
        requiredLoss: row.requiredLoss,
        chosenFloor: row.chosenFloor,
        chosenOffset: row.chosenOffset,
        annualDelta: row.annualDeltaPercent,
        weightedMonthlyError: row.weightedMonthlyAbsErrorPercent,
        filteredMonthlyError: row.filteredMeanAbsMonthlyDeltaPercent,
        winterDelta: row.winterDeltaPercent,
        score: row.score,
      }))
    );
  }

  const output = {
    source: "zeyzer_roof_benchmark_adaptive_shade_policy_diagnostics_v1",
    generatedAt: new Date().toISOString(),
    inputFile: latestFile,
    policyResults,
    summaryRows,
  };

  const outputPath = path.join(
    "data/roof-benchmark/results",
    `adaptive-shade-policy-diagnostics-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`
  );

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log("\nWrote:", outputPath);
}

main();
