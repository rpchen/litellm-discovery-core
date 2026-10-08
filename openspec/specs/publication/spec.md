# publication Specification

## Purpose
Defines the trustworthy model-capability publication loop: formal completeness and publishability policy, false-vs-unknown semantics, decoupled reasoning/levels, deterministic inheritance, failure taxonomy, TTL-free Last Known Good, explicit degradation, configuration states, and field-level provenance. Core is the single business source of truth; adapters consume its verdicts without reimplementing policy.

## Requirements

### Requirement: Publication completeness policy
Core SHALL define a formal, testable rule deciding whether a discovered model's metadata is reliable enough for normal publication, and SHALL report exactly which fields are missing, unknown, or illegal when it is not.

The gate is never relaxed and has no user-override path. A model is publishable only as `configured` or `configured-lkg`; every other model is withheld with explicit reasons. No confirmation, acceptance, or override state participates in publication, and one model being withheld never gates another model of the same endpoint. Provider-scoped serving metadata selected through a fallback record ranks below LiteLLM declarations and cannot outrank them.

#### Scenario: Complete trustworthy metadata is publishable
- **WHEN** a model has positive context and output limits plus known tool-calling and reasoning states with a uniquely resolved identity
- **THEN** Core reports the model publishable with status `configured`

#### Scenario: Missing context blocks normal publication
- **WHEN** a model has no positive context limit from any trusted source
- **THEN** Core reports the model not publishable and names the missing context field

#### Scenario: Missing output limit blocks normal publication
- **WHEN** a model has no positive output limit from any trusted source
- **THEN** Core reports the model not publishable and names the missing output field

#### Scenario: Zero context is illegal, not a default
- **WHEN** the merged context limit is zero
- **THEN** Core treats it as illegal/insufficient and the model is not normally publishable

#### Scenario: Zero output is illegal, not a default
- **WHEN** the merged output limit is zero
- **THEN** Core treats it as illegal/insufficient and the model is not normally publishable

#### Scenario: Explicit model-level output <= 0 is illegal, not missing
- **WHEN** the trusted model-level record explicitly declares a non-positive output limit and no deployment declares one
- **THEN** Core reports `invalid-metadata` with an illegal output field, never a missing one

#### Scenario: Unknown key capability blocks normal publication
- **WHEN** tool calling or reasoning support is unknown
- **THEN** Core reports the model not publishable and names the unknown field

#### Scenario: Illegal metadata is rejected
- **WHEN** metadata carries illegal values or an incompatible schema shape is used as fact
- **THEN** Core reports the model not publishable with an illegal-field entry

#### Scenario: Publication never depends on user confirmation
- **WHEN** a model is withheld and the user takes any acknowledgement or confirmation action
- **THEN** the model stays withheld; no stored acceptance, flag, or option can move it into the publishable partition

#### Scenario: Per-model isolation of failure
- **WHEN** one model of an endpoint cannot prove trustworthy metadata
- **THEN** every other model that does pass the gate is published normally in the same round

#### Scenario: fallback conflict blocks publication
- **WHEN** a fallback-selected provider record reports a value that conflicts with an equally ranked LiteLLM declaration
- **THEN** Core reports the field as an unresolved conflict and withholds the model under the normal publication gate

### Requirement: False versus unknown
Core SHALL distinguish confirmed-unsupported (`unsupported`) from unevidenced (`unknown`) for tool calling and reasoning, and SHALL never rewrite `unknown` to `false`, `0`, or `[]` on any path leading to normal publication.

#### Scenario: Missing tool declaration stays unknown
- **WHEN** neither LiteLLM nor models.dev declares tool-call support
- **THEN** Core reports tool support `unknown`, not `unsupported`

#### Scenario: Explicit negative evidence means unsupported
- **WHEN** a trusted source explicitly declares no tool-call or reasoning support without contradiction
- **THEN** Core reports `unsupported`

### Requirement: Reasoning decoupled from levels
Core SHALL resolve reasoning support independently from reasoning levels; support without selectable levels is legal, and missing levels never imply lack of support.

