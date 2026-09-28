# Testing Standard

本文件定义 LiteLLM Discovery 三仓库（Core、Pi、OpenCode）共同采用的测试与验收标准。它是测试治理的权威来源；宿主仓库的 `AGENTS.md` / `CONTRIBUTING.md` 必须执行本标准，不得以“CI 已通过”替代 Scenario 级验收证据。

## 1. 完成标准：Specification Scenario Coverage = 100%

每一个 OpenSpec `Scenario` 都必须能映射到至少一个自动化测试或自动化交付验证，并且能够回答：

> 如果这个 Scenario 被破坏，哪一个测试会失败？

允许一个参数化测试覆盖多个 Scenario，也允许一个 Scenario 由多层测试共同证明；但禁止仅以实现代码、代码审查、类型检查或“相关测试整体通过”作为唯一证据。

PR 描述或变更记录必须提供 `Requirement / Scenario → Test Evidence` 映射。若某 Scenario 暂时无法自动化，必须明确记录原因、人工验收步骤和后续自动化计划；不得静默标记完成。

## 2. 测试分层

### Core：业务语义真源

Core 对共享业务规则负责，重点验证：

- 正常路径、precedence、override、fallback、冲突与 malformed input；
- 边界值、缺失字段和默认值；
- provenance、fingerprint、snapshot、cache 等不变量；
- 新的“解释/包装” API 不改变原业务结果，例如 diagnostics 返回的 models 必须与正常 build 完全相同；
- Core 不进行宿主 I/O、网络、凭据或生命周期操作。

不要求为私有 helper 或无业务意义的代码行追求覆盖率。

### Adapter：状态转换与宿主映射

Pi/OpenCode 不重复测试 Core 算法；它们必须直接测试：

- Core 结果如何映射为宿主状态、注册结果和 UI；
- snapshot / network / memory-cache / stale / auth / config 等状态转换；
- 宿主生命周期、命令、RPC、TUI 和持久化边界；
- 用户可观察结果，而不仅是“函数/命令已注册”。

### 纵向链路

每一个新增用户可见功能至少需要一条自动化纵向 happy-path，贯穿关键边界。例如：

- Pi：fixture → discovery → Core diagnostics → adapter state → command → `ctx.ui.notify`；
- OpenCode：fixture → discovery → ProviderSnapshot → command → RPC event → TUI store/card。

不要求每个失败分支都做 E2E；失败分支优先在 Core/Adapter 层精确测试。

## 3. 负向测试是硬要求

涉及以下边界时，必须有真正注入风险数据的负向测试：

- credential / API key 不泄漏；
- endpoint / 内网地址不泄漏；
- raw error body / exception 不泄漏；
- 不兼容或损坏 snapshot 不恢复；
- auth destructive failure 不恢复危险 stale state；
- cancellation 不被误报为普通失败；
- enrichment（例如 models.dev）失败不阻断主发现；
- 非权威数据源（例如 `/v1/models`）不会被意外引入业务路径。

负向测试必须让敏感值真实出现在输入或异常中，再断言最终持久化/日志/用户输出中不存在；对一个从未进入输入的字符串做 `not.toContain` 不算有效安全测试。

## 4. 交付与回归

除 Scenario 级测试外，各仓库继续执行自身完整门禁：

- Core：typecheck、Bun tests、build、isolated consumer、OpenSpec；
- Pi：`verify:dist`、typecheck、tests、OpenSpec、package install；
- OpenCode：`verify:dist`、delivery integrity、typecheck、tests、TUI render、clean distribution、OpenSpec、tarball install、fixed Git commit install、delivery immutability。

旧测试必须继续通过。真实宿主环境验证只用于自动化难以可靠模拟的 Host API 假设，不得替代自动化 Scenario 验收。

## 5. 覆盖率指标

目标不是 100% line/branch coverage，而是：

1. **100% OpenSpec Scenario Coverage**；
2. 核心业务分支具备充分 branch coverage；
3. 安全与 destructive failure 有负向测试；
4. 用户可见能力至少一条纵向链路；
5. PR 中有可审查的 Requirement / Scenario → Test Evidence。

代码覆盖率可以作为辅助信号，但不得作为“测试完成”的主要判据。

## 6. 用户文档门禁

凡变更会影响用户、集成方或维护者的实际使用方式，README 必须在**同一个 PR**同步更新。包括但不限于：

- 新增、删除或重命名命令、配置项、安装/升级方式；
- 修改默认值、优先级、缓存/刷新/失败降级行为；
- 修改兼容性、迁移步骤、认证方式或用户可见错误语义；
- Core 公共 API、返回结构或消费方式发生变化；
- 任何需要用户“改怎么做”或“需要知道新行为”的变化。

README 更新必须说明“用户怎么用”和“行为与以前有什么不同”，不能只在 OpenSpec、设计文档、release note 或代码注释中记录。

PR 描述必须二选一明确声明：

- `README updated: <section>`；或
- `No README change: no user-visible behavior`。

若 OpenSpec change 包含用户可见 Scenario，tasks 中必须包含 README 更新任务。缺少 README 同步时，即使代码、测试和 CI 全部通过，也不得将该变更视为完成。
