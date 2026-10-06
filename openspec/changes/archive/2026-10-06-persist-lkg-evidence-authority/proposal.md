# Persist LKG Evidence Authority and Original-Record Equivalence

## Why

PR #29 第二轮 review 的两个 merge blocker，属于 `fix-canonical-provider-selection-precedence` / `refine-provider-selection-review-findings` 同一 selector/LKG 责任域的语义补全：

1. **LKG 快照未持久化 evidence authority**：entry 只存 `providerID`/`matchKind`/`selectionSource`，而 `selectionSource = explicit-provider` 既可能 authoritative（record 自带 canonical relation）也可能 fallback-serving（无 relation proof）。restore 侧只按 selectionSource 名单判断，无法区分同一 selectionSource 的两种 authority——explicit-provider without relation 的低权威快照可在 metadata outage 中错误恢复。快照必须按 live 评估**同一 helper** 分级的 authority 持久化。
2. **canonical-original 多 record 未经过 publication-equivalence 裁决**：其它 selection path 都已执行「等价 → 确性 tie-break；实质差异 → fail closed」，canonical-original 仍直接对 materially-different 的 original candidates 做 tie-break，违反 canonical OpenSpec 的 same-provider multi-record 规则。

## What Changes

- `LastKnownGoodEntry` 新增 **`evidenceAuthority: "authoritative-intrinsic" | "fallback-serving"`**，capture 时由与 live assessment 同一 helper（`isAuthoritativeIntrinsic`，经导出的 `evidenceAuthorityOf`）分级，不复制第二套判定；`selectionSource` 保留为 provenance。
- restore policy 改为按 **persisted authority** 裁决：`evidenceAuthority = fallback-serving`（覆盖 OpenCode/OpenRouter fallback、unique-match、legacy compatibility、explicit-provider without relation）且 live selection 无法重新证明（metadata outage 中 `selected = undefined`）或 selection source 已漂移 → fail closed；`authoritative-intrinsic`（canonical-original、explicit+relation、LiteLLM-only 既有快照）按既有 authoritative LKG policy 恢复。
- `PUBLICATION_SCHEMA_VERSION` 6 → 7（persisted shape 增加语义关键必备字段；旧快照 schema-safe 失败，无静默降级）。
- `canonicalOriginalRecord` 复用 `publicationEquivalent`：equivalent → 既有确定性 tie-break（deprecated → modelID 长度 → localeCompare）；conflict **不得 fall-through 到更低 precedence 的 fallback**（否则恰在原厂证据冲突时让 reseller 胜出），本候选直接 ambiguous。

## Impact

- Affected specs: `publication`（MODIFIED）、`discovery-quality`（MODIFIED）
- Affected code: `src/core/publication.ts`、`src/core/modelsdev.ts`；tests 新增 LKG outage 正/负向与 canonical-original equivalence 用例；pricing gate 已有直接 cost 断言
- 不变：precedence 顺序、DeepSeek（canonical-original / 393216 / ≠943718）、无模型特判、无 inference probe、gate 不降低；Change B ruleset 不涉及