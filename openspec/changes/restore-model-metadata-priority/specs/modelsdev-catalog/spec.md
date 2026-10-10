# Spec Delta

## REMOVED Requirements

### Requirement: Fact classes are resolved separately
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 采用下述 model_name 整记录规则及 publication 的简化缓存条件；回归沿原 T01–T34，不新增证明层。

### Requirement: Serving provider proof
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 采用下述 model_name 整记录规则及 publication 的简化缓存条件；回归沿原 T01–T34，不新增证明层。

### Requirement: Unproven provider records never supply publication facts
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 采用下述 model_name 整记录规则及 publication 的简化缓存条件；回归沿原 T01–T34，不新增证明层。

### Requirement: Runtime enforcement matrix
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 采用下述 model_name 整记录规则及 publication 的简化缓存条件；回归沿原 T01–T34，不新增证明层。

### Requirement: Last Known Good schema 8 proof composition
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 采用下述 model_name 整记录规则及 publication 的简化缓存条件；回归沿原 T01–T34，不新增证明层。

### Requirement: Catalog input contract
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 采用下述 model_name 整记录规则及 publication 的简化缓存条件；回归沿原 T01–T34，不新增证明层。

### Requirement: Wire-ID parsing carries no authority
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 采用下述 model_name 整记录规则及 publication 的简化缓存条件；回归沿原 T01–T34，不新增证明层。

### Requirement: Canonical identity resolution
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 采用下述 model_name 整记录规则及 publication 的简化缓存条件；回归沿原 T01–T34，不新增证明层。

### Requirement: Field resolution matrix
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 采用下述 model_name 整记录规则及 publication 的简化缓存条件；回归沿原 T01–T34，不新增证明层。

### Requirement: Reasoning controls authority
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 采用下述 model_name 整记录规则及 publication 的简化缓存条件；回归沿原 T01–T34，不新增证明层。

### Requirement: Price authority
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 采用下述 model_name 整记录规则及 publication 的简化缓存条件；回归沿原 T01–T34，不新增证明层。

### Requirement: Catalogue-wide regression evidence
**Reason**: 旧身份、proof、字段拼接或重复规则与本次用户确认的整记录选择不符。
**Migration**: 采用下述 model_name 整记录规则及 publication 的简化缓存条件；回归沿原 T01–T34，不新增证明层。

## MODIFIED Requirements

### Requirement: Single resolution result
Core SHALL 从同一选中记录配置生成 ModelSpec、publication、diagnostics 与 LKG；公开兼容入口不得运行另一套匹配算法。

#### Scenario: Gate and configuration cannot diverge
- **WHEN** 处理同一 discovery 输入
- **THEN** 发布、注册、诊断与捕获的关键能力一致。

#### Scenario: No cross-provider field inheritance
- **WHEN** 已选中模型记录
- **THEN** 只读该记录；缺字段不从其他 provider、canonical registry 或 LiteLLM 补齐。

## ADDED Requirements

### Requirement: Model name selects one metadata record
Core SHALL 以 LiteLLM model_name 为模型身份和请求 ID，只按该名称及明确目录关系，依次选择官方 → OpenCode → OpenRouter 中第一条明确对应的整记录。base_model、route、deployment ID 与 models_dev_provider 不参与元数据身份或发布判定。名称匹配 SHALL 保留型号、版本和 SKU；允许明确 canonical relation 及已确认官方 API/组织别名，MUST NOT 模糊猜测、擅自删除后缀、比较候选关键字段或拼接来源。找不到记录才换来源；已选记录缺字段不触发 provider fallback。

#### Scenario: [T01] 16模型按名称匹配
- **WHEN** 输入实际16个 model_name，无内部路由身份和 provider 声明
- **THEN** 选中记录及完整能力等于冻结 expected-16。

#### Scenario: [T02] 官方API名称不同
- **WHEN** deepseek-v4.1-flash 对应官方 deepseek-flash 的明确 relation
- **THEN** 读取该官方记录，保留原请求名。

