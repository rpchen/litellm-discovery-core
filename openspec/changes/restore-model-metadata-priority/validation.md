# 设计修订验证

本次按用户Review收敛既有设计，不扩大审计范围。下面是修订与设计检查结果，不能替代未实施算法的业务测试。

## Review处理

| 项目 | 结果 / 依据 |
|---|---|
| A / D1 | model_name唯一产品身份；删除base_model/route/deployment身份条件及其LKG失效规则 |
| B/C / D2–D3 | 官方→OpenCode→OpenRouter选第一条明确对应整记录；不跨provider/LL补字段；保留已确认API/组织别名 |
| D / D4 | 只读所选reasoning与reasoning_options；保留三种支持/档位结果和Pi none→off/全null；不扩展预算推断 |
| E / D5 | 所选记录价格或0，删除跨provider补价、价格权威、最高价、tier cap；价格不参与发布/LKG |
| F / D6 | 协议算法/default/mixed-fallback/override不变；删除两宿主protocol-routing delta，T11只回归旧行为 |
| G / D6 | 仅复用scope/model_name/有效关键配置/完整性及版本机制；删除proof/multiset/内部路由条件 |
| D7–D8 / 工作方式 | 简洁用户诊断，主动审计公开来源；非平凡机制依据列在D8；无证据的候选排序/裁决与新阻断彻底撤回 |

## 验证结果

| 检查 | 结果 |
|---|---|
| Core / Pi / OpenCode strict all | 13/13、24/24、24/24通过，0 failed |
| 三仓库closure | 各32/32；历史archive检查均0 mismatches |
| 固定数据一致性 | verify-design.mjs PASS：16名称、59记录；每个期望能力和价格来自同一选中记录 |
| 冻结输入保留 | catalog subset、observed Pi、source manifest字节不变；expected-16全部模型值不变，只更新说明；合成输入删除route/base_model |
| 完整性事实复核 | 59条公开记录的tools/reasoning、正context/output、输入/输出模态均完整；16条选中记录有reasoning_options |
| 有效规则核对 | 复用原inventory/overlay校验，58个规格引用标题准确；26个受影响capability，无跨provider继承与整记录选择矛盾 |
| 正确旧行为保留 | unknown额外顶层字段忽略、False versus unknown、Single resolution、协议回退/override、scope/认证/删除、安装/provenance门禁保留 |
| 范围 | 只修改本change；未改源码、dist、canonical、archive、版本或用户配置 |

T01–T34沿用原编号，T05/T06明确撤回且不再生成Scenario/实施任务。Core重复LKG/字段条款已合并，新增Scenario从71减为40，Pi33→30，OpenCode34→31；数量仅说明删减范围，不作为质量标准。质量由16项实际配置准确性和必要边界决定。

## Retrospective与实际剩余项

原审计定位保留，C20协议阻断结论撤回；其余处理建议同步整记录规则。默认诊断不携带候选/proof，主动导出安全边界不变。临时生成材料仅在workspace忽略的.tmp；无新审计框架、运行机制或永久测试基础设施。

Pi省略map会补档位、全null返回空列表已实测；真正picker/请求行为需要T29。OpenCode现有Model.Info映射需要T33验证最终请求。Pi无独立tools注册位，当前16条tools=true，不阻断此次设计，也不新增工具控制。旧错误配置快照需要一次成功刷新重建，沿已有schema门禁。无需真实/v1/model/info或实际serving证明。

新业务尚未实施；本轮本地只运行适用的设计/closure/数据检查。PR CI结果以对应新HEAD的GitHub运行记录为准，既有宿主E2E通过也不代表新增模型匹配与档位场景已实施。停在Review，不合并、归档或发布。
