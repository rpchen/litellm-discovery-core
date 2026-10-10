# Spec Delta

## REMOVED Requirements

### Requirement: Publication completeness policy
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Essential capability admission；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Reasoning decoupled from levels
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Reasoning completeness independent of controls；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Deterministic source resolution and inheritance
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Identity-preserving metadata selection；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Group-wide limit evidence
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Selected token limits；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Per-dimension modality evidence
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Ordered modality sets；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Modality completeness
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Known conversational modalities；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Tri-state multi-deployment aggregation
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Consistent deployment identities；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: LKG completeness revalidation
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Critical configuration cache validation；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Failure taxonomy without pseudo-complete publication
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Per-model metadata failure outcomes；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Last Known Good without TTL
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Reusable verified configuration without expiry；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Configuration states and provenance
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Configuration outcomes and readable provenance；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## MODIFIED Requirements

### Requirement: False versus unknown
Core SHALL 保留false、missing/null、invalid之间的区别，不把unknown默认成false或true。false是完整结论，未知关键字段必须由下一合格来源或LKG解决。

#### Scenario: [T10] 不支持与未声明
- **WHEN** 分别出现明确false与所有来源缺失
- **THEN** false不阻发布，未知未解决不得正常发布

#### Scenario: Missing tool declaration stays unknown
- **WHEN** neither LiteLLM nor models.dev declares tool-call support
- **THEN** Core reports tool support `unknown`, not `unsupported`

#### Scenario: Explicit negative evidence means unsupported
- **WHEN** a trusted source explicitly declares no tool-call or reasoning support without contradiction
- **THEN** Core reports `unsupported`

## ADDED Requirements

### Requirement: Essential capability admission
Core SHALL 仅在身份无冲突、协议可映射、有限正context/output、tools/reasoning明确、输入和输出模态已知且适合文本会话时正常发布。false是明确事实；price、input、release与档位数量不是准入条件。缺失关键字段或真实身份/能力/协议冲突只withhold该模型，不影响其他模型；通知确认不能改变发布。

#### Scenario: [T14] 无档位仍可用
- **WHEN** reasoning=true且无可选档位，其他关键事实完整
- **THEN** 正常发布

#### Scenario: [T16] 坏价格不阻断
- **WHEN** 关键事实完整而所有价格非法
- **THEN** 参考价归零并正常发布

### Requirement: Reasoning completeness independent of controls
Core SHALL 按modelsdev-catalog读取支持与同记录选项；supported+空/缺options可发布，unsupported不带variants，unknown不伪造支持。

#### Scenario: [T14] 支持但无档位
- **WHEN** 记录reasoning=true，options为[]、toggle或缺失
- **THEN** 保持supported，不造effort，不因空variants撤下

### Requirement: Identity-preserving metadata selection
Core SHALL 使用modelsdev-catalog固定来源链与精确身份规则；字段缺失才向下查找，不能跨SKU继承。models_dev_provider不影响选择。

#### Scenario: [T02] 官方别名提供完整能力
- **WHEN** deepseek-flash显式指向V4.1Flash
- **THEN** 无声明也用官方393216输出和low/high/max

#### Scenario: [T03] fallback值高于LL描述
- **WHEN** 官方缺失，合格OpenCode/OpenRouter记录与LL不同
- **THEN** 按固定优先级采用，不把LL描述差异当冲突

### Requirement: Selected token limits
Core SHALL 仅按同维度解析有效context/input/output；只在当前字段依赖LiteLLM补缺时检查deployment一致性。MUST NOT 用价格tier、request defaults或max_input造context；不采用的低层描述不阻止有效目录配置。

#### Scenario: [T12] 错误低层限制
- **WHEN** 官方限制完整，LL出现0/负数或不同输出描述
- **THEN** 保持官方限制；缺官方且被采用的关键限制非法时withhold

### Requirement: Ordered modality sets
Core SHALL 分别选择输入与输出完整模态集合，缺失才查下一来源，明确集合外的模态不视为支持；MUST NOT 用family例外或宿主默认添加能力。

