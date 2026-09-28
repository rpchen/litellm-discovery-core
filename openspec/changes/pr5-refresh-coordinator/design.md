# Design

- The coordinator is generic over the discovered value and keyed by a caller-provided deployment identity.
- Concurrent refreshes for the same key share one in-flight promise (singleflight).
- Successful values stay fresh for 30 seconds by default. Callers may force a refresh to bypass TTL and retry backoff.
- Degradable failures use capped delays of 1s, 2s, 5s, 10s, then 30s and retain the last successful value as stale.
- Failure classification stays host-neutral: callers can select `stale`, `clear`, or `ignore` per error. Authentication/configuration failures therefore remain adapter policy instead of Core knowing plugin error classes.
- The coordinator does not create timers or background tasks. Adapters keep ownership of Pi/OpenCode session/event scheduling and can query the remaining retry delay.
- State is isolated per key and can be explicitly cleared when a connection identity is removed or changed.
