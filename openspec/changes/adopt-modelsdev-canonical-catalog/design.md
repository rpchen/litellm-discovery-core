# Design: Adopt the models.dev Canonical Catalog

> 状态：DESIGN（第三轮修订，冻结待评审，未实施）。本设计取代 `capability-first provider fallback`、rule B（PR #30）与 `canonical-original`-as-authority 的组合模型。审计证据见 `audit.md`，验收矩阵见 `acceptance.md`。
>
> **Revision 5（第五轮评审后，OpenSpec 内部一致性收敛）**：① D7a 作用域拆分——enforcement（空证明集）只约束 capability/limit/control facts，`MirroredPricingParams` 的 7 个价格键按 D8 Operator-Declared Pricing 独立处理；② D6 改为分支算法：serving proven 时按 per-field serving-absence policy（永不回填 canonical），serving record unresolved 时整组按 serving-unproven 解析；③ LKG proof 改 `deploymentEvidence`（`canonicalModelID` 可选、`identityKind` = canonical/litellm-only/serving-only，`registryDigest` 可选），支持 R10b/R10c/R11 合法 capture；④ serving provider proof 与 serving record proof 拆开：relation-only 命中不证明 SKU，record = unresolved 时继续用 canonical/LiteLLM facts；⑤ 清除全部残留旧语义。
>
> **Revision 4（第四轮评审后，LiteLLM 源码复核）**：① **撤销 D7a 全部 hard-enforced 归类**——`get_router_model_info()` 不合并 `litellm_params` 能力键，`Deployment.__init__` 只镜像 7 个价格键，`supports_*` 请求级门读 cost-map/provider config 而非 deployment 配置；enforcement 证明集从空开始，逐键晋升需 exact source path + 负向突破测试；② 删除 `limit.input = context` 推导（models.dev 无 absent==context 契约）；③ catalog 判定改穷举三态（models-only 归 unavailable）；④ LKG deployment 证明改 evidence multiset + 持久化 `model_info.id`；⑤ DeepSeek 行为变化显式双场景 + migration note；⑥ 全文清除 Revision 2/3 残留。
>
> **Revision 3（第三轮评审后）**：① Runtime Enforcement Matrix 概念（D7a）：`litellm_params` 不再整体当作 runtime constraint，逐键分类 enforcement 语义；② serving 记录缺字段不再回落 canonical（serving view 是生成完成的最终视图，`base_model_omit` 不可撤销）；③ canonical/serving 矛盾一律 identity conflict，删除「事实等价 → discrepancy」例外；④ wire-id 解析不再无条件去尾/去首段，tail lookup 仅限裸值或经 parse 证据确认 adapter 前缀的 qualified 值；⑤ LKG proof 升级为 group-wide（逐 deployment 的 canonical 证据集 + serving 声明集）；⑥ 删除 `max_input_tokens → context` 的跨维度替代，LiteLLM-only 无 context 即 withheld；⑦ hygiene：`normalizeModelsDevCatalog` 忽略未知顶层 key。
>
> **Revision 2（第一轮评审后）**：取消未证明记录供给、字段级 matrix、关闭 Q1、LKG proof composition、wire-id 解析与证据分离、catalog 等价措辞、pinned effort 发现。

## Context

- 来源：Core `main@61f48948`；Pi `main@2f821818`（provenance `f07951d7`）；OpenCode `main@6c7818a0`。
- models.dev：repo `sst/models.dev@450aa1d5`；live `api.json`/`models.json`/`catalog.json`（2026-10-07 13:11 UTC）。
- LiteLLM：`BerriAI/litellm@736ff14f`（2026-10-07），第四轮逐行复核的关键链路：`router.py` `_acompletion` L3777-3884（`input_kwargs = {**litellm_params, ..., **kwargs}`，请求覆盖 deployment）与 L2582（请求带 `reasoning_effort` 时主动剥掉 deployment 的 effort 载体）；`get_router_model_info` L11091（resolved `model_info` = cost-map ∨ discovered ∨ `deployment.model_info`，**不合并 `litellm_params` 的能力键**）；`_pre_call_checks` L12954-12973（admission 门读 resolved `model_info["max_input_tokens"]`）；`types/router.py` `Deployment.__init__` L750-753（`SPECIAL_MODEL_INFO_PARAMS = tuple(MirroredPricingParams.model_fields)`，仅镜像 7 个**价格**键）；`utils.py` `supports_factory` L2801（读 cost-map/provider config，非 deployment 配置）；`router_utils/reasoning_effort_capability.py`（`supports_*_reasoning_effort` / `reasoning_effort_levels` 语义）。
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
| **Proven Runtime Enforcement** | 通过 D7a 晋升门槛的 `litellm_params` 键（证明集当前**为空**） | 只收窄同维度 |
| **Operator-Declared Pricing** | `litellm_params` 中 `MirroredPricingParams` 的 7 个价格键（LiteLLM 显式镜像进 `model_info`） | 按 D8 独立处理；不是 enforcement，也不是 capability 事实 |
| **LiteLLM Descriptive** | `model_info.*` | secondary evidence |
| **Wire-ID parse metadata** | route adapter 段、`custom_llm_provider` | **只**用于解析 wire id 与诊断，永不作为证据 |

