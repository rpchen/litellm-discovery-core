# Trusted model capability publication

## Why

Core is the single business source of truth for model capability
semantics, but today it has no formal, testable rule answering
"is this discovered model's metadata reliable enough to publish as a
fully configured model". Legacy defaults fill the gap silently:
`tools` defaults to enabled when neither source declares support,
`0` limits mean unknown yet travel inside a normal-looking `ModelSpec`,
reasoning unknown collapses to `false`, and adapters infer reasoning
from variant count. Family-name heuristics still influence modality
mapping. A model with guessed, missing, or illegal capability data can
therefore reach Pi/OpenCode looking like a correctly configured model,
and hosts may misconfigure context windows, disable or enable tool
calling wrongly, or offer reasoning controls that do not exist.

The project value is accurate capability configuration so hosts use
models correctly, not maximizing `/models` count or billing precision.
This change closes the publication loop with a codified completeness /
publishability policy, explicit unknown semantics, provenance, LKG, and
user-accepted degradation -- all owned by Core.

## What Changes

- Add a formal, testable completeness / publishability policy in Core:
  which fields are required for normal publication, how `0` / missing /
  illegal values are rejected, and how `unknown` blocks publication
  without being rewritten to `false` or `0`.
- Distinguish `false` (trusted evidence of no support) from `unknown`
  (no trusted evidence) for tool calling and reasoning; adjust the
  domain model so the distinction is representable and testable.
- Decouple reasoning support from reasoning levels: `supported=true`
  with zero selectable levels is legal; missing levels never imply
  `supported=false`, and `supported=true` never implies non-empty levels.
- Keep and verify the existing metadata source priority; resolve identity
  only through canonical identity, provider identity, alias, equivalent
  relations, or other verifiable deterministic relations; keep
  `ambiguous` / `unmatched` observable and never force-pick.
- Allow deterministic inheritance only with provenance (explicit alias /
  equivalent declarations, schema-expressed inheritance, canonical-model
  field inheritance, traceable same-model evidence); prohibit
  name/family/neighbor-model capability guessing and remove family-name
  influence from capability mapping.
- Classify metadata failures (timeout, 5xx, unreachable, not-found,
  ambiguous, missing-field, illegal-value, schema-incompatible,
  cached-use, recovered-after-retry) so failures never produce
  pseudo-complete configurations via defaults.
- Add Last Known Good (LKG) without fixed TTL: validity follows identity,
  provider, canonical-mapping, schema, and conflict evidence; record
  source, fetch time, age, and live-vs-LKG selection with reasons.
- Add explicit model configuration states (configured, configured-lkg,
  discovered-incomplete, unmatched, ambiguous, metadata-unavailable,
  invalid-metadata, degraded) and a user-accepted degradation path that
  never re-labels degraded models as fully configured.
- Extend the existing provenance mechanism (no parallel system) to field
  level for limits, modalities, tools, reasoning, levels, identity
  resolution, and live/fallback/LKG selection.
- Cover the full test matrix (normal match, reasoning, completeness,
  identity, network/LKG, explicit degradation) in Core; adapters consume
  the same Core result without reimplementing policy.

## Terminology

- Normal publication: the plugin exposes a model to Pi/OpenCode as a
  correctly configured model the host may list and use normally.
- Meets normal-publication requirements: Core holds sufficiently
  accurate, trustworthy capability information that the host will not
  misconfigure or misuse the model.
- `false`: trusted information confirms the model lacks the capability.
- `unknown`: currently no sufficiently trusted information to decide.
- Last Known Good (LKG): a previously fetched metadata snapshot that
  passed the current publication completeness rule when fetched and may
  still be used while live sources fail, subject to identity/schema/
  conflict validity -- never a fixed-TTL expiry.
- Explicit degradation: the plugin cannot obtain complete trustworthy
  capabilities, informs the user of exactly what is missing, and only
  exposes the model after the user actively accepts the degraded result;
  the model stays labeled degraded.

## Non-Goals

- Endpoint CRUD UI, project-level endpoint config, protocol-override /
  poll-interval / context-tier-cap UI, billing/price-precision systems,
  per-model capability hardcodes, broadening publication to inflate
  `/models` counts, large adapter rewrites.
