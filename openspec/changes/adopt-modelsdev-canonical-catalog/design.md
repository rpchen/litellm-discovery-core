# Design: Adopt the models.dev Canonical Catalog

> 状态：DESIGN（冻结待评审，未实施）。本设计取代 `capability-first provider fallback`、rule B（PR #30）与 `canonical-original`-as-authority 的组合模型。审计证据见 `audit.md`，验收矩阵见 `acceptance.md`。

## Context

- 来源：Core `main@61f48948`；Pi `main@2f821818`（provenance `f07951d7`）；OpenCode `main@6c7818a0`。
- models.dev：repo `sst/models.dev@450aa1d5`；`README.md`、`AGENTS.md`、`packages/core/src/{schema,generate}.ts`、`packages/sdk/README.md`、`packages/function/src/worker.ts`；live `api.json`/`models.json`/`catalog.json`（2026-10-07 13:11 UTC）。
- 边界不变：Core 纯函数、无 I/O、无宿主 SDK；adapter 只 fetch/cache/映射/展示，不复制 identity/authority/merge。
- 本 change 只做审计与设计冻结；插件迁移是后续独立 change（见「Downstream impact」）。

## Goals / Non-Goals

**Goals**
1. 一次性对齐 models.dev 的真实三层数据模型。
2. 让「可靠 models.dev 数据存在」的模型确定性地发布正确的内禀事实。
3. 杜绝 reseller/free/fast/thinking/serving-SKU 记录静默污染最终配置。
4. 一个 resolver、一份结果，消灭 gate/spec/diagnostics/LKG 之间的漂移。

**Non-Goals**
- 不实现 serving-provider 自动推断（api_base 主机名、credential 名、LiteLLM adapter 映射表）。
- 不消费 models.dev `provider.{npm,api,shape,body,headers}`、`interleaved`、`experimental.modes`。
- 不改变 protocol 判定、多 endpoint 隔离、refresh coordinator、publication memory/acknowledgement 语义。
- 不处理宿主 contextWindow 与 input capacity 的映射策略（adapter 后续 change，见 Risks）。

## Decisions

### D1 事实分类（Fact classes）

| 类 | 唯一来源 | 用途 |
|---|---|---|
| **Canonical Model Identity** | `catalog.models` 的 key（`<lab>/<model>`） | 内禀事实索引、LKG 身份 |
| **Intrinsic Model Facts** | `catalog.models[id]`：`limit.{context,input,output}`、`modalities`、`tool_call`、`reasoning`、`attachment`、`structured_output`、`temperature`、`release_date`、`last_updated`、`knowledge`、`open_weights`、`family` | 默认 capability 值 |
| **Serving Provider Facts** | `catalog.providers[P].models[r]`：`cost`、`reasoning_options`、`status`、`provider`、`interleaved`、`experimental`，以及对内禀字段的 serving override（limit/modalities/tool_call/reasoning…） | **仅当 serving provider P 被证明**时使用 |
| **Deployment Runtime Constraints** | `litellm_params` 中可证明强制的键（`max_tokens`/`max_output_tokens`/`max_completion_tokens`、`max_input_tokens`、`supports_function_calling`、`supports_reasoning`、modality flags） | 只收窄同维度 |
| **LiteLLM Descriptive** | `model_info.*` | secondary evidence；无 intrinsic/serving 时补缺；否则只产生 discrepancy |

字段归属（冻结）：

| 字段 | 类 | serving 未证明时 | serving 已证明时 |
|---|---|---|---|
| limit.context/input/output | intrinsic（serving 可覆盖） | intrinsic | serving 记录值 |
| modalities | intrinsic（serving 可覆盖） | intrinsic | serving 记录值 |
| tool_call | intrinsic（serving 可覆盖） | intrinsic | serving 记录值 |
| reasoning（是否支持） | intrinsic（serving 可覆盖） | intrinsic | serving 记录值 |
| reasoning_options（档位） | **serving-only** | 未知（见 Open Question Q1） | serving 记录值 |
| cost | **serving-only** | 不使用 | serving 记录值（LiteLLM 显式价格仍优先） |
| release_date / last_updated / knowledge | intrinsic | intrinsic | intrinsic |
| provider request controls / interleaved / status | serving-only | 不使用 | Core 不消费（保留诊断） |

