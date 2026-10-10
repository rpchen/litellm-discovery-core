# Spec Delta

## REMOVED Requirements

### Requirement: Fact classes are resolved separately
**Reason**: 实际serving归属与空enforcement证明框架偏离自动元数据配置目标。
**Migration**: 使用本change的确定性元数据来源；已有models_dev_provider忽略，不要求用户删除配置。

### Requirement: Serving provider proof
**Reason**: 实际serving归属与空enforcement证明框架偏离自动元数据配置目标。
**Migration**: 使用本change的确定性元数据来源；已有models_dev_provider忽略，不要求用户删除配置。

### Requirement: Unproven provider records never supply publication facts
**Reason**: 实际serving归属与空enforcement证明框架偏离自动元数据配置目标。
**Migration**: 使用本change的确定性元数据来源；已有models_dev_provider忽略，不要求用户删除配置。

### Requirement: Runtime enforcement matrix
**Reason**: 实际serving归属与空enforcement证明框架偏离自动元数据配置目标。
**Migration**: 使用本change的确定性元数据来源；已有models_dev_provider忽略，不要求用户删除配置。

### Requirement: Last Known Good schema 8 proof composition
**Reason**: 多重proof包含价格、部署细节与空enforcement，妨碍有效恢复。
**Migration**: 使用publication中的最小关键配置兼容规则；schema8条目不升级为已验证9。

### Requirement: Catalog input contract
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Atomic catalog input；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Wire-ID parsing carries no authority
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Exact transport and model name parsing；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Canonical identity resolution
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Canonical identity with official API aliases；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Field resolution matrix
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Ordered metadata fields；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Reasoning controls authority
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Reasoning support and controls from one record；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Price authority
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Optional reference prices；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Catalogue-wide regression evidence
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Actual model regression coverage；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## MODIFIED Requirements

### Requirement: Single resolution result
Core SHALL 用同一身份/字段解析结果派生ModelSpec、publication、diagnostics和LKG；公开兼容helper不得维护第二份算法。

#### Scenario: [T24] 入口一致
- **WHEN** 主构建、诊断、publication及兼容入口处理同一输入
- **THEN** 关键事实与来源一致；无旧proof分支

#### Scenario: Gate and configuration cannot diverge
- **WHEN** any discovery input is evaluated
- **THEN** every publishable entry's ModelSpec limits, tools, reasoning verdict, modalities, and variants equal the resolved values, `buildModelSpecs` equals the diagnostics models, and an LKG captured from the round stores the same facts

#### Scenario: No cross-provider field inheritance
- **WHEN** a selected serving record omits a field
- **THEN** Core never copies that field from another provider's record and never refills it from the canonical registry entry; the field follows its serving-absence policy (unknown, or a same-dimension LiteLLM declaration as `litellm-declared`)

## ADDED Requirements

### Requirement: Deterministic metadata source priority
Core SHALL 固定按官方 → OpenCode → OpenRouter 选择同身份记录。官方由 canonical owner 与 provider 同名关系或有公开来源的组织别名表识别，MUST NOT 使用模型家族表或用户声明。owner 主provider优先，别名固定顺序；provider内精确key优先，官方允许显式canonical relation别名，无exact时非deprecated优先，关键事实等价可按key稳定选取，不等价则withheld。OpenCode/OpenRouter只接受精确canonical完整/bare key或明确请求SKU，不把relation-only的free/pro等SKU替代普通模型。价格不参与等价比较。

#### Scenario: [T03] 三级优先级
- **WHEN** 同身份官方、OpenCode、OpenRouter记录同时存在或逐级缺失
- **THEN** 依次选官方、OpenCode、OpenRouter，任意第三方唯一记录不进入选择

#### Scenario: [T04] 官方provider命名不同
- **WHEN** owner为tencent且已确认组织别名为tencent-tokenhub
- **THEN** 官方记录优先，无需LiteLLM provider证明

#### Scenario: [T05] 等价官方alias
- **WHEN** 多个无exact的官方relation项关键事实相同但价格不同
- **THEN** 记录重排不改变配置或发布

#### Scenario: [T06] 真正目录歧义
- **WHEN** 同层无exact的官方relation候选关键能力不同
- **THEN** withhold，不用低优先来源掩盖

#### Scenario: [T01] provider声明无关
- **WHEN** 省略或改变models_dev_provider
- **THEN** 相同身份输入的能力、档位和发布结果不变

### Requirement: Atomic catalog input
Core SHALL 消费同一 snapshot 的 providers 与 models；缺少任一部分时不使用 provider 元数据，按 unavailable 保留发现结果、完整 LiteLLM-only 配置或有效 LKG；其余逐模型 withheld。目录坏记录 SHALL 按模型隔离。

#### Scenario: [T25] 目录形状无效
- **WHEN** 收到 providers-only、空或损坏 catalog
- **THEN** 不拼接不同 epoch；不凭 provider map 猜身份；其他合法发现/缓存结果按发布规则处理

### Requirement: Exact transport and model name parsing
Core SHALL 保留原始请求 model_name，只剥离已知 transport adapter 前缀并做非语义大小写规范化；MUST NOT 将 adapter 当 serving provider，或删除日期、尺寸、版本、SKU 后缀。

#### Scenario: [T07] 公开名称和路由别名
- **WHEN** base_model 缺失、route 为未知私有别名而 model_name 唯一精确命中
- **THEN** 使用该公开身份；不需要 models_dev_provider

