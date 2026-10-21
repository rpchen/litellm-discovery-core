## ADDED Requirements

### Requirement: Paused LiteLLM deployments are excluded

Core MUST 在按 model_name 分组之前排除 `model_info.blocked` 明确为布尔 true 的 deployment。其他值沿用既有行为；同名组只有仍参与发现的对话 deployment 才能进入构建、publication、diagnostics 与增量身份集合。

#### Scenario: [BLOCKED-LIST] 全部暂停的模型不再发布

- **GIVEN** `model/info` 仍含七个全部暂停的 GPT 模型，独立可见列表包含十五项，其中一个为 embedding
- **WHEN** Core 构建对话模型 publication
- **THEN** 七个暂停模型均不发布，发布集合是该可见列表的子集
- **AND** embedding 和缺少必要元数据的对话模型也不发布，不假定十五个可见项全部可注册

#### Scenario: [BLOCKED-MIXED] 同名模型仍有启用的 deployment

- **WHEN** 同名组同时包含暂停和未暂停的 deployment
- **THEN** 模型仍参与发现，分组及配置只消费未暂停的 deployment
- **AND** 所有 deployment 都暂停时该组消失；blocked 为 false 或缺失时保持兼容

#### Scenario: [BLOCKED-REFRESH] 暂停模型从增量与 LKG 发布中移除

- **GIVEN** 模型此前发布且存在有效 LKG，model/info 的原始名称仍然存在
- **WHEN** 该模型所有 deployment 改为 blocked=true
- **THEN** 增量身份变化将其作为删除处理，正常与 LKG publication 均不复活它
- **AND** diagnostics 的模型集合与正常构建一致
