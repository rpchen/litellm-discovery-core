# Spec Delta

## REMOVED Requirements

### Requirement: source visibility
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 使用下述简洁来源与故障展示；protocol explanation 保持既有说明，不新增协议冲突阻断。

### Requirement: degraded enrichment
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 使用下述简洁来源与故障展示；protocol explanation 保持既有说明，不新增协议冲突阻断。

## ADDED Requirements

### Requirement: Readable selected metadata
Core SHALL 从同一结果显示模型配置状态、选中记录来源、推理支持与可选档位、真正影响使用的错误。matched 计实际采用 models.dev 配置能力的模型，MUST NOT 以 serving proof 计数或提示 models_dev_provider。主动审计保留公开 record/canonical 引用及最终配置，默认不输出候选、内部 route/proof；保留既有故障来源与缓存年龄。

#### Scenario: [T22] 用户可读
- **WHEN** 16项自动采用 models.dev
- **THEN** 准确显示匹配/配置和各自档位，未声明 provider 不计0。

#### Scenario: [T23] 主动审计安全
- **WHEN** 原始输入有地址、凭据或内部 route
- **THEN** 不复制敏感字段，仅输出既有 allowlist 的公开来源和最终配置。