**Canonical identity known ≠ serving provider known。** `canonical-original`、first-party lab、namespace 相等都**不**证明 serving。

### D2 Catalog 输入契约

- 新增 `normalizeModelsDevCatalog(input)` → `{ kind: "complete", models, providers } | { kind: "providers-only", providers } | { kind: "unavailable" }`。
  - `complete`：顶层恰有 `providers`、`models` 两个对象，`models` 的值形如 ModelMetadata（key 含 `/`）。
  - `providers-only`：遗留 `api.json` 形状（provider map）。canonical registry 不可用。
  - `unavailable`：空、非对象、或两者皆不满足。
- `providers-only` 下 **不能证明 canonical 不存在**，因此**不得**走 fallback-serving，也不做 canonical 解析：与 `unavailable` 同等对待——LiteLLM 声明完整的模型按 `litellm-declared` 发布，其余 `metadata-unavailable`（LKG 仍可恢复）。这是 fail-closed，而不是降级为今天的 relation fan-out。
- 所有公共入口（`buildModelSpecs`、`buildPublicationResult`、`diagnoseModelSpecs`、LKG 函数）接受 `unknown` 并内部归一化，签名不变。

### D3 Canonical identity resolution

**每 deployment 的候选**（固定顺序，大小写不敏感，不折叠 `.`/`_`/语义后缀）：
1. `model_info.base_model`（运维者声明的上游身份）
2. `litellm_params.model`（路由）

**每个候选值的解析**（命中即停）：
1. **qualified**：整串 `a/b[/c]` 精确等于某 registry key → proven（`qualified-deployment`）。
2. **qualified-after-adapter**：剥去第一个 `/` 段后的余串精确等于 registry key（如 `openrouter/deepseek/deepseek-chat`）→ proven（`qualified-deployment`）。
3. **bare**：最后一个 `/` 段在 registry 裸 ID 索引中：0 → 下一候选；1 → proven（`registry-unique`）；>1 → **ambiguous，停止**（不得落到后续候选）。

`base_model` 解析成功即决定该 deployment 的 canonical；路由解析结果只作诊断（不同即记 `identity-route-differs`，不阻断——`base_model` 是显式别名声明，如 live `kimi-k2.7-code → minimax/MiniMax-M2.7`）。

