// backend/server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const app = express();
const PORT = process.env.PORT || 4000;

// ====== LEADS STORAGE SETUP ======
const LEADS_FILE = path.join(__dirname, "leads.json");

function readLeads() {
  try {
    if (!fs.existsSync(LEADS_FILE)) {
      console.log("leads.json does not exist yet, starting with empty array.");
      return [];
    }
    const data = fs.readFileSync(LEADS_FILE, "utf8");
    if (!data.trim()) {
      console.log("leads.json is empty, starting with empty array.");
      return [];
    }
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading leads file:", err.message);
    return [];
  }
}

function saveLeads(leads) {
  try {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    console.log(`Saved leads to ${LEADS_FILE}. Total leads: ${leads.length}`);
  } catch (err) {
    console.error("Error writing leads file:", err.message);
  }
}

// ====== BREVO SETUP ======
const brevoClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = brevoClient.authentications["api-key"];
apiKey.apiKey = process.env.BREVO_API_KEY || "";

const brevoContactsApi = new SibApiV3Sdk.ContactsApi();
const brevoEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

const BREVO_TEMPLATE_ID = process.env.BREVO_TEMPLATE_ID
  ? Number(process.env.BREVO_TEMPLATE_ID)
  : undefined;

const BREVO_LIST_ID = process.env.BREVO_LIST_ID
  ? Number(process.env.BREVO_LIST_ID)
  : undefined;

async function syncLeadToBrevo(contact, quote, input) {
  try {
    if (!process.env.BREVO_API_KEY) {
      console.log("No BREVO_API_KEY set, skipping Brevo sync.");
      return;
    }
    if (!contact.email) {
      console.log("No email on contact, skipping Brevo sync.");
      return;
    }

    // 1) Create or update contact
    const createContact = new SibApiV3Sdk.CreateContact();
    createContact.email = contact.email;
    createContact.attributes = {
      FIRSTNAME: contact.name || "",
      ADDRESS: contact.address || "",
      PHONE: contact.phone || "",
    };

    if (BREVO_LIST_ID) {
      createContact.listIds = [BREVO_LIST_ID];
    }

    try {
      await brevoContactsApi.createContact(createContact);
      console.log("Brevo contact created:", contact.email);
    } catch (err) {
      if (
        err.response &&
        err.response.body &&
        err.response.body.code === "duplicate_parameter"
      ) {
        const updateContact = new SibApiV3Sdk.UpdateContact();
        updateContact.attributes = createContact.attributes;
        await brevoContactsApi.updateContact(contact.email, updateContact);
        console.log("Brevo contact updated:", contact.email);
      } else {
        console.error("Error creating/updating Brevo contact:", err.message);
      }
    }

    // 2) Send transactional email with quote
    if (!BREVO_TEMPLATE_ID) {
      console.log("No BREVO_TEMPLATE_ID set, skipping Brevo email send.");
      return;
    }

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.to = [
      {
        email: contact.email,
        name: contact.name || "",
      },
    ];
    sendSmtpEmail.templateId = BREVO_TEMPLATE_ID;
    sendSmtpEmail.params = {
      name: contact.name || "",
      address: contact.address || "",
      system_kwp: quote.systemSizeKwp,
      panel_count: quote.panelCount,
      panel_watt: quote.panelWatt,
      annual_kwh: quote.estAnnualGenerationKWh,
      price_low: quote.priceLow,
      price_high: quote.priceHigh,

      battery_kwh: input?.batteryKWh || 0,
      bird_protection: input?.extras?.birdProtection ? "Yes" : "No",
      ev_charger: input?.extras?.evCharger ? "Yes" : "No",

      annual_savings: quote.annualBillSavings || 0,
      seg_income: quote.annualSegIncome || 0,
      total_benefit: quote.totalAnnualBenefit || 0,
      payback_years: quote.simplePaybackYears || "",
    };


    await brevoEmailApi.sendTransacEmail(sendSmtpEmail);
    console.log("Brevo quote email sent to:", contact.email);
  } catch (err) {
    console.error("Error syncing lead to Brevo:", err.message);
  }
}

// ====== EXPRESS SETUP ======
app.use(express.json());
app.use(cors());

