# Discovery quality

## ADDED Requirements

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