**serving relation 证据**（D4 证明 serving 后）：选中 serving 记录的 `canonical_model_id` = C'。
- deployment 未证明 canonical → C' 即 canonical（`serving-relation`）。
- deployment canonical C ≠ C'：比较 `C` 与 `C'` 的内禀 publication-critical facts（limit、modalities、tool_call、reasoning）——实质等价 → 保持 C，记录 `identity-discrepancy`；实质不同 → `ambiguous`（withheld，reason `identity-ambiguous`：canonical/provider contradiction）。
- inline first-party 记录（无 `canonical_model_id`）只有在 `provider == lab(C)` 且 `record id == tail(C)`（大小写不敏感）时视为与 C 一致；否则不提供 identity 证据。

**组级**：沿用现有 `groupIdentityEvidence` 前置门禁（每 deployment 必须有正面证据；`models_dev_provider` 冲突即 conflict）。所有 deployment 的 canonical 必须相同；不同 → conflict（registry key 互异即实质不同）；部分 proven、部分 unproven → `ambiguous`。

**禁止**：`model_name` 参与 identity；family/前缀/子串/邻近型号；relation fan-out（用 `canonical_model_id` 反查「谁指向我」）作为 identity 或 serving 选择；`model_info.key` / `litellm_provider` / `custom_llm_provider` / `api_base` / credential 名作为证据。

裸 ID 规则：`0 → no proof`、`1 → proven`、`>1 → ambiguous / fail closed`。当前 registry 0 冲突（audit §2），规则仍须有负向测试。

### D4 Serving provider resolution

- **proven** 当且仅当组内所有 deployment 声明同一 `models_dev_provider = P`，且 `catalog.providers[P]` 存在。
- **serving 记录选择**（只在 P 内）：
  1. 记录 key/id 精确等于 wire id（raw → 剥 adapter 段 → 最后一段，大小写不敏感）；
  2. 否则 P 内 `canonical_model_id == C` 的记录恰好 1 条，或多条且 serving publication-critical facts（limit、modalities、tool_call、reasoning、reasoning_options、cost）实质等价（确定性取最短 id → localeCompare）；
  3. 多条实质不同 → `serving-ambiguous`：withheld（reason `identity-ambiguous`，fields `serving`）——运维者的声明与 catalog 不能一致解释，不得静默忽略；
  4. 0 条 → `declared-unmatched`：serving facts 未知，按 serving 未证明发布内禀事实，诊断 warning。
- 多 deployment：每个 deployment 选出的 serving 记录 publication-critical facts 必须一致，否则 conflict。
- **unproven**：无声明。此时任何 provider 记录（含 first-party、`canonical-original`）都不提供 serving facts。
- LiteLLM adapter 前缀与 `custom_llm_provider` **永不**证明 serving（OpenAI-compatible 网关是常态，api_base 常不可见）。删除 rule B。

### D5 Fallback（重定义）

> canonical model 已明确存在时，未证明的 reseller record **没有资格**补任何 intrinsic fact，也没有资格提供 operational config（limit、档位、价格）。

Fallback-serving 只在以下条件**全部**满足时可用：
1. catalog `complete`（registry 可用，能证明不存在）；
2. 所有候选在 registry 中 0 命中（未登记/私有模型），且无 serving 声明；
3. 候选记录的 key/id **精确等于** wire id（不经 relation）；
4. 选择：所有精确命中记录实质等价 → 取之；否则 OpenCode 精确命中 → OpenRouter 精确命中 → 其余 → `ambiguous`。

Fallback 值的权威：`fallback-serving`——只补 LiteLLM 未声明的维度；与 LiteLLM descriptive 不同 → unresolved conflict（保留现有规则）；被 runtime constraint 收窄而不冲突；**永不**提供价格、推理档位；**永不**作为 LKG 恢复来源。fallback 记录的 `canonical_model_id` 只作诊断，不反证 identity（变体记录可能指向基础模型，wire id 才说明实际服务对象）。

### D6 Effective values（per dimension）

```
base(dim) = serving-proven ? serving[dim]
          : canonical-proven ? intrinsic[dim]
          : fallback ? fallback[dim]
          : descriptive-aggregate(dim)            // LiteLLM-only private