#### Scenario: Reasoning without levels is legal
- **WHEN** trusted metadata declares reasoning support but no selectable levels
- **THEN** Core reports support with an empty level set and the model may still be publishable

#### Scenario: Reasoning with levels
- **WHEN** trusted metadata declares reasoning support with effort or budget options
- **THEN** Core reports support with the parsed levels

#### Scenario: No reasoning
- **WHEN** trusted evidence confirms no reasoning support
- **THEN** Core reports unsupported regardless of level data

#### Scenario: Levels never flip support
- **WHEN** level data is absent or present
- **THEN** Core never derives support from level presence alone in either direction

### Requirement: Deterministic source resolution and inheritance
Core SHALL resolve canonical model identity only against the models.dev canonical registry through the deterministic evidence defined by the `modelsdev-catalog` capability, SHALL select serving records only under a proven serving provider, and SHALL keep ambiguous or unmatched identities observable instead of force-picking. Intrinsic facts SHALL come only from the canonical registry entry; Core SHALL NOT copy fields between provider records. Group identity SHALL require positive evidence for every deployment: a deployment without route, base model, or deterministic provider proof makes the group identity-incomplete, and `model_name` never substitutes for per-deployment identity evidence. LiteLLM adapter route prefixes SHALL NOT be treated as lab namespaces or serving providers.

#### Scenario: Registry entry supplies intrinsic facts
- **WHEN** a deployment resolves to a canonical registry entry and no serving provider is declared
- **THEN** Core uses the registry entry's limits, modalities, tool and reasoning verdicts with `canonical-intrinsic` provenance and selects no provider record

#### Scenario: Original provider wins
- **WHEN** canonical identity is proven and the operator declares the lab's own provider (`models_dev_provider`) whose record matches the deployment's parsed lookup key exactly
- **THEN** Core resolves that record as the serving record and applies its values with `serving` basis; a record that only relation-points at the canonical identity never resolves the SKU, leaves the group `serving-record-unresolved`, and the model resolves from canonical or LiteLLM branches

#### Scenario: Ordered capability fallback
- **WHEN** the model is absent from the canonical registry and no serving provider is declared
- **THEN** Core uses no provider record: the model publishes only from complete LiteLLM declarations and is otherwise withheld; the former OpenCode-then-OpenRouter order survives only as the ordering of diagnostic candidates

#### Scenario: Ambiguity stays observable
- **WHEN** a bare id matches several registry entries, or deployments resolve to different registry entries
- **THEN** Core reports `ambiguous` and does not publish normally

#### Scenario: Deterministic inheritance carries provenance
- **WHEN** a serving record declares `canonical_model_id`, or a provider record omits a field another provider's record for the same canonical model declares
- **THEN** the relation links identity only; intrinsic defaults come from the canonical registry entry with `canonical-intrinsic` provenance and no field is ever copied across provider records

#### Scenario: No heuristic guessing
- **WHEN** only a model name, family substring, or neighbor-model values suggest a capability
- **THEN** Core reports `unknown` and never fills limits, tools, reasoning, modalities, or levels from the guess

#### Scenario: Family-name provider matches stay ambiguous
- **WHEN** the same model id exists under a name-implied provider and another provider and the canonical registry has no entry for it
- **THEN** trusted publication never selects the name-implied provider or any other unproven record; the model publishes only from a declared serving record or complete LiteLLM declarations

#### Scenario: Deployment group identities must be consistent
- **WHEN** one LiteLLM model name has deployments declaring different explicit providers, or deployments whose evidence resolves to different canonical registry entries, or one deployment resolves to a registry entry while another does not
- **THEN** Core reports `ambiguous` for the group and never resolves by first-deployment order

#### Scenario: Equivalent relations reconcile a group
- **WHEN** deployments route through different adapter prefixes or name the model differently but every deployment resolves to the same canonical registry entry
- **THEN** Core resolves the group to that entry deterministically with provenance, while cross-deployment descriptive or constraint disagreements remain unresolved conflicts

