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

### 7.1 Archived delta canonical-sync invariant

Archive closure SHALL also verify the archived delta against the canonical specification. For every archived change that contains specification deltas, automation MUST prove that ADDED capabilities/requirements and MODIFIED requirement/scenario semantics are represented in `openspec/specs/`, and that REMOVED requirements or capabilities are absent. A change directory being moved to `openspec/changes/archive/`, an empty active-change list, or passing `openspec validate --strict` alone is not closure evidence. Malformed or historically unverifiable archive content MUST fail closed or be explicitly reported with an auditable compatibility classification; it MUST NOT be silently skipped.

## 8. Discovery 元数据优先级与可用性不变量

两个插件的核心价值是让宿主**正确使用模型能力**，不是承担计费职责。实现和评审时必须优先保证 protocol、context/input/output、modalities、tools、reasoning/variants 等使用能力正确。

可信 publication 的 identity resolution 只使用可验证关系（canonical catalog 模型）：

1. Canonical registry 精确证明：deployment 限定值精确命中 registry key
  （`qualified-deployment`，含经 `custom_llm_provider` 解析证据确认 adapter
   段后的余串）、裸值在 registry 裸 ID 索引中唯一命中（`registry-unique`）、
   已证明 serving 记录的 `canonical_model_id`（`serving-relation`，只证明
   underlying identity、不解析 SKU）。`0 → 无证明`、`1 → proven`、
   `>1 → ambiguous`。禁止 family/name heuristic、relation fan-out 选择、
   `aliases`/`inherits`/`equivalent_to` 推断（真实 catalog 出现 0 次）。
2. Serving provider 证明：组内所有 deployment 声明同一显式
   `models_dev_provider` 且该 provider 存在于 catalog。LiteLLM 适配器前缀
   （`openai/` 等）、`custom_llm_provider`、`api_base` 永不证明 namespace 或
   serving。Canonical identity known ≠ serving provider known。
3. Serving record（SKU）证明：已证明 provider 内 key/id 精确命中解析后的
   wire id。仅 relation 指向 canonical 的记录（`-free`/`-fast`/`:thinking`/
   tier 变体）永不解析 SKU（`serving-record-unresolved`，整组按未证明解析）；
   多条 exact 候选事实实质不同 → `serving-ambiguous`；无候选 →
   `declared-unmatched`。
4. 未证明的 provider 记录（OpenCode、OpenRouter、unique、first-party、同名精确
   匹配、变体）永不提供任何发布事实，只作诊断候选（OpenCode → OpenRouter →
   其余排序）；未登记模型只能经已声明 serving 记录或完整 LiteLLM 声明发布。
5. 仍有多个无法消歧的 identity 时保持 `ambiguous`，不得强行选择；
   canonical/serving 两边确定性证据指向不同 registry key 时一律 identity
   conflict、fail closed（事实相等不构成等价）。

**Canonical Model Identity、Serving Provider Selection、Serving Record Selection
是三个概念**：identity 来自 registry 精确命中；provider selection 只由运维者
显式声明证明；record selection 只由 provider 内的精确 wire-id 命中证明。
未证明记录（含同名精确匹配）只进 diagnostics，不进入 resolution、ModelSpec、
gate 或 LKG。

模型名字、family substring、邻近型号和经验规则不得参与可信 publication identity resolution，也不得据此推断 tools、reasoning、modalities 或 limits。若历史非发布兼容 API 仍保留 family-name helper，它必须与 `selectModelsDevRecord` / `selectModelsDevRecordDetailed` / `assessModelConfiguration` / `buildPublicationResult` 隔离，且不得影响 `configured` 判定。

长期不变量：

- **证据来源权威（source authority）**：canonical identity 经 registry 精确证明是
  models.dev 内禀事实具备高权威的**前置门禁**；serving 事实还需要 serving
  provider + record 双重证明。identity 为 `ambiguous`/conflict 或缺少正面证据时，
  models.dev 不下发权威，字段按 serving-unproven 分支回落到 canonical/LiteLLM
  证据与 tri-state 语义。
- **必须区分四类事实**：
  - 模型内禀事实（context / output / input capacity / modalities / vision / audio / video / pdf / tools / reasoning）：canonical identity 可靠时以 registry entry 为高权威；LiteLLM `model_info` 中的同类字段是 declared-observable secondary evidence；
  - serving 事实（上述字段的 serving override、`cost`、`reasoning_options`）：只来自已证明 serving 记录（provider 声明 + 精确 SKU 命中）；serving 记录是 models.dev 生成完成的最终视图，缺字段永不回填 canonical，只允许同维度 LiteLLM 补缺；
  - Proven Runtime Enforcement：当前证明集**为空**——全部非价格 `litellm_params` 键均为 operator configuration，不收窄、不产生事实、不进 LKG 指纹，也**不参与非法性裁决**（非正值的 operator-configuration 键只进诊断，绝不使模型 `invalid-metadata` 或使 LKG fail closed），只进诊断；晋升单个键需 OpenSpec delta（含 LiteLLM 源码 exact source path + 负向突破测试）；
  - Operator-Declared Pricing（`MirroredPricingParams` 7 个价格键）：独立价格事实（`litellm_params` 先于 `model_info`、多 deployment 取最高），其次已证明 serving `cost`，否则 unknown；永不收窄能力字段。
  - 字段名本身不构成 hard cap；描述性声明不得收窄或否决权威 intrinsic 值。