effective(dim) = min(base(dim), constraint(dim), tierCap(dim)?)
```

- 维度：`context` 只比 total context；`input` 只比 input capacity（`max_input_tokens`、`limit.input`；registry/serving 缺 `limit.input` 时 input 基值 = context）；`output` 只比 output。**禁止跨维度比较**；唯一保留的跨维度规则是 LiteLLM-only（无任何 models.dev 值）时以 `max_input_tokens` 作为 context 的显式文档化 fallback。
- descriptive 值与 base 同维度不同：base 来自 intrinsic/serving-proven → `resolved-discrepancy`；base 来自 fallback-serving → `unresolved-conflict`；base 来自 descriptive → 跨 deployment 不一致即 conflict。
- 跨 deployment 的 descriptive/constraint 显式不一致始终是 conflict（不变）。
- constraint ≥ base 为 no-op；constraint 永不提升值。
- 布尔（tools/reasoning）：`base = serving ?? intrinsic ?? fallback ?? descriptive-tri-state`；`litellm_params` 显式 `false` 收窄；descriptive 相反 → discrepancy（base 为 intrinsic/serving）或 conflict（fallback）。
- modalities：`base` 集合来自 serving/intrinsic 完整列表；`litellm_params` 显式 `false` 移除；无列表时沿用 sparse-flag 规则。

### D7 Reasoning controls

- `reasoning`（是否支持）是内禀事实（D6 布尔规则）。
- `reasoning_options`（可选档位）是 serving-only：只来自已证明的 serving 记录；`levelsKnown = true`。
- serving 未证明或 fallback：`levelsKnown = false`、`variants = []`、诊断说明「serving provider 未证明，推理档位未知」（档位不是 gate 字段，不影响 publishable）。Q1 讨论是否允许 lab-default。
- `reasoning = supported` 且档位已知为空（如 `[{type:"toggle"}]` 只产生 0 个 effort 变体）合法：supported + 无可选档位。
- LiteLLM `supports_{none,minimal,low,xhigh,max}_reasoning_effort` 为 descriptive；只进诊断，不合成档位集合。

### D8 Price

1. LiteLLM 显式 per-token 价格（多 deployment 取最高）——始终优先；
2. 已证明 serving 记录的 `cost`；
3. 否则未知（0）。
intrinsic 无价格；`canonical-original`/first-party/fallback 记录在 serving 未证明时永不提供价格。（行为变化：explicit-provider 无 relation 的记录现在**可**提供价格，因为运维者声明即 serving 证明。）

### D9 Single resolver

```ts
resolveModel(group, catalog: NormalizedCatalog, options): ResolvedModel
interface ResolvedModel {
  group; protocol
  identity: { status: "proven"|"unproven"|"ambiguous"|"conflict"; canonicalModelID?; evidence: "qualified-deployment"|"registry-unique"|"serving-relation"|"none"; discrepancy?; reason? }
  serving: { status: "declared"|"declared-unmatched"|"serving-ambiguous"|"unproven"|"fallback"; providerID?; recordID?; reason? }
  fields: { context; input; output; tools; reasoning; inputModalities; outputModalities; levels; price; release }  // 每项 FieldResolution + provenance
  status: ModelConfigurationStatus; publishable; reasons; discrepancies; conflicts
  authority: "canonical-intrinsic"|"serving-declared"|"litellm-declared"|"fallback-serving"   // LKG 恢复资格
}
toModelSpec(resolved): ModelSpec          // 唯一 ModelSpec 构造器
```

不变量：
- `buildModelSpecs = groups.map(resolveModel).map(toModelSpec)`；`buildPublicationResult` / `assessModelConfiguration` / `diagnoseModelSpecs` / `createLastKnownGoodEntry` / `validateLastKnownGood` 全部消费同一 `ResolvedModel`。
- publishable entry 的 `spec` 恒等于 `toModelSpec(resolved)`；captured verdict 由同一 resolved 派生（消灭 LKG seeding 静默失败）。
- 删除 `mapCapabilities` 的独立解析（保留为 `toModelSpec` 的内部投影或移除导出，见 tasks）；删除 `resolveInheritedRecord` 的跨 provider 字段继承（models.dev 生成期已完成 base_model merge；intrinsic 只来自 registry）。
- `assessModelConfiguration` 返回值形状保持兼容（新增 `identity.canonicalModelID`、`serving`），旧 `identity.selected` 保留为「serving 记录（若有）」的观测字段。

### D10 LKG schema 8

- `PUBLICATION_SCHEMA_VERSION = 8`。持久形状：

```ts
interface LastKnownGoodEntryV8 {
  schemaVersion: 8; modelName; stableIdentity
  canonical: { modelID?: string; evidence: "qualified-deployment"|"registry-unique"|"serving-relation"|"none" }
  serving: { status: "declared"|"declared-unmatched"|"unproven"|"fallback"; providerID?; recordID? }
  authority: "canonical-intrinsic"|"serving-declared"|"litellm-declared"|"fallback-serving"
  fetchedAt; fetchedAtEpochMs; spec; captured; provenanceDetail
}
```

- 恢复资格（metadata outage）：`canonical-intrinsic` 与 `litellm-declared` 在 stableIdentity 不变时可恢复；`serving-declared` 还要求 live deployment 仍声明同一 `models_dev_provider`；`fallback-serving` 永不恢复。
- identity 与 serving 解耦：serving 未证明的 canonical entry 不因 provider 记录变化而失效；live catalog 可用时以 `resolveModel` 结果做 like-for-like 冲突检查（canonical id、serving 状态/provider、内禀/serving 值、runtime constraint）。
- v≤7（含缺字段/未知 authority）一律 fail closed（不迁移、不推断）；下一轮 live 成功即重新捕获。

### D11 Data fetching

- adapter 默认 URL：`https://models.dev/catalog.json`（单请求，`providers` 与 `models` 同 snapshot、同 TTL epoch、同 failure domain）；大小 5.74 MB vs `api.json` 5.33 MB（+7.7%），现有 60 s 超时与 6 h TTL / 60 s retry 保持。
- adapter 只 fetch/cache 原始 JSON 并交给 Core；形状校验、registry 可用性、identity、authority、merge 全在 Core。
- 不并行请求 `models.json` + `api.json`（两个 epoch 会制造跨 snapshot 组合）。
- OpenCode `modelsDevUrl` 覆盖：指向 catalog 形状镜像；遗留 provider-only 镜像由 Core 判为 `providers-only` 并 fail closed（见 Q2）。

