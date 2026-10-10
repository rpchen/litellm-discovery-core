# 测试矩阵与验收

本轮修订原 T01–T34，不新增矩阵。以下均为获准实施后的计划；设计数据检查不代表 resolver 或真实宿主 E2E 通过。T05/T06 撤回，保留编号说明，不能继续生成 Scenario 或实施任务。

## 固定数据

真实 Pi 16 个 model_name、observed-pi-16.json、59 条 modelsdev-subset.json 及逐模型 expected-16 的能力值保持不变。synthetic-discovery.json 仅用真实名称和已观察协议构造测试输入，不含或需要 base_model/route 身份线索；不是真实 LiteLLM 响应。expected-16 的 canonical 是从名称匹配公开目录的期望结果。

16 条选中记录均有完整关键能力与 reasoning_options；59 条公开记录未发现本轮讨论的关键字段缺失，不据此发明补字段用例。预期完整表见 evidence/expected-16.md。

## 原矩阵调整

| ID | 输入/验证 | 预期与依据 |
|---|---|---|
| T01 | 16真实名称，无内部身份线索、无models_dev_provider；逐字段对比oracle | 正确记录、能力、限制、推理、同记录价格；用户实际基线 |
| T02 | model_name=deepseek-v4.1-flash；官方deepseek-flash；MiMo精确owner/id | 按公开关系匹配，无路由证明；冻结记录已核实 |
| T03 | 依次移除对应官方记录、OpenCode记录 | 整记录官方→OpenCode→OpenRouter；不做字段fallback，用户规则B/C |
| T04 | Tencent与Tencent TokenHub等已确认组织名称差异 | 组织级别名找整记录，无模型硬编码；source-notes公开依据 |
| T05 | 撤回：非deprecated/关键等价/字典序候选代表项 | 未观察到必要性，删除对应Scenario与任务，不实施 |
| T06 | 撤回：无exact多候选能力冲突裁决及额外withheld | 无实际问题证据，不以Review创造机制 |
| T07 | 仅model_name、完整或唯一bare公开名 | 不依赖base_model、route或transport剥离；不改请求ID，规则A |
| T08 | 同model_name下增删/更改base_model、route、deployment ID；元数据声明变化 | 身份、选中记录、能力不变，无新增阻断；协议按既有算法独立回归 |
| T09 | 冻结DeepSeek V4 Pro官方relation指向-0813；已有SKU负例 | 不跨日期/版本/SKU，原型号采用OpenCode；实际目录反例 |
| T10 | 所选记录与低优先来源能力不同；false、text-only、[]、toggle | 完整使用所选记录；不拼字段、不把明确值当缺失；规则C |
| T11 | 现有多deployment协议/default/mixed-fallback/override用例 | 行为维持当前源码，不新增协议冲突withheld；规则F |
| T12 | 记录context/input/output与LL描述、请求默认不同 | 只用选中记录同维度限制，不以input或价格造context；既有正上限检查 |
| T13 | 每个GPT及DeepSeek/GLM实际reasoning_options | 精确自身values，astra/6.1-sol无none；无模板/补选项 |
| T14 | reasoning=false、true+[]、true+toggle、true+effort | 不支持/支持无档位/支持有档位分别映射；无档位不改false |
| T15 | 既有Messages推理控制与协议映射回归 | 保持已有受支持控制；不新增预算推导、候选控制裁决或假想缺options恢复 |
| T16 | 所选记录价格缺失/0/错误/变化，其他provider和LL价格不同 | 只用所选记录有效价或0；发布/K/档位/LKG与能力通知不变，规则E |
| T17 | 272k价格阶梯、contextTierCap true/false | GPT context仍1050000，输出/档位不变；旧key接受但忽略 |
| T18 | 成功配置→catalog outage→恢复 | 同scope/model_name合法LKG可用，不要求内部身份证明；沿既有恢复 |
| T19 | 价格损坏、关键缓存内容损坏、8/1旧schema | 坏价归0不阻恢复；关键完整性/版本检查保留，旧错误配置成功刷新重建 |
| T20 | model_name不变但route/base_model/ID变化；另测成功清单删除模型 | 前者LKG不失效；后者不得恢复；规则A/G |
| T21 | 现有endpoint/credential隔离、401/403、成功空清单、activation | 既有安全/生命周期行为不回归 |
| T22 | 16项配置与来源、推理摘要；既有目录故障 | 统计真实、错误可读，无proof术语或models_dev_provider配置提示 |
| T23 | 既有审计allowlist与secret/URL/原始响应负例 | 公开记录来源和最终配置可核查；敏感数据不导出 |
| T24 | 公开helper与主入口、宿主明确reasoning映射 | 同一Core语义；保留必要公共兼容，不靠variant数量猜支持 |
| T25 | 现有catalog坏shape/providers-only/网络错误恢复 | 保留既有诊断与合法LKG，未匹配路径不扩展；不创造新fallback |
| T26 | 有效catalog多出未知顶层字段；既有精确名称/SKU回归 | 未知顶层字段被忽略；合理旧输入兼容要求保留 |
| T27 | 本次deltas叠加current specs、README/context/ADR同步计划 | 无整记录与字段继承矛盾，无内部身份/新协议阻断；archive不改 |
| T28 | 同Core SHA和相同fixture进入两个adapter | 核心事实一致，仅宿主实际表达能力不同 |
| T29 | 真实Pi0.87.1注册、picker、逐effort实际请求 | none→off；未声明档位不出现；无effort仍reasoning=true且无默认effort泄漏 |
| T30 | 既有宿主模态/工具能力/正上限映射 | 不伪造text或未知能力；Pi无独立tools位如实报告，当前16tools均true |
| T31 | Core→state/snapshot→command/RPC→UI | 来源、档位、配置与实际错误同源；复用纵向测试 |
| T32 | Pi既有restore-only、scope、重启、持久化失败用例 | 保留激活/隔离；写失败不阻成功发现；不新增恢复状态 |
| T33 | 真实OpenCode2.0.16安装→注册→picker→请求 | 16项Model.Info正确，variants无额外默认，现有协议SDK映射有效 |
| T34 | 固定provenance、独立安装、dist与公共消费测试 | 同一稳定Core SHA，无平级依赖或运行时下载；既有交付标准 |

## 真实宿主 E2E（获批实施后）

1. 用现有真实 Pi/OpenCode 测试入口与各自 installer 安装固定 candidate commit；隔离 HOME/XDG/PI_CODING_AGENT_DIR，复用两本地 fake LiteLLM endpoint 和合成凭据。models.dev 使用冻结 subset，不读取真实 /v1/model/info 证明内部路由。
2. 读取16项最终宿主注册配置和真实picker，逐项核对名称、宿主API、可表达能力、limits、reasoning/variants及参考价；不能只计16/16可见，不能把helper/mock当真实宿主。
3. 每模型实际初始化并发最小请求；每个声明effort捕获本地请求体核对原model_name与精确参数。无effort模型保持reasoning=true且不注入默认effort；不支持推理的既有用例无推理参数。保留现有Chat/Responses/Messages兼容用例，不新建协议裁决。
4. 沿现有恢复测试注入价格变化、catalog outage/恢复、删除、auth、成功空清单、端点切换和重启；T20另外确认内部route/base_model变化不导致LKG无效。检查注册、diagnostics与audit一致。
5. 回填现有scenario-evidence：固定package/Core SHA、fixture digest、脱敏注册差异、picker和请求断言、CI run及退出码。真实16名称已足够作为匹配基线；不要求实际服务商或内部路由证明，不把合成输入验证称为真实宿主E2E。
