# Tasks

用户已批准实施；本轮仅推进 Core，未勾选项保持待办。证据见原 T01–T34 与 scenario-evidence.md；T05/T06 已撤回。

## 1. 设计审查

- [x] 1.1 保留既有审计与16名称/公开数据，按规则A–G修订D1–D8、deltas及测试矩阵；删除未经实证的机制。
- [x] 1.2 获得修订设计Review结论；用户已于2026-10-10明确批准进入实施，先完成Core代码Review，获授权合入后再推进宿主。

## 2. 名称与整记录

- [x] 2.1 用model_name与明确models.dev关系替换内部route/base_model和serving证明；按官方→OpenCode→OpenRouter选整记录。T01–T04/T07–T10验证；不实现T05/T06。
- [x] 2.2 删除跨provider/LL字段补齐、候选等价裁决，复用现有完整性与正上限检查；T10/T12/T26保留false/空值、版本/SKU与未知顶层字段兼容。
- [x] 2.3 精确读取所选记录reasoning_options，T13/T14逐模型核对；T11/T15只回归既有协议和Messages映射，不新增冲突阻断或预算推导。

## 3. 价格与缓存

- [x] 3.1 仅选中记录参考价或0；删除operator权威、跨provider价格与tier cap。T16/T17验证价格不影响使用，README说明contextTierCap忽略。
- [x] 3.2 复用缓存入口，保留scope/model_name/有效关键配置/完整性；删除route/base_model/multiset/serving/price证明。按8→9、1→2阻止已知旧错误配置回放，T18–T21/T25验证。
- [x] 3.3 清点公开导出后合并重复算法，必要兼容包装委托同一resolver；T24验证外部消费者，不凭假想使用情况删除API。

## 4. 用户输出与规范

- [x] 4.1 简化默认诊断为配置、来源、推理与实际错误；主动审计保留公开来源和最终配置，T22/T23验证无敏感泄漏。
- [x] 4.2 实施时同步README、testing-standard §8、ADR、OpenSpec context及本deltas；修正Purpose旧proof/degraded说明。T27只检查相关有效规则，历史archive不改。
- [ ] 4.3 回填每个保留Scenario的真实测试名与CI证据；不把设计数据检查作为实现或真实宿主证据。

## 5. 验证与交付

- [ ] 5.1 执行既有typecheck、bun test、build:dist、test:package、validate:spec、closure门禁；记录实际结果。
- [ ] 5.2 Core独立Review且获授权合入后，Pi再OpenCode以同一稳定Core SHA执行T28–T34和真实宿主门禁。
- [ ] 5.3 实现与证据齐全后才按CLI archive新change；合并、finish与版本发布均按既有授权流程，本轮不执行。

实施注记（2026-10-10）：用户已批准非精确官方 canonical relation 别名查找排除 deprecated 的最小修复；精确指定旧 API 保留。T01–T04/T07–T26 定向 50/50 PASS，16项冻结期望全部通过；不修改 oracle、不实施 T05/T06 排序/比较/裁决。4.3/5.1 待完整 Core 门禁与当前 HEAD CI；5.2/5.3 待 Core Review/授权合入及宿主验收，不提前打勾。
