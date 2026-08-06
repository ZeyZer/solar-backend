// DAY SLICE DEBUG ======

function extractDaySlice(hourly, startIndex) {
  const start = Math.max(0, Number(startIndex || 0));
  const end = Math.min(start + 24, (hourly?.pvKWh?.length || hourly?.pv?.length || 0));

  const pick = (...keys) => {
    for (const k of keys) {
      const v = hourly?.[k];
      if (Array.isArray(v)) return v;
    }
    return null;
  };

  const slice = (arr) => {
    if (!Array.isArray(arr)) return Array(end - start).fill(0);
    return arr.slice(start, end);
  };

  const hours = Array.from({ length: end - start }, (_, i) => i);

  // Support both “new” keys (pvKWh) and older ones (pv)
  const pvArr = pick("pvKWh", "pv");
  const loadArr = pick("loadKWh", "load");
  const socArr = pick("socKWh", "soc");

  const importArr = pick("importKWh", "import");
  const exportArr = pick("exportKWh", "export");

  const chPVArr = pick("battChargeFromPVKWh", "battChargeFromPV", "batteryChargeFromPV");
  const chGridArr = pick("battChargeFromGridKWh", "battChargeFromGrid", "batteryChargeFromGrid");

  const disLoadArr = pick("battDischargeToLoadKWh", "battDischargeToLoad", "batteryDischargeToLoad");
  const disExpArr = pick("battDischargeToExportKWh", "battDischargeToExport", "batteryDischargeToExport");

  const directArr = pick("directPVToLoadKWh", "directPVToLoad");

  return {
    hours,

    // Standardised names returned to the frontend
    pv: slice(pvArr),
    load: slice(loadArr),
    soc: slice(socArr),

    importKWh: slice(importArr),
    exportKWh: slice(exportArr),

    battChargeFromPVKWh: slice(chPVArr),
    battChargeFromGridKWh: slice(chGridArr),

    battDischargeToLoadKWh: slice(disLoadArr),
    battDischargeToExportKWh: slice(disExpArr),

    directPVToLoadKWh: slice(directArr),
  };
}

module.exports = {
  extractDaySlice,
};