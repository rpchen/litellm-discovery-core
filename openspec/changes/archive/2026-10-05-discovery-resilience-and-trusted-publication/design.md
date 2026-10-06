# Design: discovery resilience and trusted publication

## 背景事实（真实 endpoint 审计）

对真实 LiteLLM `/v1/model/info` 的审计（脱敏后记录）显示：

- 发布相关字段（`max_input_tokens` / `max_output_tokens` / `max_tokens` / `supports_*`）**只出现在 `model_info`**；
- `litellm_params` 只包含 `api_base` / `model` / 若干开关，没有声明任何 limit 或能力。

三个真实回归（`deepseek-v4.1-flash`、`glm-5.3-flash`、`minimax-m3`）全部属于「LiteLLM 描述性 metadata 与 models.dev intrinsic metadata 不一致」。因此本设计必须回答：**什么证据才有资格决定一个字段**。

## D1. 两个正交维度：intrinsic 事实 vs 部署约束

| 维度 | 语义 | 高权威来源 | LiteLLM 角色 |
|---|---|---|---|
| 模型内禀事实 | 模型本身能做什么（context/output、modalities、vision/audio/video/pdf、tools、reasoning） | canonical identity 可靠解析后的 models.dev 记录 | `model_info` 是 secondary descriptive evidence；`litellm_params` 中可证明 enforce 的键是部署约束 |
| 部署运行约束 | endpoint 实际 enforce 的上限 | 运维者自己的部署配置 `litellm_params` | 只能**收窄** effective 值 |

`RUNTIME_CONSTRAINT_KEYS` 明确列出可证明 enforce 的键：`max_input_tokens`（input/context 维度收窄）、`max_tokens` / `max_output_tokens` / `max_completion_tokens`（output 维度）、以及模态 `supports_*` 的显式 `false`（只能移除，不能添加）。字段名相同但位于 `model_info` 时**不是** hard cap。

`context` 与 `input` 保持两个独立维度：models.dev `limit.context` 是总窗口，`max_input_tokens` 是输入容量；约束只收窄同维度，任何检查都不得跨维度比较（沿用既有不变量）。

## D2. authority 生效的前置门禁：canonical identity

`selectModelsDevRecordDetailed` 只在 identity 证据充分（每个 deployment 都有正面 identity 证据且能 reconcile 成一comComponent）时才返回 `selected`。因此实现用「`selected` 是否存在」作为 models.dev authority 的开关：

- identity 为 `ambiguous` / identity 不完整 → `selected === undefined` → models.dev 不下发权威，字段回落到 LiteLLM 证据与既有 tri-state 语义；
- 不做 family-name / 模型名前缀推断（`legacyFamilyCompatibilityProvider` 仍与 publication 隔离，本轮只补测试锁死）。

## D3. resolved discrepancy vs unresolved conflict

```
evidence collection
  → canonical identity resolution
  → field semantics（numeric / boolean / modality set）
  → source authority
  → selected | resolved-discrepancy | unresolved-conflict | unknown | missing | illegal
```

- **resolved discrepancy**：存在更高权威证据（authoritative intrinsic）→ 采用它，其余同级/低权威差异作为 evidence 保留在 `FieldResolution.evidence`，模型继续 publication assessment。requirement 明确要求 `discrepancy ≠ conflict`、`resolved discrepancy ≠ incomplete`、`resolved discrepancy ≠ invalid-metadata`。
- **unresolved conflict**：同一 authority 等级的证据互相矛盾且无权威可裁决 → withheld，并给出 `authoritative-conflict` 原因。
- 判定顺序（`resolveNumericField`）：illegal 声明 → 跨 deployment 同级不一致（conflict）→ 无权威时 partial（unknown）→ 无权威时 missing → authority 决策 → 部署约束收窄。
- **跨 deployment 显式不一致始终保持 unresolved conflict**，即使存在 authoritative intrinsic：同一宿主模型的不同 route 可能承载不同能力，模型级记录无法证明宿主的请求会落到哪条 route。这条规则同时保护 testing-standard 第 8 节的「group-wide trustworthy evidence」不变量。

