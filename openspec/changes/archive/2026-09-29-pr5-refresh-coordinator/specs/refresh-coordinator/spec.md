# Refresh coordinator

## ADDED Requirements

### Requirement: singleflight
The coordinator SHALL coalesce concurrent refreshes for the same key into one discovery operation.

#### Scenario: concurrent refreshes
- **WHEN** multiple callers refresh the same key while a discovery operation is in flight
- **THEN** they receive the result of one shared discovery operation

### Requirement: short freshness
A successful discovery SHALL be reusable for 30 seconds by default without another discovery operation.

#### Scenario: cache hit
- **WHEN** a caller refreshes a key before its successful value expires
- **THEN** the coordinator returns the cached value without running discovery again

#### Scenario: forced refresh
- **WHEN** the caller requests `forceRefresh`
- **THEN** the coordinator bypasses both the freshness TTL and any active retry backoff

### Requirement: retry backoff
Degradable failures SHALL retry with capped delays of 1, 2, 5, 10, and 30 seconds.

#### Scenario: repeated failures
- **WHEN** failures continue beyond the fifth failure
- **THEN** subsequent retry delays remain capped at 30 seconds

### Requirement: last-known-good
When a degradable refresh fails after a prior success, the coordinator SHALL return the prior value marked stale.

#### Scenario: stale fallback
- **WHEN** discovery fails after a prior successful value exists
- **THEN** the previous value is returned with stale status and retry state

#### Scenario: no prior success
- **WHEN** a degradable refresh fails and no successful value exists
- **THEN** the refresh rejects while retaining retry-backoff state

### Requirement: caller-controlled failure policy
The coordinator SHALL allow callers to classify a failure as `stale`, `clear`, or `ignore`.

#### Scenario: clear
- **WHEN** a caller classifies an error as `clear`
- **THEN** the cached value and retry state are cleared and the refresh rejects

### Requirement: host independence
The coordinator SHALL NOT create polling timers, import host SDKs, perform network requests, or persist provider state.

#### Scenario: host adapter ownership
- **WHEN** Pi or OpenCode integrates the coordinator
- **THEN** its adapter remains responsible for lifecycle scheduling, transport, credentials, persistence, and registration
