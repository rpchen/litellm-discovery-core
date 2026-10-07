# Design: Adopt the models.dev Canonical Catalog

> 状态：DESIGN（第三轮修订，冻结待评审，未实施）。本设计取代 `capability-first provider fallback`、rule B（PR #30）与 `canonical-original`-as-authority 的组合模型。审计证据见 `audit.md`，验收矩阵见 `acceptance.md`。
>
> **Revision 3（第二轮评审后，LiteLLM 源码核实）**：① 新增 Runtime Enforcement Matrix（D7a）：`litellm_params` 不再整体当作 runtime constraint，逐键分类 enforcement 语义；② serving 记录缺字段不再回落 canonical（serving view 是生成完成的最终视图，`base_model_omit` 不可撤销）；③ canonical/serving 矛盾一律 identity conflict，删除「事实等价 → discrepancy」例外；④ wire-id 解析不再无条件去尾/去首段，tail lookup 仅限裸值或经 parse 证据确认 adapter 前缀的 qualified 值；⑤ LKG proof 升级为 group-wide（逐 deployment 的 canonical 证据集 + serving 声明集）；⑥ 删除 `max_input_tokens → context` 的跨维度替代，LiteLLM-only 无 context 即 withheld；⑦ hygiene：`normalizeModelsDevCatalog` 忽略未知顶层 key。
>
> **Revision 2（第一轮评审后）**：取消未证明记录供给、字段级 matrix、关闭 Q1、LKG proof composition、wire-id 解析与证据分离、catalog 等价措辞、pinned effort 发现。

## Context

- 来源：Core `main@61f48948`；Pi `main@2f821818`（provenance `f07951d7`）；OpenCode `main@6c7818a0`。
- models.dev：repo `sst/models.dev@450aa1d5`；live `api.json`/`models.json`/`catalog.json`（2026-10-07 13:11 UTC）。
- LiteLLM：`BerriAI/litellm@736ff14f`（2026-10-07）；核实文件：`litellm/router.py`（`_acompletion` L3777-3884：`input_kwargs = {**litellm_params, ..., **kwargs}`——**请求参数覆盖 deployment 参数**；`_deployment_params_with_request_reasoning_override` L2582：请求带 `reasoning_effort` 时主动剥掉 deployment 的 `thinking`/`*.effort`），`litellm/router_utils/reasoning_effort_capability.py`（`supports_*_reasoning_effort` 与 `reasoning_effort_levels` 的语义），`litellm/router_strategy/complexity_router/context_compaction.py`（`_budget`：`max_input_tokens` 是 router 自身 compaction 的窗口输入，来自 model_info；output allowance 先读请求 payload 再回落 model_info）。
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
  - `complete`：顶层有 `providers`、`models` 两个对象，`models` 的 key 为 `<lab>/<model>`；**未来新增的其它顶层 key 一律忽略**（不因 `generatedAt`、`schemaVersion` 等新增字段把整个 catalog 判坏）。
  - `providers-only`：遗留 `api.json` 形状。
  - `unavailable`：空、非对象、或两者皆无。
- `providers-only` 与 `unavailable` 同等对待：不做 canonical 解析，不选任何 provider 记录；LiteLLM 声明完整的模型按 LiteLLM-only 路径发布，其余 `metadata-unavailable`（LKG 可恢复）。
- 所有公共入口接受 `unknown` 并内部归一化，签名不变。

### D3 Wire-ID 解析与 canonical identity

**D3.1 Wire-ID 解析（无证明力）。** 对每个 deployment 候选值 v（顺序：`model_info.base_model`，然后 `litellm_params.model`），解析规则（大小写不敏感，不折叠 `.`/`_`/语义后缀）：
- v 不含 `/`（**裸值**）→ 查找键 = `bare`（v 本身）。
- v 含 `/`（**qualified 值**）→ 查找键依次为：
  1. `full` = v（整串）；
  2. 仅当存在 **parse 证据**（`custom_llm_provider` 存在且等于第一段）：`afterAdapter` = 去掉第一段后的余串。余串若仍含 `/` 可直接作 registry key 比较；若已裸可作裸 ID 查找。

