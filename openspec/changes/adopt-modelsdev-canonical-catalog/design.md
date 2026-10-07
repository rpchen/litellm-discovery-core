# Design: Adopt the models.dev Canonical Catalog

> 状态：DESIGN（第二轮修订，冻结待评审，未实施）。本设计取代 `capability-first provider fallback`、rule B（PR #30）与 `canonical-original`-as-authority 的组合模型。审计证据见 `audit.md`，验收矩阵见 `acceptance.md`。
>
> **Revision 2（第三方评审后）**：① 取消未证明 reseller 同名记录的一切发布供给资格；② 新增字段级 resolution matrix（D6）；③ 关闭 Q1：serving 未证明时不发布 lab 档位，只有 `litellm_params` 中运维者显式配置可作为 endpoint control 证据；④ LKG v8 从单一 authority 改为 proof composition；⑤ wire-id 解析与 identity/serving 证据正式分离（D3）；⑥ catalog 等价措辞更正；⑦ 新增 pinned effort 发现（audit P1-7）。

## Context

- 来源：Core `main@61f48948`；Pi `main@2f821818`（provenance `f07951d7`）；OpenCode `main@6c7818a0`。
- models.dev：repo `sst/models.dev@450aa1d5`；`README.md`、`AGENTS.md`、`packages/core/src/{schema,generate}.ts`、`packages/sdk/README.md`、`packages/function/src/worker.ts`；live `api.json`/`models.json`/`catalog.json`（2026-10-07 13:11 UTC）。
- 边界不变：Core 纯函数、无 I/O、无宿主 SDK；adapter 只 fetch/cache/映射/展示，不复制 identity/authority/merge。
- 本 change 只做审计与设计冻结；插件迁移是后续独立 change（见「Downstream impact」）。

## Goals / Non-Goals

**Goals**
1. 一次性对齐 models.dev 的真实三层数据模型。
2. 让「可靠 models.dev 数据存在」的模型确定性地发布正确的内禀事实。
3. 杜绝任何未证明的 provider 记录（reseller、free/fast/thinking 变体、serving SKU、同名记录）进入发布配置。
4. 一个 resolver、一份结果，消灭 gate/spec/diagnostics/LKG 之间的漂移。

**Non-Goals**
- 不实现 serving-provider 自动推断（api_base 主机名、credential 名、LiteLLM adapter 映射表、默认 adapter 推断）。
- 不消费 models.dev `provider.{npm,api,shape,body,headers}`、`interleaved`、`experimental.modes`、`structured_output`、`temperature`。
- 不改变 protocol 判定、多 endpoint 隔离、refresh coordinator、publication memory/acknowledgement 语义。
- 不处理宿主 contextWindow 与 input capacity 的映射策略（adapter 后续 change，见 Risks）。

## Decisions

### D1 事实分类（Fact classes）

| 类 | 唯一来源 | 用途 |
|---|---|---|
| **Canonical Model Identity** | `catalog.models` 的 key（`<lab>/<model>`） | 内禀事实索引、LKG 身份 |
| **Intrinsic Model Facts** | `catalog.models[id]` | 默认 capability 值 |
| **Serving Provider Facts** | 已证明 serving provider P 的 `catalog.providers[P].models[r]` | serving override 与 serving-only 字段 |
| **Deployment Runtime Constraints** | `litellm_params` 中运维者配置的可强制键 | 只收窄同维度；pinned effort 固定档位 |
| **LiteLLM Descriptive** | `model_info.*` | secondary evidence |
| **Wire-ID parse metadata** | route adapter 段、`custom_llm_provider` | **只**用于解析 wire id 与诊断，永不作为证据 |

**Canonical identity known ≠ serving provider known。** first-party lab 记录、namespace 相等、`canonical-original` 都**不**证明 serving。未证明的 provider 记录（含同名精确匹配）**只进 diagnostics**。

### D2 Catalog 输入契约

- `normalizeModelsDevCatalog(input)` → `{ kind: "complete", models, providers } | { kind: "providers-only", providers } | { kind: "unavailable" }`。
  - `complete`：顶层恰有 `providers`、`models` 两个对象，`models` 的 key 为 `<lab>/<model>`。
  - `providers-only`：遗留 `api.json` 形状。
  - `unavailable`：空、非对象、或只有其一。