#### Scenario: Provider-qualified routed identities keep their namespace
- **WHEN** one group routes to `openai/foo` and `anthropic/foo`, or to `openai/foo` and an unqualified `foo`, the canonical registry has no entry for `foo`, and no serving provider is declared
- **THEN** Core keeps the identities distinct and reports `ambiguous`; an explicit `models_dev_provider` on the unqualified deployment is the deterministic proof that reconciles it, and when every deployment resolves to the same registry entry the group shares that canonical identity while the serving provider stays unproven

#### Scenario: Identity equivalence reconciliation is order-independent
- **WHEN** the same group is evaluated with deployments and catalog keys in any order
- **THEN** Core reaches the same resolved/ambiguous verdict and the same canonical identity

#### Scenario: Group identity requires evidence for every deployment
- **WHEN** one deployment declares a provider-qualified identity while another declares no route, no base model, and no deterministic provider proof
- **THEN** Core reports the group blocked (`ambiguous`, not publishable) with a reason naming the missing deployment identity — the absence of a detected conflict is never treated as proof of identity consistency

#### Scenario: All deployments identity-less stays blocked
- **WHEN** every deployment in a multi-deployment group lacks identity evidence, or a deployment declares only `models_dev_provider` without any model id
- **THEN** Core reports the group blocked; `model_name` (the aggregate route alias), family/name heuristics, and sibling deployments' identities never backfill a missing per-deployment identity

#### Scenario: Deployment order cannot change identity completeness
- **WHEN** a group mixes identified and identity-less deployments
- **THEN** Core reports the same blocked verdict for every deployment order

### Requirement: Group-wide limit evidence
Core SHALL treat context and output limits as group-wide evidence. Deployment declarations that agree are known; any partially-declared field stays unknown unless an authoritative intrinsic value exists; disagreement *between deployments* is an unresolved conflict that withholds the model, because a model-level record cannot prove which route the host will use. When every deployment agrees or stays silent and canonical identity is reliably resolved, the trusted models.dev value is authoritative: a differing LiteLLM `model_info` declaration is retained as a resolved discrepancy, while a proven endpoint runtime constraint from the operator's own deployment configuration (`litellm_params`) narrows the effective value. Missing values are never filtered, and minimum/maximum merging must never upgrade unknown or conflict into known.

#### Scenario: Agreeing deployment limits are known
- **WHEN** every deployment declares the same context or output value
- **THEN** Core reports that value as known group evidence

#### Scenario: Partially declared limits stay unknown
- **WHEN** some deployments declare a limit, others leave it undefined, and no authoritative intrinsic value exists
- **THEN** Core reports unknown and does not publish normally

#### Scenario: Disagreeing deployment limits are a conflict
- **WHEN** deployments declare different context or output values
- **THEN** Core reports an unresolved conflict and does not publish normally, even when a model-level record exists

#### Scenario: Model-level metadata fills only a fully undeclared field
- **WHEN** no deployment declares a limit but a trusted canonical record declares one
- **THEN** Core reports the model-level value as known

#### Scenario: Authoritative model-level value resolves a descriptive difference
- **WHEN** every deployment agrees on a descriptive value or stays silent and the trusted canonical record declares a different value
- **THEN** Core selects the model-level value, retains the LiteLLM declaration as a resolved discrepancy, and the model remains publishable when otherwise complete

#### Scenario: A proven endpoint runtime constraint narrows the effective value
- **WHEN** the operator's own deployment configuration (`litellm_params`) declares an enforced limit
- **THEN** Core narrows the effective value to that constraint instead of treating the difference as a conflict

#### Scenario: context, input, and output are distinct scalar dimensions
- **WHEN** limits are derived or compared
- **THEN** `context` is total context (models.dev `limit.context`, with the documented deployment `max_input_tokens` fallback only when no total exists), `input` is input capacity (LiteLLM `max_input_tokens`, models.dev `limit.input`), and `output` is the output limit (LiteLLM `max_output_tokens`/`max_tokens`, models.dev `limit.output`); no check ever compares one dimension against another, and a runtime constraint only narrows its own dimension

