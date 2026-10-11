# 全量审计

审计日期：2026-10-10。按用户产品原则 P1–P12（顺序同任务书）判断，而非把旧规范当不可修改需求。以下保留原审计定位，并按本轮规则A–G修订处理建议；C20撤回，不再视为需修复问题。本轮不扩大审计。源码定位以 baseline.md 的固定 SHA 为准。全量 58 个 current spec 的文件、hash、Requirement/Scenario 清单与处理在 spec-inventory.json / spec-inventory.md；历史 archive 只读。

## 基线与证据范围

四仓库 latest main/index 的 CLI ready 回执均有效且 code/index SHA、immutable artifact/graph 校验和一致。原生 list_projects/index_status 可以返回 ready 与正确根目录，零 partial/unusable/skipped；但 MCP structural/coverage 查询仍返回此前缓存的 git timed out，故没有使用未经验证的图谱关系或死代码结论。结构与行为回读当前 Git 源码，生成目录和 SDK 使用直接源码。不得把全局 index_status 当每文件 coverage 已验证。

读取 Pi 实际注册模型时只输出指定 provider 的 allowlist（id、api、reasoning、thinkingLevelMap、input、contextWindow、maxTokens、snapshot variants），未导出原始 models store、地址或凭据。16 名称真实；synthetic-discovery.json 的 deployment 结构是设计用合成数据，绝不是对真实上游 routes 的声明。

## 问题清单

