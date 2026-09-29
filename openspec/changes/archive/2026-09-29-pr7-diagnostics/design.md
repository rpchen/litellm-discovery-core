# Design

- Diagnostics are observational: the returned model list is produced by the existing discovery builder, and diagnostic metadata explains that result rather than replacing the algorithm.
- Protocol diagnostics reuse the protocol resolver and expose a reason: explicit override, Anthropic/Claude evidence, supported_endpoints, mode, ordinary chat fallback, or mixed-deployment conservative fallback.
- Per-model diagnostics expose models.dev match identity and source provenance for protocol, reasoning variants, capabilities, context/output limits, pricing and release metadata.
- /v1/models is reported as intentionally unused because it is not an authoritative discovery source and can contain stale allow-list entries. PR7 does not add a second LiteLLM discovery request.
- Cache diagnostics are a pure formatter over adapter-provided refresh/snapshot state. Core creates no timers, performs no I/O, and stores no host state.
- Diagnostic payloads contain no endpoint URL, credential, connection identity or raw error body. Host adapters may add safe version/provenance metadata.
