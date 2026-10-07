# Tasks

## 1. Hybrid chronology semantics

- [x] Git primary：cross-commit pairs 由 ancestry 裁决；committed fixture 的相反声明 → gate FAIL（"contradicts Git provenance"，含双方向矛盾）
  - 证据：`bun test test/chronology-hybrid.test.ts` Case 1 / Case 5
- [x] same-commit collisions：committed fixture refine；无顺序 → ambiguous fail-closed（与无 fixture 相同）
  - 证据：同文件 Case 2 / Case 4（Case 4 = 空 edges fixture）
- [x] unknown/incomparable 保持 fail closed；committed fixture 不为 Git 无法证明的全局历史背书
  - 证据：同文件 Case 1/5（跨 commit 矛盾即拒）；checker 实现 fixture 分支仅 `git === "same"` 时参与
- [x] 空/无 collision 的 committed fixture = no-op（Git 可全序仓库无需维护 fixture）
  - 证据：同文件 Case 3 + mutation「a Git-provable archive added after the fixture needs no fixture entry」

## 2. Fixture 职责收敛

- [x] `openspec/openspec-chronology.json` 从 24 组全序表缩减为 3 条 edges（仅 #29 squash collision：fix → refine → persist → guard）
  - 证据:`git diff openspec/openspec-chronology.json`
- [x] scope 校验：fixture 与 Git 矛盾 → failures + 非零退出
  - 证据：`scripts/check-openspec-closure.mjs` 的 `validateFixtureScope` + Case 1/5

## 3. 计数器清晰区分

- [x] `ancestry-resolved`（Git 裁决）与 fixture-refined / env-injection 分开计数
  - 证据：`node scripts/check-openspec-closure.mjs` 输出 `20 ancestry-resolved / 0 injected-fixture`（collision pairs 由 strict order 唯一 replay，无需计数器补偿）；env 注入时保持既有 fixture 计数
- [x] env 注入（OPENSPEC_CLOSURE_ORDER_JSON）保持 unit-test-only 全替换语义（离线 tmp 场景无 Git）；committed 通道才是 refinement-only
  - 证据：`scripts/check-openspec-closure.test.mjs` 32/32 通过（既有离线 chronology 测试未回退）

## 4. Mutation proofs（fixture 是 refinement 不是 replacement）

- [x] 删除 collision fixture 顺序 → Case 2 场景转 ambiguous/fail
  - 证据：同文件「mutation: deleting the collision fixture order flips Case 2 to fail-closed」
- [x] fixture 与 Git 相反 → FAIL（Case 1/5）
  - 证据：同上
- [x] 新增 Git 可证明 archive 不入 fixture → PASS
  - 证据：同文件 mutation 用例二

## 5. 交付门禁

- [x] typecheck / bun test / build:dist / test:package / validate:spec / scenario coverage / closure / PR CI
  - 证据：本地命令输出 + PR CI
- [x] 产品语义不回退（DeepSeek 393216 / precedence / schema 7 / pricing / constraint / diagnostics 全部测试保持）
  - 证据：`bun test` 380/380