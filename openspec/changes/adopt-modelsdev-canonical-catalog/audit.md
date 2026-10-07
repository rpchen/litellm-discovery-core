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
| snapshot | `catalog.json` | `{providers, models}`；实测 `catalog.providers === api.json`、`catalog.models === models.json`（逐字节） | 本次抓取比对 |
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
| `model_info.supports_*_reasoning_effort` | LiteLLM 对单个 effort 档的描述 | descriptive，仅作诊断/收窄候选，不足以合成档位集合 |

当前实现漏用：无（base_model 已用）。误用：rule B 把 `openai/` 等 adapter 前缀当 namespace（S3/S6 共 111/110 条价格因此来自 first-party 记录）。

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
- 统一修复点：serving 记录只按「已证明 provider 内的精确 wire id」选择；relation 只用于 identity 与诊断。

**P0-4 LiteLLM adapter 前缀被当作 lab namespace（rule B）**
- 触发：`openai/<model>`、`custom_llm_provider` 指向的路由（OpenAI-compatible 网关极常见）。
- 概率：高（live 20/20 deployment 为 `custom_llm_provider=openai`）。
- 影响：非 OpenAI 模型无法证明 original；OpenAI 名字的模型被当成 OpenAI first-party serving（价格、档位、serving limit）。
- 代码路径：`deploymentQualifiedNamespaces`、`canonicalNamespaceFor`（PR #30 rule B）。
- 统一修复点：wire id 解析剥离 adapter 段；namespace 只来自 registry 精确命中；serving 只来自显式声明。

### P1

**P1-1 limit 维度错配**：LiteLLM `max_input_tokens` 与 total context 比较（`NUMERIC_FIELD_DESCRIPTORS.context.descriptiveKeys = ["max_input_tokens"]`）。live gpt-6/5.6 5 个伪「已裁决差异」，mimo-v2.6-pro 冲突部分来源于此。违反 testing-standard §8「Dimensions are never mixed」。修复：effective-limit 代数按维度。

**P1-2 双流水线**：`buildModelSpecs/mapCapabilities` 与 `assessModelConfiguration` 各自解析；继承只在 assessment；modalities/tools 规则重复实现。S2 84 个 withheld 模型 diagnostics 与 gate 不一致；LKG seeding 依赖 `validateCapturedPublication` 的 spec==captured 比对，一旦漂移会被 `catch {}` 静默吞掉而失去 outage 保护。修复：single resolver。

**P1-3 canonical/provider 矛盾无规则**：23 条（9 条实质不同，集中在 DeepSeek）。修复：identity 证据优先级 + 实质等价判定。

**P1-4 reasoning 档位来源无 authority**：`buildVariants` 直接读选中记录；218/281 个 canonical 跨 provider 档位不一致；models.json 没有 `reasoning_options`。修复：档位只来自已证明 serving 记录（见 Open Questions 关于 lab-default）。

**P1-5 LKG 绑定 serving provider**：v7 `providerID`/`selectionSource` 与 identity 绑在一起；canonical identity 不变但 serving 记录变化即失效，反之 fallback 记录在 identity 正确时永不恢复。修复：schema 8。

**P1-6 规范漂移**：`discovery-quality`「reasoning resolution」仍写「LiteLLM declaration determines support」，与 `publication`/testing-standard「canonical intrinsic 高权威」矛盾。修复：本 change 一并 MODIFIED。

### P2

**P2-1 `resolveInheritedRecord` 从错误数据层继承**：按 `canonical_model_id` 去 **provider** 层找同名记录，可能把 first-party 的 `cost`/`reasoning_options` 继承给 reseller；真实数据上几乎不触发（S1–S4 仅 1 次 reasoning_options）。修复：删除，intrinsic 只来自 registry。

**P2-2 fixture 使用不存在的 schema 字段**：`aliases`/`inherits`/`equivalent_to`/`equivalents` 在真实数据中出现 0 次，identity graph 与大量测试基于虚构形状。修复：fixtures 改为真实 schema 子集；这些字段保持惰性（不报错、不作证据）。

**P2-3 tie-break 决定 serving SKU 与价格**：`publicationCriticalFacts` 不含 `cost`，等价记录间价格可不同。修复：随 P0-3 一并消失。

**P2-4 `stripRoutePrefix` 只剥一段**：`openrouter/deepseek/deepseek-chat` 剥成 `deepseek/deepseek-chat`，恰好可作 registry 限定命中；但 `bedrock/converse/...` 等多段 adapter 路由会产生无意义候选。修复：wire id 解析规则化（只有剥离后精确命中 registry 才算 qualified）。

**P2-5 type filter**：默认 catalog 排除 `type=decision`（445 vs 448）；对话发现无影响，记录为已知行为。