**Canonical identity known ≠ serving provider known。** first-party lab 记录、namespace 相等、`canonical-original` 都**不**证明 serving。未证明的 provider 记录（含同名精确匹配）**只进 diagnostics**。

### D2 Catalog 输入契约

- `normalizeModelsDevCatalog(input)` → `{ kind: "complete", models, providers } | { kind: "providers-only", providers } | { kind: "unavailable" }`。
  - `complete`：顶层有 `providers`、`models` 两个对象，`models` 的 key 为 `<lab>/<model>`；**未来新增的其它顶层 key 一律忽略**（不因 `generatedAt`、`schemaVersion` 等新增字段把整个 catalog 判坏）。
  - 判定**穷举三态**（对任意输入恰好命中其一）：`providers`+`models` 皆有效对象 → `complete`；是遗留 provider map 形状（多个 provider 值含 `models` 对象）→ `providers-only`；其余一切——空、非对象、**只有 `models`（models-only）**、`providers`/`models` 之一非对象——→ `unavailable`。
- `providers-only` 与 `unavailable` 同等对待：不做 canonical 解析，不选任何 provider 记录；LiteLLM 声明完整的模型按 LiteLLM-only 路径发布，其余 `metadata-unavailable`（LKG 可恢复）。`models-only`（无 providers）对 serving/canonical 都无法提供可用层，归 `unavailable`。
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
- **Provider 证明 ≠ record/SKU 证明。** 记录选择（只在 P 内）：
  1. key/id 精确等于 D3.1 的 parsed lookup keys（full → adapter-evidenced remainder → bare）→ record **resolved**；
  2. 无 parsed-key 命中时，P 内 `canonical_model_id == C` 的记录**只能证明 underlying canonical identity**（与 D3.3 一致），**不能证明**当前 route 的 SKU——record = **unresolved**（`serving-record-unresolved`）：整组按 serving-unproven 分支解析（canonical → LiteLLM → unknown），诊断说明「provider 已声明但无精确同名记录；请用精确 wire id 或改声明」，并禁止把 relation-only 记录（`x-free`/`x-fast`/`thinking`/tier 变体）当 serving facts；canonical identity 未证明时，relation-only 命中仍可作 `serving-relation` 的 identity 证据（D3.3），但同样不提供 serving facts；
  3. parsed-key 命中多条且 serving publication-critical facts 实质不同 → `serving-ambiguous`（withheld）；
  4. P 无任何候选记录 → `declared-unmatched`（按 serving 未证明发布 + warning）。
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

**分支算法（每字段、每 deployment 组；不再是一级联 fallback）**：

```text
if serving provider proven AND serving record resolved:      // D4：record 解析独立于 provider 证明
    if serving 记录有该字段:    base = serving（basis serving）
    else:                      base = 该字段的 serving-absence policy（见下；永不回填 canonical）
elif canonical proven AND registry 有该字段:
                              base = canonical（basis canonical）
elif LiteLLM 声明（跨 deployment 全部声明且一致）:
                              base = litellm-declared
else:                         base = unknown

effective = base    // D7a 证明集为空：无 enforcement 收窄；晋升后 narrow(base, hard-enforced 同维度)
discrepancy: LiteLLM 声明 ≠ base（base ∈ {serving, canonical}）→ resolved discrepancy
conflict:    跨 deployment LiteLLM 声明显式不一致 → unresolved conflict
```

