# Zeyzer Solar — Regression Baseline

Baseline name: `2026-beta-1`  
Calculation version: `1.0.0-beta`  
Assumptions version: `2026-beta-1`  
Tariff model version: `1.0.0-beta`  
Battery model version: `1.0.0-beta`

## Purpose

This document records the current known-good outputs from the beta quote engine.

The regression tests now check expected ranges and scenario behaviour, but this document gives us a readable reference point before larger calculation upgrades.

If future model changes move these numbers significantly, the movement should be intentional and documented.

---

## Scenario 1 — Standard tariff, no battery

Inputs:

- Postcode: `SW1A 1AA`
- Annual consumption: `3,500 kWh`
- Roof: `10 panels`
- Orientation: `South`
- Tilt: `40°`
- Shading: `none`
- Battery: `0 kWh`
- Tariff: standard import/export

Known-good output:

```txt
systemSizeKwp: 4.3
panelCount: 10
annualGenerationKWh: 4221
annualBillSavings: 342.42
annualSegIncome: 359.71
totalAnnualBenefit: 702.13
paybackYears: around 6.7
selfConsumptionModel: hourly
```

Expected behaviour:

- Hourly PVGIS model should be used.
- Export should be relatively high because there is no battery.
- Bill saving alone is lower than total annual benefit.
- Total annual benefit should equal bill saving plus SEG/export income.

---

## Scenario 2 — Standard tariff, 5 kWh battery

Inputs:

- Postcode: `SW1A 1AA`
- Annual consumption: `3,500 kWh`
- Roof: `10 panels`
- Orientation: `South`
- Tilt: `40°`
- Shading: `none`
- Battery: `5 kWh`
- Tariff: standard import/export

Known-good output:

```txt
systemSizeKwp: 4.3
panelCount: 10
annualGenerationKWh: 4221
annualImportedKWh: 1042
annualExportedKWh: 1617
annualSelfUsedKWh: 2456
annualBatteryChargeKWh: 1621.56
annualBillSavings: 751.05
annualSegIncome: 165.13
totalAnnualBenefit: 916.18
paybackYears: around 6.2
selfConsumptionModel: hourly
bestPaybackBattery: 3 kWh
```

Expected behaviour:

- Battery should reduce annual grid import compared with no battery.
- Battery should reduce annual export compared with no battery.
- Battery should increase annual self-used solar compared with no battery.
- Total annual benefit should be higher than the no-battery case.

---

## Scenario 3 — Cheap overnight tariff, 5 kWh battery

Inputs:

- Postcode: `SW1A 1AA`
- Annual consumption: `3,500 kWh`
- Roof: `10 panels`
- Battery: `5 kWh`
- Tariff: cheap overnight / EV-style tariff

Known-good output:

```txt
annualGenerationKWh: 4221
totalAnnualBenefit: 1003.07
selfConsumptionModel: hourly
```

Expected behaviour:

- Total annual benefit should be near or above the standard 5 kWh battery case.
- Tariff-aware dispatch should affect savings.
- Battery recommendation should be present.

---

## Scenario 4 — Flux-style tariff, battery export enabled

Inputs:

- Postcode: `SW1A 1AA`
- Annual consumption: `3,500 kWh`
- Roof: `10 panels`
- Battery: `5 kWh`
- Tariff: Flux-style
- Battery export enabled
- Grid charging allowed

Known-good output:

```txt
annualGenerationKWh: 4221
totalAnnualBenefit: 991.16
selfConsumptionModel: hourly
```

Expected behaviour:

- Total annual benefit should be near or above the standard 5 kWh battery case.
- Export income should reflect the selected export assumptions.
- Battery recommendations should be present.

---

## Scenario 5 — East/west multi-roof system

Inputs:

- Postcode: `SW1A 1AA`
- Annual consumption: `4,500 kWh`
- Roof 1: `6 panels`, east-facing, `35°`
- Roof 2: `6 panels`, west-facing, `35°`
- Battery: `5 kWh`
- Tariff: standard

Known-good behaviour:

```txt
panelCount: 12
systemSizeKwp: 5.16
selfConsumptionModel: hourly
```

Expected behaviour:

- Multi-roof PVGIS simulation should work.
- Panel count should be 12.
- System size should be larger than the 10-panel standard scenario.
- Hourly model should be attached.

---

## Recalc behaviour baseline

The recalc test starts from the standard 5 kWh battery quote and changes the export rate.

Expected behaviour:

```txt
annualGenerationKWh should stay the same
systemSizeKwp should stay the same
panelCount should stay the same
annualSegIncome should increase if segPrice is increased
annualBillSavings + annualSegIncome should equal totalAnnualBenefit
```

Known-good preserved values:

```txt
annualGenerationKWh: 4221
systemSizeKwp: 4.3
panelCount: 10
```

---

## Current test commands

Run from the backend folder:

```bash
npm run smoke
npm run regression
npm run test:quote
```

---

## How to use this baseline

Before changing calculation logic:

1. Run `npm run test:quote`.
2. Compare major outputs with this document.
3. Make the code change.
4. Run `npm run test:quote` again.
5. If values move significantly, decide whether that movement is expected.
6. If expected, update this document and the regression ranges.
7. If unexpected, debug before committing.

---

## Notes

These values are not promises to customers. They are internal known-good beta model outputs.

The quote tool remains an estimate only. Final design, pricing and performance depend on survey, equipment selection, roof condition, grid connection and installer confirmation.