- **resolved discrepancy 与 unresolved conflict 必须分开**：可裁决差异记录证据后继续 publication assessment，不得报告为 incomplete / invalid / blocked；无法按 authority 裁决的冲突才 withheld。`discrepancy ≠ conflict`、`resolved discrepancy ≠ incomplete`。
- `unknown` 不得自动变成 `false`，也不得自动变成 `true`；多 deployment 聚合不得先丢弃缺失声明再得出 supported/unsupported。
- **跨 deployment 的显式不一致始终是 unresolved conflict**（模型级记录无法证明宿主请求会落到哪条 route），即使存在 authoritative intrinsic 值；authority 只裁决「deployment 之间一致或沉默」与「模型级记录」之间的差异。不得通过过滤缺失值、选择首条 deployment、取最小/最大值或部分 sparse flags 把部分未知/冲突事实提升为 known。
- modality unknown 属于 publication completeness。无证据的 text baseline 不是 confirmed text-only；sparse flag 只证明该维度，不证明整个 direction。有权威完整集合时该 direction 为 known，与之矛盾的描述性 flag 记为 resolved discrepancy。
- **不存在 model-level degraded publication**：`publishable(model)` 只依赖证据，不依赖任何用户确认、acceptance、flag 或 option；Core 不得再提供 `degraded` 状态或 acceptance API，adapter 不得再提供 accept-degraded 命令/RPC。
- withheld 必须给出完整 reason 列表（identity-ambiguous / identity-unmatched / metadata-unavailable / incomplete-metadata / authoritative-conflict / illegal-metadata），并且一个模型 withheld 不得影响同一 endpoint 的其他模型。
- partial catalog（`discovered > 0` 且部分可发布）是正常结果：可发布的模型必须立即进入宿主，无需任何用户动作；`discovered > 0 && publishable = 0` 必须表达为 unusable catalog，adapter 必须让用户能明显看到 endpoint 已连接但 catalog 当前不可用，并提供已有 Retry/诊断入口，不得提供 accept/override。
- previously published 模型变 withheld 必须作为 regression 呈现，且必须与「新模型首次 withheld」区分；withheld 模型恢复后必须自动发布，无需用户批准。
- acknowledgement（若实现）只允许改变提醒状态：fingerprint 只能由 withheld 模型身份与实质原因组成（排除时间戳、retry counter、错误文本细节），完全恢复即清除；它不得参与 publication，也不得以独立 slash command 形式暴露。
- LKG 必须由 Core 重新证明仍满足当前 publication policy：只有本轮完整通过 gate、
  由同一 resolution 投影的 `ModelSpec` 才可成为 LKG（不同时期的事实拼盘永不是合法
  条目）；live 冲突判定只接受 authoritative intrinsic 事实，低权威描述性差异不得
  使快照失效；identity/provider/schema 变化、任何 live illegal limit（按非法性裁决的
  证据来源：`model_info` 描述性声明与 trusted 记录 limit；operator configuration 的
  非正值不属于 illegal limit，见上）整份 fail
  closed；LKG 不得复活 LiteLLM 已不再提供的模型；条目为 schema 8 proof composition
  （逐 deployment 证据 multiset、registry/serving 摘要、逐字段 basis、空 enforcement
  指纹、LiteLLM 指纹），恢复逐组件重证明、整份恢复或整体 fail closed，绝不按字段
  拼接；不设固定 TTL，年龄只作为 diagnostics 信息。
- Provider-qualified model identity MUST retain the provider namespace during trusted group reconciliation; identical unqualified model names under different providers are not the same identity without deterministic metadata proof, and relation reconciliation must be order-independent (connectivity, not directionality).
- Trusted group identity requires positive evidence for every deployment. Absence of a detected conflict is not proof of identity consistency; identity-less deployments must keep the group unpublishable unless deterministic metadata proves their identity, and the aggregate route name (`model_name`) never substitutes for per-deployment evidence.
- LKG identity validation must use the same provider-aware stable identity semantics as live publication and must remain valid even when enrichment sources are unavailable; the provider namespace must never be discarded during LKG matching, and an LKG entry may never prove identity for a live group that cannot prove it itself.
- LKG conflict comparison MUST compare like-for-like capability dimensions; input capacity must not be compared to total context merely because both are token limits, and the latest trusted model-level context/output facts must participate in the comparison.
- Stored LKG evidence and the `ModelSpec` restored from it MUST describe the same critical capability facts (limits, tools/reasoning verdicts, modality sets); an entry whose captured facts diverge from its stored spec is forged and never restores.
- Core 是 publication policy 的唯一业务真源；adapter 不得复制这些判断。

价格与能力必须分开判断：

- LiteLLM 显式价格（Operator-Declared Pricing：`litellm_params` 价格键先于
  `model_info`，多 deployment 取最高）始终优先；其次已证明 serving 记录的
  `cost`（仅 LiteLLM 未声明的组件）；registry 无价格，未证明记录永不提供价格；
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
