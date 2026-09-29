# PR9 multi-endpoint identity

## Why

Pi and OpenCode need to expose multiple independently managed LiteLLM endpoints without duplicating host-neutral endpoint identity rules. Snapshots for two explicit endpoints must never become interchangeable merely because their URL, credential, and discovery options happen to match, while legacy single-endpoint snapshots must remain restorable without migration.

## What Changes

- Define the stable lowercase ASCII endpoint ID contract used by both host adapters.
- Allow explicit endpoint identity to participate in endpoint fingerprints.
- Preserve the exact legacy fingerprint material when endpoint identity is omitted.
- Keep configuration, activation, credentials, persistence, provider registration, polling, commands, and UI in host adapters.
