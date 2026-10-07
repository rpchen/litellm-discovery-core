# Delta: modelsdev-catalog

## ADDED Requirements

### Requirement: Catalog input contract
Core SHALL consume the models.dev catalog as one snapshot containing both the provider-agnostic canonical registry (`models`) and the provider-specific serving records (`providers`), and SHALL classify every supplied catalog value as `complete`, `providers-only`, or `unavailable` before any identity or field resolution. A `providers-only` value (the legacy `api.json` shape) cannot prove canonical identity, so Core SHALL treat it like an unavailable catalog: it SHALL NOT resolve canonical identity or use any provider record; models whose LiteLLM declarations are complete stay publishable as LiteLLM-declared, every other model is `metadata-unavailable`, and Last Known Good may still apply. Adapters SHALL only fetch and cache the raw catalog; shape validation, registry availability, identity, authority, and merge SHALL stay in Core.

#### Scenario: Complete catalog snapshot
- **WHEN** the supplied value has top-level `providers` and `models` objects and the `models` keys are `<lab>/<model>` identities
- **THEN** Core classifies it `complete` and uses `models` as the only canonical registry and `providers` as the only serving-record source

#### Scenario: Legacy provider-only payload fails closed
- **WHEN** the supplied value is a provider map without a canonical registry
- **THEN** Core classifies it `providers-only`, reports the registry as unavailable in diagnostics, never uses a provider record, publishes only models whose LiteLLM declarations are complete, and withholds the rest as `metadata-unavailable` unless a valid LKG entry restores them

#### Scenario: Unusable catalog value
- **WHEN** the supplied value is empty, not an object, or contains only one of `providers` / `models`
- **THEN** Core classifies it `unavailable` and keeps LiteLLM-only discovery and LKG behavior unchanged

### Requirement: Wire-ID parsing carries no authority
Core SHALL parse each deployment candidate value (`model_info.base_model`, then `litellm_params.model`) into lookup keys only: the full value, the value without its first route segment, and the last segment, compared case-insensitively without folding separators or semantic suffixes. The removed route segment and `litellm_params.custom_llm_provider` SHALL be recorded as parse metadata for diagnostics and SHALL NOT prove a lab namespace, a canonical identity, or a serving provider. Whether a segment is a LiteLLM adapter SHALL NOT be decided by Core; only an exact registry match (canonical identity) or an operator declaration (serving provider) proves anything.

#### Scenario: Adapter segment is parse metadata only
- **WHEN** a deployment routes `openai/mimo-v2.6-pro` with `custom_llm_provider: openai`
- **THEN** Core uses `mimo-v2.6-pro` as a lookup key, records `openai` as parse metadata, and neither the canonical lab nor the serving provider is `openai`

#### Scenario: Reseller route resolves identity but not serving
- **WHEN** a deployment routes `openrouter/xiaomi/mimo-v2.6-pro` and `xiaomi/mimo-v2.6-pro` is a registry key
- **THEN** Core proves canonical identity `xiaomi/mimo-v2.6-pro` and the serving provider stays unproven; OpenRouter is not inferred as the serving provider

#### Scenario: Default adapter is not a serving proof
- **WHEN** a deployment routes `deepseek/deepseek-chat` with no visible custom `api_base`
- **THEN** Core may prove canonical identity from the registry but never infers `deepseek` as the serving provider

### Requirement: Canonical identity resolution
Core SHALL resolve each deployment group to at most one canonical model identity, defined as a key of the canonical registry, using only: (1) a candidate's full value or its value without the first route segment exactly equal to a registry key (`qualified-deployment`); (2) a candidate's last segment matching exactly one registry entry (`registry-unique`); (3) the `canonical_model_id` of a serving record selected under a proven serving provider (`serving-relation`). Candidates SHALL be evaluated per deployment in the order `model_info.base_model`, then `litellm_params.model`; a resolved `base_model` decides the deployment identity and a different route result is diagnostic only. A last-segment lookup SHALL resolve as `0 match -> no proof`, `1 match -> proven`, `>1 match -> ambiguous` and an ambiguous candidate SHALL stop evaluation for that deployment. Every deployment of a group SHALL resolve to the same canonical identity or the group is ambiguous. Model names (`model_name`), family names, prefixes, substrings, neighbor models, reverse relation fan-out, `litellm_provider`, `model_info.key`, `api_base`, and credential names SHALL NOT be identity evidence.

