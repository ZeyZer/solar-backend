function normalizeToOne(a) {
  const sum = a.reduce((s, v) => s + (Number(v) || 0), 0) || 1;
  return a.map(v => (Number(v) || 0) / sum);
}

function smoothArrayWeighted(a, passes = 2) {
  // Weighted moving average: preserves shape but reduces sharp peaks
  let out = a.slice();
  for (let p = 0; p < passes; p++) {
    const next = out.slice();
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length];
      const curr = out[i];
      const nxt  = out[(i + 1) % out.length];
      next[i] = 0.25 * prev + 0.5 * curr + 0.25 * nxt;
    }
    out = next;
  }
  return out;
}

function getDailyProfileFractions(occupancyProfile) {
  // Calibrated to be closer to MCS-style self-consumption behaviour:
  // less daytime overlap with PV, stronger evening demand.

  const homeAllDay = [
    // 0–5
    0.032, 0.028, 0.025, 0.024, 0.025, 0.029,
    // 6–11
    0.040, 0.050, 0.054, 0.050, 0.044, 0.040,
    // 12–17
    0.038, 0.038, 0.040, 0.046, 0.056, 0.072,
    // 18–23
    0.086, 0.092, 0.088, 0.076, 0.060, 0.045
  ];

  const halfDay = [
    // 0–5
    0.033, 0.029, 0.026, 0.025, 0.026, 0.031,
    // 6–11
    0.042, 0.056, 0.062, 0.050, 0.040, 0.036,
    // 12–17
    0.034, 0.034, 0.036, 0.042, 0.054, 0.075,
    // 18–23
    0.095, 0.102, 0.095, 0.082, 0.066, 0.049
  ];

  const outAllDay = [
    // 0–5
    0.034, 0.030, 0.027, 0.026, 0.027, 0.032,
    // 6–11
    0.046, 0.060, 0.052, 0.034, 0.024, 0.022,
    // 12–17
    0.022, 0.022, 0.024, 0.032, 0.045, 0.068,
    // 18–23
    0.106, 0.115, 0.110, 0.092, 0.074, 0.055
  ];

  let arr;
  switch (String(occupancyProfile || "")) {
    case "home_all_day":
      arr = homeAllDay;
      break;
    case "out_all_day":
      arr = outAllDay;
      break;
    default:
      arr = halfDay;
  }

  // Work on a copy
  let fractions = normalizeToOne(arr);

  // Lighter smoothing than before: your old 2-pass smoothing was
  // spreading demand back into solar hours and increasing self-consumption.
  fractions = smoothArrayWeighted(fractions, 1);

  // Re-normalise to exactly 1.0 total
  fractions = normalizeToOne(fractions);

  return fractions;
}

function monthlySeasonWeightsUK() {
  // Simple seasonality: winter higher than summer.
  // These are multipliers, not fractions. We’ll normalize later.
  // Jan..Dec
  return [1.12,1.08,1.03,0.98,0.95,0.92,0.92,0.93,0.97,1.02,1.07,1.11];
}

function buildDailyUsageProfile(annualKWh, occupancyProfile) {
  // 24 points: every hour
  const labels = Array.from({ length: 24 }, (_, h) =>
    `${String(h).padStart(2, "0")}:00`
  );

  let fractions = getDailyProfileFractions(occupancyProfile) || [];

  // If we got 48 half-hourly points, collapse into 24 hourly points
  if (fractions.length === 48) {
    const collapsed = [];
    for (let i = 0; i < 48; i += 2) {
      collapsed.push((Number(fractions[i]) || 0) + (Number(fractions[i + 1]) || 0));
    }
    fractions = collapsed;
  }

  // If we still don't have 24 points, use a non-flat fallback (24 values)
  if (fractions.length !== 24) {
    fractions = [
      0.015,0.012,0.011,0.012,0.015,0.025,
      0.040,0.050,0.045,0.040,0.038,0.036,
      0.034,0.033,0.034,0.040,0.055,0.070,
      0.080,0.075,0.055,0.040,0.028,0.020
    ];
  }

  // Normalize fractions to sum to 1
  const sum = fractions.reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  const norm = fractions.map(f => (Number(f) || 0) / sum);

  // Annual -> daily
  const annual = Number(annualKWh) || 0;
  const dailyTotalKWh = annual / 365;

  // kWh per hour (24 points)
  const kWh = norm.map(f => f * dailyTotalKWh);

  const maxVal = Math.max(...kWh, 0);
  const yMax = maxVal > 0 ? Math.ceil(maxVal * 1.2 * 10) / 10 : 1; // round up to 0.1

  return { labels, kWh, yMax };
}

function buildHourlyLoadForSeries({ annualKWh, occupancyProfile, monthIdx, hourOfDay }) {
  if (!Array.isArray(monthIdx) || !Array.isArray(hourOfDay) || monthIdx.length !== hourOfDay.length) {
    throw new Error("buildHourlyLoadForSeries requires monthIdx + hourOfDay arrays of same length.");
  }

  const daily = getDailyProfileFractions(occupancyProfile);
  const season = monthlySeasonWeightsUK(); // 12 multipliers

  const n = monthIdx.length;
  const load = Array(n).fill(0);

  // Build unscaled “shape”
  for (let i = 0; i < n; i++) {
    const m = monthIdx[i];           // 0..11
    const h = hourOfDay[i];          // 0..23
    load[i] = daily[h] * season[m];
  }

  // Scale so sum(load) = annualKWh
  const shapeSum = load.reduce((s, v) => s + v, 0) || 1;
  const scale = Number(annualKWh || 0) / shapeSum;

  // Keep 2dp precision
  return load.map((v) => Math.round(v * scale * 100) / 100);
}


module.exports = {
  normalizeToOne,
  smoothArrayWeighted,
  getDailyProfileFractions,
  monthlySeasonWeightsUK,
  buildDailyUsageProfile,
  buildHourlyLoadForSeries,
};