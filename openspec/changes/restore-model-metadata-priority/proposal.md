# Proposal

## Why

LiteLLM 已发现模型，但 Core 把 models.dev 的能力和 reasoning_options 绑定到实际 serving provider 证明，导致自动配置丢失。用户实际 Pi 注册的 16 个模型均支持推理、保存档位均为空；本变更按用户明确的产品原则纠正规范及设计，先完成设计 Review。

## What Changes

1. 按可信模型身份自动匹配，元数据固定为官方 → OpenCode → OpenRouter；不要求 models_dev_provider 或实际转发服务商证明。
2. 分开推理支持与可选档位，保存缺失、显式 false、显式空选项的区别；严格保留型号、版本与 SKU。
3. **BREAKING**：删除价格阶梯限制上下文、LiteLLM 价格优先和价格参与发布/LKG 的规则；旧 contextTierCap 配置暂时接受但不再生效。
4. **BREAKING**：替换 schema 8 证明结构与旧诊断字段，旧策略快照需重新发现后才能恢复；保留关键能力、身份、协议及端点隔离校验。
5. 建立真实 16 模型基线、通用负向矩阵和两宿主 E2E 方案；本 PR 仅提交设计，未实现、未发布、未归档。

## Capabilities

### New Capabilities

无。复用现有能力边界，减少规则与状态。

### Modified Capabilities

| Capability | 调整 |
|---|---|
| modelsdev-catalog | 身份、来源优先级、推理与价格 |
| publication | 关键能力发布与 LKG |
| discovery-quality | 删除旧优先级与过度冲突规则 |
| discovery-resilience | 简化来源与恢复 |
| discovery-diagnostics | 用户摘要与开发审计 |
| discovery-core | 公共兼容边界 |
| discovery-snapshot | 价格与有效性分离 |

## Impact

Core 独占身份、能力、来源选择、推理、价格、发布及 LKG 语义。涉及 src/core/resolve.ts、modelsdev.ts、publication.ts、snapshot.ts、diagnostics.ts 及旧公开投影；不引用宿主 SDK。
两宿主分别建立同名 change，公共 API 兼容与快照迁移必须配套评审。

依赖：[pi-litellm-provider 同名 change](https://github.com/rpchen/pi-litellm-provider/tree/codex/restore-model-metadata-priority/openspec/changes/restore-model-metadata-priority)；[opencode-litellm-provider 同名 change](https://github.com/rpchen/opencode-litellm-provider/tree/codex/restore-model-metadata-priority/openspec/changes/restore-model-metadata-priority)。

设计材料的提交可同时审查。未来获批实施后，Core 先合入稳定 main SHA，再 Pi、OpenCode 各自按该 SHA 构建和验收。本轮不触发构建更新、不改 dist/provenance、版本、canonical specs、历史 archive 或用户配置。

现行规范与用户本次原则的冲突不是实施约束；由本 change 的明确 deltas 替代。详细审计与逐模型预期以 Core change 的 audit.md、design.md、test-matrix.md 和 evidence/ 为准。README 当前行为尚未改变：No README change: no user-visible behavior in this design-only PR；实施必须同步 README、testing-standard §8、相关 ADR 和过时 OpenSpec context。
