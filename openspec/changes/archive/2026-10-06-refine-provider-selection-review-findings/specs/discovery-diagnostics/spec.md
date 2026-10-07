# Delta: discovery-diagnostics

## MODIFIED Requirements

### Requirement: source visibility
Core SHALL report models.dev match identity and field-level provenance for protocol, reasoning variants, capabilities, context/output limits, pricing, and release metadata, and SHALL report the canonical model identity, the selected metadata provider record, and the provider selection source as separate observational fields.

Every evidence item names its exact origin class — `authoritative-intrinsic`, `fallback-serving`, `descriptive-metadata`, or `deployment-constraint` — and fallback-serving resolutions never use wording that claims authoritative intrinsic metadata decided the value.

#### Scenario: mixed metadata sources
- **WHEN** LiteLLM supplies limits and prices while models.dev supplies reasoning and release metadata
- **THEN** diagnostics distinguish those sources instead of presenting the merged result as a single source

#### Scenario: canonical original selection is explainable
- **WHEN** discovery resolves a model whose canonical identity is `deepseek/deepseek-v4.1-flash` and selects the official `deepseek` provider record through a canonical relation
- **THEN** diagnostics report canonical identity `deepseek/deepseek-v4.1-flash`, metadata provider `deepseek`, and selection source `canonical-original`

#### Scenario: fallback selection keeps the canonical identity intact
- **WHEN** discovery selects an OpenCode fallback record for a model whose canonical identity is `vendor/foo`
- **THEN** diagnostics still report canonical identity `vendor/foo` (never `opencode/foo`), metadata provider `opencode`, and selection source `opencode-fallback`

#### Scenario: fallback-serving resolution names its origin
- **WHEN** a fallback-serving record fills a gap or is narrowed by a proven runtime constraint
- **THEN** the field resolution carries origin `fallback-serving` (or `deployment-constraint` evidence items alongside it) and its resolution message names fallback serving metadata instead of claiming authoritative intrinsic authority