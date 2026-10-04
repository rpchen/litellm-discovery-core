# publication Specification

## Purpose
Defines the trustworthy model-capability publication loop: formal completeness and publishability policy, false-vs-unknown semantics, decoupled reasoning/levels, deterministic inheritance, failure taxonomy, TTL-free Last Known Good, explicit degradation, configuration states, and field-level provenance. Core is the single business source of truth; adapters consume its verdicts without reimplementing policy.

## ADDED Requirements

### Requirement: Publication completeness policy
Core SHALL define a formal, testable rule deciding whether a discovered model's metadata is reliable enough for normal publication, and SHALL report exactly which fields are missing, unknown, or illegal when it is not.

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
Core SHALL resolve metadata identity only through canonical identity, provider identity, alias, equivalent relations, or other verifiable deterministic relations with provenance, and SHALL keep ambiguous or unmatched identities observable instead of force-picking. Group identity SHALL require positive evidence for every deployment: a deployment without route, base model, or deterministic provider proof makes the group identity-incomplete, and `model_name` never substitutes for per-deployment identity evidence.

#### Scenario: Original provider wins
- **WHEN** the canonical identity names an original provider whose record exists
- **THEN** Core selects that record with canonical-original provenance

#### Scenario: Ordered capability fallback
- **WHEN** the original record is unavailable
- **THEN** Core prefers OpenRouter, then OpenCode, then a genuinely unique match, else stays unmatched

#### Scenario: Ambiguity stays observable
- **WHEN** multiple non-preferred providers match one identity
- **THEN** Core reports `ambiguous` and does not publish normally

#### Scenario: Deterministic inheritance carries provenance
- **WHEN** metadata explicitly declares alias, equivalence, or canonical inheritance for a field
- **THEN** Core inherits the field and records canonical-inheritance provenance naming the source

#### Scenario: No heuristic guessing
- **WHEN** only a model name, family substring, or neighbor-model values suggest a capability
- **THEN** Core reports `unknown` and never fills limits, tools, reasoning, modalities, or levels from the guess

#### Scenario: Family-name provider matches stay ambiguous
- **WHEN** the same model id exists under a name-implied provider and another provider, with no canonical id, explicit provider, alias, equivalent, or inherits relation
- **THEN** trusted publication reports `ambiguous` and does not select the name-implied provider

#### Scenario: Deployment group identities must be consistent
- **WHEN** one LiteLLM model name has deployments declaring different explicit providers, or routed/base identities that no alias, canonical, equivalent, or inherits relation proves to be the same model
- **THEN** Core reports `ambiguous` for the group and never resolves by first-deployment order

#### Scenario: Equivalent relations reconcile a group
- **WHEN** deployments name different identities but trusted metadata declares those identities equivalent or canonically the same
- **THEN** Core resolves the group deterministically with provenance

#### Scenario: Provider-qualified routed identities keep their namespace
- **WHEN** one group routes to `openai/foo` and `anthropic/foo`, or to `openai/foo` and an unqualified `foo` with no deterministic metadata proof
- **THEN** Core keeps the identities distinct and reports `ambiguous`; an explicit `models_dev_provider` on the unqualified deployment is the deterministic proof that reconciles it

#### Scenario: Identity equivalence reconciliation is order-independent
- **WHEN** a metadata relation (`canonical_model_id`, alias, equivalent, inherits) stored on only one of two identities proves they belong to the same identity component
- **THEN** Core reaches the same resolved/ambiguous verdict for every deployment order; the graph decides by connectivity, and capability values never inherit through it

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
Core SHALL treat context and output limits as group-wide evidence. Deployment values that agree are known; any partially-declared field stays unknown; disagreement between deployments, or between a full declaration set and contradicting model-level metadata, is a conflict that blocks normal publication. Missing values are never filtered, and minimum/maximum merging must never upgrade unknown or conflict into known.

#### Scenario: Agreeing deployment limits are known
- **WHEN** every deployment declares the same context or output value
- **THEN** Core reports that value as known group evidence

#### Scenario: Partially declared limits stay unknown
- **WHEN** some deployments declare a limit and others leave it undefined
- **THEN** Core reports unknown and does not publish normally

#### Scenario: Disagreeing deployment limits are a conflict
- **WHEN** deployments declare different context or output values
- **THEN** Core reports a conflict and does not publish normally

#### Scenario: Model-level metadata fills only a fully undeclared field
- **WHEN** no deployment declares a limit but a trusted canonical record declares one
- **THEN** Core reports the model-level value as known; when a declared deployment disagrees with it, Core reports a conflict

#### Scenario: context, input, and output are distinct scalar dimensions
- **WHEN** limits are derived or compared
- **THEN** `context` is total context (models.dev `limit.context`, with the documented deployment `max_input_tokens` fallback only when no total exists), `input` is input capacity (LiteLLM `max_input_tokens`, models.dev `limit.input`), and `output` is the output limit (LiteLLM `max_output_tokens`/`max_tokens`, models.dev `limit.output`); no check ever compares one dimension against another

### Requirement: Per-dimension modality evidence
Core SHALL treat modality flags as sparse per-dimension evidence. Declaring one modality flag never completes the direction's set; only a documented complete-set source (the trusted models.dev `modalities` array) fills undeclared dimensions. Multi-deployment aggregation follows the same tri-state rules as other capabilities.

#### Scenario: Sparse false does not prove the remaining set
- **WHEN** only `supports_vision = false` is declared
- **THEN** input modalities stay `known=false` and are listed as unknown for publication

#### Scenario: Documented complete set is known
- **WHEN** the trusted models.dev record declares the direction's complete modality set, or every current dimension of the direction is explicitly declared
- **THEN** Core marks the direction known with the resolved values

