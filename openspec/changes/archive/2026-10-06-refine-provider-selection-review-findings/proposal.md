# Refine Provider Selection Review Findings

## Why

`fix-canonical-provider-selection-precedence`（PR #29 首 review）冻结了新 precedence 与 fallback-serving authority，但 review 发现四处实现与冻结 design 的偏差与未写明的语义缝隙：

1. `unique-match` 未按 design 降为 `fallback-serving`（publication/pricing/LKG 三处不一致）；
2. `explicit-provider` 全部自动 authoritative，而 design 要求「selected record 自带 deterministic canonical relation」才升级；
3. `litellm_params` runtime constraint 与 `model_info` descriptive 在 resolution 中未分离——fallback-serving 与 proven constraint 被误判为 same-level conflict，违反既有 canonical publication 语义（constraint 是收窄不是冲突）；
4. 一个 provider 内多 matching record 时 `find()`/`matches[0]` 依赖 provider.models 对象迭代顺序；以及 canonical-original 证明可能借用其它 reseller 的 relation 升级一个自身无 relation 的同 namespace record。

本 change 是同一 selector 责任域的修正补全，不改 precedence 顺序、不放宽 gate。

## What Changes

- **Authority gate 统一**：`authoritative-intrinsic` 只属于 (a) `canonical-original`，(b) 自带 canonical relation 证明的 `explicit-provider` record，(c) 既有手工构造 record 的 legacy 行为。`unique-match` 与所有 fallback 一致降为 `fallback-serving`；pricing、assessment、LKG（outage 不得恢复 fallback-sourced 快照）、diagnostics 四处由同一判定驱动。
- **Descriptive 与 runtime constraint 分离**：numeric/boolean/modality 三个 resolver 中，same-level conflict 判定只比较 descriptive 声明；proven runtime constraint（`litellm_params`）永远后置收窄 effective value，fallback-serving 与 constraint 的差异是收窄不是冲突。
- **Record-level order independence**：collect 一个 provider 内全部匹配 record（direct + relation）；publication-critical facts 等价 → 确定性 tie-break（deprecated 计数 → modelID 长度 → localeCompare）；实质差异且无规则裁决 → fail closed（ambiguous/withheld）。
- **Canonical-original proof 收紧为两条可证明路径**：(A) record 自带 deterministic canonical relation 且 provider namespace == canonical namespace；(B) record 无 relation 但 deployment 自身 qualified identity（路由/显式 provider 证明）证明该 namespace 且 provider namespace 相等。reseller 的 relation 永不借用：它证明 reseller 服务哪个 canonical model，不能为别的 record 提供 original 资格。
- Diagnostics/文案：fallback-serving 成功补缺/被 constraint 收窄时消息明确说 fallback serving，不写 "authoritative intrinsic metadata decides"；evidence origin 精确区分 `authoritative-intrinsic` / `fallback-serving` / `descriptive-metadata` / `deployment-constraint`。

## Impact

- Affected specs: `discovery-quality`（MODIFIED + ADDED）、`publication`（MODIFIED）、`discovery-diagnostics`（ADDED scenario）
- Affected code: `src/core/modelsdev.ts`、`src/core/evidence.ts`、`src/core/publication.ts`；测试为各 finding 增加正/负向回归
- 不变：precedence 顺序（explicit > canonical-original > OpenCode > OpenRouter > unique > ambiguous）、DeepSeek regression（selected=deepseek / canonical-original / 393216 / ≠943718）、无模型特判、无 runtime inference probe、publication gate 不降低