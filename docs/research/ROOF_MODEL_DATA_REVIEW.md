# R1 — Roof Model Data Availability & Accuracy Benchmark

## Objective

Determine the most reliable and cost-effective route from a building location to a customer-facing solar potential estimate.

Target accuracy for high/medium-confidence customer estimates:

- Panel count within ~10% of installer-designed panel count.
- Monthly solar production within ~15% of installer-designed monthly production.
- Low-confidence roof assumptions must be flagged or routed to fallback/installer review.

## Product framing

Customer-facing tool:

- Low-friction solar potential estimate.
- Not a final actionable quote.
- Uses confidence gates and installer-review CTAs.

Installer-facing tool:

- Accurate roof modelling.
- Editable roof planes, dimensions, setbacks, obstructions and final panel layout.
- Used for actionable quote/design.

## Data sources to review

### Google Solar API Building Insights

Review:

- roof segment data
- panel dimensions
- solar panel positions
- solar panel configs
- annual energy estimates
- imagery quality
- limitations on terraces/semi-detached/complex roofs

### Google Solar API Data Layers

Review:

- DSM
- RGB
- mask
- annual flux
- monthly flux
- hourly shade/flux layers
- processing complexity
- cost implications

### OpenSolar

Review:

- 3D design workflow
- auto shading
- auto pitch/azimuth/scale
- API/SDK availability
- whether it can be used as a data source or only as a platform integration

### EasyPV

Review:

- 3D / Magic design workflow
- automatic shade analysis
- whether any API/data access exists
- customer-facing applicability vs installer workflow

### PVGIS

Review:

- hourly PV production/radiation API
- monthly production modelling
- role as production engine, not roof model source

### SAM / PySAM / pvlib

Review:

- advanced simulation capabilities
- 3D shade inputs
- suitability for future installer-grade modelling
- complexity compared with current Zeyzer engine

## Benchmark method

For each known project:

1. Record installer-designed panel count and production.
2. Call Google Solar API Building Insights at selected roof target coordinates.
3. Record Google roof segments, panel configs, panel positions and annual energy.
4. Convert Google data into candidate roof segment estimate.
5. Compare:
   - Google-derived panel count vs installer panel count.
   - Google/Zeyzer monthly production vs installer monthly production.
6. Assign confidence:
   - High
   - Medium
   - Low
   - Very low

## Success criteria

High-confidence roofs:

- Panel count within ~10%.
- Monthly production within ~15%.

Medium-confidence roofs:

- Estimate usable with customer caveats.
- Wider production range acceptable.

Low-confidence roofs:

- Customer can continue only with warning/fallback.
- CTA should push installer-reviewed design.

Very-low-confidence roofs:

- Do not present detailed estimate as reliable.
- Require simple estimate flow or installer design request.

## Pending decisions

- Whether Building Insights alone is sufficient for lead generation.
- Whether Data Layers should be used only for high-intent/paid/installer workflows.
- Whether OpenSolar/EasyPV integration is useful or too platform-dependent.
- Whether customer-facing UI should show roof segment overlays, panel dots, or cards only.
