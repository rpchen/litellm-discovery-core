# Discovery quality

## ADDED Requirements

### Requirement: capability-first provider fallback
Core SHALL prioritize reliable model capability metadata when the same model is offered by multiple models.dev providers.

#### Scenario: canonical metadata identifies an unlisted family
- **WHEN** multiple provider records share one `canonical_model_id` and the original provider record is present
- **THEN** Core selects that original provider without requiring a model-family hard-code

#### Scenario: original provider record is unavailable
- **WHEN** the original provider cannot be selected and both OpenRouter and OpenCode expose the model
- **THEN** Core selects OpenRouter before OpenCode

#### Scenario: OpenRouter is unavailable
- **WHEN** the original provider and OpenRouter are unavailable but OpenCode exposes the model
- **THEN** Core selects OpenCode before treating other reseller records as ambiguous

#### Scenario: reseller ambiguity remains
- **WHEN** no original, OpenRouter, or OpenCode record exists and multiple other providers match
- **THEN** Core leaves models.dev enrichment unmatched rather than selecting an arbitrary reseller

### Requirement: capability fallback preserves operational limits
A capability fallback SHALL populate valid model limits when the selected models.dev record provides them, while explicit LiteLLM pricing remains authoritative.

#### Scenario: hy4-preview is routed through an OpenAI-compatible LiteLLM deployment
- **WHEN** LiteLLM exposes `hy4-preview` without token limits, OpenRouter provides context/output limits, and LiteLLM explicitly provides token prices
- **THEN** Core emits non-zero context/output limits from the OpenRouter record, preserves the LiteLLM prices, and does not emit a models-dev-unmatched warning
