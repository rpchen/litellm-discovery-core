# Design

## Context

现状（读自当前源码与工作流，不是方案推断）：

- OpenCode CI 已把完整场景拆成 4 个独立 job（`Real OpenCode latest E2E group A`…`D`）加汇总 job `Real OpenCode latest E2E`；`resolve-host` 每轮解析一次 `latest`，在私有 npm 项目里生成共享 host lock，各组按同一锁安装并核验宿主命令来自该前缀。
- Pi CI 是单 job `Real Pi latest E2E`，用 `git:github.com/<owner>/<repo>@<sha>` 安装不可变候选；Pi Release 在 tag 上再执行一次真实宿主 E2E；OpenCode Release 只做 tarball/Git 安装、TUI、delivery 等检查，没有真实宿主 E2E。
- OpenCode 侧已有纯判定模块（`scripts/e2e-inputs.mjs`：Git 输入比较、基线与宿主输入检查，fail closed），但**尚未接入 CI**，也没有任何 run 被追认为可复用基线。
- Core 无运行时依赖、不引用宿主 SDK；共享质量权威只有 `docs/testing-standard.md`。
- 约束：本变更是政策文档，不改 `src/`、`dist/`、provenance，也不改任何 adapter 文件。

见 proposal.md - Why 了解动机。

## Goals / Non-Goals

**Goals:**

- 用一份权威文本定义"可复用的真实宿主 E2E 证据"，让两个 adapter 与工作区引用同一措辞，不再各自解释。
- 让"完整运行还是复用"在评审中可核对：输入面、实际运行事实、当前候选的交付验证、如实汇总。
- 消除文档与现行 CI 的漂移（硬编码的宿主版本号）。

**Non-Goals:**

- 不在 Core 实现比较/记录 CLI、GitHub run 回读或基线下载（属于 adapter 的后续实现 change）。
- 不设计跨仓库缓存、独立证明服务、通用 CI 缓存，也不为省时间削弱常规 CI。
- 不改 required check 名称、ruleset、main 索引发布路径。
- 不为 OpenCode tag 新增真实宿主 E2E；不宣称 Pi Release 附件回读已经自动化。
- 不改任何 adapter 的代码、工作流、规格或 AGENTS。

## Decisions

### D1. 政策放在 Core 共享标准，而不是 adapter 规格

- **理由**：三仓库共享质量权威只有 `docs/testing-standard.md`；adapter 的 `release-governance` 描述各自门禁，不应各自重写一遍共享证据定义。
- **备选**：在两个 adapter 各写一份细则 → 必然出现两份措辞并再次漂移，正是本变更要消除的问题。

### D2. 复用是证据政策，不是新的证明机制

- 只承认两种形式：本轮完整矩阵，或"已验证基线 + 当前候选真实交付验证"。不引入通用缓存、独立证明服务或跨仓库基线。
- **理由**：用户批准的分流目标只是减少同一完整矩阵的无意义重复；任何新的证明平台都会扩大范围且无实际需求支撑。

### D3. 基线必须来自本仓实际完整运行，且禁止递归

- 只有 run/attempt、所需 job 与全部步骤成功、自身就是完整矩阵的运行才是基线；delivery/专项/smoke/取消/失败结果永远不能当基线。
- **理由**：只信任记录文件（receipt）可以被伪造或过期；回读实际运行是唯一不依赖自证的证据。delivery 结果若可作基线，就会形成"用专项结果冒充完整矩阵"的递归捷径。

### D4. 输入面以完整 Git 对象 + 实际宿主锁/运行时配置为准

- candidate 与 harness 分别比较完整 `ls-tree`（路径、mode、type、blob、增删），不做 diff 相似度推断，也不交叉混用。
- 允许的差异只有版本/发行元数据类字段（根 `version`、lockfile 根版本、`runtime-identity.json` 的 `pluginVersion`、README 与对应 release notes）；其余 tracked 路径、mode/type、产物字节、`dist` 其余文件与 provenance 必须相同。
- 宿主侧必须精确版本、实际依赖锁、Node/npm、OS/arch、runner 与固定配置一致；不同、缺记录或存在锁外无法约束的可变下载则不复用。
- **备选**：只比较 `artifactDigest` 或路径 allowlist → 允许未记录的内容/模式变化通过，实际发生过同类风险，不采纳。

