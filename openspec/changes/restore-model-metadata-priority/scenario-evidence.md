# Scenario 证据计划

实施前每项均为planned；设计数据验证不能替代业务与真实宿主验收。实施时补具体文件、test名称、CI run与结果。矩阵T编号定义在Core同名change/test-matrix.md。

| Capability | Requirement | Scenario / Matrix | 计划证据 | 当前状态 |
|---|---|---|---|---|
| discovery-core | Preserve discovery entrypoints with corrected metadata | [T24] 公共消费者 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-diagnostics | Readable selected metadata | [T22] 用户可读 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-diagnostics | Readable selected metadata | [T23] 主动审计安全 | audit 安全负向 | planned，未实施 |
| discovery-quality | Single record quality boundary | [T09] 不跨型号 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-quality | Single record quality boundary | [T10] 来源唯一 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-quality | Single record quality boundary | [T12] 限制维度 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-resilience | Reuse existing recovery with one record | [T18] 目录暂不可用 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-resilience | Reuse existing recovery with one record | [T20] 内部路由变化 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Metadata policy snapshot version | [T19] 旧快照升级 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Endpoint-scoped critical configuration | [T21] 端点改变 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Endpoint-scoped critical configuration | [T17] 旧cap配置改变 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Critical snapshot integrity | [T19] 价格损坏 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Critical snapshot integrity | [T19] 能力损坏 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Separate display changes from availability | [T16] 显示价格更新 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Single resolution result | Gate and configuration cannot diverge | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Single resolution result | No cross-provider field inheritance | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Model name selects one metadata record | [T01] 16模型按名称匹配 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Model name selects one metadata record | [T02] 官方API名称不同 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Model name selects one metadata record | [T03] 整记录三级选择 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Model name selects one metadata record | [T04] 已确认组织别名 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Model name selects one metadata record | [T08] 内部路由变化 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Model name selects one metadata record | [T09] 实际日期版本反例 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Compatible catalog input | [T25] 目录不可用 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Compatible catalog input | [T26] Future top-level keys are ignored | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Capabilities come from the selected record | [T10] 整条记录保真 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Capabilities come from the selected record | [T12] 限制来源 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Reasoning support and options from the selected record | [T13] GPT各自选项 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Reasoning support and options from the selected record | [T14] 支持与档位分离 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Optional prices from the selected record | [T16] 价格独立 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| modelsdev-catalog | Optional prices from the selected record | [T17] 上下文不受价格限制 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | False versus unknown | Missing tool declaration stays unknown | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | False versus unknown | Explicit negative evidence means unsupported | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Essential capability admission | [T14] 支持无档位 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Essential capability admission | [T11] 已有协议回退 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Essential capability admission | [T16] 无价格 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Critical configuration cache validation | [T18] 目录中断仍可恢复 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Critical configuration cache validation | [T20] 内部信息无关 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Critical configuration cache validation | [T20] 删除模型 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Critical configuration cache validation | [T19] 旧配置与损坏内容 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Existing metadata failure handling | [T25] 目录故障 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
