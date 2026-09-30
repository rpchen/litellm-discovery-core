# Design

## 根因

旧脚本只读取 active `openspec/changes/*/tasks.md`，当所有 task 已勾选时要求目录被 archive；它没有读取 `openspec/changes/archive/`，也没有把 archived delta 与 `openspec/specs/` 比较。因此“目录已移动”被错误地当成“canonical 已同步”。

## OpenSpec 1.13.2 语义调查

项目三仓库固定使用 `@fission-ai/openspec@1.13.2`。CLI 的 `archive` 会读取 `changes/<id>/specs/**/spec.md`，按 capability 相对路径合并 delta，再移动完整 change 目录到 `changes/archive/<date>-<id>/`；archive 会保留 proposal、design、tasks、metadata 与 delta 文件。CLI 的内部 parser 识别 `## ADDED/MODIFIED/REMOVED/RENAMED Requirements`、`### Requirement:` 与 `#### Scenario:`，但这些 parser 不是包的稳定公共 API，因此 checker 不依赖全局 CLI 的内部 import。

本次 review 进一步核实了官方 grammar 的明确语义（`dist/core/specs-apply.js` 与 `dist/core/validation/validator.js`）：

- 一个 delta 内的 apply 顺序是固定的：RENAMED → REMOVED → MODIFIED → ADDED，RENAMED 的多对 FROM/TO 按文件顺序生效。因此同一 archive 内的合法链（RENAMED 后 REMOVED/MODIFIED 新标题、链式 RENAMED A→B→C）有官方确定顺序，checker 按此顺序回放并加测试。
- 同一 delta 对同一个 requirement name 的冲突 transition（ADDED+MODIFIED、ADDED+REMOVED、MODIFIED+REMOVED、MODIFIED 引用 RENAMED 的 FROM、ADDED 撞 RENAMED 的 TO、REMOVED 命中 RENAMED 的 FROM、同一 section 内重名、RENAMED 的重复 FROM/TO）被 OpenSpec validation 明确拒绝；checker 同样 fail closed（malformed），不猜顺序。
- REMOVED 只删除 block，之后的 change 可以再次 ADDED 同名 requirement；因此 REMOVED → 后来 ADDED 是合法历史，最终态为 PRESENT（新语义）。
- RENAMED 的 apply 语义是“源标题存在则迁移；源已消失但目标存在视为已同步（no-op）；两者都不存在报错”，checker 的 replay 与此一致。

## 语义模型

- 将 archive delta 解析为 capability、requirement、scenario、operation 语义实体；忽略 Markdown whitespace、requirement 顺序与 scenario 顺序。
- ADDED / MODIFIED 要求 requirement statement 与 scenario 存在；REMOVED 只要求稳定 requirement name。
- **requirement 历史是 state machine replay**：对每个 identity 把 ADDED / MODIFIED / REMOVED / RENAMED 全部当作状态转移，在 `ABSENT` 与 `PRESENT(title, semantics)` 之间回放；终态由整个可证明 chronology 决定，而不是“最后一个带 body 的 semantic state”，REMOVED 不再是脱离 chronology 的布尔值，RENAMED 也不再取 `records` 数组的最后一项。
- 终态为 PRESENT 时 canonical 必须存在该标题且 statement/scenarios 一致；终态为 ABSENT 时 canonical 不得存在该 identity 的任何历史标题。
- **archive chronology 是 Git ancestry 导出的 partial order**，不是全局 total order：比较函数返回 `before / after / same / incomparable / unknown`。同一 introduction commit 是 tie，两个都不是对方 ancestor 是 incomparable，Git 历史不完整/不可用是 unknown；tie、incomparable、unknown 都不产生顺序，绝不用 archive 名、lexical order、文件系统顺序、数组顺序或 timestamp 破 tie。
- 只有当一个 identity 的所有可证明线性扩展都收敛到同一终态时才接受；否则输出 `ambiguous archived requirement history` 并 fail closed。tie 且状态等价可以 PASS，但不计入 ancestry-resolved 统计。
- 测试注入 `OPENSPEC_CLOSURE_ORDER_JSON` 表达 partial order（`groups` 为有序 layer，layer 内无顺序；`edges` 为显式 before 边；可表达 tie 与 incomparable），而不是强迫 total order；非法 fixture（重复 layer、环、未知字段、非对象）fail closed。
- archive 外的旧 root `spec.md` 作为 informational legacy artifact 报告，不当作 delta 静默忽略。
- 三个独立仓库保留同构脚本与同构 fixture，避免引入平级 workspace 依赖；每个仓库 clone 后可独立运行。

## Git history 与 workflow

- introduction commit 通过 `git log --diff-filter=A -- **/spec.md` 的最旧提交确定；找不到提交或 git 不可用一律返回 unknown，绝不误判为 oldest/newest，也不吞掉错误制造 false pass；单 state 的 identity 不需要 chronology，可在 Git 不可用时继续验证。
- 任何运行 closure gate 的 workflow job 都必须 `fetch-depth: 0`（完整 history），否则 chronology 无从谈起：Pi/OpenCode 的 `release.yml` 补齐 `fetch-depth: 0`，并新增静态回归测试守护“调用 closure gate 的 job 必须 `fetch-depth: 0`”。

## 不做

- 不修改 discovery、endpoint、model 或任何 runtime 行为。
- 不更新插件 dist/provenance。
- 不依赖 `../litellm-provider`、core 源码或本机 workspace 目录。
- 不 rewrite 已进入 main 的 archive；本 change 自己的 archived delta 可随本 PR 一起更新。
