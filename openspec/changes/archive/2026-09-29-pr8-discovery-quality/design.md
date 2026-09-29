# Design

- Model identity matching remains conservative. Core normalizes case, route prefixes, spaces/underscores and repeated separators, but does not guess away semantic suffixes such as `-free`, dates or tiers. Explicit aliases are accepted; ambiguous global matches remain unmatched.
- Source precedence is field-specific and deterministic. Explicit LiteLLM deployment values win for deployment-scoped capabilities, prices, input/output limits and reasoning declarations; models.dev fills missing metadata. Multi-deployment capabilities use conservative intersection and prices use the highest declared LiteLLM value.
- `limit.context`, `limit.input` and `limit.output` keep distinct meanings. models.dev total context is not overwritten merely because LiteLLM declares `max_input_tokens`; the latter remains the input limit and a conservative context fallback only when total context is unknown.
- Protocol selection and protocol capability are separate concepts. Existing selection still prefers Responses when an individual deployment declares both Chat Completions and Responses, while the new capability resolver reports `both`. Missing evidence reports capability `unknown` while preserving the existing selected-protocol fallback.
- Reasoning support is independent from reasoning variants. Explicit LiteLLM `supports_reasoning` wins; models.dev `reasoning` or reasoning options fill missing declarations. Conflicts are observable.
- Unknown or privately named models remain discoverable from LiteLLM with deterministic safe defaults; models.dev enrichment is never required for basic discovery.
- Diagnostics extend the existing observational contract with canonical identity, match kind, reasoning support, protocol capability, fallback mode and conflict-resolution records. No endpoint, credential or raw error data is required or emitted.
- PR8 does not add network calls, timers, persistence, host SDK dependencies or a new discovery source.