- `providers-only` 与 `unavailable` 同等对待：不做 canonical 解析，不选任何 provider 记录；LiteLLM 声明完整的模型按 LiteLLM-only 路径发布，其余 `metadata-unavailable`（LKG 可恢复）。
- 所有公共入口接受 `unknown` 并内部归一化，签名不变。

### D3 Wire-ID 解析与 canonical identity

**D3.1 Wire-ID 解析（无证明力）。** 对每个 deployment 候选值 v（顺序：`model_info.base_model`，然后 `litellm_params.model`），解析出查找键（大小写不敏感，不折叠 `.`/`_`/语义后缀）：
- `full` = v；
- `afterAdapter` = 去掉第一个 `/` 段后的余串（仅当 v 含 `/`）；
- `tail` = 最后一个 `/` 段。

adapter 段与 `custom_llm_provider` 记录为 parse metadata（进入诊断），**永不**证明 lab namespace、canonical identity 或 serving provider。是否「是 adapter」不需要判定：解析只产出查找键，证明完全由 registry 精确命中给出。

**D3.2 Canonical proof（只来自 registry）。** 每个候选值依次：
1. `full` 精确等于 registry key → proven（`qualified-deployment`）；
2. `afterAdapter` 精确等于 registry key → proven（`qualified-deployment`）；
3. `tail` 在 registry 裸 ID 索引中：0 → 下一候选值；1 → proven（`registry-unique`）；>1 → **ambiguous，停止**。

例：`openai/mimo-v2.6-pro` → tail 唯一命中 `xiaomi/mimo-v2.6-pro`（`openai` 只是 parse metadata）；`openrouter/xiaomi/mimo-v2.6-pro` → afterAdapter 命中 `xiaomi/mimo-v2.6-pro`（OpenRouter **不**因此成为 serving provider）；`minimax/MiniMax-M3` → full 命中（`minimax` 同样不证明 serving）。

`base_model` 证明成功即决定该 deployment；路由解析不同只记 `identity-route-differs` 诊断（live `kimi-k2.7-code → minimax/MiniMax-M2.7`）。

**D3.3 serving relation 证据**（D4 证明 serving 之后）：选中 serving 记录的 `canonical_model_id` = C'。
- deployment 未证明 canonical 且 C' 是 registry key → canonical = C'（`serving-relation`）。
- deployment canonical C ≠ C'：C/C' 内禀 publication-critical facts（limit、modalities、tool_call、reasoning）实质等价 → 保持 C 并记 `identity-discrepancy`；否则 ambiguous（withheld，`identity-ambiguous`）。
- inline first-party 记录（无 `canonical_model_id`）仅在 `provider == lab(C)` 且 `record id == tail(C)` 时视为与 C 一致，否则不提供 identity 证据。

**D3.4 组级**：沿用 `groupIdentityEvidence` 前置门禁；所有 deployment canonical 必须相同；不同 → conflict；部分 proven、部分 unproven → ambiguous。registry 无条目时，不同 adapter 段的同名路由（`openai/foo` vs `anthropic/foo`）保持 distinct → ambiguous，除非 `models_dev_provider` 证明。

**禁止**：`model_name`、family/前缀/子串/邻近型号、反向 relation fan-out、`model_info.key`、`litellm_provider`、`custom_llm_provider`、`api_base`、credential 名、「默认 adapter + 无自定义 api_base ⇒ serving」推断。

### D4 Serving provider resolution

- **proven** 当且仅当组内所有 deployment 声明同一 `models_dev_provider = P`，且 `catalog.providers[P]` 存在。
- 记录选择（只在 P 内）：① key/id 精确等于 D3.1 的 `full` → `afterAdapter` → `tail`；② 否则 P 内 `canonical_model_id == C` 的唯一记录，或多条且 serving publication-critical facts（limit、modalities、tool_call、reasoning、reasoning_options、cost）实质等价；③ 多条实质不同 → `serving-ambiguous`（withheld）；④ 0 条 → `declared-unmatched`（serving facts 未知，按 serving 未证明发布 + warning）。
- 多 deployment 选出的 serving 记录 publication-critical facts 必须一致，否则 conflict。
- **unproven**：无声明。此时任何 provider 记录都不提供事实。删除 rule B。

