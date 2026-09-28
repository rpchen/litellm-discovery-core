# PR8 discovery quality

Improve Core discovery quality without adding host I/O or changing the authoritative LiteLLM source. PR8 adds conservative model identity canonicalization and aliases, explicit reasoning/protocol capability resolution, distinct context/input/output limits, deterministic metadata precedence, unknown-model fallback, and machine-readable quality/conflict provenance.

Pi and OpenCode continue to consume neutral `ModelSpec[]`; host-specific transport, persistence, registration and UI remain outside Core.
