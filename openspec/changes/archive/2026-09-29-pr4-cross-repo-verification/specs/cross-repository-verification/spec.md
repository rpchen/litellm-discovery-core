# Cross repository verification

## ADDED Requirements

### Requirement: Core SHA contract
The system SHALL require a complete Core commit SHA for cross-repository compatibility checks.

#### Scenario: invalid SHA
- **WHEN** a consumer workflow receives a missing or malformed SHA
- **THEN** the compatibility job fails before installing or building

### Requirement: consumer verification entrypoints
Pi and OpenCode SHALL expose manual and repository-dispatch compatibility entrypoints that run their existing verification commands against the supplied Core SHA.

#### Scenario: valid dispatch
- **WHEN** a consumer receives `litellm-discovery-core-updated` with a valid SHA
- **THEN** it selects that Core SHA and runs the normal delivery, type, test, and package gates

### Requirement: provenance
A successful compatibility run SHALL expose the exact Core repository, branch, and SHA in the workflow summary and an uploaded metadata artifact.

#### Scenario: successful run
- **WHEN** compatibility verification completes successfully
- **THEN** the workflow summary and artifact contain the selected Core repository, branch, and SHA

### Requirement: post-merge notification
Core SHALL attempt to dispatch the canonical event to both consumers after a `main` push when `CROSS_REPO_DISPATCH_TOKEN` is available.

#### Scenario: token unavailable
- **WHEN** the secret is not configured
- **THEN** Core CI reports the dispatch as skipped without failing Core validation
