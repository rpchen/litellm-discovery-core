# Qualify Original Namespace from the Deployment Route

## Why

Core #29 合并后（squash SHA `cfa194d6`）下游 LKG 集成暴露一处与冻结 rule B（PR review finding 6）不一致的实现缝隙：`canonicalNamespaceFor()` 只从 candidate 字面与 relation 声明确立 canonical namespace，candidate 经 `stripRoutePrefix` 去掉路由前缀后 namespace 信息丢失，即使 deployment 自身 qualified identity（路由 `openai/gpt-6-sol`）已经证明该 namespace，relation-less 的同 namespace direct record 也不会触发 canonical-original，而是掉到 unique-match（fallback-serving）——Pi 的 gpt-6-sol 形态下，已证明的 endpoint 原厂配置在 metadata outage 中无法按 authoritative LKG policy 恢复。同时必须排除把 reseller 路由（`openrouter/...`、`opencode/...`）误当 origin 证明。

## What Changes

- `canonicalNamespaceFor()`：candidate 无 namespace 时依次从 (a) relation 声明集合唯一一致、(b) deployment 自身 qualified namespace 集合唯一一致（rule B）确立 canonical namespace。
- rule B 防滥用：reseller fallback namespaces（`openrouter` / `opencode`）不得作为 canonical namespace——它们是 serving 选择（该 record 走 fallback precedence 成为 fallback-serving source），不是 origin 证明。
- conflict 分支把同样的 namespace 解析传递给 ambiguous 标签。
- 同步更新 diagnostics fixture 期望（rule B 命中后 selectionSource = canonical-original、pricing provenance 随 authority 分级变化）。

## Impact

- Affected specs: `discovery-quality`（MODIFIED）、`discovery-diagnostics`（无变化——scenario 既有断言已覆盖 canonical-original 展示语义，本 change 只更新 fixture 数据）
- Affected code: `src/core/modelsdev.ts`；不影响 DeepSeek relation path / constraint narrowing / pricing 规则本体。