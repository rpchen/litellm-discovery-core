## 1. Core implementation

- [x] 1.1 Copy the host-independent source modules from the inspected baseline into `src/core/` and remove host SDK fields.
- [x] 1.2 Add `src/index.ts` and export the public functions and types.
- [x] 1.3 Keep ESM `.js` specifiers and zero runtime dependencies.

## 2. Tests and packaging

- [x] 2.1 Migrate sanitized LiteLLM/models.dev fixtures and core regression tests.
- [x] 2.2 Add TypeScript typecheck, ESM declaration build, and isolated consumer import verification.
- [x] 2.3 Add README, AGENTS.md, source provenance, architecture decisions, and CI workflow.

## 3. Validation

- [x] 3.1 Run `npm run typecheck`, `bun test`, `npm run build:dist`, `npm run test:package`, and `npm run validate:spec` locally; record actual results in the PR.
- [ ] 3.2 Push the feature branch and verify GitHub Actions CI before review.
- [ ] 3.3 Open a PR against `main`; do not merge it.

