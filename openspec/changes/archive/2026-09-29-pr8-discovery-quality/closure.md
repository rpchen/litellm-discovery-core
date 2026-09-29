# PR8 cross-repository closure

PR8 Discovery Quality is closed against the merged Core implementation and both production consumers.

## Verified revisions

- Core PR #14: `ef20bb92c778bf27afb7a8ceca84e944143ed667`
- Pi PR #26 / main: `598eabb97be2823ff8cd03feec4db59bc5dfa514`
- OpenCode PR #29 / main: `a667f2995dc7ee7c808aa5865d6dc650c0fd5308`

Both consumer distributions record Core `ef20bb92c778bf27afb7a8ceca84e944143ed667` in `dist/core-provenance.json`.

## Verification evidence

Core PR #14 and its merged main revision passed typecheck, Bun tests, ESM/declaration build, isolated consumer import, and strict OpenSpec validation.

The first post-Core compatibility runs intentionally exposed stale consumer expectations for the new token-limit semantics. The integration PRs did not merely update snapshots:

- Pi adds a vertical assertion that Core `limit.context` and `limit.output` reach `contextWindow` and `maxTokens`.
- OpenCode adds a vertical assertion that distinct Core `limit.context` and `limit.input` survive host adaptation unchanged.
- Both repositories update their user-facing README and their PR8 OpenSpec Scenario evidence.
- Both committed distributions were rebuilt from the merged Core SHA.

Pi PR #26 and OpenCode PR #29 each passed their complete PR CI, then their merged `main` revisions passed CI again. OpenCode's gate includes committed-distribution verification, immutable delivery checks, typecheck, unit tests, TUI rendering/actions, clean external distribution build, strict OpenSpec, delivered-tarball installation, remote-Git installation, and final repository-cleanliness checks.

## README gate

No additional README change is required in this closure-only change. User-visible PR8 behavior was documented in Core PR #14, Pi PR #26, and OpenCode PR #29.
