## 1. Core implementation

- [x] 1.1 核实官方文档及用户实际 LiteLLM 1.99.0 Disable/blocked 实现。
- [x] 1.2 添加冻结合成 fixture 和可失败回归，覆盖可见集合、embedding、混合 deployment、增量与 LKG。
- [x] 1.3 分组前排除 blocked=true，更新 README 与隔离公共消费者验证。

## 2. Validation and delivery

- [x] 2.1 通过 typecheck、全部离线测试、build、package、strict spec 和 closure。
- [ ] 2.2 创建 Core PR，记录 Scenario 证据并通过 CI。
- [ ] 2.3 同步 canonical spec、CLI archive 并通过归档后检查。

## 3. Adapter dependencies

Core PR 合入后，Pi 与 OpenCode 需各自建立 change/PR，使用同一完整 Core SHA 更新 dist，并证明真实 provider 移除禁用模型。此依赖在跨仓库任务中继续跟踪，不把 Core PR 成功称为插件修复交付完成。

## Evidence

- `test/blocked-deployments.test.ts`：四项测试修改实现前全部失败，修改后 4 pass / 55 assertions。
- `[BLOCKED-LIST]`：29 条 / 25 个名称的固定合成 deployment 与 15 项可见列表对照；旧实现发布 20 个，修复后 13 个，排除七个 GPT、embedding 与 metadata-missing-chat。数量结构来自用户描述，不是真实服务导出或实测。
- `[BLOCKED-MIXED]`：混合组只保留启用 deployment 和原始 sourceIndex；全暂停组消失，布尔兼容与输入不变性通过。
- `[BLOCKED-REFRESH]`：原始名称不变时识别七项删除；已种入有效 LKG 的暂停 GPT 不复活；diagnostics 与正常构建一致。
- 本地 `npm test`：212 pass / 0 fail，21 files；typecheck、build:dist、隔离 package consumer、strict spec、closure 和 codebase-memory 检查均通过。
