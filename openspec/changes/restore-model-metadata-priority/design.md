# Design

## Context

见 proposal.md 与 audit.md。源码基线为 Core a13f16fd983478572502f3896fd5509978027261、Pi c98e57b877081fc4a9471ce772eeb6c130674dde、OpenCode f3447a3c2187e3cc3c90d1d76b0b28a7c5d79e03；两插件当前编入同一个 Core SHA。当前用户注册清单与公开目录分别冻结在 evidence/，两者不混称实际 LiteLLM 响应。

本次只设计。现行 testing-standard §8、ADR004、canonical specs 中与本提案冲突的产品要求须在获批实施时同时替换；closure、独立仓库、真实宿主 E2E、凭据保护等治理要求保留。

## Goals / Non-Goals

**Goals:** 用一个身份解析和一个有序元数据选择过程自动配置全部实际模型；让每个错误指向真正缺失或冲突的事实。

**Non-Goals:** 探测 LiteLLM 转发到哪里、验证上游商业服务归属、增加用户配置、模型家族模板、重新设计 endpoint 生命周期。本阶段不写运行时实现、不更新 dist、不归档、不合并或发布。

## Decisions

### D1. 先识别模型，再选择元数据

LiteLLM 的 model_name 始终是宿主 ID、显示名和请求 model；canonical ID 仅用于关联元数据，不替换请求名。每个 deployment 的 base_model、litellm_params.model 是上游身份线索；model_name 是可用的精确公开名称线索，不能因缺少上游字段就丢弃。

只接受下列身份关系：完整 canonical key 精确匹配；唯一 bare key 的大小写规范化匹配；provider 记录显式 canonical_model_id；同官方所有者命名空间下、无矛盾 relation 的精确 API model ID。仅剥离已知 LiteLLM transport adapter 前缀，不猜测未知斜杠片段、不按 family/substring/embedding 相似度匹配。transport 名只参与名称解析，不证明实际 provider。

解析顺序是 base_model → route model → model_name；它是候选查找顺序，不是允许覆盖矛盾的优先权。遇到两个可解析线索指向不同 canonical 或显式不同 SKU，withhold 当前模型并列出冲突字段；未知私有路由别名不等于冲突，可由唯一公开 model_name 确定身份。多 deployment 全部必须没有互相矛盾的已知身份。deployment ID、顺序、重复记录和价格不定义模型身份。

版本、日期、尺寸、free/pro/fast/thinking 等片段不删除。显式选择了某 provider SKU 的请求保留该精确 SKU，不用其 canonical relation 将其换成普通型号。canonical 输入与同名 API 记录的显式 relation 不一致时，排除该 API 记录，不把 canonical 强行改写。例：deepseek-v4-pro 的官方同名记录指向 deepseek/deepseek-v4-pro-0813；对未带日期的 canonical 请求选择确实关联原 canonical 的 OpenCode 记录。

没有 canonical 命中的私有模型仍保留 LiteLLM 自身稳定精确身份用于 diagnostics；只有所有必要字段明确且无 deployment 冲突时，才允许 LiteLLM-only 完整配置。当前 readContextLiteLLM 实际返回未知，并没有可用的总 context 字段映射；因此普通仅 LiteLLM 的新模型仍须 withheld，或使用合法 LKG。本变更不新增一个 context 别名来制造“完整路径”，也不得以模型名或 max_input_tokens 推断总上下文。

### D2. 官方识别是目录数据，不是 serving proof

canonical key 的 lab/owner 命名空间确定模型所有者。通常 owner 与 provider ID 相同；少数命名不一致由一个小的、带公开来源的 owner→provider 别名表描述，例如 tencent→tencent-tokenhub，zhipuai 的主 provider 为 zhipuai、备选 zai。该表只描述组织/目录身份，不含模型名称、家族、档位或价格；不是用户配置，运行时不查商业路由。

依据为 models.dev 固定来源 commit 的 lab、provider 及 model 文件。目录目前没有统一机器可读 owner-provider 关系，不能假称 catalog 已提供。新增 owner 别名须附 models.dev provider 文件及官方链接，不要求 LiteLLM forwarding 证明；未知 owner 无官方映射时仍可使用后两级，不能从任意第三方唯一记录造出官方来源。

