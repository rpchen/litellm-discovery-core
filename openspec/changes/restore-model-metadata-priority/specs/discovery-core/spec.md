# Spec Delta

## REMOVED Requirements

### Requirement: Preserve discovery behavior
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Preserve discovery entrypoints with corrected metadata；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: Preserve discovery entrypoints with corrected metadata
Core SHALL 保留地址归一化、模式过滤、model_name分组、正常协议选择、稳定排序和宿主无关API；元数据优先级、价格与LKG行为以modelsdev-catalog/publication为准，MUST NOT 为迁移兼容保留价格tier截断或serving证明。

#### Scenario: [T24] 公共消费者
- **WHEN** 外部消费者使用公开入口处理固定输入
- **THEN** 取得同一新resolver结果，不依赖宿主或平级仓库
