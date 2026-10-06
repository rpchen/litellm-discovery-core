# Tasks

- [x] Core `PublicationMemory` + 版本化编解码 + `nextPublishedBaseline`
- [x] `decideAcknowledgement` 明确跨重启与 unusable 提醒节奏（顺序：recovery → regression → subset → unusable → new）
- [x] Core 测试：round trip、restart 矩阵（same/improve/recover/new/reason-changed/regression）、损坏记录、publication 独立性
- [x] Pi 持久化（host-persisted catalog payload）+ 重启抑制测试
- [x] OpenCode 持久化（独立 endpoint storage key）+ 重启抑制测试
- [x] Pi / OpenCode diagnostics 显示提醒状态
- [x] Real Pi E2E：持久化写入可见、重启后不重复提醒、material change 重新提醒
- [x] Real OpenCode v2 E2E：同上的 suppression/baseline 行为