**per-field serving-absence policy**（serving record resolved 但缺该字段）：
- optional 字段（如 `limit.input`）：**unknown**（可能是 `base_model_omit` 删除，与真实缺省不可区分）。
- **禁止**：从 canonical registry 回填（撤销 models.dev 作者的显式 omit）。
- **允许**：**同维度**的 LiteLLM 声明补缺（serving 无 `limit.input` 而 LiteLLM 有 `max_input_tokens` → input = litellm-declared；不是跨维度替代、不是 canonical 回填）。
- serving 记录的 schema 必填字段（`limit.context`/`limit.output`/`modalities`）缺失视为 unknown → gate 判 missing。

**serving provider proven 但 serving record unresolved**（D4）：整组按 serving-unproven 分支解析（canonical → LiteLLM → unknown），诊断标注 `serving-record-unresolved`。

- **serving 已证明 ⇒ serving 记录就是该模型的最终 serving 视图（models.dev 生成期已完成 base merge 与 `base_model_omit` 删除）**。Core 不得重做 models.dev 继承：serving 记录缺失的字段**不回落 canonical**，按该字段自己的缺席语义处理（按 per-field serving-absence policy：同维度 LiteLLM 声明可补缺，否则 unknown；见分支算法）。真实数据规模：64 条 linked serving 记录缺 `limit.input` 而 canonical 有（audit §7）；live 例子 `providers/requesty/models/hy3.toml` 用 `base_model_omit = ["limit.input"]` 明确删除（`requesty/hy3` serving 无 input，canonical `tencent/hy3` input=192000）。
- base 来自 LiteLLM 声明时该字段 basis 为 `litellm-declared`；部分 deployment 未声明 → unknown（不得过滤缺失）。
- 未证明 provider 记录在任何格子里都不出现。

**逐字段**：

| 字段 | serving proven + 有值 | canonical 有值 | 两者皆无时，LiteLLM 声明 | 都没有 | proven enforcement（D7a：当前**为空**） | declared-observable ≠ base | gate |
|---|---|---|---|---|---|---|---|
| `limit.context` | serving `limit.context` | registry `limit.context` | —（**无替代**：`max_input_tokens` 是 input capacity，不得作为 context） | unknown → missing | 无同维度 enforcement 键 | — | gated |
| `limit.input` | serving `limit.input`；缺 → serving-absence policy：unknown + **允许** LiteLLM `max_input_tokens` 同维度补缺（litellm-declared），**不回填 canonical** | registry `limit.input`；registry 亦缺 → LiteLLM `max_input_tokens`（同维度补缺）→ unknown | `max_input_tokens`（declared-observable） | unknown | —（无通过门槛的键） | `max_input_tokens` ≠ input base → discrepancy（只比 input） | 非 gated |
| `limit.output` | serving `limit.output` | registry `limit.output` | `max_output_tokens` ?? `max_tokens`（declared-observable） | unknown → missing | 无 hard enforcement（请求可覆盖） | discrepancy | gated |
| tools | serving `tool_call` | registry `tool_call` | `supports_function_calling` tri-state（declared-observable） | unknown | — | discrepancy | gated |
| reasoning support | serving `reasoning` | registry `reasoning` | `supports_reasoning` tri-state（declared-observable） | unknown | — | discrepancy | gated |
| input modalities | serving `modalities.input`（缺则 unknown） | registry `modalities.input` | 每个维度 flag 全部显式声明才 known（sparse 规则；declared-observable） | unknown | — | flag 与列表矛盾 → discrepancy | gated |
| output modalities | serving `modalities.output`（缺则 unknown） | registry `modalities.output` | 同上（`supports_audio_output`） | unknown | — | 同上 | gated |
| reasoning levels | serving `reasoning_options`（known，可为空） | —（registry 无此字段） | —（`model_info.supports_*_reasoning_effort` 只诊断） | levels unknown | — | — | 非 gated |
| price（逐组件） | serving `cost`（仅当 LiteLLM 未声明该组件） | —（registry 无价格） | LiteLLM 显式价格**始终最高优先**（`litellm_params` 先于 `model_info`，多 deployment 取最高；declared-observable） | unknown（0） | — | — | 非 gated |
| release date | serving `release_date`（canonical 未证明时）；canonical proven 时用 registry | registry `release_date` | — | unknown（`releaseUnit: none`） | — | — | 非 gated |

