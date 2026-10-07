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

### Requirement: fallback metadata is secondary evidence
Core SHALL distinguish provider-scoped serving metadata obtained through fallback selection from canonical intrinsic evidence, and SHALL NOT publish fallback serving values as authoritative intrinsic facts. Unique trusted matches are fallback sources: only the canonical-original record, an explicit-provider record proven by its own deterministic canonical relation, or a record with the deployment's own qualified namespace proof carries authoritative intrinsic authority. Price eligibility follows the same graded authority: a selected record without authoritative intrinsic authority never donates its provider price as the route price.

#### Scenario: OpenRouter fallback serving limit is not authoritative
- **WHEN** an OpenRouter record is selected only as a fallback enrichment source and LiteLLM declares a smaller descriptive output limit
- **THEN** Core keeps the authoritative intrinsic authority unavailable, records the two conflicting values, and withholds the model instead of publishing the reseller serving limit as the model's intrinsic output

#### Scenario: unique trusted match is a fallback source
- **WHEN** a single remaining provider matches the candidate and LiteLLM declares a conflicting descriptive value
- **THEN** Core treats the unique-match record as fallback-serving evidence, reports an unresolved conflict instead of an authoritative override, and only fills genuinely undeclared fields

#### Scenario: explicit provider without a canonical relation proof
- **WHEN** an explicit `models_dev_provider` selects a record whose metadata carries no deterministic canonical relation
- **THEN** Core treats the selection as proof of the serving provider choice only, and the record limits behave as fallback-serving evidence instead of authoritative intrinsic facts

#### Scenario: explicit provider without a canonical relation proves no price
- **WHEN** an explicit `models_dev_provider` selects a record without a canonical relation while LiteLLM declares no token price
- **THEN** Core leaves deployment pricing unknown/zero; the explicitly selected record's provider price never becomes the route price

#### Scenario: explicit provider with a canonical relation follows the price fallback policy
- **WHEN** an explicit `models_dev_provider` selects a record that declares a deterministic canonical relation while LiteLLM declares no token price
- **THEN** Core may use that record's price under the established price fallback policy and records its provenance

#### Scenario: fallback serving metadata fills gaps only
- **WHEN** a fallback-selected record supplies limits or capability facts that no LiteLLM source declares
- **THEN** Core uses those values as fallback-serving provenance and they never outrank LiteLLM descriptive or constraint evidence

#### Scenario: canonical original remains authoritative
- **WHEN** the selected record is the canonical-original provider record or an explicit-provider record proven by its own canonical relation
- **THEN** its limit, modality, tool, and reasoning facts keep the authoritative intrinsic authority established by the trusted publication policy

### Requirement: record-level selection determinism
When one provider offers multiple records that match one candidate, Core SHALL collect every matching record and SHALL pick deterministically: records with provably equivalent publication-critical facts resolve through a record-intrinsic deterministic tie-break; records with materially different serving metadata and no ranking rule keep the whole provider match set unresolved. Neither the catalog object iteration order nor the first record may decide. This applies to every selection path, including the canonical-original path; conflicting original-provider candidates fail the candidate closed instead of letting a lower-precedence reseller record win.

#### Scenario: equivalent serving records ignore record order
- **WHEN** one provider holds several records that match the candidate and their publication-critical facts (limits, modalities, tool/reasoning verdicts, canonical relation target) are identical
- **THEN** reordering the provider's `models` object keys selects the same record with the same provenance

#### Scenario: material record conflicts fail closed on every order
- **WHEN** one provider holds several matching records whose limits or capability facts differ materially with no rule proving which serves the deployment
- **THEN** the provider's match set stays unresolved (ambiguous/withheld as applicable) regardless of record order, instead of silently selecting the first record

#### Scenario: conflicting original records never fall through to a reseller
- **WHEN** the canonical-original candidates for one candidate identity exist but their publication-critical facts conflict without a ranking rule
- **THEN** Core reports the candidate ambiguous/withheld and never selects an OpenCode or OpenRouter fallback record for it

### Requirement: runtime constraints never conflict with serving metadata
Resolution SHALL separate LiteLLM descriptive declarations from proven endpoint runtime constraints: a constraint narrows the effective value and never participates in same-level conflict judgment -- including against fallback-serving values.

#### Scenario: fallback serving limit narrowed by an enforced cap
- **WHEN** a fallback-serving record reports an output limit and the deployment's `litellm_params` proves a smaller enforced `max_tokens`
- **THEN** Core publishes the narrowed effective value and records a constraint-narrowed resolution, not an unresolved conflict

#### Scenario: descriptive disagreement with fallback serving still conflicts
- **WHEN** a fallback-serving record's value differs from a descriptive LiteLLM declaration (not a proven constraint)
- **THEN** the field stays an unresolved conflict at the same authority level
