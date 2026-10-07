# Delta: modelsdev-catalog

## ADDED Requirements

### Requirement: Catalog input contract
Core SHALL consume the models.dev catalog as one snapshot containing both the provider-agnostic canonical registry (`models`) and the provider-specific serving records (`providers`), and SHALL classify every supplied catalog value as `complete`, `providers-only`, or `unavailable` before any identity or field resolution. A `providers-only` value (the legacy `api.json` shape) cannot prove that a canonical model is absent, so Core SHALL NOT perform canonical or fallback-serving resolution from it and SHALL treat it like an unavailable catalog: models whose LiteLLM declarations are complete stay publishable as LiteLLM-declared, every other model is `metadata-unavailable`, and Last Known Good may still apply. Adapters SHALL only fetch and cache the raw catalog; shape validation, registry availability, identity, authority, and merge SHALL stay in Core.

#### Scenario: Complete catalog snapshot
- **WHEN** the supplied value has top-level `providers` and `models` objects and the `models` keys are `<lab>/<model>` identities
- **THEN** Core classifies it `complete` and uses `models` as the only canonical registry and `providers` as the only serving-record source

#### Scenario: Legacy provider-only payload fails closed
- **WHEN** the supplied value is a provider map without a canonical registry
- **THEN** Core classifies it `providers-only`, reports the registry as unavailable in diagnostics, never selects a provider record, publishes only models whose LiteLLM declarations are complete, and withholds the rest as `metadata-unavailable` unless a valid LKG entry restores them

#### Scenario: Unusable catalog value
- **WHEN** the supplied value is empty, not an object, or contains only one of `providers` / `models`
- **THEN** Core classifies it `unavailable` and keeps LiteLLM-only discovery and LKG behavior unchanged

### Requirement: Canonical identity resolution
Core SHALL resolve each deployment group to at most one canonical model identity, defined as a key of the canonical registry, using only deterministic evidence: (1) a qualified deployment identity whose full value, or whose value after removing the first route segment, exactly equals a registry key; (2) a bare model id whose last segment matches exactly one registry entry case-insensitively; (3) the `canonical_model_id` of a serving record selected under a proven serving provider. Candidates SHALL be evaluated per deployment in the order `model_info.base_model`, then `litellm_params.model`; a resolved `base_model` decides the deployment identity and a different route result is diagnostic only. A bare id SHALL resolve as `0 match -> no proof`, `1 match -> proven`, `>1 match -> ambiguous` and an ambiguous candidate SHALL stop evaluation for that deployment. Every deployment of a group SHALL resolve to the same canonical identity or the group is ambiguous. Model names (`model_name`), family names, prefixes, substrings, neighbor models, reverse relation fan-out, LiteLLM adapter prefixes, `custom_llm_provider`, `litellm_provider`, `model_info.key`, `api_base`, and credential names SHALL NOT be identity evidence.

#### Scenario: Unique bare id proves the canonical identity
- **WHEN** a deployment routes the bare id `x` and the registry contains exactly one entry whose model part is `x`
- **THEN** Core resolves canonical identity to that registry key with evidence `registry-unique`

#### Scenario: Duplicate bare id fails closed
- **WHEN** a deployment's bare id matches more than one registry entry
- **THEN** Core reports the group ambiguous, does not fall through to later candidates, and withholds it with an `identity-ambiguous` reason

#### Scenario: Qualified route proves the identity
- **WHEN** a deployment routes `openrouter/labA/x` or `labA/x` and `labA/x` is a registry key
- **THEN** Core resolves canonical identity `labA/x` with evidence `qualified-deployment` while the serving provider stays unproven

#### Scenario: Adapter prefix is not a lab namespace
- **WHEN** a deployment routes `openai/x` through an OpenAI-compatible adapter and the only registry entry for `x` is `labA/x`
- **THEN** Core resolves canonical identity `labA/x` and never treats `openai` as the canonical namespace or as the serving provider

#### Scenario: base_model alias decides identity
- **WHEN** a deployment's `base_model` resolves to one registry entry and its route resolves to a different one
- **THEN** Core uses the `base_model` identity and reports the route difference as a diagnostic, not a conflict

