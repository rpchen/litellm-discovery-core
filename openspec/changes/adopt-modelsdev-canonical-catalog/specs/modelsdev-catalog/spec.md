# Delta: modelsdev-catalog

## ADDED Requirements

### Requirement: Catalog input contract
Core SHALL consume the models.dev catalog as one snapshot containing both the provider-agnostic canonical registry (`models`) and the provider-specific serving records (`providers`), and SHALL classify every supplied catalog value as `complete`, `providers-only`, or `unavailable` before any identity or field resolution. The classification SHALL be exhaustive over every possible input: a value with both a valid `providers` object and a valid `models` object whose keys are `<lab>/<model>` identities is `complete`; a legacy provider map is `providers-only`; and every other value — empty, not an object, a `models`-only object, or shapes whose `providers` or `models` entries are not objects — is `unavailable`. Within `complete`, unknown extra top-level keys SHALL be ignored rather than invalidating the catalog, so future metadata fields never make the whole snapshot unusable. A `providers-only` value (the legacy `api.json` shape) cannot prove canonical identity, so Core SHALL treat it like an unavailable catalog: it SHALL NOT resolve canonical identity or use any provider record; models whose LiteLLM declarations are complete stay publishable as LiteLLM-declared, every other model is `metadata-unavailable`, and Last Known Good may still apply. Adapters SHALL only fetch and cache the raw catalog; shape validation, registry availability, identity, authority, and merge SHALL stay in Core.

#### Scenario: Complete catalog snapshot
- **WHEN** the supplied value has top-level `providers` and `models` objects and the `models` keys are `<lab>/<model>` identities
- **THEN** Core classifies it `complete` and uses `models` as the only canonical registry and `providers` as the only serving-record source

#### Scenario: Future top-level keys are ignored
- **WHEN** the supplied value additionally carries unknown top-level keys such as a generation timestamp or schema version
- **THEN** Core still classifies it `complete` and ignores the unknown keys

#### Scenario: Legacy provider-only payload fails closed
- **WHEN** the supplied value is a provider map without a canonical registry
- **THEN** Core classifies it `providers-only`, reports the registry as unavailable in diagnostics, never uses a provider record, publishes only models whose LiteLLM declarations are complete, and withholds the rest as `metadata-unavailable` unless a valid LKG entry restores them

#### Scenario: Unusable catalog value
- **WHEN** the supplied value is empty, not an object, or contains neither a `providers` nor a `models` object
- **THEN** Core classifies it `unavailable` and keeps LiteLLM-only discovery and LKG behavior unchanged

#### Scenario: Models-only value is unavailable
- **WHEN** the supplied value has a `models` object but no `providers` object
- **THEN** Core classifies it `unavailable`, because neither serving records nor serving resolution can run, and LiteLLM-only discovery with LKG behavior applies

### Requirement: Wire-ID parsing carries no authority
Core SHALL parse each deployment candidate value (`model_info.base_model`, then `litellm_params.model`) into lookup keys only, compared case-insensitively without folding separators or semantic suffixes. A candidate without a `/` produces its bare value. A candidate with a `/` produces its full value, and — only when `litellm_params.custom_llm_provider` is present and equals the first segment, which is LiteLLM's explicit adapter declaration — the remainder after that first segment. Core SHALL NOT take the last segment of an arbitrary qualified value as a bare lookup key: without adapter parse evidence there is no proof that a leading segment is transport syntax rather than a semantic part of the model id. The removed route segment and `custom_llm_provider` SHALL be recorded as parse metadata for diagnostics and SHALL NOT prove a lab namespace, a canonical identity, or a serving provider. Whether a segment is a LiteLLM adapter SHALL NOT be guessed by name; only an explicit `custom_llm_provider` match counts as parse evidence, and only an exact registry match (canonical identity) or an operator declaration (serving provider) proves anything.

#### Scenario: Adapter segment is parse metadata only
- **WHEN** a deployment routes `openai/mimo-v2.6-pro` with `custom_llm_provider: openai`
- **THEN** Core parses `mimo-v2.6-pro` as a bare lookup key via the adapter evidence, records `openai` as parse metadata, and neither the canonical lab nor the serving provider is `openai`

