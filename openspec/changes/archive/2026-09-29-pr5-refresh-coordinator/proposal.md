# PR5 refresh coordinator

Add a host-independent discovery refresh coordinator shared by Pi and OpenCode. The coordinator owns request coalescing, short-lived freshness, forced refresh, retry backoff, and last-known-good fallback while leaving transport, credentials, persistence, registration, and host lifecycle in adapters.
