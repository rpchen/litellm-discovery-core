# discovery-resilience Specification

## Purpose
Defines how Core keeps a LiteLLM endpoint usable when model metadata enrichment is temporarily unavailable, ambiguous, or differs between sources: evidence provenance and source authority, the separation of intrinsic model truth from endpoint runtime constraints, resolved discrepancies versus unresolved conflicts, trusted Last Known Good reuse, per-model withholding reasons, partial catalog availability, regression detection, recovery, and notification acknowledgement. Core is the single business source of truth; adapters consume these facts without reimplementing policy.

## Requirements

### Requirement: Evidence provenance and source authority
Core SHALL record, for every publication-critical field, which source decided it and what kind of evidence each source contributed. Canonical identity is a precondition: the trusted models.dev record is authoritative for intrinsic model metadata only when canonical identity is reliably resolved; LiteLLM `model_info` values are secondary descriptive evidence; only a key proven to be enforced by the endpoint — declared in the operator's own deployment configuration (`litellm_params`) — counts as a deployment runtime constraint. Field names alone never prove enforcement.

#### Scenario: Provenance is recorded per evidence item
- **WHEN** a publication-critical field is resolved
- **THEN** Core reports the selected value, the selecting source, and every contributing evidence item with its origin (`authoritative-intrinsic`, `descriptive-metadata`, `deployment-constraint`, or `unknown-provenance`)

#### Scenario: Intrinsic truth is authoritative once identity is resolved
- **WHEN** canonical identity is reliably resolved and the trusted record declares a field that a LiteLLM `model_info` declaration contradicts
- **THEN** Core selects the trusted value and records the LiteLLM declaration as a resolved discrepancy, never as a conflict or incomplete metadata

#### Scenario: Simulated model names never decide authority
- **WHEN** only a model name, family substring, or neighbor-model value suggests a capability or identity
- **THEN** Core does not treat models.dev as authoritative and never fills values from the guess

### Requirement: Deployment constraints are separate from intrinsic facts
Core SHALL keep endpoint runtime constraints as a distinct fact class. Only constraints proven from the operator's own deployment configuration may narrow an effective value, and a narrowing constraint SHALL NOT be reported as a conflict. A descriptive declaration SHALL never narrow or veto an authoritative intrinsic value.

#### Scenario: Runtime constraint narrows the effective configuration
- **WHEN** the operator's deployment configuration declares an enforced limit that is smaller than the model's intrinsic value
- **THEN** Core publishes the smaller effective value, reports the constraint, and keeps the model publishable

#### Scenario: Descriptive declaration does not become a hard cap
- **WHEN** only `model_info` declares a limit that differs from the authoritative intrinsic value
- **THEN** Core does not treat it as an enforced cap; the intrinsic value is selected and the difference is recorded

#### Scenario: Dimensions are never mixed
- **WHEN** a constraint exists for one limit dimension
- **THEN** it narrows only that dimension; total context, input capacity, and output limit are never compared against each other

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
Core SHALL reuse a previously verified complete configuration while live enrichment is unavailable, under all of the following: the entry was captured from a snapshot that passed the current publication gate; the live group's own identity evidence is provable and unchanged (provider namespace included); schema version is compatible; and no authoritative intrinsic fact or proven runtime constraint contradicts the entry. Age SHALL NOT be a validity condition. LKG SHALL NOT resurrect a model the current LiteLLM directory does not serve, and a mismatch SHALL fail closed as withheld.

#### Scenario: Outage with a valid snapshot keeps the model available
- **WHEN** the metadata source is temporarily unavailable, LiteLLM still serves the same model, identity is unchanged, and a valid entry exists
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
- **WHEN** the live canonical identity or provider differs from the stored entry
- **THEN** Core rejects the entry and withholds the model

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
Core SHALL expose an acknowledgement state that can suppress a repeated notification about an unchanged problem set. Its fingerprint SHALL be derived from the withheld model identities and their material reasons, excluding timestamps, counters, and message detail. Acknowledgement SHALL only affect notification decisions and SHALL NOT participate in publication. Full recovery SHALL clear the state; partial improvement SHALL stay quiet; a regression, a newly added problem, or a materially changed reason for an already acknowledged model SHALL re-notify.

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