#### Scenario: Declared dimension contradicting the model set is a conflict
- **WHEN** a declared modality flag disagrees with the trusted model-level set
- **THEN** Core reports the direction not known and publication stays blocked

### Requirement: Modality completeness
Core SHALL treat input and output modalities as publication completeness fields. A text-only baseline without explicit evidence is unknown, not confirmed text-only. There is no implicit modality baseline that counts as known.

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
Core SHALL aggregate tool and reasoning evidence across deployments without dropping unknown. `true + unknown` and `false + unknown` stay unknown. Model-level trusted evidence may fill a group only when every deployment declaration is absent; an explicit deployment value that disagrees with that evidence is a conflict and stays unknown.

#### Scenario: Agreement stays known
- **WHEN** every deployment explicitly agrees on true or every deployment explicitly agrees on false
- **THEN** Core reports supported or unsupported respectively

#### Scenario: Missing deployment evidence is not dropped
- **WHEN** one deployment declares a boolean and another omits the field
- **THEN** Core reports unknown for that capability and does not publish normally

#### Scenario: Conflict stays unknown
- **WHEN** deployments disagree, or an explicit deployment value disagrees with trusted model-level metadata
- **THEN** Core reports unknown with conflict provenance

### Requirement: Degradation eligibility
Core SHALL allow ordinary degradation only for `discovered-incomplete` with a resolved identity and for `metadata-unavailable`. It SHALL reject `ambiguous`, `invalid-metadata`, unmatched-but-incomplete, `configured`, `configured-lkg`, and already `degraded`.

#### Scenario: Incomplete and unavailable may be accepted
- **WHEN** the user accepts a discovered-incomplete model with resolved identity, or a metadata-unavailable model with no valid LKG
- **THEN** Core returns `degraded` and keeps the gaps

#### Scenario: Identity and illegal states are rejected
- **WHEN** the user accepts an ambiguous, invalid-metadata, or unmatched-incomplete model
- **THEN** Core rejects the acceptance and does not report success

### Requirement: LKG completeness revalidation
Core SHALL revalidate a stored LKG entry against the current publication policy. A compatible schema version, positive limits, and adapter trust are not sufficient. Unknown tools, unknown reasoning, unknown modalities, illegal fields, identity drift, provider conflict, captured facts that do not match the stored `ModelSpec`, or conflicting live facts invalidate the entry. Identity validity SHALL be decided first from the live deployments' own provider-aware stable identity — the same evidence live publication uses — so it works with no enrichment source available; an unprovable or changed live group identity (provider namespace included) rejects the entry before weaker checks. The entry stores the actual critical capability facts (tools/reasoning verdicts, resolved modality sets, context/input/output values) so any newly observed explicit live fact can be compared against them like-for-like: total context only against trusted total-context facts, input capacity only against input facts, output only against output facts, and every modality comparison across all deployments at once.

#### Scenario: Forged complete limits with unknown capabilities are rejected
- **WHEN** an LKG entry has positive limits but captured tools, reasoning, or modalities are unknown
- **THEN** Core rejects the entry and does not report `configured-lkg`

#### Scenario: Captured facts must match the stored ModelSpec
- **WHEN** a stored entry's captured limits, tools/reasoning verdicts, or modality sets differ from the `ModelSpec` stored beside them
- **THEN** Core rejects the entry as forged; matching is canonical set equality for modalities, never array order

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
Core SHALL support reusing a previously complete metadata snapshot while live sources fail, with validity decided by identity, provider, canonical mapping, schema, and conflict evidence -- never by fixed age -- and SHALL expose source, fetch time, age, and selection reason.

#### Scenario: Valid LKG keeps publication
- **WHEN** live metadata fails but a stored snapshot with matching identity and compatible schema exists
- **THEN** Core reports status `configured-lkg` with LKG provenance

#### Scenario: Old but stable LKG stays valid
- **WHEN** an LKG entry is arbitrarily old yet identity, provider, mapping, and schema still agree with no conflicting live data
- **THEN** Core still accepts it

#### Scenario: Identity conflict invalidates LKG
- **WHEN** the current canonical or provider identity no longer matches the stored entry
- **THEN** Core rejects the entry

#### Scenario: Newer trusted metadata wins
- **WHEN** fresh trusted live metadata contradicts a stored entry
- **THEN** Core uses the live data and refreshes the entry

#### Scenario: Schema change invalidates LKG
- **WHEN** the stored shape is incompatible with the current schema
- **THEN** Core rejects the entry

### Requirement: Explicit degradation
Core SHALL support user-accepted degradation for incomplete models that keeps the degraded label and never re-labels the model as fully configured.

#### Scenario: Incomplete model blocked without acceptance
- **WHEN** a model is incomplete or its metadata fetch failed with no valid LKG and no user acceptance
- **THEN** Core reports it not normally publishable

#### Scenario: Accepted degradation stays degraded
- **WHEN** the user explicitly accepts a named incomplete model with its listed gaps
- **THEN** Core reports status `degraded` with the gap list and acceptance record, publishable only through the degraded path

### Requirement: Configuration states and provenance
Core SHALL expose per-model configuration states and per-field provenance answering where each key value came from, including live, fallback, canonical-inheritance, and LKG chains.

#### Scenario: States distinguish discovery from configuration
- **WHEN** models are discovered across the outcome space
- **THEN** Core assigns each model one of configured, configured-lkg, discovered-incomplete, unmatched, ambiguous, metadata-unavailable, invalid-metadata, or degraded

#### Scenario: Provenance explains key fields
- **WHEN** provenance is requested for limits, modalities, tools, reasoning, levels, identity, or live/fallback/LKG choice
- **THEN** Core names the source chain including provider, model, canonical-inheritance source, or LKG fetch time
