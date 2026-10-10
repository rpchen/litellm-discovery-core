# Spec Delta

## REMOVED Requirements

### Requirement: Deployment constraints are separate from intrinsic facts
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一使用 modelsdev-catalog 整记录来源与 publication 的 Critical configuration cache validation；撤回内部路由和多候选冲突证明。

### Requirement: Evidence provenance and source authority
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一使用 modelsdev-catalog 整记录来源与 publication 的 Critical configuration cache validation；撤回内部路由和多候选冲突证明。

### Requirement: Resolved discrepancy versus unresolved conflict
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一使用 modelsdev-catalog 整记录来源与 publication 的 Critical configuration cache validation；撤回内部路由和多候选冲突证明。

### Requirement: Trusted Last Known Good reuse
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一使用 modelsdev-catalog 整记录来源与 publication 的 Critical configuration cache validation；撤回内部路由和多候选冲突证明。

## ADDED Requirements

### Requirement: Reuse existing recovery with one record
Core SHALL 复用现有重试和 publication LKG 条件，记录所选记录来源；未选来源、内部路由描述或价格差异不得被提升为新的发布/恢复冲突。MUST NOT 建立新的恢复层或证明结构。

#### Scenario: [T18] 目录暂不可用
- **WHEN** 模型仍在同一端点清单且关键缓存有效
- **THEN** 沿既有 LKG 使用。

#### Scenario: [T20] 内部路由变化
- **WHEN** model_name 未变而 route/base_model 变化
- **THEN** 不以内部身份冲突阻断恢复。
