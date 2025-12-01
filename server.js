// backend/server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4000;

// ====== LEADS STORAGE SETUP ======
const LEADS_FILE = path.join(__dirname, "leads.json");

function readLeads() {
  try {
    if (!fs.existsSync(LEADS_FILE)) {
      // If file doesn't exist yet, start with empty array
      return [];
    }
    const data = fs.readFileSync(LEADS_FILE, "utf8");
    if (!data.trim()) {
      return [];
    }
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading leads file:", err);
    return [];
  }
}

function saveLeads(leads) {
  try {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    console.log(`Saved leads to ${LEADS_FILE}. Total leads: ${leads.length}`);
  } catch (err) {
    console.error("Error writing leads file:", err);
  }
}

// ====== EXPRESS SETUP ======
app.use(express.json());
app.use(cors());

// ====== QUOTE CONFIG & LOGIC ======
const CONFIG = {
  baseCostPerKwp: 1700,
  batteryCostPerKwh: 950,
  scaffoldingFlat: 1000,
  priceRangeFactor: 0.12,
  assumedPricePerKWh: 0.28,
  irradianceFactor: 0.85,
  roofKwpCaps: {
    small: 2.5,
    medium: 4.0,
    large: 6.5,
  },
  panelOptions: {
    value: { watt: 420, multiplier: 1.0 },
    premium: { watt: 450, multiplier: 1.12 },
  },
  regionalMultipliers: {
    default: 1.0,
    london: 1.1,
    scotland: 0.95,
  },
};

function calculateQuote(input) {
  const cfg = CONFIG;

  // 1. Estimate annual kWh if missing
  let annualKWh = input.annualKWh;
  if (!annualKWh && input.monthlyBill) {
    const annualBill = input.monthlyBill * 12;
    annualKWh = annualBill / cfg.assumedPricePerKWh;
  }
  if (!annualKWh) {
    annualKWh = 3000; // default guess
  }

  // 2. Target kWp from usage
  let requiredKwp = annualKWh / (cfg.irradianceFactor * 1000);

  // 3. Apply roof size cap
  const roofCap = cfg.roofKwpCaps[input.roofSize] || cfg.roofKwpCaps.medium;
  requiredKwp = Math.min(Math.max(requiredKwp, 2), roofCap);

  // 4. Adjust for heavy shading
  if (input.shading === "a_lot") {
    requiredKwp *= 0.85;
  }

  // 5. Convert to panel count
  const panelOpt = cfg.panelOptions[input.panelOption] || cfg.panelOptions.value;
  const panelKwp = panelOpt.watt / 1000;
  let panelCount = Math.round(requiredKwp / panelKwp);
  if (panelCount < 6) panelCount = 6;
  const systemSizeKwp = panelCount * panelKwp;

  // 6. Base system cost
  const regionMult =
    cfg.regionalMultipliers[input.postcodeRegion] ||
    cfg.regionalMultipliers.default;

  const baseSystemCost =
    systemSizeKwp * cfg.baseCostPerKwp * panelOpt.multiplier * regionMult;

  // 7. Components
  const panelsCost = baseSystemCost * 0.5;
  const inverterCost = baseSystemCost * 0.15;
  const scaffoldingCost = cfg.scaffoldingFlat * regionMult;

  const batteryKWh = input.batteryKWh || 0;
  const batteryCost =
    batteryKWh > 0 ? batteryKWh * cfg.batteryCostPerKwh * regionMult : 0;

  let extrasCost = 0;
  if (input.extras?.birdProtection) extrasCost += 350 * regionMult;
  if (input.extras?.evCharger) extrasCost += 900 * regionMult;

  const directCosts =
    panelsCost + inverterCost + scaffoldingCost + batteryCost + extrasCost;
  const labourAndMargin = directCosts * 0.3;

  const total = directCosts + labourAndMargin;

  // 8. Price range
  const priceLow = Math.round(total * (1 - cfg.priceRangeFactor));
  const priceHigh = Math.round(total * (1 + cfg.priceRangeFactor));

  // 9. Estimated generation
  const estAnnualGenerationKWh = Math.round(
    systemSizeKwp * cfg.irradianceFactor * 1000
  );

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
  };
}

// ====== ROUTES ======
app.get("/", (req, res) => {
  res.send("Solar quote API is running");
});

app.post("/api/quote", (req, res) => {
  try {
    const input = req.body || {};
    console.log("Received quote request with input:", input);

    const quote = calculateQuote(input);

    const { name, email, address, phone } = input;

    // Read, append, save leads
    const leads = readLeads();
    leads.push({
      createdAt: new Date().toISOString(),
      contact: { name, email, address, phone },
      inputs: input,
      quote: quote,
    });
    saveLeads(leads);

    res.json(quote);
  } catch (err) {
    console.error("Error in /api/quote:", err);
    res
      .status(500)
      .json({ error: "Something went wrong calculating and saving the quote." });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Leads will be stored in: ${LEADS_FILE}`);
});
