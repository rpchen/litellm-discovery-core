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

## 7. OpenSpec 闭环门禁

实现完成不等于 change 已关闭。一个 OpenSpec change 只有同时满足以下条件后才算真正 Closed：

1. 所有 tasks 与 Requirement / Scenario 自动化证据已经完成；
2. 适用的 README 用户文档门禁已经满足；
3. 仓库完整交付门禁与必要的跨仓库兼容验证已经通过；
4. tasks 状态与实际实施状态一致，不得保留已经完成却仍为 `[ ]` 的事项；
5. 使用 OpenSpec CLI 的 archive 流程将 change 合并到 canonical `openspec/specs/` 并移动到 `openspec/changes/archive/`；
6. archive 后再次执行 strict OpenSpec validation。

不得用手工移动目录替代 archive，也不得因为“功能已经合并”而长期把已完成 change 留在 active `openspec/changes/`。active changes 应只代表尚在实施或尚未完成验收的工作。

跨仓库规划必须分别关闭各仓库对应 change：Core 的完成状态不能替代 Pi/OpenCode 的 task 更新与 archive，反之亦然。

## 8. Discovery 元数据优先级与可用性不变量

两个插件的核心价值是让宿主**正确使用模型能力**，不是承担计费职责。实现和评审时必须优先保证 protocol、context/input/output、modalities、tools、reasoning/variants 等使用能力正确。

models.dev enrichment 的记录选择顺序固定为：

1. LiteLLM 显式 `models_dev_provider`；
2. models.dev `canonical_model_id` 可识别且原厂 provider 记录存在时的原厂记录；
3. 仅对缺少 canonical identity 的旧/测试 catalog 使用 legacy family heuristic；
4. OpenRouter；
5. OpenCode；
6. 全局唯一剩余记录；
7. 仍有多个无法消歧的 reseller 时才 unmatched。

不得因为 models.dev 新增了一个模型家族就首先扩充硬编码厂商正则；必须优先利用上游 canonical identity。

价格与能力必须分开判断：

- LiteLLM 显式价格始终优先；
- OpenRouter/OpenCode/其他 reseller 仅因**能力 fallback**被选中时，其价格不得冒充当前 LiteLLM deployment 的真实价格；
- 缺少可靠价格允许为未知/零，不得为了补价格牺牲正确的能力匹配。

Operational limits 是宿主发布硬边界：

- Core 可以用 `0` 表示“未知 limit”，用于 diagnostics/fingerprint；
- Pi/OpenCode **不得把 context/output 非正数的 ModelSpec 发布成可用宿主模型**；
- diagnostics 必须保留该模型并明确报告缺少 operational limits；
- 必须有通用 adapter 测试证明 0/0 模型被阻止，而不是只为某个具体模型写特例。

## 9. 展示层时间与持久 UI

内部 discovery/snapshot/cache 时间保持 UTC ISO 或 epoch；用户可见绝对时间在宿主展示层转换为当前宿主机器时区，并显示明确 UTC offset。测试不得依赖 CI 机器时区，应允许确定性注入。

长期占据会话/TUI 的插件结果必须提供可撤销的展示行为。若存在 polling/latest 恢复机制，dismiss 测试必须证明同一 result/sequence 不会被轮询重新弹回，同时更新的结果仍可重新显示。

## 10. Release 闭环门禁

用户可见 `feat:` / `fix:` 合入后，会话结束前必须检查 tag/Release 是否落后于 main。发布前必须同时验证：

1. `package.json`、lockfile 根版本及包根版本一致；
2. README 中“当前发行版/锁定安装/升级示例”已经更新到目标版本；不能只更新 package version；
3. 需要仓库级 release notes 的仓库已存在对应 `docs/releases/vX.Y.Z.md`；
4. release PR 完整 CI 通过，合并后的 main 同一提交再次完整 CI 通过；
5. tag 只能指向上述已验证 main commit，禁止移动旧 tag；
6. Release workflow 必须从 tag 固定 provenance 复验，不重新追踪更新的 Core main；
7. 发布附件创建后要验证 tarball/checksum；支持的仓库还应回读并比较解包后的 dist；
8. 任何为缺失工具能力临时创建的一次性 workflow/branch 都必须在发布完成后清理，且不能污染 main。

“Release 已创建”本身不是完成证据；最终应记录 tag SHA、main SHA、Release 状态、附件和 Release workflow 结果。

