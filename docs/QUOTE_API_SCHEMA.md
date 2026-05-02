# Quote API Schema

This document describes the main data structures used by the Zeyzer Solar quote backend.

It is intended as a practical development reference, not a formal OpenAPI specification.

---

## Endpoints

### POST `/api/quote`

Generates a new quote from customer, roof, usage, tariff and battery inputs.

### POST `/api/quote/recalc`

Recalculates an existing quote using an existing hourly model and updated tariff/battery assumptions.

### POST `/api/quote/pdf`

Generates a PDF from an existing quote object.

### GET `/api/quote/pdf-data`

Temporary route used by the frontend PDF page while Puppeteer renders the PDF.

### POST `/api/lead/email-quote`

Emails a quote PDF to the customer.

### POST `/api/lead/request-call`

Captures a request-call lead and emails/syncs the quote information.

---

# POST `/api/quote` input

Example:

```json
{
  "name": "Test Customer",
  "email": "test@example.com",
  "phone": "07123456789",
  "homeOwnership": "owner",
  "houseNumber": "10",
  "postcode": "SW1A 1AA",

  "annualKWh": 3500,
  "monthlyBill": 100,
  "roofSize": "medium",
  "shading": "none",
  "occupancyProfile": "half_day",

  "panelOption": "value",
  "batteryKWh": 5,
  "birdProtection": false,
  "evCharger": false,

  "roofs": [
    {
      "id": "roof-1",
      "orientation": "S",
      "tilt": 40,
      "shading": "none",
      "roofSize": "medium",
      "panels": 10
    }
  ],

  "tariffBefore": {
    "tariffType": "standard",
    "importPrice": 0.28,
    "standingChargePerDay": 0.6
  },

  "tariffAfter": {
    "tariffType": "standard",
    "importPrice": 0.28,
    "standingChargePerDay": 0.6,
    "segPrice": 0.12,
    "exportFromBatteryEnabled": true
  }
}
```

---

# Main input fields

| Field | Type | Notes |
|---|---:|---|
| `name` | string | Customer name |
| `email` | string | Customer email |
| `phone` | string | Customer phone |
| `homeOwnership` | string | Usually `"owner"` |
| `houseNumber` | string | Used with postcode |
| `postcode` | string | UK postcode |
| `annualKWh` | number | Annual electricity usage |
| `monthlyBill` | number | Optional bill estimate |
| `roofSize` | string | Legacy fallback: `"small"`, `"medium"`, `"large"` |
| `shading` | string | Legacy fallback: `"none"`, `"some"`, `"a_lot"` |
| `occupancyProfile` | string | `"home_all_day"`, `"half_day"`, `"out_all_day"` |
| `panelOption` | string | `"value"` or `"premium"` |
| `batteryKWh` | number | Selected usable battery size |
| `birdProtection` | boolean | Optional extra |
| `evCharger` | boolean | Optional extra |
| `roofs` | Roof[] | Preferred roof input |
| `tariffBefore` | Tariff | Before-solar tariff |
| `tariffAfter` | Tariff | After-solar tariff |

---

# Roof object

```json
{
  "id": "roof-1",
  "orientation": "S",
  "tilt": 40,
  "shading": "none",
  "roofSize": "medium",
  "panels": 10
}
```

| Field | Type | Notes |
|---|---:|---|
| `id` | string | Frontend/local identifier |
| `orientation` | string | `"N"`, `"NE"`, `"E"`, `"SE"`, `"S"`, `"SW"`, `"W"`, `"NW"` |
| `tilt` | number | Roof tilt in degrees |
| `shading` | string | `"none"`, `"some"`, `"a_lot"` |
| `roofSize` | string | Legacy size preset |
| `panels` | number | Manual panel count |

---

# Tariff object

## Standard tariff

```json
{
  "tariffType": "standard",
  "importPrice": 0.28,
  "standingChargePerDay": 0.6,
  "segPrice": 0.12,
  "exportFromBatteryEnabled": true
}
```

## Overnight tariff

```json
{
  "tariffType": "overnight",
  "importNight": 0.08,
  "importDay": 0.28,
  "importPrice": 0.28,
  "standingChargePerDay": 0.6,
  "segPrice": 0.12,
  "nightStartHour": 0,
  "nightEndHour": 7,
  "exportFromBatteryEnabled": true
}
```

## Flux-style tariff

```json
{
  "tariffType": "flux",
  "importPrice": 0.28,
  "standingChargePerDay": 0.6,
  "segPrice": 0.12,

  "importOffPeak": 0.17,
  "importPeak": 0.4,
  "exportOffPeak": 0.04,
  "exportPeak": 0.3,

  "offPeakStartHour": 2,
  "offPeakEndHour": 5,
  "peakStartHour": 16,
  "peakEndHour": 19,

  "exportFromBatteryEnabled": true,
  "allowGridCharging": true,
  "allowEnergyTrading": false
}
```

