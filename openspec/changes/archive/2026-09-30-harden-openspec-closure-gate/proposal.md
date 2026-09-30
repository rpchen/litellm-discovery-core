# Harden OpenSpec Closure Gate

## Why

现有 closure gate 只检查 completed change 是否仍留在 active changes。OpenSpec CLI archive 后，如果 delta 没有进入 canonical `openspec/specs/`，active changes、strict validation 与 CI 仍然可以全部通过，形成 false closure。需要把 archive 后的 canonical sync 变成可自动验证的不变量。

## What Changes

- 保留 completed active change 检查。
- 解析 archived `specs/**/spec.md` 中稳定的 ADDED / MODIFIED / REMOVED / RENAMED grammar，并按 capability、requirement、scenario 语义核对 canonical specs。
- 对缺失 capability、stale requirement、残留 removed requirement、malformed archive 明确失败。
- 为历史 archive 提供显式可审查的兼容报告，不静默吞掉无法判定的 artifact。
- 更新共享 testing standard，明确 archive + strict validation 不是 closure 证据。