### Requirement: Per-dimension modality evidence
Core SHALL treat modality flags as sparse per-dimension evidence. Declaring one modality flag never completes the direction's set; the only documented complete-set source is the trusted models.dev `modalities` array. When canonical identity is reliably resolved that authoritative list completes the direction, and a contradicting LiteLLM flag is retained as a resolved discrepancy rather than blocking publication; a proven endpoint constraint (`litellm_params` modality flag explicitly `false`) removes a modality from the effective set. Two deployments that explicitly disagree stay an unresolved conflict. Without an authoritative list the sparse-flag rules apply unchanged.

#### Scenario: Sparse false does not prove the remaining set
- **WHEN** only `supports_vision = false` is declared and no authoritative intrinsic list exists
- **THEN** input modalities stay `known=false` and are listed as unknown for publication

#### Scenario: Documented complete set is known
- **WHEN** the trusted models.dev record declares the direction's complete modality set, or every current dimension of the direction is explicitly declared
- **THEN** Core marks the direction known with the resolved values

#### Scenario: Declared dimension contradicting the model set is a conflict
- **WHEN** a declared modality flag disagrees with the trusted model-level set while the deployments also disagree among themselves
- **THEN** Core reports the direction not known and publication stays blocked

#### Scenario: Declared dimension contradicting the model set is a resolved discrepancy
- **WHEN** a declared modality flag disagrees with the trusted model-level set and all deployments agree among themselves
- **THEN** Core keeps the model-level set as known, records the difference as a resolved discrepancy, and publication is not blocked by it

#### Scenario: Cross-deployment modality disagreement stays unresolved
- **WHEN** two deployments of the same host model explicitly disagree about a modality
- **THEN** Core reports the direction not known and publication stays blocked

### Requirement: Modality completeness
Core SHALL treat input and output modalities as publication completeness fields. A text-only baseline without explicit evidence is unknown, not confirmed text-only. There is no implicit modality baseline that counts as known. An authoritative intrinsic list counts as complete evidence for the direction, so a resolved discrepancy is never reported as incomplete.

#### Scenario: Authoritative intrinsic list completes the direction
- **WHEN** canonical identity is reliably resolved and the trusted record declares the direction's modality list
- **THEN** Core marks the direction known even when LiteLLM declares a differing or sparse flag set

#### Scenario: Explicit text-only is known
- **WHEN** models.dev or LiteLLM explicitly declares text-only modalities
- **THEN** Core marks the modality known and the model may be normally publishable

#### Scenario: Missing modality evidence blocks publication
- **WHEN** neither LiteLLM nor a trusted models.dev record declares input or output modalities
- **THEN** Core names `capabilities.input` or `capabilities.output` as unknown and does not report `configured`

#### Scenario: Explicit image is preserved without name inference
- **WHEN** trusted metadata declares image input
- **THEN** Core keeps image, and a model name containing vision/image/qwen does not add image, audio, or video by itself

### Requirement: Tri-state multi-deployment aggregation
Core SHALL aggregate tool and reasoning evidence across deployments without dropping unknown. `true + unknown` and `false + unknown` stay unknown when no authoritative intrinsic verdict exists. An authoritative intrinsic verdict (canonical identity reliably resolved) decides the capability, and a contradicting deployment declaration is retained as a resolved discrepancy. Two deployments that explicitly disagree always stay an unresolved conflict, because a model-level record cannot prove which route the host will use.

#### Scenario: Agreement stays known
- **WHEN** every deployment explicitly agrees on true or every deployment explicitly agrees on false
- **THEN** Core reports supported or unsupported respectively

#### Scenario: Missing deployment evidence is not dropped
- **WHEN** one deployment declares a boolean, another omits the field, and no authoritative intrinsic verdict exists
- **THEN** Core reports unknown for that capability and does not publish normally

#### Scenario: Authority resolves a descriptive disagreement
- **WHEN** deployments agree or stay silent and the trusted model-level verdict differs from a deployment declaration
- **THEN** Core reports the model-level verdict and records a resolved discrepancy