#### Scenario: [T09] 语义后缀
- **WHEN** 只有去掉 -free 或日期才能命中
- **THEN** 拒绝该猜测

### Requirement: Canonical identity with official API aliases
Core SHALL 按 base_model、route model、model_name 查找 canonical 完整 key、唯一 bare key、显式 canonical_model_id 及同官方 owner 下无矛盾 relation 的精确 API ID。所有已解析身份线索和各 deployment SHALL 一致，不能以顺序覆盖已知矛盾。显式 SKU SHALL 保持精确身份；canonical 输入与同名 API record relation 冲突时排除该 record，不改写 canonical。

#### Scenario: [T02] 官方API别名
- **WHEN** canonical 为 deepseek/deepseek-v4.1-flash，官方 deepseek-flash 显式关联它
- **THEN** 自动关联，不要求实际 serving 证明

#### Scenario: [T08] 多deployment不同模型
- **WHEN** 一个 host 名下已知线索分别指向两个型号
- **THEN** 只 withheld 该模型并说明身份冲突

#### Scenario: [T09] 同名但不同日期版本
- **WHEN** deepseek-v4-pro 的官方同名记录指向 -0813
- **THEN** 不采用该记录；可选择同原 canonical 的 OpenCode 记录

#### Scenario: [T26] bare重名
- **WHEN** bare ID 对应多个 canonical 且无唯一线索
- **THEN** 报告歧义，不取首项

### Requirement: Ordered metadata fields
Core SHALL 按固定来源链逐字段读取tools、limits、完整输入/输出模态集合与release；仅missing/null继续下一来源，false和明确集合终止，MUST NOT 合并模态。关键字段错误类型、非有限/非正限制为数据错误；可选input/release未知不阻发布。所有目录记录均缺字段时可保留既有一致、同维度LiteLLM model_info补缺；max_input_tokens不得成为context，低优先描述不得veto已采用的目录事实。canonical registry只供身份，不抢先覆盖provider能力。

#### Scenario: [T10] false与缺失
- **WHEN** 官方tool_call=false，下层true；或官方完全缺该字段
- **THEN** 前者保持false；后者才读下层

#### Scenario: [T10] 模态不并集
- **WHEN** 官方input=[text]而下层[text,image]
- **THEN** 保持[text]；字段缺失和明确无image不同

#### Scenario: [T12] 低层描述冲突
- **WHEN** 官方有效context/output，LiteLLM存在不同或非法描述
- **THEN** 采用官方；不缩窄或withhold

#### Scenario: [T12] LiteLLM补缺冲突
- **WHEN** 所有目录均缺同一关键字段且deployment明确值不同
- **THEN** 该字段未解决，withhold模型

### Requirement: Reasoning support and controls from one record
Core SHALL 独立保留推理支持与可选档位。取来源链首个明确reasoning布尔值及该同一记录reasoning_options；false为unsupported，true为supported。effort严格使用该记录values，不跨记录并集、不从LiteLLM effort标志或家族模板产生；true+[]/toggle无可选effort，true+缺options为档位unknown且可发布。false+非空effort为源冲突。未知控制类型不造档位。Messages budget只在受支持协议按实际max产生合法high/max，不编造无依据最大预算。

#### Scenario: [T13] 每个GPT独立
- **WHEN** gpt-5.6-luna和gpt-6-astra记录的effort分别有/无none
- **THEN** 输出各自真实列表，不套统一模板

#### Scenario: [T14] 三种支持状态
- **WHEN** 分别收到false、true+[]或toggle、true+effort
- **THEN** 输出不支持、支持无档位、支持有精确档位

#### Scenario: [T14] 缺options与空数组
- **WHEN** 支持记录缺options或明确[]
- **THEN** 前者档位unknown、后者known-empty；都不借下级档位

#### Scenario: [T15] 控制矛盾与budget
- **WHEN** false却声明effort，或Messages budget无max
- **THEN** 矛盾withhold；无max不生成max档位

### Requirement: Optional reference prices
Core SHALL 将价格作为可选参考值，按官方 → OpenCode → OpenRouter 独立取每个分量首个有限非负值；0有效，缺失/错误跳过，最终0。MUST NOT 使用operator/LiteLLM价格优先、最高deployment价、serving proof、价格tier截断限制；价格不得参与身份、能力、发布、LKG或regression判定。contextTierCap旧键接受但忽略。

#### Scenario: [T16] 价格任意变换
- **WHEN** 仅价格改成缺失、0、负数、坏对象、非有限数或互相冲突
- **THEN** published ID、关键能力、档位与LKG有效性不变；参考价有限且非负

#### Scenario: [T17] 272k阶梯
- **WHEN** GPT真实context1050000且LiteLLM有272k价格阶梯
- **THEN** context保持1050000，contextTierCap取值无影响

### Requirement: Actual model regression coverage
Core SHALL 用固定公开目录和实际16名称的脱敏合成输入覆盖匹配、每模型能力/选项和错误边界。MUST 保留通用身份/SKU负向、顺序无关和价格不变性测试，不再以unproven记录不得贡献事实为成功指标。

#### Scenario: [T01] 全16项验收
- **WHEN** 执行冻结目录验收
- **THEN** 逐项匹配expected-16而非只计数

#### Scenario: [T27] 不固化错误
- **WHEN** 替换旧proof/cap预期
- **THEN** 新测试仍覆盖身份歧义、坏能力、端点隔离和公开API