同一 owner 的主 provider 优先，别名按显式固定顺序；同一 provider 先精确请求/API/canonical key，再使用显式 canonical_model_id 关系。官方关系允许官方 API 名与模型名不同（deepseek-flash → deepseek/deepseek-v4.1-flash）。无精确项时，优先非 deprecated 的关系项；余下多条若关键能力与 reasoning_options 等价，按完整 key 字典序取代表；若不等价则报告目录歧义，不任意取首条或降级掩盖。

OpenCode/OpenRouter 使用精确完整或 bare canonical 名（可加 owner 命名空间）或请求明确指定的精确 SKU；不把只有 relation、但名称不同的 free/pro/fast SKU 当默认替代品。relation 仍须一致。这样的限制保护 SKU，而非判断服务商是否在实际处理请求。

### D3. 固定三层来源，字段缺失才继续查找

先按 D1/D2 为每一级形成至多一条无歧义的记录，再以 **官方 → opencode → openrouter** 顺序读取字段。不存在的记录跳过，任意第三方“唯一命中”不参与。现有 models_dev_provider 即使提供、错误或冲突，也不改变这个顺序或可用性；作为废弃输入忽略。

tools、context/input/output、输入模态、输出模态、发布日期各取链中首个明确值；只有缺失/null 可到下一级同一身份记录。false 是明确值，模态数组是完整集合，不与低优先级做并集；官方仅 text 时不从下一级加 image。错误类型、非有限/非正关键限制、同一优先层真正矛盾的关键字段，报告数据错误并 withhold 该模型，不用低层值掩盖坏数据。input、发布日期缺失不是发布失败。

reasoning 是一个很小的原子读取单元：取链中首个明确 reasoning 布尔值及**这条记录自身**的 reasoning_options。false → unsupported、无档位；true + effort → 精确 values；true + []/toggle → supported、无可选 effort；true + 缺失 options → supported、档位未知。缺失 options 不去别的记录拼一套档位，也不把 unknown 改成 unsupported。整个 reasoning 字段缺失才到下一级。矛盾的 false + 非空 effort 是源数据错误。未知 options 类型只记为未支持控制，不造档位，已有支持结论保留。

必要时保留既有 LiteLLM model_info 同维度明确值补缺路径（在三层 models.dev 都无此字段后；字段级来源注明 LiteLLM）；只有一致的显式值可用，缺失不默认 false，max_input_tokens 不能代替 context。不存在可推导总 context 的 LiteLLM 字段时 context 仍未知。LiteLLM 的价格、supports_*_reasoning_effort、普通请求参数不参与能力权威或档位构造；不新增配置键推广/运行时强制证明框架。catalog.models 用于身份索引，不作为抢在上述记录之前的第四套元数据权威。

该设计允许少量缺失字段从下一来源补齐，但绝不跨身份、拼模态集合或拼 reasoning_options。相比坚持“整条记录缺一个字段就完全放弃”，这保留目录有效信息；相比所有来源保守交集，它遵守清晰优先级。

### D4. 推理控制与宿主映射

Core 沿用 supported/unsupported/unknown 与 variants，不新建一组业务状态。effort values 保留记录的原始合法值、顺序与去重后集合，不使用统一 GPT 模板。Chat/Responses variant 设置 reasoningEffort；Messages effort 使用现行对应 effort 设置。budget_tokens 仅在 Messages 中按现有受支持映射生成 high/max，具体预算不得超出记录上限；无上限不编造 max。toggle 本身不生成 low/high 档位。

Pi 将 none 映射 off，其余已支持 effort 同名映射；没声明的宿主档位显式 null。Pi 0.87.1 在 reasoning=true 且缺少 thinkingLevelMap 时会补默认 off/minimal/low/medium/high，因此支持但无档位时必须显式隐藏全部档位，并通过真实请求验证无默认 effort 被注入。reasoning 保持 true，不能改 false 来躲过宿主行为。宿主未知 effort 值不得改成近似档位，应只报告映射限制。

OpenCode 直接映射 Core variants 与 settings，验证 Model.Info 默认值和 SDK 请求没有再生成额外档位。两宿主必须保留原 model_name 和协议。Core 不引入任何 SDK。

### D5. 价格从发布函数的输入中移出

