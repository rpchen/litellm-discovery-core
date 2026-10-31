# cross-repository-verification Specification

## Purpose
Defines how Core changes are verified against Pi and OpenCode consumers using immutable Core commit SHAs, compatibility workflows, provenance evidence, and post-merge checks before a shared change is considered closed.

## Requirements

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

### Requirement: verified real-host E2E evidence reuse

Real-host E2E evidence for a shared change SHALL be either the complete real-host E2E matrix executed for the current candidate in the current run, or reuse of a verified baseline taken from an actual complete full-matrix successful CI run in the same repository, and any reuse SHALL be accompanied by the current candidate's own real delivery verification.

Every PR and every push to main SHALL still run the normal CI gates and SHALL still publish the index snapshot for the exact main SHA; reuse SHALL NOT reduce those gates.

#### Scenario: current candidate runs the complete matrix

- **WHEN** a candidate has no verified full-matrix baseline whose recorded inputs match the current candidate and harness
- **THEN** the real-host gate runs the complete matrix for that candidate and reports this run's own results

#### Scenario: reuse requires matching actual inputs

- **WHEN** the candidate install tree and the harness tree differ from a recorded full-matrix baseline only in the allowed version and release-metadata fields, and the exact resolved host version, installed dependency lock, runtime, runner image and explicit configuration all match the recorded inputs
- **THEN** the real-host gate SHALL satisfy the real-host requirement by reusing that baseline only after the current candidate itself is installed and loaded by the real host installer, its runtime identity and provenance match the current candidate, provider models are registered, and at least one real request succeeds

#### Scenario: any difference or missing evidence runs the complete matrix

- **WHEN** any tracked path outside the allowed fields, or any file mode or type, differs from the baseline, or the candidate and harness are compared against a baseline from another repository or of another baseline kind, or any input evidence is missing, unverifiable or internally inconsistent
- **THEN** the gate runs the complete matrix instead of reusing, and it still reports a real result rather than a default success

#### Scenario: baselines are complete and never recursive

- **WHEN** a run is delivery-only, scoped to a subset of groups, failed, cancelled, recorded under a superseded attempt, or itself reused a baseline
- **THEN** it is not eligible as a baseline, and only a run whose recorded attempt, required jobs and all their steps completed successfully as a complete matrix may be reused

#### Scenario: aggregate result is reported honestly

- **WHEN** the gate reports a reused baseline
- **THEN** the required check reports this run's own delivery verification together with the reused run and attempt and the comparison basis, and does not claim that the complete matrix ran in this run

#### Scenario: release obligations are unchanged by reuse

- **WHEN** a tag release is verified
- **THEN** Pi still runs the complete real-host E2E at the tag, OpenCode's current tag workflow still has no real-host E2E gate and this policy neither claims one nor adds one, and release artifact and attachment consistency remains a release acceptance responsibility rather than an automatically proven one
