# discovery-quality Specification

## Purpose
Defines accurate model names and versions, one selected record for capabilities, separate reasoning support and options, distinct token-limit dimensions, and existing protocol selection.

## Requirements

### Requirement: protocol capability visibility
Core SHALL distinguish the protocol selected for invocation from the protocols that upstream metadata says are supported.

#### Scenario: Chat Completions and Responses are both supported
- **WHEN** one deployment declares both Chat Completions and Responses endpoints
- **THEN** Core reports protocol capability `both` while preserving the existing selected-protocol precedence

#### Scenario: protocol evidence is missing
- **WHEN** no Anthropic, supported-endpoint or mode evidence identifies protocol support
- **THEN** Core reports protocol capability `unknown` while preserving the existing safe selected-protocol fallback

### Requirement: operational limits are explicit
Core SHALL distinguish a neutral discovered model from a model that has positive context/output limits suitable for host publication.

#### Scenario: private model has no token-limit metadata
- **WHEN** LiteLLM exposes a model and neither LiteLLM nor models.dev supplies positive context/output limits
- **THEN** Core retains the neutral ModelSpec for diagnostics, reports a missing-operational-limits warning, and reports that the ModelSpec is not operational for host publication

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
