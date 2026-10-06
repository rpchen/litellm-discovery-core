# Delta: publication

## MODIFIED Requirements

### Requirement: Publication completeness policy
Core SHALL define a formal, testable rule deciding whether a discovered model's metadata is reliable enough for normal publication, and SHALL report exactly which fields are missing, unknown, or illegal when it is not.

The gate is never relaxed and has no user-override path. A model is publishable only as `configured` or `configured-lkg`; every other model is withheld with explicit reasons. No confirmation, acceptance, or override state participates in publication, and one model being withheld never gates another model of the same endpoint. Provider-scoped serving metadata selected through a fallback record ranks below LiteLLM declarations and cannot outrank them.

#### Scenario: Complete trustworthy metadata is publishable
- **WHEN** a model has positive context and output limits plus known tool-calling and reasoning states with a uniquely resolved identity
- **THEN** Core reports the model publishable with status `configured`

#### Scenario: Missing context blocks normal publication
- **WHEN** a model has no positive context limit from any trusted source
- **THEN** Core reports the model not publishable and names the missing context field

#### Scenario: Missing output limit blocks normal publication
- **WHEN** a model has no positive output limit from any trusted source
- **THEN** Core reports the model not publishable and names the missing output field

#### Scenario: Zero context is illegal, not a default
- **WHEN** the merged context limit is zero
- **THEN** Core treats it as illegal/insufficient and the model is not normally publishable

#### Scenario: Zero output is illegal, not a default
- **WHEN** the merged output limit is zero
- **THEN** Core treats it as illegal/insufficient and the model is not normally publishable

#### Scenario: Explicit model-level output <= 0 is illegal, not missing
- **WHEN** the trusted model-level record explicitly declares a non-positive output limit and no deployment declares one
- **THEN** Core reports `invalid-metadata` with an illegal output field, never a missing one

#### Scenario: Unknown key capability blocks normal publication
- **WHEN** tool calling or reasoning support is unknown
- **THEN** Core reports the model not publishable and names the unknown field

#### Scenario: Illegal metadata is rejected
- **WHEN** metadata carries illegal values or an incompatible schema shape is used as fact
- **THEN** Core reports the model not publishable with an illegal-field entry

#### Scenario: Publication never depends on user confirmation
- **WHEN** a model is withheld and the user takes any acknowledgement or confirmation action
- **THEN** the model stays withheld; no stored acceptance, flag, or option can move it into the publishable partition

#### Scenario: Per-model isolation of failure
- **WHEN** one model of an endpoint cannot prove trustworthy metadata
- **THEN** every other model that does pass the gate is published normally in the same round

#### Scenario: fallback conflict blocks publication
- **WHEN** a fallback-selected provider record reports a value that conflicts with an equally ranked LiteLLM declaration
- **THEN** Core reports the field as an unresolved conflict and withholds the model under the normal publication gate

### Requirement: Last Known Good without TTL
Core SHALL support reusing a previously complete metadata snapshot while live sources fail, with validity decided by identity, provider, canonical mapping, schema, and conflict evidence -- never by fixed age -- and SHALL expose source, fetch time, age, and selection reason. Only a `ModelSpec` that passed the current publication gate in the same round may be captured as LKG; a composition of facts from different periods is never a valid entry. LKG SHALL NOT resurrect a model the current LiteLLM directory no longer serves, and an incompatible stored schema SHALL fail safe as withheld rather than restore.

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