# Audit: models.dev consumption（2026-10-07）

基线：Core `61f48948`、Pi `2f821818`、OpenCode `6c7818a0`；models.dev repo `sst/models.dev@450aa1d5`（2026-10-07 11:29 UTC），live `api.json` / `models.json` / `catalog.json` 于 2026-10-07 13:11 UTC 抓取。量化脚本保存在被忽略的 workspace `.tmp/audit/`（实施时迁入 `scripts/audit-modelsdev-catalog.ts`，见 tasks）。所有数字均来自真实 catalog，未使用 fixture。

## 1. models.dev 当前数据模型（已核实）

| 层 | 来源 | 内容 | 证据 |
|---|---|---|---|
| canonical registry | `models.json` / `catalog.models` | 445 个 `<lab>/<model>`（44 个 lab）；字段只有 name/description/family/attachment/reasoning/tool_call/structured_output/temperature/knowledge/release_date/last_updated/modalities/open_weights/limit/license/links/weights/benchmarks | `packages/core/src/schema.ts` `ModelMetadata`（strict）；README「Provider-agnostic model metadata」 |
| serving records | `api.json` / `catalog.providers` | 226 provider、8418 记录；必含 `cost`、`reasoning_options`（`reasoning=true` 时必填）、`limit.output`；可含 `provider`(npm/api/shape/body/headers)、`interleaved`、`status`、`experimental` | schema `ModelBase` + `refineModel`；AGENTS.md「Provider-specific fields belong on the provider model」 |
| relation | 仅 `canonical_model_id` | 只在 provider TOML 使用 `base_model` 时生成；值为 registry key；`base_model` 本身不进生成 JSON | `generate.ts` `canonical_model_id: baseModel.data.base_model` |
| merge 语义 | 生成期 | `mergeDeep(inheritable(base), overrides)`；**provider 字段赢**；`base_model_omit` 可删继承字段 | `generate.ts` `mergeBaseModel` |
| first-party | 约定 | provider **是** lab 时允许 inline 定义（无 `base_model` → 无 `canonical_model_id`） | AGENTS.md「Exceptions (full inline definition allowed)」 |
| snapshot | `catalog.json` | `{providers, models}`；同一时刻抓取的数据等价：`catalog.providers` 与 `api.json` 数据等价、`catalog.models` 与 `models.json` 数据等价（各自 `JSON.stringify` 比对相等）；三个响应本身形状不同，并非字节相同 | 本次抓取比对 |
| 不存在的字段 | — | `aliases`、`inherits`、`equivalent_to`、`equivalents`、`base_model` 在 8418 条记录中出现 **0** 次 | 本次统计 |

结论：README 的分层（models.json = 内禀，api.json = serving，catalog.json = 同 snapshot 组合）**成立**。

## 2. Catalogue-wide 统计

| 指标 | 值 |
|---|---|
| canonical 模型 | 445（44 lab） |
| 被 ≥1 serving 记录 relation 引用 | 419；从未被引用 26 |
| serving 记录带 `canonical_model_id` | 5329 / 8418（63.3%），悬空引用 0 |
| 裸 canonical ID 唯一性（大小写不敏感，含 `.`/`_` 折叠） | 445/445 唯一，0 冲突 |
| api.json 裸记录 ID 的 provider 重数 | 1 个 provider：1663；2–3：488；4–10：219；>10：166（即 34% 的裸 ID 多重） |
| lab namespace 无同名 provider | 20 个 lab（bytedance-seed、tencent、meituan、amazon、microsoft…） |
| canonical ↔ first-party 记录 | 经 relation 117；inline 同 ID 无 relation 153；无 first-party 记录 175 |
| first-party 记录 ID ≠ canonical tail（serving SKU 别名） | 38（如 `deepseek/deepseek-flash → deepseek-v4.1-flash`、`deepseek/deepseek-v4-pro → deepseek-v4-pro-0813`） |
| 一个 canonical 有 >1 条 first-party relation 记录 | 8（如 `deepseek-v4.1-flash`：`deepseek-v4-flash-vision-exp`、`deepseek-flash`、`deepseek-v4-flash`） |
| registry 有 `limit.input` | 38 / 445（34 条 input < context）；serving 记录有 `limit.input` 1469 条 |

**provider override 频率**（5329 条 relation 记录相对其 canonical）：

