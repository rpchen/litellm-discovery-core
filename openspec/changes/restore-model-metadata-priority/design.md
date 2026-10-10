# Design

## Context

该设计按用户 Review 的规则 A–G 收敛，并于 2026-10-10 获准实施。当前先实施 Core；宿主适配在 Core 经代码 Review 并获授权合入后推进。历史 archive 不改。基线见 baseline.md，公开资料与 Pi SDK 探针见 evidence/source-notes.md。

用户实际 16 个 model_name 已冻结。16 条选中记录的关键能力与 reasoning_options 完整，59 条冻结公开记录未发现本轮曾假设的关键字段缺失；没有跨 provider 补字段的现实需求。证据只能支持它已显示的事实，不能借 Review 创造新的产品限制。

## Goals / Non-Goals

**Goals:** 用 model_name 找到一条正确的 models.dev 记录，准确生成两宿主配置；价格不影响使用。
**Non-Goals:** 调查 LiteLLM 内部路由或真实服务商；拼接 provider 字段；重新设计协议或恢复；新增候选裁决体系。本轮不合并、不归档、不发布；实施只使用已批准规则。

## Decisions

### D1. model_name 是产品模型身份

LiteLLM model_name 原样作为宿主 ID、显示名、请求 ID 及 LKG 模型键。只用该名称查询 models.dev；base_model、litellm_params.model、deployment ID、custom_llm_provider 不参与元数据身份解析或 LKG 有效性。它们即使缺失、改变或与名称不一致，也不能阻止配置。原有协议选择仍可读取其既有输入，见 D6；这不赋予内部路由模型身份权威。

名称查找使用完整 canonical key、唯一 bare key、明确 canonical_model_id 或已确认官方 API 名称关系。沿用非语义大小写规范化，不做 family/substring 猜测，不从内部 route 取别名，不擅自删版本、日期或 SKU 后缀。无法明确关联就沿用现有未匹配诊断，不增加冲突状态。

保留两个实际数据边界：deepseek-v4.1-flash 可经明确 relation 关联官方 deepseek-flash；deepseek-v4-pro 的官方同名记录明确指向 -0813，不是当前未带日期型号，排除后采用 OpenCode 对应记录。这些是目录关系测试，不是运行时模型硬编码表。

### D2. 官方记录识别只使用已确认目录关系

通常 canonical owner 与官方 provider ID 相同。已确认的组织名称差异用少量组织级别名描述，例如 tencent → tencent-tokenhub；zhipuai 为同名主 provider，zai 为已确认的组织别名。资料见 source-notes.md；不含模型名、档位、价格或实际转发证明。

先找明确对应的精确记录，官方 API 名称不同则用明确 canonical relation。组织主名优先，已确认别名只用于找整条记录，不用于补字段。OpenCode/OpenRouter 同样只采用名称/明确关系对应的型号，不把 free/pro 等不同 SKU 当成普通型号。

删除无实证的非 deprecated 排序、关键字段等价比较、字典序代表项和候选冲突裁决。对无法明确对应的记录不猜测，沿用未匹配处理；不新建候选证明系统。

### D3. 官方 → OpenCode → OpenRouter，选一条整记录

按 D1 的 model_name 目标依次查官方、OpenCode、OpenRouter。找到明确对应记录立即选定；只有找不到该模型记录才查下一级。models_dev_provider 无需配置，现有值忽略；实际 serving provider 不参与选择。

从选中记录读取 tools、context/input/output、输入/输出模态、reasoning、reasoning_options、release 和可选 cost。不得再从其他 provider、canonical registry 或 LiteLLM 描述补齐这条记录。false、明确空数组、toggle 是有效声明，不是缺失。未选中记录和 LiteLLM 描述不会覆盖、收窄或阻断选中记录。

沿用现有关键能力完整性与合法类型/正上限检查，不默认制造未知能力；可选 input/release/price 不影响发布。若日后遇到真实关键字段缺失或损坏，先报告实际字段问题，再依据复现评估；本轮不增加字段 fallback、修复状态或恢复层。目录整体不可用和未匹配情形沿用既有诊断/合法 LKG；既有独立 LiteLLM-only 路径不扩展，也不能用来填充已选记录。

### D4. 推理支持与档位分开映射

只读取选中记录的 reasoning 和 reasoning_options：false 为不支持；true + [] 或 toggle 为支持但无可选 effort；true + effort 为支持且使用该记录的真实 values。不得用 GPT 模板、家族或 LiteLLM effort 标志生成档位，也不跨记录补选项。

Pi 的 none → off，其余只映射宿主实际支持的值。未声明档位置 null；支持无档位时全 null 且 reasoning=true。已实测省略 thinkingLevelMap 会让 Pi 补默认档位，全 null 返回空列表；真实 picker 和请求仍需 T29 验收。OpenCode 直接映射 Core variants，通过 T33 验证最终注册和请求不增加档位。

本轮不新增 budget 推导、高低预算生成、未知控制状态或假想 options 缺失恢复；既有 Messages 映射及协议兼容测试保留，不扩张推理控制算法。

### D5. 选中记录的价格，缺失或错误即 0

参考价只来自 D3 选中的那条记录。每个已有宿主价格字段取该记录的有限非负值，否则 0；0 有效。不向其他 provider 补价格，不比较 LiteLLM 价格，不取 deployment 最高价，不证明实际账单。不把 0 文案说成已确认免费。

