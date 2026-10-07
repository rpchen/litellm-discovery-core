# Delta: discovery-resilience

## MODIFIED Requirements

### Requirement: Evidence provenance and source authority
Core SHALL record, for every publication-critical field, which source decided it and what kind of evidence each source contributed. Canonical identity is a precondition: the canonical registry entry is authoritative for intrinsic model metadata only when canonical identity is proven; a serving record overrides it only when the serving provider is proven by operator declaration; LiteLLM `model_info` values are secondary descriptive evidence; only a key proven to be enforced by the endpoint — declared in the operator's own deployment configuration (`litellm_params`) — counts as a deployment runtime constraint. Field names, LiteLLM adapter prefixes, and first-party or same-namespace provider records never prove authority by themselves.

#### Scenario: Provenance is recorded per evidence item
- **WHEN** a publication-critical field is resolved
- **THEN** Core reports the selected value, the selecting source, and every contributing evidence item with its origin (`canonical-intrinsic`, `serving-override`, `litellm-declared`, `descriptive-metadata`, `deployment-constraint`, `derived`, or `unknown-provenance`)

#### Scenario: Intrinsic truth is authoritative once identity is resolved
- **WHEN** canonical identity is proven and the registry entry declares a field that a LiteLLM `model_info` declaration contradicts
- **THEN** Core selects the registry value (or the proven serving override) and records the LiteLLM declaration as a resolved discrepancy, never as a conflict or incomplete metadata

#### Scenario: Unproven provider records carry no authority
- **WHEN** canonical identity is proven and a first-party, reseller, or variant provider record declares a different value while no serving provider is declared
- **THEN** that record contributes no evidence to the resolved field

#### Scenario: Simulated model names never decide authority
- **WHEN** only a model name, family substring, or neighbor-model value suggests a capability or identity
- **THEN** Core does not treat models.dev as authoritative and never fills values from the guess

### Requirement: Deployment constraints are separate from intrinsic facts
Core SHALL keep proven runtime enforcement as a distinct fact class. Only `litellm_params` keys promoted through the runtime enforcement matrix of the `modelsdev-catalog` capability — an OpenSpec delta carrying the exact source path where LiteLLM reads that deployment key to reject or rewrite a breaking request, plus an automated negative breakthrough test — may narrow an effective value, a narrowing key SHALL NOT be reported as a conflict, and the proven set starts empty so no key narrows anything before such a delta exists. A descriptive `model_info` declaration SHALL never narrow or veto an authoritative intrinsic value.

#### Scenario: Runtime constraint narrows the effective configuration
- **WHEN** a `litellm_params` key has been promoted to hard-enforced and the operator's deployment configuration declares a value smaller than the model's intrinsic value in that key's dimension
- **THEN** Core publishes the smaller effective value, reports the enforcement, and keeps the model publishable

#### Scenario: Descriptive declaration does not become a hard cap
- **WHEN** only `model_info` declares a limit that differs from the authoritative intrinsic value
- **THEN** Core does not treat it as an enforced cap; the intrinsic value is selected and the difference is recorded

#### Scenario: Dimensions are never mixed
- **WHEN** a promoted enforcement key exists for one limit dimension
- **THEN** it narrows only that dimension; total context, input capacity, and output limit are never compared against each other

#### Scenario: Unpromoted configured keys never narrow
- **WHEN** the operator's deployment configuration declares a limit or capability key that has not been promoted
- **THEN** Core resolves the field from the field resolution matrix alone, keeps the model publishable when otherwise complete, and lists the key in diagnostics as operator configuration

### Requirement: Trusted Last Known Good reuse
Core SHALL reuse a previously verified complete configuration while live enrichment is unavailable, under all of the following: the entry was captured from a resolution that passed the current publication gate; the live group's own stable identity evidence is provable and unchanged; schema version is compatible (schema 8); every component of the entry's proof composition re-proves (deployment input, serving declaration, runtime constraint and LiteLLM fingerprints, and with a live catalog the registry and serving record digests); and no canonical intrinsic fact, proven serving fact, or proven runtime constraint contradicts the entry. Age SHALL NOT be a validity condition. LKG SHALL NOT resurrect a model the current LiteLLM directory does not serve, and a mismatch SHALL fail closed as withheld.

#### Scenario: Outage with a valid snapshot keeps the model available
- **WHEN** the metadata source is temporarily unavailable, LiteLLM still serves the same model, stable identity is unchanged, and an entry whose outage proof components all re-prove exists
- **THEN** Core publishes the model as `configured-lkg` with the entry's fetch time, age, and selection reason

#### Scenario: No valid snapshot means withheld
- **WHEN** a newly discovered model has unavailable metadata and no entry exists
- **THEN** Core withholds it with a `metadata-unavailable` reason instead of inventing values

#### Scenario: Recovery replaces the snapshot with fresh facts
- **WHEN** the metadata source recovers and returns complete trustworthy metadata
- **THEN** Core reports `configured` from fresh evidence and stops reporting the LKG state

#### Scenario: Removed model is not resurrected
- **WHEN** LiteLLM no longer serves a model that has a stored entry
- **THEN** the model does not appear in the publication result at all

#### Scenario: Identity or provider change invalidates the entry
- **WHEN** the live canonical identity or the declared serving provider differs from the stored entry
- **THEN** Core rejects the entry and withholds the model

#### Scenario: Provider-only catalog does not block a valid restore
- **WHEN** the supplied catalog is `providers-only` and an entry exists whose outage proof components all re-prove
- **THEN** Core restores the entry and never uses a provider record from the provider-only payload
