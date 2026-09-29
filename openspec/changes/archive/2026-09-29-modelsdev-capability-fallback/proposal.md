# models.dev capability fallback

Fix models.dev enrichment for models that are present under multiple provider records but whose original provider is absent from the provider catalog. Discovery should prioritize accurate model capabilities and limits rather than dropping enrichment because provider-scoped prices differ.
