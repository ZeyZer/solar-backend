const QUOTE_ENGINE_VERSION = {
  calculation: "1.0.0-beta",
  assumptions: "2026-beta-1",
  tariffModel: "1.0.0-beta",
  batteryModel: "1.0.0-beta",
  pvgisModel: "pvgis-hourly-3yr-average-2021-2023",
  financialModel: "1.0.0-beta",
};

function attachQuoteEngineVersion(quote) {
  if (!quote || typeof quote !== "object") {
    return quote;
  }

  return {
    ...quote,

    calculationVersion: QUOTE_ENGINE_VERSION.calculation,
    assumptionsVersion: QUOTE_ENGINE_VERSION.assumptions,
    tariffModelVersion: QUOTE_ENGINE_VERSION.tariffModel,
    batteryModelVersion: QUOTE_ENGINE_VERSION.batteryModel,

    quoteEngineVersion: {
      ...QUOTE_ENGINE_VERSION,
    },
  };
}

module.exports = {
  QUOTE_ENGINE_VERSION,
  attachQuoteEngineVersion,
};