| ID / 仓库 | 文件、要求或函数 | 实际行为与冲突 | 原则 | 处理 | 风险与回归 |
|---|---|---|---|---|---|
| C01 Core | modelsdev-catalog: Serving provider proof / Unproven provider records；resolve.ts resolveServing:320 | 未配置 models_dev_provider 即忽略官方/OpenCode/OpenRouter 能力 | P1–5,10 | 删除 serving proof；按 D1–D3 自动关联 | T01–T04；T05/T06撤回，声明不影响选择 |
| C02 Core | resolve.ts resolveDeploymentIdentity:190 / matchCandidate:252；canonical identity requirement | model_name 不参与 canonical 匹配，精确实际名称仍失败 | P2 | 只用model_name匹配；内部base_model/route不作身份条件 | T07–T09；内部信息变化不阻断，目录版本/SKU保留 |
| C03 Core | resolve.ts servingRecordCandidates:284；record-level selection determinism | 官方只有 relation/API alias 也被拒；deepseek-flash 无法供档位 | P2,3 | 官方 explicit canonical relation | T02；保留版本/SKU 反例 |
| C04 Core | modelsdev-catalog；resolve.ts publicationCriticalFacts:305 | 价格不同被当关键 record 冲突，可使模型不可用 | P8,9 | 删除候选等价裁决；所选记录价格或0 | T16；价格不影响使用 |
| C05 Core | resolve.ts resolveBranchFields:741 / applyIllegality:1377 | LL deployment 冲突、非法低层限制先于权威数据 veto | P1,3,11 | 直接读所选整记录；删除provider/LL补字段 | T10,T12；有效官方 vs 坏 LL |
| C06 Core | resolve.ts resolveReasoningLevels:1429 | 没 serving record 就 levels unknown，虽 reasoning true | P7 | 读取选中记录 reasoning_options；不造统一 GPT 模板 | T01,T13–T15 |
| C07 Core | resolve.ts resolvePriceComponent:1203；capabilities.ts perTokenCost | operator params→model_info→proven record，且取最高 deployment 价 | P3,8,9 | 所选整记录参考价或0，不跨provider补价 | T16 |
| C08 Core | resolve.ts firstTierPointOf/applyTierCap:1654/1674；capabilities.ts tierPoint | 价格阶梯把 GPT context 压到272000，甚至可从价格造 context | P8,9 | 删除 cap；配置废弃接受但忽略 | T17；all price mutations保持K |
| C09 Core | resolve.ts buildProof:1695 / litellmDeclaredMaterial:1769；publication.ts liveLitellmFingerprintOf:1052 | 部署多重摘要、价格字段、空 enforcement 参与 LKG | P8,10,11 | 缩为关键快照兼容；不存原始deployment证据树 | T18–T21 |
| C10 Core | modelsdev-catalog: Last Known Good schema 8 proof composition；publication.ts validateLastKnownGood | price-only change 明确要求拒绝完整 LKG | P8,9 | 后续 schema9；价格不参与reuse | T16,T18 |
| C11 Core | snapshot.ts isModelSpec / inspectDiscoverySnapshot | 任一 cost 缺失/非数值使整个快照 invalid；全模型指纹含价格 | P8 | 关键完整性与显示价分开；坏价归零 | T19；关键损坏仍拒绝 |
| C12 Core | modelsdev.ts detailedFromResolver:466；diagnostics.ts diagnoseModelSpecs:705/761 | matched 等价于 proven serving，产生误导性0/16 | P1,5,10 | 实际采用 models.dev 能力统计；身份命中另作审计 | T22；matched≠configured |
| C13 Core | diagnostics.ts 字段来源 helpers / buildDiagnosticCandidates:1464 | 默认显示证据类别、候选 provider、声明提示，且存在重复计算 | P5,10 | resolver唯一结果，用户摘要，allowlist审计 | T22,T23 |
| C14 Core | evidence.ts；modelsdev.ts legacy helpers；capabilities.ts mapCapabilities；src/index.ts | 重叠的能力/推理/价格算法仍由 export * 暴露；并非可直接认定死代码 | P10 | 使用清点后删除私有分支，公开兼容入口委托单resolver | T24；外部消费者兼容 |
| C15 Core | modelsdev-catalog Runtime enforcement matrix；discovery-resilience constraints | 空“已证明键集合”及未来promotion机制没有当前产品作用 | P4,10,11 | 删除整个空框架；不把请求参数当模型上限 | T12；默认参数不改能力 |
| C16 Core | discovery-quality/publication 各旧 precedence/aggregation 规则 | “LL权威/交集/最高价”和新canonical章节同存；fallback顺序不一 | P1–3,8 | deltas完整替换相关Requirement，不仅改主函数 | T03,T10；规范overlay检查 |
| C17 Core | publication LKG completeness revalidation | 同名 Scenario New live fact conflicts with stored values 存在两种范围；任意LL冲突与权威冲突混淆 | P10,11 | 保留关键缓存完整性；删除内部路由重证明和重复条款 | T18,T20 |
| C18 Core | publication Failure taxonomy；discovery-quality unknown-model fallback | 网络失败一律不能normal与LL完整仍可发布互相冲突 | P10,11 | 保留既有失败/LKG处理，独立LL-only路径不扩展且不补选中记录 | T18,T25 |
| C19 Core | wire-id.ts；catalog-input.ts；resolve.ts | transport解析、canonical registry和记录身份未形成简单可复用关联；providers-only无registry不可误用 | P2,6 | 保留完整catalog与未知顶层字段兼容；只按model_name匹配，不解析内部route求身份 | T07,T26；删除不必要transport身份解析 |
| C20 Core（撤回） | protocol.ts resolveProtocol；两宿主 protocol-routing | 已核实有mixed-fallback，但没有用户调用错误证据；上轮据此要求withheld属于过度设计 | 本轮规则F | 保持当前协议/default/override；删除新增协议delta及阻断任务 | T11仅回归已有行为 |
| C21 Core | build.ts ModelSpec.reasoningSupported optional；Pi reasoningForHost | 注释要求缺失unknown，Pi却可按variant数量推断 | P7 | 正常发布必需明确verdict；旧shape仅诊断/兼容失败 | T14,T24 |
| C22 Core | docs/testing-standard.md §8；docs/decisions.md ADR004；README | 固定 serving proof、价格权威及schema8规则；ADR状态仍“实施中” | P4,5,8,10,12 | 实施时新决策明确supersede，§8用新不变量替换 | T27；不改archive |
| P01 Pi | openspec/model-discovery 能力/记录选择/价格；config.yaml；docs/decisions.md | LL优先、家族表、unique provider、显式override、价格cap同时存在 | P1–6,8–10 | 消费Core新契约；清理旧context与文档 | T28 |
| P02 Pi | map.ts thinkingLevelMapFor:37；真实pi-ai models.js getSupportedThinkingLevels:553 | true + 无map使Pi补 off/minimal/low/medium/high，空variants不等于无可选档位 | P7 | supported无档位全null；真实picker+请求验收 | T29；SDK行为已读，完整E2E待实施 |
| P03 Pi | pi-integration 模型配置；map.test.ts:320/433 | spec称无档位reasoning=false；toggle test坚持无map；将错误预期固化 | P7 | 分开支持与选项，改断言 | T14,T29 |
| P04 Pi | map.ts toPiInput / reasoningForHost | 自动补text与variant推理fallback可能掩盖不完整Core输出 | P6,7,11 | 文本宿主边界显式检查；不造能力 | T24,T30 |
| P05 Pi | extension/diagnostics.ts:367/377/420 | 提示配置 models_dev_provider 恢复档位，显示候选与旧matched口径 | P5,10 | 来源+可操作缺失项，无provider证明提示 | T22,T31 |
| P06 Pi | extension/discovery.ts snapshot restore；publication spec schema8 | 持久化旧16模型空档位/价格cap可能重启复现；复杂proof透传 | P7–10 | 接受Core新schema，仅成功刷新重建；保留端点scope | T19,T32 |
| P07 Pi | discovery-quality-integration fallback scenario；shared-core-build core逻辑单副本 | 要求保留LL价格及迁移前错误固定fixtures | P3,8,12 | 新Core结果做兼容基线，保留单副本与不可变构建 | T28,T34 |
| P08 Pi | publication.test.ts:332/539/860；map.test.ts；diagnostics.test.ts | 固定unproven官方不可用、schema8proof与无map预期 | P3–5,7–10 | 替换错误断言，保留安全负例、纵向覆盖 | T01,T18,T29 |
| P09 Pi | extension/types.ts ProviderModelConfigLike；真实SDK ProviderModelConfig:1209 | 宿主模型注册无独立tools开关，不能假称tools=false已完整映射；当前16项均true | P6,11 | 审计保留Core事实，明确Pi可表达边界；不新增全局工具切换机制 | T30；单列非工具模型宿主限制 |
| O01 OpenCode | model-discovery/config.yaml/docs/decisions.md | LL优先、默认tools、family/unique回退、价格cap等旧规则并存 | P1–6,8–10 | Core契约与显式false/unknown，删除默认猜测 | T28,T30 |
| O02 OpenCode | host/diagnostics.ts:180/190/232；provider-diagnostics | 同Pi的provider证明提示与误导统计 | P5,10 | 默认摘要，RPC/TUI一致，主动审计细节 | T22,T31 |
| O03 OpenCode | host/register.ts toModelInfo:107；host/models.ts | Model.Info.default再覆盖variants；类型强转不能证明真实SDK不补默认 | P7,11 | 实际注册+初始化+请求E2E，不复制Core算法 | T33 |
| O04 OpenCode | publication/snapshot/model-audit-export；audit.test.ts:73/103；publication.test.ts:881 | schema8/未证明档位为空、审计场景价格截断被固定 | P7–10 | 同新Core快照/参考价格，审计保持实际注册值 | T19,T23,T33 |
| O05 OpenCode | discovery-quality-integration；shared-discovery-core | 声称OpenCode先于OpenRouter但其他规范不同；保持显式LL价格 | P3,8,12 | 精确同步同名Core设计与固定SHA | T28,T34 |
| X01 三仓库 | change-sync models.dev unavailable；publication Purpose；适配层旧degraded注释 | 失败恢复与publication不一致；已移除的用户接受降级仍被描述 | P10,12 | 删除过时说明；通知确认不控制发布 | T25,T27 |
| X02 三仓库 | 当前fixtures/schema条件CORE_V8 skip | 大量回归只证明旧实现符合旧规范，没有验证用户16模型与真实档位 | P6,7,12 | 固定真实名称+公开数据+合成输入；正负矩阵和宿主E2E | T01,T29,T33 |

