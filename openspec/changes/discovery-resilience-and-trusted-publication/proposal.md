# Discovery Resilience and Trusted Publication

## Why

插件最核心的产品价值是「准确配置模型能力，确保宿主只使用可信、可正确调用的模型配置」。当前 Core 在真实 endpoint 上暴露出两类问题：

1. **证据权威被机械化**：只要 LiteLLM `/v1/model/info` 的 `model_info` 与 models.dev 对同一字段不一致，Core 就判为 conflict → `invalid-metadata` / `discovered-incomplete` → 模型无法发布。真实观测（`deepseek-v4.1-flash`、`glm-5.3-flash`、`minimax-m3`）显示：分歧字段只存在于 `model_info`（LiteLLM 模型注册表的描述性元数据），而 `litellm_params`（运维者自己的部署配置）没有声明任何 limit。也就是说，一个低权威描述性数字可以否决高权威模型内禀事实。
2. **存在绕过 publication gate 的用户确认路径**：`degraded` 状态 + `/litellm-accept-degraded`（Pi）/ `litellm-publication.accept`（OpenCode）允许用户把不满足可信标准的模型强行发布；本轮还必须把「endpoint 暂时不可用」与「模型不可信」区分开，并让一个模型的失败不再拖垮其他模型。

同时，metadata source 暂时不可访问时，当前实现只能依赖 LKG，且 LKG 的失效判定把低权威描述性差异也当作冲突，导致可用模型在刷新时被无谓撤下。

## What Changes

- 新增 **evidence provenance 与 source authority** 业务语义：区分模型内禀事实（models.dev 高权威，前提是 canonical identity 可靠解析）与 endpoint 部署约束（只有 `litellm_params` 中运维者声明、endpoint 实际 enforce 的键才可收窄 effective 值），描述性 `model_info` 只能作为 secondary evidence。
- 新增 **resolved discrepancy / unresolved conflict** 两个正式概念：可裁决的差异记录并保留，模型继续 publication assessment；只有真正无法按 authority 裁决的冲突才 withheld。
- **删除 model-level degraded publication**：`degraded` 状态、`acceptDegradedConfiguration`、`degradationEligibility`、`isPublishableWithDegradedAcceptance`、`acceptedDegradedIDs` 全部移除。`publishable(model)` 不再依赖任何用户确认状态。
- 新增 **partial catalog / regression / recovery / acknowledgement** 领域事实（`src/core/catalog.ts`）：`discovered / publishable / withheld / partial / unusable / regressions / newlyWithheld`、degradation fingerprint 与 acknowledgement 决策。
- **LKG 加固**：schema version 提升；live 冲突判定仅接受 authoritative intrinsic 事实与 proven runtime constraint；低权威描述性差异不再使 LKG 失效；runtime constraint 与快照不一致时 fail closed。
- **diagnostics 暴露证据链**：每个 gated 字段的 resolution（status / selected value / selected source / evidence / resolution rule）、provenance、deployment constraint。
- capabilities/spec 生成改为 authority-aware，使 published ModelSpec 与 assessment 使用同一套 effective 值。

## Impact

- Affected specs: `discovery-resilience`（新增）、`publication`（MODIFIED）
- Affected code: `src/core/evidence.ts`（新）、`src/core/catalog.ts`（新）、`src/core/publication.ts`、`src/core/capabilities.ts`、`src/core/diagnostics.ts`、`src/index.ts`
- 下游影响：Pi 与 OpenCode 必须删除 accept-degraded 并消费新的 catalog/withheld 事实（各自独立 change）