**禁止对任意 qualified 值直接取尾段（tail）做裸 ID 查找。** 是否为 adapter 不由 Core 猜测：LiteLLM 语义下 `custom_llm_provider` 才是 adapter 的显式声明（`get_llm_provider_logic.py` L191-253：路由前缀在 provider 注册时推导 `custom_llm_provider`；live 端点上 19/20 deployment 有显式 `custom_llm_provider: openai`）。`custom_llm_provider` 帮助**解析语法**，仍永不证明 lab namespace、canonical identity 或 serving provider。

adapter 段与 `custom_llm_provider` 记录为 parse metadata（进入诊断）。

**D3.2 Canonical proof（只来自 registry）。** 每个候选值按 D3.1 产出的查找键依次：
1. `full` 精确等于 registry key → proven（`qualified-deployment`）；
2. `afterAdapter`（仅当有 parse 证据）精确等于 registry key → proven（`qualified-deployment`）；裸值 `bare` 在 registry 裸 ID 索引中：0 → 下一候选值；1 → proven（`registry-unique`）；>1 → **ambiguous，停止**。

例：`minimax/MiniMax-M3` → full 命中（`minimax` 段不证明 serving）；`openrouter/xiaomi/mimo-v2.6-pro`（custom_llm_provider=openrouter）→ afterAdapter 命中 `xiaomi/mimo-v2.6-pro`；`mimo-v2.6-pro` → bare 唯一命中 `xiaomi/mimo-v2.6-pro`；`some-private-provider/foo`（无 custom_llm_provider 或不匹配第一段）→ 只试 full，不猜 adapter，不取尾段 → 0 命中 → unproven。

`base_model` 证明成功即决定该 deployment；路由解析不同只记 `identity-route-differs` 诊断（live `kimi-k2.7-code → minimax/MiniMax-M2.7`）。

**D3.3 serving relation 证据**（D4 证明 serving 之后）：选中 serving 记录的 `canonical_model_id` = C'。
- deployment 未证明 canonical 且 C' 是 registry key → canonical = C'（`serving-relation`）。
- deployment canonical C ≠ C'（两边都是确定性 identity 证据）→ **identity conflict，fail closed**（ambiguous，withheld，reason `identity-ambiguous`）。事实相等不是 identity 关系：`labA/x` 与 `labA/y` limits/modalities/tools/reasoning 全同也可能是不同模型；models.dev 当前没有任何能证明两个 canonical 等价的关系字段（audit §1：`aliases`/`inherits`/`equivalent_to` 在真实数据中出现 0 次）。
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
     : LiteLLM proven-declaration aggregate（跨 deployment 全部声明且一致，且该键的 enforcement class = declared-observable，见 D7a）
     : unknown
