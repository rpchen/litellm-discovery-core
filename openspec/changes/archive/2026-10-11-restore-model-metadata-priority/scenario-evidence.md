# Scenario 实施证据

Core 代码实施（2026-10-10）；T05/T06 撤回。下表记录 Core 的离线自动化证据；真实宿主 T28–T34 的最终 Pi/OpenCode CI 与 E2E 证据见文末。固定输入为 test/fixtures/metadata-priority/ 中与设计 evidence 字节一致的副本，避免归档改变测试路径。

PR #34 对 bb07ca3 的 Review 只要求修复公共 helper 命名空间兼容。既有 T24 补充 test/metadata-publication.test.ts 的 `[T24] numeric helper preserves intrinsic limits for <name>`、`[T24] boolean helper preserves true, false and unknown for <name>`、`[T24] modality helper preserves declared arrays and unknown for <name>`（name 为 lab/model、Lab/Model），以及 scripts/test-package.mjs 独立包消费者的 namespacedGroup 断言。修复前6个用例及包消费失败；修复后25/25定向与包消费通过。该修复的完整CI以[PR最新HEAD checks](https://github.com/rpchen/litellm-discovery-core/pull/34/checks)及对应交付报告为准，不新增Scenario或改变冻结预期。

| Capability | Requirement | Scenario / Matrix | 自动化证据 | 当前状态 |
|---|---|---|---|---|
| discovery-core | Preserve discovery entrypoints with corrected metadata | [T24] 公共消费者 | test/metadata-publication.test.ts: [T22/T23/T24] build, publication, diagnostics and public mapping share facts and allowlisted output；scripts/test-package.mjs 外部消费者 | 本地 / 实现 CI PASS |
| discovery-diagnostics | Readable selected metadata | [T22] 用户可读 | test/metadata-publication.test.ts: [T22/T23/T24] build, publication, diagnostics and public mapping share facts and allowlisted output | 本地 / 实现 CI PASS |
| discovery-diagnostics | Readable selected metadata | [T23] 主动审计安全 | test/metadata-publication.test.ts: [T22/T23/T24] build, publication, diagnostics and public mapping share facts and allowlisted output | 本地 / 实现 CI PASS |
| discovery-quality | Single record quality boundary | [T09] 不跨型号 | test/metadata-selection.test.ts: [T09] a same-name record pointing at a dated version is excluded | 本地 / 实现 CI PASS |
| discovery-quality | Single record quality boundary | [T10] 来源唯一 | test/metadata-selection.test.ts: [T10] a selected record never fills missing fields from registry, lower providers or LiteLLM | 本地 / 实现 CI PASS |
| discovery-quality | Single record quality boundary | [T12] 限制维度 | test/metadata-publication.test.ts: [T12] invalid selected context/output cannot publish and another model remains available | 本地 / 实现 CI PASS |
| discovery-resilience | Reuse existing recovery with one record | [T18] 目录暂不可用 | test/metadata-publication.test.ts: [T18] LKG restores the reasoning and tool facts consumed by hosts | 本地 / 实现 CI PASS |
| discovery-resilience | Reuse existing recovery with one record | [T20] 内部路由变化 | test/metadata-publication.test.ts: [T18/T20] LKG restores whole configuration through outage despite internal route changes | 本地 / 实现 CI PASS |
| discovery-snapshot | Metadata policy snapshot version | [T19] 旧快照升级 | test/metadata-publication.test.ts: [T19] LKG schema9 rejects old schema8 and critical damage, but normalizes bad prices | 本地 / 实现 CI PASS |
| discovery-snapshot | Endpoint-scoped critical configuration | [T21] 端点改变 | test/metadata-publication.test.ts: [T19/T21] snapshot2 protects critical contents and endpoint scope but ignores bad prices | 本地 / 实现 CI PASS |
| discovery-snapshot | Endpoint-scoped critical configuration | [T17] 旧cap配置改变 | test/metadata-publication.test.ts: [T16/T17] price and deprecated cap changes update display without availability drift | 本地 / 实现 CI PASS |
| discovery-snapshot | Critical snapshot integrity | [T19] 价格损坏 | test/metadata-publication.test.ts: [T19] LKG schema9 rejects old schema8 and critical damage, but normalizes bad prices | 本地 / 实现 CI PASS |
| discovery-snapshot | Critical snapshot integrity | [T19] 能力损坏 | test/metadata-publication.test.ts: [T19] LKG cannot capture an incomplete or divergent critical configuration | 本地 / 实现 CI PASS |
| discovery-snapshot | Separate display changes from availability | [T16] 显示价格更新 | test/metadata-publication.test.ts: [T16/T17] optional prices never change publication, limits, variants or critical integrity | 本地 / 实现 CI PASS |
| modelsdev-catalog | Single resolution result | Gate and configuration cannot diverge | test/metadata-publication.test.ts: [T22/T23/T24] build, publication, diagnostics and public mapping share facts and allowlisted output；scripts/test-package.mjs 外部消费者 | 本地 / 实现 CI PASS |
| modelsdev-catalog | Single resolution result | No cross-provider field inheritance | test/metadata-selection.test.ts: [T10] a selected record never fills missing fields from registry, lower providers or LiteLLM | 本地 / 实现 CI PASS |
| modelsdev-catalog | Model name selects one metadata record | [T01] 16模型按名称匹配 | test/metadata-priority.test.ts: [T01/T13] <16个实际model_name> uses its own frozen metadata record | 16/16 PASS；实现 CI PASS |
| modelsdev-catalog | Model name selects one metadata record | [T02] 官方API名称不同 | test/metadata-priority.test.ts: [T02] DeepSeek canonical name selects the non-deprecated official API alias；[T02] exact deprecated official API <deepseek-v4-flash/deepseek-v4-flash-vision-exp> remains matchable | 本地 / 实现 CI PASS |
| modelsdev-catalog | Model name selects one metadata record | [T03] 整记录三级选择 | test/metadata-selection.test.ts: [T03] official then OpenCode then OpenRouter selects one whole record | 本地 / 实现 CI PASS |
| modelsdev-catalog | Model name selects one metadata record | [T04] 已确认组织别名 | test/metadata-selection.test.ts: [T04] confirmed organization aliases select a record | 本地 / 实现 CI PASS |
| modelsdev-catalog | Model name selects one metadata record | [T08] 内部路由变化 | test/metadata-selection.test.ts: [T07/T08] only model_name participates in identity across deployments | 本地 / 实现 CI PASS |
| modelsdev-catalog | Model name selects one metadata record | [T09] 实际日期版本反例 | test/metadata-selection.test.ts: [T09] a same-name record pointing at a dated version is excluded | 本地 / 实现 CI PASS |
| modelsdev-catalog | Compatible catalog input | [T25] 目录不可用 | test/metadata-selection.test.ts: [T25/T26] catalog input guards and future top-level fields preserve existing behavior | 本地 / 实现 CI PASS |
| modelsdev-catalog | Compatible catalog input | [T26] Future top-level keys are ignored | test/metadata-selection.test.ts: [T25/T26] catalog input guards and future top-level fields preserve existing behavior | 本地 / 实现 CI PASS |
| modelsdev-catalog | Capabilities come from the selected record | [T10] 整条记录保真 | test/metadata-selection.test.ts: [T10] a selected record never fills missing fields from registry, lower providers or LiteLLM | 本地 / 实现 CI PASS |
| modelsdev-catalog | Capabilities come from the selected record | [T12] 限制来源 | test/metadata-publication.test.ts: [T12] invalid selected context/output cannot publish and another model remains available | 本地 / 实现 CI PASS |
| modelsdev-catalog | Reasoning support and options from the selected record | [T13] GPT各自选项 | test/metadata-priority.test.ts: [T01/T13] <16个实际model_name> uses its own frozen metadata record | 16/16 PASS；实现 CI PASS |
| modelsdev-catalog | Reasoning support and options from the selected record | [T14] 支持与档位分离 | test/metadata-publication.test.ts: [T14] unsupported/empty/toggle/effort reasoning support is independent from selectable levels | 本地 / 实现 CI PASS |
| modelsdev-catalog | Optional prices from the selected record | [T16] 价格独立 | test/metadata-publication.test.ts: [T16/T17] optional prices never change publication, limits, variants or critical integrity | 本地 / 实现 CI PASS |
| modelsdev-catalog | Optional prices from the selected record | [T17] 上下文不受价格限制 | test/metadata-publication.test.ts: [T16/T17] price and deprecated cap changes update display without availability drift | 本地 / 实现 CI PASS |
| publication | False versus unknown | Missing tool declaration stays unknown | test/metadata-publication.test.ts: [T10] explicit false is complete; missing tool or reasoning declarations remain unknown | 本地 / 实现 CI PASS |
| publication | False versus unknown | Explicit negative evidence means unsupported | test/metadata-publication.test.ts: [T10] explicit false is complete; missing tool or reasoning declarations remain unknown | 本地 / 实现 CI PASS |
| publication | Essential capability admission | [T14] 支持无档位 | test/metadata-publication.test.ts: [T14] unsupported/empty/toggle/effort reasoning support is independent from selectable levels | 本地 / 实现 CI PASS |
| publication | Essential capability admission | [T11] 已有协议回退 | test/metadata-publication.test.ts: [T11] existing mixed-deployment protocol fallback and override do not block publication | 本地 / 实现 CI PASS |
| publication | Essential capability admission | [T16] 无价格 | test/metadata-publication.test.ts: [T16/T17] optional prices never change publication, limits, variants or critical integrity | 本地 / 实现 CI PASS |
| publication | Critical configuration cache validation | [T18] 目录中断仍可恢复 | test/metadata-publication.test.ts: [T18] LKG restores the reasoning and tool facts consumed by hosts | 本地 / 实现 CI PASS |
| publication | Critical configuration cache validation | [T20] 内部信息无关 | test/metadata-publication.test.ts: [T18/T20] LKG restores whole configuration through outage despite internal route changes | 本地 / 实现 CI PASS |
| publication | Critical configuration cache validation | [T20] 删除模型 | test/metadata-publication.test.ts: [T20/T21] deleted models and another endpoint store never restore an old model | 本地 / 实现 CI PASS |
| publication | Critical configuration cache validation | [T19] 旧配置与损坏内容 | test/metadata-publication.test.ts: [T19] LKG schema9 rejects old schema8 and critical damage, but normalizes bad prices | 本地 / 实现 CI PASS |
| publication | Existing metadata failure handling | [T25] 目录故障 | test/metadata-selection.test.ts: [T25/T26] catalog input guards and future top-level fields preserve existing behavior | 本地 / 实现 CI PASS |

