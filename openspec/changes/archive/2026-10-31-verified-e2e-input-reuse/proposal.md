# Proposal

## Why

三个仓库共享的《Testing Standard》只写了"必须有真实宿主 E2E"，没有定义"什么算一次有效的真实宿主 E2E 证据"。实际 CI 已有分组完整矩阵、每轮解析的共享宿主锁与运行记录，但缺少统一措辞：能否引用某一次既有运行、必须比较哪些实际输入、复用后当前候选还必须亲自证明什么。没有这层协议，评审无法判断"同仓库 / 同树 / 同 PR"是否足以少跑一轮完整矩阵，也可能用只跑专项或 delivery 验证的运行冒充完整矩阵，或者反过来把已经成立的成功运行永久作废。

本变更只定义这条共享证据政策，不实现判定或 CI 接入（后者属于 adapter 各自的 change）。

## What Changes

- 在 Core 共享测试标准中新增"真实宿主 E2E 输入复用"政策：每个 PR/main 的常规 CI 与准确 main SHA 的索引发布不变；真实宿主 E2E 允许两种形式——本轮完整矩阵，或**已验证基线 + 当前交付验证**。
- 明确基线有效性：只能是本仓库实际的完整矩阵成功运行（run/attempt、job 与全部步骤成功）；必须逐项核对 candidate 与 harness 的完整 Git 对象、精确宿主版本与依赖锁、运行时、runner 与显式配置；delivery/专项/smoke/取消的结果永远不能作为基线（禁止递归复用）。
- 明确"差异或缺失证据一律完整运行"（fail closed），未知不复用、不默认成功。
- 明确汇总如实：required check 展示本轮真实交付验证结果与被复用运行的 run/attempt、比较依据，不得声称本轮跑过完整矩阵。
- 保留发行侧既有责任：Pi tag 继续完整真实宿主 E2E；Pi Release 附件一致性仍是发行验收责任（tarball/checksum 与解包 `dist` 回读尚未自动化）；OpenCode 当前 tag 工作流没有真实宿主 E2E，本政策既不声称也不新增该要求。
- 修正与当前 CI 不一致的宿主基线措辞：宿主精确版本以每轮解析并记录的输入为准，删除易过期的硬编码版本号。
- 跨仓库协调文件（workspace `cross-repo-change` skill、workspace `docs/decisions.md`）改为只引用本文件为唯一共享权威，删除其中硬编码的宿主版本号，并写明并行 PR 的评审/合入顺序。
- **无代码影响**：不改变 Core 公共 API、`src/`、`dist/`，不改 adapters 的 `dist/core-provenance.json`，无需重建产物。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cross-repository-verification`: 增加"已验证真实宿主 E2E 输入复用"要求，规定可复用基线的实际输入比较、必须完整运行的条件、汇总如实性，以及发行门禁保留的义务。

## Impact

- Core 文档：`docs/testing-standard.md`（第 4 节新增 4.1、宿主基线措辞、第 10 节附件缺口）、`docs/decisions.md`。
- workspace 文档：`.agents/skills/cross-repo-change/SKILL.md`、`docs/decisions.md`（另一个仓库、另一个 PR）。
- Adapter 侧：Pi / OpenCode 各自的 `release-governance` 与 E2E change 引用本政策并自行立 change；本轮不改 adapter 文件、workflow 或代码。
- 运行时/构建：无。插件无需更新 Core SHA，`dist` 与 provenance 保持现状。
- 评审/合入顺序：Core 措辞先合入（唯一权威），adapter change 与 workspace 协调文件随后；并行 PR 必须互链并写明顺序，在 Core 权威文本合入前任何一侧都不得声明政策已在主干生效。本 agent 不合并、不打 tag、不发版。