## D4. 删除 model-level degraded publication

删除内容：`ModelConfigurationStatus."degraded"`、`DegradationAcceptance`、`DegradedConfiguration`、`degradationEligibility`、`isDegradationEligible`、`acceptDegradedConfiguration`、`isPublishableWithDegradedAcceptance`、`PublishableEntry.degraded`、`BuildPublicationOptions.acceptedDegradedIDs/degradationReason`。

理由：产品原则冻结为「单模型 publication gate 绝不降低：不完整 → withheld，不存在不完整 → 用户确认 → 强行 publish」。Core 因此不再持有任何用户确认状态，`publishable(model)` 只依赖证据。

## D5. LKG 设计

- **准入**：只有当前 policy 下完整通过 gate 的 ModelSpec 才可捕获（`createLastKnownGoodEntry` 复用 `validateCapturedPublication`，并且要求 group 有可证明 identity）；允许成为 LKG 的状态只有 `configured`。
- **使用**：live assessment 为 `discovered-incomplete` / `metadata-unavailable`，且 identity、provider、schema、canonical mapping 与 live 事实一致时，替换为 `configured-lkg`。
- **失效**：schema version 不兼容、model identity / stable identity / canonical identity 变化、provider 冲突、live illegal limit、**authoritative intrinsic 事实与快照冲突**、**proven runtime constraint 与快照不一致**。
- **不因低权威差异失效**：`model_info` 描述性 limit / 模态 / 能力与快照不同，仅是 resolved discrepancy（`liveCapabilityConflict` 只看 models.dev 事实与 `litellm_params` 约束）。
- **不设固定 TTL**：年龄只作为 diagnostics 信息（`LKGValidation.ageMs`），不是有效性条件。
- **不复活已删除模型**：LKG 只在 `buildPublicationResult` 的 group 循环内使用；LiteLLM 当前模型目录决定存在性，snapshot 里已移除的模型不会出现在结果中。
- **schema compatibility**：`PUBLICATION_SCHEMA_VERSION` 4 → 5；旧版本条目 `isLKGEntryCompatible` 直接拒绝，安全失败为 withheld。

## D6. catalog 事实与 acknowledgement

- `buildCatalogPublication` 从 publication partition 派生：`discovered`、`publishable`、`lkgBacked`、`withheld`（含 reasons / fingerprint / previouslyPublished / retryability）、`partial`、`unusable`、`regressions`、`newlyWithheld`、整体 `fingerprint`。
- per-model fingerprint 只由 status + reason code + fields 组成，刻意排除时间戳、retry counter 与错误文本细节；整体 fingerprint 与顺序无关。
- `decideAcknowledgement` 只回答「是否再次打扰」：
  - 完全恢复 → 清除 acknowledgement；
  - 严格子集（部分恢复）→ 静默、更新基线；
  - previously published 模型变 withheld → 必提醒（regression）；
  - `discovered > 0 && publishable = 0` → 必提醒（catalog-unusable）；
  - 首次 withheld 的新模型 → 默认非打断（diagnostics 可见）；
  - 已有 acknowledgement 之外的**新**问题或同一模型 reason 实质变化 → 必提醒。
- acknowledgement 状态是纯数据，**从不进入 `publishable(model)`**；Core 不提供 slash command 或 RPC action，交互由适配层按自身宿主能力决定（本轮适配层只实现 notification suppression，不新增命令）。

## D7. Diagnostics

`ModelDiagnostic.publication` 新增 `discrepancies` / `conflicts` / `deploymentConstraints` / `usingLKG` / `lkgDetail`，并在 `issues` 中分别以 `metadata-discrepancy`（info）与 `publication-conflict`（warning）呈现。用户因此能读到「selected value / selected source / resolution rule / evidence」，而不是只看到 blocked。

## 不在本变更范围

- reasoning capability domain 重构（`supported / control: fixed|effort|budget|unknown`）留待后续独立 change；本变更只保证 reasoning 字段在 authority 修复后不回归。
- 完整 identity resolver 重构：仅在必要处补测试锁死既有可信阶梯。
