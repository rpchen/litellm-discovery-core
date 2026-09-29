# discovery-snapshot Specification

## Purpose
Defines endpoint-bound discovery snapshots, compatibility checks, schema and integrity validation, credential-safe endpoint fingerprints, restoration rules, and drift classification across discovery revisions.

## Requirements

### Requirement: versioned snapshot
Core SHALL define a schema-versioned persisted discovery snapshot containing endpoint identity, discovery time, model fingerprint, and neutral model specs.

#### Scenario: snapshot creation
- **WHEN** a successful discovery result is converted to a snapshot
- **THEN** the snapshot records the current schema version and a stable fingerprint of its models

### Requirement: endpoint-bound compatibility
Core SHALL bind a persisted snapshot to a fingerprint derived from normalized endpoint identity, credential, and result-affecting discovery options.

#### Scenario: changed endpoint or credential
- **WHEN** a snapshot is restored for a different endpoint fingerprint
- **THEN** it is rejected as endpoint-incompatible

#### Scenario: sensitive input
- **WHEN** an endpoint fingerprint is persisted
- **THEN** it does not contain the raw credential or URL

### Requirement: defensive restore
Core SHALL classify missing, malformed, unsupported-version, endpoint-mismatched, and content-tampered snapshots without throwing for ordinary invalid persisted data.

#### Scenario: model content changed after persistence
- **WHEN** stored models no longer match the stored model fingerprint
- **THEN** the snapshot is rejected as corrupt

### Requirement: drift comparison
Core SHALL compare two valid snapshots and report endpoint changes, model additions/removals, protocol changes, capability changes, and metadata-only changes.

#### Scenario: compatibility drift
- **WHEN** endpoint, model membership, protocol, or capabilities change
- **THEN** the comparison marks drift

#### Scenario: metadata-only update
- **WHEN** only cost, limits, release data, or equivalent non-compatibility model metadata changes
- **THEN** the comparison reports a change without independently marking compatibility drift

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
