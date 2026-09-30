# Tasks

- [x] Add fake OpenSpec repository fixtures covering missing ADDED capability, stale MODIFIED requirement, lingering REMOVED requirement, malformed delta and valid archive.
- [x] Implement the closure checker semantic parser and actionable diagnostics while preserving the active completed-change check.
- [x] Add the checker regression suite to `test:openspec-closure` and keep the implementation independently runnable after clone.
- [x] Update `docs/testing-standard.md` §7 with the archived-delta canonical-sync invariant.
- [x] Run typecheck, Bun tests, strict OpenSpec validation, closure tests, package/build checks and applicable CI.
- [x] Run the new gate over every historical archive and record verifiable/legacy counts.
- [x] Mark this change complete, archive it with the OpenSpec CLI, rerun strict validation and rerun the new closure gate.
- [x] README impact: No README change: no user-visible behavior.