DeepSeek Flash 官方别名修复已获用户批准；50/50定向、198/198完整回归通过，包括16个冻结配置和两个精确旧API。40个Scenario沿用原映射，不新增Requirement/Scenario或候选机制。

上述 Core 实现测试对应源码提交 **1f1ee6e27a637849c4c75cdf6795ef3b1ba959de**：[run38057696387 / SUCCESS](https://github.com/rpchen/litellm-discovery-core/actions/runs/38057696387)。PR #34 合并后的 main CI [run38063778052 / SUCCESS](https://github.com/rpchen/litellm-discovery-core/actions/runs/38063778052) 与索引发布 [run38063887657 / SUCCESS](https://github.com/rpchen/litellm-discovery-core/actions/runs/38063887657) 对应 Core main SHA `cf797e953eb1f6de8e7c3e0fd5e98094398c26f9`。

## T28–T34 真实宿主与交付证据

Pi #55 和 OpenCode #63 均以内含同一 Core provenance `cf797e953eb1f6de8e7c3e0fd5e98094398c26f9` 的已合并 main SHA 完成完整 CI。证据为：

| Scenario | 真实宿主证据 | 结果 |
|---|---|---|
| T28：同 Core SHA 与相同 fixture | [Pi main CI](https://github.com/rpchen/pi-litellm-provider/actions/runs/38101305088)；[OpenCode main CI](https://github.com/rpchen/opencode-litellm-provider/actions/runs/38101504070) | 两宿主固定 Core provenance 一致，使用同一16模型配置验收输入 |
| T29：Pi注册、picker与逐档请求 | [Real Pi 0.87.1 E2E](https://github.com/rpchen/pi-litellm-provider/actions/runs/38101305088/job/114357613117)，package main SHA `6007c4b5d5588ad2dfa14d1577c00df7ce74d844` | 16/16模型注册与选择通过；已声明推理档位进入真实请求；无默认思考档位泄漏 |
| T30：Pi模态、工具与限制映射 | [Real Pi 0.87.1 E2E](https://github.com/rpchen/pi-litellm-provider/actions/runs/38101305088/job/114357613117) | 16模型最终注册字段与宿主能力表达通过 |
| T31：Core→状态→命令/UI与请求 | [Pi E2E](https://github.com/rpchen/pi-litellm-provider/actions/runs/38101305088/job/114357613117)；[OpenCode E2E](https://github.com/rpchen/opencode-litellm-provider/actions/runs/38101504070/job/114358190469) | 端到端宿主验收通过；OpenCode实际执行63个 Chat/Responses/Messages 请求 |
| T32：Pi恢复、scope、重启与持久化行为 | [Real Pi 0.87.1 E2E](https://github.com/rpchen/pi-litellm-provider/actions/runs/38101305088/job/114357613117) | 既有激活、隔离、缓存恢复和持久化边界通过 |
| T33：OpenCode注册、picker与请求 | [Real OpenCode 2.0.16 E2E](https://github.com/rpchen/opencode-litellm-provider/actions/runs/38101504070/job/114358190469)，package main SHA `d205122d07f90493be6682f9053f0c1c3b5a3780` | 16/16模型最终配置通过；variants未扩张未声明档位 |
| T34：固定provenance、dist与独立消费 | [Pi CI](https://github.com/rpchen/pi-litellm-provider/actions/runs/38101305088/job/114357613022)；[OpenCode CI](https://github.com/rpchen/opencode-litellm-provider/actions/runs/38101504070/job/114358190630) | 两仓完整CI通过；verify:dist、真实宿主安装及独立package消费均成功，provenance保持同一Core SHA |