#### Scenario: Qualified value without adapter evidence only tries the full form
- **WHEN** a deployment routes `some-private-provider/foo` with no `custom_llm_provider` matching the first segment and no registry key `some-private-provider/foo`
- **THEN** Core does not look up the bare `foo`, does not resolve any canonical identity from it, and reports the candidate unproven

#### Scenario: Reseller route resolves identity but not serving
- **WHEN** a deployment routes `openrouter/xiaomi/mimo-v2.6-pro` with `custom_llm_provider: openrouter` and `xiaomi/mimo-v2.6-pro` is a registry key
- **THEN** Core proves canonical identity `xiaomi/mimo-v2.6-pro` through the parsed remainder and the serving provider stays unproven; OpenRouter is not inferred as the serving provider

#### Scenario: Default adapter is not a serving proof
- **WHEN** a deployment routes `deepseek/deepseek-chat` with no visible custom `api_base`
- **THEN** Core may prove canonical identity from the registry but never infers `deepseek` as the serving provider

### Requirement: Canonical identity resolution
Core SHALL resolve each deployment group to at most one canonical model identity, defined as a key of the canonical registry, using only: (1) a candidate's full value exactly equal to a registry key (`qualified-deployment`); (2) a candidate's parsed remainder after an adapter segment proven by `custom_llm_provider`, exactly equal to a registry key, or — when bare — matching exactly one registry entry (`qualified-deployment` or `registry-unique`); (3) a bare candidate matching exactly one registry entry (`registry-unique`); (4) the `canonical_model_id` of a serving record selected under a proven serving provider (`serving-relation`). Candidates SHALL be evaluated per deployment in the order `model_info.base_model`, then `litellm_params.model`; a resolved `base_model` decides the deployment identity and a different route result is diagnostic only. A bare lookup SHALL resolve as `0 match -> no proof`, `1 match -> proven`, `>1 match -> ambiguous` and an ambiguous candidate SHALL stop evaluation for that deployment. When both the deployment evidence and a proven serving record's `canonical_model_id` deterministically name a canonical identity and the two differ, Core SHALL report an identity conflict and fail closed: equal publication-critical facts SHALL NOT prove two registry keys the same model, and the models.dev catalog carries no equivalence relation that could reconcile them. Every deployment of a group SHALL resolve to the same canonical identity or the group is ambiguous. Model names (`model_name`), family names, prefixes, substrings, neighbor models, reverse relation fan-out, `litellm_provider`, `model_info.key`, `api_base`, and credential names SHALL NOT be identity evidence.

#### Scenario: Unique bare id proves the canonical identity
- **WHEN** a deployment routes the bare id `x` and the registry contains exactly one entry whose model part is `x`
- **THEN** Core resolves canonical identity to that registry key with evidence `registry-unique`

#### Scenario: Duplicate bare id fails closed
- **WHEN** a bare lookup matches more than one registry entry
- **THEN** Core reports the group ambiguous, does not fall through to later candidates, and withholds it with an `identity-ambiguous` reason

#### Scenario: Qualified route proves the identity
- **WHEN** a deployment routes `labA/x` or `openrouter/labA/x` with matching adapter evidence and `labA/x` is a registry key
- **THEN** Core resolves canonical identity `labA/x` with evidence `qualified-deployment` while the serving provider stays unproven

#### Scenario: base_model alias decides identity
- **WHEN** a deployment's `base_model` resolves to one registry entry and its route resolves to a different one
- **THEN** Core uses the `base_model` identity and reports the route difference as a diagnostic, not a conflict

#### Scenario: Canonical and provider relation contradict
- **WHEN** deployment evidence resolves canonical identity `C` and the selected serving record under a proven serving provider declares `canonical_model_id` `C'` different from `C`
- **THEN** Core reports an identity conflict, withholds the group as ambiguous, and never publishes a spec for either identity; equal limits, modalities, tool and reasoning facts SHALL NOT reconcile the contradiction

#### Scenario: No heuristic identity
- **WHEN** only a name prefix, family, or substring relates a deployment to a registry entry
- **THEN** Core reports no canonical proof

