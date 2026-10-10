# 测试矩阵与验收

全部 T* 是实施阶段必须交付的自动化测试计划，本轮只做目录/设计一致性验证。不能把 evidence/ 的数据断言称为 Core 修复或宿主 E2E 已通过。新 Scenario 精确映射见 scenario-evidence.md。

## 固定输入与逐模型预期

evidence/observed-pi-16.json 是实际 Pi v0.10.0 注册 allowlist；synthetic-discovery.json 用真实名称、已观察协议与合成 canonical identity，不含真实 deployment 结构。modelsdev-subset.json 是公开快照的 59 条记录，包括错误版本、free/pro 别名等反例；expected-16.json 是人工选择公开记录后核对的 oracle，不是新 resolver 的输出。

逐模型完整表见 [expected-16.md](evidence/expected-16.md)。两宿主必须逐项比对 ID、protocol/API/package、tools、所有宿主可表达模态、context/input/output、reasoning 支持和选项、价格默认与来源，不能只断言16/16可见。DeepSeek V4 Pro 是 OpenCode high/max；V4.1 Flash 与两个 GLM 是 low/high/max；7个 GPT 分别读取自己的记录，astra 和6.1-sol没有 none；Kimi K2.7 Code 是 supported+无选项；两个 MiMo 是 toggle-only。

## 通用自动化矩阵

| ID | 输入/变换 | 必须断言 | 计划证据入口 |
|---|---|---|---|
| T01 | 16实际名称、无models_dev_provider、固定public catalog | 16项逐字段等于oracle；GPT不套模板；匹配统计反映实际采用 | Core metadata-priority.test.ts；两宿主publication tests |
| T02 | 官方API id != canonical（deepseek-flash）；MiMo无relation精确owner/id | 成功自动关联；不要求route provider | Core identity tests |
| T03 | 官方/OC/OR齐全；删官方；再删OC；仅任意第三方 | 官方→OC→OR；任意第三方不选；重排输入不改变结果 | Core resolver tests |
| T04 | owner tencent，provider tencent-tokenhub；zhipuai/zai | 组织别名找到官方；无模型名硬编码；主provider顺序固定 | Core owner data tests |
| T05 | 多个官方关系项，相等关键字段但不同价/顺序 | 非deprecated优先；关键等价确定选取；价格不造成歧义 | Core resolver tests |
| T06 | 同级关系项关键能力/选项不同；exact项存在/缺失 | exact项优先；无exact且真实歧义withhold，不按字典序选错 | Core negative tests |
| T07 | model_name-only、transport prefix、大小写、opaque route | 精确身份可用；未知route不是伪冲突；不要求serving证明 | Core wire-id/identity tests |
| T08 | base_model/route/name指向不同canonical；多deployment交叉 | 同组withhold，其他模型发布；错误model_name不能覆盖已知冲突 | Core publication tests |
| T09 | deepseek-v4-pro官方relation指向-0813；free/fast/pro/日期/尺寸 | 不跨版本/SKU；原版选OC；显式SKU保持，不能去后缀 | Core identity negative tests |
| T10 | official tools=false vs下级true；官方缺tools；modalities=[text] | false终止；缺失才下一层；不并集模态；LL低层冲突不veto | Core fields tests |
| T11 | 多deployment协议一致/不一致/显式override | 一致稳定；真冲突withhold；override生效，metadata来源不改调用协议 | Core protocol + 两宿主routing |
| T12 | model_info/params中错误限制、request defaults、支持字段冲突 | 被权威覆盖的不影响发布；仅LL补缺时冲突拒绝；max_input不造context | Core limit tests |
| T13 | reasoning=true、effort各自values；toggle+effort；未知effort值 | 完整读取同条record，无union/模板；宿主不可表达值提示限制 | Core reasoning + host mapping |
| T14 | reasoning=true+[]；true+toggle；true+缺options；false；missing | 四种事实准确；前三种不因无档位拒绝；缺support不能默认false | Core publication + Pi map |
| T15 | false+非空effort、错误options、Messages budget无max/有max/低max | 矛盾数据不发布；不支持的控制不造档位；预算不超过记录 | Core variants + real hosts |
| T16 | 所有价格独立做missing/null/0/负数/字符串/NaN/Infinity/异价 | published IDs/K/variants/LKG/通知不变；值有限>=0，zero不回退 | Core metamorphic test（内存注入非JSON数） |
| T17 | 非零272k阶梯、tiered_pricing、contextTierCap true/false | context/output不变；价格不能创造context；旧配置接受但忽略 | Core/host options tests |
| T18 | 先成功→catalog outage→恢复；LL完整/不完整；价格变化 | 合法LKG不按age失效；完整LL路径独立；无凭空新档位 | Core resilience + hosts |
| T19 | stored cost缺失/非法；关键context/identity篡改；旧schema | 坏价格归零仍恢复；关键损坏拒绝；schema8/1不冒充新策略 | Core snapshot + host restore |
| T20 | 模型删除、identity/协议改变、可信关键冲突；只deployment ID改变 | 删除/冲突不复活；重复/顺序/ID无关变化不破坏LKG | Core LKG tests |
| T21 | endpoint/credential不同，auth401/403，deactivate/reactivate | 不跨endpoint/credential；auth撤下；恢复遵守状态门禁 | 现有security/endpoints tests |
| T22 | 16匹配、部分未配置、catalog失败、onlyidentity命中 | 简洁统计真实；无serving-proof提示；失败指出具体字段 | Core diagnostics + host UI |
| T23 | raw response含secret/URL/route；允许模型名/effort正常 | 默认/导出无敏感复制；allowlist审计保留公开record和真实注册值 | 两宿主audit negative tests |
| T24 | 公开旧helper与主resolver、手写旧ModelSpec缺verdict | 兼容入口不跑另一算法；未知不从variants推断支持 | Core package + host map |
| T25 | catalog缺失/坏shape/providers-only；HTTP transient/empty/auth | 有效LKG或完整LL；缺关键withhold；真实空清单清除，auth清除 | Core catalog + host discovery |
| T26 | canonical registry重名bare、悬空/错误relation、catalog重排 | ambiguous不首项胜出；per-model隔离；稳定排序 | Core catalog tests |
| T27 | 三仓库effective specs + docs/ADR/context/README | 无残留旧权威要求、重复场景；archive bytes不改；closure照常 | strict/closure + review audit |
| T28 | 相同Core SHA/fixture输入两个adapter | 核心事实一致；只允许各宿主API/模态可表达范围差异 | adapter integration tests |
| T29 | 真实Pi 0.87.1读取16模型、picker、不同effort调用 | 全档位精确；none→off；无档位不补默认；请求effort与选择一致 | npm run test:e2e:pi |
| T30 | text/image/audio/video/PDF组合、nontext-only、unknown tools | Pi只表达受支持模态，不假造text；OC字段保真；unknown不变true | adapter mapping tests |
| T31 | Core→state/snapshot→command/RPC→TUI/notify | 元数据来源/档位/withheld原因同一结果；无需models_dev_provider | 两宿主纵向自动化 |
| T32 | Pi restore-only无credential、scope改变、snapshot持久化失败 | 保留既有匿名scope+激活边界；不可绕过新schema；写失败不阻发布 | Pi discovery/endpoints tests |
| T33 | 真实OpenCode2.0.16 installer→Model.Info→picker→请求 | 无默认extra variants；SDK包可解析；Chat/Responses/Messages正确 | Real OpenCode2.0.16 E2E |
| T34 | fixed provenance、隔离安装、dist一致、shared-core源码边界 | 两host引用同一稳定Core SHA；无平级依赖/运行时下载 | verify:dist/package/compatibility |