## Tariff field notes

| Field | Type | Notes |
|---|---:|---|
| `tariffType` | string | `"standard"`, `"overnight"`, `"flux"` |
| `importPrice` | number | Flat/day import price in £/kWh |
| `standingChargePerDay` | number | Standing charge in £/day |
| `segPrice` | number | Flat/day export rate in £/kWh |
| `importNight` | number | Overnight import rate |
| `importDay` | number | Day import rate |
| `nightStartHour` | number | Start hour, 0-23 |
| `nightEndHour` | number | End hour, 0-23 |
| `importOffPeak` | number | Flux/off-peak import rate |
| `importPeak` | number | Flux/peak import rate |
| `exportOffPeak` | number | Flux/off-peak export rate |
| `exportPeak` | number | Flux/peak export rate |
| `offPeakStartHour` | number | Start hour, 0-23 |
| `offPeakEndHour` | number | End hour, 0-23 |
| `peakStartHour` | number | Start hour, 0-23 |
| `peakEndHour` | number | End hour, 0-23 |
| `exportFromBatteryEnabled` | boolean | Whether battery export is allowed in modelling |
| `allowGridCharging` | boolean | Whether battery may charge from grid |
| `allowEnergyTrading` | boolean | Reserved/future behaviour |

---

# POST `/api/quote` output

A successful quote returns a quote object.

Important top-level fields:

```json
{
  "systemSizeKwp": 4.3,
  "panelCount": 10,
  "panelWatt": 430,
  "estAnnualGenerationKWh": 4221,

  "priceLow": 5200,
  "priceHigh": 6500,

  "annualBillSavings": 751,
  "annualSegIncome": 184,
  "totalAnnualBenefit": 935,
  "simplePaybackYears": 6.5,

  "selfConsumptionModel": "hourly",

  "hourlyModel": {},
  "financialSeries": {},
  "batteryRecommendations": {}
}
```

---

# `hourlyModel`

The hourly model summarises PVGIS generation, load, import, export and battery behaviour.

```json
{
  "model": "hourly_pvgis_3yr_avg_2021_2023",
  "years": [2021, 2022, 2023],

  "monthlyGenerationKWh": [181.92, 245.02],
  "monthlySelfUsedKWh": [157.89, 192.05],
  "monthlyExportedKWh": [11.86, 41.3],
  "monthlyImportedKWh": [169.65, 95.32],

  "monthlyBatteryChargeKWh": [101.82, 120.34],
  "monthlyBatteryDischargeKWh": [90.2, 110.1],

  "monthlyDirectToHomeKWh": [56.07, 71.71],
  "monthlyLoadKWh": [329.53, 287],

  "annualGenerationKWh": 4221,
  "annualSelfUsedKWh": 2300,
  "annualExportedKWh": 1800,
  "annualImportedKWh": 1300
}
```

Expected monthly arrays should contain 12 values.

The backend may also attach hidden recalculation arrays under `hourlyModel`:

```txt
_pvHourlyKWh
_loadHourlyKWh
_monthIdx
_hourOfDay
_batteryKWh
```

These allow `/api/quote/recalc` to recalculate tariffs and batteries without calling PVGIS again.

---

# `financialSeries.monthly`

The monthly financial object should support both current and legacy names.

```json
{
  "monthlyBaseline": [119.5],
  "monthlyAfterImportAndStanding": [61.2],
  "monthlyExportCredit": [5.1],
  "monthlyAfterNet": [56.1],

  "baselineMonthlyCost": [119.5],
  "systemMonthlyCostBeforeSEG": [61.2],
  "exportCreditMonthly": [5.1],
  "systemMonthlyNet": [56.1],

  "annualBaseline": 1198.45,
  "annualAfterImportAndStanding": 631.4,
  "annualExportCredit": 184.0,
  "annualAfterNet": 447.4,

  "annualSystemBeforeSEG": 631.4,
  "annualSystemNet": 447.4,
  "annualSystem": 447.4
}
```

Expected monthly arrays should contain 12 values.

---

# `financialSeries.payback`

```json
{
  "labels": ["0", "1", "2"],
  "cumulativeSavings": [0, 751.05, 1547.16],
  "systemCostMid": 6525,
  "paybackYear": 6.5,
  "paybackYearIndex": 7,
  "lifetimeSavings": 25000,

  "yearly": [
    {
      "year": 1,
      "solarGenerationKWh": 4221,
      "billBefore": 1198.45,
      "billAfter": 447.4,
      "billSavings": 751.05,
      "cumulativeSavings": 751.05,
      "netPosition": -5774.45
    }
  ]
}
```

