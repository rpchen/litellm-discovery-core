## Context

源代码基线 ec0a8bdb8f5576894f551ac53f31ee1a9fcf4025；Pi 当前内置 Core 1ff0979c8f22ec06479331d94ced2cf466f1fd42。2026-11-13 实时目录实测，原 resolver 输出 context=1048576/output=943718。原同名官方/目录优先原则保留。

## Decisions

仅在唯一裸名称候选已找到后、供应商 canonical 过滤前，增加一次现有供应商顺序的精确名称关系查找。官方同名优先；官方名字不同时允许 OpenCode 同名记录搭桥。relation 必须指向同一 catalog.models 的现存项。选定后所有能力、档位、限制、价格仍来自一条官方优先记录。记录 identity evidence=record-relation，model_name 保持原请求名。

显式 qualified canonical 保持精确绑定；free/pro 相似名称不搭桥；不因字段值更小选择记录，不采用 LiteLLM 字段裁剪。不存在有效关系则继续原流程。不新增缓存状态或迁移。

## Validation and delivery

先记录回归在旧实现失败，再运行 Core 全套类型、测试、构建、隔离消费者和 OpenSpec 门禁。冻结 oracle 的 pro 型号也因精确官方关系正确转向版本项，其整体字段来自原冻结官方记录，不能只换 output。

Core PR 合并和索引收尾后再消费插件；插件成功刷新、重建运行实例并继续原会话属于后续验收，不以 Core 单测冒充。已有进程的 model_name 增量复用不保证重算现有模型，故验收保留新实例条件。
