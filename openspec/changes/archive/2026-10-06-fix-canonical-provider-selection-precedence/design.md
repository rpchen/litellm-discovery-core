# Design: Fix Canonical Provider Selection Precedence

## 真实证据（2026-10-06，models.dev/api.json 实测）

- `openrouter` provider：key/id `deepseek/deepseek-v4.1-flash`，`canonical_model_id: deepseek/deepseek-v4.1-flash`，`limit = { context: 1048576, output: 943718 }`（reseller serving limit）。
- `opencode` provider：key/id `deepseek-v4.1-flash`，`canonical_model_id: deepseek/deepseek-v4.1-flash`，`limit = { context: 1000000, output: 384000 }`。
- `deepseek` provider（存在）：记录 id 为 serving SKU（`deepseek-v4-flash`、`deepseek-flash`、`deepseek-v4-flash-vision-exp`），全部携带 `canonical_model_id: deepseek/deepseek-v4.1-flash` 与 `limit.output = 393216`；官方提供三种 SKU 形态（当前/deprecated/别名形态，其中两条显式 `status: deprecated`）。`base_model` 字段当前未出现在 catalog records 中，但按领域语义与 identity graph 的既有 relation 计划，仍作为同族确定性关系支持。
- 真实 catalog 统计：5312 条 records 使用 `canonical_model_id`，0 条使用 `base_model`/`inherits`。

## 来源 commit 与影响面

- 基线：Core main `6f7eb3d24eb1015132cacac0179e7ee6546cf451`（fix branch 自 `5cf51e8d` 发布依赖 SHA 起）。
- 触及：`src/core/modelsdev.ts`、`src/core/evidence.ts`、`src/core/publication.ts`、`src/core/diagnostics.ts`、`src/index.ts`；不改变 `stripRoutePrefix`、protocol、价格换算、阶梯截断、`resolveInheritedRecord` 的既有语义与 authority。
- 明确不在范围：不针对 DeepSeek/GLM/MiniMax 写特判；不新增 runtime inference probe；不改变 publication gate；不做大规模重构。

## 1. 统一 relation semantics：`relationTargets(record)`

selector 与 identity graph 各自维护了不一致的 relation 集合（identity graph 认识 `base_model`，record matching 不认识；matching 认识 key/alias，graph 中 alias 处理各自实现）。本变更把 provider-scoped record 的确定性 relation 收敛到单一 helper：

```ts
export function relationTargets(record): { canonical?: string; other: string[] }
// canonical: canonical_model_id ?? base_model（首选 canonical identity）
// other: inherits / equivalent_to / equivalents（次级 identity 关系）
```

`groupIdentityEvidence` 的 catalog relation 部分改由该 helper 驱动（保持既有 link 建图方式），`resolveInheritedRecord` 的 `inheritanceTargets` 与其保持同一个 relation 常量（`canonical_model_id` 仍优先作为继承入口，与旧序不变）。`base_model` 是否出现在 `INHERITABLE_FIELDS` 补缺入口的取舍继承旧序：不新增 base_model 作为继承入口；它的角色是 identity relation + canonical-original 证明。

`base_model` 的匹配语义：candidate `x` 匹配 record R 当 `identityNodeID(stripRoutePrefix(R.base_model)) == identityNodeID(stripRoutePrefix(x))`（provider namespace 已由 providerID 表达，value 只比 name；不使用 `canonicalNodeID` 匹配以避免与 canonical namespace 证明纠缠）。

## 2. Record matching 扩展（`findMatch` 返回 relation kind）

新增内部 `findMatchesByRelation(models, candidate)`：除 key/id/alias 直接匹配外，允许 relation 匹配（`canonical_model_id` / `base_model` → `kind: "relation"`），`SelectedModelRecord.record` 携带该 record 的 `canonical_model_id ?? base_model`。多 relation record 去重（同一 provider 同一 record 只进入一次）。`findMatch`（单结果兼容包装）保持对非 relation 调用方行为不变；selector 与 publication/inheritance 路径使用 relation-aware 匹配。仍禁止 family/substring/名称前缀猜测：relation 匹配只按 metadata 声明值比较。

候选顺序不变：base_model → routed model（去前缀）→ route name。

## 3. Selection precedence

```text
explicit models_dev_provider（group conflict → ambiguous）
> canonical/original provider record（relation 指向 canonical identity + provider id == canonical namespace）
> OpenCode
> OpenRouter
> 全局唯一剩余（unique-match）
> ambiguous
```

- canonical original 从「canonical namespace 集合大小为 1 且命中」收紧为「对候选 identity 的多 provider 命中里，同时满足确定关系与 namespace 证明的唯一记录」：namespace 证明本身已强制唯一。
- 真实 DeepSeek 形态下 official 3 条 SKU 全部 relation 匹配候选且 namespace 相同：取 `status: deprecated` 数量最少、`modelID` 最短（tie 逐级比较）、最后 `localeCompare` 破平的记录——纯 record 内在字段比较，确定性、与 catalog 迭代顺序无关；3 条结果对最终 published spec 等价（intrinsic authority 相同）。
- fallback：OpenCode > OpenRouter；都没有时 unique-match；再不行 ambiguous。
- group identity evidence 非 known → 整组 `ambiguous`（现状保留）。

