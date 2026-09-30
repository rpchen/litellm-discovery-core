# OpenSpec closure gate

## Purpose

定义仓库如何证明 OpenSpec change 在 archive 后已经被 canonical specifications 吸收，并防止 active-only closure 造成 specification drift。

## ADDED Requirements

### Requirement: archived specification deltas SHALL be represented canonically
The repository SHALL verify archived OpenSpec specification deltas against canonical specs using capability, requirement, scenario and operation semantics rather than raw Markdown substring matching.

#### Scenario: missing added capability is rejected
- **WHEN** an archived ADDED delta has no matching canonical capability
- **THEN** the closure gate fails and identifies the change, capability and canonical path

#### Scenario: stale modified requirement is rejected
- **WHEN** an archived MODIFIED requirement is absent or its final statement/scenarios are stale in canonical specs
- **THEN** the closure gate fails and identifies the requirement and semantic mismatch

#### Scenario: removed requirement is absent
- **WHEN** an archived REMOVED requirement no longer exists in canonical specs
- **THEN** the closure gate passes for that removal

#### Scenario: removed requirement remains
- **WHEN** an archived REMOVED requirement still exists in canonical specs
- **THEN** the closure gate fails and identifies the lingering requirement

### Requirement: malformed archived deltas SHALL fail closed
The closure gate SHALL reject archived delta files that have no recognized operation or contain incomplete ADDED, MODIFIED, REMOVED or RENAMED grammar, with an actionable diagnostic.

#### Scenario: malformed archive is checked
- **WHEN** an archived delta cannot be mapped to the supported OpenSpec grammar
- **THEN** the closure gate fails instead of silently treating the archive as complete

### Requirement: historical archive compatibility SHALL be explicit
The closure gate SHALL report the number of archived changes, capabilities, requirements, scenarios and legacy/unverifiable artifacts checked, and SHALL NOT silently skip an archive.

#### Scenario: existing historical archives are checked
- **WHEN** the gate runs against the repository archive
- **THEN** every delta is checked or explicitly classified with a compatibility reason
