# Delta: discovery-diagnostics

## MODIFIED Requirements

### Requirement: source visibility
Core SHALL report field-level provenance for protocol, reasoning support and levels, capabilities, context/input/output limits, pricing, and release metadata, and SHALL report as separate observational fields: the canonical model identity and its evidence kind (`qualified-deployment`, `registry-unique`, `serving-relation`, or none), the wire-ID parse metadata (removed route segment, `custom_llm_provider`) labelled as non-evidence, the serving status (`declared`, `declared-unmatched`, `serving-record-unresolved`, `serving-ambiguous`, or `unproven`) with the serving provider and record when present, where `declared` means provider proven and record resolved and `serving-record-unresolved` means provider proven without an exact parsed-key record, the reasoning level state (`unknown`, `known`), the configured `litellm_params.reasoning_effort` listed as operator configuration when declared, unproven diagnostic candidate records, and the catalog shape (`complete`, `providers-only`, `unavailable`).

Every field names its basis — `serving`, `canonical`, `litellm-declared`, `enforcement-narrowed` (only after a promotion delta), or `unknown` — and every evidence item names its origin class; unproven provider records appear only as diagnostic candidates and never as evidence of a resolved value.

#### Scenario: mixed metadata sources
- **WHEN** LiteLLM supplies limits and prices while models.dev supplies reasoning support and release metadata
- **THEN** diagnostics distinguish those sources instead of presenting the merged result as a single source

#### Scenario: canonical original selection is explainable
- **WHEN** discovery resolves canonical identity `deepseek/deepseek-v4.1-flash` and the operator declares `models_dev_provider: deepseek` with a wire id exactly matching a DeepSeek serving record
- **THEN** diagnostics report canonical identity `deepseek/deepseek-v4.1-flash`, serving status `declared`, serving provider `deepseek`, and the resolved record id; no `canonical-original` selection source is reported

#### Scenario: provider proven without exact SKU is explainable
- **WHEN** the operator declares `models_dev_provider: deepseek` and the deepseek provider holds only relation-pointing SKUs (`deepseek-flash`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`) while the wire id matches none exactly
- **THEN** diagnostics report serving status `serving-record-unresolved`, list the relation SKUs as candidates for an exact wire id, and report that no provider facts, price, or reasoning levels are used

#### Scenario: canonical identity without serving proof is explainable
- **WHEN** discovery resolves a model to canonical identity `deepseek/deepseek-v4.1-flash` through `base_model` and no serving provider is declared
- **THEN** diagnostics report canonical identity `deepseek/deepseek-v4.1-flash`, evidence `registry-unique`, serving status `unproven`, and no serving record, even though DeepSeek provider records exist

#### Scenario: fallback selection keeps the canonical identity intact
- **WHEN** a model absent from the canonical registry has an exact same-name OpenCode record and no serving provider is declared
- **THEN** diagnostics report no canonical identity (never `opencode/<id>`), serving status `unproven`, and list `opencode/<id>` only as a diagnostic candidate that a `models_dev_provider: opencode` declaration would select

#### Scenario: declared serving is explainable
- **WHEN** discovery resolves a model with `models_dev_provider: opencode` and a record whose key exactly matches the wire id
- **THEN** diagnostics still report the canonical registry identity (never `opencode/<id>`), serving status `declared`, serving provider `opencode`, and the resolved record id

#### Scenario: unknown reasoning levels are explained
- **WHEN** reasoning is supported but the serving provider is unproven
- **THEN** diagnostics state that reasoning levels are unknown because no serving provider is proven, without reporting a withheld reason

#### Scenario: fallback-serving resolution names its origin
- **WHEN** a field value comes from LiteLLM declarations or from a key promoted by the runtime enforcement matrix while unproven provider records exist
- **THEN** the field basis is `litellm-declared` (no key is `enforcement-narrowed` until a promotion delta exists), the message names that source, and no unproven provider record is presented as having decided the value

#### Scenario: configured effort is explained
- **WHEN** a deployment declares `litellm_params.reasoning_effort`
- **THEN** diagnostics report it as operator configuration that requests may override, never as a pin, a level set, or a narrowed value

### Requirement: degraded enrichment
Core SHALL make missing, empty, or registry-less models.dev metadata observable without preventing LiteLLM-only discovery.

#### Scenario: models.dev unavailable
- **WHEN** the supplied models.dev catalog is empty
- **THEN** diagnostics report degraded enrichment and unmatched models while preserving the normal discovery result

#### Scenario: canonical registry unavailable
- **WHEN** the supplied catalog is `providers-only`
- **THEN** diagnostics report that the canonical registry is unavailable and that no provider record is used for the round
