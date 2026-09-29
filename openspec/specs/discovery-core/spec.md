# discovery-core Specification

## Purpose
Defines the host-independent LiteLLM discovery contract, including response normalization, model grouping, protocol selection, models.dev enrichment, capability and price mapping, and neutral ModelSpec construction shared by consumer adapters.

## Requirements

### Requirement: Host-independent public API

The core SHALL expose a public `src/index.ts` entry point that exports the LiteLLM normalization, protocol resolution, models.dev selection, capability mapping, model specification building, fingerprinting, and their necessary types.

#### Scenario: Isolated consumer import

- **WHEN** a consumer installs the packed artifact without source files or host SDKs
- **THEN** it can import `litellm-discovery-core` and call `normalizeLiteLLMURL` and `buildModelSpecs`

### Requirement: No host runtime dependency

The core SHALL have zero runtime dependencies and SHALL NOT import Pi, OpenCode, or provider registration APIs.

#### Scenario: Host-free build

- **WHEN** the package is built from `src/`
- **THEN** the emitted ESM and declarations contain only core modules and standard runtime APIs

### Requirement: Preserve discovery behavior

The core SHALL preserve the established LiteLLM and models.dev behavior for conversational filtering, deployment grouping, protocol selection, metadata fallback, capability and price mapping, context tier capping, reasoning variants, and stable fingerprints.

#### Scenario: Offline fixture regression

- **WHEN** the migrated sanitized fixtures are passed to `buildModelSpecs`
- **THEN** the core regression tests and snapshot remain stable without network access or credentials

### Requirement: Host mapping stays outside core

The core SHALL return neutral `Protocol` and `ModelSpec` values and SHALL NOT include host package names or provider registration configuration.

#### Scenario: Protocol remains neutral

- **WHEN** a deployment resolves to Responses
- **THEN** the result contains `protocol: "responses"` and no host SDK package field