| 字段 | 覆盖次数 | 比例 |
|---|---|---|
| name | 1572 | 29.5% |
| limit.output | 1463 | 27.5% |
| limit.context | 1417 | 26.6% |
| modalities.input | 939 | 17.6% |
| structured_output | 311 | 5.8% |
| tool_call | 174 | 3.3% |
| attachment | 172 | 3.2% |
| release_date | 139 | 2.6% |
| reasoning | 133 | 2.5% |
| limit.input / temperature | 101 / 102 | 1.9% |

first-party relation 记录（127 条）也覆盖：limit.output 20、limit.context 16、modalities.input 7——**first-party ≠ intrinsic**。

**provider-only 字段**：reasoning=true 的 6212 条记录全部有 `reasoning_options`；7973 条有 `cost`。281 个有 reasoning 的 canonical 中 **218 个**跨 provider `reasoning_options` 不一致（如 `xiaomi/mimo-v2.6-pro` 8 种、`tencent/hy3` 8 种）。

**变体**：230 条 `-free`/`:free`/`-fast`/`:thinking`/`-latest`/`-lite`/`-nitro` 等记录 relation 指向非变体 canonical，其中 126 条 limits ≠ canonical（`:thinking` 57、`-fast` 59、`:free` 40、`-latest` 28、`-free` 20）。reseller：OpenRouter 389 条中 105 条 relation 记录 limits ≠ canonical；OpenCode 118 条中 9 条。

**identity 矛盾**：23 条记录的裸 ID 命中 registry 模型 X 但 `canonical_model_id` 指向 Y，其中 9 条内禀事实实质不同（如 `deepseek/deepseek-v4-flash → deepseek/deepseek-v4.1-flash`），14 条实质等价（如 `deepseek-v4-pro → deepseek-v4-pro-0813`）。

## 3. 当前规则对整个 registry 的模拟

对 445 个 canonical 模型构造 LiteLLM deployment 形态，跑 `main@61f4894` 的 `assessModelConfiguration` / `buildModelSpecs` / `buildPublicationResult`，catalog = live `api.json`：

| 形态 | configured | withheld（canonical 明明存在） | reseller/unique 被选 | 变体记录被选 | 发布 context≠canonical | 发布 output≠canonical | 价格来自未证明 serving |
|---|---|---|---|---|---|---|---|
| S1 裸路由，无 LiteLLM facts | 298 | 147（33.0%） | 192 | 27 | 63 | 78 | 78 |
| S2 裸路由 + facts == canonical | 211 | **234（52.6%）** | 192 | 27 | 12 | 17 | 78 |
| S3 `openai/` 代理路由 + base_model + facts==canonical | 218 | 227（51.0%） | 161 | 29 | 12 | 17 | 111 |
| S4 `lab/model` 限定路由 + facts==canonical | 300 | 145（32.6%） | 87 | 38 | 18 | 21 | 224 |
| S6 `openai/` + 网关 api_base，无 facts（仅统计 publishable 分区） | 300 | — | 154（publishable 内） | — | — | — | 110 |

- S2 的 withheld 主体：123 `ambiguous`（裸 ID 在 api.json 多 provider 命中、无 first-party relation，例如全部 bytedance-seed）、97 `invalid-metadata`（fallback-serving 与 LiteLLM descriptive 同级冲突）。canonical registry 对这 445 个裸 ID **全部唯一**，即这些 withheld 全部可确定性消除。
- S2 中 84 个 withheld 模型的 `buildModelSpecs` limits 与 assessment 不一致（diagnostics 展示 B、gate 判断 A）；publishable 分区内当前为 0（真实数据只有 `canonical_model_id`，继承几乎不触发），属潜伏漂移。

## 4. Live endpoint 回归（17 模型）