## MiniMax-M3 决策表（冻结）

输入：canonical `minimax/MiniMax-M3` = context 1048576 / output 512000（无 `limit.input`）；first-party serving `minimax/MiniMax-M3` = 1000000 / 512000（inline，无 relation）；third-party serving `opencode/minimax-m3` = 512000 / 128000（`canonical_model_id = minimax/MiniMax-M3`）；LiteLLM descriptive `max_input_tokens` 1000000、`max_output_tokens` 131072；deployment `base_model = minimax-m3`。

| 情形 | canonical identity | intrinsic source | serving override | effective context / input / output | discrepancy / conflict | publishability |
|---|---|---|---|---|---|---|
| **A** serving 未证明 | `minimax/MiniMax-M3`（registry-unique，经 base_model） | models.json | 无 | 1048576 / 1048576 / 512000 | input：LiteLLM 1000000 vs 1048576 → resolved discrepancy；output：131072 vs 512000 → resolved discrepancy；无 conflict | `configured`；LKG authority `canonical-intrinsic`；价格只用 LiteLLM 显式；档位未知 |
| **B** serving = MiniMax（`models_dev_provider: minimax`） | 同上；first-party inline 记录 provider==lab、id==tail → 一致 | models.json | `minimax/MiniMax-M3`：context 1000000、output 512000 | 1000000 / 1000000 / 512000 | context：serving override（provenance，不是 discrepancy）；input 与 LiteLLM 一致；output：131072 vs 512000 → resolved discrepancy | `configured`；authority `serving-declared`；档位 `[toggle]` → 0 个 effort 变体；价格 LiteLLM 优先，否则 MiniMax cost |
| **C** serving = 第三方（`models_dev_provider: opencode`） | 同上；serving 记录 `canonical_model_id` 一致 | models.json | `opencode/minimax-m3`（wire id 精确命中）：512000 / 128000 | 512000 / 512000 / 128000 | input：1000000 vs 512000 → resolved discrepancy；output：131072 vs 128000 → resolved discrepancy | `configured`；authority `serving-declared`；价格 LiteLLM 优先，否则 OpenCode cost；档位来自 OpenCode 记录 |
| **D** A + `litellm_params.max_tokens = 65536`、`max_input_tokens = 900000` | 同 A | models.json | 无（B/C 时按各自 base） | 1048576 / 900000 / 65536 | constraint-narrowed（不是 discrepancy/conflict）；descriptive 差异照 A 记录 | `configured`；若 constraint ≥ base 则 no-op；restored LKG 若 constraint 变化 → fail closed |

## Risks / Trade-offs