### Requirement: Fact classes are resolved separately
Core SHALL keep separate: canonical identity (registry key), intrinsic model facts (the registry entry), serving provider facts (a serving record under a proven serving provider with a resolved record), proven runtime enforcement (only `litellm_params` keys promoted by the runtime enforcement matrix, whose proven set starts empty), operator-declared pricing (the seven `MirroredPricingParams` keys of `litellm_params`, which LiteLLM explicitly mirrors into `model_info` and which are price facts, not enforcement and not capability facts), LiteLLM descriptive declarations (`model_info`), and wire-ID parse metadata. Intrinsic facts SHALL come only from the canonical registry. `cost` and `reasoning_options` SHALL be serving-only facts. A known canonical identity SHALL NOT imply a known serving provider, and a first-party, same-namespace, or canonical-original provider record SHALL NOT be treated as intrinsic metadata.

#### Scenario: First-party serving override is not intrinsic
- **WHEN** canonical identity is proven, the serving provider is unproven, and the lab's own provider record declares a context or output different from the registry entry
- **THEN** Core publishes the registry value and does not use the provider record

#### Scenario: Serving-only fields never come from the registry
- **WHEN** a resolved model needs price or reasoning levels
- **THEN** Core takes them only from LiteLLM operator configuration or a proven serving record, never from the canonical registry or an unproven provider record

### Requirement: Serving provider proof
Core SHALL treat the serving provider as proven only when every deployment of the group declares the same `model_info.models_dev_provider` and that provider exists in the catalog. Proving the provider does not prove the serving record or SKU. Within the proven provider Core SHALL resolve the serving record only when its key or id exactly equals a parsed lookup key (full form, then the adapter-evidenced remainder, then the bare form); records matching only through `canonical_model_id` prove the underlying canonical identity and never the served SKU, so without an exact lookup-key match the serving record is unresolved. Several exact lookup-key matches with materially different serving publication-critical facts (limits, modalities, tool/reasoning verdicts, reasoning options, cost) SHALL make the group `serving-ambiguous` and withheld. A declared provider with no candidate record SHALL be `declared-unmatched`, and a declared provider whose candidates match only through `canonical_model_id` SHALL be `serving-record-unresolved`: in both cases serving facts stay unknown, the group resolves through the canonical/LiteLLM branches as if serving were unproven, and diagnostics warn — no relation-only record (free/fast/thinking/tier variants) may supply serving facts. Route segments, `custom_llm_provider`, and `api_base` SHALL NOT prove the serving provider.

#### Scenario: Declared serving provider supplies overrides
- **WHEN** `models_dev_provider: P` is declared and P holds a record whose id equals the wire id
- **THEN** that record's limits, modalities, tool and reasoning verdicts override intrinsic values with `serving` basis, and its cost and reasoning options become eligible

#### Scenario: Variant records are never chosen by relation
- **WHEN** a provider holds `x`, `x-free`, `x-fast`, and `x:thinking`, all declaring `canonical_model_id` for the same canonical model, and the wire id is `x`
- **THEN** Core selects only the exact `x` record and never a variant reached through the relation