### D5 未证明记录（取代旧 fallback）

> canonical model 是否存在都一样：**未证明的 provider 记录（OpenCode、OpenRouter、unique、first-party、同名精确匹配）永远没有资格提供任何发布事实**，包括 limit、modalities、tools、reasoning、reasoning levels、price、release metadata。

registry 无条目时：

```text
canonical registry absent
  ├─ serving provider proven + serving record selected  → 使用该 serving 记录（D6 serving 列）
  ├─ LiteLLM 自身声明完整（limits、tools、reasoning、modalities 皆 known）→ LiteLLM-only / private 路径
  └─ otherwise → withheld（incomplete-metadata / identity-unmatched）
```

精确同名的 reseller 记录只作为**诊断候选**列出（顺序 OpenCode → OpenRouter → 其余，仅用于展示「若声明 `models_dev_provider` 可用哪条记录」），不进入 resolution、ModelSpec、gate 或 LKG。旧 `fallback-serving` origin 与 `fallback` serving status 删除。

### D6 字段级 resolution matrix（冻结）

**通用顺序**（每字段、每 deployment 组）：

```text
base = (serving proven ∧ serving 记录有该字段) ? serving
     : (canonical proven ∧ registry 有该字段) ? canonical
     : LiteLLM descriptive aggregate（跨 deployment 全部声明且一致）
     : unknown
effective = narrow(base, litellm_params constraint 同维度)      // 只收窄，永不提升
discrepancy: descriptive ≠ base（base ∈ {serving, canonical}）→ resolved discrepancy
conflict:    跨 deployment descriptive/constraint 显式不一致 → unresolved conflict
```

- serving 已证明但 serving 记录缺字段 → 回落 canonical（models.dev 生成期已对 `base_model` 记录合并；`base_model_omit` 的删除意图在 JSON 中不可区分，按缺失处理）。
- base 来自 LiteLLM descriptive 时该字段 provenance 为 `litellm-declared`；部分 deployment 未声明 → unknown（不得过滤缺失）。
- 未证明 provider 记录在任何格子里都不出现。

**逐字段**：

| 字段 | serving proven + 有值 | canonical 有值 | canonical 缺 / 未证明，LiteLLM descriptive 有 | 都没有 | runtime constraint | descriptive ≠ base | gate |
|---|---|---|---|---|---|---|---|
| `limit.context` | serving `limit.context` | registry `limit.context` | LiteLLM-only 时以 `max_input_tokens` 作 context（唯一文档化跨维度例外，仅当无任何 models.dev 值） | unknown → missing | 无（`max_input_tokens` 不收窄 context） | — | gated |
| `limit.input` | serving `limit.input` | registry `limit.input` | `max_input_tokens` | = effective context（provenance `derived`） | `litellm_params.max_input_tokens` 收窄；恒 ≤ context | `max_input_tokens` ≠ input base → discrepancy（只比 input） | 非 gated |
| `limit.output` | serving `limit.output` | registry `limit.output`（registry 9/445 缺） | `max_output_tokens` ?? `max_tokens` | unknown → missing | `litellm_params.max_tokens` / `max_output_tokens` / `max_completion_tokens` | discrepancy | gated |
| tools | serving `tool_call` | registry `tool_call` | `supports_function_calling` tri-state | unknown | `litellm_params.supports_function_calling=false` 收窄 | discrepancy | gated |
| reasoning support | serving `reasoning` | registry `reasoning` | `supports_reasoning` tri-state | unknown | `litellm_params.supports_reasoning=false` 收窄 | discrepancy | gated |
| input modalities | serving `modalities.input` | registry `modalities.input` | 每个维度 flag 全部显式声明才 known（sparse 规则） | unknown | `litellm_params` 维度 flag `false` 移除 | flag 与列表矛盾 → discrepancy | gated |
| output modalities | serving `modalities.output` | registry `modalities.output` | 同上（`supports_audio_output`） | unknown | 同上 | 同上 | gated |
| reasoning levels | serving `reasoning_options`（known，可为空） | —（registry 无此字段） | —（`model_info.supports_*_reasoning_effort` 只诊断） | levels unknown | `litellm_params.reasoning_effort = X` → **pinned**：known 空档位 + `fixedEffort = X`（优先于 serving 档位） | — | 非 gated |
| price（逐组件） | serving `cost`（仅当 LiteLLM 未声明该组件） | —（registry 无价格） | LiteLLM 显式价格**始终最高优先**（`litellm_params` 先于 `model_info`，多 deployment 取最高） | unknown（0） | — | — | 非 gated |
| release date | canonical 有则用 canonical；canonical 缺且 serving proven 时用 serving | registry `release_date` | — | unknown（`releaseUnit: none`） | — | — | 非 gated |

