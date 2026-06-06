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

## Design-ready hardware catalogue fields

The hardware catalogue now includes additional fields intended to support future design compatibility checks.

For panels, this includes:

- `Voc`
- `Vmp`
- `Isc`
- `Imp`
- maximum system voltage
- voltage and power temperature coefficients
- basic mechanical dimensions

For inverters, this includes:

- maximum DC voltage
- startup voltage
- MPPT voltage range
- MPPT count
- strings per MPPT
- max input current
- max short-circuit current
- max DC power per MPPT
- battery port compatibility fields

For batteries, this includes:

- usable and nominal capacity
- max charge power
- max discharge power
- round-trip efficiency
- voltage type
- scalability fields
- compatibility fields

These fields are currently for backend validation and future design-readiness only.

They are not yet used to change quote pricing, PV generation, battery dispatch or final system recommendations.

The current beta products are placeholders. Their electrical values are generic assumptions and must not be treated as verified manufacturer datasheet values.

## Battery product mapping

Battery recommendations now include closest-match battery product metadata from the local hardware catalogue.

Current behaviour:

- the existing abstract battery recommendation curve is still used for calculations
- the closest active catalogue battery is attached for display/metadata
- product metadata is not yet used for simulation
- product metadata is not yet used for pricing
- product metadata is not yet used for final battery selection

This is Phase F1 of the hardware roadmap.

The mapping method is currently:

'''txt
closest_active_usable_kwh

## Design compatibility diagnostics

The backend now includes a diagnostic-only design compatibility service.

Current checks include:

- number of roof arrays versus inverter MPPT count
- total PV DC input versus inverter maximum PV input
- DC/AC ratio warning checks
- string cold-weather Voc versus inverter maximum DC voltage
- string cold-weather Voc versus MPPT maximum voltage
- string hot-weather Vmp versus MPPT minimum voltage
- string operating voltage versus inverter startup voltage
- string operating current versus MPPT input current
- string short-circuit current versus MPPT short-circuit current
- array DC power versus MPPT DC power assumption
- battery/inverter type compatibility
- battery/inverter brand alignment
- battery full-charge time against a short tariff window
- battery full-discharge time against a short tariff window
- optimiser/microinverter review flags for shading, mixed orientations, mixed tilts, too many arrays or short strings

This service is currently diagnostic only.

It is not yet used to change:

- customer quote pricing
- PV generation
- battery dispatch
- battery recommendations
- final product selection

The long-term goal is for this service to become the design compatibility layer between user inputs, hardware catalogue products and supplier product databases.

### Quote response design diagnostics

Quote responses now include a `designCompatibility` object.

This object is diagnostic-only and includes:

- selected catalogue panel, inverter and battery products
- roof array count and panel count
- MPPT count checks
- inverter DC input checks
- string voltage checks
- string current checks
- battery/inverter compatibility checks
- battery charge/discharge window checks
- optimisation flags for shading, mixed roofs, short strings or too many arrays

Current status:

- `mode`: `diagnostic_only`
- `usedForCalculation`: `false`

This means the diagnostics are attached to the backend quote response, but they do not yet change customer-facing calculations, price, PV generation, battery dispatch or final recommendations.

## Design candidate schema foundation

The backend now includes a design candidate schema foundation.

A design candidate is the future optimisation unit for the quote engine.

Long-term, each candidate may represent a full possible system design, including:

- panel layout
- roof arrays
- string plan
- panel product
- inverter product
- battery product
- compatibility checks
- installation cost assumptions
- PV performance model
- battery dispatch model
- financial model
- scoring model

Current status:

- `mode`: `candidate_schema_foundation`
- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

The current candidate service creates one candidate from the user’s existing quote inputs.

It does not yet:

- generate alternative panel layouts
- optimise roof coverage
- split arrays into multiple strings
- combine strings onto MPPTs
- choose final products
- change quote pricing
- change PV generation
- change battery dispatch
- change financial outputs

The purpose is to create a stable internal structure for the future optimiser.

Future optimiser outputs should include:

- best payback candidate
- best lifetime savings candidate
- balanced candidate
- lowest upfront cost candidate
- premium integrated candidate
- shaded-roof optimised candidate

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