#### Scenario: Relation-only record under a declared provider is unresolved
- **WHEN** `models_dev_provider: gatewayX` is declared and gatewayX holds only `x-free` with `canonical_model_id` naming the canonical identity, while the wire id is `x`
- **THEN** Core resolves the group as serving-unproven from canonical or LiteLLM facts, reports `serving-record-unresolved`, and never uses `x-free`'s limits, price, or reasoning options

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
Core SHALL resolve every publication field independently by branch: when the serving provider is proven and the serving record is resolved, a field present in the record resolves from the record and a field the record omits follows that field's serving-absence policy; otherwise, when canonical identity is proven and the registry entry declares the field, it resolves from the registry; otherwise, when every deployment declares the field consistently under its declared-observable semantics, it resolves from LiteLLM; otherwise it is `unknown`. A serving-absence policy SHALL NOT refill the omitted field from the canonical registry entry, and SHALL permit only a same-dimension LiteLLM declaration to fill the gap. A proven serving record is the model's final serving view — models.dev's generator has already merged the canonical base, applied provider overrides, and applied `base_model_omit` deletions — so Core SHALL NOT refill a field the serving record omits from the canonical entry: an omitted field keeps its own absence semantics (for `limit.input`, unknown; for any field, never silently resuscitated), because a `base_model_omit` deletion is indistinguishable from a genuine provider gap in the generated JSON. The effective value SHALL be the base; narrowing applies only through keys promoted by the Runtime enforcement matrix requirement, whose proven set starts empty. A LiteLLM declared-observable value that differs from a `serving` or `canonical` base SHALL be a resolved discrepancy; explicit disagreement between deployments SHALL remain an unresolved conflict; a partially declared LiteLLM field SHALL stay unknown. No field SHALL ever be filled from a semantically different dimension: `model_info.max_input_tokens` is input capacity and SHALL NOT become `limit.context` under any circumstances, so a model with no context evidence from serving, canonical, or LiteLLM stays `context-unknown` and is withheld as incomplete. Per field: `limit.context` from `limit.context` only; `limit.input` from `limit.input`, else LiteLLM `max_input_tokens`, else unknown — a missing input fact SHALL NOT be derived from the context, because models.dev defines `limit.input` as an optional maximum-input-tokens field with no absent-equals-context contract, provider syncs intentionally leave it undefined, and `base_model_omit` deletions must stay deletions — compared only with input evidence; `limit.output` from `limit.output`, else `max_output_tokens`/`max_tokens`; tools from `tool_call`, else `supports_function_calling`; reasoning support from `reasoning`, else `supports_reasoning`; input/output modalities from the `modalities` list, which is a complete set (listed means supported, unlisted means unsupported) while an absent `modalities` object means unknown, else the sparse LiteLLM flag rules; release date from the canonical entry when proven, else a proven serving record, else unknown. `limit.context`, `limit.output`, tools, reasoning support, and both modality directions are gated; `limit.input`, reasoning levels, price, and release date are not.

#### Scenario: Serving view is final and omit-aware
- **WHEN** a proven serving record omits `limit.input` because models.dev's generator applied `base_model_omit = ["limit.input"]` (for example the `requesty/hy3` record derived from `tencent/hy3`), and the canonical entry declares `limit.input`
- **THEN** Core never refills the canonical value with a diagnostic naming the omission, and a same-dimension LiteLLM declaration may fill the gap as `litellm-declared`

#### Scenario: Canonical field missing falls to LiteLLM declaration
- **WHEN** canonical identity is proven, the registry entry has no `limit.output`, no serving provider is declared, and every deployment declares the same `max_output_tokens`
- **THEN** Core uses that value with `litellm-declared` basis and the model remains publishable when otherwise complete

#### Scenario: No dimension substitution for context
- **WHEN** canonical identity is unproven, no serving provider is declared, LiteLLM declares `max_input_tokens` and `max_output_tokens` but no total-context fact, and no provider record may supply facts
- **THEN** Core reports `limit.context` missing, withholds the model as incomplete, and never uses `max_input_tokens` as the context

#### Scenario: Modality list is a complete set
- **WHEN** the registry entry lists input modalities `text, image` and LiteLLM declares `supports_audio_input: true`
- **THEN** Core reports audio unsupported and records a resolved discrepancy

#### Scenario: Absent modalities object is unknown
- **WHEN** the canonical entry has no `modalities` object, no serving provider is declared, and LiteLLM declares only `supports_vision`
- **THEN** input modalities are unknown and the model is withheld as incomplete, never published as text-only

#### Scenario: MiniMax-M3 without serving proof
- **WHEN** canonical `minimax/MiniMax-M3` declares context 1048576 and output 512000 (no `limit.input`), the serving provider is unproven, and LiteLLM declares `max_input_tokens` 1000000 and `max_output_tokens` 131072
- **THEN** Core publishes context 1048576, input 1000000 (same-dimension LiteLLM fill, `litellm-declared`), output 512000, records an output resolved discrepancy, no input discrepancy, and reports `configured`

#### Scenario: MiniMax-M3 served by MiniMax
- **WHEN** the same deployment declares `models_dev_provider: minimax` and the MiniMax record declares context 1000000 and output 512000
- **THEN** Core publishes context 1000000, input 1000000, output 512000 with `serving` basis and an output resolved discrepancy