#### Scenario: Unique bare id proves the canonical identity
- **WHEN** a deployment routes the bare id `x` and the registry contains exactly one entry whose model part is `x`
- **THEN** Core resolves canonical identity to that registry key with evidence `registry-unique`

#### Scenario: Duplicate bare id fails closed
- **WHEN** a deployment's last segment matches more than one registry entry
- **THEN** Core reports the group ambiguous, does not fall through to later candidates, and withholds it with an `identity-ambiguous` reason

#### Scenario: Qualified route proves the identity
- **WHEN** a deployment routes `labA/x` or `openrouter/labA/x` and `labA/x` is a registry key
- **THEN** Core resolves canonical identity `labA/x` with evidence `qualified-deployment` while the serving provider stays unproven

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
Core SHALL keep separate: canonical identity (registry key), intrinsic model facts (the registry entry), serving provider facts (a serving record under a proven serving provider), deployment runtime constraints (operator-configured `litellm_params` keys), LiteLLM descriptive declarations (`model_info`), and wire-ID parse metadata. Intrinsic facts SHALL come only from the canonical registry. `cost` and `reasoning_options` SHALL be serving-only facts. A known canonical identity SHALL NOT imply a known serving provider, and a first-party, same-namespace, or canonical-original provider record SHALL NOT be treated as intrinsic metadata.

#### Scenario: First-party serving override is not intrinsic
- **WHEN** canonical identity is proven, the serving provider is unproven, and the lab's own provider record declares a context or output different from the registry entry
- **THEN** Core publishes the registry value and does not use the provider record

#### Scenario: Serving-only fields never come from the registry
- **WHEN** a resolved model needs price or reasoning levels
- **THEN** Core takes them only from LiteLLM operator configuration or a proven serving record, never from the canonical registry or an unproven provider record

### Requirement: Serving provider proof
Core SHALL treat the serving provider as proven only when every deployment of the group declares the same `model_info.models_dev_provider` and that provider exists in the catalog. Within the proven provider Core SHALL select the serving record whose key or id exactly equals a parsed lookup key (full, then without the first segment, then last segment); otherwise the single record whose `canonical_model_id` equals the canonical identity, or several such records whose serving publication-critical facts (limits, modalities, tool/reasoning verdicts, reasoning options, cost) are equivalent. Materially different candidate records SHALL make the group `serving-ambiguous` and withheld. A declared provider without a matching record SHALL be `declared-unmatched`: serving facts stay unknown, the model resolves as if serving were unproven, and diagnostics warn. Route segments, `custom_llm_provider`, and `api_base` SHALL NOT prove the serving provider.

#### Scenario: Declared serving provider supplies overrides
- **WHEN** `models_dev_provider: P` is declared and P holds a record whose id equals the wire id
- **THEN** that record's limits, modalities, tool and reasoning verdicts override intrinsic values with `serving` basis, and its cost and reasoning options become eligible

#### Scenario: Variant records are never chosen by relation
- **WHEN** a provider holds `x`, `x-free`, `x-fast`, and `x:thinking`, all declaring `canonical_model_id` for the same canonical model, and the wire id is `x`
- **THEN** Core selects only the exact `x` record and never a variant reached through the relation

#### Scenario: Declared provider without a record
- **WHEN** `models_dev_provider: P` is declared but P is absent or has no matching record
- **THEN** Core reports `declared-unmatched`, resolves the model as serving-unproven, and warns in diagnostics

