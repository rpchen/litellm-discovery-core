# Spec Delta

## REMOVED Requirements

### Requirement: Publication completeness policy
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 整记录选择见 modelsdev-catalog，发布与 LKG 合并为下述必要规则；不再复制同一组缓存证明。

### Requirement: Reasoning decoupled from levels
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 整记录选择见 modelsdev-catalog，发布与 LKG 合并为下述必要规则；不再复制同一组缓存证明。

### Requirement: Deterministic source resolution and inheritance
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 整记录选择见 modelsdev-catalog，发布与 LKG 合并为下述必要规则；不再复制同一组缓存证明。

### Requirement: Group-wide limit evidence
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 整记录选择见 modelsdev-catalog，发布与 LKG 合并为下述必要规则；不再复制同一组缓存证明。

### Requirement: Per-dimension modality evidence
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 整记录选择见 modelsdev-catalog，发布与 LKG 合并为下述必要规则；不再复制同一组缓存证明。

### Requirement: Modality completeness
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 整记录选择见 modelsdev-catalog，发布与 LKG 合并为下述必要规则；不再复制同一组缓存证明。

### Requirement: Tri-state multi-deployment aggregation
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 整记录选择见 modelsdev-catalog，发布与 LKG 合并为下述必要规则；不再复制同一组缓存证明。

### Requirement: LKG completeness revalidation
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 整记录选择见 modelsdev-catalog，发布与 LKG 合并为下述必要规则；不再复制同一组缓存证明。

### Requirement: Failure taxonomy without pseudo-complete publication
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 整记录选择见 modelsdev-catalog，发布与 LKG 合并为下述必要规则；不再复制同一组缓存证明。

### Requirement: Last Known Good without TTL
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 整记录选择见 modelsdev-catalog，发布与 LKG 合并为下述必要规则；不再复制同一组缓存证明。

### Requirement: Configuration states and provenance
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 整记录选择见 modelsdev-catalog，发布与 LKG 合并为下述必要规则；不再复制同一组缓存证明。

## MODIFIED Requirements

### Requirement: False versus unknown
Core SHALL 保留明确 false 与未声明的区别，不默认制造支持或不支持；选中记录缺少关键字段时沿用已有完整性检查，不跨来源补字段。

#### Scenario: Missing tool declaration stays unknown
- **WHEN** 选中记录未声明 tool-call support
- **THEN** 保留 unknown，不改为 unsupported 或 true。

#### Scenario: Explicit negative evidence means unsupported
- **WHEN** 选中记录明确声明无 tool-call 或 reasoning 支持
- **THEN** 使用 unsupported；false 本身不阻止完整模型发布。

## ADDED Requirements

### Requirement: Essential capability admission
Core SHALL 复用已有关键配置完整性检查：有限正 context/output、明确 tools/reasoning、已知且符合宿主会话边界的模态。档位数量、价格和内部 deployment 身份不属于准入条件。MUST NOT 新增 mixed deployment 协议阻断；现有协议选择、默认值与 override 不变。通知确认不改变发布；单模型未配置不影响其他模型。

#### Scenario: [T14] 支持无档位
- **WHEN** reasoning=true 且 options=[] 或 toggle，其他关键能力完整
- **THEN** 正常发布，不造 effort。

#### Scenario: [T11] 已有协议回退
- **WHEN** 同 model_name 的内部 deployment 协议不同
- **THEN** 维持当前 mixed-fallback / override 行为，不新增 withheld。

#### Scenario: [T16] 无价格
- **WHEN** 关键配置完整，cost 缺失或错误
- **THEN** 价格填0，正常发布。

### Requirement: Critical configuration cache validation
Core SHALL 复用现有缓存入口，仅捕获有效关键配置。LKG 保留 endpoint/凭据 scope、model_name、关键 ModelSpec、schema 与必要内容校验、来源和时间。MUST NOT 比较内部 route/base_model、deployment multiset、serving 声明或价格来判有效性，不新建证明地图。成功清单中模型被删除不得恢复；scope 不同、关键缓存损坏按既有检查拒绝；age 仍不使有效缓存过期。publication schema 8→9、snapshot 1→2，旧错误配置经成功发现重建，不能冒充新策略。

#### Scenario: [T18] 目录中断仍可恢复
- **WHEN** 同 scope/model_name 仍在，缓存关键配置有效，目录暂不可用
- **THEN** 沿既有 LKG 路径继续使用，展示上次成功来源。

#### Scenario: [T20] 内部信息无关
- **WHEN** 同 model_name 的 route/base_model/deployment ID 或价格变化
- **THEN** 不因此使 LKG 失效。

#### Scenario: [T20] 删除模型
- **WHEN** 成功 LiteLLM 清单中已无该 model_name
- **THEN** 不恢复该模型。

#### Scenario: [T19] 旧配置与损坏内容
- **WHEN** 遇到旧 schema 或关键缓存内容损坏
- **THEN** 沿现有版本/完整性门禁拒绝；旧配置在成功发现后重建。

### Requirement: Existing metadata failure handling
Core SHALL 保留已有目录不可用、未匹配和关键字段不完整的诊断与按模型处理；不为假想缺字段增加恢复机制。有效 LKG 沿用既有路径，独立 LiteLLM-only 路径不扩展且不补充选中记录；无有效关键配置不得用宿主默认或用户确认伪造。

#### Scenario: [T25] 目录故障
- **WHEN** 目录暂不可用且部分模型有合法 LKG
- **THEN** 沿现有恢复与逐模型诊断处理；不新增字段级 fallback。