#### Scenario: MiniMax-M3 served by a third party
- **WHEN** the same deployment declares `models_dev_provider: opencode` and `opencode/minimax-m3` declares context 512000 and output 128000 with no `limit.input` and `canonical_model_id` `minimax/MiniMax-M3`
- **THEN** Core publishes context 512000, input 1000000 (the record's serving-absence policy: no canonical refill, same-dimension LiteLLM fill), output 128000, and records an output resolved discrepancy with no input discrepancy

#### Scenario: Configured input key does not narrow before promotion
- **WHEN** the unproven-serving deployment also declares `litellm_params.max_input_tokens` 900000 (operator configuration) while `model_info.max_input_tokens` is 1000000 and no runtime-enforcement promotion delta has merged
- **THEN** Core publishes context 1048576, input 1000000 (the LiteLLM same-dimension fill, unchanged by the configured key), output 512000, records the configured key in diagnostics, and reports no narrowing, no discrepancy, and no conflict from it

#### Scenario: Input capacity is never compared with total context
- **WHEN** the registry declares context 1050000 and input 922000 and LiteLLM declares `max_input_tokens` 922000
- **THEN** Core records no discrepancy for context or input

### Requirement: Runtime enforcement matrix
Core SHALL maintain a frozen per-key classification for LiteLLM `litellm_params` keys and SHALL NOT treat the presence of a key as proof of enforcement. The proven set of `hard-enforced` keys SHALL start empty: Core SHALL NOT narrow any field from `litellm_params` until a key is promoted by evidence. A key is promoted to `hard-enforced` only through an OpenSpec delta that provides both (1) an exact source path showing that LiteLLM reads that deployment key and rejects or rewrites a request that tries to break it, and (2) an automated negative test proving a deployment carrying the key refuses or rewrites a request that attempts to exceed it. Until promotion, every `litellm_params` key is classified `operator configuration`: it SHALL NOT narrow any field, SHALL NOT produce facts, SHALL NOT pin or produce reasoning levels, SHALL NOT enter the LKG enforcement fingerprint, and SHALL appear in diagnostics only as a configured key. `model_info.*` keys (including `max_input_tokens`, `max_output_tokens`, `supports_*`, `litellm_provider`, `key`, `supports_*_reasoning_effort`, `reasoning_effort_levels`) are `declared-observable`: they supply LiteLLM declarations for the field matrix and diagnostics but SHALL NOT narrow anything and SHALL NOT prove identity.

#### Scenario: No litellm_params key narrows a value
- **WHEN** a deployment declares `litellm_params.max_input_tokens: 900000` or `max_tokens: 65536` and the resolved canonical input is 1048576 or the output base is 512000
- **THEN** Core keeps the resolved values unchanged, records the keys in diagnostics as operator configuration, and reports no narrowing, no discrepancy, and no conflict from them

#### Scenario: Operator-configured effort is diagnostic only
- **WHEN** a deployment declares `litellm_params.reasoning_effort: max` while serving is unproven
- **THEN** Core reports reasoning levels unknown, emits no variants, records the value in diagnostics as operator configuration, and never publishes selectable levels derived from it

#### Scenario: Unlisted keys are unused
- **WHEN** a deployment carries a `litellm_params` key the frozen matrix does not list
- **THEN** the key contributes no value, no narrowing, and no conflict

#### Scenario: Promotion requires evidence
- **WHEN** an implementation proposes to classify a `litellm_params` key as `hard-enforced`
- **THEN** the proposal must ship an OpenSpec delta containing the exact source path where LiteLLM reads that deployment key to reject or rewrite a breaking request, plus an automated negative test demonstrating the enforcement, and until the delta merges the key stays operator configuration

#### Scenario: Router-internal model_info gates are not deployment enforcement
- **WHEN** LiteLLM's own admission or capability path reads a resolved `model_info` value (for example the router's per-request context-window gate over `model_info.max_input_tokens`)
- **THEN** that does not prove the corresponding `litellm_params` key is enforced, and Core does not treat it as such, because LiteLLM mirrors only pricing keys from `litellm_params` into the resolved `model_info`

