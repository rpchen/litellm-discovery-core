# Spec Delta

## MODIFIED Requirements

### Requirement: Existing metadata failure handling

Core SHALL retain existing catalog-unavailable, unmatched and incomplete-metadata diagnostics and per-model handling. The shared incremental recovery helper MAY identify only models withheld by a degraded metadata catalog for a later adapter-driven retry; it MUST NOT turn stable identity misses or invalid/incomplete records into automatic retries, and it MUST NOT change publication or LKG policy.

#### Scenario: [T25] 目录故障

- **WHEN** 目录暂不可用且部分模型有合法 LKG
- **THEN** 沿既有恢复与逐模型诊断处理；不新增字段级 fallback

#### Scenario: Temporary catalog failure can recover

- **WHEN** a prior Core result has `metadata-unavailable` withheld models and degraded catalog diagnostics, and the adapter supplies a later catalog result
- **THEN** the helper returns only those withheld model names for reprocessing; normal registered models remain reusable

#### Scenario: Stable unmatched identity is not retried

- **WHEN** a complete catalog has no matching record for a model name
- **THEN** the recovery helper does not return that model as a temporary metadata failure

#### Scenario: Publication merge preserves the existing gate

- **WHEN** a processed subset is merged with retained Core publication entries
- **THEN** configured/configured-lkg, withheld reasons, assessments and LKG facts remain the Core-generated values