| 模型 | 当前结果 | 选中记录 | 当前发布值 | canonical（models.json） | 问题 |
|---|---|---|---|---|---|
| mimo-v2.6-pro | invalid-metadata | openrouter-fallback `openrouter/xiaomi/mimo-v2.6-pro` | — | 1048576/131072 | canonical 存在却 withheld；OpenRouter 1050000 vs LiteLLM `max_input_tokens` 1048576 跨维度比较 |
| mimo-v2.6-flash | invalid-metadata | opencode-fallback `opencode/mimo-v2.6-flash-free` | — | 1048576/131072 | free 变体经 relation 被选 |
| minimax-m3 | invalid-metadata | opencode-fallback `opencode/minimax-m3` | — | 1048576/512000 | reseller serving 当内禀 |
| deepseek-v4.1-flash | configured | canonical-original `deepseek/deepseek-flash` | 1000000/393216 | 1000000/384000 | first-party serving SKU override 当内禀；SKU 由最短 ID tie-break 决定 |
| deepseek-v4-pro | configured | canonical-original `deepseek/deepseek-v4-pro` | 1000000/393216 | 1000000/384000 | 同上（该记录 canonical 指向 `-0813`） |
| kimi-k3 | configured | canonical-original `moonshotai/kimi-k3` | 1048576/**1048576** | 1048576/131072 | first-party serving output 被发布为内禀 |
| kimi-k2.7-code | configured | opencode-fallback `opencode/minimax-m2.7` | 204800/131072 | `minimax/MiniMax-M2.7` 204800/131072 | 结果碰巧正确，但走 reseller；base_model 别名语义正确 |
| hy4-preview | configured | openrouter-fallback | 1048576/64000，档位 `none,low,high` | `tencent/hy4-preview` 1024000/64000 | reseller limit 与 reseller 推理档位进入 ModelSpec |
| gpt-5.6-sol | configured | canonical-original `openai/gpt-5.6` | 1050000/128000 | 同 | 选中 `gpt-5.6`（relation 指向 `-sol`）而非精确同名 `gpt-5.6-sol`（最短 ID tie-break） |
| gpt-6-*/gpt-5.6-* | configured | canonical-original | 1050000/128000，6 档 effort，first-party 价格 | input 922000 | LiteLLM `max_input_tokens` 922000 被当 context 差异报告「已裁决差异」（伪 discrepancy）；serving 未证明却用 OpenAI 档位/价格（经网关） |
| glm-5.3 / glm-5.3-flash | configured | canonical-original（relation） | 与 canonical 一致 | — | 正确 |

## 5. LiteLLM identity / provider 证据语义（按真实语义判定）

| 字段 | 真实语义 | 可否作证据 |
|---|---|---|
| `model_info.base_model` | 运维者声明的上游模型 | **identity 证据**（限定形式精确命中 registry 或裸形式唯一命中） |
| `litellm_params.model` | `<litellm-adapter>/<wire-model-id>`；前缀选择 LiteLLM adapter | 剥离 adapter 段后的 wire id 是 identity 候选；**前缀不是 lab namespace，也不是 serving provider** |
| `litellm_params.custom_llm_provider` | LiteLLM adapter（如 `openai` = OpenAI-compatible 协议） | 不是 identity/serving 证据 |
| `litellm_params.api_base` | 上游地址；常位于 credential 中、`/model/info` 不可见（live 20 条仅 1 条可见） | 不能作为确定性证据 |
| `model_info.litellm_provider` / `model_info.key` | LiteLLM 内部 cost-map 推导结果（live 出现 `xiaomi_mimo/mimo-v2.6-pro`、`openai/minimax-m3`） | 派生值，非运维者声明，不作证据 |
| `litellm_credential_name` | 运维者命名的凭据标签 | 不透明，不作证据 |
| `model_info.models_dev_provider` | 本项目约定的显式声明 | **唯一 serving provider 证据** |
| `model_info.max_input_tokens` | input capacity | 只与 input 维度比较 |
| `model_info.supports_{none,minimal,xhigh,max}_reasoning_effort` | LiteLLM cost-map 对单个档的推导描述（live GPT 7 个模型有，且只覆盖少数档） | 不是 endpoint 声明；只诊断 |
| `model_info.supported_openai_params` | 推导值（live 部分含 `reasoning_effort`） | 只诊断 |
| `litellm_params.allowed_openai_params` | 运维者允许透传的参数（live deepseek/kimi-k3/glm/hy4 含 `reasoning_effort`） | 只证明参数会被转发，不证明合法值集合；不生成档位 |
| `litellm_params.reasoning_effort` | 请求合并序 `{**litellm_params, ..., **kwargs}`（`_acompletion` L3877-3882）+ L2582 主动让位 → 请求可覆盖 | **operator configuration**：不产生档位/pin/收窄；只进诊断 |
| `litellm_params.max_input_tokens` / `max_tokens` / `supports_*=false` / modality flags | rev3 曾误判 hard-enforced；Revision 4 逐行复核：admission 门读 resolved `model_info`（`get_router_model_info` L11091），`Deployment.__init__` 只镜像 7 个价格键（types/router.py L750-753），`supports_factory` 读 cost-map（utils.py L2801） | **operator configuration**：全部不收窄（D7a 空证明集）；晋升需 delta |

