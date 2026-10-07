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
Core SHALL resolve reasoning support independently from reasoning levels. Reasoning support SHALL follow the field resolution matrix of the `modelsdev-catalog` capability: a proven serving value, else the canonical registry value, else consistent LiteLLM declarations, else unknown; an explicitly enforced `litellm_params.supports_reasoning: false` narrows support per the runtime enforcement matrix, and a differing `model_info.supports_reasoning` against a serving or canonical base is a resolved discrepancy. Reasoning levels follow the `Reasoning controls authority` requirement.

#### Scenario: reasoning sources disagree
- **WHEN** canonical identity is proven and LiteLLM `model_info` declares reasoning support differently from the canonical registry entry
- **THEN** the canonical value determines support and diagnostics report a resolved discrepancy

#### Scenario: enforced reasoning constraint
- **WHEN** a deployment declares `litellm_params.supports_reasoning: false`
- **THEN** Core reports reasoning unsupported as an enforcement-narrowed value

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

### Requirement: runtime constraints never conflict with serving metadata
Resolution SHALL separate LiteLLM descriptive declarations from proven runtime enforcement. A key promoted through the runtime enforcement matrix of the `modelsdev-catalog` capability narrows the effective value of its own dimension and never participates in same-level conflict judgment, whatever the base (proven serving, canonical, or LiteLLM-declared). The proven set starts empty, so until a promotion delta merges, no `litellm_params` key narrows anything; `litellm_params.max_tokens`, `max_output_tokens`, and `max_completion_tokens` are request-overridable operator configuration and never cap the output. Unproven provider records never form a base and therefore never conflict with anything.

#### Scenario: fallback serving limit narrowed by an enforced cap
- **WHEN** a `litellm_params` key has been promoted to hard-enforced by a runtime-enforcement delta and the base limit of that key's dimension comes from a proven serving record or the canonical registry
- **THEN** Core publishes the narrowed effective value and records an enforcement-narrowed resolution, not an unresolved conflict; before such a promotion exists the resolved value stays unchanged and the key appears only in diagnostics

#### Scenario: descriptive disagreement with fallback serving still conflicts
- **WHEN** an unproven provider record (including an exact same-name OpenCode or OpenRouter record) declares a value different from a LiteLLM descriptive declaration
- **THEN** the record contributes no evidence and creates no conflict; only explicit disagreement between deployments remains an unresolved conflict

## REMOVED Requirements

### Requirement: capability fallback preserves operational limits
**Reason**: Unproven same-name reseller records no longer supply limits for any model; registered models use canonical limits and unregistered models need a proven serving record or complete LiteLLM declarations.
**Migration**: See `modelsdev-catalog` `Unproven provider records never supply publication facts` and `Field resolution matrix`; the `hy4-preview` case is covered by acceptance R7 (canonical `tencent/hy4-preview`).

### Requirement: capability-first provider fallback
**Reason**: Provider-record precedence (explicit provider > canonical-original > OpenCode > OpenRouter > unique) conflated canonical identity with serving selection, used reverse relation fan-out, let unproven same-name reseller records supply publication facts, treated canonical-original serving records as intrinsic, and treated LiteLLM adapter prefixes as lab namespaces (rule B).
**Migration**: Canonical identity, serving provider proof, and unregistered-model fallback are specified by the `modelsdev-catalog` capability (`Wire-ID parsing carries no authority`, `Canonical identity resolution`, `Serving provider proof`, `Unproven provider records never supply publication facts`).

### Requirement: capability fallback pricing is non-authoritative
**Reason**: Superseded by a single price authority rule that covers every unproven provider record, not only capability fallback.
**Migration**: See `modelsdev-catalog` `Price authority`.

### Requirement: fallback metadata is secondary evidence
**Reason**: The graded authority of `canonical-original`, `explicit-provider` with relation, and route-namespace proof is replaced by explicit fact classes; explicit-provider records without a relation now prove serving by operator declaration.
**Migration**: See `modelsdev-catalog` `Fact classes are resolved separately`, `Serving provider proof`, `Unproven provider records never supply publication facts`, and `Field resolution matrix`.
