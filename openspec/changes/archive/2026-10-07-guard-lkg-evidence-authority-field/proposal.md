# Guard the Persisted LKG Evidence Authority Field

## Why

PR #29 第三轮 review 的最后一个代码 blocker：`LastKnownGoodEntry.evidenceAuthority` 已是 schema 7 的语义必备字段，但 `isLKGEntryCompatible()` 未校验它——一条 `schemaVersion = 7` 且 `evidenceAuthority` 为 undefined / 未知字符串的损坏 persisted entry 仍可通过 compatibility guard，并因 `undefined !== "fallback-serving"` 绕过 fallback-serving 的 outage fail-closed 策略。missing/unknown authority 绝不允许默认为 authoritative。

## What Changes

- 新增 `isPublicationEvidenceAuthority(value)`：仅接受 `"authoritative-intrinsic"` / `"fallback-serving"`。
- `isLKGEntryCompatible()` 必须校验 `evidenceAuthority`；
- `validateLastKnownGood()` 增加 defensive fail-closed（防止未来调用方绕过 compatibility guard，reason 明示 authority）；
- 回归：schemaVersion=7 + missing/invalid authority → incompatible；corrupted authority LKG 走 outage 路径 → 永不 configured-lkg；revert guard 后测试失败。

## Impact

- Affected specs: `publication`（MODIFIED）
- Affected code: `src/core/publication.ts`、`test/core-publication.test.ts`；不触碰已 review 通过的其它逻辑