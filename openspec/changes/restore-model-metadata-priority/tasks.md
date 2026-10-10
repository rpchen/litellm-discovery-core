# Tasks

本阶段止于设计 Review。下列未勾选项是获批后的工作，不代表当前实现已改变；计划证据对应test-matrix.md与scenario-evidence.md。

## 1. 设计与输入冻结

- [x] 1.1 完成58个current spec、源码/测试/宿主审计，交付audit、inventory、基线与脱敏16名称/公开目录oracle。
- [ ] 1.2 获得本设计Review结论并记录决定；不得在此之前执行2–5。

## 2. 身份与元数据

- [ ] 2.1 替换resolveServing/proof路径为D1–D3；将设计输入移入正式test/fixtures，T01–T10/T26覆盖公开名称、官方API别名、owner别名、canonical版本/SKU与顺序无关。
- [ ] 2.2 精简字段解析与LL补缺，保留missing/false和同维度限制；T10/T12/T30验证低层数据不veto及未知不可伪造；同步README与testing-standard §8身份/能力段。
- [ ] 2.3 按同记录reasoning_options生成控制，T13–T15分别覆盖全部GPT、DeepSeek/GLM、支持无档位、不支持及Messages budget；文档明示无模板。
- [ ] 2.4 消除明确deployment协议冲突的Chat猜测，T11覆盖override与正常默认；同步协议契约说明。

## 3. 价格、准入与恢复

- [ ] 3.1 删除price authority/最高LL价/价格tier cap，仅三层参考价→0；T16/T17变换测试证明published/K/档位/通知不变，README说明contextTierCap废弃。
- [ ] 3.2 实现D6最小schema9 LKG与schema2snapshot，删除多重proof/price digest；T18–T21/T25涵盖迁移、坏cost恢复、关键篡改、删除、身份/协议/endpoint/auth边界；更新缓存文档。
- [ ] 3.3 移除重复resolver，逐一清点src/index.ts公开导出并保留必要委托包装；T24外部消费者及类型测试验证没有第二算法。

## 4. 诊断与规范一致性

- [ ] 4.1 让diagnostics从同一resolution给出用户摘要与allowlist开发来源；T22/T23验证matched定义、缺口、无provider证明提示和敏感输入不泄露。
- [ ] 4.2 按本deltas同步canonical，新增ADR supersede旧优先级/proof并更新testing-standard §8；修正publication Purpose过时degraded描述。不得修改任何历史archive；T27审计effective specs、重复场景、旧规则残留。
- [ ] 4.3 对每个新Scenario在scenario-evidence.md填入真正测试文件/名称/CI运行，保留身份、安全与故障负例；设计验证不得充当实现证据。

## 5. 集成与审核

- [ ] 5.1 运行npm run typecheck、bun test、npm run build:dist、npm run test:package、npm run validate:spec、npm run test:openspec-closure；记录退出码与差异范围。
- [ ] 5.2 核验两宿主兼容计划引用同一Core完整SHA；Core独立PR审查并仅在明确授权后合入，finish_codebase_task确认main/index一致。
- [ ] 5.3 Pi再OpenCode固定已合入Core SHA完成T28–T34与真实宿主门禁；三仓库结果齐全才称跨仓库修复完成。
- [ ] 5.4 实现完成后按CLI archive本change，strict/closure再次通过；历史archive不可更改，版本与Release另获授权。