LiteLLM 没有任何可声明「endpoint 接受的可选档位集合」的字段。当前实现漏用：`litellm_params.reasoning_effort`（见 P1-7）。误用：rule B 把 `openai/` 等 adapter 前缀当 namespace（S3/S6 共 111/110 条价格因此来自 first-party 记录）。

## 6. Findings

### P0（高概率 × 错误配置或大面积误 withheld）

**P0-1 canonical registry 缺失，identity 与 provider-record selection 耦合**
- 触发：任何未被 first-party relation 覆盖的模型（裸路由、网关、私有部署）。
- 概率：极高（S1 33.0%、S2 52.6%、S4 32.6%；live 3/17）。
- 影响：可靠 models.dev 数据存在却 withheld；或选中 reseller 记录。
- 代码路径：adapter `src/net/fetch.ts` `MODELS_DEV_URL = api.json`；Core `selectModelsDevRecordDetailed` → `findMatchesByRelation` → `selectTrustedRecord`。
- 统一修复点：`catalog.json` + `resolveCanonicalIdentity()`（registry 精确匹配）。

**P0-2 serving facts 在 serving 未证明时进入 ModelSpec**
- 触发：`canonical-original` / fallback / unique 记录被选中，而运维者未声明 serving provider。
- 概率：极高（S4 224 条价格来自未证明 serving；live 全部 gpt/kimi/glm/deepseek）。
- 影响：错误 limits（kimi-k3 output 1048576；gemini-omni-flash-preview 131072 vs 1048576；claude-sonnet-4-5 1000000 vs 200000，后者可能是合法 first-party serving override，但 serving 未证明时不得当内禀）、错误推理档位（S1 34 个与 first-party 不同；hy4-preview 发布 OpenRouter 档位）、错误价格。
- 代码路径：`capabilities.ts` `mapCapabilities`（`modelsDevLimit`/`modelsDevCost`）、`modelsdev.ts` `buildVariants`、`canUseSelectedModelsDevPrice`。
- 统一修复点：fact-class 分层 + `ServingResolution`（未证明时只用 intrinsic）。

**P0-3 relation fan-out 选中变体/别名记录**
- 触发：canonical 被多条记录 relation 引用（含 `-free`/`:thinking`/`-fast`/serving SKU）。
- 概率：高（230 条变体记录，126 条 limits 不同；每形态 27–38 个被选；live mimo-v2.6-flash）。
- 影响：静默错误配置或误 withheld；serving SKU 由「最短 ID」决定（gpt-5.6-sol → gpt-5.6；deepseek-v4.1-flash → deepseek-flash）。
- 代码路径：`findMatchesByRelation`、`resolveSingleProviderMatches`、`canonicalOriginalRecord` 排序。
- 统一修复点：serving 记录只按「已证明 provider 内的精确 wire id」选择；relation 只用于 identity 与诊断；未证明的同名精确记录也只进诊断（design D5）。

**P0-4 LiteLLM adapter 前缀被当作 lab namespace（rule B）**
- 触发：`openai/<model>`、`custom_llm_provider` 指向的路由（OpenAI-compatible 网关极常见）。
- 概率：高（live 20/20 deployment 为 `custom_llm_provider=openai`）。
- 影响：非 OpenAI 模型无法证明 original；OpenAI 名字的模型被当成 OpenAI first-party serving（价格、档位、serving limit）。
- 代码路径：`deploymentQualifiedNamespaces`、`canonicalNamespaceFor`（PR #30 rule B）。
- 统一修复点：wire-id 解析（只产出查找键，无证明力）与 registry 证明正式分离（design D3.1/D3.2）；serving 只来自显式声明。

### P1

**P1-1 limit 维度错配**：LiteLLM `max_input_tokens` 与 total context 比较（`NUMERIC_FIELD_DESCRIPTORS.context.descriptiveKeys = ["max_input_tokens"]`）。live gpt-6/5.6 5 个伪「已裁决差异」，mimo-v2.6-pro 冲突部分来源于此。违反 testing-standard §8「Dimensions are never mixed」。修复：effective-limit 代数按维度。

**P1-2 双流水线**：`buildModelSpecs/mapCapabilities` 与 `assessModelConfiguration` 各自解析；继承只在 assessment；modalities/tools 规则重复实现。S2 84 个 withheld 模型 diagnostics 与 gate 不一致；LKG seeding 依赖 `validateCapturedPublication` 的 spec==captured 比对，一旦漂移会被 `catch {}` 静默吞掉而失去 outage 保护。修复：single resolver。