#### Scenario: Gateway adapter does not prove serving
- **WHEN** every deployment uses `custom_llm_provider: openai` or an `openai/` route through an OpenAI-compatible gateway
- **THEN** the serving provider stays unproven for every model, including models whose canonical lab is `openai`

### Requirement: Unproven provider records never supply publication facts
Core SHALL NOT use any provider record that is not the selected record of a proven serving provider — including OpenCode, OpenRouter, unique-match, first-party, variant, and records whose id exactly equals the wire id — to supply limits, modalities, tool or reasoning verdicts, reasoning levels, price, or release metadata, whether or not a canonical registry entry exists. When the registry has no entry for a group, Core SHALL use a proven serving record if one is selected, else the LiteLLM-only path when LiteLLM declares every gated fact, else withhold the model. Unproven exact-id records MAY be listed as diagnostic candidates (ordered OpenCode, OpenRouter, others) explaining which `models_dev_provider` declaration would select them; they SHALL NOT affect resolution, the ModelSpec, the publication gate, or LKG.

#### Scenario: Canonical model exists, reseller is ignored
- **WHEN** a registry entry exists for the deployment and OpenCode or OpenRouter records also serve it
- **THEN** no reseller value enters the resolved model or the ModelSpec

#### Scenario: Unregistered model with a same-name reseller record
- **WHEN** the registry has no match, no serving provider is declared, LiteLLM declares no limits, and an OpenCode and an OpenRouter record have the same id as the wire id
- **THEN** Core withholds the model as incomplete, lists both records as diagnostic candidates, and uses neither for any value

#### Scenario: Unregistered model with complete LiteLLM declarations
- **WHEN** the registry has no match and LiteLLM declares every gated fact consistently across deployments
- **THEN** Core publishes the model from LiteLLM declarations with `litellm-declared` basis even if same-name reseller records exist

#### Scenario: Unregistered model with a declared serving record
- **WHEN** the registry has no match and `models_dev_provider: P` selects a record of P
- **THEN** Core resolves the model from that serving record with `serving` basis

### Requirement: Field resolution matrix
Core SHALL resolve every publication field independently with base order `serving` (serving provider proven and the selected record declares the field), else `canonical` (canonical identity proven and the registry entry declares the field), else `litellm-declared` (every deployment declares it consistently), else `unknown`; a serving record that omits a field falls back to the canonical value. The effective value SHALL be the base narrowed by operator runtime constraints of the same dimension, which never raise a value. A LiteLLM descriptive value that differs from a `serving` or `canonical` base SHALL be a resolved discrepancy; explicit disagreement between deployments SHALL remain an unresolved conflict; a partially declared LiteLLM field SHALL stay unknown. Per field: `limit.context` from `limit.context` (LiteLLM-only: `max_input_tokens` only when no models.dev value exists) with no runtime constraint; `limit.input` from `limit.input`, else LiteLLM `max_input_tokens`, else derived from the effective context, narrowed by `litellm_params.max_input_tokens` and never above context, compared only with input evidence; `limit.output` from `limit.output`, else `max_output_tokens`/`max_tokens`, narrowed by `litellm_params.max_tokens`/`max_output_tokens`/`max_completion_tokens`; tools from `tool_call`, else `supports_function_calling`, narrowed by `litellm_params.supports_function_calling: false`; reasoning support from `reasoning`, else `supports_reasoning`, narrowed by `litellm_params.supports_reasoning: false`; input/output modalities from the `modalities` list, which is a complete set (listed means supported, unlisted means unsupported) while an absent `modalities` object means unknown, else the sparse LiteLLM flag rules, with an explicit `litellm_params` flag `false` removing a modality; release date from the canonical entry, else a proven serving record, else unknown. `limit.context`, `limit.output`, tools, reasoning support, and both modality directions are gated; `limit.input`, reasoning levels, price, and release date are not.

