const { CONFIG } = require("../config/quoteConfig");
const { getPostcodeArea } = require("../utils/postcodeUtils");

// ===== Region table (unchanged) =====
const REGION_TABLE = [
  { key: "scotland", areas: ["AB", "DD", "FK", "IV", "KW", "KY", "PH", "HS", "ZE"], kWhPerKwp: 875 },
  { key: "north", areas: ["DG", "EH", "G", "KA", "ML", "TD", "NE", "DH", "SR", "TS"], kWhPerKwp: 925 },
  { key: "north_midlands", areas: ["LA", "CA", "DL", "YO", "BB", "BD", "HD", "HG", "HU", "LS", "WF"], kWhPerKwp: 950 },
  { key: "midlands", areas: ["L", "M", "PR", "WN", "BL", "OL", "SK", "CW", "CH", "WA", "SY", "ST", "DE", "NG", "LE", "NN", "CV", "B"], kWhPerKwp: 975 },
  { key: "wales_south_central", areas: ["CF", "NP", "SA", "LD", "HR", "GL", "OX", "SN", "RG"], kWhPerKwp: 1025 },
  { key: "south_west", areas: ["BA", "BS", "TA", "DT", "BH", "SP", "SO", "PO"], kWhPerKwp: 1050 },
  { key: "devon_cornwall", areas: ["EX", "TQ", "TR", "PL"], kWhPerKwp: 1100 },
  { key: "south_east", areas: ["GU", "KT", "SM", "CR", "RH", "BN", "ME", "TN", "BR", "DA"], kWhPerKwp: 1075 },
  { key: "london", areas: ["SW", "SE", "W", "NW", "N", "E", "EC", "WC", "HA", "UB", "TW"], kWhPerKwp: 1050 },
];

function getRegionInfoForPostcode(postcode) {
  const area = getPostcodeArea(postcode);
  if (!area) return { key: "default", kWhPerKwp: 975 };

  const upperArea = area.toUpperCase();
  for (const region of REGION_TABLE) {
    if (region.areas.includes(upperArea)) {
      return { key: region.key, kWhPerKwp: region.kWhPerKwp };
    }
  }
  return { key: "default", kWhPerKwp: 975 };
}

function getShadingFactor(shading) {
  switch (shading) {
    case "none": return 1.0;
    case "some": return 0.9;
    case "a_lot": return 0.8;
    default: return 0.95;
  }
}

function calculateQuote(input, opts = {}) {
  const cfg = CONFIG;

  // ✅ Normalize panelOption (supports legacy PanelOption if ever sent)
  const normalizedPanelOption = input.panelOption || input.PanelOption || "value";
  input.panelOption = normalizedPanelOption;

  const panelOpt = cfg.panelOptions[input.panelOption] || cfg.panelOptions.value;
  const panelKwp = panelOpt.watt / 1000;

  // ✅ Declare panelCount BEFORE using it
  let panelCount;

  // If roofs provided, override panelCount to match roof inputs (unless panelCount already supplied)
  if (!input.panelCount || Number(input.panelCount) <= 0) {
    if (Array.isArray(input.roofs) && input.roofs.length > 0) {
      const totalPanelsFromRoofs = input.roofs.reduce((sum, r) => sum + Number(r?.panels || 0), 0);
      if (totalPanelsFromRoofs > 0) {
        panelCount = totalPanelsFromRoofs;
      }
    }
  }

  // 1) Estimate annual kWh if missing
  let annualKWh = input.annualKWh;
  if (!annualKWh && input.monthlyBill) {
    const annualBill = input.monthlyBill * 12;
    annualKWh = annualBill / cfg.assumedPricePerKWh;
  }
  if (!annualKWh) annualKWh = 3000;

  // 2) If user provided panelCount explicitly, use that
  if (!panelCount && input.panelCount && Number(input.panelCount) > 0) {
    panelCount = Number(input.panelCount);
    if (!opts?.silent) {
      console.log("Using manual panel count:", panelCount);
    }
  }

  // 3) Otherwise auto-size
  if (!panelCount) {
    const sizingKwhPerKwp = 1000;
    let requiredKwp = annualKWh / sizingKwhPerKwp;

    const roofCap = cfg.roofKwpCaps[input.roofSize] || cfg.roofKwpCaps.medium;
    requiredKwp = Math.min(Math.max(requiredKwp, 2), roofCap);

    if (input.shading === "a_lot") requiredKwp *= 0.9;

    panelCount = Math.round(requiredKwp / panelKwp);
    if (panelCount < 6) panelCount = 6;
    console.log("Using automatic panel count:", panelCount);
  }

  const systemSizeKwp = panelCount * panelKwp;

  const regionInfo = getRegionInfoForPostcode(input.postcode);
  const regionKey = regionInfo.key || "default";
  const regionMult = cfg.regionalMultipliers[regionKey] || cfg.regionalMultipliers.default;

  const baseSystemCost = systemSizeKwp * cfg.baseCostPerKwp * panelOpt.multiplier * regionMult;

  const panelsCost = baseSystemCost * 0.65;
  const inverterCost = baseSystemCost * 0.23;
  // ===============================
  // Scaffolding cost based on roof count
  // ===============================
  const roofCount =
    Array.isArray(input.roofs) && input.roofs.length > 0
      ? input.roofs.length
      : 1;

  let scaffoldingCost =
    cfg.scaffolding.firstRoof +
    Math.max(roofCount - 1, 0) * cfg.scaffolding.additionalRoof;

  // Apply regional multiplier
  scaffoldingCost *= regionMult;


  const batteryKWh = input.batteryKWh || 0;
  const batteryCost = batteryKWh > 0 ? batteryKWh * cfg.batteryCostPerKwh * regionMult : 0;

  let extrasCost = 0;
  if (input.extras?.birdProtection) extrasCost += 350 * regionMult;
  if (input.extras?.evCharger) extrasCost += 900 * regionMult;

  const directCosts = panelsCost + inverterCost + scaffoldingCost + batteryCost + extrasCost;
  const labourAndMargin = directCosts * 0.18;
  const total = directCosts + labourAndMargin;

  const priceLow = Math.round(total * (1 - cfg.priceRangeFactor));
  const priceHigh = Math.round(total * (1 + cfg.priceRangeFactor));

  const shadingFactor = getShadingFactor(input.shading);
  const fallbackAnnual = Math.round(systemSizeKwp * cfg.irradianceFactor * 1000);

  const estAnnualGenerationKWh =
    typeof opts.annualGenerationOverrideKWh === "number"
      ? opts.annualGenerationOverrideKWh
      : fallbackAnnual;

  return {
    systemSizeKwp: Number(systemSizeKwp.toFixed(2)),
    panelCount,
    panelWatt: panelOpt.watt,
    priceLow,
    priceHigh,
    breakdown: {
      panels: Math.round(panelsCost),
      inverter: Math.round(inverterCost),
      battery: Math.round(batteryCost),
      scaffolding: Math.round(scaffoldingCost),
      extras: Math.round(extrasCost),
      labourAndMargin: Math.round(labourAndMargin),
    },
    estAnnualGenerationKWh,
    kWhPerKwpRegion: regionInfo.kWhPerKwp,
    shadingFactor,
    assumedAnnualConsumptionKWh: Math.round(annualKWh),
  };
}

module.exports = {
  REGION_TABLE,
  getRegionInfoForPostcode,
  getShadingFactor,
  calculateQuote,
};