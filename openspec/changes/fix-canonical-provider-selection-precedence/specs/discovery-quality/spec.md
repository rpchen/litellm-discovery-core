# Delta: discovery-quality

## MODIFIED Requirements

### Requirement: capability-first provider fallback
Core SHALL prioritize reliable model capability metadata when the same model is offered by multiple models.dev providers, SHALL prove the original provider through deterministic canonical relations plus a provider-namespace match, and SHALL order reseller fallbacks OpenCode before OpenRouter.

#### Scenario: canonical metadata identifies an unlisted family
- **WHEN** multiple provider records match or relation-point to one canonical model identity and the original provider record is present
- **THEN** Core selects that original provider without requiring a model-family hard-code

#### Scenario: original provider record is only reachable through a canonical relation
- **WHEN** the original provider publishes the model under a serving-specific record id and declares `canonical_model_id` (or `base_model`) pointing at the canonical identity
- **THEN** Core matches that record through the relation and selects it as the canonical-original enrichment source

#### Scenario: reseller relation never proves original-provider status
- **WHEN** OpenRouter, OpenCode, or any reseller record relation-points at the canonical identity while the provider namespace differs from the canonical namespace
- **THEN** Core treats the relation as proof of the served canonical model only and never as original-provider proof

#### Scenario: original provider record is unavailable
- **WHEN** the original provider cannot be selected and both OpenRouter and OpenCode expose the model
- **THEN** Core selects OpenCode before OpenRouter

#### Scenario: OpenRouter is unavailable
- **WHEN** the original provider and OpenRouter are unavailable but OpenCode exposes the model
- **THEN** Core selects OpenCode before treating other reseller records as ambiguous

#### Scenario: OpenCode is unavailable
- **WHEN** the original provider and OpenCode are unavailable but OpenRouter exposes the model
- **THEN** Core selects OpenRouter instead of treating other reseller records as ambiguous

#### Scenario: reseller ambiguity remains
- **WHEN** no original, OpenCode, or OpenRouter record exists and multiple other providers match
- **THEN** Core leaves models.dev enrichment unmatched rather than selecting an arbitrary reseller

#### Scenario: selection never depends on catalog order
- **WHEN** the same group and catalog are evaluated with different catalog object iteration order
- **THEN** every selection outcome (original, fallback, unique, ambiguous) is identical and deterministic

## ADDED Requirements

### Requirement: fallback metadata is secondary evidence
Core SHALL distinguish provider-scoped serving metadata obtained through fallback selection from canonical intrinsic evidence, and SHALL NOT publish fallback serving values as authoritative intrinsic facts.

#### Scenario: OpenRouter fallback serving limit is not authoritative
- **WHEN** an OpenRouter record is selected only as a fallback enrichment source and LiteLLM declares a smaller descriptive output limit
- **THEN** Core keeps the authoritative intrinsic authority unavailable, records the two conflicting values, and withholds the model instead of publishing the reseller serving limit as the model's intrinsic output

#### Scenario: fallback serving metadata fills gaps only
- **WHEN** a fallback-selected record supplies limits or capability facts that no LiteLLM source declares
- **THEN** Core uses those values as fallback-serving provenance and they never outrank LiteLLM descriptive or constraint evidence

#### Scenario: canonical original remains authoritative
- **WHEN** the selected record is the canonical-original provider record
- **THEN** its limit, modality, tool, and reasoning facts keep the authoritative intrinsic authority established by the trusted publication policy