**modalities 语义**（按 models.dev schema）：`modalities.input/output` 是必填完整集合——列出即 supported、未列出即 unsupported；整个 `modalities` 对象缺失（schema 允许、当前 0/445）→ unknown，绝不当作 text-only。

**reasoning levels 状态**：`unknown`（serving 未证明且无 pin）≠ `known-empty`（serving 记录 `[]`、仅 `toggle`、或 pinned）。reasoning unsupported 时 levels 为 known-empty。

### D7 Reasoning controls（Q1 已关闭）

- canonical `reasoning = true` 只证明模型支持推理，不证明当前 endpoint 接受哪些档位。
- 档位证据只有两种：① 已证明 serving 记录的 `reasoning_options`；② 运维者在 `litellm_params` 中的显式配置。② 当前只认 `litellm_params.reasoning_effort`（固定档位：发布 0 个可选档位并在 resolved model / diagnostics 记录 `fixedEffort`）。
- 非证据：`model_info.supports_{none,minimal,low,medium,high,xhigh,max}_reasoning_effort`、`model_info.supported_openai_params`（LiteLLM cost-map 推导值）；`litellm_params.allowed_openai_params` 含 `reasoning_effort`（只证明参数会被转发，不证明合法值集合）。三者只进诊断。
- serving 未证明且无 pin：`reasoningSupported` 照常；levels unknown；variants `[]`；诊断说明原因及恢复方式（声明 `models_dev_provider`）。

### D8 Price

逐组件（input/output/cacheRead/cacheWrite）：LiteLLM 显式价格（`litellm_params` 优先于 `model_info`，多 deployment 取最高）→ 已证明 serving 记录 `cost` → unknown。registry 无价格；未证明 provider 记录永不提供价格。（行为变化：explicit-provider 无 relation 的记录现在可提供价格，因为运维者声明即 serving 证明。）

### D9 Single resolver

```ts
resolveModel(group, catalog: NormalizedCatalog, options): ResolvedModel
interface ResolvedModel {
  group; protocol; catalogKind
  identity: { status: "proven"|"unproven"|"ambiguous"|"conflict"; canonicalModelID?; evidence: "qualified-deployment"|"registry-unique"|"serving-relation"|"none"; matchedCandidate?; parse: { adapterSegment?; customLLMProvider? }; discrepancy?; reason? }
  serving: { status: "declared"|"declared-unmatched"|"serving-ambiguous"|"unproven"; providerID?; recordID?; reason? }
  fields: Record<FieldName, FieldResolution & { basis: FieldBasis }>   // FieldBasis = "serving"|"canonical"|"litellm-declared"|"derived"|"constraint-narrowed"|"unknown"
  reasoningLevels: { state: "unknown"|"known"; values; fixedEffort? }
  diagnosticCandidates: Array<{ providerID; recordID; why }>             // 未证明记录，只诊断
  status; publishable; reasons; discrepancies; conflicts
  proof: LKGProof                                                       // D10，capture 直接持久化
}
toModelSpec(resolved): ModelSpec          // 唯一 ModelSpec 构造器
```

不变量：`buildModelSpecs = groups.map(resolveModel).map(toModelSpec)`；assessment、partition、diagnostics、LKG capture/validation 全部消费同一 `ResolvedModel`；publishable `spec` 恒等于 `toModelSpec(resolved)`；captured verdict 与 proof 由同一 resolved 派生。删除 `mapCapabilities` 独立解析与 `resolveInheritedRecord` 字段继承。`assessModelConfiguration` 形状兼容（新增 `identity.canonicalModelID`、`serving`；旧 `identity.selected` 只表示「已证明 serving 记录」）。

### D10 LKG schema 8：proof composition

