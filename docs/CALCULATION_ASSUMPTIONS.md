# Zeyzer Solar — Calculation Assumptions

## Current version

Calculation version: `1.1.0-beta`  
Assumptions version: `2026-beta-2`  
Tariff model version: `1.0.0-beta`  
Battery model version: `1.1.0-beta`
Hardware catalogue version: `2026-beta-1` 

## Purpose

This document explains the current assumptions used by the beta quote calculator.

The quote tool provides an indicative estimate only. It is not a final quotation, MCS performance estimate, financial advice, or guarantee of savings.

## Solar generation

The calculator uses PVGIS generation data where available.

For the main hourly model, the calculator attempts to use hourly PVGIS data for:

- 2021
- 2022
- 2023

The annual generation result is based on a 3-year average where the hourly data is successfully fetched.

If hourly PVGIS data cannot be fetched, the calculator may fall back to a simpler annual estimate.

## Roof inputs

The current beta roof model uses:

- orientation
- tilt
- shading level
- number of panels
- multiple roof spaces where entered

Panel count is currently entered by the user rather than calculated from roof dimensions.

## Consumption profile

The calculator currently estimates household electricity usage from:

- annual kWh input, or
- monthly bill estimate, or
- default annual consumption where needed

The hourly load profile is estimated from the selected occupancy profile.

Current occupancy profiles include:

- home all day
- home half day
- out all day

Smart meter CSV upload is not yet included.

## Tariffs

The calculator supports tariff-before and tariff-after objects.

The current tariff model supports:

- standard flat import rate
- cheap overnight / EV-style import rate
- Flux-style import/export periods

Current tariff windows are hour-based. Half-hour tariff slots are not yet implemented.

## Centralised tariff model assumptions

Current beta tariff assumptions are stored in:

'''txt
backend/config/tariffPresets.js
backend/services/tariffService.js

## Tariff warnings and notices

Quote responses include a `tariffWarnings` object.

This is used to explain important beta tariff limitations, including:

- current tariff modelling is hourly, not half-hourly
- tariff presets are assumptions, not guaranteed live supplier tariffs
- grid charging depends on real tariff and hardware compatibility
- battery export depends on tariff, product and installer configuration

These notices are intended to be shown on the quote page and PDF so users understand the limits of the current tariff model.

## Battery model

The calculator runs an hourly battery dispatch model where hourly PV/load data is available.

The current beta model considers:

- direct PV to home
- PV charging battery
- battery discharging to home
- import from grid
- export to grid
- optional grid charging settings
- optional battery export / energy trading settings

The current beta recommendation model is still abstract. It does not yet fully model real product constraints such as:

- nominal vs usable capacity by product
- charge/discharge power limits by product
- product-specific round-trip efficiency
- degradation by product
- warranty/cycle limits

## Centralised battery model assumptions

Current beta battery assumptions are stored in:

'''txt
backend/config/quoteConfig.js
backend/config/batteryModelConfig.js

## Battery degradation

Battery recommendation lifetime values now include a simple battery degradation assumption.

Current beta assumptions:

- battery degradation rate: `2%` per year
- minimum usable capacity floor: `70%`

This means the model assumes the battery-related part of the benefit reduces gradually over time, but does not fall below 70% of the original battery contribution.

This is an abstract beta assumption. It is not yet tied to a specific battery product warranty, chemistry, cycle life or manufacturer datasheet. Product-specific degradation should be added later through the hardware database.

## Hardware catalogue

The beta quote tool now includes a local hardware catalogue structure.

Current files:

'''txt
backend/data/hardware/batteries.json
backend/data/hardware/panels.json
backend/data/hardware/inverters.json
backend/services/hardwareCatalogService.js

## Financial model

The financial model estimates:

- baseline electricity bill
- bill after solar/battery
- bill savings
- export income
- total annual benefit
- cumulative savings
- estimated payback
- lifetime net savings

Energy inflation may be included depending on tariff/settings.

The financial output is indicative only.

## Known limitations

Current beta limitations:

- no smart meter data upload
- no hardware product database
- no roof dimension or obstacle model
- no real inverter/battery compatibility checking
- no half-hour tariff engine
- no DNO/export-limit design engine
- no formal MCS estimate output

## Next planned improvements

Planned calculation improvements:

1. Stronger regression tests
2. Real battery sizes
3. Nominal vs usable battery capacity
4. Battery charge/discharge limits
5. Product efficiency assumptions
6. Half-hour tariff windows
7. Hardware catalogue
8. Smart meter CSV upload
9. Roof dimension and panel count estimator