#### Scenario: Canonical and provider relation contradict
- **WHEN** deployment evidence resolves canonical identity `C` and the selected serving record under a proven serving provider declares `canonical_model_id` `C'` different from `C`
- **THEN** Core keeps `C` and records an identity discrepancy if the intrinsic publication-critical facts of `C` and `C'` are equivalent, and otherwise reports the group ambiguous and withholds it

#### Scenario: No heuristic identity
- **WHEN** only a name prefix, family, or substring relates a deployment to a registry entry
- **THEN** Core reports no canonical proof

### Requirement: Fact classes are resolved separately
Core SHALL keep five evidence classes separate: canonical identity (registry key), intrinsic model facts (the registry entry), serving provider facts (a serving record under a proven serving provider), deployment runtime constraints (enforced `litellm_params` keys), and LiteLLM descriptive declarations (`model_info`). Intrinsic facts SHALL come only from the canonical registry. `cost`, `reasoning_options`, `status`, `provider`, `interleaved`, and `experimental` SHALL be serving-only facts. A known canonical identity SHALL NOT imply a known serving provider, and a first-party, same-namespace, or canonical-original provider record SHALL NOT be treated as intrinsic metadata.

#### Scenario: First-party serving override is not intrinsic
- **WHEN** canonical identity is proven, the serving provider is unproven, and the lab's own provider record declares a context or output different from the registry entry
- **THEN** Core publishes the registry value and does not use the provider record

#### Scenario: Serving-only fields never come from the registry
- **WHEN** a resolved model needs price or reasoning levels
- **THEN** Core takes them only from LiteLLM declarations or a proven serving record, never from the canonical registry or an unproven provider record

### Requirement: Serving provider proof
Core SHALL treat the serving provider as proven only when every deployment of the group declares the same `model_info.models_dev_provider` and that provider exists in the catalog. Within the proven provider Core SHALL select the serving record whose key or id exactly equals the deployment wire id (raw, then without the first route segment, then the last segment); otherwise the single record whose `canonical_model_id` equals the canonical identity, or several such records whose serving publication-critical facts are equivalent. Materially different candidate records SHALL make the group `serving-ambiguous` and withheld. A declared provider without a matching record SHALL be `declared-unmatched`: serving facts stay unknown, intrinsic facts are published, and diagnostics warn. LiteLLM adapter prefixes, `custom_llm_provider`, and `api_base` SHALL NOT prove the serving provider.

#### Scenario: Declared serving provider supplies overrides
- **WHEN** `models_dev_provider: P` is declared and P holds a record whose id equals the wire id
- **THEN** that record's limits, modalities, tool and reasoning verdicts override intrinsic values with `serving-override` provenance, and its cost and reasoning levels become eligible

#### Scenario: Variant records are never chosen by relation
- **WHEN** a provider holds `x`, `x-free`, `x-fast`, and `x:thinking`, all declaring `canonical_model_id` for the same canonical model, and the wire id is `x`
- **THEN** Core selects only the exact `x` record and never a variant reached through the relation

#### Scenario: Declared provider without a record
- **WHEN** `models_dev_provider: P` is declared but P is absent or has no matching record
- **THEN** Core reports `declared-unmatched`, publishes intrinsic facts when otherwise complete, and warns in diagnostics

#### Scenario: Gateway adapter does not prove serving
- **WHEN** every deployment uses `custom_llm_provider: openai` or an `openai/` route through an OpenAI-compatible gateway
- **THEN** the serving provider stays unproven for every model, including models whose canonical lab is `openai`

### Requirement: Fallback only for unregistered models
Core SHALL NOT use an unproven provider record to supply intrinsic facts, limits, modalities, tool or reasoning verdicts, reasoning levels, or price when a canonical identity exists or cannot be ruled out. Fallback-serving metadata SHALL be used only when the catalog is `complete`, no candidate matches the registry, no serving provider is declared, and a provider record's key or id exactly equals the wire id; among exact records Core SHALL use an equivalent set, else OpenCode, else OpenRouter, else report ambiguous. Fallback values SHALL fill only dimensions LiteLLM does not declare, SHALL conflict at the same authority level with differing LiteLLM descriptive values, SHALL be narrowed by runtime constraints without conflict, SHALL never supply price or reasoning levels, SHALL never restore from LKG, and a fallback record's `canonical_model_id` SHALL be diagnostic only.