```ts
interface LastKnownGoodEntryV8 {
  schemaVersion: 8; modelName; stableIdentity
  proof: {
    canonical?: { modelID; evidence: "qualified-deployment"|"registry-unique"|"serving-relation"; deploymentInput: string; registryDigest: string }
    serving?: { providerID; recordID; declaration: string; recordDigest: string }
    fields: Record<FieldName, FieldBasis>          // 每字段决策依据
    constraintFingerprint: string                  // 全部 deployment 的 litellm_params 约束键稳定序列化摘要
    litellmFingerprint?: string                    // 仅当任一字段 basis = litellm-declared：相关 model_info 键的摘要
  }
  fetchedAt; fetchedAtEpochMs; spec; captured; provenanceDetail
}
```

- `deploymentInput`：产生 canonical 证明的 deployment 侧输入（规范化候选值）；`registryDigest`/`recordDigest`：被使用事实的稳定摘要（limit、modalities、tool_call、reasoning；serving 另含 reasoning_options、cost）。
- **整体判定，绝不按字段拼接**：恢复要么发布整份 `spec`，要么 fail closed。
- outage（catalog `unavailable`/`providers-only`）可恢复条件：stableIdentity 不变；`deploymentInput` 不变；serving 声明不变（若有）；`constraintFingerprint` 不变；`litellmFingerprint` 不变（若有）；captured == spec。
- live catalog 可用（LKG 仍只在 live `discovered-incomplete`/`metadata-unavailable` 时被咨询）：额外要求 live canonical id 相同、`registryDigest` 相同、serving 记录 `recordDigest` 相同（若有）；未被 proof 引用的 provider 记录变化不使 entry 失效。
- 由于未证明记录不再产生发布事实，v8 不存在不可恢复的「fallback」authority；全部 basis 均可恢复，可恢复性由 proof 各组成部分逐项重证明决定。
- v≤7、缺 proof 字段、未知 basis：fail closed，不迁移。

### D11 Data fetching

- adapter 默认 URL：`https://models.dev/catalog.json`；单请求，`providers` 与 `models` 同 snapshot、同 TTL epoch、同 failure domain；5.74 MB（`api.json` 5.33 MB，+7.7%）；现有 60 s 超时、6 h TTL、60 s retry 保持。
- adapter 只 fetch/cache 原始 JSON；形状、identity、authority、merge 全在 Core；不并行拼接 `models.json` + `api.json`。
- OpenCode `modelsDevUrl`：指向 catalog 形状镜像；provider-only 镜像按 D2 处理（Q2）。

## MiniMax-M3 决策表（冻结，按 D6 对齐）

输入：canonical `minimax/MiniMax-M3` = context 1048576 / output 512000（无 `limit.input`）、modalities `text,image,video`；first-party `minimax/MiniMax-M3` = 1000000 / 512000、`reasoning_options [toggle]`、cost 0.3/1.2/0.06；third-party `opencode/minimax-m3` = 512000 / 128000、`reasoning_options []`、`canonical_model_id minimax/MiniMax-M3`；LiteLLM `max_input_tokens` 1000000、`max_output_tokens` 131072、`input_cost_per_token` 3e-7；`base_model = minimax-m3`。

| 情形 | canonical identity | 字段 basis | effective context / input / output | discrepancy / conflict | levels | price | publishability / LKG proof |
|---|---|---|---|---|---|---|---|
| **A** serving 未证明 | `minimax/MiniMax-M3`（registry-unique，经 base_model tail） | context/output/tools/reasoning/modalities = canonical；input = derived | 1048576 / 1048576 / 512000 | input 1000000 vs 1048576、output 131072 vs 512000 → resolved discrepancy | unknown | LiteLLM（input/output）；其余组件 unknown | configured；proof = canonical + constraint/litellm 指纹 |
| **B** `models_dev_provider: minimax` | 同上；inline first-party 与 C 一致 | context/output = serving；其余 serving 同值 | 1000000 / 1000000 / 512000 | input 一致；output 131072 vs 512000 → discrepancy | known-empty（toggle） | LiteLLM 组件优先，cacheRead = MiniMax 0.06 | configured；proof = canonical + serving(minimax) |
| **C** `models_dev_provider: opencode` | 同上；relation 一致 | context/output = serving(opencode) | 512000 / 512000 / 128000 | input 1000000 vs 512000、output 131072 vs 128000 → discrepancy | known-empty（`[]`） | LiteLLM 组件优先，cacheRead = OpenCode 0.06 | configured；proof = canonical + serving(opencode) |
| **D** A + `litellm_params.max_tokens 65536`、`max_input_tokens 900000` | 同 A | input/output = constraint-narrowed | 1048576 / 900000 / 65536 | constraint-narrowed（非 discrepancy/conflict）；descriptive 差异同 A | unknown | 同 A | configured；constraint 指纹变化 → LKG fail closed |

