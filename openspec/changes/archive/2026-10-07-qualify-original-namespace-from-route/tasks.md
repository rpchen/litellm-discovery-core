# Tasks

- [x] `canonicalNamespaceFor` 支持 rule B：relation 声明唯一 → 用之；否则 deployment 自身 qualified namespace 唯一一致 → 用之（reseller namespaces 除外）
  - 证据：`bun test test/core-modelsdev.test.ts`（rule B 新用例）+ `test/core-resilience.test.ts`（DeepSeek 保持）
- [x] 新增测试：route-qualified namespace + relation-less same-namespace record → canonical-original；reseller 路由不得升级
  - 证据：`bun test test/core-modelsdev.test.ts`
- [x] 既有 adversarial（reseller relation 不替身）、DeepSeek、precedence matrix 全部保持
  - 证据：`bun test` 全量
- [x] diagnostics fixture 期望随 rule B 权威变化更新（不变更 diagnostics 语义）
  - 证据：`bun test test/core-diagnostics.test.ts`
- [x] OpenSpec strict validate / closure gate / archive / canonical sync
  - 证据：本地命令输出 + PR CI