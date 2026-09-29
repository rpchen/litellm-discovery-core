# discovery-quality Specification

## Purpose
Defines conservative model identity matching and enrichment quality rules, reasoning and protocol capability resolution, distinct token-limit semantics, deterministic metadata precedence, unknown-model fallback, and conflict provenance.

## Requirements

### Requirement: conservative canonical model identity
Core SHALL canonicalize model identity only across non-semantic formatting differences and SHALL support explicit aliases without stripping semantic suffixes.

#### Scenario: formatted upstream identity
- **WHEN** a LiteLLM candidate differs from a models.dev identity only by route prefix, case, spaces, underscores or repeated separators
- **THEN** Core matches the canonical models.dev record and reports how the match was made

### Requirement: provider disambiguation
Core SHALL prefer explicit/original provider evidence and SHALL NOT select a globally ambiguous reseller record.

#### Scenario: ambiguous reseller identity
- **WHEN** the same canonical model identity exists under multiple non-preferred providers
- **THEN** Core leaves models.dev enrichment unmatched instead of choosing an arbitrary provider

### Requirement: reasoning resolution
Core SHALL resolve reasoning support independently from reasoning variants, with explicit LiteLLM declarations taking precedence over models.dev fallback metadata.

#### Scenario: reasoning sources disagree
- **WHEN** LiteLLM explicitly declares reasoning support differently from the matched models.dev record
- **THEN** the LiteLLM declaration determines support and diagnostics report the conflict

### Requirement: token-limit semantics
Core SHALL preserve separate context, input and output token-limit meanings and apply deterministic fallbacks when fields are missing.

#### Scenario: total context differs from input limit
- **WHEN** models.dev supplies total context and LiteLLM supplies a smaller max input limit
- **THEN** Core preserves the models.dev total context while using the LiteLLM value as the input limit

### Requirement: deterministic metadata precedence
Core SHALL conservatively merge multiple deployments and SHALL expose conflicts between authoritative LiteLLM deployment metadata and models.dev enrichment.

#### Scenario: deployment capability and pricing conflict
- **WHEN** deployments disagree on a capability or price and models.dev also supplies metadata
- **THEN** Core uses conservative capability intersection, the highest LiteLLM deployment price, and reports relevant source conflicts

### Requirement: protocol capability visibility
Core SHALL distinguish the protocol selected for invocation from the protocols that upstream metadata says are supported.

#### Scenario: Chat Completions and Responses are both supported
- **WHEN** one deployment declares both Chat Completions and Responses endpoints
- **THEN** Core reports protocol capability `both` while preserving the existing selected-protocol precedence

#### Scenario: protocol evidence is missing
- **WHEN** no Anthropic, supported-endpoint or mode evidence identifies protocol support
- **THEN** Core reports protocol capability `unknown` while preserving the existing safe selected-protocol fallback

### Requirement: unknown-model fallback
Core SHALL keep models discoverable when models.dev has no matching record.

#### Scenario: private model has no enrichment record
- **WHEN** LiteLLM returns a conversational private model that is absent from models.dev
- **THEN** Core emits a deterministic LiteLLM-only ModelSpec instead of dropping the model

### Requirement: discovery-quality provenance
Core SHALL expose model identity, enrichment/fallback mode, reasoning source, protocol capability and metadata conflict resolution as observational diagnostics.

#### Scenario: quality diagnostics requested
- **WHEN** discovery inputs contain canonical matching plus conflicting reasoning, capability, limit or price metadata
- **THEN** diagnostics explain the resolved quality metadata without changing the normal ModelSpec result or requiring host I/O

### Requirement: capability-first provider fallback
Core SHALL prioritize reliable model capability metadata when the same model is offered by multiple models.dev providers.

#### Scenario: canonical metadata identifies an unlisted family
- **WHEN** multiple provider records share one `canonical_model_id` and the original provider record is present
- **THEN** Core selects that original provider without requiring a model-family hard-code

#### Scenario: original provider record is unavailable
- **WHEN** the original provider cannot be selected and both OpenRouter and OpenCode expose the model
- **THEN** Core selects OpenRouter before OpenCode

#### Scenario: OpenRouter is unavailable
- **WHEN** the original provider and OpenRouter are unavailable but OpenCode exposes the model
- **THEN** Core selects OpenCode before treating other reseller records as ambiguous

#### Scenario: reseller ambiguity remains
- **WHEN** no original, OpenRouter, or OpenCode record exists and multiple other providers match
- **THEN** Core leaves models.dev enrichment unmatched rather than selecting an arbitrary reseller

### Requirement: capability fallback preserves operational limits
A capability fallback SHALL populate valid model limits when the selected models.dev record provides them, while explicit LiteLLM pricing remains authoritative.

#### Scenario: hy4-preview is routed through an OpenAI-compatible LiteLLM deployment
- **WHEN** LiteLLM exposes `hy4-preview` without token limits, OpenRouter provides context/output limits, and LiteLLM explicitly provides token prices
- **THEN** Core emits non-zero context/output limits from the OpenRouter record, preserves the LiteLLM prices, and does not emit a models-dev-unmatched warning

### Requirement: capability fallback pricing is non-authoritative
Core SHALL NOT present provider pricing from OpenRouter, OpenCode, or an otherwise selected reseller as the LiteLLM deployment price when that record was selected only for capability enrichment.

#### Scenario: OpenRouter provides capabilities but LiteLLM omits price
- **WHEN** OpenRouter is selected as the capability fallback and LiteLLM does not declare token prices
- **THEN** Core uses the OpenRouter capability/limit metadata but leaves deployment pricing unknown/zero and diagnostics explain that the fallback price was ignored

### Requirement: operational limits are explicit
Core SHALL distinguish a neutral discovered model from a model that has positive context/output limits suitable for host publication.

#### Scenario: private model has no token-limit metadata
- **WHEN** LiteLLM exposes a model and neither LiteLLM nor models.dev supplies positive context/output limits
- **THEN** Core retains the neutral ModelSpec for diagnostics, reports a missing-operational-limits warning, and reports that the ModelSpec is not operational for host publication
