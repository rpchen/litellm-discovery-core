# Tasks: trusted model capability publication (Core)

- [x] Remove family-name influence from capability mapping (`isModalitiesTrustFamily`); modalities come only from explicit declarations or the text-only baseline.
- [x] Add tri-state capability assessment (tools / reasoning unknown-aware) without breaking the `ModelSpec` wire shape.
- [x] Add tri-state reasoning resolver decoupled from variant levels; keep legacy boolean resolver as wrapper.
- [x] Add detailed models.dev selection outcome (`matched` / `unmatched` / `ambiguous`) with deterministic canonical inheritance and provenance.
- [x] Add completeness / publishability policy (`assessPublishability`) with missing/unknown/illegal field lists.
- [x] Add configuration status model (`configured`, `configured-lkg`, `discovered-incomplete`, `unmatched`, `ambiguous`, `metadata-unavailable`, `invalid-metadata`, `degraded`) and publish predicates.
- [x] Add metadata failure taxonomy (`classifyMetadataFailure`) covering timeout / 5xx / unreachable / not-found / ambiguous / missing-field / illegal-value / schema-incompatible / cached / recovered.
- [x] Add Last Known Good store without TTL (identity/schema/conflict validity, age reporting).
- [x] Add explicit degradation acceptance path that never re-labels degraded as configured.
- [x] Extend diagnostics provenance with publication status, per-field `lkg` / `canonical-inheritance` sources, and degraded marking.
- [x] Expose the Core reasoning verdict on `ModelSpec.reasoningSupported` so adapters stop inferring support from variant count.
- [x] Add Core tests: normal match, provider priority, alias/equivalent/canonical inheritance, provenance (7+ scenarios).
- [x] Add Core tests: reasoning false / true+levels / true+no-levels / unknown, no auto-flip invariants (6+ scenarios).
- [x] Add Core tests: completeness (publishable, missing context/maxTokens, zero values, unknown capability, illegal, schema-incompatible) (8+ scenarios).
- [x] Add Core tests: identity (provider canonical, OpenRouter/OpenCode fallback, alias, equivalent, unique global, ambiguous, unmatched, no family guessing) (9+ scenarios).
- [x] Add Core tests: network/LKG (timeout, 5xx, unreachable, retry-recovery, valid LKG, old-but-stable LKG, identity conflict, live-conflicts-LKG, schema change) (9+ scenarios).
- [x] Add Core tests: explicit degradation (no-LKG failure blocked, incomplete blocked, accepted-stays-degraded, degraded-not-configured) (4+ scenarios).
- [x] Run `npm run typecheck`, `bun test`, `npm run build:dist`, `npm run test:package`, `npm run validate:spec`, `npm run test:openspec-closure`.
- [x] Update README: no change required — Core adds neutral API and no user-visible behavior on its own (PR body records `No README change: no user-visible behavior`).
- [ ] Archive the change with OpenSpec CLI and re-run strict validation (deferred: Pi/OpenCode adapters must consume and validate this Core SHA first; archive once the cross-repo chain is reviewed).

## Cross-repository follow-ups (owned by the adapter repositories)

- pi-litellm-provider PR #45: consume the partition, Core reasoning verdict, LKG, degraded acceptance, diagnostics.
- opencode-litellm-provider PR #53: same policy through the sync loop, publication RPC, diagnostics/TUI lines.
- Both adapters refresh `dist/` (`build:dist`) to the merged Core SHA before their dist-gated verification and real-host E2E.