## Risks / Trade-offs

- **[值变保守]** kimi-k3 output 1048576 → 131072、deepseek 393216 → 384000。→ 声明 `models_dev_provider` 恢复 serving 值；README/诊断说明。
- **[推理档位消失]** live 当前有 13 个模型发布可选档位（7 个 GPT、2 个 DeepSeek、2 个 GLM、kimi-k3、hy4-preview）。其中 3 个（gpt-6-luna/sol/astra）已被运维者 pin，改为 0 个可选档位 + fixedEffort（修正当前错误发布 5–6 档的问题）；其余 10 个在 serving 未证明时档位未知。→ 声明 `models_dev_provider` 或 pin；不放松证据规则。
- **[未登记模型更严格]** registry 无条目、LiteLLM 声明不完整、无 serving 声明的私有模型由「reseller 补值」改为 withheld。live 影响 0；诊断列出可声明的候选。
- **[schema 8 一次性 fail closed]** 升级后首轮若 models.dev outage，旧 LKG 不恢复。→ 下一轮 live 自动重捕获；release notes 说明。
- **[providers-only 镜像]** → Q2。
- **[contextWindow vs input capacity]** adapter 后续 change。
- **[registry 改名]** canonical identity 变化 → LKG fail closed（期望行为）。

## Migration Plan

1. Core：本 change 实施（tasks §1–§7），PR → main，产出稳定 SHA。
2. Pi、OpenCode：各自 OpenSpec change（引用本 change）→ `build:dist` 取同一 Core SHA → `catalog.json`、LKG v8、诊断字段 → 真实宿主 E2E → PR。
3. 回滚：adapter 回退旧 dist；v8 entry 被旧版视为 schema-incompatible（fail closed，安全）。

## Downstream impact

| 仓库 | 范围 |
|---|---|
| Core | 新增 `catalog-input.ts`、`wire-id.ts`、`resolve.ts`；重写 `modelsdev.ts` identity/serving（删除 relation fan-out 选择、rule B、OpenCode/OpenRouter/unique 发布供给、`resolveInheritedRecord`）；`evidence.ts` 维度描述符与 basis；`capabilities.ts`/`build.ts` 改为 resolver 投影；`publication.ts` assessment 派生与 LKG v8 proof；`diagnostics.ts` 新字段；`src/index.ts`；真实 schema fixtures；`scripts/audit-modelsdev-catalog.ts`；README、`docs/testing-standard.md` §8、`docs/decisions.md` |
| Pi | `src/net/fetch.ts` URL/形状；LKG 存储 v8（v7 忽略并重捕获）；`/litellm-diagnostics` 展示 canonical identity / serving status / 档位未知或 fixedEffort / 诊断候选；fake catalog fixture；Real Pi E2E；README |
| OpenCode | `src/net/fetch.ts` 默认 URL、`modelsDevUrl` 文档；LKG v8；diagnostics/TUI 字段；fake catalog；Real OpenCode E2E；README |

## Open Questions

- **Q1 — 已关闭（Revision 2）**：serving 未证明时不发布 lab/first-party 档位；只有已证明 serving 记录与 `litellm_params` 运维者显式配置可提供档位证据（D7）。LiteLLM 现有字段已审计：没有可声明「可选档位集合」的 endpoint 字段。
- **Q2（低优先级，保留）**：是否继续支持 provider-only（`api.json` 形状）的自建镜像？本设计默认按 D2 fail closed（不做 canonical 解析，LiteLLM-only 与 LKG 仍可用）；若需兼容，只能以诊断提示改用 catalog 形状，不能恢复任何 provider 记录供给。
