# Scenario 证据计划

实施前每项均为planned；设计数据验证不能替代业务与真实宿主验收。实施时补具体文件、test名称、CI run与结果。矩阵T编号定义在Core同名change/test-matrix.md。

| Capability | Requirement | Scenario / Matrix | 计划证据 | 当前状态 |
|---|---|---|---|---|
| discovery-core | Preserve discovery entrypoints with corrected metadata | [T24] 公共消费者 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-diagnostics | Readable metadata attribution | [T22] 16模型正确统计 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-diagnostics | Readable metadata attribution | [T23] 审计安全 | audit 安全负向 | planned，未实施 |
| discovery-diagnostics | Explain invocation protocol conflicts | [T11] 协议冲突可见 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-diagnostics | Metadata outage visibility | [T25] 目录不可用 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-quality | Exact model identity boundaries | [T09] 不跨版本 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-quality | Independent reasoning support and options | [T13] GPT真实选项 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-quality | Separate token limit dimensions | [T12] input不等于context | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-quality | Ordered model metadata | [T10] 官方能力覆盖描述 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-quality | Invocation protocol compatibility | [T11] 多协议 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-quality | Invocation protocol compatibility | [T11] 部署协议冲突 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-quality | Private model completeness | [T25] 私有模型缺关键字段 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-quality | Selected metadata provenance | [T22] 来源可解释 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-resilience | Metadata source attribution | [T10] LL与官方不同 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-resilience | Priority differences and genuine conflicts | [T06] 真冲突 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-resilience | Priority differences and genuine conflicts | [T16] 价差 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-resilience | Reuse of verified capabilities | [T18] 中断复用 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-resilience | Reuse of verified capabilities | [T20] 删除不复活 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Metadata policy snapshot version | [T19] 旧快照升级 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Endpoint-scoped critical configuration | [T21] 端点改变 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Endpoint-scoped critical configuration | [T17] 旧cap配置改变 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Critical snapshot integrity | [T19] 价格损坏 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Critical snapshot integrity | [T19] 能力损坏 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Separate display changes from availability | [T16] 显示价格更新 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Single resolution result | [T24] 入口一致 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Single resolution result | Gate and configuration cannot diverge | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Single resolution result | No cross-provider field inheritance | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Deterministic metadata source priority | [T03] 三级优先级 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Deterministic metadata source priority | [T04] 官方provider命名不同 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Deterministic metadata source priority | [T05] 等价官方alias | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Deterministic metadata source priority | [T06] 真正目录歧义 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Deterministic metadata source priority | [T01] provider声明无关 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Atomic catalog input | [T25] 目录形状无效 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Exact transport and model name parsing | [T07] 公开名称和路由别名 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Exact transport and model name parsing | [T09] 语义后缀 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Canonical identity with official API aliases | [T02] 官方API别名 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Canonical identity with official API aliases | [T08] 多deployment不同模型 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Canonical identity with official API aliases | [T09] 同名但不同日期版本 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Canonical identity with official API aliases | [T26] bare重名 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Ordered metadata fields | [T10] false与缺失 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Ordered metadata fields | [T10] 模态不并集 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Ordered metadata fields | [T12] 低层描述冲突 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Ordered metadata fields | [T12] LiteLLM补缺冲突 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Reasoning support and controls from one record | [T13] 每个GPT独立 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Reasoning support and controls from one record | [T14] 三种支持状态 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Reasoning support and controls from one record | [T14] 缺options与空数组 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Reasoning support and controls from one record | [T15] 控制矛盾与budget | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Optional reference prices | [T16] 价格任意变换 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Optional reference prices | [T17] 272k阶梯 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Actual model regression coverage | [T01] 全16项验收 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Actual model regression coverage | [T27] 不固化错误 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | False versus unknown | [T10] 不支持与未声明 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | False versus unknown | Missing tool declaration stays unknown | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | False versus unknown | Explicit negative evidence means unsupported | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Essential capability admission | [T14] 无档位仍可用 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Essential capability admission | [T16] 坏价格不阻断 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Reasoning completeness independent of controls | [T14] 支持但无档位 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Identity-preserving metadata selection | [T02] 官方别名提供完整能力 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Identity-preserving metadata selection | [T03] fallback值高于LL描述 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Selected token limits | [T12] 错误低层限制 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Ordered modality sets | [T10] image明确不支持 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Known conversational modalities | [T30] 未知或nontext-only | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Consistent deployment identities | [T08] 相同身份与不同描述 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Consistent deployment identities | [T11] 协议冲突 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Critical configuration cache validation | [T18] outage后恢复 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Critical configuration cache validation | [T20] 身份改变或模型删除 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Critical configuration cache validation | [T16] 只改价格 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Per-model metadata failure outcomes | [T25] catalog失败 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Reusable verified configuration without expiry | [T18] 老但有效 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Reusable verified configuration without expiry | [T19] 旧schema | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Configuration outcomes and readable provenance | [T22] 匹配与配置数量 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
