# Acceptance Matrix

每一行在实施阶段必须映射到至少一个自动化测试（testing-standard §1）。`R*` 使用从 live catalog（2026-10-07 13:11 UTC）裁剪出的真实 schema fixture；`G*` 使用遵循真实 models.dev schema 的合成 catalog；禁止模型特判或白名单——`R*` 只是 `G*` 规则在真实数据上的实例。

记号：`levels` = 推理档位状态（`unknown` / `known[...]`）；**非价格** `litellm_params` 键当前均为 operator configuration（D7a 空证明集）：永不产生档位、pin、narrowing 或 LKG 指纹；`MirroredPricingParams` 的 7 个价格键是 Operator-Declared Pricing（design D8），只产生价格事实；basis 记号见 design D6/D7a；R4/R4b/R4c、R9b、R10b/R11 为**行为变化测试**（注释引用 design Risks，禁止回改为旧值）。

**规范冲突裁决（review issue 4，2026-10-08）**：原 R10b/R11 行「LiteLLM 值 / configured，basis litellm-declared」与 G30、design D6 跨维度替代禁止不变量、design Revision 3 ⑥（删除 `max_input_tokens → context` 替代，LiteLLM-only 无 context 即 withheld）、Revision 4 ②、Risks「[LiteLLM-only 更严格]」与 Migration 4 行为变化清单直接矛盾。按设计真源（五处一致陈述）裁决：**strict 生效**——`max_input_tokens` 在任何分支（含 LiteLLM-only）都只是 input capacity，绝不作 context；LiteLLM-only 私有模型无 context 即 withheld。R10b/R11/G21/G41 行已按裁决修正；这不是改变已批准的产品规则，而是消除验收矩阵与已冻结设计之间的矛盾（第一轮实现误按 lenient 侧实现，本修正将其对齐设计）。

## R — 真实回归（live endpoint 形态，裁剪 fixture）

