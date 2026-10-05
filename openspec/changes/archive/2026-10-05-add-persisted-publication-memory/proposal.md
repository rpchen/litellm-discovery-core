# Add persisted publication memory

## Why

Stage 1 的 `Notification acknowledgement` 只要求「Core 暴露能够抑制重复提醒的状态」，没有要求该状态跨宿主重启保留，也没有规定不可用 catalog 的提醒节奏。实现因此把 acknowledgement 放在进程内存里：宿主重启后同一组 withheld 问题会被重新当成首次观察，与已冻结的产品需求冲突。

## What Changes

- Core 新增版本化 `PublicationMemory`（`PUBLICATION_MEMORY_SCHEMA_VERSION`）：`acknowledgement` + `published`（regression baseline），配套 `parsePublicationMemory` / `serializePublicationMemory` / `nextPublishedBaseline`；无法安全解析的旧版/损坏记录一律丢弃，最坏结果只是重复提醒一次。
- `Notification acknowledgement` 要求明确「跨宿主重启」语义：同一 fingerprint 重启后仍不重复提醒；改善静默并更新基线；完全恢复清除；新问题/原因实质变化/regression 重新提醒；没有 acknowledgement 的非打断首次观察不写入任何状态。
- 明确不可用 catalog（`discovered > 0 && publishable = 0`）的提醒节奏：首次观察或问题集合实质增长时提醒，同一 fingerprint 持续存在时静默且仍在 diagnostics 可见。
- `publishable(model)` 与 acknowledgement 完全无关的既有约束保持不变。

## Impact

- Affected specs: `discovery-resilience`（MODIFIED）
- Affected code: `src/core/catalog.ts`（`PublicationMemory` 及编解码）、`test/core-resilience.test.ts`
- 下游：Pi 通过 host-persisted catalog payload 持久化，OpenCode 通过独立 storage key 持久化（各自独立 change）
