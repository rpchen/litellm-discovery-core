# discovery-resilience Specification

## Purpose
Defines how Core keeps a LiteLLM endpoint usable when model metadata enrichment is temporarily unavailable, ambiguous, or differs between sources: evidence provenance and source authority, the separation of intrinsic model truth from endpoint runtime constraints, resolved discrepancies versus unresolved conflicts, trusted Last Known Good reuse, per-model withholding reasons, partial catalog availability, regression detection, recovery, and notification acknowledgement. Core is the single business source of truth; adapters consume these facts without reimplementing policy.

## Requirements

### Requirement: Evidence provenance and source authority
Core SHALL record, for every publication-critical field, which source decided it and what kind of evidence each source contributed. Canonical identity is a precondition: the canonical registry entry is authoritative for intrinsic model metadata only when canonical identity is proven; a serving record overrides it only when the serving provider is proven by operator declaration; LiteLLM `model_info` values are secondary descriptive evidence; only a `litellm_params` key promoted through the runtime enforcement matrix of the `modelsdev-catalog` capability counts as proven runtime enforcement, and that proven set starts empty — the presence of a key in the operator's deployment configuration never proves enforcement by itself. Field names, LiteLLM adapter prefixes, and first-party or same-namespace provider records never prove authority by themselves.

#### Scenario: Provenance is recorded per evidence item
- **WHEN** a publication-critical field is resolved
- **THEN** Core reports the selected value, the selecting source, and every contributing evidence item with its origin (`canonical-intrinsic`, `serving`, `litellm-declared`, `operator-declared-pricing`, `descriptive-metadata`, `proven-runtime-enforcement` (no instance until a promotion delta), or `unknown-provenance`)

#### Scenario: Intrinsic truth is authoritative once identity is resolved
- **WHEN** canonical identity is proven and the registry entry declares a field that a LiteLLM `model_info` declaration contradicts
- **THEN** Core selects the registry value (or the proven serving override) and records the LiteLLM declaration as a resolved discrepancy, never as a conflict or incomplete metadata

#### Scenario: Unproven provider records carry no authority
- **WHEN** canonical identity is proven and a first-party, reseller, or variant provider record declares a different value while no serving provider is declared
- **THEN** that record contributes no evidence to the resolved field

#### Scenario: Simulated model names never decide authority
- **WHEN** only a model name, family substring, or neighbor-model value suggests a capability or identity
- **THEN** Core does not treat models.dev as authoritative and never fills values from the guess

### Requirement: Deployment constraints are separate from intrinsic facts
Core SHALL keep proven runtime enforcement as a distinct fact class. Only `litellm_params` keys promoted through the runtime enforcement matrix of the `modelsdev-catalog` capability — an OpenSpec delta carrying the exact source path where LiteLLM reads that deployment key to reject or rewrite a breaking request, plus an automated negative breakthrough test — may narrow an effective value, a narrowing key SHALL NOT be reported as a conflict, and the proven set starts empty so no key narrows anything before such a delta exists. A descriptive `model_info` declaration SHALL never narrow or veto an authoritative intrinsic value.

#### Scenario: Runtime constraint narrows the effective configuration
- **WHEN** a `litellm_params` key has been promoted to hard-enforced and the operator's deployment configuration declares a value smaller than the model's intrinsic value in that key's dimension
- **THEN** Core publishes the smaller effective value, reports the enforcement, and keeps the model publishable

#### Scenario: Descriptive declaration does not become a hard cap
- **WHEN** only `model_info` declares a limit that differs from the authoritative intrinsic value
- **THEN** Core does not treat it as an enforced cap; the intrinsic value is selected and the difference is recorded

#### Scenario: Dimensions are never mixed
- **WHEN** a promoted enforcement key exists for one limit dimension
- **THEN** it narrows only that dimension; total context, input capacity, and output limit are never compared against each other

#### Scenario: Unpromoted configured keys never narrow
- **WHEN** the operator's deployment configuration declares a limit or capability key that has not been promoted
- **THEN** Core resolves the field from the field resolution matrix alone, keeps the model publishable when otherwise complete, and lists the key in diagnostics as operator configuration