每个展示价格分量独立取官方 → OpenCode → OpenRouter 的首个有限且非负数；0 是有效且终止查找的值。缺失、null、负数、字符串、NaN/Infinity、坏 cost 对象一律跳过，最后 0。models.dev 单位是每百万 token；不再比较 LiteLLM per-token 价、不算最高 deployment 价、不验证真实供应商账单。只标为参考价，0 可表示未配置，不能把 0 文案宣称免费。

删除 firstTierPointOf/applyTierCap 及旧 tierPoint 路径。contextTierCap 暂接受但忽略，不参与 endpoint/result-validity fingerprint；README 明示废弃。用户没有要求用价格限制上下文，不能保留默认“省钱”行为。

设 K = 身份、所选协议、正 context/output、tools/reasoning 明确结论、已知输入/输出模态及有效控制；P = 任意价格输入。设计的发布判定是 publish(K)，LKG 有效性是 reusable(endpoint, identity, protocol, K, schema)，二者均无 P。对任意 P1/P2（含缺失/错误）必须有同一个 published ID 集合、相同 K、相同可恢复性。展示价格改变可以触发宿主元数据刷新，但不得改变配置状态、档位、限制、regression/通知指纹或缓存准入。

### D6. 保留真正需要的准入与 LKG

准入只检查：可解析且无冲突的模型身份、可映射协议、有限正 context/output、明确 tools 与 reasoning、明确输入和输出模态及宿主支持的文本会话边界。false 是完整结论；无选项支持推理可发布。价格、input、发布日期、选项数量、候选 provider 数量、serving 归属都不是准入项。不同 deployment 对被 models.dev 权威覆盖的描述性字段有差异，只供开发审计，不 veto。仅在该字段真正依赖 LiteLLM 补缺时，其 deployment 冲突才阻止发布。

保留按模型隔离、空目录撤下、401/403 清理、协议覆盖、端点/凭据隔离、取消与瞬时故障回放。多 deployment 明确要求不兼容协议且无 override 时 withhold；不再默默回退 Chat。没有协议声明的普通情况保持既有默认，不扩展模型家族判断。

LKG 只从本策略成功发布结果捕获。记录沿用已有入口，内容缩为模型身份/协议、已验证关键 ModelSpec、策略 schema、端点 scope、捕获时间与少量字段来源。删除 serving declaration、fieldBasis 证明地图、空 enforcement fingerprint、原始 deployment multiset、whole-record/price 摘要；不是重写一套证明系统。

catalog 暂不可用时，当前 LiteLLM 清单仍含同身份/协议模型，且当前有效关键事实不矛盾，就复用 LKG；缺失事实不是矛盾，age 不否定有效性。有新的完整结果时直接采用新结果。已删除模型、身份/协议变更、端点/凭据切换、已证实关键事实冲突不得恢复。不能通过 LKG 掩盖目录的真实歧义。

持久化快照的**关键内容完整性**仍校验，价格单独容错并归零；不能因 cost 对象损坏否定完整 K。保留内容指纹用于刷新比较，但与 LKG/恢复准入分开。新策略将 publication schema 从 8 单次升为 9、discovery snapshot schema 从 1 升为 2，避免旧空档位/272k 结果直接回放；无需 per-field 版本、迁移证明或多层 fallback。旧快照暂不恢复，下一次成功发现重建；这是显式升级代价。

### D7. 一个结果、两种阅读深度

默认诊断显示：发现/已配置/暂不可用数量，元数据来源（官方/OpenCode/OpenRouter/LiteLLM/上次成功），推理“不支持 / 支持，无可选档位 / 支持，列出档位 / 档位资料缺失”，以及具体缺失或冲突原因。models.dev 匹配数改为至少有 models.dev 能力字段实际采用的模型数；另可在开发审计看仅身份命中，不将它等同发布成功。

沿用已有主动 audit export，加 allowlist 的 canonical ID、选中记录公开 provider/key、字段来源、目录数据错误和快照来源；不自动导出，不增加新命令。移除默认候选 provider 清单、serving 证明状态、models_dev_provider 修复提示和内部字段大段输出。运行身份三字段、时间本地化、endpoint 状态仍保留。不能复制原始路由、URL、凭据或响应。

### D8. 删除、替换与保留