## 真宿主 E2E，实施阶段执行

1. 准备不可变 candidate commit；Pi 用 `pi install`，OpenCode 用自己的 plugin installer；Node >=22.19.0，隔离 HOME/XDG/PI_CODING_AGENT_DIR。两个本地 fake LiteLLM 分别用合成凭据和不同模型子集，models.dev 响应使用固定 subset。不读取用户配置，不在本轮连接真实服务。
2. 通过宿主真实启动/命令/模型查询取得全部16项（两endpoint合计另设完整单endpoint用例），比较最终宿主注册与 oracle；读取真实picker支持档位。观察Pi `getSupportedThinkingLevels` 只是补充，不能代替实际宿主。
3. 每个模型至少实际初始化并完成一条无工具最小请求；每种声明effort在其模型至少调用一次并捕获本地服务端JSON，断言model原名、协议路径、effort精确值。Chat/Responses均覆盖；另合成Messages effort/budget与reasoning=false模型。无档位模型至少调用一次，确保没有宿主默认effort泄漏；不支持推理时没有推理参数。
4. 注入T16价格变换、catalog outage、恢复、删除模型、auth失败、endpoint切换、重启；检查provider数量、原选择不被替换、持久化、diagnostics/audit/TUI同源。支持无档位、未知options与不支持推理需单独核验。
5. 留存固定package SHA、Core SHA、public fixture digest、脱敏注册diff、可选档位列表、allowlist请求断言、命令/TUI证据与退出码。逐Scenario登记具体测试名/文件/CI run。人工连接真实LiteLLM再核对16名称（需AGENTS规定的内存凭据来源）；若路由身份与合成假设不同，应报告差异，不能改oracle掩盖。

E2E不要求调用计费外部模型来证明“provider是谁”。本地fake服务验证宿主配置与请求映射；真实部署的在线试用仅验证实际服务兼容性，不能成为模型元数据优先级的前提。