**modalities 语义**（按 models.dev schema）：`modalities.input/output` 是必填完整集合——列出即 supported、未列出即 unsupported；整个 `modalities` 对象缺失（schema 允许、当前 0/445）→ unknown，绝不当作 text-only。

**reasoning levels 状态**：`unknown`（serving 未证明）≠ `known-empty`（serving 记录 `[]`、仅 `toggle`）。reasoning unsupported 时 levels 为 known-empty。

**跨维度替代禁止（不变量）**：任何字段缺失不得用语义相近的另一维度字段填补，包括 `limit.input = limit.context`——models.dev 的 README/schema 只定义 `context` = 最大上下文窗口、`input` = 最大输入 token（optional），**没有**「absent input == context」的 consumer contract；多个 provider sync 明确保留 `input: undefined`，且存在 `base_model_omit=["limit.input"]` 的真实删除用例（audit §7）。因此 base 缺 input 即 **unknown**。宿主若需要 input 数值，在 adapter mapping 层显式讨论（当前 Pi/OpenCode 均以 `limit.context` 为宿主 contextWindow、`limit.output` 为 maxTokens，未消费 `limit.input`——不构成本 change 的阻塞）。LiteLLM-only 无 context 声明 → context missing → withheld。

### D7 Reasoning controls（Q1 已关闭）

- canonical `reasoning = true` 只证明模型支持推理，不证明当前 endpoint 接受哪些档位。
- 档位证据只有一种：已证明 serving 记录的 `reasoning_options`。`litellm_params.reasoning_effort` 是 **operator configuration（请求可覆盖）**，不是 pin，不产生档位、不产生 fixedEffort、不收窄档位（见 D7a）。
- 非证据：`model_info.supports_{none,minimal,low,medium,high,xhigh,max}_reasoning_effort`、`model_info.reasoning_effort_levels`、`model_info.supported_openai_params`（LiteLLM cost-map 推导值）；`litellm_params.allowed_openai_params` 含 `reasoning_effort`（只证明参数会被转发，不证明合法值集合）。四者只进诊断。
- serving 未证明：`reasoningSupported` 照常；levels unknown；variants `[]`；诊断说明原因及恢复方式（声明 `models_dev_provider`）。

### D7a Runtime Enforcement Matrix（Revision 4 重写：证明集为空）

> 原则：**「字段出现在 `litellm_params`」不证明 endpoint 强制执行。** 请求合并序 `{**litellm_params, ..., **kwargs}`（`_acompletion` L3877）与 `_deployment_params_with_request_reasoning_override`（L2582）证明请求覆盖 deployment 是刻意语义。Revision 3 曾据此把若干键归为 hard-enforced，**Revision 4 复核源码后确认那些判据全部不成立**：
>
> - `_pre_call_checks` 的 admission 门（L12954-12973）读的是 `get_router_model_info()` 解析出的 `model_info["max_input_tokens"]`（cost-map ∨ discovered ∨ `deployment.model_info`，L11091-11124 合并链），**不读** `litellm_params.max_input_tokens`；router.py 中该键的直接读取为 0 处。
> - `Deployment.__init__`（types/router.py L750-753）从 `litellm_params` 镜像到 `model_info` 的只有 `SPECIAL_MODEL_INFO_PARAMS = tuple(MirroredPricingParams.model_fields)`——7 个**价格**键，不含任何能力键。
> - `supports_factory`（utils.py L2801）读 `get_model_info_helper`（cost-map / provider config），不读 deployment 配置；上一轮引用的 `main.py L4492` 实为 Ollama dispatch，与能力门无关。
> - 因 `Deployment.__init__` 的镜像缺失，运维者写在 `litellm_params` 的能力键甚至**不会进入** LiteLLM 自己的 admission/capability 门（与价格键不同）。

**作用域（Revision 5）**：本矩阵只约束 **capability / limit / control facts**（limits、tools、reasoning、modalities、档位、任何 narrowing）。`litellm_params` 中 `MirroredPricingParams` 的 7 个价格键（`input_cost_per_token`、output_cost_per_token`、input_cost_per_character`、output_cost_per_character`、cache_read_input_token_cost`、cache_creation_input_token_cost`、tiered_pricing`）是 **Operator-Declared Pricing**：LiteLLM 显式把它们从 `litellm_params` 镜像进 `model_info`（types/router.py L750-753），是经源码证明的运维者价格声明，按 D8 独立处理——它们不是 enforcement，不受「不产生事实」约束，也永不参与 narrowing。因此本矩阵的「operator configuration」指**非价格键**。