#### Scenario: Canonical field missing falls to LiteLLM declaration
- **WHEN** canonical identity is proven, the registry entry has no `limit.output`, no serving provider is declared, and every deployment declares the same `max_output_tokens`
- **THEN** Core uses that value with `litellm-declared` basis and the model remains publishable when otherwise complete

#### Scenario: Serving record omits a field
- **WHEN** the serving provider is proven and its record omits `limit.input` while the registry entry declares it
- **THEN** Core uses the canonical `limit.input`

#### Scenario: Modality list is a complete set
- **WHEN** the registry entry lists input modalities `text, image` and LiteLLM declares `supports_audio_input: true`
- **THEN** Core reports audio unsupported and records a resolved discrepancy

#### Scenario: Absent modalities object is unknown
- **WHEN** the canonical entry has no `modalities` object, no serving provider is declared, and LiteLLM declares only `supports_vision`
- **THEN** input modalities are unknown and the model is withheld as incomplete, never published as text-only

#### Scenario: MiniMax-M3 without serving proof
- **WHEN** canonical `minimax/MiniMax-M3` declares context 1048576 and output 512000, the serving provider is unproven, and LiteLLM declares `max_input_tokens` 1000000 and `max_output_tokens` 131072
- **THEN** Core publishes context 1048576, input 1048576, output 512000, records input and output resolved discrepancies, and reports `configured`

#### Scenario: MiniMax-M3 served by MiniMax
- **WHEN** the same deployment declares `models_dev_provider: minimax` and the MiniMax record declares context 1000000 and output 512000
- **THEN** Core publishes context 1000000, input 1000000, output 512000 with `serving` basis and an output resolved discrepancy

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
Core SHALL treat reasoning support as a field of the resolution matrix and selectable reasoning levels as a separate, non-gated fact with states `unknown` and `known` (possibly empty). Levels SHALL come only from (1) the `reasoning_options` of a proven serving record, or (2) operator configuration in `litellm_params`; `litellm_params.reasoning_effort` pins the effort, so Core SHALL publish a known empty level set and record the fixed effort, overriding serving options. A canonical `reasoning: true`, first-party or other unproven provider records, `model_info.supports_*_reasoning_effort`, `model_info.supported_openai_params`, and `litellm_params.allowed_openai_params` SHALL NOT produce levels and are diagnostic only. With no such evidence Core SHALL report levels unknown and emit no variants without withholding the model.

#### Scenario: Unproven serving has no selectable levels
- **WHEN** canonical identity is proven, reasoning is supported, no serving provider is declared, and the lab's own provider record publishes effort values
- **THEN** Core reports reasoning supported, levels unknown, and no variants

#### Scenario: Proven serving levels
- **WHEN** a declared serving record publishes effort values and no effort is pinned
- **THEN** Core emits exactly those variants for the resolved protocol

#### Scenario: Operator pinned effort
- **WHEN** a deployment declares `litellm_params.reasoning_effort: max`
- **THEN** Core reports a known empty level set with fixed effort `max` and emits no selectable variants, regardless of serving or first-party options

#### Scenario: Forwarded parameter is not a level set
- **WHEN** a deployment declares `litellm_params.allowed_openai_params` containing `reasoning_effort` and `model_info.supports_xhigh_reasoning_effort: true`
- **THEN** Core reports levels unknown unless a proven serving record supplies options

#### Scenario: Supported reasoning without levels
- **WHEN** the proven serving record declares only a `toggle` option or an empty list
- **THEN** Core reports reasoning supported with a known empty level set

### Requirement: Price authority
Core SHALL resolve each price component (input, output, cache read, cache write) independently from explicit LiteLLM per-token prices first (`litellm_params` before `model_info`, highest across deployments), else from the `cost` of a proven serving record, else report it unknown. Canonical registry entries carry no price, and unproven provider records SHALL never supply a price.

#### Scenario: Unproven serving keeps price unknown
- **WHEN** LiteLLM declares no price and the serving provider is unproven while the lab's own record has a cost
- **THEN** Core reports price unknown

