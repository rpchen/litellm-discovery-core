# Persisted discovery snapshot

## ADDED Requirements

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