// ====== QUOTE CONFIG & LOGIC ======
const CONFIG = {
  baseCostPerKwp: 800,
  batteryCostPerKwh: 580,
  scaffoldingFlat: 800,
  priceRangeFactor: 0.10,
  assumedPricePerKWh: 0.28, // import price
  assumedSegPricePerKWh: 0.12, // export price
  irradianceFactor: 0.85,
  roofKwpCaps: {
    small: 2.5,
    medium: 4.0,
    large: 6.5,
  },
  panelOptions: {
    value: { watt: 430, multiplier: 1.0 },
    premium: { watt: 460, multiplier: 1.12 },
  },
  regionalMultipliers: {
    default: 1.0,
    london: 1.1,
    scotland: 0.95,
  },
};

function calculateQuote(input) {
  const cfg = CONFIG;

  // Work out panel option first (we need this for both auto and manual modes)
  const panelOpt = cfg.panelOptions[input.panelOption] || cfg.panelOptions.value;
  const panelKwp = panelOpt.watt / 1000;

  // 1. Estimate annual kWh if missing
  let annualKWh = input.annualKWh;
  if (!annualKWh && input.monthlyBill) {
    const annualBill = input.monthlyBill * 12;
    annualKWh = annualBill / cfg.assumedPricePerKWh;
  }
  if (!annualKWh) {
    annualKWh = 3000; // default guess
  }

  let panelCount;

  // 2. If user provided a manual panel count, use that
  if (input.panelCount && Number(input.panelCount) > 0) {
    panelCount = Number(input.panelCount);
    console.log("Using manual panel count:", panelCount);
  } else {
    // 3. Otherwise, use automatic sizing from usage and roof limits

    // Target kWp from usage
    let requiredKwp = annualKWh / (cfg.irradianceFactor * 1000);

    // Apply roof size cap
    const roofCap = cfg.roofKwpCaps[input.roofSize] || cfg.roofKwpCaps.medium;
    requiredKwp = Math.min(Math.max(requiredKwp, 2), roofCap);

    // Adjust for heavy shading
    if (input.shading === "a_lot") {
      requiredKwp *= 0.85;
    }

    // Convert to panel count
    panelCount = Math.round(requiredKwp / panelKwp);
    if (panelCount < 6) panelCount = 6;
    console.log("Using automatic panel count:", panelCount);
  }

  // 4. Derive system size from panel count
  const systemSizeKwp = panelCount * panelKwp;

  // 5. Base system cost
  const regionMult =
    cfg.regionalMultipliers[input.postcodeRegion] ||
    cfg.regionalMultipliers.default;

  const baseSystemCost =
    systemSizeKwp * cfg.baseCostPerKwp * panelOpt.multiplier * regionMult;

  // 6. Components
  const panelsCost = baseSystemCost * 0.5;
  const inverterCost = baseSystemCost * 0.18;
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

  // 7. Price range
  const priceLow = Math.round(total * (1 - cfg.priceRangeFactor));
  const priceHigh = Math.round(total * (1 + cfg.priceRangeFactor));

  // 8. Estimated generation
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
    assumedAnnualConsumptionKWh: Math.round(annualKWh),
  };
}