#### Scenario: Conflict stays unknown
- **WHEN** deployments explicitly disagree with each other
- **THEN** Core reports unknown with conflict provenance and the model is withheld

#### Scenario: Cross-deployment conflict outranks an authoritative verdict
- **WHEN** two deployments explicitly disagree about a capability and a trusted model-level verdict also exists
- **THEN** Core still reports unknown with conflict provenance, because a model-level record cannot prove which route the host will use

### Requirement: LKG completeness revalidation
Core SHALL revalidate a stored LKG entry against the current publication policy. A compatible schema version, positive limits, and adapter trust are not sufficient. Unknown tools, unknown reasoning, unknown modalities, illegal fields, identity drift, provider conflict, captured facts that do not match the stored `ModelSpec`, or conflicting live facts invalidate the entry. Live conflict detection SHALL consider only authoritative intrinsic facts (the trusted current model-level record) and proven endpoint runtime constraints from the operator's own deployment configuration; a lower-authority descriptive LiteLLM declaration that source authority already resolved into a discrepancy MUST NOT invalidate the entry. Identity validity SHALL be decided first from the live deployments' own provider-aware stable identity — the same evidence live publication uses — so it works with no enrichment source available; an unprovable or changed live group identity (provider namespace included) rejects the entry before weaker checks. The entry stores the actual critical capability facts (tools/reasoning verdicts, resolved modality sets, context/input/output values) so any newly observed explicit live fact can be compared against them like-for-like: total context only against trusted total-context facts, input capacity only against input facts, output only against output facts, and every modality comparison across all deployments at once.

#### Scenario: Forged complete limits with unknown capabilities are rejected
- **WHEN** an LKG entry has positive limits but captured tools, reasoning, or modalities are unknown
- **THEN** Core rejects the entry and does not report `configured-lkg`

#### Scenario: Captured facts must match the stored ModelSpec
- **WHEN** a stored entry's captured limits, tools/reasoning verdicts, or modality sets differ from the `ModelSpec` stored beside them
- **THEN** Core rejects the entry as forged; matching is canonical set equality for modalities, never array order

#### Scenario: New live fact conflicts with stored values
- **WHEN** any explicit authoritative live fact (trusted model-level limit, tool/reasoning verdict, or modality set) or any proven runtime constraint contradicts the stored snapshot's captured facts
- **THEN** Core rejects the entire entry — no field-level merge — and the model stays incomplete/unavailable

#### Scenario: Descriptive discrepancy never invalidates
- **WHEN** a live descriptive LiteLLM `model_info` declaration differs from the captured facts while the trusted model-level facts and every proven runtime constraint still agree
- **THEN** the entry stays valid; the difference is a resolved discrepancy of the live assessment, not new evidence

#### Scenario: A changed runtime constraint fails closed
- **WHEN** a proven endpoint runtime constraint no longer matches the captured facts
- **THEN** Core rejects the whole entry, because restoring the stored spec would advertise a limit the endpoint does not honour

#### Scenario: New live fact conflicts with stored values
- **WHEN** any explicit live declaration (tool, reasoning, modality flag, or limit value) contradicts the stored snapshot's captured facts
- **THEN** Core rejects the entire entry — no field-level merge — and the model stays incomplete/unavailable

#### Scenario: LKG modality conflict inspects every deployment and ignores order
- **WHEN** any live deployment's explicit modality declaration contradicts the captured set — including a conflicting sibling next to an undeclared (`undefined`) flag —
- **THEN** Core rejects the whole entry, and the verdict is identical for every deployment order; `undefined` alone never rejects and never masks a sibling's conflict

#### Scenario: New trusted model-level limits conflict with LKG
- **WHEN** the current trusted model-level record declares a total context or output value different from the captured facts while live completeness fails elsewhere
- **THEN** Core rejects the stored entry instead of restoring it

#### Scenario: Input capacity never contradicts total context
- **WHEN** a live deployment declares a different `max_input_tokens` while no trusted live total-context fact exists
- **THEN** Core never reports a context conflict from that fact; the input dimension decides via the captured input, and an equal input keeps the entry valid