**P1-3 canonical/provider 矛盾无规则**：23 条（9 条实质不同，集中在 DeepSeek）。修复：identity 证据优先级 + 实质等价判定。

**P1-4 reasoning 档位来源无 authority**：`buildVariants` 直接读选中记录；218/281 个 canonical 跨 provider 档位不一致；models.json 没有 `reasoning_options`。修复：档位只来自已证明 serving 记录或 `litellm_params` 运维者显式配置（design D7，Q1 已关闭）。

**P1-5 LKG 绑定 serving provider**：v7 `providerID`/`selectionSource` 与 identity 绑在一起；canonical identity 不变但 serving 记录变化即失效，反之 fallback 记录在 identity 正确时永不恢复。修复：schema 8。

**P1-7 部署 effort 配置被误当档位证据**：live gpt-6-luna/sol/astra 的 `litellm_params.reasoning_effort`（max/high/low）当前仍按 OpenAI first-party 记录发布 5–6 个可选档位。LiteLLM 源码核实：该键是 operator configuration（请求可覆盖），不产生档位/收窄——正确行为是 serving 未证明时 levels unknown。概率中；影响为静默错误 controls。代码路径：`buildVariants` 只读选中记录。修复：design D7a/D7。

**P1-6 规范漂移**：`discovery-quality`「reasoning resolution」仍写「LiteLLM declaration determines support」，与 `publication`/testing-standard「canonical intrinsic 高权威」矛盾。修复：本 change 一并 MODIFIED。

### P2

**P2-1 `resolveInheritedRecord` 从错误数据层继承**：按 `canonical_model_id` 去 **provider** 层找同名记录，可能把 first-party 的 `cost`/`reasoning_options` 继承给 reseller；真实数据上几乎不触发（S1–S4 仅 1 次 reasoning_options）。修复：删除，intrinsic 只来自 registry。

**P2-2 fixture 使用不存在的 schema 字段**：`aliases`/`inherits`/`equivalent_to`/`equivalents` 在真实数据中出现 0 次，identity graph 与大量测试基于虚构形状。修复：fixtures 改为真实 schema 子集；这些字段保持惰性（不报错、不作证据）。

**P2-3 tie-break 决定 serving SKU 与价格**：`publicationCriticalFacts` 不含 `cost`，等价记录间价格可不同。修复：随 P0-3 一并消失。

**P2-4 `stripRoutePrefix` 只剥一段**：`openrouter/deepseek/deepseek-chat` 剥成 `deepseek/deepseek-chat`，恰好可作 registry 限定命中；但 `bedrock/converse/...` 等多段 adapter 路由会产生无意义候选。修复：wire id 解析规则化（只有剥离后精确命中 registry 才算 qualified）。

**P2-5 type filter**：默认 catalog 排除 `type=decision`（445 vs 448）；对话发现无影响，记录为已知行为。

## 7. Revision 2/3 复核（第三方评审）

**Revision 2**
- registry 字段可选性实测：445 条中 `limit.output` 缺 9、`limit.input` 缺 407、`structured_output` 缺 264；`modalities`/`reasoning`/`tool_call`/`release_date` 当前 0 缺（schema 允许缺省）→ 需要字段级 matrix（design D6）。
- 未证明同名 reseller 记录取消发布供给：live 17 模型影响 0（唯一 fallback 的 hy4-preview 已在 registry；kimi-k2.7-code 经 base_model 解析）。
- live 当前发布可选档位的 13 个模型在新规则下全部 levels unknown（除非声明 `models_dev_provider`）。

