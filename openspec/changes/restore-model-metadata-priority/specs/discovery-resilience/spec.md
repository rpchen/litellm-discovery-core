# Spec Delta

## REMOVED Requirements

### Requirement: Deployment constraints are separate from intrinsic facts
**Reason**: 运行时enforcement证明框架无当前产品作用且不应扩张。
**Migration**: 保持维度隔离，不从operator请求参数推断模型能力。

### Requirement: Evidence provenance and source authority
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Metadata source attribution；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Resolved discrepancy versus unresolved conflict
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Priority differences and genuine conflicts；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Trusted Last Known Good reuse
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Reuse of verified capabilities；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: Metadata source attribution
Core SHALL 使用modelsdev-catalog固定来源并仅记录实际采用事实；低优先描述差异不阻断，价格没有发布权威。

#### Scenario: [T10] LL与官方不同
- **WHEN** 官方字段有效且与LL描述不同
- **THEN** 用官方，不标未解决冲突

### Requirement: Priority differences and genuine conflicts
Core SHALL 仅将无法由固定优先级解决的同级关键事实矛盾、身份或协议矛盾标为unresolved；可由优先级选择的不同值为审计差异，不影响发布/LKG。价格差异不构成关键冲突。

#### Scenario: [T06] 真冲突
- **WHEN** 同层可采用记录关键能力不同且无exact选择
- **THEN** withhold该模型

#### Scenario: [T16] 价差
- **WHEN** 只有价格不同
- **THEN** 不withhold

### Requirement: Reuse of verified capabilities
Core SHALL 仅捕获通过当前发布门禁的完整关键配置；schema9条目包含稳定模型身份、协议、关键ModelSpec与最少来源，保留端点scope和捕获时间。恢复须同身份/协议/端点、关键内容完整、无新可信关键冲突且当前目录仍含该模型。价格、部署ID/顺序、空enforcement、serving声明不参与兼容；年龄不是失效条件。活catalog真实歧义不得用LKG掩盖；新的完整live结果直接采用。

#### Scenario: [T18] 中断复用
- **WHEN** 目录中断但同模型关键配置合法
- **THEN** 继续发布

#### Scenario: [T20] 删除不复活
- **WHEN** 当前LiteLLM成功清单已无该模型
- **THEN** 不从LKG恢复
