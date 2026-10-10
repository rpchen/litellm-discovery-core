# Spec Delta

## REMOVED Requirements

### Requirement: provider disambiguation
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一遵循 modelsdev-catalog 的 model_name 整记录规则及 publication 既有完整性/LKG 边界；protocol capability visibility 保持原样。

### Requirement: record-level selection determinism
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一遵循 modelsdev-catalog 的 model_name 整记录规则及 publication 既有完整性/LKG 边界；protocol capability visibility 保持原样。

### Requirement: runtime constraints never conflict with serving metadata
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一遵循 modelsdev-catalog 的 model_name 整记录规则及 publication 既有完整性/LKG 边界；protocol capability visibility 保持原样。

### Requirement: conservative canonical model identity
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一遵循 modelsdev-catalog 的 model_name 整记录规则及 publication 既有完整性/LKG 边界；protocol capability visibility 保持原样。

### Requirement: reasoning resolution
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一遵循 modelsdev-catalog 的 model_name 整记录规则及 publication 既有完整性/LKG 边界；protocol capability visibility 保持原样。

### Requirement: token-limit semantics
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一遵循 modelsdev-catalog 的 model_name 整记录规则及 publication 既有完整性/LKG 边界；protocol capability visibility 保持原样。

### Requirement: deterministic metadata precedence
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一遵循 modelsdev-catalog 的 model_name 整记录规则及 publication 既有完整性/LKG 边界；protocol capability visibility 保持原样。

### Requirement: unknown-model fallback
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一遵循 modelsdev-catalog 的 model_name 整记录规则及 publication 既有完整性/LKG 边界；protocol capability visibility 保持原样。

### Requirement: discovery-quality provenance
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 统一遵循 modelsdev-catalog 的 model_name 整记录规则及 publication 既有完整性/LKG 边界；protocol capability visibility 保持原样。

## ADDED Requirements

### Requirement: Single record quality boundary
Core SHALL 按 model_name 精确关联所选记录，保留版本/SKU、同维度 context/input/output 和推理支持/档位区别；不做 provider 字段拼接、LL 覆盖、家族推断或价格截断。默认诊断显示配置结果与选中来源。无可用记录沿现有诊断/缓存路径处理，不新建私有模型推断规则。

#### Scenario: [T09] 不跨型号
- **WHEN** 同名前缀存在其他日期或 SKU
- **THEN** 不把该记录合并为当前模型。

#### Scenario: [T10] 来源唯一
- **WHEN** 选中官方记录与其他来源描述不同
- **THEN** 完整采用该记录，不做交集、并集或补字段。

#### Scenario: [T12] 限制维度
- **WHEN** 只有 input 信息而无总 context
- **THEN** 不以 input 或价格虚构 context，使用既有完整性诊断。
