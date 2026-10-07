# Delta: discovery-quality

## MODIFIED Requirements

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
Core SHALL resolve reasoning support independently from reasoning levels. Reasoning support SHALL follow the effective value algebra: a proven serving value, else the canonical intrinsic value, else fallback-serving, else LiteLLM declarations; an explicit `litellm_params.supports_reasoning: false` narrows support, and a differing `model_info.supports_reasoning` against a canonical or proven-serving value is a resolved discrepancy.

#### Scenario: reasoning sources disagree
- **WHEN** canonical identity is proven and LiteLLM `model_info` declares reasoning support differently from the canonical registry entry
- **THEN** the canonical value determines support and diagnostics report a resolved discrepancy

#### Scenario: enforced reasoning constraint
- **WHEN** a deployment declares `litellm_params.supports_reasoning: false`
- **THEN** Core reports reasoning unsupported as a constraint-narrowed value

### Requirement: token-limit semantics
Core SHALL preserve separate context, input, and output token-limit meanings and SHALL compare evidence only within the same dimension. LiteLLM `max_input_tokens` is input capacity; it SHALL be compared with `limit.input` (or with the context when no input capacity is declared) and SHALL become a context value only in the documented LiteLLM-only fallback when no models.dev value exists.

#### Scenario: total context differs from input limit
- **WHEN** the canonical registry supplies total context and an input capacity and LiteLLM declares an equal `max_input_tokens`
- **THEN** Core preserves the total context, uses the input capacity, and records no discrepancy

#### Scenario: LiteLLM input differs from canonical input
- **WHEN** LiteLLM declares a `max_input_tokens` different from the canonical input capacity
- **THEN** Core records an input-dimension resolved discrepancy and never a context discrepancy

### Requirement: capability fallback preserves operational limits
A fallback-serving record for a model absent from the canonical registry SHALL populate valid limits for dimensions LiteLLM does not declare, while explicit LiteLLM pricing remains authoritative and the fallback record never supplies price or reasoning levels.

#### Scenario: hy4-preview is routed through an OpenAI-compatible LiteLLM deployment
- **WHEN** LiteLLM exposes `hy4-preview` without token limits and with explicit token prices, the canonical registry contains `tencent/hy4-preview`, and OpenRouter also serves it
- **THEN** Core emits the canonical intrinsic context/output limits, preserves the LiteLLM prices, uses no OpenRouter limit or reasoning variant, and does not emit a models-dev-unmatched warning

#### Scenario: private model is routed through an OpenAI-compatible LiteLLM deployment
- **WHEN** LiteLLM exposes a model absent from the canonical registry without token limits, exactly one OpenCode or OpenRouter record has the same id, and LiteLLM explicitly provides token prices
- **THEN** Core emits non-zero context/output limits from that record as `fallback-serving`, preserves the LiteLLM prices, and emits no reasoning variants from the record

#### Scenario: registered model never uses capability fallback
- **WHEN** the model id is present in the canonical registry
- **THEN** Core uses the canonical intrinsic limits and never a reseller record's limits

### Requirement: record-level selection determinism
Within a proven serving provider, Core SHALL select the serving record by exact wire id first; otherwise, among records whose `canonical_model_id` equals the canonical identity, Core SHALL pick deterministically only when their serving publication-critical facts (limits, modalities, tool/reasoning verdicts, reasoning options, cost) are equivalent, and SHALL keep the provider match set unresolved when they differ materially. Neither catalog object iteration order nor the first record may decide, and a shortest-id tie-break SHALL never override an exact wire id match.

#### Scenario: equivalent serving records ignore record order
- **WHEN** a proven provider holds several records relation-pointing at the canonical identity, none matches the wire id exactly, and their serving publication-critical facts are identical
- **THEN** reordering the provider's `models` object keys selects the same record with the same provenance

#### Scenario: material record conflicts fail closed on every order
- **WHEN** a proven provider holds several relation records whose limits, capability facts, reasoning options, or cost differ materially and none matches the wire id
- **THEN** the group is reported `serving-ambiguous` and withheld regardless of record order

#### Scenario: conflicting original records never fall through to a reseller
- **WHEN** the declared serving provider holds several records relation-pointing at the canonical identity whose serving publication-critical facts conflict and none matches the wire id
- **THEN** Core reports the group `serving-ambiguous`/withheld and never selects another provider's record, including OpenCode or OpenRouter

#### Scenario: exact wire id wins over a shorter relation record
- **WHEN** a proven provider holds `x-sol` matching the wire id and a shorter record `x` whose `canonical_model_id` names the same canonical model
- **THEN** Core selects `x-sol`

## REMOVED Requirements

### Requirement: capability-first provider fallback
**Reason**: Provider-record precedence (explicit provider > canonical-original > OpenCode > OpenRouter > unique) conflated canonical identity with serving selection and used reverse relation fan-out; canonical-original and route-namespace (rule B) selection treated serving records as intrinsic and LiteLLM adapter prefixes as lab namespaces.
**Migration**: Canonical identity, serving provider proof, and unregistered-model fallback are specified by the `modelsdev-catalog` capability (`Canonical identity resolution`, `Serving provider proof`, `Fallback only for unregistered models`).

### Requirement: capability fallback pricing is non-authoritative
**Reason**: Superseded by a single price authority rule that covers every unproven provider record, not only capability fallback.
**Migration**: See `modelsdev-catalog` `Price authority`.

### Requirement: fallback metadata is secondary evidence
**Reason**: The graded authority of `canonical-original`, `explicit-provider` with relation, and route-namespace proof is replaced by explicit fact classes; explicit-provider records without a relation now prove serving by operator declaration.
**Migration**: See `modelsdev-catalog` `Fact classes are resolved separately`, `Serving provider proof`, `Fallback only for unregistered models`, and `Effective value algebra`.
