# publication Specification

## Purpose
Defines the trustworthy model-capability publication loop: formal completeness and publishability policy, false-vs-unknown semantics, decoupled reasoning/levels, deterministic inheritance, failure taxonomy, TTL-free Last Known Good, explicit degradation, configuration states, and field-level provenance. Core is the single business source of truth; adapters consume its verdicts without reimplementing policy.

## ADDED Requirements

### Requirement: Publication completeness policy
Core SHALL define a formal, testable rule deciding whether a discovered model's metadata is reliable enough for normal publication, and SHALL report exactly which fields are missing, unknown, or illegal when it is not.

#### Scenario: Complete trustworthy metadata is publishable
- **WHEN** a model has positive context and output limits plus known tool-calling and reasoning states with a uniquely resolved identity
- **THEN** Core reports the model publishable with status `configured`

#### Scenario: Missing context blocks normal publication
- **WHEN** a model has no positive context limit from any trusted source
- **THEN** Core reports the model not publishable and names the missing context field

#### Scenario: Missing output limit blocks normal publication
- **WHEN** a model has no positive output limit from any trusted source
- **THEN** Core reports the model not publishable and names the missing output field

#### Scenario: Zero context is illegal, not a default
- **WHEN** the merged context limit is zero
- **THEN** Core treats it as illegal/insufficient and the model is not normally publishable

#### Scenario: Zero output is illegal, not a default
- **WHEN** the merged output limit is zero
- **THEN** Core treats it as illegal/insufficient and the model is not normally publishable

#### Scenario: Unknown key capability blocks normal publication
- **WHEN** tool calling or reasoning support is unknown
- **THEN** Core reports the model not publishable and names the unknown field

#### Scenario: Illegal metadata is rejected
- **WHEN** metadata carries illegal values or an incompatible schema shape is used as fact
- **THEN** Core reports the model not publishable with an illegal-field entry

### Requirement: False versus unknown
Core SHALL distinguish confirmed-unsupported (`unsupported`) from unevidenced (`unknown`) for tool calling and reasoning, and SHALL never rewrite `unknown` to `false`, `0`, or `[]` on any path leading to normal publication.

#### Scenario: Missing tool declaration stays unknown
- **WHEN** neither LiteLLM nor models.dev declares tool-call support
- **THEN** Core reports tool support `unknown`, not `unsupported`

#### Scenario: Explicit negative evidence means unsupported
- **WHEN** a trusted source explicitly declares no tool-call or reasoning support without contradiction
- **THEN** Core reports `unsupported`

### Requirement: Reasoning decoupled from levels
Core SHALL resolve reasoning support independently from reasoning levels; support without selectable levels is legal, and missing levels never imply lack of support.

#### Scenario: Reasoning without levels is legal
- **WHEN** trusted metadata declares reasoning support but no selectable levels
- **THEN** Core reports support with an empty level set and the model may still be publishable

#### Scenario: Reasoning with levels
- **WHEN** trusted metadata declares reasoning support with effort or budget options
- **THEN** Core reports support with the parsed levels

#### Scenario: No reasoning
- **WHEN** trusted evidence confirms no reasoning support
- **THEN** Core reports unsupported regardless of level data

#### Scenario: Levels never flip support
- **WHEN** level data is absent or present
- **THEN** Core never derives support from level presence alone in either direction

### Requirement: Deterministic source resolution and inheritance
Core SHALL resolve metadata identity only through canonical identity, provider identity, alias, equivalent relations, or other verifiable deterministic relations with provenance, and SHALL keep ambiguous or unmatched identities observable instead of force-picking.

#### Scenario: Original provider wins
- **WHEN** the canonical identity names an original provider whose record exists
- **THEN** Core selects that record with canonical-original provenance

#### Scenario: Ordered capability fallback
- **WHEN** the original record is unavailable
- **THEN** Core prefers OpenRouter, then OpenCode, then a genuinely unique match, else stays unmatched

#### Scenario: Ambiguity stays observable
- **WHEN** multiple non-preferred providers match one identity
- **THEN** Core reports `ambiguous` and does not publish normally

#### Scenario: Deterministic inheritance carries provenance
- **WHEN** metadata explicitly declares alias, equivalence, or canonical inheritance for a field
- **THEN** Core inherits the field and records canonical-inheritance provenance naming the source

#### Scenario: No heuristic guessing
- **WHEN** only a model name, family substring, or neighbor-model values suggest a capability
- **THEN** Core reports `unknown` and never fills limits, tools, reasoning, modalities, or levels from the guess

### Requirement: Failure taxonomy without pseudo-complete publication
Core SHALL classify metadata failures and SHALL never emit a normally-published model from a failed fetch via defaults.

#### Scenario: Network failure is observable
- **WHEN** metadata retrieval times out, returns 5xx, or is unreachable
- **THEN** Core reports `metadata-unavailable` with the classified kind and no normally-published model

#### Scenario: Retry recovery restores publication
- **WHEN** a retry after failure returns complete trustworthy metadata
- **THEN** Core reports `configured` with a recovered-after-retry record

### Requirement: Last Known Good without TTL
Core SHALL support reusing a previously complete metadata snapshot while live sources fail, with validity decided by identity, provider, canonical mapping, schema, and conflict evidence -- never by fixed age -- and SHALL expose source, fetch time, age, and selection reason.

#### Scenario: Valid LKG keeps publication
- **WHEN** live metadata fails but a stored snapshot with matching identity and compatible schema exists
- **THEN** Core reports status `configured-lkg` with LKG provenance

#### Scenario: Old but stable LKG stays valid
- **WHEN** an LKG entry is arbitrarily old yet identity, provider, mapping, and schema still agree with no conflicting live data
- **THEN** Core still accepts it

#### Scenario: Identity conflict invalidates LKG
- **WHEN** the current canonical or provider identity no longer matches the stored entry
- **THEN** Core rejects the entry

#### Scenario: Newer trusted metadata wins
- **WHEN** fresh trusted live metadata contradicts a stored entry
- **THEN** Core uses the live data and refreshes the entry

#### Scenario: Schema change invalidates LKG
- **WHEN** the stored shape is incompatible with the current schema
- **THEN** Core rejects the entry

### Requirement: Explicit degradation
Core SHALL support user-accepted degradation for incomplete models that keeps the degraded label and never re-labels the model as fully configured.

#### Scenario: Incomplete model blocked without acceptance
- **WHEN** a model is incomplete or its metadata fetch failed with no valid LKG and no user acceptance
- **THEN** Core reports it not normally publishable

#### Scenario: Accepted degradation stays degraded
- **WHEN** the user explicitly accepts a named incomplete model with its listed gaps
- **THEN** Core reports status `degraded` with the gap list and acceptance record, publishable only through the degraded path

### Requirement: Configuration states and provenance
Core SHALL expose per-model configuration states and per-field provenance answering where each key value came from, including live, fallback, canonical-inheritance, and LKG chains.

#### Scenario: States distinguish discovery from configuration
- **WHEN** models are discovered across the outcome space
- **THEN** Core assigns each model one of configured, configured-lkg, discovered-incomplete, unmatched, ambiguous, metadata-unavailable, invalid-metadata, or degraded

#### Scenario: Provenance explains key fields
- **WHEN** provenance is requested for limits, modalities, tools, reasoning, levels, identity, or live/fallback/LKG choice
- **THEN** Core names the source chain including provider, model, canonical-inheritance source, or LKG fetch time