#### Scenario: [T03] 整记录三级选择
- **WHEN** 官方、OpenCode、OpenRouter 的对应记录逐级不存在
- **THEN** 依次选第一条存在的对应记录，不拼字段。

#### Scenario: [T04] 已确认组织别名
- **WHEN** canonical owner 为 tencent，官方 provider 为 tencent-tokenhub
- **THEN** 使用已确认组织关系，不建立模型名硬编码表。

#### Scenario: [T08] 内部路由变化
- **WHEN** model_name 不变，base_model、route、deployment ID 缺失或变化
- **THEN** 元数据选择、关键能力和发布结果不变；协议仍按既有算法独立选择。

#### Scenario: [T09] 实际日期版本反例
- **WHEN** deepseek-v4-pro 官方同名记录 relation 指向 -0813
- **THEN** 排除不同版本，选 OpenCode 对应原型号记录。

### Requirement: Compatible catalog input
Core SHALL 使用同一 catalog snapshot 的 models 与 providers，保持既有 complete/providers-only/unavailable 形状判定。未知额外顶层字段 SHALL 忽略；providers-only、models-only、非对象或损坏结构沿用既有不可用处理，不混合 snapshot，不让 adapter 复制目录校验。

#### Scenario: [T25] 目录不可用
- **WHEN** catalog 缺少 models 或 providers、为空或不是有效对象
- **THEN** 保留既有目录不可用诊断与合法 LKG；不据残缺目录猜测。

#### Scenario: [T26] Future top-level keys are ignored
- **WHEN** 有效 models/providers 外新增时间戳、schema version 或未知字段
- **THEN** 仍正常读取有效目录，未知字段不影响模型配置。

### Requirement: Capabilities come from the selected record
Core SHALL 直接读取选中记录的能力、limits、modalities 与 reasoning_options。false、明确空数组和 toggle 是有效值；不能取多 provider 交集或并集，不能用 LiteLLM 描述覆盖或补字段。选中记录继续使用已有关键能力完整性、类型及正 context/output 校验；可选字段缺失不造值。本轮 MUST NOT 为未观察到的缺字段问题新建 fallback 或状态。

#### Scenario: [T10] 整条记录保真
- **WHEN** 选中记录声明 tools=false、text-only、空选项或 toggle，其他记录不同
- **THEN** 完整使用选中记录，不增加 true/image/effort；明确值不视为缺失。

#### Scenario: [T12] 限制来源
- **WHEN** 选中记录有 context/output，LiteLLM 描述或价格阶梯不同
- **THEN** 保持选中记录上限，input 与 context 不混用。

### Requirement: Reasoning support and options from the selected record
Core SHALL 分别表达不支持推理、支持无可选 effort、支持且有明确 effort。只按选中记录 reasoning 与 reasoning_options 读取，MUST NOT 用 GPT 模板、家族、LiteLLM 标志或其他 provider 补选项。本轮不新增 budget 推导或推理控制状态。

#### Scenario: [T13] GPT各自选项
- **WHEN** luna 的 effort 有 none，astra/6.1-sol 没有 none
- **THEN** 各自使用真实列表。

#### Scenario: [T14] 支持与档位分离
- **WHEN** 分别为 reasoning=false、true+[]/toggle、true+effort
- **THEN** 分别得到不支持、支持无档位、支持有对应档位；无档位不改 false。

### Requirement: Optional prices from the selected record
Core SHALL 仅使用所选记录的参考价；现有价格分量为有限非负数则使用，否则填 0。MUST NOT 跨 provider 补价格、比较 LiteLLM 价格或增加价格证明。价格不影响能力、限制、推理、发布或 LKG；删除价格阶梯截断，contextTierCap 接受但忽略，实施时更新用户文档。

#### Scenario: [T16] 价格独立
- **WHEN** 仅所选记录 cost 缺失、错误、0 或变化，其他 provider 有价
- **THEN** 使用该记录有效值或 0，不补下层价格；能力、发布和 LKG 不变。

#### Scenario: [T17] 上下文不受价格限制
- **WHEN** 选中 GPT context=1050000，存在272k价格阶梯或旧 cap 配置
- **THEN** context 仍为1050000，档位与输出不变。