### D5. 当前候选仍要亲自证明交付可用

- 真实 installer/loader 安装并加载当前候选、Runtime Identity 与 provenance 对应当前候选、provider/模型真正注册、至少一次真实请求成功。
- **理由**：基线证明"行为矩阵在这个输入面上已通过"，不能证明"当前交付物能被真实宿主装上并跑通"；版本号/发行元数据变化恰好最可能破坏后者。

### D6. 汇总如实，不以绿色冒充完整

- required check 只反映本轮实际结果；复用必须展示基线 run/attempt 与比较依据，并说明完整矩阵由该次运行承担。

### D7. 发行侧责任原样保留

- Pi tag 完整真实宿主 E2E 保留；Pi Release 附件（tarball/checksum 与解包 `dist`）回读缺口继续作为发行验收责任明确保留。
- OpenCode tag 目前没有真实宿主 E2E：政策不声称它有，也不在本变更新增该要求（无依据的产品扩张）。
- **理由**：分流只针对 PR/main 的完整行为矩阵；发行边界与已存在的自动化缺口属于既有责任，不能借本次措辞被淡化或虚构。

### D8. 宿主版本措辞改为"每轮解析并记录"

- 现行事实：Pi 运行开始时 `npm view …@latest`，OpenCode `resolve-host` 解析 `latest` 并生成 host lock；文档中 `0.87.1` / `2.0.16` 已不是当前门禁版本。
- 改为描述机制（解析一次、锁定、记录、门禁名称），具体版本以 host input 与运行日志为准；保留"一次运行内固定一个明确受支持版本"与"新版本先完整通过才能作为基线"的要求。
- **备选**：继续写死版本号 → 每轮 CI 实际版本不同，文档必然再次失真。

### D9. 并行 PR 的评审/合入顺序

- 顺序：Core（权威措辞）→ Pi / OpenCode（各自 `release-governance`/E2E change，互相引用）→ workspace 协调文件。
- **理由**：adapter 与 workspace 都引用 Core 的唯一权威文本；在 Core 合入前，任何一侧都不能声明政策已生效。三者并行评审、PR 描述互链并写明顺序；本 agent 不合并任何 PR。

## Risks / Trade-offs

- [文档变更本身不能证明复用行为正确] → tasks 中真实证据项（adapter 实际运行、负向用例、准确 main 索引、PR CI）保持未完成，由父会话验收后再勾选；本轮不 archive。
- [复用被误读为"可以少跑 PR 常规 CI"] → 4.1 正文明确常规 CI、OpenSpec/delivery 门禁与准确 main 索引发布不因复用减少。
- [硬编码版本号再次漂移] → 权威文本只描述"解析一次并记录"的机制；workspace 侧改为只引用本文件。
- [Pi 附件回读缺口被误认为已覆盖] → 4.1 与第 10 节都显式写明仍是发行验收责任。
- [并行 PR 合并顺序错乱，引用尚未合入的政策] → proposal/design/decisions 与 tasks 均写明顺序；由父会话按序合并。
- [复用判定错误导致漏测] → 政策要求 fail closed（未知即完整运行），且负向证据由 adapter change 的 tasks 承担。

## Migration Plan

1. 合入 Core 文档与 OpenSpec change（本 PR）。
2. Pi / OpenCode 各自 change 引用第 4.1 节并在各自 `release-governance` 增量中落地；本变更不触碰它们的实现。
3. workspace `.agents/skills/cross-repo-change` 与 `docs/decisions.md` 同步为"只引用 Core 权威"。
4. 回滚：纯文档，回滚即还原措辞；无数据或产物迁移，无需重建 `dist`。

## Open Questions

（无）本变更不改变 required check 名称、ruleset 或发行边界；实现层面的判定与 CI 接入细节属于 adapter change 的 design，不影响本政策。