- **[行为变化：值变保守]** kimi-k3 output 1048576 → 131072、deepseek 393216 → 384000：serving 未证明时只用内禀值。→ 运维者声明 `models_dev_provider` 即恢复 serving 值；README/诊断说明。
- **[推理档位消失]** live 9 个 GPT 模型的 effort 档位在 serving 未证明时变为未知。→ Q1。
- **[schema 8 一次性 fail closed]** 升级后若首轮恰逢 models.dev outage，旧 LKG 不恢复。→ 已有 fail-closed 政策；下一轮 live 自动重捕获；release notes 说明。
- **[providers-only 镜像]** 自建 provider-only 镜像的用户 canonical 模型被 withheld。→ Q2；诊断明确提示改用 catalog 形状。
- **[contextWindow vs input capacity]** `max_input_tokens` constraint 只收窄 input，宿主若只读 context 可能超发。→ adapter 后续 change（不在本 change）。
- **[registry 改名]** models.dev 改 key 会让 canonical identity 变化 → LKG 按 identity 变化 fail closed（期望行为）。

## Migration Plan

1. Core：本 change 实施（tasks §1–§6），PR → main，产出稳定 SHA。
2. Pi、OpenCode：各自 OpenSpec change（引用本 change）→ `build:dist` 取同一 Core SHA → URL 改 `catalog.json`、LKG v8、诊断字段 → 真实宿主 E2E → PR。
3. 回滚：adapter 回退到旧 dist 即恢复旧行为；v8 entry 被旧版视为 schema-incompatible（fail closed，安全）。

## Downstream impact

| 仓库 | 范围 |
|---|---|
| Core | 新增 `catalog-input.ts`、`resolve.ts`；重写 `modelsdev.ts` 的 identity/serving 选择（删除 relation fan-out 选择、rule B、`resolveInheritedRecord` 字段继承、legacy alias/inherits/equivalent 依赖保持惰性）；`evidence.ts` 维度描述符；`capabilities.ts`/`build.ts` 改为 resolver 投影；`publication.ts` assessment 派生与 LKG v8；`diagnostics.ts` 新字段（canonicalModelID、identity evidence、serving status）；`src/index.ts` 导出；fixtures 改真实 schema；`scripts/audit-modelsdev-catalog.ts`；README、`docs/testing-standard.md` §8、`docs/decisions.md` |
| Pi | `src/net/fetch.ts` URL/形状；LKG 存储 v8（v7 忽略并重捕获）；`/litellm-diagnostics` 展示 canonical identity / serving status / 档位未知原因；fake models.dev fixture 改 catalog 形状；Real Pi E2E；README（行为变化与 `models_dev_provider` 用法） |
| OpenCode | `src/net/fetch.ts` 默认 URL、`modelsDevUrl` 文档；LKG v8；diagnostics/TUI 字段；fake catalog；Real OpenCode E2E；README |

## Open Questions

- **Q1（产品决策）serving 未证明时，是否发布 lab-default 推理档位？**
  - A（本设计默认）：不发布，`levelsKnown=false`、无档位。最安全；live 9 个 GPT 模型失去 effort 选择。
  - B（推荐评估）：当 canonical 的 lab 存在唯一 first-party 记录（relation 或 inline 同 id，且多条时档位等价）时，以其 `reasoning_options` 作为 `lab-default` 档位发布，诊断标注「serving 未证明」；永不用于价格/limit/LKG 证明；fallback 模式不适用。models.dev AGENTS.md 要求 relay 记录「copy the underlying model's controls from the lab entry」，支持 B 的合理性，但网关是否透传档位无法由数据证明。
  - C：B + 以 LiteLLM `supports_*_reasoning_effort` 显式 `false` 过滤档位。
- **Q2（低优先级）** 是否继续支持 provider-only（`api.json` 形状）的自建镜像？本设计默认 fail closed（canonical 模型 withheld，LKG 可恢复）；若需兼容，只能以「registry 不可用」诊断提示，不能恢复 fallback 选择。
