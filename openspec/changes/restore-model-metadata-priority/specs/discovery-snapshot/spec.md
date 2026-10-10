# Spec Delta

## REMOVED Requirements

### Requirement: versioned snapshot
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Metadata policy snapshot version；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: endpoint-bound compatibility
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Endpoint-scoped critical configuration；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: defensive restore
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Critical snapshot integrity；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: drift comparison
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Separate display changes from availability；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: Metadata policy snapshot version
Core SHALL 使用snapshot schema2保存新策略中立模型和关键内容指纹；publication schema9对应新的LKG策略。旧schema不得直接回放为已校验新结果。

#### Scenario: [T19] 旧快照升级
- **WHEN** 遇到schema1持久快照
- **THEN** 拒绝恢复并等待成功刷新重建2

### Requirement: Endpoint-scoped critical configuration
Core SHALL 验证endpoint/credential/协议相关选项scope；废弃contextTierCap和价格不参与有效性，仍保留端点ID隔离。

#### Scenario: [T21] 端点改变
- **WHEN** 快照scope与当前endpoint或credential不符
- **THEN** 不恢复

#### Scenario: [T17] 旧cap配置改变
- **WHEN** 仅contextTierCap变化
- **THEN** 新策略兼容性不变

### Requirement: Critical snapshot integrity
Core SHALL 验证关键模型结构与关键指纹并隔离坏数据；cost缺失/错误单独归零，MUST NOT 拒绝其他完整关键配置。模型身份、协议或关键内容损坏仍拒绝。

#### Scenario: [T19] 价格损坏
- **WHEN** 合法关键快照的cost被移除或损坏
- **THEN** 恢复关键配置并填0

#### Scenario: [T19] 能力损坏
- **WHEN** 关键context被修改而校验不符
- **THEN** 拒绝该不可信快照

### Requirement: Separate display changes from availability
Core SHALL 区分需要宿主更新的内容变化和影响模型可用性的关键变化；价格变更可刷新显示，MUST NOT 引发能力regression、LKG失效或通知问题指纹变化。

#### Scenario: [T16] 显示价格更新
- **WHEN** 仅cost变化
- **THEN** 可更新显示但模型持续可用