### Requirement: Reasoning controls authority
Core SHALL treat reasoning support as a field of the resolution matrix and selectable reasoning levels as a separate, non-gated fact with states `unknown` and `known` (possibly empty). Levels SHALL come only from the `reasoning_options` of a proven serving record. `litellm_params.reasoning_effort` is an operator default that a request may override, so it SHALL NOT pin effort, produce levels, or narrow them. A canonical `reasoning: true`, first-party or other unproven provider records, `model_info.supports_*_reasoning_effort`, `model_info.reasoning_effort_levels`, `model_info.supported_openai_params`, and `litellm_params.allowed_openai_params` SHALL NOT produce levels and are diagnostic only. With no serving proof Core SHALL report levels unknown and emit no variants without withholding the model.

#### Scenario: Unproven serving has no selectable levels
- **WHEN** canonical identity is proven, reasoning is supported, no serving provider is declared, and the lab's own provider record publishes effort values
- **THEN** Core reports reasoning supported, levels unknown, and no variants

#### Scenario: Proven serving levels
- **WHEN** a declared serving record publishes effort values
- **THEN** Core emits exactly those variants for the resolved protocol

#### Scenario: Endpoint default effort is diagnostic only
- **WHEN** a deployment declares `litellm_params.reasoning_effort: max` and a proven serving record publishes `reasoning_options` with several effort values
- **THEN** Core publishes the serving record's variants and records the declared default effort in diagnostics, without removing or pinning any level

#### Scenario: Forwarded parameter is not a level set
- **WHEN** a deployment declares `litellm_params.allowed_openai_params` containing `reasoning_effort` and `model_info.supports_xhigh_reasoning_effort: true`
- **THEN** Core reports levels unknown unless a proven serving record supplies options

#### Scenario: Supported reasoning without levels
- **WHEN** the proven serving record declares only a `toggle` option or an empty list
- **THEN** Core reports reasoning supported with a known empty level set

### Requirement: Price authority
Core SHALL resolve each price component (input, output, cache read, cache write) independently from operator-declared pricing first — the seven `MirroredPricingParams` keys of `litellm_params`, which LiteLLM explicitly mirrors into `model_info`, read there before any `model_info` key and taking the highest across deployments — else from the `cost` of a serving record whose provider is proven and whose record is resolved, else report it unknown. Operator-declared pricing is a fact class of its own: it is not runtime enforcement and never narrows a capability field. Canonical registry entries carry no price, unproven provider records and unresolved serving records SHALL never supply a price.

#### Scenario: Unproven serving keeps price unknown
- **WHEN** LiteLLM declares no price and the serving provider is unproven while the lab's own record has a cost
- **THEN** Core reports price unknown

#### Scenario: Declared serving price fills only undeclared components
- **WHEN** LiteLLM declares input and output prices and `models_dev_provider: P` resolves a record carrying a cache read cost
- **THEN** Core uses the operator-declared input and output prices and P's cache read cost, each with its own provenance

#### Scenario: Relation-only record supplies no price
- **WHEN** `models_dev_provider: gatewayX` is declared and gatewayX holds only `x-free` reached through `canonical_model_id` with no exact lookup-key match
- **THEN** the price stays unknown for components LiteLLM does not declare, because the serving record is unresolved

### Requirement: Single resolution result
Core SHALL resolve each deployment group once into a single resolved model result containing catalog shape, identity with parse metadata, serving status, every field resolution with its basis and evidence, reasoning level state, diagnostic candidates, publication status, reasons, discrepancies, conflicts, and the LKG proof. `buildModelSpecs`, the publication assessment and partition, diagnostics, LKG capture, and LKG validation SHALL all derive from that result, and the ModelSpec SHALL be produced by one projection of it.

#### Scenario: Gate and configuration cannot diverge
- **WHEN** any discovery input is evaluated
- **THEN** every publishable entry's ModelSpec limits, tools, reasoning verdict, modalities, and variants equal the resolved values, `buildModelSpecs` equals the diagnostics models, and an LKG captured from the round stores the same facts

#### Scenario: No cross-provider field inheritance
- **WHEN** a selected serving record omits a field
- **THEN** Core never copies that field from another provider's record and never refills it from the canonical registry entry; the field follows its serving-absence policy (unknown, or a same-dimension LiteLLM declaration as `litellm-declared`)

