# discovery-quality Specification

## Purpose
Defines conservative model identity matching and enrichment quality rules, reasoning and protocol capability resolution, distinct token-limit semantics, deterministic metadata precedence, unknown-model fallback, and conflict provenance.

## Requirements

### Requirement: conservative canonical model identity
Core SHALL resolve canonical model identity only against the models.dev canonical registry and only across non-semantic formatting differences (route adapter segment, case). Semantic suffixes such as `-free`, `-fast`, `:thinking`, dates, sizes, and provider tiers SHALL NOT be stripped or folded, and identity SHALL follow the rules of the `modelsdev-catalog` capability.

#### Scenario: formatted upstream identity
- **WHEN** a LiteLLM candidate differs from a canonical registry key only by a route adapter segment or by case
- **THEN** Core resolves that canonical identity and reports the evidence kind

#### Scenario: semantic suffix is a different identity
- **WHEN** a LiteLLM candidate is `x-free` and the registry only contains `labA/x`
- **THEN** Core does not resolve `labA/x` from the suffixed candidate

### Requirement: provider disambiguation
Core SHALL keep canonical identity and serving provider as separate facts, SHALL select a serving record only under a proven serving provider, and SHALL NOT select a globally ambiguous reseller record for any purpose.

#### Scenario: ambiguous reseller identity
- **WHEN** the same model id exists under multiple non-preferred providers and the registry has no entry for it
- **THEN** Core does not choose an arbitrary provider record and reports the group ambiguous

#### Scenario: canonical identity does not choose a serving record
- **WHEN** canonical identity is proven and no serving provider is declared
- **THEN** Core selects no serving record, even when the lab's own provider record exists

### Requirement: reasoning resolution
Core SHALL resolve reasoning support independently from reasoning levels. Reasoning support SHALL follow the field resolution matrix of the `modelsdev-catalog` capability: a resolved serving value, else the canonical registry value, else consistent LiteLLM declarations, else unknown; `litellm_params.supports_reasoning: false` is operator configuration and narrows support only after the runtime enforcement matrix promotes that key (the proven set starts empty), and a differing `model_info.supports_reasoning` against a serving or canonical base is a resolved discrepancy. Reasoning levels follow the `Reasoning controls authority` requirement.

#### Scenario: reasoning sources disagree
- **WHEN** canonical identity is proven and LiteLLM `model_info` declares reasoning support differently from the canonical registry entry
- **THEN** the canonical value determines support and diagnostics report a resolved discrepancy

#### Scenario: enforced reasoning constraint
- **WHEN** a deployment declares `litellm_params.supports_reasoning: false` and that key has been promoted by a runtime-enforcement delta
- **THEN** Core reports reasoning unsupported as an enforcement-narrowed value; until such a promotion exists the declaration is operator configuration that changes no verdict

### Requirement: token-limit semantics
Core SHALL preserve separate context, input, and output token-limit meanings and SHALL compare evidence only within the same dimension. LiteLLM `max_input_tokens` is input capacity; it SHALL be compared only with a declared `limit.input` and SHALL NOT be compared with, nor substituted for, the total context under any circumstances. A missing `limit.input` SHALL stay unknown: models.dev defines `limit.input` as an optional maximum-input-tokens field with no absent-equals-context contract, provider syncs intentionally leave it undefined, and `base_model_omit` deletions must stay deletions. Host consumers that need an input number resolve that in the adapter mapping layer, not by inventing a canonical fact.

#### Scenario: total context differs from input limit
- **WHEN** the canonical registry supplies total context and an input capacity and LiteLLM declares an equal `max_input_tokens`
- **THEN** Core preserves the total context, uses the input capacity, and records no discrepancy

#### Scenario: LiteLLM input differs from canonical input
- **WHEN** LiteLLM declares a `max_input_tokens` different from the canonical input capacity
- **THEN** Core records an input-dimension resolved discrepancy and never a context discrepancy

#### Scenario: Missing canonical input stays unknown
- **WHEN** the canonical entry declares no `limit.input` (or a proven serving record omits it through `base_model_omit`) and LiteLLM declares no `max_input_tokens`
- **THEN** Core keeps the input fact unknown and never derives it from the total context

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

