# Tasks

## 1. Finding 1 — unique-match 统一降权

- [x] publication `isAuthoritativeIntrinsic`：unique-match → fallback-serving；LKG `isFallbackSelectionSource` 包含 unique-match；pricing gate 同步
  - 证据：`bun test test/core-resilience.test.ts`「a unique trusted record fills gaps but never outranks descriptive declarations」（gap-fill + conflict 两段）；`test/core-publication.test.ts` LKG outage 用例
- [x] unique-match-sourced LKG + metadata outage → 不得恢复
  - 证据：`test/core-publication.test.ts`「unique-match-sourced LKG never substitutes for lost live metadata」

## 2. Finding 2 — explicit-provider 需要 relation 证明

- [x] authoritative 需要 `canonical-original` 或 explicit-provider + `recordCanonicalID`；`canUseSelectedModelsDevPrice` 同一判定
  - 证据：`test/core-modelsdev.test.ts` finding 6 组「explicit models_dev_provider qualifies the namespace…」（正）与 `test/core-resilience.test.ts` relation-proven fixture（负向：无 relation 的 explicit → fallback-serving 行为）
- [x] 正向/负向测试
  - 证据：上两项 + finding 6 adversarial 用例输出

## 3. Finding 3 — runtime constraint 与 descriptive 分离

- [x] `resolveNumericField`：same-level 判定只用 descriptive 值；constraint 无条件收窄（含 fallback-serving intrinsic）
  - 证据：`test/core-resilience.test.ts` finding 3 numeric regression（500000/100000 → configured/100000/not conflict）
- [x] `resolveBooleanField`：descriptive-only conflict；constraint `false` 收窄（tools=true + `litellm_params.supports_function_calling=false` → unsupported，不 conflict）
  - 证据：同文件 boolean regression
- [x] `resolveModalityField`：descriptive-only conflict；constraint `false` 移除模态（image+serves_vision=false → removed，不 conflict）
  - 证据：同文件 modality regression
- [x] 双 deployment 真实冲突仍是 unresolved conflict
  - 证据：既有「same-level evidence that no authority can decide stays an unresolved conflict」保持通过

## 4. Finding 4 — record-level order independence

- [x] `findMatchesByRelation` 收集 provider 内全部匹配 record；`resolveSingleProviderMatches`：等价 → 确定性 tie-break；实质差异 → fail closed
  - 证据：`bun test test/core-modelsdev.test.ts` finding 4 组（equivalent opencode 顺序反转一致；explicit/unique/openrouter materially-different 顺序反转均 ambiguous）
- [x] 修复 `findMatch` 单命中掩盖多 record 的问题（kind 语义与旧 findMatch 一致）
  - 证据：既有 canonicalization/matchKind 测试保持通过（`kind=exact/canonical/alias` 语义不变）

## 5. Finding 5 — provenance / 消息准确

- [x] modality intrinsic origin 按 intrinsicAuthority 写 `fallback-serving`；numeric/boolean/modality fallback 补缺/收窄消息不再声称 authoritative intrinsic decides
  - 证据：`bun test test/core-resilience.test.ts`（fallback-origin 断言）+ `test/core-diagnostics.test.ts`保持通过

## 6. Finding 6 — adversarial original proof

- [x] 语义冻结（design.md 补充）：reseller relation 不给同 namespace 无 relation record 供 proof；deployment qualified namespace 或 record 自带 relation 才可
  - 证据：`openspec/changes/refine-provider-selection-review-findings`（本 change）specs/discovery-quality「canonical metadata identifies…」MODIFIED + design.md
- [x] adversarial fixture 正/负向测试
  - 证据：`test/core-modelsdev.test.ts` finding 6 组 3 用例

## 7. 全量 gate 与回归验证

- [x] typecheck / build / 全部测试 / package test / OpenSpec validate / scenario coverage / closure gate
  - 证据：本地命令输出 + PR CI
- [x] 回退验证：每个 finding 的关键测试在 revert 对应实现 commit 后稳定失败
  - 证据：本地 `git stash` 对照运行记录
- [x] DeepSeek regression 不回退（selected=deepseek / canonical-original / 393216 / ≠943718）；无模型特判、无 inference probe、gate 不降低
  - 证据：`grep` 生产代码无模型名/数字特判；`bun test test/core-resilience.test.ts` DeepSeek 组