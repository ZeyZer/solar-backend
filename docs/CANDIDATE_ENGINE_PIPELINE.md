# Candidate Engine Pipeline

The candidate engine builds a diagnostic set of possible solar hardware designs from a quote and its safe input values. It enriches each candidate in stages, then returns candidates, summaries, rankings, shortlist information, and scenario-planning data in the candidate set response.

## Current flow

```txt
Input
→ base quote / safe input
→ design preference profile
→ roof geometry input model
→ manual roof polygon model
→ candidate generation
→ hardware metadata normalisation
→ hard-constraint evaluation
→ soft preference scoring
→ diagnostic pruning preview
→ roof geometry assumptions
→ roof design confidence
→ area-to-panel capacity estimate
→ candidate summaries
→ ranking
→ shortlist
→ scenario definitions / scenario runner / scenario expansion plan
→ candidate set response
```

Candidate generation combines eligible panels, inverters, and batteries. Each generated candidate receives compatibility, cost, PVGIS performance, battery dispatch, financial, filtering, and system-type information before the candidate-set enrichment stages run.

Hardware metadata normalisation gives later diagnostic stages a consistent view of hardware capabilities. Constraint evaluation records hard-preference results, while preference scoring records soft-preference results. The pruning preview shows what a future pruning stage could do; it does not currently remove candidates.

Roof geometry assumptions, roof confidence, and area capacity are then attached. The engine builds response summaries before producing ranking, shortlist, scenario, scenario-expansion, and optimisation-funnel outputs.

## Diagnostic-only roof geometry

The current roof geometry input, manual polygon, roof design confidence, and area-to-panel capacity features are diagnostic only. They describe input quality, assumptions, and estimated capacity, but do not alter quote calculations, pricing, PV generation, battery dispatch, ranking decisions, shortlist decisions, or customer recommendations.

Their safety and diagnostic flags retain their current meanings. In particular, these stages do not change `usedForCalculation`, `usedForPricing`, `usedForRecommendation`, `appliedToFiltering`, or `appliedToRanking` from `false` to `true`.

## Service ownership

- `services/candidates/` orchestrates candidate generation, enrichment, ranking, and shortlist output.
- `services/preferences/` models and evaluates design preferences.
- `services/roof/` models diagnostic roof inputs and capacity estimates.
- `services/pruning/` owns the diagnostic pruning preview.
- `services/scenarios/` defines and runs candidate scenarios and expansion planning.
- `services/hardware/`, `services/tariffs/`, `services/modelling/`, and `services/integrations/` provide the supporting domain services.
