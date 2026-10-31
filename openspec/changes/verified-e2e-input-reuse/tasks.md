# Tasks

## 1. Core 共享政策措辞

- [x] 1.1 在 `docs/testing-standard.md` 第 4 节新增 `### 4.1 真实宿主 E2E 输入复用（已验证基线）`，写明两种允许形式、基线有效性、完整 Git 输入比较、当前交付验证、如实汇总、未知即完整、发行侧责任保留。验证：`npm run validate:spec` 通过，且通读 4.1 与 proposal/design 的措辞一致。
- [x] 1.2 修正第 4 节宿主基线段落：改为"每轮解析一次 `latest` 并记录精确版本 + host lock，门禁名 Real Pi latest E2E / Real OpenCode latest E2E"，删除 `0.87.1` / `2.0.16` 这类会失真的硬编码。验证：`grep -n '0\.87\.1\|2\.0\.16' docs/testing-standard.md` 只剩历史证据行（第 8 节带运行链接的 PR #55/#63 记录）与 Pi 历史验证版本及运行时说明，无"当前固定基线"式声明。
- [x] 1.3 在第 4 节第 7 条与第 10 节 Release 闭环门禁写明实际状态：Pi Release 在 tag 上执行真实宿主 E2E；OpenCode 当前 tag 工作流没有真实宿主 E2E（如实记录、不新增要求）；Pi 附件回读缺口（只回读索引快照，tarball/checksum 与解包 `dist` 核对仍属发行验收责任）。验证：通读第 4 节第 7 条、4.1 末段与第 10 节第 7 段，三处表述一致且无新增门禁要求。
- [x] 1.4 在 Core `docs/decisions.md` 记录本轮决策（含无 API/src/dist 变化、adapter 各自立 change、合入顺序）。验证：条目存在且指向 `docs/testing-standard.md` 第 4.1 节。
- [x] 1.5 补齐 OpenSpec 变更件：`proposal.md`、`design.md`、`specs/cross-repository-verification/spec.md`、本 `tasks.md`。验证：`npx openspec validate verified-e2e-input-reuse --strict --no-interactive` 与 `npm run validate:spec` 均通过。
- [x] 1.6 声明 `No README change: no user-visible behavior`（本变更只改维护者流程文档，不改变 Core 公共 API 或插件用户使用方式）。验证：proposal 的 Capabilities/Impact 与本节均无公共 API 变化，`git diff --stat` 只含 `docs/` 与 `openspec/changes/verified-e2e-input-reuse/`。

## 2. workspace 协调约定（另一仓库、另一 PR）

- [x] 2.1 `.agents/skills/cross-repo-change/SKILL.md` 第 7 步改为只引用 Core `docs/testing-standard.md` 第 4 / 4.1 节为唯一共享权威，删除硬编码 `Pi 0.87.1` / `OpenCode 2.0.16`。验证：`grep -n '0\.87\.1\|2\.0\.16' .agents/skills/cross-repo-change/SKILL.md` 无输出。
- [x] 2.2 在 workspace `docs/decisions.md` 记录跨仓库复用约定：权威在 Core、每 PR/main 常规 CI 与准确 main 索引不变、Pi tag 完整 E2E 与附件一致性责任保留、OpenCode tag 无真实宿主 E2E 不声称不新增、并行 PR 合入顺序。验证：条目存在且不复制 Core 细则。
- [x] 2.3 在 SKILL.md 第 11 步补充"共享政策措辞先合入、并行 PR 互链并写明顺序、权威文本合入前不得声明政策生效"。验证：通读第 11 步，且不新增合并/发版授权。
- [x] 2.4 workspace 侧范围核对：只改上述两个文件，不动根 `AGENTS.md`、子仓库与 adapter 治理文件。验证：`git status --short` 仅这两个路径为修改。

## 3. 真实证据与收口（父会话验收）

- [ ] 3.1 adapter 实际运行证据：OpenCode 与 Pi 各自 change 落地后，取得完整矩阵基线与复用分支的真实 CI 运行（含 host input/host lock、run/attempt、job 与全部步骤），并附运行链接。验证：运行可回读且与 4.1 的输入面要求一致。
- [ ] 3.2 adapter 负向证据：组失败、取消、意外 skipped、缺组、基线缺失/不匹配、delivery 结果冒充基线，全部不得绿；确认不触发 main 索引发布。验证：单元负向覆盖所有状态，至少一次真实组失败传播；不为每种状态重复运行整套E2E。
- [ ] 3.3 两个 adapter 各自的 `release-governance`/E2E change 与 AGENTS/decisions 引用本政策，Pi tag 完整 E2E 与 Release 责任不变，OpenCode tag 未被声称新增真实宿主 E2E。验证：PR 描述互链并写明 `Core → adapters → workspace` 顺序。
- [ ] 3.4 Core 与 workspace PR 的 CI 通过（Core：`npm run validate:spec`、`npm run test:openspec-closure`；workspace：既有校验），常规 CI 与准确 main SHA 索引发布仍照常。验证：PR检查及未改动的main索引依赖；未授权合并时不要求新main运行。
- [ ] 3.5 父会话验收全部证据后，才勾选 3.x 并通过 OpenSpec CLI archive、同步 canonical spec、再次 strict validation；本轮不得手工移动目录或提前 archive。

### Scenario evidence mapping

| OpenSpec Scenario | Automated / documentary evidence |
|---|---|
| current candidate runs the complete matrix | `docs/testing-standard.md` 4.1 第 1 项；adapter 真实运行记录（3.1） |
| reuse requires matching actual inputs | `docs/testing-standard.md` 4.1 基线条件与"当前交付验证"段；adapter 判定模块与真实复用运行（3.1） |
| any difference or missing evidence runs the complete matrix | 4.1 "差异或证据缺失一律完整运行"；adapter 负向用例（3.2） |
| baselines are complete and never recursive | 4.1 基线与禁止递归条目；adapter 基线校验与负向用例（3.2） |
| aggregate result is reported honestly | 4.1 "汇总必须如实"；adapter 汇总 check 的真实输出（3.1） |
| release obligations are unchanged by reuse | `docs/testing-standard.md` 4.1 末段与第 10 节第 7 段；Pi Release工作流保持不变的Git差异核对（3.3），发行时再做附件验收 |
