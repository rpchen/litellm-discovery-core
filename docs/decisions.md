# 架构决策

## ADR-001：独立宿主无关 core

- **状态**：已接受（PR1）
- **决定**：LiteLLM 地址与响应归一化、deployment 分组、协议判定、models.dev 匹配、能力／价格／限制映射、推理变体、ModelSpec 构建和指纹维护在独立仓库中。
- **边界**：core 只接收响应对象、catalog 对象和显式选项，输出中立类型；不注册 provider，不管理凭据，不持久化，不发网络请求，不引用宿主 SDK。
- **理由**：Pi 与 OpenCode 需要相同业务语义，而宿主 API、协议 package 和发行流程不同。独立仓库使后续两个插件可在构建阶段获取 `main` 的实际 SHA 并编译进各自产物，终端用户无需运行时下载 core。

## ADR-002：中立协议和模型类型

- **状态**：已接受（PR1，仍然有效）

`Protocol` 只允许 `chat`、`responses`、`messages`。`ModelSpec` 不包含 `package` 等宿主字段；每个插件在自己的适配层把协议映射到宿主 API。`ModelVariant.settings` 保留中立键值，避免 core 反向依赖插件配置。

## ADR-003：保持既有行为

- **状态**：已接受（PR1，仍然有效）

基线来自 Pi `a3d7487`，并与 OpenCode `96b00f5` 对照。PR1 保留既有模型过滤、保守合并、models.dev 选择优先级、协议冲突回退、价格换算和阶梯上下文截断规则。发现与抽取无关的问题留在来源仓库的后续变更中。


## 开发代码索引（2026-10-02）

已显式选择索引并入库；结构查询优先使用图谱与 coverage。Release 使用固定 0.11.0/full 从不可变 tag SHA 生成附件并回读验证；用户确认客户端下次启动同步发布快照，工作图谱另按当前源码刷新。新仓库不自动索引，不改变插件运行时依赖、discovery 语义、dist/provenance 或发行授权。详细流程见 docs/codebase-memory.md。

## Claude Code OpenSpec 入口（2026-10-02）

按用户要求使用 OpenSpec CLI 1.13.2 初始化 `.claude/skills/`，提供 propose、explore、apply、update、sync、archive 六个工作流。Claude Code 的项目 skill 发现路径是 `.claude/skills/`；不依赖它识别 `.agents/skills/`。生成文件由 CLI 模板维护并入库，`CLAUDE.md` 导入 `AGENTS.md`。仅增加开发工具入口，不改变产品规格或运行时行为。

## 每次合并与新任务的索引一致性（2026-10-02）

用户明确要求每次审核通过并合并的 PR 收尾时，本地与远端索引一致；任一客户端新任务先同步最新代码与索引。该要求替代此前“只按 Release 更新共享快照”的日常策略。已审核源码由 PR CI 生成候选索引，准确 merge SHA 的完整 CI 成功后发布到长期 `codebase-memory-index` 分支，以 source SHA 作为不可变目录。source main 只跟踪 selection.json，原生生成文件在移除 Git 跟踪前备份。finish 取得远端同一快照并校验全部字节，ready 才算完成；prepare 每个新任务都执行，MCP 复用连接不豁免。工作目录未完成工作保留，准备失败不冒充最新。Release 附件继续保留，产品 API/dist/provenance、版本/tag/Release 授权边界不变。

## main 索引同步审核修复（2026-10-02）

本轮修复现有四条 PR 的七类安全缺陷：最终 main 再核验、symbolic branch 保护、SHA 隔离排队、固定干净源码、缓存竞争赢家校验、MCP 项目身份门禁和已选子仓完整回执。保持每 SHA 不可变快照、现有仓库合并/保护策略和产品边界；不合并、不发版、不变更 dist/provenance。MCP 能阻止失败项目的图谱工具访问，宿主新任务的 prepare 调用和任意 shell/编辑器行为仍是文档约定，不能伪称强制拦截。详细协议、来源兼容边界与回归入口见 docs/codebase-memory.md。