| ID | 部署形态 | 期望 identity | 期望 serving | 期望 effective ctx/in/out | levels | 期望结果 | 当前 main 行为 |
|---|---|---|---|---|---|---|---|
| R1 mimo-v2.6-pro | route `mimo-v2.6-pro`，`custom_llm_provider=openai`；LiteLLM 1048576/131072 | `xiaomi/mimo-v2.6-pro` registry-unique；parse metadata `openai` | unproven | 1048576/1048576（registry 无 `limit.input` → LiteLLM 补缺，litellm-declared）/131072 | unknown | configured；0 discrepancy；OpenRouter 1050000 不出现；价格=LiteLLM | invalid-metadata |
| R2 mimo-v2.6-flash | 同上 | `xiaomi/mimo-v2.6-flash` | unproven | 1048576/1048576/131072 | unknown | configured；`opencode/mimo-v2.6-flash-free` 不出现在 resolution（也不是诊断候选：wire id 不同） | invalid-metadata（选中 -free） |
| R3 minimax-m3 | route `minimax-m3`，`base_model=minimax-m3`；LiteLLM 1000000/131072 | `minimax/MiniMax-M3` | unproven | 1048576/**1000000**/512000（input = LiteLLM 同维度补缺，basis litellm-declared） | unknown | configured；input、output resolved discrepancy；`opencode/minimax-m3` 只作诊断候选 | invalid-metadata |
| R3b + `models_dev_provider: minimax` | — | 同上 | declared，record resolved（精确 wire id） | 1000000/1000000/512000（serving 记录有 `limit.input` → input = serving） | known[]（toggle） | configured；context/output basis serving；output discrepancy | invalid-metadata |
| R3c + `models_dev_provider: opencode` | — | 同上 | declared，record resolved（精确 wire id；`canonical_model_id` 一致） | 512000/1000000/128000（serving 记录无 `limit.input` → serving-absence policy：LiteLLM 同维度补缺，不回填 canonical） | known[] | configured；output discrepancy；cacheRead 来自 OpenCode | — |
| R3d + `litellm_params.max_input_tokens: 900000`、`max_tokens: 65536`（均 operator configuration，D7a 空证明集） | — | 同上 | unproven | 1048576/**1000000**/512000（两键都不收窄；input 仍 = LiteLLM `model_info.max_input_tokens` 补缺；`max_tokens` 不改 output） | unknown | configured；两键只进诊断，不产生 discrepancy/conflict | — |
| R4 deepseek-v4.1-flash（A：serving 未证明） | route + `base_model=deepseek-v4.1-flash`；`allowed_openai_params:[reasoning_effort]` | `deepseek/deepseek-v4.1-flash` | unproven | 1000000/1000000（registry 无 `limit.input` → LiteLLM 补缺，litellm-declared）/384000 | unknown（allowed_openai_params 不生成档位） | **configured，output=384000（canonical）**——**行为变化测试**：前一阶段冻结的 393216 是 serving SKU 值，仅 serving 证明后可用；注释引用 design Risks，禁止回改 | configured 1000000/393216，档位 low/high/max |
| R4b deepseek-v4.1-flash（B：provider proven，SKU unresolved） | 同 R4 + `models_dev_provider: deepseek`，**路由仍是裸 `deepseek-v4.1-flash`**（真实 catalog：deepseek 仅有 `deepseek-flash`/`deepseek-v4-flash`/`deepseek-v4-flash-vision-exp` 三条 relation-only SKU record，无 `deepseek-v4.1-flash` exact record，也无同名 key） | 同上 | declared，record **unresolved**（`serving-record-unresolved`） | 1000000/1000000/**384000**（canonical）；relation SKU 不提供 facts | unknown（relation 记录档位不可用） | configured，output=384000；provider price 不可用（LiteLLM 价格优先）；诊断列出三条可精确命中的 SKU | — |
| R4c deepseek-v4.1-flash（C：provider + exact SKU proven） | `litellm_params.model = deepseek/deepseek-flash`、**`custom_llm_provider: deepseek`**（adapter parse 证据，否则 qualified 路由不产生 bare lookup key）、`base_model = deepseek-v4.1-flash`、`models_dev_provider: deepseek`；LiteLLM metadata 同 R4（`model_info.max_input_tokens: 1000000`） | 同上 | declared，record **resolved**（parse：`custom_llm_provider=deepseek` 与首段一致 → remainder `deepseek-flash` → bare parsed-key 精确命中 deepseek 的 `deepseek-flash` SKU record） | 1000000/1000000（serving 记录无 `limit.input` → serving-absence policy：LiteLLM 同维度补缺，litellm-declared）/393216（serving） | 来自 `deepseek-flash` 记录 | configured，output=393216（serving override）；**A/B/C 的唯一差异是 serving SKU proof**；**行为变化测试**：与 R4/R4b 的差异是 SKU 级证据差异，注释引用 design Risks，禁止回改 | — |
| R5 glm-5.3-flash | route `glm-5.3-flash` | `zhipuai/glm-5.3-flash` | unproven | 1000000/1000000/131072 | unknown | configured；modalities 来自 registry | configured，档位 low/high/max |
| R6 kimi-k3 | route `kimi-k3`；LiteLLM 1048576/1048576 | `moonshotai/kimi-k3` | unproven | 1048576/1048576/131072 | unknown | configured；output discrepancy | configured 1048576/**1048576** |
| R6b + `models_dev_provider: moonshotai` | — | 同上 | declared | 1048576/1048576/1048576 | known[low,high,max] | configured；output basis serving | — |
| R7 hy4-preview | route `hy4-preview`；LiteLLM 无 limit，有价格 | `tencent/hy4-preview`（lab 无 provider） | unproven | 1024000/1024000/64000 | unknown | configured；价格=LiteLLM；OpenRouter 只作诊断候选 | configured 1048576/64000 + OpenRouter 档位 |
| R8 kimi-k2.7-code | route `kimi-k2.7-code`，`base_model=minimax-m2.7` | `minimax/MiniMax-M2.7`（base_model 胜；route 差异仅诊断） | unproven | 204800/204800/131072 | unknown | configured | configured（经 opencode） |
| R9 gpt-5.6-sol | route `gpt-5.6-sol`；LiteLLM `max_input_tokens` 922000 | `openai/gpt-5.6-sol` | unproven | 1050000/922000/128000 | unknown | configured；0 context/input discrepancy；价格=LiteLLM | 选 `openai/gpt-5.6`，伪 discrepancy，6 档 |
| R9b gpt-6-luna | route `gpt-6-luna`；`litellm_params.reasoning_effort: max`（operator configuration） | `openai/gpt-6-luna` | unproven | 1050000/922000/128000 | unknown；`reasoning_effort` 只进诊断 | configured；无可选档位；**行为变化测试**：当前错误发布 6 档（含被请求覆盖的 default），注释引用 design Risks，禁止回改 | 6 档（被 pin 覆盖） |
| R10 private + 同名 reseller | route `acme-private-1`；registry 无；OpenCode、OpenRouter 均有同名记录；LiteLLM 无 limit | unproven | unproven | — | — | withheld（incomplete-metadata）；两条记录只列为诊断候选 | — |
| R10b 同上 + LiteLLM 完整 | LiteLLM 声明全部 gated 字段（含 input/output/tools/reasoning/modalities） | unproven | unproven | context **missing**（无 LiteLLM context 键；不拿 `max_input_tokens` 当 context——G30/design Risks「LiteLLM-only 更严格」） | unknown | **withheld（discovered-incomplete）**——**行为变化测试**：pre-change main 用 `max_input_tokens` 当 context 发布；design Migration 4 冻结为 withheld，注释引用 design Risks，禁止回改 | — |
| R10c 同上 + `models_dev_provider: opencode` | — | unproven（OpenCode 记录无 relation） | declared | OpenCode 值 | 来自 OpenCode | configured，basis serving | — |
| R11 private, LiteLLM-only | route `acme-private-2`；无任何 models.dev 记录；LiteLLM 完整 | unproven | unproven | context missing（同 R10b/G30；`max_input_tokens` 仅为 input capacity） | unknown | **withheld（discovered-incomplete）**——**行为变化测试**（同 R10b）；此行原文「configured，basis litellm-declared」与 G30/D6 不变量/design Revision 3 ⑥、Revision 4 ②、Risks「LiteLLM-only 更严格」、Migration 4 相矛盾，按设计真源修正，禁止回改 | configured |

## G — 通用对抗矩阵（合成真实 schema catalog）

| ID | 维度 | 输入 | 期望 |
|---|---|---|---|
| G1 | 唯一裸 canonical | registry `labA/x`；route `x` | proven `registry-unique` |
| G2 | 重复裸 canonical | registry `labA/x`、`labB/x`；route `x` | ambiguous；不落到后续候选；withheld `identity-ambiguous` |
| G2b | 重复裸 + 限定路由 | 同 G2；route `labB/x` | proven `qualified-deployment` = `labB/x` |
| G3 | qualified after adapter（需 parse 证据） | route `openrouter/labA/x`、`custom_llm_provider: openrouter`（缺 `custom_llm_provider` 时只能试 full `openrouter/labA/x`，不得擅自 strip） | proven `labA/x`（remainder 精确命中）；serving unproven；parse metadata `openrouter` |
| G3b | adapter 段只作 parse metadata | route `openai/x`，`custom_llm_provider: openai`，registry 只有 `labA/x` | identity `labA/x`；serving unproven；`openai` 不出现在任何 basis/evidence |
| G3c | 默认 adapter 不推断 serving | route `labA/x`，无可见 api_base | identity proven；serving unproven |
| G3d | 首段既可能是 adapter 也可能是 lab | route `labA/x`，registry 有 `labA/x` | full 精确命中 → identity；不证明 serving |
| G4 | provider relation | registry 无 `x-sku`；`models_dev_provider: P`；P/`x-sku` `canonical_model_id=labA/x` | proven `serving-relation` `labA/x`；serving declared |
| G5 | canonical/provider 矛盾（无论事实是否相同） | deployment → `labA/x`；声明 P 的记录 relation → `labA/y`（x/y 内禀等价或不同两种子情况） | identity conflict → ambiguous → withheld；事实相等不构成等价 |
| G6 | first-party override 未证明 | registry `labA/x` 100/10；`labA` provider 记录 80/10 | effective 100/10 |
| G6b | first-party override 已证明 | 同上 + `models_dev_provider: labA` | effective 80/10；context basis serving |
| G7 | unknown serving | 仅 reseller 记录存在 | 只用 canonical；reseller limit/价格/档位/日期均不出现 |
| G8 | proven serving = reseller | `models_dev_provider: R`；R/`x` | serving 字段来自 R/`x` |
| G9 | reseller base_model | R/`x` `canonical_model_id=labA/x`，serving 未证明 | 不提供 identity、不提供 facts |
| G10 | free/fast 变体 | registry `labA/x`；R/`x-free`、R/`x:thinking`、R/`x-fast` relation→`labA/x`；route `x` | 变体记录永不被选 |
| G10b | 运维者路由变体（未登记） | route `x-free`（registry 无）；R/`x-free` relation→`labA/x`；无声明；LiteLLM 无 limit | withheld；R/`x-free` 只作诊断候选；relation 不反证 identity |
| G11 | exact 候选与 relation 变体（已声明） | `models_dev_provider: R`；R 有 exact-key record `x` 与 relation 变体 `x-fast`、`x:thinking`（均 relation→`labA/x`），wire id `x` | record resolved = R/`x`（exact parsed-key）；变体不参与；若**多条 exact parsed-key 候选**实质不同 → serving-ambiguous withheld；**只有 relation 候选而无 exact** → serving-record-unresolved（无论 1 条/多条/事实同异） |
| G12 | 缺 relation 字段 | reseller 记录无 `canonical_model_id`、id 等于 registry 裸 id；serving 未证明 | 记录不提供任何证据 |
| G12b | 声明 provider 不存在 | `models_dev_provider: nope` | declared-unmatched；按 serving 未证明解析 + warning |
| G12c | 声明 provider 存在但无记录 | `models_dev_provider: P`，P 无匹配 | declared-unmatched |
| G13 | LiteLLM descriptive 不一致 | canonical proven；`max_output_tokens` ≠ registry | resolved discrepancy；publishable |
| G13b | 未证明记录 vs descriptive | registry 无；同名 reseller 值 ≠ LiteLLM descriptive；LiteLLM 完整 | 无 conflict；basis litellm-declared；configured |
| G13c | 跨 deployment 不一致 | 两 deployment `max_output_tokens` 不同 | conflict；withheld |
| G14 | enforcement 收窄（晋升后） | 假设某键已按 D7a 晋升并声明（合成 delta fixture） | 按该 delta 语义收窄（**当前无此键**；本行仅在实施时作为矩阵驱动的占位） |
| G14b | operator configuration 不收窄 | `litellm_params.max_tokens` 65536 < output base 512000；`reasoning_effort: high`；`supports_function_calling=false` | output 512000 不变；levels 不变；tools 不变；三者只进诊断 |
| G14c | input 键不收窄 | `litellm_params.max_input_tokens` 900000 < context；`model_info.max_input_tokens` 1000000 | input 保持 1000000（litellm-declared 补缺值不受 operator-configuration 键影响）；context 不变；该键只进诊断 |
| G15 | 维度隔离 | registry context 400k、input 272k；LiteLLM `max_input_tokens` 272k / 300k | 0 discrepancy / 只报 input discrepancy |
| G16 | reasoning 支持、档位已知为空 | serving 记录 `[toggle]` 或 `[]` | supported；levels known[] |
| G17 | provider-specific 档位 | serving declared P（档位 a,b）；另一 provider 档位 c | variants = a,b |
| G17b | serving 未证明 | 同上无声明；first-party 有档位 | levels unknown；variants [] |
| G17c | operator-configuration effort vs serving 档位 | serving declared 有档位 low/high/max；`litellm_params.reasoning_effort: high` | variants=[low,high,max]（default 只进诊断，不 pin 不删） |
| G17d | 非档位证据 | `allowed_openai_params:[reasoning_effort]`、`model_info.supports_xhigh_reasoning_effort: true` | levels unknown |
| G18 | 价格未证明 | LiteLLM 无价格；serving 未证明；first-party 有 cost | 0 |
| G18b | 价格逐组件 | LiteLLM 有 input/output；declared P 有 cacheRead | input/output = LiteLLM、cacheRead = P |
| G18c | `litellm_params` 价格优先 | `litellm_params.input_cost_per_token` 与 `model_info` 不同 | 用 `litellm_params` |
| G19 | 字段矩阵：canonical 缺字段 | registry 无 `limit.output`；LiteLLM 一致声明 | basis litellm-declared；publishable |
| G19b | 字段矩阵：serving 缺 input + LiteLLM 有 | serving 记录无 `limit.input`（`base_model_omit`）；registry 有；LiteLLM `max_input_tokens` 有 | input = LiteLLM 补缺（litellm-declared）；**不回填 canonical** |
| G19b2 | 字段矩阵：serving 缺 input + LiteLLM 无 | serving 与 LiteLLM 均无 `limit.input` | input unknown；不回填 canonical、不 = context |
| G19c | modalities 完整集合 | registry `text,image`；LiteLLM `supports_audio_input: true` | audio unsupported；discrepancy |
| G19d | modalities 对象缺失 | registry 无 `modalities`；LiteLLM 只有 `supports_vision` | unknown；withheld |
| G19e | release date | serving 未证明 | canonical release_date；reseller 日期不出现 |
| G20 | LKG outage（canonical 组成） | basis canonical + litellm-declared；catalog unavailable；proof 不变 | configured-lkg |
| G20b | LKG 混合组成 | context canonical、output serving、price litellm-declared；只改 LiteLLM 价格 | 整份 reject |
| G20c | LKG serving 声明 | 声明不变 → 恢复；移除/改变 → reject | — |
| G20d | LKG enforcement 指纹（空） | 任意 `litellm_params` 键（`max_input_tokens`/`reasoning_effort`/`max_tokens`）改变 | 仍有效（fingerprint 为空；operator-configuration 键不进指纹） |
| G20e | LKG 未被引用记录变化 | live catalog 中无关 provider 记录变化，registry digest 不变 | 仍有效 |
| G20f | LKG registry digest | live registry entry 内禀值变化 | reject |
| G20g | schema 7 / 缺 proof / 未知 basis | — | fail closed |
| G20h | providers-only + LKG | proof 不变 | 恢复；不使用 provider 记录 |
| G21 | catalog 形状 | complete / providers-only / 空 / 非对象 / 只有 `models` | 正常 / 不做 canonical 解析（G30：LiteLLM-only 无 context 键，context missing → 全部 metadata-unavailable，LKG 可恢复）、其余 metadata-unavailable / unavailable ×3 |
| G22 | single resolver | 任意 fixture | `buildModelSpecs` == `diagnoseModelSpecs().models` == publishable `spec`；captured == spec |
| G23 | 确定性 | 打乱 providers/models key 与 deployment 顺序 | 结果逐字节相同 |
| G24 | 无 heuristic | registry `labA/x-pro`；route `x` | 0 命中 |
| G25 | model_name 非证据 | route 缺失、`model_name` 等于 registry 裸 id | 不 proven |
| G26 | qualified 无 adapter 证据 | route `some-private-provider/foo`，无 `custom_llm_provider` 或不匹配第一段；registry 有 `labA/foo` | 只试 full；不取尾段；0 命中 → unproven |
| G27 | adapter 证据后才取余串 | route `openrouter/labA/x`，`custom_llm_provider: openrouter` | proven `labA/x`；serving unproven |
| G28 | base_model_omit | serving 记录由 `base_model = tencent/hy3` + `base_model_omit=[\"limit.input\"]` 生成；canonical `tencent/hy3` 有 input | input 保持缺失；不回填 canonical；诊断说明 omit |
| G29 | canonical/serving 矛盾（事实相同） | deployment → `labA/x`；declared P 记录 `canonical_model_id=labA/y`；x/y 事实全同 | identity conflict → ambiguous → withheld（事实相等不是 identity 关系） |
| G30 | 跨维度替代禁止（LiteLLM-only） | registry 无；serving 无声明；LiteLLM 声明 max_input/max_output，无 context | context missing → withheld；不拿 max_input_tokens 当 context |
| G31 | operator configuration 合并序 | `litellm_params.reasoning_effort: max` + 请求覆盖（LiteLLM 剥 thinking） | Core 不依赖该键产生任何发布事实 |
| G32 | enforcement 矩阵未知键 | `litellm_params` 出现矩阵未列出的键 | 不产生值/收窄/冲突 |
| G33 | catalog 未来顶层 key | catalog 多出 `generatedAt`/`schemaVersion` 等未知顶层 key | 仍判 complete；未知 key 忽略 |
| G34 | input 不跨维度推导 | canonical proven 且 registry 无 `limit.input`；LiteLLM 无 `max_input_tokens` | input unknown；绝不 = context；发布不因 input 缺失 withheld（非 gated） |
| G35 | input serving-absence | serving proven、record resolved 且记录因 `base_model_omit` 无 `limit.input`；LiteLLM 有 `max_input_tokens` | input = LiteLLM 同维度补缺（litellm-declared）；不回填 canonical、不 = context |
| G36 | enforcement 全空 | deployment 声明 `litellm_params.max_input_tokens`/`max_tokens`/`supports_function_calling=false`/`reasoning_effort` | 所有 gated 字段值不变；无 narrowing；全部只进诊断 |
| G37 | operator-configuration 诊断 | 同 G36 | 诊断列出键名并标注 operator configuration，不称 enforcement |
| G38 | LKG evidence multiset | 两个 deployment route 相同但 base_model/models_dev_provider 证据不同，其一改变 | multiset 不等 → 整份 reject |
| G39 | catalog models-only | 顶层只有 `models` | unavailable；LiteLLM-only + LKG 路径 |
| G40 | provider 证明 ≠ record 证明 | `models_dev_provider: gatewayX`；gatewayX 只有 `x-free`（relation→`labA/x`）；wire id `x` | record unresolved；整组按 serving-unproven 解析；`x-free` 不提供任何 fact；诊断 `serving-record-unresolved` |
| G41 | LKG litellm-only capture 不可达 | R11 形态按 G30 永远 withheld，永远不产生 capture；`identityKind=litellm-only` 保留在 schema 供前向兼容，结构上不可捕获；存储中出现的 litellm-only proof 一律按伪造 fail closed（G43） |
| G42 | LKG serving-only capture | R10c 形态 configured 后 capture | identityKind=serving-only、无 canonicalModelID、无 registryDigest、有 serving 声明+recordDigest；合法 capture |
| G43 | LKG proof 类型不一致 | identityKind=litellm-only 却有 registryDigest；或 canonical 无 canonicalModelID | fail closed（forged） |
| G44 | Operator-Declared Pricing | `litellm_params.input_cost_per_token` 与 `model_info.input_cost_per_token` 不同 | 用 `litellm_params`（镜像键优先）；价格键永不 narrowing 任何能力字段 |

## C — Catalogue-wide 门禁

- `scripts/audit-modelsdev-catalog.ts`：对 live catalog 的全部 canonical 模型以 S1–S4 形态运行 resolver，断言：
  - S2（裸路由 + facts==canonical）false-withheld = 0（registry 裸 ID 冲突除外）；
  - 任一形态中未证明 provider 记录贡献的字段数 = 0；
  - 变体记录被选 = 0；
  - publishable `spec` 每字段等于 D6 matrix 给出的值。
- 作为非阻断 scheduled/manual job（依赖网络）；离线 CI 对裁剪 fixture 运行同一断言。