#### Scenario: Canonical model exists, reseller is ignored
- **WHEN** a registry entry exists for the deployment and OpenCode or OpenRouter records also serve it
- **THEN** no reseller value enters the resolved model or the ModelSpec

#### Scenario: Private model uses an exact reseller record
- **WHEN** the registry has no match, LiteLLM declares no limits, and exactly one OpenCode record has the same id as the wire id
- **THEN** Core fills limits from that record as `fallback-serving`, publishes no reseller price or reasoning levels, and marks the entry non-restorable from LKG

#### Scenario: Fallback disagrees with LiteLLM
- **WHEN** a fallback-serving value differs from a LiteLLM descriptive value in the same dimension
- **THEN** the field is an unresolved conflict and the model is withheld

### Requirement: Effective value algebra
Core SHALL compute each effective field as `base = proven serving value, else canonical intrinsic value, else fallback-serving value, else LiteLLM descriptive aggregate`, then narrow it by proven runtime constraints of the same dimension; a constraint SHALL never raise a value. Dimensions SHALL be compared like-for-like: `context` with total context only, `input` with input capacity only (`max_input_tokens`, `limit.input`; when the base has no input capacity the input base is the context), and `output` with output only; the only cross-dimension rule is the documented LiteLLM-only fallback of `max_input_tokens` as context when no models.dev value exists. A descriptive value that differs from a canonical or proven-serving base SHALL be a resolved discrepancy; one that differs from a fallback-serving base SHALL be an unresolved conflict; explicit disagreement between deployments SHALL remain an unresolved conflict. Booleans and modality sets SHALL follow the same base order, with explicit `litellm_params` `false` removing support.

#### Scenario: MiniMax-M3 without serving proof
- **WHEN** canonical `minimax/MiniMax-M3` declares context 1048576 and output 512000, the serving provider is unproven, and LiteLLM declares `max_input_tokens` 1000000 and `max_output_tokens` 131072
- **THEN** Core publishes context 1048576, input 1048576, output 512000, records input and output resolved discrepancies, and reports `configured`

#### Scenario: MiniMax-M3 served by MiniMax
- **WHEN** the same deployment declares `models_dev_provider: minimax` and the MiniMax record declares context 1000000 and output 512000
- **THEN** Core publishes context 1000000, input 1000000, output 512000 with `serving-override` context provenance and an output resolved discrepancy

#### Scenario: MiniMax-M3 served by a third party
- **WHEN** the same deployment declares `models_dev_provider: opencode` and `opencode/minimax-m3` declares context 512000 and output 128000 with `canonical_model_id` `minimax/MiniMax-M3`
- **THEN** Core publishes context 512000, input 512000, output 128000 and records input and output resolved discrepancies

#### Scenario: MiniMax-M3 with runtime constraints
- **WHEN** the unproven-serving deployment also declares `litellm_params.max_tokens` 65536 and `max_input_tokens` 900000
- **THEN** Core publishes context 1048576, input 900000, output 65536 as constraint-narrowed values without a discrepancy or conflict

#### Scenario: Input capacity is never compared with total context
- **WHEN** the registry declares context 1050000 and input 922000 and LiteLLM declares `max_input_tokens` 922000
- **THEN** Core records no discrepancy for context or input

### Requirement: Reasoning controls authority
Core SHALL treat reasoning support as an intrinsic fact and selectable reasoning levels (`reasoning_options`) as serving-only facts. Levels SHALL come only from a proven serving record; when the serving provider is unproven or the model is resolved through fallback, Core SHALL report levels unknown and emit no variants. Supported reasoning with a known empty level set (including `toggle`-only options) SHALL be legal. LiteLLM per-effort support flags SHALL be descriptive diagnostics only.