//==== Savings Calculator ====
function estimateSelfConsumptionAndSavings(input, quote) {
  const cfg = CONFIG;
  const gen = quote.estAnnualGenerationKWh;
  const demand =
    quote.assumedAnnualConsumptionKWh || input.annualKWh || gen || 0;

  if (!gen || !demand) {
    return {
      selfConsumptionFraction: 0,
      selfConsumptionKWh: 0,
      annualBillSavings: 0,
      simplePaybackYears: null,
    };
  }

  // Ratio of PV generation to demand, capped between 0.5 and 2 for stability
  let ratio = gen / demand;
  if (ratio < 0.5) ratio = 0.5;
  if (ratio > 2) ratio = 2;

  const occ = input.occupancyProfile || "half_day";

  // Helper to interpolate between two points
  function lerp(x, x1, y1, x2, y2) {
    if (x <= x1) return y1;
    if (x >= x2) return y2;
    return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  }

  // Base self-consumption (PV-only), very roughly inspired by MCS guidance
  // for different occupancy archetypes (not exact lookup tables).
  let baseAt05, baseAt10, baseAt20;

  switch (occ) {
    case "home_all_day":
      baseAt05 = 0.5; // 60% when PV < demand
      baseAt10 = 0.30; // 40% when PV ~ demand
      baseAt20 = 0.25; // 25% when PV >> demand
      break;
    case "out_all_day":
      baseAt05 = 0.24;
      baseAt10 = 0.18;
      baseAt20 = 0.12;
      break;
    default: // "half_day" or unknown
      baseAt05 = 0.40;
      baseAt10 = 0.25;
      baseAt20 = 0.15;
  }

  let baseSelf;
  if (ratio <= 1) {
    baseSelf = lerp(ratio, 0.5, baseAt05, 1.0, baseAt10);
  } else {
    baseSelf = lerp(ratio, 1.0, baseAt10, 2.0, baseAt20);
  }

  // Battery uplift – bigger uplift for "out all day", capped overall.
  const batteryKWh = input.batteryKWh || 0;

  let upliftPerKWh;
  switch (occ) {
    case "home_all_day":
      upliftPerKWh = 0.05; // 2% per kWh
      break;
    case "out_all_day":
      upliftPerKWh = 0.091; // 3.5% per kWh
      break;
    default: // half_day
      upliftPerKWh = 0.0675;
  }

  // Slight extra uplift when PV generation is high vs demand
  const ratioBoost =
    ratio <= 1 ? 0.5 + 0.5 * ratio : 0.5 + 0.5 * Math.min(ratio, 2) / 2;

  let batteryUplift = batteryKWh * upliftPerKWh * ratioBoost;

  // Cap uplift so things stay realistic
  if (batteryUplift > 0.75) batteryUplift = 0.75;

  let selfFraction = baseSelf + batteryUplift;

  // Cap total self-consumption between 0 and 95% of generation
  if (selfFraction > 0.95) selfFraction = 0.95;
  if (selfFraction < 0) selfFraction = 0;

  const selfKWh = Math.round(selfFraction * gen);

  // Use the same assumed price per kWh as elsewhere in your tool
  const exportKWh = Math.max(gen - selfKWh, 0);
  const importPrice = cfg.assumedPricePerKWh; // £/kWh
  const segPrice = cfg.assumedSegPricePerKWh;     // £/kWh
  const annualBillSavings = Math.round(selfKWh * importPrice);
  const annualSegIncome = Math.round(exportKWh * segPrice);

  const totalAnnualBenefit = annualBillSavings + annualSegIncome;

  const midPrice = (quote.priceLow + quote.priceHigh) / 2;
  const simplePaybackYears =
    totalAnnualBenefit > 0
      ? Number((midPrice / totalAnnualBenefit).toFixed(1))
      : null;


  return {
  selfConsumptionFraction: selfFraction,
  selfConsumptionKWh: selfKWh,
  annualBillSavings,       // bill reduction only
  annualSegIncome,         // SEG money
  totalAnnualBenefit,      // sum of the two
  simplePaybackYears,
  };
}


// ====== ROUTES ======
app.get("/", (req, res) => {
  res.send("Solar quote API is running");
});

app.post("/api/quote", async (req, res) => {
  try {
    const input = req.body || {};
    console.log("Received quote request with input:", input);

    const baseQuote = calculateQuote(input);
    const savings = estimateSelfConsumptionAndSavings(input, baseQuote);

    // Merge everything into one quote object
    const quote = { ...baseQuote, ...savings };

    const { name, email, address, phone } = input;

    // Save lead locally
    const leads = readLeads();
    leads.push({
      createdAt: new Date().toISOString(),
      contact: { name, email, address, phone },
      inputs: input,
      quote: quote,
    });
    saveLeads(leads);

    // Sync to Brevo (fire-and-forget)
    const contact = { name, email, address, phone };
    syncLeadToBrevo(contact, quote, input);

    res.json(quote);
  } catch (err) {
    console.error("Error in /api/quote:", err);
    res.status(500).json({
      error: "Something went wrong calculating and saving the quote.",
    });
  }
});


app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Leads will be stored in: ${LEADS_FILE}`);
});

