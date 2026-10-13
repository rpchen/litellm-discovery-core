# Design

## Context

当前两个 adapter 都已经实现 model-name 增量发现，但重复维护相同的集合/partition/diagnostics 算法。Core 是唯一共享业务语义真源，adapter 只应决定什么时候调用它以及如何把结果映射到宿主。

## Decisions

### Shared pure helpers

新增 `src/core/incremental.ts` 并从 `src/index.ts` 导出：

- `modelNamesOfResponse` / `modelNameDelta`：复用 Core 现有对话模型过滤和稳定排序；
- `responseForModelNames`：保留 LiteLLM 响应 envelope，只筛选要处理的部署；
- `mergePublicationResults`：按保留 identity 合并 Core publishable/blocked/assessments；
- `needsCatalogRefresh`：只有处理集合中没有选中 models.dev record 才要求最新 catalog；
- `mergeDiscoveryDiagnostics`：保留未处理模型诊断并更新当前 response 的统计；
- `temporaryMetadataFailureModelNames`：仅对 degraded catalog 下的 `metadata-unavailable` withheld 模型开放恢复处理。

这些函数不执行 I/O、不创建计时器、不读取宿主状态，也不改变 Core publication/LKG 判定。

### Recovery boundary

当 model_name 集合不变时，adapter 仍直接复用正常注册模型。若上轮 Core 结果包含 degraded catalog 造成的 `metadata-unavailable` withheld 模型，只重新处理这些模型；稳定的 unmatched、invalid 或 discovered-incomplete 结果不触发额外请求或匹配。

## Non-Goals

不新增通用重试机制、持久化 schema、网络 cache、宿主 API、命令、UI 或跨 provider fallback。adapter 的 catalog fetch 与 LKG store 仍由各宿主保留。
