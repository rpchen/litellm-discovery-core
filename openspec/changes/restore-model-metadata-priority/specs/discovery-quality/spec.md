# Spec Delta

## REMOVED Requirements

### Requirement: provider disambiguation
**Reason**: serving provider证明不再需要。
**Migration**: 使用modelsdev-catalog确定性来源与身份歧义处理。

### Requirement: record-level selection determinism
**Reason**: 旧规则禁止官方canonical relation并把cost列为关键。
**Migration**: 使用modelsdev-catalog新Deterministic metadata source priority。

### Requirement: runtime constraints never conflict with serving metadata
**Reason**: 空promotion/enforcement框架无当前作用。
**Migration**: 只校验采用的同维度能力，不把请求配置当强制限制。

### Requirement: conservative canonical model identity
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Exact model identity boundaries；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: reasoning resolution
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Independent reasoning support and options；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: token-limit semantics
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Separate token limit dimensions；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: deterministic metadata precedence
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Ordered model metadata；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: protocol capability visibility
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Invocation protocol compatibility；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: unknown-model fallback
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Private model completeness；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: discovery-quality provenance
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Selected metadata provenance；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: Exact model identity boundaries
Core SHALL 遵循modelsdev-catalog精确名称、canonical与官方API关系；不按family猜测，不删除版本/SKU片段。

#### Scenario: [T09] 不跨版本
- **WHEN** 存在同名前缀的另一个日期版本
- **THEN** 不把其能力合到当前模型

### Requirement: Independent reasoning support and options
Core SHALL 使用modelsdev-catalog的同记录reasoning/选项规则，保留supported/unsupported/unknown与known-empty/unknown选项区别。

#### Scenario: [T13] GPT真实选项
- **WHEN** 不同GPT记录的values不同
- **THEN** 各自采用自己的选项

### Requirement: Separate token limit dimensions
Core SHALL 区分总context、input与output；缺input保持未知，不以input替代context，不从价格/请求默认导出上限。

#### Scenario: [T12] input不等于context
- **WHEN** 只提供max_input_tokens
- **THEN** 不能据此宣布context已知

### Requirement: Ordered model metadata
Core SHALL 按官方 → OpenCode → OpenRouter，并仅在缺字段后使用一致的LiteLLM描述补缺；MUST NOT 取所有来源交集或最高LiteLLM价。

#### Scenario: [T10] 官方能力覆盖描述
- **WHEN** LL描述与官方能力不同
- **THEN** 采用官方并只在审计保留差异

### Requirement: Invocation protocol compatibility
Core SHALL 区分协议支持与选中协议，保留现行无声明默认与显式override；明确多deployment协议冲突无override时withhold。

#### Scenario: [T11] 多协议
- **WHEN** 同一deployment支持Chat与Responses
- **THEN** 保持Responses优先

#### Scenario: [T11] 部署协议冲突
- **WHEN** 不同deployment要求不兼容协议
- **THEN** 不静默回退Chat

### Requirement: Private model completeness
Core SHALL 保留无catalog命中的私有模型用于diagnostics；只有同一精确LL身份和所有必需字段明确一致才允许LiteLLM-only发布。未知context不按model_name或max_input猜测。

#### Scenario: [T25] 私有模型缺关键字段
- **WHEN** 无catalog记录且context未知
- **THEN** 保留可诊断ModelSpec但不发布

### Requirement: Selected metadata provenance
Core SHALL 记录实际采用的字段来源、身份和真实冲突；默认用户摘要只呈现配置结果与具体缺口，开发审计可看公开record引用。

#### Scenario: [T22] 来源可解释
- **WHEN** 自动官方匹配成功
- **THEN** 解释官方来源，不要求用户证明serving