#### Scenario: [T10] image明确不支持
- **WHEN** 官方input仅text，下层含image
- **THEN** 不添加image

### Requirement: Known conversational modalities
Core SHALL 仅发布输入/输出模态已知且包含文本会话必需能力的模型；缺某模态字段不默认成text，非对话模型保留既有过滤。

#### Scenario: [T30] 未知或nontext-only
- **WHEN** 全部来源缺输入模态或模型只支持音频输入
- **THEN** 不得向文本会话宿主伪造text能力

### Requirement: Consistent deployment identities
Core SHALL 首先验证多deployment模型身份/协议一致；目录权威字段不与LL取交集。仅LL补缺字段使用一致的明确值，缺失为未知，冲突为未解决；deployment顺序/ID不影响结果。

#### Scenario: [T08] 相同身份与不同描述
- **WHEN** 两deployment同模型且LLtools相反，官方tools明确
- **THEN** 采用官方；无官方或后两级字段时冲突withhold

#### Scenario: [T11] 协议冲突
- **WHEN** 同组明确协议不同且无override
- **THEN** withhold，不静默降为Chat

### Requirement: Critical configuration cache validation
Core SHALL 仅捕获通过当前发布门禁的完整关键配置；schema9条目包含稳定模型身份、协议、关键ModelSpec与最少来源，保留端点scope和捕获时间。恢复须同身份/协议/端点、关键内容完整、无新可信关键冲突且当前目录仍含该模型。价格、部署ID/顺序、空enforcement、serving声明不参与兼容；年龄不是失效条件。活catalog真实歧义不得用LKG掩盖；新的完整live结果直接采用。

#### Scenario: [T18] outage后恢复
- **WHEN** catalog中断且当前同身份模型仍在，LKG关键事实完整
- **THEN** 以configured-lkg发布并显示来源/年龄

#### Scenario: [T20] 身份改变或模型删除
- **WHEN** live清单删除模型或身份/协议改变
- **THEN** 不恢复旧模型

#### Scenario: [T16] 只改价格
- **WHEN** 所有关键事实不变，价格改变/损坏
- **THEN** 保留LKG有效性

### Requirement: Per-model metadata failure outcomes
Core SHALL 区分网络不可用、身份歧义、字段缺失与非法关键数据。完整LiteLLM-only配置或合法LKG仍可发布；其余withhold，不用宿主默认、价格或用户确认伪造完整性。

#### Scenario: [T25] catalog失败
- **WHEN** 目录失败，部分模型有合法LKG或明确完整LL事实
- **THEN** 仅发布完整/合法恢复的模型，其余列出具体缺口

### Requirement: Reusable verified configuration without expiry
Core SHALL 仅捕获通过当前发布门禁的完整关键配置；schema9条目包含稳定模型身份、协议、关键ModelSpec与最少来源，保留端点scope和捕获时间。恢复须同身份/协议/端点、关键内容完整、无新可信关键冲突且当前目录仍含该模型。价格、部署ID/顺序、空enforcement、serving声明不参与兼容；年龄不是失效条件。活catalog真实歧义不得用LKG掩盖；新的完整live结果直接采用。

#### Scenario: [T18] 老但有效
- **WHEN** 相同scope身份协议的完整快照年龄增加
- **THEN** 仅展示年龄，不按TTL撤下

#### Scenario: [T19] 旧schema
- **WHEN** 只有schema8快照且目录不可用
- **THEN** 不冒充新策略，成功刷新后重建9

### Requirement: Configuration outcomes and readable provenance
Core SHALL 沿用configured/configured-lkg与已有withheld原因表达结果，不为provider proof、价格或候选数量新增状态。保留字段来源给主动审计，默认摘要不展示内部证明树；匹配数统计实际采用models.dev能力的模型。

#### Scenario: [T22] 匹配与配置数量
- **WHEN** 身份命中但关键字段未采用或尚缺失
- **THEN** 分别记录身份审计、实际metadata匹配与发布状态，不宣称成功