**Revision 3（LiteLLM 源码核实，`BerriAI/litellm@736ff14f`）**
- `litellm_params` 合并序 `{**litellm_params, ..., **kwargs}`（`router.py` L3877）证明请求可覆盖 deployment 参数 → `litellm_params` 不整体等于 hard constraint；逐键 enforcement 矩阵见 design D7a。
- rev3 曾把 `max_input_tokens`（L12954-12973）与 `supports_*=false`/modality flags 归为 hard-enforced——**Revision 4 复核确认是误判**（门读的是 resolved `model_info`，非 `litellm_params` 同名键），已撤销。
- `max_tokens/max_output_tokens/max_completion_tokens` 与 `reasoning_effort` 请求可覆盖，不参与 enforcement。
- live 端点 19/20 deployment 有显式 `custom_llm_provider`（与路由首段一致的 0 条——路由均为裸值；`openai_like/` 一条与首段一致），故 parse 证据在真实数据上可用；裸值路由不受影响。
- `base_model_omit` 真实案例：`providers/requesty/models/hy3.toml` `base_model_omit = ["limit.input"]`；linked serving 记录中 64 条缺 `limit.input` 而 canonical 有 → 「serving 缺字段回填 canonical」会撤销作者显式 omit，已删除该规则。
- canonical 裸 ID 大小写不敏感唯一性维持 445/445；但「qualified 值无条件取尾段」在私有路由（`some-private-provider/foo`）上会误命中，已改为仅裸值或经 `custom_llm_provider` 证据确认 adapter 后才取余串。

**Revision 7（第七轮评审后，最终一致性 patch）**
- `release_date` 优先级统一：resolved serving 记录有则用、缺失不回填 canonical——与 D6 分支算法一致，删除「canonical > serving」的特殊优先级。
- LKG 删除「enforcement fingerprint covers `max_input_tokens`」这种当前空证明集下不可能的 scenario，改为空 fingerprint + 任意 operator-configuration 键变化不失效。
- D3.3 措辞对齐 D4：relation-only 记录可证明 underlying canonical identity（identity 证据资格），但 identity 证据资格 ≠ serving-record 解析。
- 机械清理：deployment evidence 命名、`reasoning_effort` 诊断措辞、R4/R4b/R4c 三场景、tasks 0.9 评审门槛、Risks 的 input 规则完整化。

**Revision 5（第五轮评审，OpenSpec 内部一致性收敛）**
- D7a 作用域与 Price authority 冲突修正：enforcement 矩阵只约束 capability/limit/control facts；`MirroredPricingParams` 7 个价格键独立为 **Operator-Declared Pricing**（源码证明 LiteLLM 显式镜像，types/router.py L750-753），不是 enforcement，也不因「不产生能力事实」而被禁用。
- D6 由四级 fallback 改为**分支算法**：serving record resolved 时按 per-field serving-absence policy（永不回填 canonical，允许同维度 LiteLLM 补缺）；record unresolved 时整组按 serving-unproven 解析。
- MiniMax A/C 的 input 统一为 LiteLLM 同维度补缺（1000000，litellm-declared），design/spec/acceptance 三处一致。
- LKG proof 改 `deploymentEvidence` + `identityKind`（canonical / litellm-only / serving-only），`canonicalModelID` 与 `registryDigest` 按 kind 可选——R10b/R10c/R11 的正常发布可合法 capture，gate 与 capture 不漂移。
- serving provider proof 与 serving record proof 拆开：relation-only 命中证明 underlying canonical identity 但不证明 SKU；`serving-record-unresolved` 状态防止 -free/-fast/-thinking/tier 变体经 provider 声明回流。

**Revision 4（第四轮评审，LiteLLM 源码逐行复核）**
- **撤销 rev3 全部 hard-enforced 归类**：`_pre_call_checks` admission 门读 `get_router_model_info()` 解析的 `model_info["max_input_tokens"]`（L12954 → L11091 → L11124：cost-map ∨ discovered ∨ `deployment.model_info`），不读 `litellm_params` 同名键（router.py 直接读取 0 处）；`Deployment.__init__`（types/router.py L750-753）只镜像 `MirroredPricingParams` 的 7 个**价格**键，无能力键镜像；`supports_factory`（utils.py L2801）读 cost-map/provider config。运维者写在 `litellm_params` 的能力键甚至不会进入 LiteLLM 自己的门。
- enforcement 证明集从空开始；晋升门槛 = exact source path + 负向突破测试，经 delta 逐键晋升（design D7a）。
- **删除 `limit.input = context` 推导**：models.dev schema/README 只定义 `input` 为 optional 最大输入 token，无 absent==context consumer contract；64 条 linked serving 记录缺 input（含 requesty/hy3 的 `base_model_omit`），推导会撤销显式删除；input 缺失即 unknown。
- catalog 判定改穷举三态；models-only 归 `unavailable`。
- LKG deployment 证明改 evidence multiset + 持久化 `model_info.id`（live 20/20 有值）。
- DeepSeek 393216→384000 行为变化以 R4/R4b/R4c 三场景显式固定（rev6），并列入 migration notes。