Expected `yearly` array length: 25.

---

# `batteryRecommendations`

```json
{
  "bestPayback": {
    "batteryKWhUsable": 3,
    "annualBenefit": 841,
    "paybackYears": 6,
    "annualSelfUsedKWh": 2169,
    "annualExportedKWh": 1946,
    "annualImportedKWh": 1329,
    "candidateMidPrice": 5799,
    "lifetimeYears": 25,
    "lifetimeGrossBenefit": 43216,
    "lifetimeNetSavings": 37417
  },

  "bestLifetimeSavings": {
    "batteryKWhUsable": 5,
    "annualBenefit": 900,
    "paybackYears": 6.7,
    "lifetimeNetSavings": 39000
  },

  "curve": [],

  "assumptions": {
    "batteryCostPerKWh": 280,
    "minRecommendedBatteryKWh": 3,
    "maxBatteryKWh": 39,
    "stepKWh": 1,
    "lifetimeYears": 25
  }
}
```

---

# POST `/api/quote/recalc` input

Recalc expects:

```json
{
  "quote": {},
  "input": {
    "batteryKWh": 5,
    "tariffBefore": {},
    "tariffAfter": {}
  }
}
```

The existing `quote` should include:

```txt
hourlyModel._pvHourlyKWh
hourlyModel._loadHourlyKWh
hourlyModel._monthIdx
hourlyModel._hourOfDay
```

These hidden arrays allow recalculation without calling PVGIS again.

---

# POST `/api/quote/recalc` output

Returns an updated quote object with the same broad shape as `/api/quote`.

The recalculated quote should preserve:

```txt
systemSizeKwp
panelCount
panelWatt
estAnnualGenerationKWh
hourlyModel
financialSeries
batteryRecommendations
```

and update tariff/battery-dependent values such as:

```txt
annualBillSavings
annualSegIncome
totalAnnualBenefit
simplePaybackYears
financialSeries.monthly
financialSeries.payback
batteryRecommendations
```

---

# PDF flow

Current PDF flow:

1. Frontend posts quote/form/roof data to `POST /api/quote/pdf`.
2. Backend stores the latest PDF quote data temporarily in memory.
3. Backend opens the frontend PDF route with Puppeteer.
4. Frontend PDF page calls `GET /api/quote/pdf-data`.
5. Frontend renders the PDF quote page.
6. Backend waits for `#pdf-ready`.
7. Backend prints the page to PDF.

Important note:

The current PDF flow uses temporary in-memory “latest quote” data. This is acceptable for local/MVP use, but should eventually be replaced with ID-based PDF quote data to avoid multi-user collision risk.

---

# Development rules

## After backend calculation changes

Run:

```bash
npm run smoke
npm run regression
```

## After frontend quote/PDF changes

Test manually:

```txt
Generate quote
Recalculate quote
Open monthly savings breakdown
Open financial calculation details
Download PDF
Email quote
Request call
```

## Quote output compatibility

When changing backend output shape, preserve aliases used by the frontend where practical.

Important monthly aliases:

```txt
monthlyBaseline
monthlyAfterImportAndStanding
monthlyExportCredit
monthlyAfterNet

baselineMonthlyCost
systemMonthlyCostBeforeSEG
exportCreditMonthly
systemMonthlyNet
monthlyAfter
```

## Route ownership

```txt
server.js = app setup and route mounting
routes/ = API endpoint handlers
services/ = calculation, PDF, Brevo, PVGIS, tariff, battery, financial logic
utils/ = generic helpers
config/ = quote configuration
docs/ = reference documents
```

## Current expected backend checks

A healthy `/api/quote` response should usually have:

```txt
selfConsumptionModel: "hourly"
hourlyModel attached
batteryRecommendations attached
financialSeries.monthly attached
financialSeries.payback.yearly length = 25
```

If the backend silently falls back to MCS mode during normal regression scenarios, treat that as a failure unless the test explicitly expects fallback mode.

---

# Future improvement notes

## Tariff defaults

Frontend and backend tariff defaults must stay aligned.

If Flux-style defaults change, update:

```txt
backend/services/tariffService.js
frontend/src/App.js DEFAULT_TARIFF
frontend tariff modal labels
backend regression tests
```

## Battery recommendations

Current recommendations may use theoretical 1 kWh increments.

Future improvement:

```txt
Move from arbitrary 1 kWh increments to real product sizes.
```

Example future battery capacities:

```txt
0 kWh
3.2 kWh
5.2 kWh
7.8 kWh
9.5 kWh
10.4 kWh
13.5 kWh
15.6 kWh
```

## Smart meter data

Future smart-meter input should eventually feed into the same hourly simulation pipeline by replacing the estimated `_loadHourlyKWh` profile with validated half-hourly/hourly real usage data.