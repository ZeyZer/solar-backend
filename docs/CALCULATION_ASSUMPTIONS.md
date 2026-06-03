# Zeyzer Solar — Calculation Assumptions

## Current version

Calculation version: `1.0.0-beta`  
Assumptions version: `2026-beta-1`  
Tariff model version: `1.0.0-beta`  
Battery model version: `1.0.0-beta`

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