# Spec Delta

## MODIFIED Requirements

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