**冻结表（Revision 4，Revision 5 补作用域）：**

| 键 | class | 判据 | 处置 |
|---|---|---|---|
| （**空**） | hard-enforced | 无任何键通过晋升门槛 | — |
| `litellm_params.*`（全部，含 `max_input_tokens`、`supports_function_calling`、`supports_reasoning`、modality flags、`reasoning_effort`、`max_tokens` 系） | **operator configuration（未证明）** | 出现在运维者配置中，但其对请求的 enforcement 语义未按晋升门槛证明 | **不参与 effective-value narrowing、不产生事实、不进 LKG enforcement fingerprint**；只进诊断（「运维者配置的键」） |
| `model_info.*`（含 `max_input_tokens`、`max_output_tokens`、`supports_*`、`litellm_provider`、`key`、`supports_*_reasoning_effort`、`reasoning_effort_levels`） | **declared-observable** | LiteLLM cost-map / 部署配置推导的描述性事实 | 字段矩阵的 LiteLLM 声明列 / 诊断；`litellm_provider`/`key` 不作 identity 证据 |

**晋升门槛（冻结）**：一个键要进入 hard-enforced，必须同时有
1. **exact source path**：LiteLLM 源码中「读取该 deployment 键并据其拒绝/改写请求」的精确位置；且
2. **负向突破测试**：自动化测试证明携带该键的 deployment 会拒绝或改写试图突破它的请求，而请求侧无法绕过。

证明集**从空开始**；晋升通过新的 OpenSpec delta 逐键进行（delta 必须包含上述两类证据）。已知方向（供未来 delta 参考，本轮不采用）：`max_input_tokens` 若要晋升，需先在 Core 侧确立「`litellm_params.max_input_tokens` 会进入 resolved `model_info`」的语义（LiteLLM 当前**不会**自动镜像它，与价格键不同——运维者若只在 `litellm_params` 声明，LiteLLM 自己的门都看不到）。

- 未列出/未证明的 `litellm_params` 键 → `operator configuration`，不使用。
- enforcement class 是 **Core 冻结的常量表**，不是实现时逐键猜测。
- 原「Deployment Runtime Constraints」fact class 更名为 **Proven Runtime Enforcement**：当前为空集。
- **后果**：effective values 中不再有任何 `constraint-narrowed`/`enforcement-narrowed` 值；收窄只能来自 models.dev（serving/canonical）与字段矩阵本身。LiteLLM 侧对 base 的「收窄」语义整体消失，直到某个键通过晋升门槛。

### D8 Price

逐组件（input/output/cacheRead/cacheWrite）：**Operator-Declared Pricing**（`litellm_params` 中 `MirroredPricingParams` 的 7 个价格键——LiteLLM 显式镜像进 `model_info`，故先于 `model_info` 同名键；多 deployment 取最高）→ provider 已证明**且 record resolved** 的 serving 记录 `cost` → unknown。registry 无价格；未证明 provider 记录永不提供价格。价格键是 D7a 之外独立的第四类 `litellm_params` 事实：不是 enforcement、不参与 narrowing，但**是**事实。（行为变化：运维者声明即 provider 证明；record resolved 才用其 cost。）

### D9 Single resolver

```ts
resolveModel(group, catalog: NormalizedCatalog, options): ResolvedModel
interface ResolvedModel {
  group; protocol; catalogKind
  identity: { status: "proven"|"unproven"|"ambiguous"|"conflict"; canonicalModelID?; evidence: "qualified-deployment"|"registry-unique"|"serving-relation"|"none"; matchedCandidate?; parse: { adapterSegment?; customLLMProvider? }; discrepancy?; reason? }
  serving: { status: "declared"|"declared-unmatched"|"serving-record-unresolved"|"serving-ambiguous"|"unproven"; providerID?; recordID?; reason? }   // declared = provider proven + record resolved；serving-record-unresolved = provider proven、无 exact SKU
  fields: Record<FieldName, FieldResolution & { basis: FieldBasis }>   // FieldBasis = "serving"|"canonical"|"litellm-declared"|"unknown"（"enforcement-narrowed" 预留给 D7a 晋升后的键；当前不产生）
  reasoningLevels: { state: "unknown"|"known"; values; operatorDefaultEffort? }   // operatorDefaultEffort 仅诊断
  diagnosticCandidates: Array<{ providerID; recordID; why }>             // 未证明记录，只诊断
  status; publishable; reasons; discrepancies; conflicts
  proof: LKGProof                                                       // D10，capture 直接持久化
}
toModelSpec(resolved): ModelSpec          // 唯一 ModelSpec 构造器
```

