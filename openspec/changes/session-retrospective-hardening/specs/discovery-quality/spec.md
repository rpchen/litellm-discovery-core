# Discovery quality

## ADDED Requirements

### Requirement: capability fallback pricing is non-authoritative
Core SHALL NOT present provider pricing from OpenRouter, OpenCode, or an otherwise selected reseller as the LiteLLM deployment price when that record was selected only for capability enrichment.

#### Scenario: OpenRouter provides capabilities but LiteLLM omits price
- **WHEN** OpenRouter is selected as the capability fallback and LiteLLM does not declare token prices
- **THEN** Core uses the OpenRouter capability/limit metadata but leaves deployment pricing unknown/zero and diagnostics explain that the fallback price was ignored

### Requirement: operational limits are explicit
Core SHALL distinguish a neutral discovered model from a model that has positive context/output limits suitable for host publication.

#### Scenario: private model has no token-limit metadata
- **WHEN** LiteLLM exposes a model and neither LiteLLM nor models.dev supplies positive context/output limits
- **THEN** Core retains the neutral ModelSpec for diagnostics, reports a missing-operational-limits warning, and reports that the ModelSpec is not operational for host publication
