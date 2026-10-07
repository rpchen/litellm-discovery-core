# Delta: discovery-quality

## MODIFIED Requirements

### Requirement: fallback metadata is secondary evidence
Core SHALL distinguish provider-scoped serving metadata obtained through fallback selection from canonical intrinsic evidence, and SHALL NOT publish fallback serving values as authoritative intrinsic facts. Unique trusted matches are fallback sources: only the canonical-original record, an explicit-provider record proven by its own deterministic canonical relation, or a record with the deployment's own qualified namespace proof carries authoritative intrinsic authority. Price eligibility follows the same graded authority: a selected record without authoritative intrinsic authority never donates its provider price as the route price.

#### Scenario: OpenRouter fallback serving limit is not authoritative
- **WHEN** an OpenRouter record is selected only as a fallback enrichment source and LiteLLM declares a smaller descriptive output limit
- **THEN** Core keeps the authoritative intrinsic authority unavailable, records the two conflicting values, and withholds the model instead of publishing the reseller serving limit as the model's intrinsic output

#### Scenario: unique trusted match is a fallback source
- **WHEN** a single remaining provider matches the candidate and LiteLLM declares a conflicting descriptive value
- **THEN** Core treats the unique-match record as fallback-serving evidence, reports an unresolved conflict instead of an authoritative override, and only fills genuinely undeclared fields

#### Scenario: explicit provider without a canonical relation proof
- **WHEN** an explicit `models_dev_provider` selects a record whose metadata carries no deterministic canonical relation
- **THEN** Core treats the selection as proof of the serving provider choice only, and the record limits behave as fallback-serving evidence instead of authoritative intrinsic facts

#### Scenario: explicit provider without a canonical relation proves no price
- **WHEN** an explicit `models_dev_provider` selects a record without a canonical relation while LiteLLM declares no token price
- **THEN** Core leaves deployment pricing unknown/zero; the explicitly selected record's provider price never becomes the route price

#### Scenario: explicit provider with a canonical relation follows the price fallback policy
- **WHEN** an explicit `models_dev_provider` selects a record that declares a deterministic canonical relation while LiteLLM declares no token price
- **THEN** Core may use that record's price under the established price fallback policy and records its provenance

#### Scenario: fallback serving metadata fills gaps only
- **WHEN** a fallback-selected record supplies limits or capability facts that no LiteLLM source declares
- **THEN** Core uses those values as fallback-serving provenance and they never outrank LiteLLM descriptive or constraint evidence

#### Scenario: canonical original remains authoritative
- **WHEN** the selected record is the canonical-original provider record or an explicit-provider record proven by its own canonical relation
- **THEN** its limit, modality, tool, and reasoning facts keep the authoritative intrinsic authority established by the trusted publication policy

### Requirement: record-level selection determinism
When one provider offers multiple records that match one candidate, Core SHALL collect every matching record and SHALL pick deterministically: records with provably equivalent publication-critical facts resolve through a record-intrinsic deterministic tie-break; records with materially different serving metadata and no ranking rule keep the whole provider match set unresolved. Neither the catalog object iteration order nor the first record may decide. This applies to every selection path, including the canonical-original path; conflicting original-provider candidates fail the candidate closed instead of letting a lower-precedence reseller record win.

#### Scenario: equivalent serving records ignore record order
- **WHEN** one provider holds several records that match the candidate and their publication-critical facts (limits, modalities, tool/reasoning verdicts, canonical relation target) are identical
- **THEN** reordering the provider's `models` object keys selects the same record with the same provenance

#### Scenario: material record conflicts fail closed on every order
- **WHEN** one provider holds several matching records whose limits or capability facts differ materially with no rule proving which serves the deployment
- **THEN** the provider's match set stays unresolved (ambiguous/withheld as applicable) regardless of record order, instead of silently selecting the first record

#### Scenario: conflicting original records never fall through to a reseller
- **WHEN** the canonical-original candidates for one candidate identity exist but their publication-critical facts conflict without a ranking rule
- **THEN** Core reports the candidate ambiguous/withheld and never selects an OpenCode or OpenRouter fallback record for it

### Requirement: runtime constraints never conflict with serving metadata
Resolution SHALL separate LiteLLM descriptive declarations from proven endpoint runtime constraints: a constraint narrows the effective value and never participates in same-level conflict judgment -- including against fallback-serving values.

#### Scenario: fallback serving limit narrowed by an enforced cap
- **WHEN** a fallback-serving record reports an output limit and the deployment's `litellm_params` proves a smaller enforced `max_tokens`
- **THEN** Core publishes the narrowed effective value and records a constraint-narrowed resolution, not an unresolved conflict

#### Scenario: descriptive disagreement with fallback serving still conflicts
- **WHEN** a fallback-serving record's value differs from a descriptive LiteLLM declaration (not a proven constraint)
- **THEN** the field stays an unresolved conflict at the same authority level