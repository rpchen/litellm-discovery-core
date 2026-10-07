# Delta: openspec-closure-gate

## MODIFIED Requirements

### Requirement: archive chronology SHALL be a partial order derived from Git ancestry
Archive chronology SHALL be a partial order derived from explicit Git ancestry of the commits that introduced each archived change. It SHALL NOT be a fabricated global total order. Git ancestry is the primary chronology source: a version-controlled chronology fixture (`openspec-chronology.json`, the existing groups/edges partial-order format) MAY refine archives whose introduction commit Git cannot distinguish, and SHALL NOT replace, contradict, or pre-empt Git-provable orders.

Archives introduced by the same commit SHALL NOT be implicitly ordered: the same introduction commit is a chronology tie, and archive name, lexical order, filesystem order, array order and timestamps MUST NOT break that tie. A committed fixture MAY break exactly that tie with the real introduction order of a squash collision, in which case the refinement is reported separately from Git-resolved histories. Two commits where neither is an ancestor of the other are incomparable and unordered, and a committed fixture MAY NOT order them. When Git history is incomplete or unavailable, no order may be derived from Git, and a committed fixture may not substitute a fabricated global history.

A fixture entry that contradicts a Git-provable order (two distinct commits where ancestry establishes before/after) SHALL fail the gate. A committed fixture that Git-provable archives never reference SHALL be a no-op rather than an error, so archives whose order Git already proves need no fixture maintenance.

If every provable linear extension of the partial order yields the same state for an identity, that state is the terminal state. If different states remain equally provable, the history is ambiguous and the gate SHALL fail closed.

Test fixtures MAY inject an explicit chronology, but the injected model SHALL express a partial order (ordered layers and/or explicit edges, including ties and incomparable archives) rather than forcing every archive into one total order.

#### Scenario: same introduction commit is a tie
- **WHEN** two archives that touch one identity were introduced by the same commit and no committed fixture refines their collision order
- **THEN** the gate treats them as unordered and passes only when both orders give the same state

#### Scenario: same introduction commit is refined by the committed fixture
- **WHEN** two archives that touch one identity were introduced by one squash commit and the committed fixture declares the real introduction order between them
- **THEN** the gate uses that refinement, replays deterministically, and reports it as fixture-refined (separately from Git-resolved histories)

#### Scenario: same commit with conflicting states fails ambiguous
- **WHEN** two same-commit archives give one identity different final states
- **THEN** the closure gate fails with `ambiguous archived requirement history`, even when their names sort into an order

#### Scenario: incomparable histories with conflicting states fail ambiguous
- **WHEN** two archives with incomparable introduction commits give one identity different final states
- **THEN** the closure gate fails with `ambiguous archived requirement history`

#### Scenario: fixture contradicting Git provenance fails the gate
- **WHEN** the committed fixture orders two archives opposite to the order Git ancestry proves across their distinct introduction commits
- **THEN** the closure gate fails, naming the contradiction; it never silently accepts the fixture-driven order

#### Scenario: Git-provable archives need no fixture entry
- **WHEN** a new archive's introduction commit is ordered by Git ancestry against the existing archives and the committed fixture does not mention it
- **THEN** the gate passes without any fixture update; Git ancestry alone resolved the chronology

#### Scenario: ancestry resolves a reversed lexical order
- **WHEN** Git ancestry proves that an archive whose name sorts later introduced an earlier state and another archive introduced the later state
- **THEN** the closure gate accepts the chronologically final state regardless of the lexical order of the archive names

#### Scenario: ambiguous archived requirement history fails closed
- **WHEN** an identity has multiple operations across different archived changes and Git ancestry proves no order between the involved archives