# Spec Delta

## REMOVED Requirements

### Requirement: source visibility
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Readable metadata attribution；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: protocol explanation
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Explain invocation protocol conflicts；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: degraded enrichment
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Metadata outage visibility；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: Readable metadata attribution
Core SHALL 从同一resolution提供字段来源和精确record引用；用户摘要显示发现/配置/暂不可用、元数据来源、推理支持/档位和具体缺口。匹配数只计实际采用models.dev能力的模型；MUST NOT 显示serving proof或要求models_dev_provider。详细identity/record/字段来源供主动allowlist审计。

#### Scenario: [T22] 16模型正确统计
- **WHEN** 16模型自动使用目录能力
- **THEN** 显示实际匹配与配置数以及各自档位，不再因无声明计0

#### Scenario: [T23] 审计安全
- **WHEN** 原始payload含secret/URL/route
- **THEN** 只导出允许公开来源与模型字段

### Requirement: Explain invocation protocol conflicts
Core SHALL 解释选中协议与真实冲突，protocol override保留；不能把明确deployment冲突称为保守Chat回退。

#### Scenario: [T11] 协议冲突可见
- **WHEN** 同模型deployment协议冲突
- **THEN** 明确暂不可用原因

### Requirement: Metadata outage visibility
Core SHALL 展示catalog不可用但不把可用LKG或完整LL结果误称为未知配置；保留partial publication与具体缺字段原因。

#### Scenario: [T25] 目录不可用
- **WHEN** catalog为空或providers-only
- **THEN** 显示来源不可用及实际恢复/配置结果，不要求provider证明
