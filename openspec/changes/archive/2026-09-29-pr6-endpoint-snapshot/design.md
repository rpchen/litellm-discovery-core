# Design

- A snapshot contains only neutral `ModelSpec[]`, its stable model fingerprint, discovery time, an explicit schema version, and an endpoint fingerprint.
- The endpoint fingerprint is SHA-256 over normalized LiteLLM root URL, credential key, and result-affecting build options. Raw credentials and URLs are never stored in the snapshot fingerprint.
- Snapshot parsing is strict enough to reject malformed, unsupported-version, endpoint-mismatched, or content-tampered data.
- Drift comparison distinguishes endpoint changes; model additions/removals; protocol changes; capability changes; and metadata-only changes.
- Compatibility drift is endpoint/topology/protocol/capability change. Cost/limit/release/variant-only changes remain observable as metadata changes but do not independently mark compatibility drift.
- Core performs no filesystem, host storage, timer, network, or lifecycle I/O. Pi and OpenCode own persistence and restore integration.
