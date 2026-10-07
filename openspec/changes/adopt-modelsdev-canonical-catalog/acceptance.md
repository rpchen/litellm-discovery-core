# Acceptance Matrix

每一行在实施阶段必须映射到至少一个自动化测试（testing-standard §1）。`R*` 使用从 live catalog（2026-10-07 13:11 UTC）裁剪出的真实 schema fixture；`G*` 使用遵循真实 models.dev schema 的合成 catalog；禁止模型特判或白名单——`R*` 只是 `G*` 规则在真实数据上的实例。

记号：`S?` = serving 状态，`levels` = 推理档位（Q1 采用默认 A 时的期望；若选 B，`levels` 列改为 lab-default）。

## R — 真实回归（live endpoint 形态，裁剪 fixture）

| ID | 部署形态 | 期望 identity | 期望 serving | 期望 effective ctx/in/out | 期望结果 | 当前 main 行为 |
|---|---|---|---|---|---|---|
| R1 mimo-v2.6-pro | route `mimo-v2.6-pro`，`custom_llm_provider=openai`；LiteLLM 1048576/131072 | `xiaomi/mimo-v2.6-pro` registry-unique | unproven | 1048576/1048576/131072 | configured；0 discrepancy；不使用 OpenRouter 1050000；价格=LiteLLM | invalid-metadata |
| R2 mimo-v2.6-flash | 同上 | `xiaomi/mimo-v2.6-flash` | unproven | 1048576/1048576/131072 | configured；**永不**选 `opencode/mimo-v2.6-flash-free` | invalid-metadata（选中 -free） |
| R3 minimax-m3 | route `minimax-m3`，`base_model=minimax-m3`；LiteLLM 1000000/131072 | `minimax/MiniMax-M3` | unproven | 1048576/1048576/512000 | configured；input、output resolved discrepancy | invalid-metadata |
| R3b minimax-m3 + `models_dev_provider: minimax` | — | 同上 | declared `minimax/MiniMax-M3` | 1000000/1000000/512000 | configured；context serving-override；output discrepancy | invalid-metadata |
| R3c minimax-m3 + `models_dev_provider: opencode` | — | 同上 | declared `opencode/minimax-m3` | 512000/512000/128000 | configured；input/output discrepancy | — |
| R3d minimax-m3 + `litellm_params.max_tokens: 65536, max_input_tokens: 900000` | — | 同上 | unproven | 1048576/900000/65536 | configured；constraint-narrowed | — |
| R4 deepseek-v4.1-flash | route + `base_model=deepseek-v4.1-flash`；LiteLLM 1000000/384000 | `deepseek/deepseek-v4.1-flash` | unproven | 1000000/1000000/384000 | configured；**不**发布 serving SKU 393216；不由最短 id 选 SKU | configured 1000000/393216 |
| R5 glm-5.3-flash | route `glm-5.3-flash` | `zhipuai/glm-5.3-flash` | unproven | 1000000/1000000/131072 | configured；modalities 来自 registry | configured（经 relation） |
| R6 kimi-k3 | route `kimi-k3`；LiteLLM 1048576/1048576 | `moonshotai/kimi-k3` | unproven | 1048576/1048576/131072 | configured；output discrepancy（LiteLLM 1048576 vs 131072） | configured 1048576/**1048576** |
| R6b kimi-k3 + `models_dev_provider: moonshotai` | — | 同上 | declared | 1048576/1048576/1048576 | configured；output serving-override | — |
| R7 hy4-preview | route `hy4-preview`；LiteLLM 无 limit，有价格 | `tencent/hy4-preview`（lab 无 provider） | unproven | 1024000/1024000/64000 | configured；无档位；价格=LiteLLM | configured 1048576/64000 + OpenRouter 档位 |
| R8 kimi-k2.7-code | route `kimi-k2.7-code`，`base_model=minimax-m2.7` | `minimax/MiniMax-M2.7`（base_model 胜；route 差异仅诊断） | unproven | 204800/204800/131072 | configured | configured（经 opencode） |
| R9 gpt-5.6-sol | route `gpt-5.6-sol`；LiteLLM `max_input_tokens` 922000 | `openai/gpt-5.6-sol` | unproven | 1050000/922000/128000 | configured；**0** context discrepancy（922000 只比 input 且相等）；价格=LiteLLM | configured，选 `openai/gpt-5.6`，伪 discrepancy |
| R10 fallback-only/private | route `acme-private-1`；registry 无；OpenCode 精确同名记录 | unproven | fallback | OpenCode 值 | LiteLLM 未声明时 configured（fallback-serving）；LiteLLM descriptive 不同 → invalid-metadata；无价格/档位；LKG 不恢复 | — |
| R11 private, LiteLLM-only | route `acme-private-2`；无任何 models.dev 记录；LiteLLM 完整 | unproven | unproven | LiteLLM 值 | configured；authority `litellm-declared` | configured |

## G — 通用对抗矩阵（合成真实 schema catalog）

| ID | 维度 | 输入 | 期望 |
|---|---|---|---|
| G1 | 唯一裸 canonical | registry `labA/x`；route `x` | proven `registry-unique` |
| G2 | 重复裸 canonical | registry `labA/x`、`labB/x`；route `x` | ambiguous；**不**落到后续候选；withheld `identity-ambiguous` |
| G2b | 重复裸 + 限定路由 | 同 G2；route `labB/x` | proven `qualified-deployment` = `labB/x` |
| G3 | qualified identity | route `openrouter/labA/x`（registry 有 `labA/x`） | proven `qualified-deployment`；serving 仍 unproven |
| G3b | adapter 前缀 ≠ namespace | route `openai/x`，registry 只有 `labA/x` | identity `labA/x`（bare）；serving unproven；**不**把 `openai` 当 namespace |
| G4 | provider relation | registry 无 `x-sku`；`models_dev_provider: P`；P/`x-sku` `canonical_model_id=labA/x` | proven `serving-relation` `labA/x`；serving declared |
| G5a | canonical/provider 矛盾（等价） | deployment → `labA/x`；声明 P 的记录 relation → `labA/y`，x/y 内禀等价 | identity `labA/x` + `identity-discrepancy`；publishable |
| G5b | canonical/provider 矛盾（实质不同） | 同上但 x/y limits 不同 | ambiguous；withheld |
| G6 | first-party serving override 未证明 | registry `labA/x` 100/10；`labA` provider 记录 80/10 | effective 100/10；不使用 80 |
| G6b | first-party serving override 已证明 | 同上 + `models_dev_provider: labA` | effective 80/10；context provenance serving-override |
| G7 | unknown serving | 仅 reseller 记录存在 | 只用 intrinsic；reseller limit/价格/档位均不进入 ModelSpec |
| G8 | proven serving = reseller | `models_dev_provider: R`；R/`x` | serving facts 来自 R/`x`（精确 wire id） |
| G9 | reseller base_model | R/`x` `canonical_model_id=labA/x`，serving 未证明 | 不提供 identity、不提供 facts |
| G10 | free/fast 变体 | registry `labA/x`；R/`x-free`、R/`x:thinking`、R/`x-fast` 均 relation→`labA/x` 且 limits 不同；route `x` | identity `labA/x`；变体记录永不被选；facts=intrinsic |
| G10b | 运维者确实路由变体 | route `x-free`（registry 无）；R/`x-free` relation→`labA/x` | registry 0 命中 → fallback；以 R/`x-free` 精确记录为 fallback-serving；relation 只作诊断，不反证 identity |
| G11 | 多 reseller 变体 | `models_dev_provider: R`；R 有 `x`、`x-fast` 均 relation→`labA/x`，wire id `x` | 选 R/`x`（精确）；若 wire id 无精确命中且 relation 记录实质不同 → serving-ambiguous withheld |
| G12 | 缺 canonical/provider 字段 | reseller 记录无 `canonical_model_id`、id 等于 registry 裸 id；serving 未证明 | 记录不提供任何证据；identity 由 registry 决定 |
| G12b | 声明 provider 不存在 | `models_dev_provider: nope` | `declared-unmatched`；按 intrinsic 发布 + warning |
| G12c | 声明 provider 存在但无记录 | `models_dev_provider: P`，P 无 wire id / relation 记录 | `declared-unmatched`；intrinsic + warning |
| G13 | LiteLLM descriptive 不一致 | canonical proven；`max_output_tokens` ≠ intrinsic | resolved discrepancy；publishable |
| G13b | descriptive vs fallback | registry 0 命中；fallback 值 ≠ descriptive | unresolved conflict；withheld |
| G13c | 跨 deployment 不一致 | 两 deployment `max_output_tokens` 不同（canonical proven） | conflict；withheld |
| G14 | runtime constraint 收窄 | `litellm_params.max_tokens` < base | effective = constraint；constraint-narrowed |
| G14b | constraint ≥ base | `max_tokens` > base | no-op |
| G14c | input constraint | `litellm_params.max_input_tokens` < context | 只收窄 input；context 不变 |
| G15 | 维度隔离 | registry context 400k、input 272k；LiteLLM `max_input_tokens` 272k | 0 discrepancy；若 LiteLLM 300k → 只报 input discrepancy |
| G16 | reasoning 支持但无可选档位 | serving 记录 `reasoning_options=[{type:"toggle"}]` 或 `[]` | supported；`levelsKnown=true`；variants `[]` |
| G17 | provider-specific 档位 | serving declared P（档位 a,b）；另一 provider 档位 c | variants=a,b |
| G17b | 档位 serving 未证明 | 同上无声明 | `levelsKnown=false`、variants `[]`（Q1=A） |
| G17c | fallback 档位 | registry 0 命中，fallback 记录有档位 | variants `[]` |
| G18 | unknown-provider 价格 | LiteLLM 无价格；serving 未证明；first-party 有 cost | price 0 |
| G18b | 已证明 serving 价格 | 同上 + `models_dev_provider` | price = serving cost |
| G18c | LiteLLM 显式价格 | 任意 | LiteLLM 价格胜出 |
| G19 | outage + LKG（canonical-intrinsic） | 上轮 configured；本轮 catalog unavailable；stableIdentity 不变 | `configured-lkg` |
| G19b | outage + LKG（serving-declared） | 声明不变 → 恢复；声明移除/改变 → fail closed | — |
| G19c | outage + LKG（fallback-serving） | — | 永不恢复 |
| G19d | schema 7 entry | 任意 | fail closed，下一轮 live 重捕获 |
| G19e | serving 记录变化、canonical 不变、serving 未证明 | live catalog 可用 | entry 不因 provider 记录变化失效；live 内禀值冲突才失效 |
| G20 | catalog 形状 | `complete` / `providers-only` / 空 / 非对象 / 只有 `models` | 分别：正常 / 不做 canonical 与 fallback 解析，LiteLLM 声明完整者发布、其余 metadata-unavailable / unavailable / unavailable / unavailable |
| G21 | single resolver | 任意 fixture | `buildModelSpecs` == `diagnoseModelSpecs().models` == publishable `spec` 投影；publishable `spec.limit` == assessment 值；LKG captured == spec |
| G22 | 确定性 | 打乱 providers/models key 顺序与 deployment 顺序 | 所有结果逐字节相同 |
| G23 | 无 heuristic | registry 有 `labA/x-pro`；route `x`（无精确命中） | 0 命中；不按前缀/子串匹配 |
| G24 | model_name 非证据 | deployment route 缺失、`model_name` 等于 registry 裸 id | 不 proven（沿用 identity-less 规则） |

## C — Catalogue-wide 门禁

- `scripts/audit-modelsdev-catalog.ts`：对 live catalog 的全部 canonical 模型以 S1–S4 形态运行 resolver，断言：
  - S2（裸路由 + facts==canonical）false-withheld = 0（除 registry 裸 ID 冲突外）；
  - 任一形态中被选 serving 记录在 serving 未证明时为 0；
  - publishable `spec` 与 canonical intrinsic（或已证明 serving）逐字段一致；
  - 变体记录被选 = 0。
- 作为非阻断的 scheduled/manual job（依赖网络），离线 CI 使用裁剪 fixture 的同一断言。
