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
- [x] Remove family-name provider preference from trusted publication identity resolution; keep any name-prefix helper isolated from publication.
- [x] Treat unknown input/output modalities as publication completeness gaps.
- [x] Aggregate tools and reasoning with one tri-state rule so unknown cannot be filtered into true or false.
- [x] Restrict ordinary degradation to discovered-incomplete and metadata-unavailable; reject ambiguous, invalid-metadata, and unmatched-incomplete.
- [x] Revalidate LKG against the current publication verdict, not only positive limits.
- [x] Sync `docs/testing-standard.md` so family heuristics no longer participate in trusted publication.
- [x] Apply group-wide evidence to limits (unknown/conflict preserved, no minimum merging) and per-dimension modality evidence (sparse flags never complete a set).
- [x] Detect group identity conflicts (distinct explicit providers, distinct routed identities without proven equivalence) instead of first-deployment-wins.
- [x] Store actual modality sets and context/output values in LKG captured verdicts; reject the entire entry when a new live fact contradicts them; never restore LKG over illegal live metadata.
- [x] Round 3 blockers: LKG modality conflict inspects every live explicit declaration (order-independent, `undefined` never masks a sibling); LKG limit conflict compares context/input/output like-for-like (no `max_input_tokens` vs total context) and includes the latest trusted model-level context/output.
- [x] Round 3 blockers: provider-qualified deployment identities keep their namespace; identity reconciliation runs over a symmetric equivalence graph so relation direction and deployment order never change the verdict.
- [x] Round 3 blockers: LKG captured facts must equal the stored `ModelSpec` (limits, tools, reasoning, modality sets); explicit model-level output <= 0 is `invalid-metadata`, never missing; bump `PUBLICATION_SCHEMA_VERSION` for the captured `input` fact.
- [x] Add Core tests: LKG modality order-independence, limit dimension separation, model-level limit conflicts, provider-namespace identity, equivalence order-independence, forged captured/spec mismatches, model-level output illegality.
- [x] Add OpenSpec scenarios for all round 3 behaviors; extend `docs/testing-standard.md` with the provider-namespace, like-for-like LKG comparison, and captured↔spec long-term rules.
- [x] Run `npm run typecheck`, `bun test`, `npm run build:dist`, `npm run test:package`, `npm run validate:spec`, `npm run test:openspec-closure`.
- [ ] Archive the change with OpenSpec CLI and re-run strict validation (deferred: Pi/OpenCode dist, package verification, and real-host E2E still require the merged Core SHA).

## Cross-repository follow-ups (owned by the adapter repositories)

- pi-litellm-provider PR #45: consume the partition, Core reasoning verdict, LKG, degraded acceptance, diagnostics.
- opencode-litellm-provider PR #53: same policy through the sync loop, publication RPC, diagnostics/TUI lines.
- Both adapters refresh `dist/` (`build:dist`) to the merged Core SHA before their dist-gated verification and real-host E2E.