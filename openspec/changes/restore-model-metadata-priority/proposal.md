# Proposal

## Why

LiteLLM 已发现模型，但 Core 把 models.dev 的能力和 reasoning_options 绑定到实际 serving provider 证明，导致自动配置丢失。用户实际 Pi 注册的 16 个模型均支持推理、保存档位均为空；本变更按用户明确的产品原则纠正规范及设计，设计已通过 Review，用户于 2026-10-10 批准先实施 Core。

## What Changes

1. 只按 LiteLLM model_name 与明确 models.dev 关系匹配，官方 → OpenCode → OpenRouter 选择一条整记录；内部 route/base_model 不定义模型身份。
2. 直接读取该记录的能力、限制与 reasoning_options；不跨 provider 或 LiteLLM 补字段，不用家族/GPT模板，不要求 models_dev_provider。
3. **BREAKING**：参考价仅来自选中记录，否则0；删除价格阶梯与价格有效性门槛，contextTierCap接受但忽略并在实施时说明。
4. **BREAKING**：删除旧LKG serving/route/multiset证明，保留model_name、scope和关键缓存完整性；旧错误配置通过既有schema机制重建。协议/default/mixed-fallback/override完全保持现状。
5. 保留16模型和公开数据，修订原T01–T34，撤回T05/T06候选裁决；真实宿主E2E仍是实施验收。本轮先实施 Core；宿主适配待 Core 获授权合入。

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

设计材料的提交可同时审查。用户已批准实施；Core 经代码 Review 并获授权后先合入稳定 main SHA，再 Pi、OpenCode 各自按该 SHA 构建和验收。本轮仅构建 Core 验证包；宿主 dist/provenance、版本、历史 archive 和用户配置不改。canonical 仅修正 Purpose，Requirement 在跨仓库收尾时按 CLI 归档同步。

现行规范与用户本次原则的冲突不是实施约束；由本 change 的明确 deltas 替代。详细审计与逐模型预期以 Core change 的 audit.md、design.md、test-matrix.md 和 evidence/ 为准。Core 实施同步 README、testing-standard §8、ADR 和 OpenSpec context；模型元数据、价格及旧缓存升级均有用户文档说明。

## 设计约束

用户明确要求、已复现问题、核实数据/接口或基本正确性才可支持行为；Review不能把理论边缘情况自动变成Requirement、Scenario、状态或发布门槛。优先删除错误逻辑和复用已有机制；本次不扩大审计范围。
