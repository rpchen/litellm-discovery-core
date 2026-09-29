# discovery-snapshot Specification

## ADDED Requirements

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