不变量：`buildModelSpecs = groups.map(resolveModel).map(toModelSpec)`；assessment、partition、diagnostics、LKG capture/validation 全部消费同一 `ResolvedModel`；publishable `spec` 恒等于 `toModelSpec(resolved)`；captured verdict 与 proof 由同一 resolved 派生。删除 `mapCapabilities` 独立解析与 `resolveInheritedRecord` 字段继承。`assessModelConfiguration` 形状兼容（新增 `identity.canonicalModelID`、`serving`；旧 `identity.selected` 只表示「已证明 serving 记录」）。

### D10 LKG schema 8：proof composition（group-wide，identityKind 三态）

```ts
interface DeploymentEvidenceItem {
  deploymentID: string               // LiteLLM `model_info.id`（存在且非空时），否则由该 deployment 全部 identity 证据 multiset 派生
  normalizedInputs: string[]          // 归一化候选值 multiset（base_model + route，排序）
  identityKind: "canonical" | "litellm-only" | "serving-only"
  canonicalModelID?: string           // identityKind = canonical 时必有；其余为空
  canonicalEvidenceKind?: "qualified-deployment" | "registry-unique" | "serving-relation"   // canonical 时必有
}
interface LastKnownGoodEntryV8 {
  schemaVersion: 8; modelName; stableIdentity
  proof: {
    deploymentEvidence: DeploymentEvidenceItem[]   // 每个 deployment 一项，稳定排序（按 deploymentID）
    registryDigest?: string                         // 仅当任一字段 basis = canonical：被使用 canonical 事实的稳定摘要
    serving?: { providerID; recordID; declarations: Array<{ deploymentID; declared: string }>; recordDigest: string }   // record resolved 时；逐 deployment declarations
    fields: Record<FieldName, FieldBasis>           // 每字段决策依据
    enforcementFingerprint: string                 // hard-enforced 键摘要（D7a 证明集，当前为空）：形状冻结、内容空
    litellmFingerprint?: string                    // 仅当任一字段 basis = litellm-declared：相关 model_info 键的摘要
  }
  fetchedAt; fetchedAtEpochMs; spec; captured; provenanceDetail
}
```

- **identityKind 覆盖全部可发布形态**：`canonical`（canonicalModelID + canonicalEvidenceKind 必填）、`litellm-only`（R10b/R11：registry 无 canonical match、LiteLLM gated facts 完整）、`serving-only`（R10c：registry 无 canonical match、`models_dev_provider` 声明且 serving record resolved；serving facts 由 record 提供，identity 由 serving-relation 或 provider+wire-id 证明）。R10b/R10c/R11 与 R1–R9 在同一 schema 下合法 capture——**single resolver 成功发布 ⇒ capture 必能构造合法 proof**（gate 与 capture 不漂移）。
- **Group-wide 重证明（evidence multiset）**：`deploymentID` = LiteLLM `model_info.id`（live 20/20 有值），否则由该 deployment 全部 identity 证据 multiset 派生；`normalizedInputs` 是候选值 multiset。恢复要求排序后 multiset 逐项相等（deploymentID 集合、normalizedInputs、identityKind、canonicalModelID）；两个 route 相同但证据不同的 deployment 永远派生不同 multiset 键。
- `registryDigest`/`recordDigest`：被使用事实的稳定摘要（limit、modalities、tool_call、reasoning；serving 另含 reasoning_options、cost）；按 basis 可选，未参与者不写入。
- **整体判定，绝不按字段拼接**：恢复要么发布整份 `spec`，要么 fail closed。
- outage（catalog `unavailable`/`providers-only`）可恢复条件：stableIdentity 不变；`deploymentEvidence` 逐 deployment 重证明成功（含 identityKind 与 canonicalModelID）；serving `declarations` 逐 deployment 不变（若有）；`enforcementFingerprint` 不变；`litellmFingerprint` 不变（若有）；captured == spec。
- live catalog 可用（LKG 仍只在 live `discovered-incomplete`/`metadata-unavailable` 时被咨询）：额外要求 live canonical id 集合与 identityKind 集合相同、有 canonical 的项 `registryDigest` 相同、serving 记录 `recordDigest` 相同（若有）；未被 proof 引用的 provider 记录变化不使 entry 失效。
- 由于未证明记录不再产生发布事实，v8 不存在不可恢复的「fallback」authority；可恢复性由 proof 各组成部分逐项重证明决定。
- v≤7、缺 proof 字段、未知 basis、identityKind 与 proof 内容不一致（如 `canonical` 无 canonicalModelID、或 `litellm-only` 却有 registryDigest）：fail closed，不迁移。