## 4. Relation-aware source authority

`SelectedModelRecord` 增加 `record: { canonicalModelID?: string }`（record 声明的 relation 首选值）。authority 分级不再由 `selected !== undefined` 单一判定，而是按 selection source：

- `canonical-original`（或 explicit-provider 且其 record 自带 relation）→ models.dev 数值/布尔/模态证据继续 `authoritative-intrinsic`（高权威裁决）。
- `opencode-fallback` / `openrouter-fallback` / `unique-match` / `legacy-family-compatibility` → `assessment` 把 models.dev 数值与 boolean/modality 证据降为 `fallback-serving`（低权威 secondary，与 LiteLLM descriptive 同级），仅当无更高权威证据时补缺；与 descriptive 同级时冲突 → `unresolved-conflict`。`canonical-inheritance` 补缺字段保持既有高权威（inheritance 由 identity graph 证明）。
- `cost` fallback 排除扩展到全部 fallback selectionSource（`canUseSelectedModelsDevPrice` 只放行 explicit-provider 且带 relation 证明，或 canonical-original）；价格 LiteLLM 优先不变。

`evidence.ts` `resolveNumericField`/`resolveBooleanField`/`resolveModalityField` 增加可选 `intrinsicAuthority`（默认 `authoritative`，兼容既有调用）；publication 侧按 selection source 传入 `intrinsic !== undefined ? intrinsicAuthority : undefined`。fallback-serving 与 descriptive 同级冲突即 unresolved conflict 的裁决依赖此开关。

**关键负断言**：fallback-serving 提升为 authoritative 的情况不得出现（OpenRouter `943718` 不得再被发布为 intrinsic output）。

## 5. Canonical identity 与 metadata provider 彻底分离——关键不变量

`buildModelSpecs` 的 spec `id`/`name`（canonical identity 事实）继续来自 `group.modelName`/`candidateModelIDs`——即 deployment base_model/route 证据，与选择的 metadata provider 完全解耦。**fallback provider record 的选择不得改写 canonical identity**：即使 selected = `opencode`/`openrouter` record，spec id 仍是 `deepseek-v4.1-flash` 或 deployment 声明的 base model 名，不是 `opencode/...` 或 `openrouter/...`。测试断言 selected 变化的前后 `spec.id` 不变。

LKG：`stableIdentity`/`providerID` capture 语义不变；provider 变化（如 canonical-original ↔ fallback 之间）→ LKG identity/provider cross-check 失败 → fail closed，不得复活旧错误 metadata。LKG captured facts 校验已拒绝 `captured.output != spec.output` 的伪造——即使错误 `943718` 快照存在，只要本轮 spec 变成 `393216`，restore 直接失效（天然防复活）；负向测试固定这一点。

## 6. Diagnostics 与 host mapping

- `diagnostics` `ModelDiagnostic.modelsDev` 增加 `selectionSource?: string`；`ModelQualityDiagnostic.identity` 增加 `identityProvenance: "provider-relation" | "deployment-declaration" | "unknown"`（canonical identity 的证据来源）。
- 深链用例断言：DeepSeek canonical 为 `deepseek/deepseek-v4.1-flash`（provider-relation），metadata provider `deepseek`，selectionSource `canonical-original`；fallback 场景 canonical 仍为 deployment 声明的 identity，selectionSource 为 `opencode-fallback`，证明 fallback 未污染 canonical identity。
- 不新增面向普通用户的提示文案；观察性字段供排障与 governance 测试使用。
- Pi `toProviderModels`/OpenCode `toOpenCodeModelSpec` 无需源码变化：spec.limit 语义不变，仅值随 selector 修正。

## 7. 兼容性与风险

- `selectModelsDevRecordDetailed` 既有公开形状不变；`selectionSource` 取值集不变（新增语义不改 union 类型）；`legacy-family-compatibility` 继续完全隔离。
- legacy OpenRouter-first 测试与 OpenSpec scenarios 同步更新到新 precedence（OpenCode first）。
- 旧 LKG（`openrouter-providerID + 943718` 捕获）在真实场景下的复活路径被 identity/provider/facts 三重校验封死。
- `evidence.resolvedNumeric` 的 fallback-serving 冲突 = unresolved conflict：与「canonical identity 可靠后 LiteLLM descriptive 一般为 resolved discrepancy」的既有规则并存——后者成立前提是 authoritative intrinsic 存在；fallback 场景没有 intrinsic authority，同级裁决维持保守冲突语义，不放宽 gate。