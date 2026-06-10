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

## Design candidate set generation

The backend now includes a design candidate set generator.

This is the next layer above the single design candidate schema.

Current behaviour:

- creates multiple candidate combinations from catalogue products
- combines panel products, inverter products and battery products
- uses the current user roof inputs as the panel layout source
- uses the existing design candidate schema for each generated candidate
- sorts candidates diagnostically by compatibility status, diagnostic score and placeholder cost

Current status:

- `mode`: `candidate_set_foundation`
- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

This does not yet optimise the quote.

It does not yet change:

- customer quote price
- PV generation
- battery dispatch
- savings
- payback
- selected products
- frontend display

Future work:

- generate alternative roof layouts
- generate multiple stringing plans
- filter incompatible products
- connect candidate-level cost model
- connect candidate-level PV/battery simulation
- score candidates by payback, lifetime savings and balanced recommendation

## Design candidate filtering

The backend now classifies generated design candidates as:

- `viable`
- `viable_with_warnings`
- `rejected`

Rejected candidates include explicit rejection reasons.

Current hard rejection checks include:

- missing panel product
- missing inverter product
- roof arrays exceeding inverter MPPT count
- total PV input exceeding inverter limit
- excessive DC/AC ratio
- missing MPPT assignment
- cold string Voc exceeding inverter max DC voltage
- cold string Voc exceeding panel max system voltage
- cold string Voc exceeding MPPT max voltage
- hot string Vmp below MPPT minimum voltage
- string voltage below inverter startup voltage
- string operating current exceeding MPPT input current
- string short-circuit current exceeding MPPT short-circuit current
- battery/inverter compatibility failure

Current warning/review checks include:

- array DC power above MPPT power assumption
- battery and inverter brand mismatch
- battery may not fully charge within a short tariff window
- battery may not fully discharge within a short tariff window
- shading, mixed orientation, mixed tilt, short-string and optimiser/microinverter review flags

Current status:

- filtering is diagnostic only
- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

The future optimiser should compare viable candidates first and avoid recommending rejected candidates.

## Multi-profile system type fit scoring

The backend now includes diagnostic system type fit scoring for design candidates.

Each candidate is scored against every supported system type profile.

Current supported profiles:

- `budget`
- `balanced`
- `premium_integrated`
- `backup_ready`
- `shaded_roof`
- `monitoring_focused`
- `warranty_focused`
- `export_control_focused`
- `aesthetics_focused`

Each candidate now includes:

- `systemTypeFits`
- `selectedSystemTypeFit`
- `bestFitSystemType`

This means a single candidate can score well against multiple profiles.

For example, one candidate may be:

- high scoring for `budget`
- good for `balanced`
- weaker for `backup_ready`

Another candidate may be:

- weaker for `budget`
- strong for `premium_integrated`
- strong for `monitoring_focused`
- strong for `backup_ready`

Current scoring axes:

- cost
- compatibility
- warranty
- optimisation
- backup
- monitoring
- export control
- aesthetics

Current status:

- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

This is diagnostic only.

It does not yet change quote calculations, product selection, pricing, PV generation, battery dispatch, savings or recommendations.

Future work should replace placeholder heuristics with catalogue-driven hardware capability fields such as:

- backup compatibility
- G100/export-control status
- monitoring quality
- optimiser/microinverter support
- warranty terms
- smart tariff control capability
- forced charge/discharge support
- manufacturer ecosystem score
- installer supportability score
- panel aesthetics score

## Hardware capability fields

The hardware catalogue now includes beta capability fields used for diagnostic system type fit scoring.

Current panel capability fields include:

- aesthetics score
- complex roof suitability score
- premium appearance score
- monitoring visibility score

Current inverter capability fields include:

- software optimisation score
- monitoring quality score
- backup capability score
- export control score
- G100/export-control score
- ecosystem score
- smart tariff control score
- forced charge/discharge score
- export limiting support
- smart tariff control support
- forced charge/discharge support
- optimiser/microinverter support placeholders

Current battery capability fields include:

- monitoring quality score
- tariff control support score
- backup support score
- power capability score
- scalability score
- forced charge/discharge support
- smart tariff control support
- short tariff window suitability

Current status:

- capability fields are diagnostic only
- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

These values are beta placeholders.

The long-term plan is for supplier/manufacturer data, installer experience and verified product documentation to replace these placeholder capability scores.

## Design candidate shortlist

The backend now includes a diagnostic design candidate shortlist.

The shortlist sits on top of candidate generation, candidate filtering and system type fit scoring.

Current shortlist outputs include:

