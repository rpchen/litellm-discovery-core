# Delta: discovery-quality

## MODIFIED Requirements

### Requirement: capability-first provider fallback
Core SHALL prioritize reliable model capability metadata when the same model is offered by multiple models.dev providers, SHALL prove the original provider through deterministic canonical relations plus a provider-namespace match, and SHALL order reseller fallbacks OpenCode before OpenRouter. The canonical namespace may be proven by the deployment's own qualified identity (a routed `namespace/model` identity or an explicit `models_dev_provider`) when every deployment declaration agrees on that one namespace; the reseller fallback namespaces never qualify as a canonical namespace.

#### Scenario: canonical metadata identifies an unlisted family
- **WHEN** multiple provider records match or relation-point to one canonical model identity and the original provider record is present
- **THEN** Core selects that original provider without requiring a model-family hard-code

#### Scenario: original provider record is only reachable through a canonical relation
- **WHEN** the original provider publishes the model under a serving-specific record id and declares `canonical_model_id` (or `base_model`) pointing at the canonical identity
- **THEN** Core matches that record through the relation and selects it as the canonical-original enrichment source

#### Scenario: route-qualified namespace proves a relation-less same-namespace record as the original
- **WHEN** every deployment identity declaration agrees on one qualified namespace (for example the route `openai/gpt-6-sol`), and a record matched directly by id/alias is published by that same namespace provider without any canonical relation field
- **THEN** Core selects that record as the canonical-original enrichment source, so the proven endpoint configuration keeps its authoritative (LKG-restorable) authority

#### Scenario: reseller routing never proves original status
- **WHEN** the deployment route names the OpenCode or OpenRouter namespace and the reseller record matches directly
- **THEN** Core does not promote that record to canonical-original; the selection stays on the fallback precedence steps as a fallback-serving source

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