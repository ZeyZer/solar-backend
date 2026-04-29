const API_BASE = process.env.API_BASE || "http://localhost:4000";

const payload = {
  name: "Test Customer",
  email: "test@example.com",
  phone: "07123456789",

  homeOwnership: "owner",
  houseNumber: "10",
  postcode: "SW1A 1AA",

  annualKWh: 3500,
  monthlyBill: 100,
  roofSize: "medium",
  shading: "none",
  occupancyProfile: "half_day",

  panelOption: "value",
  batteryKWh: 5,
  birdProtection: false,
  evCharger: false,

  roofs: [
    {
      id: "test-roof-1",
      orientation: "S",
      tilt: 40,
      shading: "none",
      roofSize: "medium",
      panels: 10,
    },
  ],

  tariffBefore: {
    tariffType: "standard",
    importPrice: 0.28,
    standingChargePerDay: 0.6,
  },

  tariffAfter: {
    tariffType: "standard",
    importPrice: 0.28,
    standingChargePerDay: 0.6,
    segPrice: 0.12,
    exportFromBatteryEnabled: true,
  },
};

async function main() {
  console.log(`Testing quote API at ${API_BASE}/api/quote`);

  const res = await fetch(`${API_BASE}/api/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  if (!res.ok) {
    console.error("Quote API failed:");
    console.error(text);
    process.exit(1);
  }

  const quote = JSON.parse(text);

  const requiredFields = [
    "systemSizeKwp",
    "panelCount",
    "estAnnualGenerationKWh",
    "priceLow",
    "priceHigh",
    "totalAnnualBenefit",
    "simplePaybackYears",
  ];

  const missing = requiredFields.filter((field) => quote[field] === undefined || quote[field] === null);

  if (missing.length > 0) {
    console.error("Quote API returned a response, but these fields are missing:");
    console.error(missing);
    process.exit(1);
  }

  console.log("Quote API smoke test passed.");
  console.log({
    systemSizeKwp: quote.systemSizeKwp,
    panelCount: quote.panelCount,
    annualGeneration: quote.estAnnualGenerationKWh,
    priceLow: quote.priceLow,
    priceHigh: quote.priceHigh,
    totalAnnualBenefit: quote.totalAnnualBenefit,
    paybackYears: quote.simplePaybackYears,
  });
}

main().catch((err) => {
  console.error("Smoke test crashed:");
  console.error(err);
  process.exit(1);
});