### Requirement: Resolved discrepancy versus unresolved conflict
Core SHALL separate the two outcomes explicitly. A difference that source authority can decide is a *resolved discrepancy*: the selected value is used, the difference is retained as evidence, and the model continues its publication assessment. A difference that no authority can decide is an *unresolved conflict*: the model is withheld with an explicit conflict reason. Resolved discrepancies SHALL NOT be reported as incomplete, invalid, or blocked, and SHALL NOT invalidate a trusted snapshot.

#### Scenario: Resolved discrepancy keeps the model publishable
- **WHEN** a model's only metadata difference is decidable by authority and every gated field is otherwise complete
- **THEN** Core reports the model publishable with a recorded discrepancy

#### Scenario: Unresolved conflict withholds the model
- **WHEN** same-level evidence conflicts and no authority can decide — including two deployments of one host model declaring different values
- **THEN** Core withholds the model and reports an `authoritative-conflict` reason naming the affected fields

#### Scenario: Discrepancy is not incompleteness
- **WHEN** Core reports a resolved discrepancy
- **THEN** the affected field is not listed as missing, unknown, or illegal, and the model is not reported as `discovered-incomplete` because of it

### Requirement: Trusted Last Known Good reuse
Core SHALL reuse a previously verified complete configuration while live enrichment is unavailable, under all of the following: the entry was captured from a resolution that passed the current publication gate; the live group's own stable identity evidence is provable and unchanged; schema version is compatible (schema 8); every component of the entry's proof composition re-proves (deployment evidence multiset, serving declaration, proven runtime enforcement and LiteLLM fingerprints, and with a live catalog the registry and serving record digests); and no canonical intrinsic fact, proven serving fact, or proven runtime constraint contradicts the entry. Age SHALL NOT be a validity condition. LKG SHALL NOT resurrect a model the current LiteLLM directory does not serve, and a mismatch SHALL fail closed as withheld.

#### Scenario: Outage with a valid snapshot keeps the model available
- **WHEN** the metadata source is temporarily unavailable, LiteLLM still serves the same model, stable identity is unchanged, and an entry whose outage proof components all re-prove exists
- **THEN** Core publishes the model as `configured-lkg` with the entry's fetch time, age, and selection reason

#### Scenario: No valid snapshot means withheld
- **WHEN** a newly discovered model has unavailable metadata and no entry exists
- **THEN** Core withholds it with a `metadata-unavailable` reason instead of inventing values

#### Scenario: Recovery replaces the snapshot with fresh facts
- **WHEN** the metadata source recovers and returns complete trustworthy metadata
- **THEN** Core reports `configured` from fresh evidence and stops reporting the LKG state

#### Scenario: Removed model is not resurrected
- **WHEN** LiteLLM no longer serves a model that has a stored entry
- **THEN** the model does not appear in the publication result at all

#### Scenario: Identity or provider change invalidates the entry
- **WHEN** the live canonical identity or the declared serving provider differs from the stored entry
- **THEN** Core rejects the entry and withholds the model

#### Scenario: Provider-only catalog does not block a valid restore
- **WHEN** the supplied catalog is `providers-only` and an entry exists whose outage proof components all re-prove
- **THEN** Core restores the entry and never uses a provider record from the provider-only payload

### Requirement: Per-model withholding reasons
Core SHALL report, for every withheld model, the complete set of reasons rather than a single collapsed label, distinguishing at least: unresolved identity, unmatched identity, unavailable metadata, incomplete metadata, unresolved authoritative conflict, and illegal metadata. Withholding one model SHALL NOT affect any other model of the same endpoint.

#### Scenario: Reasons are explicit and additive
- **WHEN** a model is withheld
- **THEN** Core reports every applicable reason code with the affected fields, and adapters display them without re-deriving policy

#### Scenario: Failure is isolated per model
- **WHEN** several models of one endpoint are withheld for different reasons
- **THEN** every other model that passes the gate is published in the same round

### Requirement: Partial and unusable catalog facts
Core SHALL express catalog availability as a set-level fact derived from the per-model verdicts: how many models were discovered, how many are publishable, whether the catalog is partially available, and whether it is unusable because discovered models exist but none can be published. These facts SHALL NOT change any per-model verdict.

