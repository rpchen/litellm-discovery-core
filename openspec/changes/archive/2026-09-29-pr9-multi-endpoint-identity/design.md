# Design

- Endpoint IDs are user-facing stable identities with syntax `[a-z0-9][a-z0-9-_]*`; `default` is ordinary at Core level and only receives compatibility semantics in host adapters.
- `endpointFingerprint()` accepts an optional `endpointID`. When present, it is validated and becomes part of the hashed material.
- When `endpointID` is omitted, Core hashes exactly the pre-PR9 material. This is a compatibility requirement, not an implementation accident.
- Endpoint IDs never replace URL or credential identity: URL, credential, result-affecting build options, and explicit endpoint ID all participate in compatibility.
- Core does not know how many endpoints exist and does not own endpoint configuration, activation state, credentials, storage keys, provider IDs, timers, diagnostics commands, or UI.