effective = narrow(base, proven runtime enforcement 同维度)      // 只收窄，永不提升
discrepancy: LiteLLM declared-observable ≠ base（base ∈ {serving, canonical}）→ resolved discrepancy
conflict:    跨 deployment declared-observable / proven enforcement 显式不一致 → unresolved conflict
```

- **serving 已证明 ⇒ serving 记录就是该模型的最终 serving 视图（models.dev 生成期已完成 base merge 与 `base_model_omit` 删除）**。Core 不得重做 models.dev 继承：serving 记录缺失的字段**不回落 canonical**，按该字段自己的缺席语义处理（registry 缺失时 `limit.input` 按推导规则、其余按 unknown；见逐字段表）。真实数据规模：64 条 linked serving 记录缺 `limit.input` 而 canonical 有（audit §7）；live 例子 `providers/requesty/models/hy3.toml` 用 `base_model_omit = ["limit.input"]` 明确删除（`requesty/hy3` serving 无 input，canonical `tencent/hy3` input=192000）。
- base 来自 LiteLLM 声明时该字段 basis 为 `litellm-declared`；部分 deployment 未声明 → unknown（不得过滤缺失）。
- 未证明 provider 记录在任何格子里都不出现。

**逐字段**：

| 字段 | serving proven + 有值 | canonical 有值 | 两者皆无时，LiteLLM 声明 | 都没有 | proven enforcement（D7a） | declared-observable ≠ base | gate |
|---|---|---|---|---|---|---|---|
| `limit.context` | serving `limit.context` | registry `limit.context` | —（**无替代**：`max_input_tokens` 是 input capacity，不得作为 context） | unknown → missing | 无同维度 enforcement 键 | — | gated |
| `limit.input` | serving `limit.input`；**缺即缺**（可能被 `base_model_omit` 删除），不回落 canonical | registry `limit.input` | `max_input_tokens`（declared-observable） | canonical proven 时 = effective context（basis `derived`）；canonical 亦无 → unknown | `litellm_params.max_input_tokens`（hard-enforced，router `_pre_call_checks` 逐请求拒绝超限部署） | `max_input_tokens` ≠ input base → discrepancy（只比 input） | 非 gated |
| `limit.output` | serving `limit.output` | registry `limit.output` | `max_output_tokens` ?? `max_tokens`（declared-observable） | unknown → missing | 无 hard enforcement（请求可覆盖） | discrepancy | gated |
| tools | serving `tool_call` | registry `tool_call` | `supports_function_calling` tri-state（declared-observable） | unknown | `litellm_params.supports_function_calling=false`（hard-enforced：LiteLLM 请求级据此改写/拒绝工具调用） | discrepancy | gated |
| reasoning support | serving `reasoning` | registry `reasoning` | `supports_reasoning` tri-state（declared-observable） | unknown | `litellm_params.supports_reasoning=false`（hard-enforced） | discrepancy | gated |
| input modalities | serving `modalities.input`（缺则 unknown） | registry `modalities.input` | 每个维度 flag 全部显式声明才 known（sparse 规则；declared-observable） | unknown | `litellm_params` 维度 flag `false`（hard-enforced：请求级丢弃该模态参数） | flag 与列表矛盾 → discrepancy | gated |
| output modalities | serving `modalities.output`（缺则 unknown） | registry `modalities.output` | 同上（`supports_audio_output`） | unknown | 同上 | 同上 | gated |
| reasoning levels | serving `reasoning_options`（known，可为空） | —（registry 无此字段） | —（`model_info.supports_*_reasoning_effort` 只诊断） | levels unknown | —（`reasoning_effort` 是 **operator default**，非 pin，见 D7a） | — | 非 gated |
| price（逐组件） | serving `cost`（仅当 LiteLLM 未声明该组件） | —（registry 无价格） | LiteLLM 显式价格**始终最高优先**（`litellm_params` 先于 `model_info`，多 deployment 取最高；declared-observable） | unknown（0） | — | — | 非 gated |
| release date | serving `release_date`（canonical 未证明时）；canonical proven 时用 registry | registry `release_date` | — | unknown（`releaseUnit: none`） | — | — | 非 gated |

**modalities 语义**（按 models.dev schema）：`modalities.input/output` 是必填完整集合——列出即 supported、未列出即 unsupported；整个 `modalities` 对象缺失（schema 允许、当前 0/445）→ unknown，绝不当作 text-only。

**reasoning levels 状态**：`unknown`（serving 未证明且无 operator default）≠ `known-empty`（serving 记录 `[]`、仅 `toggle`）。reasoning unsupported 时 levels 为 known-empty。

**跨维度替代禁止**：任何字段缺失不得用语义相近的另一维度字段填补。LiteLLM-only（canonical 未证明、无 serving）且无 context 声明 → context missing → withheld；这与「不让模型看起来完整」的产品价值一致。`limit.input` 缺失时「= effective context」是 models.dev 自身的 optional-input 语义（schema 中 `limit.input` optional，provider 必填 `context`），不是跨维度替代，但仅当 canonical proven 时适用；serving view 缺 input（含 `base_model_omit`）时保持缺失。

### D7 Reasoning controls（Q1 已关闭）

- canonical `reasoning = true` 只证明模型支持推理，不证明当前 endpoint 接受哪些档位。
- 档位证据只有一种：已证明 serving 记录的 `reasoning_options`。`litellm_params.reasoning_effort` 是 **operator default（请求可覆盖）**，不是 pin，不产生档位、不产生 fixedEffort、不收窄档位（见 D7a）。
- 非证据：`model_info.supports_{none,minimal,low,medium,high,xhigh,max}_reasoning_effort`、`model_info.reasoning_effort_levels`、`model_info.supported_openai_params`（LiteLLM cost-map 推导值）；`litellm_params.allowed_openai_params` 含 `reasoning_effort`（只证明参数会被转发，不证明合法值集合）。四者只进诊断。
- serving 未证明：`reasoningSupported` 照常；levels unknown；variants `[]`；诊断说明原因及恢复方式（声明 `models_dev_provider`）。

### D7a Runtime Enforcement Matrix（新增，LiteLLM 源码核实）

> 原则：**「字段出现在 `litellm_params`」不证明 endpoint 强制执行。** LiteLLM 的请求合并序为 `{**litellm_params, ..., **kwargs}`（`router.py` `_acompletion` L3877）：调用者显式参数覆盖 deployment 参数；`_deployment_params_with_request_reasoning_override`（L2582）在请求带 `reasoning_effort` 时主动剥掉 deployment 的 `thinking`/`*.effort`——证明请求优先是刻意语义，不是疏漏。每个候选键必须有独立的 enforcement 证明，才能进入 `constraint-narrowed`。

| 键 | enforcement class | 判据 | 处置 |
|---|---|---|---|
| `litellm_params.max_input_tokens` | **hard-enforced** | router `_pre_call_checks`（L12954-12973）：逐请求计算 token，超限部署直接被剔除（`invalid_model_indices.add`），调用者无法关闭 | 同维度收窄 `limit.input`；恒 ≤ context |
| `litellm_params.supports_function_calling = false` | **hard-enforced** | 请求级据此拒绝/改写工具调用（`get_optional_support_ids_in_order` + `supports_factory`；`main.py` L4492 参数丢弃路径） | 收窄 tools 为 unsupported |
| `litellm_params.supports_reasoning = false` | **hard-enforced** | 同上，`supports_reasoning` 请求级门控 | 收窄 reasoning 为 unsupported |
| `litellm_params.{vision,audio_input,video_input,pdf_input,audio_output}` = false | **hard-enforced** | 请求级据此丢弃对应模态参数（`get_optional_support_ids_in_order`） | 从 modality 集合移除该维度 |
| `litellm_params.reasoning_effort` | **operator default** | 请求 `reasoning_effort` 可覆盖（L3877 合并序 + L2582 主动让位） | **不 pin、不产生档位**；进诊断（「endpoint 默认 effort」） |
| `litellm_params.{max_tokens,max_output_tokens,max_completion_tokens}` | **operator default** | 请求可覆盖（合并序）；仅作为 outbound 请求参数 | **不收窄** `limit.output`；`model_info` 的 `max_output_tokens` 是 declared-observable |
| `model_info.*`（含 `max_input_tokens`、`max_output_tokens`、`supports_*`、`litellm_provider`、`key`、`supports_*_reasoning_effort`、`reasoning_effort_levels`） | **declared-observable** | LiteLLM cost-map / 部署配置推导的描述性事实，可被运维者覆盖，不参与逐请求 enforcement | 字段矩阵的 LiteLLM 声明列 / 诊断；`litellm_provider`/`key` 不作 identity 证据 |

- 未列出的 `litellm_params` 键 → `unknown` class，不使用（既不收窄也不产生事实）；未来新键必须先在本矩阵中登记并给出 enforcement 证据，才能进入实现。
- enforcement class 是 **Core 冻结的常量表**，不是实现时逐键猜测；升级该表需要新的 OpenSpec delta（含负向测试：声称 hard-enforced 的键必须有「请求尝试突破被拒绝/改写」的证据）。
- 原「Deployment Runtime Constraints」fact class 更名为 **Proven Runtime Enforcement**：只有 hard-enforced 键进入。

### D8 Price

逐组件（input/output/cacheRead/cacheWrite）：LiteLLM 显式价格（`litellm_params` 优先于 `model_info`，多 deployment 取最高；declared-observable）→ 已证明 serving 记录 `cost` → unknown。registry 无价格；未证明 provider 记录永不提供价格。（行为变化：explicit-provider 无 relation 的记录现在可提供价格，因为运维者声明即 serving 证明。）

### D9 Single resolver

```ts
resolveModel(group, catalog: NormalizedCatalog, options): ResolvedModel
interface ResolvedModel {
  group; protocol; catalogKind
  identity: { status: "proven"|"unproven"|"ambiguous"|"conflict"; canonicalModelID?; evidence: "qualified-deployment"|"registry-unique"|"serving-relation"|"none"; matchedCandidate?; parse: { adapterSegment?; customLLMProvider? }; discrepancy?; reason? }
  serving: { status: "declared"|"declared-unmatched"|"serving-ambiguous"|"unproven"; providerID?; recordID?; reason? }
  fields: Record<FieldName, FieldResolution & { basis: FieldBasis }>   // FieldBasis = "serving"|"canonical"|"litellm-declared"|"derived"|"enforcement-narrowed"|"unknown"
  reasoningLevels: { state: "unknown"|"known"; values; operatorDefaultEffort? }   // operatorDefaultEffort 仅诊断
  diagnosticCandidates: Array<{ providerID; recordID; why }>             // 未证明记录，只诊断
  status; publishable; reasons; discrepancies; conflicts
  proof: LKGProof                                                       // D10，capture 直接持久化
}
toModelSpec(resolved): ModelSpec          // 唯一 ModelSpec 构造器
```

不变量：`buildModelSpecs = groups.map(resolveModel).map(toModelSpec)`；assessment、partition、diagnostics、LKG capture/validation 全部消费同一 `ResolvedModel`；publishable `spec` 恒等于 `toModelSpec(resolved)`；captured verdict 与 proof 由同一 resolved 派生。删除 `mapCapabilities` 独立解析与 `resolveInheritedRecord` 字段继承。`assessModelConfiguration` 形状兼容（新增 `identity.canonicalModelID`、`serving`；旧 `identity.selected` 只表示「已证明 serving 记录」）。

### D10 LKG schema 8：proof composition（group-wide）

```ts
interface CanonicalEvidenceItem {
  deploymentStableKey: string        // deployment 在组内的稳定标识（route/base_model 归一化输入 + sourceIndex 无关的序）
  normalizedInput: string            // 该 deployment 产生 canonical 证明的归一化候选值
  evidenceKind: "qualified-deployment" | "registry-unique" | "serving-relation"
  canonicalModelID: string
}
interface LastKnownGoodEntryV8 {
  schemaVersion: 8; modelName; stableIdentity
  proof: {
    canonicalEvidence: CanonicalEvidenceItem[]           // **每个** deployment 一项，稳定排序（按 deploymentStableKey）
    registryDigest: string                               // 被使用 canonical 事实的稳定摘要
    serving?: { providerID; recordID; declarations: Array<{ deploymentStableKey; declared: string }>; recordDigest: string }   // declarations 为 group-wide
    fields: Record<FieldName, FieldBasis>               // 每字段决策依据
    enforcementFingerprint: string                       // 全部 deployment 的 hard-enforced 键（D7a 表）稳定序列化摘要
    litellmFingerprint?: string                          // 仅当任一字段 basis = litellm-declared：相关 model_info 键的摘要
  }
  fetchedAt; fetchedAtEpochMs; spec; captured; provenanceDetail
}
```

- **Group-wide 重证明**：恢复时当前组的每个 deployment 必须与 `canonicalEvidence` 逐项重证明（同 `deploymentStableKey` 集合、同 `normalizedInput`、同 `canonicalModelID`）；serving 恢复要求 `declarations` 与当前组内每个 deployment 的声明一致。只证明「其中一个输入没变」不够。
- `registryDigest`/`recordDigest`：被使用事实的稳定摘要（limit、modalities、tool_call、reasoning；serving 另含 reasoning_options、cost）。
- **整体判定，绝不按字段拼接**：恢复要么发布整份 `spec`，要么 fail closed。
- outage（catalog `unavailable`/`providers-only`）可恢复条件：stableIdentity 不变；`canonicalEvidence` 逐 deployment 重证明成功；`declarations` 逐 deployment 不变（若有）；`enforcementFingerprint` 不变；`litellmFingerprint` 不变（若有）；captured == spec。
- live catalog 可用（LKG 仍只在 live `discovered-incomplete`/`metadata-unavailable` 时被咨询）：额外要求 live canonical id 集合相同、`registryDigest` 相同、serving 记录 `recordDigest` 相同（若有）；未被 proof 引用的 provider 记录变化不使 entry 失效。
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
| **D** A + `litellm_params.max_input_tokens 900000`（hard-enforced）；另例 `max_tokens 65536`（operator default，**不**收窄） | 同 A | input = enforcement-narrowed；output 不变 | 1048576 / 900000 / 512000 | enforcement-narrowed（非 discrepancy/conflict）；descriptive 差异同 A | unknown | 同 A | configured；enforcement 指纹变化 → LKG fail closed；`max_tokens` 变化不触发 LKG 失效（非 enforcement 键） |

## Risks / Trade-offs

- **[值变保守]** kimi-k3 output 1048576 → 131072、deepseek 393216 → 384000。→ 声明 `models_dev_provider` 恢复 serving 值；README/诊断说明。
- **[推理档位消失]** live 当前有 13 个模型发布可选档位。serving 未证明时全部变为 levels unknown（修正当前错误发布档位的问题，包括把 `litellm_params.reasoning_effort` 误当 pin 的 3 个模型）。→ 声明 `models_dev_provider`；不放松证据规则。
- **[LiteLLM-only 更严格]** LiteLLM-only（canonical 未证明、无 serving）且无真实 context 语义声明时，模型由「拿 `max_input_tokens` 当 context」改为 withheld。live 20 个 deployment 中无此形态（均有 canonical 匹配）；影响集中在私有模型。
- **[serving 缺字段不回填]** 已证明 serving 缺 `limit.input`（可能被 `base_model_omit` 删除，真实数据 64 条）时保持缺失，不再回填 canonical。→ 与 models.dev 生成器语义一致。
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

- **Q1 — 已关闭（Revision 2，Revision 3 收紧）**：serving 未证明时不发布任何档位。档位证据只有已证明 serving 记录的 `reasoning_options`。Revision 3 确认：`litellm_params.reasoning_effort` 是 operator default（请求可覆盖），不是 pin，也不提供档位；LiteLLM 现有字段中没有任何可声明「可选档位集合」且被 endpoint 强制执行的键。
- **Q2（低优先级，保留）**：是否继续支持 provider-only（`api.json` 形状）的自建镜像？本设计默认按 D2 fail closed（不做 canonical 解析，LiteLLM-only 与 LKG 仍可用）；若需兼容，只能以诊断提示改用 catalog 形状，不能恢复任何 provider 记录供给。
