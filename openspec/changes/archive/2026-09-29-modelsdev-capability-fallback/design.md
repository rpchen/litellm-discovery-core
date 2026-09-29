# Design

- LiteLLM remains authoritative for the deployed model list and any metadata it explicitly declares.
- Core first honors an explicit `models_dev_provider` from LiteLLM.
- When models.dev provider records expose `canonical_model_id`, Core derives the original provider from that identity and prefers a matching original-provider record without requiring a hard-coded family rule.
- Legacy family rules remain only for older/synthetic catalogs that lack canonical identity.
- If the original provider record is unavailable, Core prefers OpenRouter, then OpenCode, then a globally unique remaining record. Multiple unresolved reseller records remain ambiguous.
- The selected fallback record is primarily an enrichment source for capability, limit, modality and reasoning metadata. Explicit LiteLLM prices still take precedence.
- A fallback record that supplies valid limits must never yield a zero context/output configuration in the resulting ModelSpec.
