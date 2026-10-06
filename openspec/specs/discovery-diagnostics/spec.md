# discovery-diagnostics Specification

## Purpose
Defines observational discovery diagnostics that explain model-info validity, models.dev matching, protocol decisions, field provenance, source boundaries, degraded enrichment, and cache state without changing discovery results.

## Requirements

### Requirement: observational diagnostics
Core SHALL return structured diagnostics that explain the same model result produced by normal discovery without changing the selected models or performing network I/O.

#### Scenario: diagnose a valid response
- **WHEN** a LiteLLM model-info response and models.dev catalog are diagnosed
- **THEN** the returned models equal the normal discovery result and the diagnostic payload describes that result

### Requirement: source visibility
Core SHALL report models.dev match identity and field-level provenance for protocol, reasoning variants, capabilities, context/output limits, pricing, and release metadata, and SHALL report the canonical model identity, the selected metadata provider record, and the provider selection source as separate observational fields.

#### Scenario: mixed metadata sources
- **WHEN** LiteLLM supplies limits and prices while models.dev supplies reasoning and release metadata
- **THEN** diagnostics distinguish those sources instead of presenting the merged result as a single source

#### Scenario: canonical original selection is explainable
- **WHEN** discovery resolves a model whose canonical identity is `deepseek/deepseek-v4.1-flash` and selects the official `deepseek` provider record through a canonical relation
- **THEN** diagnostics report canonical identity `deepseek/deepseek-v4.1-flash`, metadata provider `deepseek`, and selection source `canonical-original`

#### Scenario: fallback selection keeps the canonical identity intact
- **WHEN** discovery selects an OpenCode fallback record for a model whose canonical identity is `vendor/foo`
- **THEN** diagnostics still report canonical identity `vendor/foo` (never `opencode/foo`), metadata provider `opencode`, and selection source `opencode-fallback`

### Requirement: protocol explanation
Core SHALL expose the selected protocol and the reason used by the existing protocol precedence rules.

#### Scenario: conflicting deployment protocols
- **WHEN** deployments in one model group resolve to different protocols without an override
- **THEN** diagnostics report the conservative chat fallback and a warning issue

### Requirement: discovery-source boundaries
Core SHALL identify /v1/model/info as the authoritative LiteLLM discovery response and SHALL identify /v1/models as intentionally unused.

#### Scenario: diagnostics requested
- **WHEN** diagnostics are generated
- **THEN** no /v1/models request is implied or required to produce them

### Requirement: degraded enrichment
Core SHALL make missing or empty models.dev metadata observable without preventing LiteLLM-only discovery.

#### Scenario: models.dev unavailable
- **WHEN** the supplied models.dev catalog is empty
- **THEN** diagnostics report degraded enrichment and unmatched models while preserving the normal discovery result

### Requirement: cache observability
Core SHALL provide a pure cache diagnostic representation for adapter-supplied source, stale status, refresh time, age, failure count, retry time and pending state.

#### Scenario: restored snapshot
- **WHEN** an adapter describes a restored persisted snapshot
- **THEN** the cache diagnostic marks the source as snapshot and stale unless explicitly overridden

### Requirement: sensitive-data boundary
Core diagnostics SHALL NOT require or include raw credentials, endpoint URLs, host connection identities, or raw host error bodies.

#### Scenario: diagnostic serialization
- **WHEN** a diagnostic payload is serialized
- **THEN** it contains only model/discovery metadata and safe status information
