function averageHourlyArrays(listOf8760) {
  if (!Array.isArray(listOf8760) || listOf8760.length === 0) return null;

  const n = listOf8760[0]?.length || 0;
  if (n === 0) return null;

  const out = Array(n).fill(0);

  for (const arr of listOf8760) {
    if (!Array.isArray(arr) || arr.length !== n) return null;

    for (let i = 0; i < n; i++) {
      out[i] += Number(arr[i] || 0);
    }
  }

  for (let i = 0; i < n; i++) {
    out[i] /= listOf8760.length;
  }

  return out;
}

function averageMonthlyArrays(monthlyArrays) {
  if (!Array.isArray(monthlyArrays) || monthlyArrays.length === 0) {
    return Array(12).fill(0);
  }

  const out = Array(12).fill(0);
  const n = monthlyArrays.length;

  for (const arr of monthlyArrays) {
    for (let i = 0; i < 12; i++) {
      out[i] += Number(arr?.[i] || 0);
    }
  }

  return out.map((v) => Math.round((v / n) * 100) / 100);
}

function sum12(arr) {
  return (arr || []).reduce((s, v) => s + Number(v || 0), 0);
}

module.exports = {
  averageHourlyArrays,
  averageMonthlyArrays,
  sum12,
};