## 保留的规则及理由

| 范围 | 结论 |
|---|---|
| Core codebase-memory、cross-repository-verification、openspec-closure-gate、project-governance、refresh-coordinator | 保留；前置/索引/closure及重试隔离是真实治理与恢复需求，无需为修产品放松 |
| 两宿主 endpoint-management、endpoint-state-consistency、multi-endpoint-activation、litellm-connection | 保留；复杂度来自真实端点/凭据边界，与错误serving proof不同；deprecated contextTierCap值可原样保存但不执行 |
| build/provenance、distribution、runtime-identity、release-governance、core-compatibility | 保留固定SHA、真实宿主、CI、不可变安装边界；无本轮发版 |
| diagnostics时间、OpenCode卡片/对话反馈、主动导出安全写入 | 保留；不把简化模型诊断扩大成UI重构或自动发送报告 |
| mode过滤、endpoint URL语法、取消/401/403、成功空清单 | 保留；16模型修复不绕开安全与生命周期门禁 |

## 旧测试的处理边界

Core core-modelsdev/core-publication/core-build/core-diagnostics/core-resilience/resolve-matrix/canonical-catalog-acceptance/core-capabilities 中的“无声明不匹配”“price-only拒绝LKG”“272k截断”预期需明确更改，不能原样沿用当成质量保证。identity/SKU负向、正限制、unknown/false、endpoints、auth、secret allowlist、partial publication仍保留。

Pi map/publication/diagnostics/audit/discovery 与 OpenCode publication/audit/core-adapter/sync/TUI 测试须采用相同固定目录输入；直接factory/mock只证明适配边界，不能替代真实宿主读取注册结果和发起请求。所有新Scenario的计划映射见 scenario-evidence.md（实现前全部标为 planned），避免设计验证被误标为实现证据。

## 本轮证据纠偏

16条选中记录能力与选项完整；59条冻结公开记录关键字段检查无缺失。因此撤回逐字段fallback、官方候选等价裁决/排序、内部身份冲突与新协议阻断，T05/T06不再对应实施工作。D1–D8与原矩阵已同步；名称足够作为用户匹配基线，无需真实路由采集。保留必要机制的实际依据集中在design.md D8，未新增审计体系。
