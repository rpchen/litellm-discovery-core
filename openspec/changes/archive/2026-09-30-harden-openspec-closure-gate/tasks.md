# Tasks

- [x] Add fake OpenSpec repository fixtures covering missing ADDED capability, stale MODIFIED requirement, lingering REMOVED requirement, malformed delta and valid archive.
- [x] Implement the closure checker semantic parser and actionable diagnostics while preserving the active completed-change check.
- [x] Add the checker regression suite to `test:openspec-closure` and keep the implementation independently runnable after clone.
- [x] Update `docs/testing-standard.md` §7 with the archived-delta canonical-sync invariant.
- [x] Run typecheck, Bun tests, strict OpenSpec validation, closure tests, package/build checks and applicable CI.
- [x] Run the new gate over every historical archive and record verifiable/legacy counts.
- [x] Mark this change complete, archive it with the OpenSpec CLI, rerun strict validation and rerun the new closure gate.
- [x] Remove fuzzy requirement-title reconciliation from the closure gate and replace it with exact title, formal RENAMED, and explicit version-controlled legacy compatibility aliases.
- [x] Add regression coverage proving similar titles remain independent, RENAMED and legacy aliases reconcile, invalid compatibility mappings fail closed, same-day lexical order does not define semantic order, ambiguous chronology fails closed, and explicit chronology resolves ambiguity.
- [x] Replace the fabricated total order with a partial-order chronology model (before/after/same/incomparable/unknown) and fail closed on same-commit or incomparable conflicting states without any lexical/timestamp/array fallback.
- [x] Replay ADDED/MODIFIED/REMOVED/RENAMED as one state machine per requirement identity so REMOVED participates in chronology and re-ADDED after REMOVED is judged by chronology.
- [x] Replay within one archived delta in the OpenSpec 1.13.2 apply order and fail closed on grammar-rejected conflicting transitions inside one delta.
- [x] Add regression coverage for ADDED -> REMOVED, MODIFIED -> REMOVED, REMOVED -> ADDED, RENAMED chains, conflicting RENAMED, same-commit same/conflicting states, incomparable histories, reversed lexical ancestry and partial-order fixture injection.
- [x] Provide complete Git history in every workflow job that runs the closure gate and guard it with a static regression test.
- [x] README impact: No README change: no user-visible behavior.