### D11 Data fetching

- adapter 默认 URL：`https://models.dev/catalog.json`；单请求，`providers` 与 `models` 同 snapshot、同 TTL epoch、同 failure domain；5.74 MB（`api.json` 5.33 MB，+7.7%）；现有 60 s 超时、6 h TTL、60 s retry 保持。
- adapter 只 fetch/cache 原始 JSON；形状、identity、authority、merge 全在 Core；不并行拼接 `models.json` + `api.json`。
- OpenCode `modelsDevUrl`：指向 catalog 形状镜像；provider-only 镜像按 D2 处理（Q2）。

## MiniMax-M3 决策表（冻结，按 D6 对齐）

输入：canonical `minimax/MiniMax-M3` = context 1048576 / output 512000（无 `limit.input`）、modalities `text,image,video`；first-party `minimax/MiniMax-M3` = 1000000 / 512000、`reasoning_options [toggle]`、cost 0.3/1.2/0.06；third-party `opencode/minimax-m3` = 512000 / 128000、`reasoning_options []`、`canonical_model_id minimax/MiniMax-M3`；LiteLLM `max_input_tokens` 1000000、`max_output_tokens` 131072、`input_cost_per_token` 3e-7；`base_model = minimax-m3`。

| 情形 | canonical identity | 字段 basis | effective context / input / output | discrepancy / conflict | levels | price | publishability / LKG proof |
|---|---|---|---|---|---|---|---|
| **A** serving 未证明 | `minimax/MiniMax-M3`（registry-unique，经 base_model tail） | context/output/tools/reasoning/modalities = canonical；registry 无 `limit.input` → **input 由 LiteLLM 同维度补缺**（`max_input_tokens` = 1000000，basis litellm-declared） | 1048576 / 1000000 / 512000 | input：base = litellm-declared 1000000（与声明一致，无 discrepancy）；output 131072 vs 512000 → resolved discrepancy；context 无 LiteLLM 声明可比较 | unknown | LiteLLM（input/output）；其余组件 unknown | configured；proof = canonical + constraint/litellm 指纹 |
| **B** `models_dev_provider: minimax`（provider + exact record `MiniMax-M3`，bare parsed-key 精确命中） | 同上；inline first-party 与 C 一致 | context/output = serving；serving 记录有 `limit.input`（1000000）→ input = serving | 1000000 / 1000000 / 512000 | input 一致；output 131072 vs 512000 → discrepancy | known-empty（toggle） | LiteLLM 组件优先，cacheRead = MiniMax 0.06 | configured；proof = canonical + serving(minimax) |
| **C** `models_dev_provider: opencode`（provider + exact record `minimax-m3` 精确命中；relation 一致） | 同上；relation 一致 | context/output = serving(opencode)；serving 记录无 `limit.input` → absence policy：LiteLLM 同维度补缺（input = 1000000，litellm-declared），不回填 canonical | 512000 / 1000000 / 128000 | input：1000000（litellm-declared，无比较对象不一致）；output 131072 vs 128000 → discrepancy | known-empty（`[]`） | LiteLLM 组件优先，cacheRead = OpenCode 0.06 | configured；proof = canonical + serving(opencode) |
| **D** A + `litellm_params.max_input_tokens 900000`（operator configuration，D7a 证明集为空） | 同 A | 同 A（无任何收窄） | 1048576 / 1000000 / 512000 | `litellm_params.max_input_tokens` 只进诊断，不收窄、不产生 discrepancy；descriptive 差异同 A | unknown | 同 A | configured；enforcement fingerprint（空）不因该键变化失效；**若未来该键通过 D7a 晋升，本行按新 delta 重算** |