- viability summary
- common rejection reasons
- common warning reasons
- profile fit summary
- shortlisted eligible candidates
- rejected candidate examples
- key candidate ids for future optimiser stages

Current viability statuses:

- `viable`
- `viable_with_warnings`
- `rejected`
- `unknown`

Current readiness labels:

- `no_candidates_generated`
- `no_viable_candidates`
- `ready_for_future_cost_performance_modelling`
- `warning_candidates_available_for_review`

Current status:

- `mode`: `candidate_shortlist_diagnostic`
- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

This shortlist does not yet change quote calculations, product selection, pricing, PV generation, battery dispatch, savings or customer recommendations.

Its purpose is to identify which generated candidates are worth carrying forward into future candidate-level cost, performance and financial modelling.

## Design candidate cost model

The backend now includes a candidate-level beta cost model.

The model currently estimates candidate-level installed cost using:

- panel product material cost
- inverter product material cost
- battery product material cost
- mounting allowance
- scaffolding allowance
- electrical/BOS allowance
- labour allowance
- complexity multiplier
- overhead/margin allowance
- cost confidence label

Current status:

- `mode`: `candidate_cost_model_beta`
- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

The cost model is diagnostic only.

It does not yet replace the existing quote price calculation and does not change customer-facing pricing, savings, payback or recommendations.

Known limitations:

- supplier live pricing is not connected
- roof covering and mounting system are not modelled
- cable routes and electrical complexity are not modelled
- consumer unit works are not modelled
- access equipment is simplified into scaffolding allowance
- installer labour and margin are beta assumptions
- product costs are currently based on beta catalogue data

The purpose is to prepare design candidates for future cost/performance/financial optimisation.

## Candidate PVGIS performance bridge

The backend now includes a candidate-level PVGIS performance bridge.

This replaces the earlier empty candidate performance placeholder.

Current behaviour:

- uses PVGIS roof-array hourly profiles when available
- falls back to the existing aggregate quote PVGIS hourly profile when roof-array profiles are not yet available
- scales PVGIS hourly generation by candidate panel capacity
- estimates simple inverter clipping from the candidate inverter AC output limit
- does not invent candidate generation from arbitrary orientation/tilt constants
- marks performance as unavailable when no PVGIS hourly data exists

Current output includes:

- candidate system size
- annual gross generation
- annual after-clipping generation
- monthly gross generation
- monthly after-clipping generation
- PVGIS source metadata
- roof-array match metadata
- clipping risk
- battery power/capacity summary
- confidence label

Current status:

- `mode`: `candidate_pvgis_performance_model_beta`
- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

This model does not yet replace the customer-facing quote calculation.

The next development step should expose true roof-array PVGIS profiles from the main quote engine so multi-roof candidates can be assessed using per-roof hourly irradiance data rather than the aggregate quote PV profile.

## Roof-array PVGIS profiles

The main quote engine now exposes roof-array PVGIS hourly profiles.

Previously, the quote engine stored only the aggregate PVGIS hourly array:

- `hourlyModel._pvHourlyKWh`

The quote engine now also stores:

- `hourlyModel._pvgisRoofProfiles`

Each roof profile includes:

- roof id
- roof index
- orientation
- tilt
- shading derate
- base system size in kWp
- 3-year averaged hourly PVGIS generation
- month index array
- hour-of-day array
- annual generation for that roof profile

Current status:

- roof profiles are based on PVGIS hourly generation
- 2021, 2022 and 2023 are averaged into one representative roof profile
- shading derate is applied per hour per roof before aggregation
- profiles are used by the candidate PVGIS performance bridge where available

This is still not a roof irradiance map or per-panel-position shading model.

It is the intermediate bridge between the current roof-input quote engine and the future roof-map optimiser.

## Quote-level design candidate diagnostics

The quote response now includes diagnostic design candidate data.

Current quote response field:

- `designCandidateSet`

The candidate set is generated after the main quote has been calculated, so it can access:

- quote inputs
- selected roofs
- hardware catalogue
- roof-array PVGIS profiles
- candidate cost model
- candidate PVGIS performance model
- compatibility filtering
- system type fit scoring
- candidate shortlist

Current status:

- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

This means the design candidate set is attached for diagnostics and future optimisation only.

It does not yet change the customer-facing quote price, generation, battery dispatch, savings, payback, PDF or frontend recommendations.

The next stage is to use the PVGIS-backed candidate performance data to run candidate-specific battery dispatch and financial modelling.

## Candidate hourly dispatch model

The backend now includes a candidate-level hourly dispatch model.

The model uses:

- candidate PVGIS-backed hourly PV generation
- candidate inverter-clipped PV profile
- quote hourly household load profile
- candidate battery capacity
- after-solar tariff settings
- the existing hour-by-hour battery dispatch engine