### Requirement: Last Known Good schema 8 proof composition
Core SHALL persist LKG entries with `schemaVersion` 8 whose proof records the composition that produced the stored spec, group-wide: one deployment evidence item per deployment (a stable deployment id — the LiteLLM `model_info.id` when present, else a key derived from that deployment's full identity-evidence multiset — the normalized candidate-value multiset, an identity kind of `canonical`, `litellm-only`, or `serving-only`, and the canonical model id only when the kind is `canonical`), a digest of the used registry facts only when any field basis is `canonical`, the serving provider and record id with one declaration item per deployment plus a digest of the used serving facts when serving was proven, the basis of every field, a fingerprint of the hard-enforced `litellm_params` keys of every deployment per the runtime enforcement matrix, whose shape is frozen and whose contents start empty, and, when any field basis is `litellm-declared`, a fingerprint of the LiteLLM declarations used. Validation SHALL re-prove every proof component against the current group — the sorted deployment-evidence multiset of the current group must equal the stored multiset item by item — same deployment ids, same normalized candidate-value multisets, same identity kinds, and canonical model ids for canonical items — and every stored serving declaration must still be declared by the corresponding deployment; two deployments with the same route but different evidence never match one stored item — and restore the whole stored spec or nothing; Core SHALL never merge stored and live facts per field. Operator-configuration keys SHALL NOT appear in the enforcement fingerprint until promoted. Entries with any other schema version, a missing proof component, or an unknown basis SHALL fail closed.

#### Scenario: Canonical entry survives outage
- **WHEN** an entry whose fields have `canonical` and `litellm-declared` basis exists, the catalog is unavailable, and every proof component re-proves
- **THEN** Core reports `configured-lkg` with the whole stored spec

#### Scenario: Group-wide deployment change rejects the entry
- **WHEN** a stored entry lists canonical evidence for three deployments and the live group adds, removes, or changes the normalized input of any one of them
- **THEN** Core rejects the whole entry, even when the other deployments still prove the same canonical identity

#### Scenario: Mixed composition is re-proven per component
- **WHEN** an entry's context has `canonical` basis, output has `serving` basis, and price has `litellm-declared` basis, and only the LiteLLM price declaration changed
- **THEN** Core rejects the whole entry instead of restoring any field

#### Scenario: Serving declaration removed
- **WHEN** an entry's proof includes a serving declaration and any live deployment no longer declares the same `models_dev_provider`
- **THEN** Core rejects the entry

#### Scenario: Operator-default change does not invalidate
- **WHEN** an entry's enforcement fingerprint covers `litellm_params.max_input_tokens` and the live deployment changes `litellm_params.reasoning_effort` or `max_tokens`
- **THEN** the entry stays valid, because operator-configuration keys are not enforcement proof

#### Scenario: Unreferenced provider record change
- **WHEN** the live catalog changes a provider record that the entry's proof does not reference, and the registry digest is unchanged
- **THEN** the entry stays valid

#### Scenario: Schema 7 entry fails closed
- **WHEN** a stored entry has `schemaVersion` 7 or lower
- **THEN** Core rejects it without migration and a later live round recaptures it

#### Scenario: LiteLLM-only and serving-only models capture legally
- **WHEN** a model publishes with no canonical registry match and complete LiteLLM declarations (or with a declared provider and a resolved serving record)
- **THEN** its captured proof carries identity kind `litellm-only` (or `serving-only`) with no canonical model id and no registry digest, and the capture succeeds for exactly the facts the resolver produced

#### Scenario: Inconsistent proof kind fails closed
- **WHEN** a stored entry claims identity kind `litellm-only` but carries a registry digest, or `canonical` without a canonical model id
- **THEN** Core rejects the entry as forged

### Requirement: Catalogue-wide regression evidence
Core SHALL keep an automated catalogue-wide check that runs the resolver over every canonical registry entry in representative deployment shapes and asserts that no canonical model is withheld when LiteLLM declares canonical-equal facts, that no unproven provider record contributes any value, that no variant record is selected, and that published values equal canonical, proven serving, LiteLLM-declared, or enforcement-narrowed values according to the field resolution matrix. The offline suite SHALL run the same assertions on a committed real-schema catalog subset.

#### Scenario: Offline catalogue assertions
- **WHEN** the offline test suite runs
- **THEN** the real-schema catalog subset satisfies every catalogue-wide assertion without network access