#### Scenario: Declared serving price fills only undeclared components
- **WHEN** LiteLLM declares input and output prices and `models_dev_provider: P` selects a record with a cache read cost
- **THEN** Core uses the LiteLLM input and output prices and P's cache read cost, each with its own provenance

### Requirement: Single resolution result
Core SHALL resolve each deployment group once into a single resolved model result containing catalog shape, identity with parse metadata, serving status, every field resolution with its basis and evidence, reasoning level state, diagnostic candidates, publication status, reasons, discrepancies, conflicts, and the LKG proof. `buildModelSpecs`, the publication assessment and partition, diagnostics, LKG capture, and LKG validation SHALL all derive from that result, and the ModelSpec SHALL be produced by one projection of it.

#### Scenario: Gate and configuration cannot diverge
- **WHEN** any discovery input is evaluated
- **THEN** every publishable entry's ModelSpec limits, tools, reasoning verdict, modalities, and variants equal the resolved values, `buildModelSpecs` equals the diagnostics models, and an LKG captured from the round stores the same facts

#### Scenario: No cross-provider field inheritance
- **WHEN** a selected serving record omits a field
- **THEN** Core never copies that field from another provider's record; the fallback is only the canonical registry entry

### Requirement: Last Known Good schema 8 proof composition
Core SHALL persist LKG entries with `schemaVersion` 8 whose proof records the composition that produced the stored spec: the canonical identity with its evidence kind, normalized deployment input, and a digest of the used registry facts; the serving provider, record id, declaration, and a digest of the used serving facts when serving was proven; the basis of every field; a fingerprint of all deployments' runtime constraint keys; and, when any field basis is `litellm-declared`, a fingerprint of the LiteLLM declarations used. Validation SHALL re-prove every proof component and restore the whole stored spec or nothing; Core SHALL never merge stored and live facts per field. During a metadata outage an entry SHALL restore only when the stable identity, the deployment input, the serving declaration, the constraint fingerprint, and the LiteLLM fingerprint are unchanged; with a live catalog the canonical identity, the registry digest, and the serving record digest SHALL also match, while provider records not referenced by the proof SHALL NOT invalidate it. Entries with any other schema version, a missing proof component, or an unknown basis SHALL fail closed.

#### Scenario: Canonical entry survives outage
- **WHEN** an entry whose fields have `canonical` and `derived` basis exists, the catalog is unavailable, and every outage proof component is unchanged
- **THEN** Core reports `configured-lkg` with the whole stored spec

#### Scenario: Mixed composition is re-proven per component
- **WHEN** an entry's context has `canonical` basis, output has `serving` basis, and price has `litellm-declared` basis, and only the LiteLLM price declaration changed
- **THEN** Core rejects the whole entry instead of restoring any field

#### Scenario: Serving declaration removed
- **WHEN** an entry's proof includes a serving declaration and the live deployment no longer declares the same `models_dev_provider`
- **THEN** Core rejects the entry

#### Scenario: Unreferenced provider record change
- **WHEN** the live catalog changes a provider record that the entry's proof does not reference, and the registry digest is unchanged
- **THEN** the entry stays valid

#### Scenario: Schema 7 entry fails closed
- **WHEN** a stored entry has `schemaVersion` 7 or lower
- **THEN** Core rejects it without migration and a later live round recaptures it

### Requirement: Catalogue-wide regression evidence
Core SHALL keep an automated catalogue-wide check that runs the resolver over every canonical registry entry in representative deployment shapes and asserts that no canonical model is withheld when LiteLLM declares canonical-equal facts, that no unproven provider record contributes any value, that no variant record is selected, and that published values equal canonical, proven serving, LiteLLM-declared, or constraint-narrowed values according to the field resolution matrix. The offline suite SHALL run the same assertions on a committed real-schema catalog subset.

#### Scenario: Offline catalogue assertions
- **WHEN** the offline test suite runs
- **THEN** the real-schema catalog subset satisfies every catalogue-wide assertion without network access