### Requirement: operational limits are explicit
Core SHALL distinguish a neutral discovered model from a model that has positive context/output limits suitable for host publication.

#### Scenario: private model has no token-limit metadata
- **WHEN** LiteLLM exposes a model and neither LiteLLM nor models.dev supplies positive context/output limits
- **THEN** Core retains the neutral ModelSpec for diagnostics, reports a missing-operational-limits warning, and reports that the ModelSpec is not operational for host publication

### Requirement: record-level selection determinism
Within a proven serving provider, Core SHALL resolve the serving record only through an exact parsed-key match (full form, then adapter-evidenced remainder, then bare form) against the deployment's lookup keys: the exact lookup-key match both makes a record a candidate and resolves it — there is no state of a record matched yet SKU-unresolved — and the resolved record's `canonical_model_id` may additionally prove the canonical identity through `serving-relation`. A record matching no parsed lookup key is not a candidate: its relation proves nothing (neither identity nor serving facts), regardless of whether its facts are equivalent to another relation record, so a provider with no exact match — including one holding only relation-only records — yields a `serving-record-unresolved` group that resolves from canonical or LiteLLM branches and uses no provider facts. When several records match the same parsed key exactly, Core SHALL pick deterministically only when their serving publication-critical facts (limits, modalities, tool/reasoning verdicts, reasoning options, cost, or the identity relation itself) are equivalent, and SHALL report `serving-ambiguous` when they differ materially. Neither catalog object iteration order nor the first record may decide, and a shortest-id tie-break SHALL never override an exact parsed-key match.

#### Scenario: equivalent serving records ignore record order
- **WHEN** several records of a proven provider match the deployment's parsed lookup key exactly and their serving publication-critical facts are identical
- **THEN** reordering the provider's `models` object keys selects the same record with the same provenance

#### Scenario: material record conflicts fail closed on every order
- **WHEN** several records of a proven provider match the same parsed lookup key exactly and their limits, capability facts, reasoning options, or cost differ materially
- **THEN** the group is reported `serving-ambiguous` and withheld regardless of record order

#### Scenario: conflicting original records never fall through to a reseller
- **WHEN** the declared serving provider holds several exact-parsed-key candidates whose serving publication-critical facts conflict
- **THEN** Core reports the group `serving-ambiguous`/withheld and never selects another provider's record, including OpenCode or OpenRouter

#### Scenario: relation-only candidates never resolve the SKU
- **WHEN** the declared serving provider holds only records matched through `canonical_model_id` (one or several, with identical or differing facts) and none matches the deployment's parsed lookup keys exactly
- **THEN** Core reports `serving-record-unresolved`, resolves the group from canonical or LiteLLM branches, and uses no provider facts, no provider price, and no provider reasoning levels

### Requirement: runtime constraints never conflict with serving metadata
Resolution SHALL separate LiteLLM descriptive declarations from proven runtime enforcement. A key promoted through the runtime enforcement matrix of the `modelsdev-catalog` capability narrows the effective value of its own dimension and never participates in same-level conflict judgment, whatever the base (proven serving, canonical, or LiteLLM-declared). The proven set starts empty, so until a promotion delta merges, no `litellm_params` key narrows anything; `litellm_params.max_tokens`, `max_output_tokens`, and `max_completion_tokens` are request-overridable operator configuration and never cap the output. Unproven provider records never form a base and therefore never conflict with anything.

#### Scenario: fallback serving limit narrowed by an enforced cap
- **WHEN** a `litellm_params` key has been promoted to hard-enforced by a runtime-enforcement delta and the base limit of that key's dimension comes from a proven serving record or the canonical registry
- **THEN** Core publishes the narrowed effective value and records an enforcement-narrowed resolution, not an unresolved conflict; before such a promotion exists the resolved value stays unchanged and the key appears only in diagnostics

#### Scenario: descriptive disagreement with fallback serving still conflicts
- **WHEN** an unproven provider record (including an exact same-name OpenCode or OpenRouter record) declares a value different from a LiteLLM descriptive declaration
- **THEN** the record contributes no evidence and creates no conflict; only explicit disagreement between deployments remains an unresolved conflict