#### Scenario: LKG provider-qualified identity survives metadata outage
- **WHEN** an entry was captured for `openai/foo` and the live group routes to `anthropic/foo` while the metadata source is unavailable and no record is selected
- **THEN** Core rejects the entry from the deployments' own provider-aware stable identity alone; the `selected`-based provider check is only an additional cross-check when enrichment exists

#### Scenario: LKG unqualified identity does not equal qualified identity without proof
- **WHEN** an entry was captured for `openai/foo` and the live group routes to an unqualified `foo` with no deterministic provider proof
- **THEN** Core rejects the entry; an explicit `models_dev_provider` that deterministically qualifies the live route to `openai/foo` is accepted instead

#### Scenario: LKG restore requires a provable live group identity
- **WHEN** the live group's own identity evidence is conflicting or incomplete (an identity-less deployment, or ids no metadata can reconcile)
- **THEN** Core refuses the restore — the stored entry never proves what the live group cannot — and capture likewise refuses to store an entry without provable group identity

#### Scenario: Same live fact does not invalidate
- **WHEN** every explicit live fact agrees with the stored snapshot
- **THEN** the entry remains valid and may substitute during the outage

#### Scenario: Illegal live metadata never hides behind LKG
- **WHEN** a live declared limit is non-positive or otherwise illegal
- **THEN** Core keeps `invalid-metadata` and does not restore the snapshot

### Requirement: Failure taxonomy without pseudo-complete publication
Core SHALL classify metadata failures and SHALL never emit a normally-published model from a failed fetch via defaults.

#### Scenario: Network failure is observable
- **WHEN** metadata retrieval times out, returns 5xx, or is unreachable
- **THEN** Core reports `metadata-unavailable` with the classified kind and no normally-published model

#### Scenario: Retry recovery restores publication
- **WHEN** a retry after failure returns complete trustworthy metadata
- **THEN** Core reports `configured` with a recovered-after-retry record

### Requirement: Last Known Good without TTL
Core SHALL support reusing a previously complete metadata snapshot while live sources fail, with validity decided by stable deployment identity, canonical identity, serving proof, schema, and conflict evidence -- never by fixed age -- and SHALL expose source, fetch time, age, and selection reason. Only a `ModelSpec` that passed the current publication gate in the same round, projected from the same resolution result, may be captured as LKG; a composition of facts from different periods is never a valid entry. LKG SHALL NOT resurrect a model the current LiteLLM directory no longer serves, and an incompatible stored schema SHALL fail safe as withheld rather than restore. Every entry persists the schema 8 proof composition defined by the `modelsdev-catalog` capability, and restoration re-proves every proof component and restores the whole stored spec or nothing.

#### Scenario: Valid LKG keeps publication
- **WHEN** live metadata fails but a stored schema 8 snapshot exists whose every outage proof component is unchanged
- **THEN** Core reports status `configured-lkg` with LKG provenance

#### Scenario: Old but stable LKG stays valid
- **WHEN** an LKG entry is arbitrarily old yet stable identity, canonical identity, serving proof, and schema still agree with no conflicting live data
- **THEN** Core still accepts it

#### Scenario: Identity conflict invalidates LKG
- **WHEN** the current stable identity, canonical identity, or declared serving provider no longer matches the stored entry
- **THEN** Core rejects the entry

#### Scenario: Unproven serving record change does not invalidate
- **WHEN** a `canonical-intrinsic` entry is validated against a live catalog in which provider records for the canonical model changed but the registry entry and the deployments did not
- **THEN** the entry stays valid

#### Scenario: Newer trusted metadata wins
- **WHEN** fresh trusted live metadata contradicts a stored entry
- **THEN** Core uses the live data and refreshes the entry

#### Scenario: Only complete gate-passing specs become LKG
- **WHEN** a model is withheld, incomplete, or degraded-looking in any way
- **THEN** no LKG entry is captured for it, and a hand-built entry whose captured facts diverge from its stored spec is rejected

