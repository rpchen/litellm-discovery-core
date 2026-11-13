## MODIFIED Requirements

### Requirement: Model name selects one metadata record
Core SHALL 以 LiteLLM model_name 为模型身份和请求 ID，只按该名称及明确目录关系，依次选择官方 → OpenCode → OpenRouter 中第一条明确对应的整记录。base_model、route、deployment ID 与 models_dev_provider 不参与元数据身份或发布判定。裸公开名称有唯一 canonical 候选时 SHALL 优先按官方（含组织别名）→ OpenCode → OpenRouter 查找精确同名记录的明确 canonical_model_id，关系指向同一目录现存 canonical 时采用该编号，再按原供应商顺序选择整记录；没有有效关系时沿用原查找。显式 qualified canonical 保持精确绑定。名称匹配 SHALL 保留型号、版本和 SKU；允许明确 canonical relation 及已确认官方 API/组织别名，MUST NOT 模糊猜测、擅自删除后缀、比较候选关键字段或拼接来源。找不到记录才换来源；已选记录缺字段不触发 provider fallback。

#### Scenario: [T01] 16模型按名称匹配
- **WHEN** 输入实际16个 model_name，无内部路由身份和 provider 声明
- **THEN** 选中记录及完整能力等于冻结 expected-16。

#### Scenario: [T02] 官方API名称不同
- **WHEN** deepseek-v4.1-flash 无精确 API 名称匹配，通过官方 canonical relation 查找别名
- **THEN** 仅在该别名查找中排除 status=deprecated，读取 deepseek-flash 并保留原请求名；精确指定旧 deprecated API 名称时仍匹配该记录，不使用此过滤。

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
- **THEN** 跟随官方精确同名记录的明确 relation，采用该编号对应的官方整记录；不根据日期后缀猜测。

#### Scenario: [CANONICAL-REDIRECT] 同名关系搭桥后取官方整记录
- **WHEN** 顶层保留旧 canonical，OpenCode 精确同名记录明确指向现存新 canonical，官方别名也指向新 canonical
- **THEN** 选中新 canonical 对应的官方整记录并保留原请求名；context 大于 output 时仍采用该记录 output，不裁剪为 LiteLLM 描述额度。

#### Scenario: [CANONICAL-OFFICIAL-FIRST] 官方同名优先确定编号
- **WHEN** 官方和 OpenCode 精确同名记录的明确关系不同
- **THEN** 优先采用官方精确同名记录指向的编号与整记录。

#### Scenario: [CANONICAL-EXPLICIT] 显式编号不跟随裸名称关系
- **WHEN** 请求名为完整 qualified canonical，其他裸同名 API 指向另一编号
- **THEN** 保持指定编号，不重定向为另一版本。

#### Scenario: [CANONICAL-NO-GUESS] 相似 SKU 不构成同名关系
- **WHEN** 只有增加 free 或 pro 后缀的记录指向另一编号
- **THEN** 不用它重定向原型号，保留原查找结果。
