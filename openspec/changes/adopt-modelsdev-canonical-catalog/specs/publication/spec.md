# Delta: publication

## MODIFIED Requirements

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