| 处理 | 对象 | 替代/保留理由 |
|---|---|---|
| 删除 | resolveServing 的 declaration 门禁、servingRecordCandidates 的 proof 限制、unproven/declared-unmatched/serving-record-unresolved 分支 | D1/D2 直接关联记录 |
| 删除 | publicationCriticalFacts 中 cost；resolvePriceComponent 的 operator authority；tier 函数 | D5 独立参考价 |
| 删除 | buildProof/validateLastKnownGood 的 schema 8 多重 proof、两份 LL price fingerprint、emptyEnforcementFingerprint | D6 最小兼容记录 |
| 删除 | runtime enforcement 空集合、promotion 状态和 future-only 规则 | 没有当前产品效果，不为未来假设建体系 |
| 替换 | resolveBranchFields、applyIllegality 对低优先描述的前置 veto | D3 字段优先级与被采用值校验 |
| 替换 | detailedFromResolver 仅 serving 才 matched、diagnostics 的字段再计算 | 由唯一 resolver 输出实际来源 |
| 合并 | capabilities.ts 的独立投影、modelsdev.ts 旧 reasoning/price/identity helpers、evidence.ts 重叠 resolver | 先做公共导出使用清点；src/index.ts export *，不能未经兼容检查直接称死代码删除 |
| 保留 | public build/diagnose/publication 入口、ModelSpec、分组、模式过滤、协议映射边界、refresh coordinator | 不新增 pipeline，不改变安装模型 |
| 保留 | endpoint/credential 作用域、关键完整性、明确 false、非正限制防线、通知只抑制重复 | 实际准确性与隔离风险 |
| 替换测试 | “无 proof 不可取档位”、价格变化拒绝 LKG、272k cap | 正向自动匹配 + 身份/SKU 负向 + 价格变换不影响准入 |

## Risks / Trade-offs

| 风险 | 应对 |
|---|---|
| 目录本身错误或跨版本 relation 变化 | 固定公开 fixture；同级关键冲突拒绝；每个反例保留 exact identity |
| 官方 API 别名与 canonical 名不同 | 只信 explicit relation，官方多候选按关键事实比较；不增加模型名表 |
| 静态 owner 别名数据维护 | 仅组织级、小表、来源链接；缺失允许后两级，不要求用户补配置 |
| Pi 有隐式默认档位、budget API 不可按模型注入 | 真实 Pi picker + 请求体断言；不能靠 reasoning=false 或虚构预算通过 |
| schema 升级时离线启动暂无旧目录 | 一次成功刷新重建；清楚显示“需刷新元数据”，不回放已知错误配置 |
| LiteLLM-only 保留路径仍有限 | 只接受明确同维度数据；缺 context 就 withheld，不用价格阶梯或 max_input 造值 |
| 修改公开 helper 类型可能影响独立消费者 | 兼容包装委托新 resolver，package/type 测试；需破坏性移除时在实施 PR 明示 |
| 把参考能力当上游实际承诺 | 元数据来源和实际调用是不同问题；真实调用失败按宿主网络错误报告，禁止重引 serving proof |

## Migration Plan

1. Review 三仓库 proposal/design/deltas；本阶段 tasks 中实现与验收保持未完成，archive 不动。
2. 获准后实施 Core 与反例测试，同步 testing-standard §8/ADR/README；类型、Bun、构建、package、strict、closure 全通过，独立 PR 审核后授权合并。
3. Pi 再 OpenCode 各自用同一个已合入 Core 完整 SHA 更新 dist/provenance，运行映射/缓存/UI 与真实宿主门禁。设计 PR 不作为可安装修复版本。
4. 每个新 Scenario 回填自动化证据，再按 CLI archive 同步 canonical；历史 archive 不修改、不弱化 closure、不为了通过门禁批量刷新旧快照。
5. 回滚采用上一已发布插件固定 tag；不混合 Core SHA。回滚版本不读取新 schema 快照；保留 endpoint 配置和凭据。任何合并/版本发布须另获用户授权。

## Open Questions

当前 allowlist 只含实际已注册模型，并非真实 /v1/model/info；deployment 分布、base_model 与 route 是否含不同版本还未采集。实施时仅从 AGENTS 规定凭据来源在内存读取并脱敏，若发现冲突按 D1 处理，不偷偷改 16 项 expected。公开 catalog 可变化，fixture 的 digest 与获取日期是验收输入，不承诺未来值不变。Pi 全 null 映射的真实请求行为、OpenCode 默认 variants 合并行为仍需规定的 E2E 证实；若宿主 API 无法表达，必须报告具体宿主限制，不能伪造档位或扩展本设计的信任体系。
