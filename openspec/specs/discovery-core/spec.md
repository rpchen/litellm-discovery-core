# discovery-core Specification

## Purpose
Defines the host-independent LiteLLM discovery contract, including response normalization, model grouping, protocol selection, models.dev enrichment, capability and price mapping, and neutral ModelSpec construction shared by consumer adapters.

## Requirements

### Requirement: Host-independent public API

The core SHALL expose a public `src/index.ts` entry point that exports the LiteLLM normalization, protocol resolution, models.dev selection, capability mapping, model specification building, publication/diagnostic helpers, fingerprinting, and their necessary types. Incremental helpers SHALL remain pure and host-independent.

#### Scenario: Isolated consumer import

- **WHEN** a consumer installs the packed artifact without source files or host SDKs
- **THEN** it can import `litellm-discovery-core`, call the existing discovery functions, and use the incremental helpers without Pi/OpenCode runtime dependencies

#### Scenario: Adapter reuses shared incremental semantics

- **WHEN** an adapter needs to compare model identities, merge a partial Core publication, or determine whether a catalog miss needs refresh
- **THEN** it uses the exported Core helper instead of maintaining a second matching/merge algorithm

### Requirement: No host runtime dependency

The core SHALL have zero runtime dependencies and SHALL NOT import Pi, OpenCode, provider registration APIs, network clients, timers, or persistence stores. Incremental helpers SHALL operate only on supplied responses, Core results, and diagnostics.

#### Scenario: Host-free build

- **WHEN** the package is built from `src/`
- **THEN** the emitted ESM and declarations contain only core modules and standard runtime APIs

#### Scenario: Host-free incremental merge

- **WHEN** Core merges a prior publication and a processed model subset
- **THEN** the result is deterministic and performs no host I/O or network access

### Requirement: Host mapping stays outside core

The core SHALL return neutral `Protocol` and `ModelSpec` values and SHALL NOT include host package names or provider registration configuration.

#### Scenario: Protocol remains neutral

- **WHEN** a deployment resolves to Responses
- **THEN** the result contains `protocol: "responses"` and no host SDK package field

### Requirement: Preserve discovery entrypoints with corrected metadata
Core SHALL 保留地址归一化、模式过滤、model_name分组、正常协议选择、稳定排序和宿主无关API；元数据优先级、价格与LKG行为以modelsdev-catalog/publication为准，MUST NOT 为迁移兼容保留价格tier截断或serving证明。

#### Scenario: [T24] 公共消费者
- **WHEN** 外部消费者使用公开入口处理固定输入
- **THEN** 取得同一新resolver结果，不依赖宿主或平级仓库
