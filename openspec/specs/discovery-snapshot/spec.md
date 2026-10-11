# discovery-snapshot Specification

## Purpose
Defines endpoint-bound discovery snapshots, compatibility checks, schema and integrity validation, credential-safe endpoint fingerprints, restoration rules, and drift classification across discovery revisions.

## Requirements

### Requirement: host independence
Core SHALL NOT read or write filesystem paths, host storage, credentials stores, or plugin lifecycle state.

#### Scenario: adapter persistence
- **WHEN** Pi or OpenCode persists a snapshot
- **THEN** the adapter selects the storage mechanism and Core only validates/compares the supplied value

### Requirement: explicit endpoint identity isolation
Core SHALL allow host adapters to bind an endpoint fingerprint to an explicit stable endpoint ID while preserving the legacy fingerprint algorithm when no endpoint ID is supplied.

#### Scenario: otherwise identical explicit endpoints
- **WHEN** two explicit endpoints have different valid endpoint IDs but the same normalized URL, credential, and discovery options
- **THEN** Core produces different endpoint fingerprints so their snapshots cannot be restored across endpoint identities

#### Scenario: legacy caller omits endpoint identity
- **WHEN** a legacy single-endpoint caller computes a fingerprint without an endpoint ID
- **THEN** Core uses the pre-PR9 fingerprint material so an existing compatible snapshot remains restorable

### Requirement: endpoint identifier syntax
Core SHALL expose the shared endpoint identifier contract as a lowercase ASCII slug matching `[a-z0-9][a-z0-9-_]*`.

#### Scenario: valid endpoint identifier
- **WHEN** an adapter validates identifiers such as `default`, `company`, `team-1`, or `team_2`
- **THEN** Core accepts them as valid endpoint IDs

#### Scenario: invalid endpoint identifier
- **WHEN** an endpoint ID starts with punctuation, contains uppercase/non-ASCII characters, or is empty
- **THEN** Core rejects it before fingerprinting

### Requirement: Metadata policy snapshot version
Core SHALL 使用snapshot schema2保存新策略中立模型和关键内容指纹；publication schema9对应新的LKG策略。旧schema不得直接回放为已校验新结果。

#### Scenario: [T19] 旧快照升级
- **WHEN** 遇到schema1持久快照
- **THEN** 拒绝恢复并等待成功刷新重建2

### Requirement: Endpoint-scoped critical configuration
Core SHALL 验证endpoint/credential/协议相关选项scope；废弃contextTierCap和价格不参与有效性，仍保留端点ID隔离。

#### Scenario: [T21] 端点改变
- **WHEN** 快照scope与当前endpoint或credential不符
- **THEN** 不恢复

#### Scenario: [T17] 旧cap配置改变
- **WHEN** 仅contextTierCap变化
- **THEN** 新策略兼容性不变

### Requirement: Critical snapshot integrity
Core SHALL 验证关键模型结构与关键指纹并隔离坏数据；cost缺失/错误单独归零，MUST NOT 拒绝其他完整关键配置。模型身份、协议或关键内容损坏仍拒绝。

#### Scenario: [T19] 价格损坏
- **WHEN** 合法关键快照的cost被移除或损坏
- **THEN** 恢复关键配置并填0

#### Scenario: [T19] 能力损坏
- **WHEN** 关键context被修改而校验不符
- **THEN** 拒绝该不可信快照

### Requirement: Separate display changes from availability
Core SHALL 区分需要宿主更新的内容变化和影响模型可用性的关键变化；价格变更可刷新显示，MUST NOT 引发能力regression、LKG失效或通知问题指纹变化。

#### Scenario: [T16] 显示价格更新
- **WHEN** 仅cost变化
- **THEN** 可更新显示但模型持续可用