## Risks / Trade-offs

- **[值变保守]** kimi-k3 output 1048576 → 131072、deepseek 393216 → 384000。→ 只有 **serving provider 与 exact serving record（SKU）都被证明**（声明 `models_dev_provider` 且 wire id 精确命中该 provider 的 serving record）才恢复 393216；仅声明 provider 而无 exact SKU（DeepSeek 真实 catalog 只有 relation-only SKU）仍是 384000。README/诊断说明。
- **[推理档位消失]** live 当前有 13 个模型发布可选档位。serving 未证明时全部变为 levels unknown。→ 声明 `models_dev_provider`；不放松证据规则。
- **[DeepSeek 输出值变化（显式确认）]** `deepseek-v4.1-flash`/`deepseek-v4-pro` 从 serving SKU 的 393216 变为 canonical 384000（serving 未证明）。**provider 声明本身不足以恢复 393216**：deepseek 真实 catalog 只有 relation-only SKU（`deepseek-flash` 等），仅声明 `models_dev_provider: deepseek` 仍是 384000；只有 provider 声明 **且** wire id 精确命中某条 SKU record（如 `custom_llm_provider: deepseek` + route `deepseek/deepseek-flash`）才采用该 SKU 的 393216。这与前一阶段保护的 393216 regression 是明确的用户可见行为变化，按 acceptance R4/R4b 双场景固定，写入 migration/release notes；任何人不得把其中一侧行为改回旧值而不走 delta。
- **[无任何 proven enforcement]** D7a 证明集为空：**非价格** `litellm_params` 键只进诊断，不收窄任何字段（包括 `max_input_tokens`）；7 个价格键按 Operator-Declared Pricing 独立处理（D8）。已声明 enforcement 键的运维者会看到行为变化（不再收窄）；README 说明晋升门槛与未来 delta 路径。
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
4. 行为变化清单（README/release notes 必须逐条说明）：DeepSeek 384000/393216（R4/R4b/R4c——恢复 393216 需要 provider + exact SKU 双重证明；A/B/C 唯一差异是 serving SKU proof）、推理档位 unknown、无 proven enforcement、kimi-k3 output 131072、LiteLLM-only 无 context 即 withheld、serving 缺字段不回填 canonical（允许同维度 LiteLLM 补缺，否则 unknown）。

## Downstream impact

| 仓库 | 范围 |
|---|---|
| Core | 新增 `catalog-input.ts`、`wire-id.ts`、`resolve.ts`；重写 `modelsdev.ts` identity/serving（删除 relation fan-out 选择、rule B、OpenCode/OpenRouter/unique 发布供给、`resolveInheritedRecord`）；`evidence.ts` 维度描述符与 basis；`capabilities.ts`/`build.ts` 改为 resolver 投影；`publication.ts` assessment 派生与 LKG v8 proof；`diagnostics.ts` 新字段；`src/index.ts`；真实 schema fixtures；`scripts/audit-modelsdev-catalog.ts`；README、`docs/testing-standard.md` §8、`docs/decisions.md` |
| Pi | `src/net/fetch.ts` URL/形状；LKG 存储 v8（v7 忽略并重捕获）；`/litellm-diagnostics` 展示 canonical identity / serving status / 档位状态 / operator-configuration 键 / 诊断候选；fake catalog fixture；Real Pi E2E；README |
| OpenCode | `src/net/fetch.ts` 默认 URL、`modelsDevUrl` 文档；LKG v8；diagnostics/TUI 字段；fake catalog；Real OpenCode E2E；README |

## Open Questions

- **Q1 — 已关闭（Revision 2，Revision 3/4 收紧）**：serving 未证明时不发布任何档位。档位证据只有已证明 serving 记录的 `reasoning_options`。`litellm_params.reasoning_effort` 是 operator configuration（请求可覆盖），不是 pin，也不提供档位；LiteLLM 现有字段中没有任何可声明「可选档位集合」且通过 D7a 晋升门槛的键。
- **Q2（低优先级，保留）**：是否继续支持 provider-only（`api.json` 形状）的自建镜像？本设计默认按 D2 fail closed（不做 canonical 解析，LiteLLM-only 与 LKG 仍可用）；若需兼容，只能以诊断提示改用 catalog 形状，不能恢复任何 provider 记录供给。
