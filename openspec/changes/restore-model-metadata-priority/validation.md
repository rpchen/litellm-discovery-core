# 设计验证与审查边界

本change是设计稿；proposal/design/specs/tasks已齐，不表示实现完成。实现任务未勾选，canonical specs与历史archive未修改，保留closure门禁。

| 验证 | 结果 |
|---|---|
| Core openspec validate --all --strict --no-interactive | 13 passed / 0 failed（12 current specs + 本change） |
| Pi 同命令 | 24 passed / 0 failed（23 + change） |
| OpenCode 同命令 | 24 passed / 0 failed（23 + change） |
| 三仓库 npm run test:openspec-closure | 各32/32测试通过；各自archive检查0 mismatches |
| Core verify-design.mjs | PASS；16模型、59公开记录、目录digest与基线校验 |
| 58个规格delta身份/overlay核验 | 378 Requirements / 948 Scenarios盘点；28个受影响capability；引用精确匹配当前标题 |
| Pi实际peer的getSupportedThinkingLevels探针 | 缺map产生5档；全null为[]；不是完整宿主E2E |

初稿用MODIFIED替换旧场景被strict正确拒绝。现在有意废弃整组旧策略的要求均以REMOVED+ADDED明确替代，Reason/Migration写明迁移；保留的Single resolution result、False versus unknown及审计快照要求保留原场景。未禁用检查、未编辑历史、不假定模糊标题等价。新增Scenario全部登记scenario-evidence.md，状态planned。

本轮未运行业务全套、更新构建、package安装或真实Pi/OpenCode E2E，因为没有实施且用户要求停在设计Review；tasks列出未来全部门禁。main/Release/dist不变，无新增版本发布义务。

## Retrospective

| 检查 | 结果 |
|---|---|
| 过拟合 | 16名称只用于测试oracle；运行设计依赖精确身份/组织关系，无模型家族或GPT统一档位表 |
| 复杂度 | 删除serving proof、价格权威/价格cap、空enforcement与多重LKG证明；沿用现有状态/入口，不增加fallback层 |
| 知识留存 | 审计、基线、全部current specs盘点、来源、测试矩阵及宿主差异在本change；实施时再同步正确权威文档 |
| 规范/实现/发布边界 | 明确未实施；旧产品行为仍在；不把planning complete称为产品已修复；新change不归档 |
| 保留/临时内容 | 用户配置/密钥不改；仅新change入库，临时下载与生成工具留workspace忽略的.tmp；无自动化、tag、release或merge |

需Review的实际取舍是：同一记录的reasoning支持/选项原子读取；官方API别名与显式SKU边界；价格脱离全部有效性条件；旧schema一次刷新重建。仍待实施验证的是实际deployment身份、Pi真实picker/请求和OpenCode默认variants行为。Pi缺少模型tools注册位、budget注入受限已单列，不能通过假能力绕过。
