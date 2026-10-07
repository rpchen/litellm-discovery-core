# Acceptance Matrix

每一行在实施阶段必须映射到至少一个自动化测试（testing-standard §1）。`R*` 使用从 live catalog（2026-10-07 13:11 UTC）裁剪出的真实 schema fixture；`G*` 使用遵循真实 models.dev schema 的合成 catalog；禁止模型特判或白名单——`R*` 只是 `G*` 规则在真实数据上的实例。

记号：`levels` = 推理档位状态（`unknown` / `known[...]` / `pinned=X`）；basis 记号见 design D6。

## R — 真实回归（live endpoint 形态，裁剪 fixture）

| ID | 部署形态 | 期望 identity | 期望 serving | 期望 effective ctx/in/out | levels | 期望结果 | 当前 main 行为 |
|---|---|---|---|---|---|---|---|
| R1 mimo-v2.6-pro | route `mimo-v2.6-pro`，`custom_llm_provider=openai`；LiteLLM 1048576/131072 | `xiaomi/mimo-v2.6-pro` registry-unique；parse metadata `openai` | unproven | 1048576/1048576/131072 | unknown | configured；0 discrepancy；OpenRouter 1050000 不出现；价格=LiteLLM | invalid-metadata |
| R2 mimo-v2.6-flash | 同上 | `xiaomi/mimo-v2.6-flash` | unproven | 1048576/1048576/131072 | unknown | configured；`opencode/mimo-v2.6-flash-free` 不出现在 resolution（也不是诊断候选：wire id 不同） | invalid-metadata（选中 -free） |
| R3 minimax-m3 | route `minimax-m3`，`base_model=minimax-m3`；LiteLLM 1000000/131072 | `minimax/MiniMax-M3` | unproven | 1048576/1048576/512000 | unknown | configured；input、output resolved discrepancy；`opencode/minimax-m3` 只作诊断候选 | invalid-metadata |
| R3b + `models_dev_provider: minimax` | — | 同上 | declared `minimax/MiniMax-M3` | 1000000/1000000/512000 | known[]（toggle） | configured；context/output basis serving；output discrepancy | invalid-metadata |
| R3c + `models_dev_provider: opencode` | — | 同上 | declared `opencode/minimax-m3` | 512000/512000/128000 | known[] | configured；input/output discrepancy；cacheRead 来自 OpenCode | — |
| R3d + `litellm_params.max_tokens: 65536, max_input_tokens: 900000` | — | 同上 | unproven | 1048576/900000/65536 | unknown | configured；constraint-narrowed | — |
| R4 deepseek-v4.1-flash | route + `base_model=deepseek-v4.1-flash`；`allowed_openai_params:[reasoning_effort]` | `deepseek/deepseek-v4.1-flash` | unproven | 1000000/1000000/384000 | unknown（allowed_openai_params 不生成档位） | configured；不发布 serving SKU 393216 | configured 1000000/393216，档位 low/high/max |
| R5 glm-5.3-flash | route `glm-5.3-flash` | `zhipuai/glm-5.3-flash` | unproven | 1000000/1000000/131072 | unknown | configured；modalities 来自 registry | configured，档位 low/high/max |
| R6 kimi-k3 | route `kimi-k3`；LiteLLM 1048576/1048576 | `moonshotai/kimi-k3` | unproven | 1048576/1048576/131072 | unknown | configured；output discrepancy | configured 1048576/**1048576** |
| R6b + `models_dev_provider: moonshotai` | — | 同上 | declared | 1048576/1048576/1048576 | known[low,high,max] | configured；output basis serving | — |
| R7 hy4-preview | route `hy4-preview`；LiteLLM 无 limit，有价格 | `tencent/hy4-preview`（lab 无 provider） | unproven | 1024000/1024000/64000 | unknown | configured；价格=LiteLLM；OpenRouter 只作诊断候选 | configured 1048576/64000 + OpenRouter 档位 |
| R8 kimi-k2.7-code | route `kimi-k2.7-code`，`base_model=minimax-m2.7` | `minimax/MiniMax-M2.7`（base_model 胜；route 差异仅诊断） | unproven | 204800/204800/131072 | unknown | configured | configured（经 opencode） |
| R9 gpt-5.6-sol | route `gpt-5.6-sol`；LiteLLM `max_input_tokens` 922000 | `openai/gpt-5.6-sol` | unproven | 1050000/922000/128000 | unknown | configured；0 context/input discrepancy；价格=LiteLLM | 选 `openai/gpt-5.6`，伪 discrepancy，6 档 |
| R9b gpt-6-luna | route `gpt-6-luna`；`litellm_params.reasoning_effort: max` | `openai/gpt-6-luna` | unproven | 1050000/922000/128000 | pinned=max（known[]） | configured；无可选档位 | 6 档（被 pin 覆盖） |
| R10 private + 同名 reseller | route `acme-private-1`；registry 无；OpenCode、OpenRouter 均有同名记录；LiteLLM 无 limit | unproven | unproven | — | — | withheld（incomplete-metadata）；两条记录只列为诊断候选 | — |
| R10b 同上 + LiteLLM 完整 | LiteLLM 声明全部 gated 字段 | unproven | unproven | LiteLLM 值 | unknown | configured，basis litellm-declared；reseller 值不出现 | — |
| R10c 同上 + `models_dev_provider: opencode` | — | unproven（OpenCode 记录无 relation） | declared | OpenCode 值 | 来自 OpenCode | configured，basis serving | — |
| R11 private, LiteLLM-only | route `acme-private-2`；无任何 models.dev 记录；LiteLLM 完整 | unproven | unproven | LiteLLM 值 | unknown | configured，basis litellm-declared | configured |

## G — 通用对抗矩阵（合成真实 schema catalog）

| ID | 维度 | 输入 | 期望 |
|---|---|---|---|
| G1 | 唯一裸 canonical | registry `labA/x`；route `x` | proven `registry-unique` |
| G2 | 重复裸 canonical | registry `labA/x`、`labB/x`；route `x` | ambiguous；不落到后续候选；withheld `identity-ambiguous` |
| G2b | 重复裸 + 限定路由 | 同 G2；route `labB/x` | proven `qualified-deployment` = `labB/x` |
| G3 | qualified after adapter | route `openrouter/labA/x` | proven `labA/x`；serving unproven；parse metadata `openrouter` |
| G3b | adapter 段只作 parse metadata | route `openai/x`，`custom_llm_provider: openai`，registry 只有 `labA/x` | identity `labA/x`；serving unproven；`openai` 不出现在任何 basis/evidence |
| G3c | 默认 adapter 不推断 serving | route `labA/x`，无可见 api_base | identity proven；serving unproven |
| G3d | 首段既可能是 adapter 也可能是 lab | route `labA/x`，registry 有 `labA/x` | full 精确命中 → identity；不证明 serving |
| G4 | provider relation | registry 无 `x-sku`；`models_dev_provider: P`；P/`x-sku` `canonical_model_id=labA/x` | proven `serving-relation` `labA/x`；serving declared |
| G5a | canonical/provider 矛盾（等价） | deployment → `labA/x`；声明 P 的记录 relation → `labA/y`，x/y 内禀等价 | identity `labA/x` + `identity-discrepancy`；publishable |
| G5b | canonical/provider 矛盾（实质不同） | 同上但 limits 不同 | ambiguous；withheld |
| G6 | first-party override 未证明 | registry `labA/x` 100/10；`labA` provider 记录 80/10 | effective 100/10 |
| G6b | first-party override 已证明 | 同上 + `models_dev_provider: labA` | effective 80/10；context basis serving |
| G7 | unknown serving | 仅 reseller 记录存在 | 只用 canonical；reseller limit/价格/档位/日期均不出现 |
| G8 | proven serving = reseller | `models_dev_provider: R`；R/`x` | serving 字段来自 R/`x` |
| G9 | reseller base_model | R/`x` `canonical_model_id=labA/x`，serving 未证明 | 不提供 identity、不提供 facts |
| G10 | free/fast 变体 | registry `labA/x`；R/`x-free`、R/`x:thinking`、R/`x-fast` relation→`labA/x`；route `x` | 变体记录永不被选 |
| G10b | 运维者路由变体（未登记） | route `x-free`（registry 无）；R/`x-free` relation→`labA/x`；无声明；LiteLLM 无 limit | withheld；R/`x-free` 只作诊断候选；relation 不反证 identity |
| G11 | 多 reseller 变体（已声明） | `models_dev_provider: R`；R 有 `x`、`x-fast` relation→`labA/x`，wire id `x` | 选 R/`x`；若 wire id 无精确命中且 relation 记录实质不同 → serving-ambiguous withheld |
| G12 | 缺 relation 字段 | reseller 记录无 `canonical_model_id`、id 等于 registry 裸 id；serving 未证明 | 记录不提供任何证据 |
| G12b | 声明 provider 不存在 | `models_dev_provider: nope` | declared-unmatched；按 serving 未证明解析 + warning |
| G12c | 声明 provider 存在但无记录 | `models_dev_provider: P`，P 无匹配 | declared-unmatched |
| G13 | LiteLLM descriptive 不一致 | canonical proven；`max_output_tokens` ≠ registry | resolved discrepancy；publishable |
| G13b | 未证明记录 vs descriptive | registry 无；同名 reseller 值 ≠ LiteLLM descriptive；LiteLLM 完整 | 无 conflict；basis litellm-declared；configured |
| G13c | 跨 deployment 不一致 | 两 deployment `max_output_tokens` 不同 | conflict；withheld |
| G14 | constraint 收窄 | `litellm_params.max_tokens` < base | constraint-narrowed |
| G14b | constraint ≥ base | `max_tokens` > base | no-op |
| G14c | input constraint | `litellm_params.max_input_tokens` < context | 只收窄 input |
| G15 | 维度隔离 | registry context 400k、input 272k；LiteLLM `max_input_tokens` 272k / 300k | 0 discrepancy / 只报 input discrepancy |
| G16 | reasoning 支持、档位已知为空 | serving 记录 `[toggle]` 或 `[]` | supported；levels known[] |
| G17 | provider-specific 档位 | serving declared P（档位 a,b）；另一 provider 档位 c | variants = a,b |
| G17b | serving 未证明 | 同上无声明；first-party 有档位 | levels unknown；variants [] |
| G17c | pinned effort | `litellm_params.reasoning_effort: high`，serving declared 有档位 | pinned=high；variants [] |
| G17d | 非档位证据 | `allowed_openai_params:[reasoning_effort]`、`model_info.supports_xhigh_reasoning_effort: true` | levels unknown |
| G18 | 价格未证明 | LiteLLM 无价格；serving 未证明；first-party 有 cost | 0 |
| G18b | 价格逐组件 | LiteLLM 有 input/output；declared P 有 cacheRead | input/output = LiteLLM、cacheRead = P |
| G18c | `litellm_params` 价格优先 | `litellm_params.input_cost_per_token` 与 `model_info` 不同 | 用 `litellm_params` |
| G19 | 字段矩阵：canonical 缺字段 | registry 无 `limit.output`；LiteLLM 一致声明 | basis litellm-declared；publishable |
| G19b | 字段矩阵：serving 缺字段 | serving 记录无 `limit.input`，registry 有 | canonical `limit.input` |
| G19c | modalities 完整集合 | registry `text,image`；LiteLLM `supports_audio_input: true` | audio unsupported；discrepancy |
| G19d | modalities 对象缺失 | registry 无 `modalities`；LiteLLM 只有 `supports_vision` | unknown；withheld |
| G19e | release date | serving 未证明 | canonical release_date；reseller 日期不出现 |
| G20 | LKG outage（canonical 组成） | basis canonical/derived；catalog unavailable；proof 不变 | configured-lkg |
| G20b | LKG 混合组成 | context canonical、output serving、price litellm-declared；只改 LiteLLM 价格 | 整份 reject |
| G20c | LKG serving 声明 | 声明不变 → 恢复；移除/改变 → reject | — |
| G20d | LKG constraint 指纹 | `litellm_params.max_tokens` 改变 | reject |
| G20e | LKG 未被引用记录变化 | live catalog 中无关 provider 记录变化，registry digest 不变 | 仍有效 |
| G20f | LKG registry digest | live registry entry 内禀值变化 | reject |
| G20g | schema 7 / 缺 proof / 未知 basis | — | fail closed |
| G20h | providers-only + LKG | proof 不变 | 恢复；不使用 provider 记录 |
| G21 | catalog 形状 | complete / providers-only / 空 / 非对象 / 只有 `models` | 正常 / 不做 canonical 解析、LiteLLM 完整者发布、其余 metadata-unavailable / unavailable ×3 |
| G22 | single resolver | 任意 fixture | `buildModelSpecs` == `diagnoseModelSpecs().models` == publishable `spec`；captured == spec |
| G23 | 确定性 | 打乱 providers/models key 与 deployment 顺序 | 结果逐字节相同 |
| G24 | 无 heuristic | registry `labA/x-pro`；route `x` | 0 命中 |
| G25 | model_name 非证据 | route 缺失、`model_name` 等于 registry 裸 id | 不 proven |

## C — Catalogue-wide 门禁

- `scripts/audit-modelsdev-catalog.ts`：对 live catalog 的全部 canonical 模型以 S1–S4 形态运行 resolver，断言：
  - S2（裸路由 + facts==canonical）false-withheld = 0（registry 裸 ID 冲突除外）；
  - 任一形态中未证明 provider 记录贡献的字段数 = 0；
  - 变体记录被选 = 0；
  - publishable `spec` 每字段等于 D6 matrix 给出的值。
- 作为非阻断 scheduled/manual job（依赖网络）；离线 CI 对裁剪 fixture 运行同一断言。