Current output includes:

- annual generation
- annual self-used solar
- annual export
- annual import
- annual battery charge/discharge
- monthly generation/self-use/export/import
- monthly battery charge/discharge
- tariff dispatch metadata
- battery dispatch metadata
- confidence label

Current status:

- `mode`: `candidate_hourly_dispatch_model_beta`
- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

If PVGIS hourly data or quote load data is unavailable, the model returns:

- `mode`: `candidate_dispatch_model_unavailable`

This model is diagnostic only.

It does not yet change customer-facing quote calculations, price, savings, payback, PDF output or frontend recommendations.

Known limitations:

- product-specific battery max charge/discharge limits are not yet enforced inside the dispatch engine
- manufacturer-specific battery controls are not yet modelled
- customer-facing quote calculations still use the existing quote-level hourly model
- candidate-level financial calculations are not yet attached

The next development step is to use this dispatch output to build candidate-level financial modelling.

## Candidate selected-tariff battery control strategy

The backend now resolves a battery control strategy for candidate modelling.

This is used by candidate-level dispatch and financial modelling.

Current selected-tariff strategy logic:

- standard tariff: self-consumption
- overnight/time-of-use tariff: timed grid charging
- flux/import-export tariff: smart import/export
- no battery: no battery control

Current output includes:

- strategy ID
- strategy label
- tariff type
- dispatch mode
- grid charging enabled/disabled
- energy trading enabled/disabled
- export from battery enabled/disabled
- explanatory reason

Current status:

- one strategy is resolved for the currently selected tariff
- this is diagnostic only
- it does not change the customer-facing quote calculation

Future scenario optimisation will test multiple tariff/control combinations per shortlisted candidate.

## Candidate hourly financial model

The backend now includes a candidate-level hourly financial model.

The model uses:

- candidate PVGIS-backed hourly generation
- candidate inverter-clipped PV profile
- quote hourly household load profile
- candidate battery size
- selected after-solar tariff
- resolved battery control strategy
- before-solar tariff
- the existing hour-by-hour battery dispatch engine
- the existing hourly billing engine
- candidate-level beta installed cost

Current output includes:

- baseline annual bill
- after-solar import and standing charge cost
- export credit
- after-solar net bill
- annual bill savings
- annual SEG/export income
- total annual benefit
- estimated installed candidate cost
- simple payback
- 25-year payback/lifetime series
- battery control strategy
- confidence label

Current status:

- `mode`: `candidate_hourly_financial_model_beta`
- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

If candidate PVGIS hourly data or quote load data is unavailable, the model returns:

- `mode`: `candidate_financial_model_unavailable`

This model is diagnostic only.

It does not yet change customer-facing quote calculations, pricing, savings, payback, PDF output, frontend display or recommendations.

The next development step is candidate ranking/optimiser outputs using the candidate financial model.

## Candidate ranking for selected tariff

The backend now includes diagnostic candidate ranking.

The ranking model uses:

- candidate technical filtering status
- candidate financial model
- candidate installed cost estimate
- candidate simple payback
- candidate lifetime savings
- candidate annual benefit
- candidate self-consumption
- selected system type fit score
- candidate battery control strategy already resolved for the selected tariff

Current ranking outputs include:

- best payback
- best lifetime savings
- lowest upfront cost
- best annual benefit
- best selected system type fit
- balanced candidate

Current status:

- `mode`: `candidate_ranking_selected_tariff_beta`
- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

This ranking is diagnostic only.

It does not yet change customer-facing quote calculations, pricing, savings, payback, PDF output, frontend display or recommendations.

The current ranking uses the selected tariff only.

Future scenario optimisation will rank:

- candidate + tariff + battery control strategy

rather than candidate alone.

## Candidate scenario engine foundation

The backend now includes a candidate scenario set.

A scenario represents:

- candidate
- selected tariff
- resolved battery control strategy
- candidate performance model
- candidate dispatch model
- candidate financial model

Current status:

- one scenario is created per candidate
- only the currently selected tariff is used
- only one resolved battery control strategy is used per candidate
- scenario outputs are diagnostic only

Current scenario set field:

- `designCandidateSet.scenarioSet`

Current mode:

- `candidate_scenario_set_selected_tariff_beta`

Current status flags:

- `usedForCalculation`: `false`
- `usedForPricing`: `false`
- `usedForRecommendation`: `false`

This phase does not yet test multiple tariffs or multiple battery control strategies.

The purpose is to introduce the scenario structure before later expanding to:

- candidate + tariff + control strategy

as the true optimisation unit.

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