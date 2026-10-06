# Fix Canonical Provider Selection Precedence

## Why

真实 endpoint 回归：Pi 用户选择 `deepseek-v4.1-flash` 正常会话时被 LiteLLM 拒绝——`max_tokens (943718) exceeds model's maximum output tokens (393216) for model deepseek-v4.1-flash`。发布给 Pi host 的 `maxTokens=943718` 来自 models.dev OpenRouter record 的 serving limit，而不是 DeepSeek 官方原厂的 `393216`。

根因在 Core 的 provider selection，而不在 Pi 的映射层（`mapCapabilities`/`toProviderModels` 忠实地发布 `spec.limit.output`）：

1. **canonical-original 的证明不可达**。DeepSeek 官方 provider 在 models.dev 上的记录 id 是 serving SKU 形式（`deepseek-v4-flash`、`deepseek-flash`、`deepseek-v4-flash-vision-exp`），通过 `canonical_model_id: deepseek/deepseek-v4.1-flash` 的一致性关系指向当前 canonical model；记录 key/alias/id 均不是 `deepseek-v4.1-flash`。当前 `findMatch` 只按 key/id/aliases 匹配候选名，这些原厂记录根本不会进入 `matches`，`canonical-original` 永远无法命中。`base_model` 在真实 catalog 中尚未出现，但它是同族 provider-scoped model → canonical model 的确定性关系，同样必须被 identity graph 认识。
2. **fallback precedence 把 OpenRouter 排在 OpenCode 前**。canonical-original 落空后 selector 直接选择 OpenRouter（转售商 serving 元数据），而不是更中立的 OpenCode。
3. **source authority 与 selection source 耦合错误**。任何被选中的 record 一律成为 `authoritative-intrinsic`：转售商 serving metadata（OpenRouter 实际只开到 943718）被当成模型内禀 output 上限发布。这直接违反既定原则——canonical/original evidence 与 fallback provider serving metadata 必须可区分。

同时，两条独立的产品语义必须显式分开，防止继续混在 selector 中：

- **Canonical Model Identity**：deployment/group 对应的 canonical model 是谁（`deepseek/deepseek-v4.1-flash`）——由 `groupIdentityEvidence` 与 deterministic relation 决定；
- **Metadata Provider Selection**：用哪个 models.dev provider-scoped record 作为 enrichment 数据源——按确定性 precedence 选择。

## What Changes

- 修通 canonical-original 证明：`findMatch` 扩展为「直接匹配 + relation 匹配」，models.dev 的 provider-scoped record 可按 `canonical_model_id` 等确定性 relation 匹配候选名；identity graph 已认识的 relation（`canonical_model_id`、`base_model`、`inherits`、`equivalent_to`/`equivalents`、alias）与 record matching 使用同一套统一 relation semantics，不再各自维护。
- Provider selection precedence 正式改为：explicit provider proof > canonical-original > **OpenCode > OpenRouter** > unique trusted match > ambiguous（旧顺序 OpenRouter > OpenCode 废弃）。
- **canonical-original 判定收紧**：原厂必须同时满足「确定性关系指向 canonical model + provider namespace == canonical namespace」；reseller（`openrouter`、`opencode` 等）指向 canonical model 的关系只证明其服务的 canonical model，不证明它是原厂。
- **authority 不随 selection source 而改变，随 relation 而区分**：canonical-original record 保持 `authoritative-intrinsic`；fallback record（OpenCode/OpenRouter/unique/legacy）的 provider-scoped `limit`/`modalities`/`tool_call`/`reasoning` 降为 `fallback-serving`（低权威 secondary），仅当无更高权威证据时补缺，与 LiteLLM descriptive 同级裁决 conflict；其 `cost` 继续被排除（价格 fallback 边界不变，且扩展到全部 fallback source）；`canonical-inheritance` 补缺字段保持既有 authority。LKG live conflict 判定同步只接受 authoritative intrinsic 与 proven runtime constraint。
- Diagnostics 显式区分 canonical identity、metadata provider、selection source（`models-dev` 增加 `selectionSource`，publication 增加 identity 的 provenance），不新增面向用户的提示噪音。
- 明确 frozen 不变量：canonical identity 与 metadata provider selection 是不同概念；fallback 不改写 canonical identity；ambiguous 不得 first wins；catalog 顺序不得影响结果；runtime discovery 禁止未明确触发的 inference probe；provider selection 必须有 deterministic fixture 覆盖。
- DeepSeek 固定 regression fixture（canonical identity = `deepseek/deepseek-v4.1-flash`，selected = `deepseek`，selectionSource = `canonical-original`，`limit.output = 393216`，强负断言 `!= openrouter` 且 `!= 943718`）加通用 precedence matrix、relation semantics、重点模型（`glm-5.3-flash`、`minimax-m3`）与 LKG 防复活负向测试。不做任何模型名特判。

## Impact

- Affected specs: `discovery-quality`（MODIFIED）、`publication`（MODIFIED）、`discovery-diagnostics`（MODIFIED）
- Affected code: `src/core/modelsdev.ts`（selector + relation matching）、`src/core/evidence.ts`（authority 判定接收 selection 语义）、`src/core/publication.ts`、`src/core/diagnostics.ts`、`src/index.ts`
- 下游影响：Pi 与 OpenCode 无需业务源码修改，通过 `build:dist` 拉取新 Core SHA 更新 `dist/`，并各自补「Core publication → 宿主最终 config」的 DeepSeek integration regression（Pi `maxTokens=393216`）；对应 integration change 分别在两个 adapter 仓库立案并引用本 change。