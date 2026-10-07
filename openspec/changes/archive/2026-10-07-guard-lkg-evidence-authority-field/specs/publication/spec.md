# Delta: publication

## MODIFIED Requirements

### Requirement: Last Known Good without TTL
Core SHALL support reusing a previously complete metadata snapshot while live sources fail, with validity decided by identity, provider, canonical mapping, schema, and conflict evidence -- never by fixed age -- and SHALL expose source, fetch time, age, and selection reason. Only a `ModelSpec` that passed the current publication gate in the same round may be captured as LKG; a composition of facts from different periods is never a valid entry. LKG SHALL NOT resurrect a model the current LiteLLM directory no longer serves, and an incompatible stored schema SHALL fail safe as withheld rather than restore. Every entry persists the evidence authority its captured facts carried, graded by the same helper as the live assessment; authority graded `fallback-serving` never substitutes for lost live metadata.

#### Scenario: Valid LKG keeps publication
- **WHEN** live metadata fails but a stored snapshot with matching identity and compatible schema exists
- **THEN** Core reports status `configured-lkg` with LKG provenance

#### Scenario: Old but stable LKG stays valid
- **WHEN** an LKG entry is arbitrarily old yet identity, provider, mapping, and schema still agree with no conflicting live data
- **THEN** Core still accepts it

#### Scenario: Identity conflict invalidates LKG
- **WHEN** the current canonical or provider identity no longer matches the stored entry
- **THEN** Core rejects the entry

#### Scenario: Newer trusted metadata wins
- **WHEN** fresh trusted live metadata contradicts a stored entry
- **THEN** Core uses the live data and refreshes the entry

#### Scenario: Only complete gate-passing specs become LKG
- **WHEN** a model is withheld, incomplete, or degraded-looking in any way
- **THEN** no LKG entry is captured for it, and a hand-built entry whose captured facts diverge from its stored spec is rejected

#### Scenario: A removed model is never resurrected
- **WHEN** LiteLLM no longer serves a model that has a stored LKG entry
- **THEN** the model does not appear in the publication result at all; the current LiteLLM directory alone decides existence

#### Scenario: Schema change invalidates LKG
- **WHEN** the stored shape is incompatible with the current schema
- **THEN** Core rejects the entry

#### Scenario: LKG never restores a superseded fallback serving value
- **WHEN** a stored LKG entry captured a reseller serving limit (for example 943718) that no longer matches the live assessment after precedence correction (for example 393216)
- **THEN** LKG validation fails closed on the captured-facts and provider cross-checks and never restores the stale metadata

#### Scenario: Unique-match-sourced LKG never substitutes for lost live metadata
- **WHEN** an LKG entry was captured from a unique-match (fallback-serving) record and the metadata source becomes unavailable
- **THEN** Core fails the restore closed: fallback-serving facts must be re-proven by a live selection in the same round, never served from memory

#### Scenario: Persisted authority grades an explicit provider without a canonical relation as fallback-serving
- **WHEN** an LKG entry is captured while the live selection source is `explicit-provider` and the selected record carries no deterministic canonical relation, and the metadata source later becomes unavailable
- **THEN** the entry persists `evidenceAuthority: fallback-serving`, the restore fails closed, and the model stays withheld until live metadata proves it again

#### Scenario: Persisted authority keeps authoritative entries restorable
- **WHEN** an LKG entry is captured from a canonical-original record or an explicit-provider record with a proven canonical relation (or from LiteLLM-only endpoint declarations), and a compatible metadata outage follows
- **THEN** the entry persists `evidenceAuthority: authoritative-intrinsic` and restores under the established authoritative LKG policy

#### Scenario: Persisted evidence authority is validated as schema-critical
- **WHEN** a stored entry claims the current schema version but its `evidenceAuthority` field is missing or not one of `authoritative-intrinsic` / `fallback-serving`
- **THEN** both the compatibility guard and the defensive validation reject the entry fail-closed, and a corrupted authoritied snapshot is never restored as `configured-lkg`
