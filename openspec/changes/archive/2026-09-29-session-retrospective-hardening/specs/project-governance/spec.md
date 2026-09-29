# Project governance

## ADDED Requirements

### Requirement: completed changes cannot remain active
CI SHALL reject an OpenSpec change whose tasks are all complete but which remains under active `openspec/changes/`.

#### Scenario: all tasks are checked
- **WHEN** an active change has at least one completed task and no unchecked tasks
- **THEN** the closure gate fails until the change is archived through OpenSpec CLI