#### Scenario: Partial availability
- **WHEN** some discovered models pass the gate and others do not
- **THEN** Core reports a partial catalog with the publishable set and the withheld set, and publication of the passing models proceeds immediately without any user action

#### Scenario: Unusable catalog
- **WHEN** discovered models exist and none can be published
- **THEN** Core reports an unusable catalog so adapters can explain that the endpoint is connected but the catalog is currently unavailable

### Requirement: Regression and recovery detection
Core SHALL distinguish a previously published model becoming withheld from a newly discovered model that cannot be published, and SHALL treat recovery as automatic. The previously published set is supplied by the adapter's applied catalog; Core never infers it from timestamps.

#### Scenario: Regression is identified
- **WHEN** a model the previously applied catalog published is withheld this round
- **THEN** Core reports it as a regression, separate from first-time withheld models

#### Scenario: Recovery needs no user approval
- **WHEN** a withheld model later satisfies the publication gate
- **THEN** Core reports it publishable and the host publishes it without any confirmation step

### Requirement: Notification acknowledgement
Core SHALL expose a versioned publication memory that can suppress a repeated notification about an unchanged problem set. The memory SHALL survive host restarts: an adapter persists the Core-produced record and restores it before the next discovery round, so the same fingerprint observed in a later process is reported as `unchanged` rather than as a first observation. The record SHALL also carry the regression baseline (the model ids the applied catalog published) so that a withdrawal is still a regression after a restart. A record that is missing, corrupt, or written by an incompatible schema version SHALL be ignored without throwing and SHALL NOT be partially trusted: the worst consequence is one repeated notification. The acknowledgement SHALL NOT be stored inside any publication verdict. Its fingerprint SHALL be derived from the withheld model identities and their material reasons, excluding timestamps, counters, and message detail. Acknowledgement SHALL only affect notification decisions and SHALL NOT participate in publication. Full recovery SHALL clear the state; partial improvement SHALL stay quiet; a regression, a newly added problem, or a materially changed reason for an already acknowledged model SHALL re-notify.

#### Scenario: Unchanged problem set does not repeat
- **WHEN** the same withheld models with the same material reasons are observed again after acknowledgement
- **THEN** Core reports no notification and keeps the model withheld

#### Scenario: Improvement stays quiet, recovery clears
- **WHEN** some acknowledged problems are resolved but others remain
- **THEN** Core stays quiet and updates the acknowledged baseline; when none remain, Core clears the acknowledgement

#### Scenario: Regression outranks a first-time gap
- **WHEN** a previously published model becomes withheld while other models are withheld for the first time
- **THEN** Core reports a regression notification, and a first-time gap alone is diagnostics-only

#### Scenario: Acknowledgement never changes publication
- **WHEN** any acknowledgement state exists
- **THEN** the publishable partition is identical to the partition computed without it

#### Scenario: Suppression survives a host restart
- **WHEN** a problem set was surfaced and persisted, and the host restarts with the same fingerprint
- **THEN** Core reports `unchanged`, produces no notification, and keeps every withheld model withheld

#### Scenario: A non-interruptive first observation stores nothing
- **WHEN** the only withheld models are newly discovered and no regression occurred
- **THEN** Core reports `first-observation`, produces no notification, and records no acknowledgement to suppress

#### Scenario: Material growth after a restart re-notifies
- **WHEN** a restored acknowledgement exists and the withheld set grows or a model's reason materially changes
- **THEN** Core reports the problem again (`catalog-unusable` or `new-issues`) instead of suppressing it

#### Scenario: Regression after a restart re-notifies
- **WHEN** the restored baseline says a model was previously published and it is withheld now
- **THEN** Core reports a regression notification regardless of the stored acknowledgement

#### Scenario: An unusable catalog notifies once, not every round
- **WHEN** discovered models exist, none are publishable, and the problem set is identical to the acknowledged one
- **THEN** Core stays quiet (diagnostics still lists the withheld models); a materially larger problem set is reported again

#### Scenario: Unreadable memory is inert
- **WHEN** the persisted record is missing, corrupt, or written by an older schema version
- **THEN** Core ignores it, still computes the same publication partition, and at most repeats a notification
