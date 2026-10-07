# Tasks

## 1. Blocker 1 — LKG 持久化 evidence authority

- [x] `LastKnownGoodEntry.evidenceAuthority: "authoritative-intrinsic" | "fallback-serving"`（capture 由 `evidenceAuthorityOf` = live 同一 helper 分级；selectionSource 保留为 provenance）
  - 证据：`bun test test/core-resilience.test.ts`「LKG evidence authority outage policy」组（entry.evidenceAuthority 断言）
- [x] restore 按 persisted authority 裁决：fallback-serving + live selection 无法重新证明 → fail closed；覆盖 opencode/openrouter fallback、unique-match、legacy、explicit-without-relation
  - 证据：同组 4 用例 + `test/core-publication.test.ts`（unique-match outage 既有用例保持）
- [x] authoritative（canonical-original / explicit+relation / LiteLLM-only）按既有 policy 恢复
  - 证据：同组正向用例「explicit-provider with canonical relation … restores」+ 既有 state-machine suite 保持
- [x] `PUBLICATION_SCHEMA_VERSION` 6 → 7（persisted shape 语义关键变化；旧 schema fail safe）
  - 证据：`test/core-resilience.test.ts` schemaVersion 断言更新；不兼容 schema 用例保持通过

## 2. Blocker 2 — canonical-original publication-equivalence

- [x] `canonicalOriginalRecord` 复用 `publicationEquivalent`：等价 → 既有 tie-break；conflict → 本候选 ambiguous（不 fall-through 到 fallback）
  - 证据：`bun test test/core-modelsdev.test.ts`「canonical-original multi-record equivalence (blocker 2)」（material conflict 双顺序 ambiguous；equivalent 双顺序同 record）
- [x] DeepSeek 等价 official SKUs 仍 canonical-original / 393216
  - 证据：`bun test test/core-resilience.test.ts` DeepSeek 组保持通过

## 3. Hygiene 2 — pricing 直接断言

- [x] explicit-provider 无 relation + LiteLLM 无价格 + record 有价格 → cost 保持 0/unknown（不发布 provider price）
  - 证据：`test/core-resilience.test.ts`「models.dev provider price fallback eligibility」直接 `spec.cost` 断言
- [x] explicit-provider 带 relation → 允许按既有 price fallback policy（cost = record 价格）
  - 证据：同组正向 `spec.cost` 断言；unique-match 不捐价格负向用例

## 4. Hygiene 1 — PR body 与 canonical OpenSpec 一致

- [x] PR body 改写为冻结语义（canonical-original → authoritative；explicit+relation → authoritative；explicit 无 relation → fallback-serving；OpenCode/OpenRouter/unique/legacy → fallback-serving）
  - 证据：PR #29 body 更新 diff

## 5. 全部 gate + revert verification

- [x] typecheck / build:dist / bun test / test:package / validate:spec / scenario coverage / closure gate / PR CI
  - 证据：本地命令输出 + PR CI
- [x] revert 1（移除 LKG authority capture/restore）→ explicit-without-relation outage test 失败
  - 证据：revert 运行记录
- [x] revert 2（canonicalOriginalRecord 直接 tie-break）→ materially-different original test 失败
  - 证据：revert 运行记录
- [x] revert 3（explicit 无条件价格放行）→ pricing regression 失败
  - 证据：revert 运行记录