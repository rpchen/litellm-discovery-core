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

## 4. 交付、回归与真实宿主契约

除 Scenario 级测试外，各仓库继续执行自身完整门禁：

- Core：typecheck、Bun tests、build、isolated consumer、OpenSpec；
- Pi：`verify:dist`、typecheck、tests、OpenSpec、package install，以及 **Real Pi host E2E**；
- OpenCode：`verify:dist`、delivery integrity、typecheck、tests、TUI render、clean distribution、OpenSpec、tarball install、fixed Git commit install、delivery immutability，以及 **Real OpenCode host E2E**。

旧测试必须继续通过。真实宿主 E2E 不是 Scenario 级自动化的替代品，而是 Host Adapter 的独立契约门禁；两者同时满足才算完成。

凡变更触及以下任一边界，宿主仓库 MUST 使用受支持的真实宿主版本执行永久 CI E2E，不能只依赖 mock、host-shape fake、直接调用插件 factory、类型检查或“包能安装/入口文件存在”：

- extension/plugin API、context shape、schema 或生命周期；
- provider/model 注册、刷新、卸载与宿主可见模型字段；
- credential/login/integration/auth storage；
- command/RPC/TUI/UI 注册与用户可见宿主行为；
- 宿主自己的 package/plugin installer、Git 固定版本安装与加载；
- 其他一旦宿主 API 改变就可能让插件在真实运行时失效的契约。

真实宿主 E2E SHALL：

1. 固定一个明确支持的宿主版本，并使用该宿主声明支持的运行时版本；
2. 通过宿主自己的 installer 安装当前不可变 Git commit/tag，而不是从工作区直接 import 插件源码；
3. 使用隔离的 HOME/XDG/宿主配置目录，不读取或修改开发者真实配置、credential 或 endpoint；
4. 使用本地 fake LiteLLM 和脱敏 credential 验证宿主契约，避免依赖真实服务与密钥；
5. 至少证明插件被真实 loader 加载、关键 command/integration 存在、provider/model 真正进入宿主、credential 边界成立，以及适用的 activation/lifecycle 行为；
6. 对宿主发布边界继续检查 operational model limits，禁止 `context/output <= 0` 的模型进入真实宿主；
7. 在 release/tag workflow 中对最终不可变交付物重复适用的真实宿主验证，防止 PR/main 通过后 tag 交付路径发生漂移。

当前固定基线：

- Pi：`@earendil-works/pi-coding-agent@0.87.1`，其 Node engine 为 `>=22.19.0`；CI 使用 **Real Pi 0.87.1 E2E**。
- OpenCode：`@opencode/cli@2.0.16`；CI 使用 **Real OpenCode 2.0.16 E2E**。

升级宿主基线版本时，必须先让真实宿主 E2E 在新版本通过，再把新版本写入门禁；不得仅提升 peer/range 声明。

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

新建 proposal 必须使用 OpenSpec 当前要求的标准章节（至少 `## Why` 与 `## What Changes`）；archive 出现结构 warning 不得忽略。新 capability 第一次 archive 后若 canonical spec 的 `## Purpose` 仍为自动 placeholder，必须补写真实 Purpose 并重新 strict validation。

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

## 11. 跨会话事实基线与 retrospective

跨会话继续工作时不得只依赖上一会话记忆。开始任何新规划、修复或发版前，必须重新读取当前事实：

1. 三仓库相关 `main` HEAD、未合并 PR 和最新 tag/Release；
2. Core `AGENTS.md`、本标准以及相关 canonical OpenSpec specs；
3. `openspec/changes/` 是否只保留真正 active change；
4. Pi/OpenCode `dist/core-provenance.json` 是否与预期 Core SHA 一致；
5. README 中“当前固定版本”、安装/升级示例、release notes 链接是否与最新 Release 一致；
6. 若问题来自真实宿主反馈，必须先把症状转成可失败的回归测试，再修改实现。

会话结束前必须做一次 retrospective review，至少回答：

- 这次问题是具体模型/具体 UI 个例，还是应该抽象成通用不变量；
- 是否存在“规范已经写了，但代码只对一个特例成立”的情况；
- 是否存在“代码/Release 已更新，但 README、OpenSpec、dist provenance 或 tag 仍是旧状态”的漂移；
- 临时 workflow、一次性 release branch、生成目录是否已经清理；
- 下一会话需要记住的长期经验是否已经写入权威文档，而不是仅停留在聊天记录。

### 单一 Core 选择原则

一次插件“更新 Core”的构建必须从头到尾使用**同一个解析后的 Core SHA**。禁止出现：

- `build:dist` 跟随当前 Core main；
- 后续 typecheck/test/verify 又通过环境变量固定到另一个旧 SHA。

正确做法是：更新步骤解析一次 SHA并写入 provenance；之后所有复验从该 provenance 使用同一 SHA。若临时 CI 需要显式 SHA，则构建本身也必须显式使用同一个 SHA，不能混用 follow-main 与 pin-SHA。

临时维护 workflow 应尽量幂等：例如 change 已被并发/前序运行 archive 时，后续重试不得仅因 active change 已不存在而失败。

## 12. 多 endpoint 隔离不变量

PR9 及后续多 endpoint 能力必须把 endpoint ID 视为稳定的隔离边界，而不是展示标签：

- 显式 endpoint ID 必须匹配 `[a-z0-9][a-z0-9-_]*`，由用户定义、稳定、唯一；宿主不得静默改写 ID。
- 两个 endpoint 即使 URL、credential 或模型清单相同，也必须拥有独立的 snapshot、refresh/cache/singleflight/backoff、diagnostics 与 destructive-failure 状态；共享 Core 允许复用纯算法，但不得共享 endpoint runtime state。
- 401/403、logout、URL 变化、停用或单 endpoint 网络失败只能影响目标 endpoint。任何跨 endpoint 清空模型、污染 snapshot 或共用 backoff 都是回归。
- activation 是宿主插件状态，不属于 Core，也不应写回用户 endpoint 配置；停用 endpoint 不发现、不轮询、不注册 provider，但可保留其可信 snapshot、credential 与历史 diagnostics。
- legacy 单 endpoint 与显式 multi-endpoint 模式不得在一次配置解析中混合。兼容路径必须保持旧 provider/credential/snapshot identity，禁止为了新模式强制迁移旧用户。
- 多 endpoint 新能力的 Scenario evidence 至少包含：同 URL 双 endpoint 隔离、单 endpoint auth destructive failure 不波及其他 endpoint、0 active、activation 立即生效，以及 diagnostics 不泄漏 URL/Key/raw error。
