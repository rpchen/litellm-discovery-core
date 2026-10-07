# Chronology Gate Is Git-Primary with Collision-Only Fixture Refinement

## Why

PR #30 引入的 committed chronology fixture（`openspec/openspec-chronology.json`）当前实现是「fixture 存在 → 整套 chronology 完全替换 Git」——env/committed fixture 一旦加载，Git ancestry 不再参与。这违反既定事实层级（Git history 是 archive chronology 的原始事实源，fixture 只应处理 Git 无法区分的部分），并导致 fixture 演变为需要全仓维护的全序表。

同时 #29 的 squash 合并造成 4 个 archive 的 introduction commit 塌缩为同一 SHA——这正是 committed fixture 的合法场景：Git 只能证明 same commit，fixture 补充 squash 前真实顺序。

## What Changes

- **Hybrid chronology semantics**：
  - Git proven before/after → Git wins（fixture 对该 pair 的相反声明 → gate FAIL）；
  - same introduction commit → committed fixture 可 refine；无顺序 → 保持 ambiguous/fail closed（与无 fixture 相同）；
  - unknown/incomparable → 默认 fail closed；committed fixture 不得为 Git 无法证明的全局历史背书。
- **两个 fixture 通道的职责分离**：committed `openspec-openspec-chronology.json` 只服务 collision refinement（含 scope 校验：与 Git 矛盾 → FAIL；空表达 → no-op，Git 可全序的仓库无需维护 fixture）；env `OPENSPEC_CLOSURE_ORDER_JSON` 保持 unit-test 注入语义（离线模拟 Git，不参与生产 chronology）。
- **fixture 内容收敛**：从 24 组全序表缩减为 3 条 edges——仅记录 #29 squash collision 内部的真实顺序（fix → refine → persist → guard）。
- **计数器语义**：`ancestry-resolved`（Git 裁决）与 `injected-fixture`（同为 hybrid 下 fixture-only 裁决）分开呈报；"fixture used" 不再暗示整套 chronology 来自 fixture。
- 新增 7 个 chronology governance 回归（含 3 个 mutation proofs）。

## Impact

- Affected specs: `openspec-closure-gate`（MODIFIED）
- Affected code: `scripts/check-openspec-closure.mjs`、`openspec/openspec-chronology.json`、`test/chronology-hybrid.test.ts`（新）
- 不改变其它 OpenSpec tooling、产品语义、Pi/OpenCode 集成内容。