#### Scenario: Capture cannot fail silently through drift
- **WHEN** a model is published `configured`
- **THEN** its captured verdict and stored spec come from one resolution result, so capture validation cannot reject it for spec/assessment divergence

#### Scenario: A removed model is never resurrected
- **WHEN** LiteLLM no longer serves a model that has a stored LKG entry
- **THEN** the model does not appear in the publication result at all; the current LiteLLM directory alone decides existence

#### Scenario: Schema change invalidates LKG
- **WHEN** the stored shape is incompatible with the current schema, including every schema 7 or older entry
- **THEN** Core rejects the entry

#### Scenario: LKG never restores a superseded fallback serving value
- **WHEN** a stored LKG entry captured a reseller serving limit that no longer matches the live resolution (for example because the model is now resolved through the canonical registry)
- **THEN** LKG validation fails closed on the captured-facts, canonical, and serving cross-checks and never restores the stale metadata

#### Scenario: Unique-match-sourced LKG never substitutes for lost live metadata
- **WHEN** a stored entry was captured from a unique-match, OpenCode, or OpenRouter fallback record under schema 7 or earlier and the metadata source becomes unavailable
- **THEN** Core fails the restore closed: schema 8 has no proof component for unproven provider records, so such facts can never be served from memory

#### Scenario: Persisted authority grades an explicit provider without a canonical relation as fallback-serving
- **WHEN** an LKG entry is captured while the operator declares `models_dev_provider` and the selected record carries no canonical relation, and the metadata source later becomes unavailable
- **THEN** the entry's proof records the serving declaration and record digest (the operator declaration proves serving; this replaces the former `fallback-serving` grading), and it restores only if every live deployment still declares the same `models_dev_provider`

#### Scenario: Persisted authority keeps authoritative entries restorable
- **WHEN** an entry whose fields have `canonical`, `serving`, or `litellm-declared` basis (with `enforcement-narrowed` only after a promotion delta) is evaluated during a compatible metadata outage and every proof component re-proves
- **THEN** Core restores the whole stored spec under the established LKG policy

#### Scenario: Persisted evidence authority is validated as schema-critical
- **WHEN** a stored entry claims schema 8 but a proof component is missing, a field basis is not one of the defined values, or a digest or fingerprint is malformed
- **THEN** both the compatibility guard and the defensive validation reject the entry fail-closed, and it is never restored as `configured-lkg`

#### Scenario: Operator configuration never fails an LKG entry closed
- **WHEN** a live deployment declares a non-positive value in a non-pricing `litellm_params` limit key (for example `max_tokens: 0`) while every capability fact — `model_info` descriptive declarations and trusted record limits — is unchanged from the captured entry
- **THEN** the entry stays valid and may substitute: unproven operator-configuration keys never participate in the illegality verdict (D7a empty proven set), so their bad values are diagnostics only. A non-positive `model_info` descriptive limit or trusted record limit still fails the restore closed under the established illegal-metadata policy.

### Requirement: Configuration states and provenance
Core SHALL expose per-model configuration states and per-field provenance answering where each key value came from, including live, fallback, canonical-inheritance, and LKG chains.

#### Scenario: States distinguish discovery from configuration
- **WHEN** models are discovered across the outcome space
- **THEN** Core assigns each model one of configured, configured-lkg, discovered-incomplete, unmatched, ambiguous, metadata-unavailable, or invalid-metadata; `degraded` does not exist

#### Scenario: Resolved discrepancies and unresolved conflicts are first-class facts
- **WHEN** field evidence differs
- **THEN** Core reports a resolved discrepancy when authority decided and an unresolved conflict when no authority could decide, and a resolved discrepancy never counts as incomplete, invalid, or blocked

#### Scenario: Provenance explains key fields
- **WHEN** provenance is requested for limits, modalities, tools, reasoning, levels, identity, or live/fallback/LKG choice
- **THEN** Core names the source chain including provider, model, canonical-inheritance source, deployment-constraint origin, or LKG fetch time
