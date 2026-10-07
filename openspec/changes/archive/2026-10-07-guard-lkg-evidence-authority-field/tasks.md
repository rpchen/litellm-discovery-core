# Tasks

- [x] `isPublicationEvidenceAuthority(value)` 仅接受 semantic 两个值（不默认 authoritative）
  - 证据：`bun test test/core-publication.test.ts`「well-formed authorities still pass the guard」
- [x] `isLKGEntryCompatible()` 校验 `evidenceAuthority`
  - 证据：同文件「schemaVersion=7 + missing/invalid evidenceAuthority is incompatible」（invalid 覆盖 undefined、错误字符串、大小写、数字、null、空串）
- [x] `validateLastKnownGood()` defensive fail-closed（绕过 compatibility guard 也失败，reason 含 authority）
  - 证据：同两用例的 validate 断言
- [x] corrupted authority LKG 走 outage 路径永不 configured-lkg
  - 证据：同文件「corrupted authority LKG is never configured-lkg through the outage path」
- [x] revert verification：移除 compatibility 校验 / 移除 defensive check → 新测试失败
  - 证据：revert 运行记录（两方向各 2 个失败）
- [x] 全量 gate（typecheck / build:dist / bun test / test:package / validate:spec / closure）与 PR CI
  - 证据：本地命令输出 + PR CI