#### Scenario: Unproven serving has no selectable levels
- **WHEN** canonical identity is proven, reasoning is supported, and no serving provider is declared while several providers publish different `reasoning_options`
- **THEN** Core reports reasoning supported, levels unknown, and no variants

#### Scenario: Proven serving levels
- **WHEN** a declared serving record publishes effort values
- **THEN** Core emits exactly those variants for the resolved protocol

#### Scenario: Supported reasoning without levels
- **WHEN** the proven serving record declares only a `toggle` option
- **THEN** Core reports reasoning supported with a known empty level set

### Requirement: Price authority
Core SHALL take model price from explicit LiteLLM per-token prices first (highest across deployments), else from the `cost` of a proven serving record, else report it unknown. Canonical registry entries carry no price, and unproven provider records — first-party, canonical-original, or fallback — SHALL never supply a price.

#### Scenario: Unproven serving keeps price unknown
- **WHEN** LiteLLM declares no price and the serving provider is unproven while the lab's own record has a cost
- **THEN** Core reports price unknown

#### Scenario: Declared serving price
- **WHEN** LiteLLM declares no price and `models_dev_provider: P` selects a record with a cost
- **THEN** Core uses that cost and records serving provenance

### Requirement: Single resolution result
Core SHALL resolve each deployment group once into a single resolved model result containing identity, serving status, every field resolution with provenance, publication status, reasons, discrepancies, conflicts, and LKG authority. `buildModelSpecs`, the publication assessment and partition, diagnostics, LKG capture, and LKG validation SHALL all derive from that result, and the ModelSpec SHALL be produced by one projection of it.

#### Scenario: Gate and configuration cannot diverge
- **WHEN** any discovery input is evaluated
- **THEN** every publishable entry's ModelSpec limits, tools, reasoning verdict, and modalities equal the assessment's resolved values, `buildModelSpecs` equals the diagnostics models, and an LKG captured from the round stores the same facts

#### Scenario: No cross-provider field inheritance
- **WHEN** a selected serving record omits a field
- **THEN** Core never copies that field from another provider's record; intrinsic defaults come only from the canonical registry

### Requirement: Last Known Good schema 8
Core SHALL persist LKG entries with `schemaVersion` 8 that separate canonical identity (`canonical.modelID`, `canonical.evidence`) from serving proof (`serving.status`, `serving.providerID`, `serving.recordID`) and record one authority of `canonical-intrinsic`, `serving-declared`, `litellm-declared`, or `fallback-serving`. During a metadata outage, `canonical-intrinsic` and `litellm-declared` entries SHALL restore when the deployments' stable identity is unchanged; `serving-declared` entries SHALL additionally require the same live serving declaration; `fallback-serving` entries SHALL never restore. When live metadata is available, validation SHALL compare canonical identity, serving status and provider, resolved values, and runtime constraints like-for-like, and a change of the unproven serving provider record alone SHALL NOT invalidate a `canonical-intrinsic` entry. Entries with any other schema version or an unknown authority SHALL fail closed.

#### Scenario: Canonical entry survives outage
- **WHEN** a `canonical-intrinsic` entry exists, the catalog is unavailable, and the stable identity is unchanged
- **THEN** Core reports `configured-lkg`

#### Scenario: Serving declaration removed
- **WHEN** a `serving-declared` entry exists and the live deployment no longer declares the same `models_dev_provider`
- **THEN** Core rejects the entry

#### Scenario: Schema 7 entry fails closed
- **WHEN** a stored entry has `schemaVersion` 7 or lower
- **THEN** Core rejects it without migration and a later live round recaptures it

### Requirement: Catalogue-wide regression evidence
Core SHALL keep an automated catalogue-wide check that runs the resolver over every canonical registry entry in representative deployment shapes and asserts that no canonical model is withheld when LiteLLM declares canonical-equal facts, that no unproven provider record contributes facts, that no variant record is selected, and that published values equal canonical intrinsic or proven serving values. The offline suite SHALL run the same assertions on a committed real-schema catalog subset.

#### Scenario: Offline catalogue assertions
- **WHEN** the offline test suite runs
- **THEN** the real-schema catalog subset satisfies every catalogue-wide assertion without network access
