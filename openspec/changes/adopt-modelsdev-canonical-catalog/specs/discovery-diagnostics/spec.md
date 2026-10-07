# Delta: discovery-diagnostics

## MODIFIED Requirements

### Requirement: source visibility
Core SHALL report field-level provenance for protocol, reasoning support and levels, capabilities, context/input/output limits, pricing, and release metadata, and SHALL report as separate observational fields: the canonical model identity and its evidence kind (`qualified-deployment`, `registry-unique`, `serving-relation`, or none), the serving status (`declared`, `declared-unmatched`, `serving-ambiguous`, `unproven`, or `fallback`) with the serving provider and record when present, and the catalog shape (`complete`, `providers-only`, `unavailable`).

Every evidence item names its exact origin class — `canonical-intrinsic`, `serving-override`, `fallback-serving`, `descriptive-metadata`, or `deployment-constraint` — and fallback-serving resolutions never use wording that claims canonical or serving authority decided the value.

#### Scenario: mixed metadata sources
- **WHEN** LiteLLM supplies limits and prices while models.dev supplies reasoning support and release metadata
- **THEN** diagnostics distinguish those sources instead of presenting the merged result as a single source

#### Scenario: canonical original selection is explainable
- **WHEN** discovery resolves canonical identity `deepseek/deepseek-v4.1-flash` and the operator declares `models_dev_provider: deepseek`, selecting the DeepSeek record that relation-points at that identity
- **THEN** diagnostics report canonical identity `deepseek/deepseek-v4.1-flash`, serving status `declared`, serving provider `deepseek`, and the selected record id; no `canonical-original` selection source is reported

#### Scenario: canonical identity without serving proof is explainable
- **WHEN** discovery resolves a model to canonical identity `deepseek/deepseek-v4.1-flash` through `base_model` and no serving provider is declared
- **THEN** diagnostics report canonical identity `deepseek/deepseek-v4.1-flash`, evidence `registry-unique`, serving status `unproven`, and no serving record, even though DeepSeek provider records exist

#### Scenario: fallback selection keeps the canonical identity intact
- **WHEN** discovery uses an exact OpenCode record as fallback-serving metadata for a model absent from the canonical registry
- **THEN** diagnostics report no canonical identity (never `opencode/<id>`), serving status `fallback`, and provider `opencode`

#### Scenario: declared serving is explainable
- **WHEN** discovery resolves a model with `models_dev_provider: opencode`
- **THEN** diagnostics still report the canonical registry identity (never `opencode/<id>`), serving status `declared`, serving provider `opencode`, and the selected record id

#### Scenario: unknown reasoning levels are explained
- **WHEN** reasoning is supported but the serving provider is unproven
- **THEN** diagnostics state that reasoning levels are unknown because no serving provider is proven, without reporting a withheld reason

#### Scenario: fallback-serving resolution names its origin
- **WHEN** a fallback-serving record fills a gap or is narrowed by a proven runtime constraint
- **THEN** the field resolution carries origin `fallback-serving` (or `deployment-constraint` evidence items alongside it) and its resolution message names fallback serving metadata

### Requirement: degraded enrichment
Core SHALL make missing, empty, or registry-less models.dev metadata observable without preventing LiteLLM-only discovery.

#### Scenario: models.dev unavailable
- **WHEN** the supplied models.dev catalog is empty
- **THEN** diagnostics report degraded enrichment and unmatched models while preserving the normal discovery result

#### Scenario: canonical registry unavailable
- **WHEN** the supplied catalog is `providers-only`
- **THEN** diagnostics report that the canonical registry is unavailable and that fallback-serving resolution is disabled for the round
