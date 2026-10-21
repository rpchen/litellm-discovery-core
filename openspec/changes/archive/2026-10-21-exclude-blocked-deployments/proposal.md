## Why

用户在 LiteLLM 1.99.0 的 Models 列表通过 Disable 暂停全部 GPT deployment 后，`/v1/models` 已隐藏七个 GPT 名称，但 `model/info` 仍返回它们。Core 分组只过滤非对话模式，忽略 `model_info.blocked`，导致两个宿主继续发布已暂停模型。

## What Changes

- 分组前跳过明确 `model_info.blocked === true` 的 deployment，复用现有构建、publication、diagnostics 和增量身份路径。
- 用冻结脱敏样本验证 29 deployment / 25 名称、15 可见项含一个 embedding 的数量结构；这份样本为合成测试数据，不冒充用户原始响应。
- 覆盖混合启停 deployment、增量移除与 LKG 不复活暂停模型。

## Capabilities

### Modified Capabilities

- `discovery-core`：暂停 deployment 不参与分组和模型构建。

## Impact

Core 只做纯数据过滤，不增加 HTTP、宿主依赖、API 参数或新缓存机制。后续 Pi/OpenCode PR 需在 Core 合入后更新固定 provenance，验证实际 provider 发布；本 PR 不修改两个宿主。`/v1/models` 样本用于独立结果比较，不新增运行时请求。
