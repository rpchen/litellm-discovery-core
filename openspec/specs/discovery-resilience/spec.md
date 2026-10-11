# discovery-resilience Specification

## Purpose
Defines how Core keeps a LiteLLM endpoint usable when model metadata enrichment is temporarily unavailable, ambiguous, or differs between sources: evidence provenance and source authority, the separation of intrinsic model truth from endpoint runtime constraints, resolved discrepancies versus unresolved conflicts, trusted Last Known Good reuse, per-model withholding reasons, partial catalog availability, regression detection, recovery, and notification acknowledgement. Core is the single business source of truth; adapters consume these facts without reimplementing policy.

## Requirements

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

### Requirement: Reuse existing recovery with one record
Core SHALL 复用现有重试和 publication LKG 条件，记录所选记录来源；未选来源、内部路由描述或价格差异不得被提升为新的发布/恢复冲突。MUST NOT 建立新的恢复层或证明结构。

#### Scenario: [T18] 目录暂不可用
- **WHEN** 模型仍在同一端点清单且关键缓存有效
- **THEN** 沿既有 LKG 使用。

#### Scenario: [T20] 内部路由变化
- **WHEN** model_name 未变而 route/base_model 变化
- **THEN** 不以内部身份冲突阻断恢复。
