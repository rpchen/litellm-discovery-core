# Design

## 根因

旧脚本只读取 active `openspec/changes/*/tasks.md`，当所有 task 已勾选时要求目录被 archive；它没有读取 `openspec/changes/archive/`，也没有把 archived delta 与 `openspec/specs/` 比较。因此“目录已移动”被错误地当成“canonical 已同步”。

## OpenSpec 1.13.2 语义调查

项目三仓库固定使用 `@fission-ai/openspec@1.13.2`。CLI 的 `archive` 会读取 `changes/<id>/specs/**/spec.md`，按 capability 相对路径合并 delta，再移动完整 change 目录到 `changes/archive/<date>-<id>/`；archive 会保留 proposal、design、tasks、metadata 与 delta 文件。CLI 的内部 parser 识别 `## ADDED/MODIFIED/REMOVED/RENAMED Requirements`、`### Requirement:` 与 `#### Scenario:`，但这些 parser 不是包的稳定公共 API，因此 checker 不依赖全局 CLI 的内部 import。

## 语义模型

- 将 archive delta 解析为 capability、requirement、scenario、operation 四元语义；忽略 Markdown whitespace、requirement 顺序与 scenario 顺序。
- ADDED / MODIFIED 要求 requirement statement 与 scenario 存在；REMOVED 只需要稳定 requirement name。
- 将同一 capability 下最终 canonical 中可由 archived history 表示的 semantic state 比较，而不是复制 archived Markdown 文本。
- 当多个历史 archive 在相同日期下没有可靠顺序时，要求 canonical 匹配某个明确 archived final semantic state；无法判定的历史 header 兼容会显式计数并输出。
- archive 外的旧 root `spec.md` 作为 informational legacy artifact 报告，不当作 delta 静默忽略。
- 三个独立仓库保留同构脚本与同构 fixture，避免引入平级 workspace 依赖；每个仓库 clone 后可独立运行。

## 不做

- 不修改 discovery、endpoint、model 或任何 runtime 行为。
- 不更新插件 dist/provenance。
- 不依赖 `../litellm-provider`、core 源码或本机 workspace 目录。
