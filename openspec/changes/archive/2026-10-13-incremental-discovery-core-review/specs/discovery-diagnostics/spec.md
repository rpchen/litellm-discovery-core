# Spec Delta

## MODIFIED Requirements

### Requirement: observational diagnostics

Core SHALL return structured diagnostics that explain the same model result produced by normal discovery without changing the selected models or performing network I/O. Incremental diagnostic merging SHALL reuse diagnostics for retained model identities and recalculate only processed identities and aggregate response statistics.

#### Scenario: diagnose a valid response

- **WHEN** a LiteLLM model-info response and models.dev catalog are diagnosed
- **THEN** the returned models equal the normal discovery result and the diagnostic payload describes that result

#### Scenario: Retained diagnostics are not re-resolved

- **WHEN** an adapter supplies prior diagnostics and a diagnostic result for only changed identities
- **THEN** retained model diagnostics remain unchanged and processed diagnostics replace only matching identities

#### Scenario: Aggregate statistics follow the current response

- **WHEN** incremental diagnostics are merged after model additions or deletions
- **THEN** response-entry, deployment, model, match and protocol-fallback statistics describe the current LiteLLM response
