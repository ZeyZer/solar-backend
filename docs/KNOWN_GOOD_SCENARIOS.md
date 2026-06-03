# Zeyzer Solar — Known Good Quote Scenarios

These scenarios are used to sanity-check calculation behaviour during development.

The exact numbers may change as the calculation engine improves, but any major movement should be intentional and explained.

## Scenario 1 — Standard tariff, no battery

Inputs:

- Postcode: SW1A 1AA
- Annual consumption: 3,500 kWh
- Roof: 10 panels, south-facing, 40° tilt, no shading
- Battery: 0 kWh
- Tariff: standard
- Export: standard SEG

Expected behaviour:

- Hourly PVGIS model should be used where available
- Annual generation should be roughly around the expected PVGIS range
- Battery recommendation may still be generated
- Export should be higher than in battery cases
- Payback should be present

## Scenario 2 — Standard tariff, 5 kWh battery

Inputs:

- Postcode: SW1A 1AA
- Annual consumption: 3,500 kWh
- Roof: 10 panels, south-facing, 40° tilt, no shading
- Battery: 5 kWh
- Tariff: standard
- Export: standard SEG

Expected behaviour:

- Hourly model should be used where available
- Import should reduce compared with no-battery case
- Export should reduce compared with no-battery case
- Total annual benefit should increase compared with no-battery case
- Payback may be longer or shorter depending on battery cost assumptions

## Scenario 3 — Cheap overnight tariff, 5 kWh battery

Inputs:

- Postcode: SW1A 1AA
- Annual consumption: 3,500 kWh
- Roof: 10 panels, south-facing, 40° tilt, no shading
- Battery: 5 kWh
- Tariff: cheap overnight / EV-style

Expected behaviour:

- Hourly model should be used where available
- Tariff-aware battery dispatch should affect annual benefit
- Cheap import window should improve battery value if grid charging is allowed
- Payback should be present

## Scenario 4 — Flux-style tariff with battery export enabled

Inputs:

- Postcode: SW1A 1AA
- Annual consumption: 3,500 kWh
- Roof: 10 panels, south-facing, 40° tilt, no shading
- Battery: 5 kWh
- Tariff: Flux-style
- Battery export enabled

Expected behaviour:

- Hourly model should be used where available
- Export income should reflect time-of-use export assumptions
- Battery export behaviour should be visible in debug/model outputs where applicable

## Scenario 5 — East/west multi-roof system

Inputs:

- Postcode: SW1A 1AA
- Annual consumption: 3,500 kWh
- Roof 1: south-facing, 10 panels
- Roof 2: east-facing or west-facing, additional panels
- Battery: 5 kWh

Expected behaviour:

- Multi-roof PVGIS generation should work
- Hourly model should be attached
- Annual generation should increase compared with the 10-panel scenario
- Events and lead tracking should still use the same lead_id

## Current test commands

```bash
npm run smoke
npm run regression