彻底删除价格阶梯对 context/output 的截断。contextTierCap 暂接受但忽略，实施时在 README 说明废弃，且不再参与恢复有效性。

设 K 为原有发布必需的有效关键能力配置，P 为价格。发布判定 publish(K)、LKG 可用性 reusable(scope, model_name, K, schema) 均不读取 P。T16/T17 只改变 P，必须保持发布集合、限制、档位与恢复结果不变；价格显示可刷新，但不能产生能力退化通知。这是用户要求的边界，不另设价格证明结构。

### D6. 保留已有协议与必要缓存边界

协议选择算法、默认行为、mixed-fallback 和显式 override 保持现状。内部 deployment 协议不同不新增 withheld；元数据来源不决定请求协议。T11 只回归既有行为。

准入复用现有有限正 context/output、明确 tools/reasoning、已知会话模态及宿主可表达边界。false 完整，无 effort 不阻发布。保留按模型隔离、认证失败、成功空清单、取消、瞬时故障和既有端点状态处理；没有新的内部身份/协议阻断。

LKG 沿用现有捕获与恢复入口，保留 endpoint/凭据 scope、model_name、有效关键配置、schema、必要内容校验及来源/时间。删除 serving 声明、route/base_model 比较、deployment multiset、fieldBasis 证明地图、空 enforcement 与价格/整记录证明摘要。内部路由变化不能使同 model_name 的 LKG 失效；价格损坏单独归零。已删除模型不恢复，scope 不同或关键缓存内容损坏按既有检查拒绝。年龄仍仅展示，不新增 TTL 或冲突重证明。

旧快照已保存空档位和价格截断配置，不能当新策略结果恢复。沿用既有 schema 门禁一次升级 publication 8→9、snapshot 1→2，成功发现后重建；不写迁移证明或多层 fallback。离线升级需要一次成功刷新，这个代价在升级说明中明示。

### D7. 用户摘要与主动审计

默认只显示模型是否配置成功、所选元数据来源、推理支持/可选档位及真正影响使用的错误；保留既有 endpoint 状态和运行版本。matched 统计实际采用 models.dev 记录配置能力的模型，不再统计 serving proof。

主动 audit 沿用现有入口，保留 model_name、公开 canonical/record 引用与最终配置；不展示虚构的多来源字段拼接。默认界面删除候选列表、内部 proof 与 models_dev_provider 修复提示。敏感原始响应、地址、凭据不进入输出。

### D8. 删除与保留

| 处理 | 对象 | 简单替代或实际依据 |
|---|---|---|
| 删除 | resolveServing 门槛、serving 声明、内部 route/base_model 身份冲突、deployment multiset | model_name + 一条公开目录记录，用户规则 A/B/G |
| 删除 | 逐字段 provider/LL fallback、候选等价比较/排序/裁决、独立 reasoning 补字段 | 16 条完整选中记录，规则 C；不改名保留 |
| 删除 | operator 价格权威、最高价、跨 provider 价格补齐、firstTierPointOf/applyTierCap/tierPoint | 选中记录参考价或 0，规则 E |
| 删除 | schema8 多重 proof、空 enforcement、price/route 证明摘要 | 复用现有 scope/model_name/关键缓存校验 |
| 撤回 | 新增协议冲突 withheld、预算推导、读取真实路由作为验收前提 | 无实际故障依据；协议保持当前行为 |
| 保留 | 精确名称及版本/SKU、官方已确认 alias | 冻结 DeepSeek relation 与 Tencent owner 差异 |
| 保留 | 正 context/output、明确能力、false/空值语义、关键缓存完整性 | 现有宿主注册约束与基本正确性，不新增状态 |
| 保留 | Pi 全 null / none→off、两真实宿主测试 | Pi SDK 实测默认档位会扩张；用户规则 D |
| 保留 | endpoint/凭据隔离、删除/auth/成功空清单、固定 Core SHA | 既有安全和交付约束，用户规则 G |
| 合并 | 重复 publication/LKG 条款及旧 helper 算法 | 复用单 resolver；公开导出先检查兼容性，不能凭猜测删除 |

## Evidence check

每项非平凡改动的实际问题、依据及较简单处理均在 D1–D8 或上表；没有事实依据的机制已删除，未新建审计框架。准则是：用户明确要求、可复现问题、已核实数据/接口或基本正确性才支持行为；Review 不自行创造 Requirement、Scenario、状态或发布门槛。

保留的基础检查复用当前机制；新增行为只围绕名称、整记录、准确档位、可选价格与已知旧缓存。16 条选中记录完整，因此不为未观察到的缺字段问题提前做 provider 拼接。

## Migration Plan

先 Review，再实施 Core；获准合入后 Pi、OpenCode 使用同一完整 Core SHA 更新 dist，运行原有质量门禁和真实宿主测试。实施时同步 README、testing-standard §8、ADR 和本 deltas，保留正确旧要求（包括 catalog 未知顶层字段兼容），删除旧 proof/字段优先级要求。历史 archive 不改；本次 change 不归档。

## Remaining evidence limits

16 名称与冻结目录足够作为本次匹配基线，无需读取真实 /v1/model/info 证明路由。Pi 全 null 在真实 picker/请求中的行为和 OpenCode 最终 variants 映射是已知接口边界的实施验收项，不是新增产品门槛。Pi 注册接口无独立 tools 位，当前 16 条 tools 均为 true，不阻断本设计；不为此新增全局工具控制。未实施算法不能凭设计数据校验宣称已修复。
