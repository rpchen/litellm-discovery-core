# Design

- Core retains neutral unknown-limit ModelSpecs for diagnostics and fingerprinting, but exposes an operational-limit predicate for host adapters. A host must not publish context/output values that are non-positive.
- models.dev selection provenance is explicit. OpenRouter/OpenCode/unique reseller selections may enrich capabilities and limits, but their provider prices are not used as LiteLLM deployment prices.
- Diagnostics report missing operational limits and explain when a provider fallback price was ignored.
- The shared testing standard becomes the normative source for provider fallback order, price semantics, host-local presentation, dismissible persistent UI, OpenSpec closure, and release closure.
- CI gains a closure check that rejects a fully completed OpenSpec change left active instead of archived.
