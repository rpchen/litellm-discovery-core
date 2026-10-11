# discovery-diagnostics Specification

## Purpose
Defines observational diagnostics for configuration status, selected public metadata source, reasoning options and actual errors without disclosing raw credentials or internal endpoints.

## Requirements

### Requirement: observational diagnostics
Core SHALL return structured diagnostics that explain the same model result produced by normal discovery without changing the selected models or performing network I/O.

#### Scenario: diagnose a valid response
- **WHEN** a LiteLLM model-info response and models.dev catalog are diagnosed
- **THEN** the returned models equal the normal discovery result and the diagnostic payload describes that result

### Requirement: protocol explanation
Core SHALL expose the selected protocol and the reason used by the existing protocol precedence rules.

#### Scenario: conflicting deployment protocols
- **WHEN** deployments in one model group resolve to different protocols without an override
- **THEN** diagnostics report the conservative chat fallback and a warning issue

### Requirement: discovery-source boundaries
Core SHALL identify /v1/model/info as the authoritative LiteLLM discovery response and SHALL identify /v1/models as intentionally unused.

#### Scenario: diagnostics requested
- **WHEN** diagnostics are generated
- **THEN** no /v1/models request is implied or required to produce them

### Requirement: cache observability
Core SHALL provide a pure cache diagnostic representation for adapter-supplied source, stale status, refresh time, age, failure count, retry time and pending state.

#### Scenario: restored snapshot
- **WHEN** an adapter describes a restored persisted snapshot
- **THEN** the cache diagnostic marks the source as snapshot and stale unless explicitly overridden

### Requirement: sensitive-data boundary
Core diagnostics SHALL NOT require or include raw credentials, endpoint URLs, host connection identities, or raw host error bodies.

#### Scenario: diagnostic serialization
- **WHEN** a diagnostic payload is serialized
- **THEN** it contains only model/discovery metadata and safe status information

### Requirement: Readable selected metadata
Core SHALL 从同一结果显示模型配置状态、选中记录来源、推理支持与可选档位、真正影响使用的错误。matched 计实际采用 models.dev 配置能力的模型，MUST NOT 以 serving proof 计数或提示 models_dev_provider。主动审计保留公开 record/canonical 引用及最终配置，默认不输出候选、内部 route/proof；保留既有故障来源与缓存年龄。

#### Scenario: [T22] 用户可读
- **WHEN** 16项自动采用 models.dev
- **THEN** 准确显示匹配/配置和各自档位，未声明 provider 不计0。

#### Scenario: [T23] 主动审计安全
- **WHEN** 原始输入有地址、凭据或内部 route
- **THEN** 不复制敏感字段，仅输出既有 allowlist 的公开来源和最终配置。
