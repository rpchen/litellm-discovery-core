# Design: trusted model capability publication

## Architecture

New host-independent module `src/core/publication.ts` owns the
publication loop; existing modules keep their responsibilities:

- `litellm.ts`: normalization, grouping (unchanged).
- `modelsdev.ts`: record selection + reasoning/variant extraction.
  Selection gains a detailed outcome (`matched` / `unmatched` /
  `ambiguous`) and deterministic canonical inheritance; the legacy
  single-result selector stays as a wrapper. Reasoning gains a tri-state
  resolver; the legacy boolean resolver stays as a wrapper mapping
  `unknown` to `false` for backward compatibility only.
- `capabilities.ts`: numeric/boolean merge (unchanged wire shape).
  Gains an unknown-aware assessment used by the publication policy;
  the legacy `tools=true` default remains visible only inside the legacy
  boolean field and is never used for publish decisions. Family-name
  modality influence (`isModalitiesTrustFamily`) is removed: modalities
  come only from explicit LiteLLM declarations, models.dev modalities,
  or the documented text-only baseline with `default` provenance.
- `diagnostics.ts`: extends existing `FieldProvenance` / quality /
  issue contract with publication status, missing/unknown/illegal field
  lists, LKG selection, and degraded acceptance. No parallel provenance
  system.
- `publication.ts` (new): tri-state, completeness policy, configuration
  status, failure taxonomy, LKG store, degradation acceptance,
  per-field provenance detail. Zero runtime dependencies, no host I/O.
- `build.ts`: `ModelSpec` wire shape is additive-only. New optional
  assessment fields may be exposed alongside the stable shape; existing
  consumers keep compiling. `hasOperationalLimits` stays as the minimal
  adapter guard; the full policy lives in `publication.ts`.

## Domain semantics

### Tri-state

`CapabilityState = "supported" | "unsupported" | "unknown"`.
`unknown` means no sufficiently trusted evidence; it never converts to
`false`, `0`, or `[]` on any path that leads to normal publication.

- Tool calling: supported iff some trusted source explicitly declares
  `true`; unsupported iff trusted evidence confirms lack of support
  (explicit `false` from LiteLLM, or explicit models.dev `false` with no
  contradicting LiteLLM `true`); otherwise unknown.
- Reasoning: independent tri-state via the same rule from
  `supports_reasoning` / models.dev `reasoning`. Variant presence never
  decides support in either direction.
- Modalities: resolved string sets as today, plus known/unknown flags
  derived from provenance. The text-only baseline (`default` provenance)
  is a safe conservative floor for publication: it may understate a
  model, never overstate it, so it does not block publication but stays
  visible in provenance/diagnostics.

### Reasoning / levels decoupling

`reasoningSupported=true` with `levels=[]` (no selectable levels) is
legal -- e.g. a model that always reasons or toggles reasoning without
grades. Invariants, all tested:

- `supported=true` does not imply `levels.length > 0`.
- `levels.length === 0` does not imply `supported=false`.
- `supported=unknown` stays unknown regardless of levels.
- Adapter reasoning display uses the Core reasoning state, never
  `variants.length > 0`.

### Completeness / publishability policy

Normal publication requires ALL of:

1. `limit.context > 0` and `limit.output > 0` (integers; `0`, missing,
   negative, NaN, non-integer-truncated-to-zero all fail).
2. Tool calling state is known (`supported` or `unsupported`).
3. Reasoning state is known (`supported` or `unsupported`).
4. When the model genuinely offers selectable levels
   (`reasoning_options` declares effort/budget values), levels are
   parsed; absence of levels for a reasoning model is not a failure.
5. Identity is resolved to exactly one trusted record or to a
   LiteLLM-only model whose LiteLLM declarations alone satisfy 1-3
   (private-model path stays legal).
6. No illegal metadata (e.g. `contextWindow=0` presented as valid,
   contradictory types, schema-incompatible catalog shapes used as facts).
7. Protocol selection is always present (chat fallback preserved); the
   protocol *support* being `unknown` is reported but does not block,
   because the chat fallback is the documented safe invocation default.

Any `unknown` in 1-3, any illegal value, any ambiguous/unmatched
identity without sufficient LiteLLM-only evidence, or any unavailable
metadata without valid LKG yields `publishable=false` with explicit
`missingFields` / `unknownFields` / `illegalFields` lists.

### Identity and source resolution

Trusted publication priority:
explicit `models_dev_provider` > canonical-original > OpenRouter >
OpenCode > unique-match > ambiguous/unmatched. Matching uses canonical
identity, provider identity, explicit alias, equivalent relations, or
other metadata-expressed mappings only. Family-name provider guessing
is not a publication step. A name-prefix helper, if retained for
non-publication compatibility, is isolated and cannot affect
`configured`.

Group-wide evidence: when one model name aggregates multiple
deployments, every publication-critical field needs group-wide proof.
Deployment values that agree are known; partially-declared fields stay
unknown; disagreement between deployments, or between declared values
and contradicting model-level metadata, is a conflict
(`invalid-metadata`, in `conflictFields`) that blocks publication.
Minimum/maximum merging never upgrades unknown into known. Limits use
`aggregateScalarEvidence`; tools/reasoning use `aggregateTriState`;
modalities aggregate per dimension with the models.dev `modalities`
array as the only documented complete-set source.

Group identity (`groupIdentityConflict`) works over an identity
equivalence graph:

- Identity nodes keep the provider namespace. `openai/foo`,
  `anthropic/foo`, and an unqualified `foo` are three distinct
  identities; an explicit `models_dev_provider` on a deployment is the
  deterministic namespace proof that qualifies its names. `base_model`
  follows the same rule — qualified names stay qualified, unqualified
  names stay unqualified.
- Edges come from deployment declarations (a deployment's own ids
  jointly identify it) and from catalog relations (`canonical_model_id`,
  `aliases`, `equivalent_to`, `equivalents`, `inherits`) with targets
  kept as written. Reconciliation is decided by connectivity in this
  graph, which is symmetric: the verdict never depends on deployment
  array order or on which side stores the relation. The graph proves
  identity membership only; capability values never inherit through it.

Scalar limits are three distinct dimensions by design: `context` is
total context (models.dev `limit.context`, with deployment
`max_input_tokens` usable as capture-time fallback only when no total
exists), `input` is input capacity (deployment `max_input_tokens`,
models.dev `limit.input`), `output` is the output limit (deployment
`max_output_tokens`/`max_tokens`, models.dev `limit.output`). Any
explicitly declared non-positive value — deployment or model-level,
context or output — is `illegal`, never missing. Publication gates on
context/output; adapters consume `limit.context`/`limit.output` and
ignore `limit.input`, which stays a completeness-neutral diagnostic and
LKG conflict dimension.

LKG entries store the actual critical facts (tools/reasoning verdicts,
resolved modality sets, context/input/output values) plus the verdict
flags, and `validateCapturedPublication` proves those facts equal the
stored `ModelSpec` before anything restores. Restoration re-checks every
explicit live fact against them, like-for-like per dimension: total
context only against the trusted model-level `limit.context`, output
against every explicit output fact, input against the recomputed current
input limit, and modalities against every deployment's explicit flags
plus the trusted model-level sets. Any contradiction — including a new
model-level context/output value — rejects the whole entry (no
field-level merge), and illegal live metadata keeps `invalid-metadata`
with no restoration. `PUBLICATION_SCHEMA_VERSION` bumps whenever captured
shape or meaning changes (v3 adds the `input` fact) so older snapshots
cannot parse into a stricter policy.

Deterministic inheritance (allowed, with provenance): explicit alias
targets, `equivalent_to` / `equivalents` declarations, schema-expressed
`inherits` / canonical `canonical_model_id` field inheritance, provider
declared canonical inheritance. Each inherited field records
`canonical-inheritance` provenance naming the source identity.
Heuristic guessing (name contains code/pro/flash/thinking, same-family
neighbor values, family regex capability fills) stays prohibited and is
covered by a dedicated negative test.

### Failure taxonomy

`MetadataFailureKind`: `timeout` | `server-5xx` | `unreachable` |
`not-found` | `ambiguous` | `missing-field` | `illegal-value` |
`schema-incompatible` | `cached` | `recovered-after-retry`.
Classification is pure (no I/O) over error shape + HTTP status when
present. Any failure kind other than `recovered-after-retry` never
produces a normally-published model: the outcome is incomplete /
unavailable / invalid with LKG substitution only when valid.

### LKG without TTL

`LastKnownGoodStore` maps model key -> entry
`{ canonicalID, providerID, matchKind, schemaVersion, fetchedAt,
spec, provenance }`. Validity checks, in order:

1. Entry exists and schema version is compatible.
2. Canonical identity equals the current candidate canonicalization.
3. Provider identity does not conflict.
4. Canonical mapping of the current catalog still resolves to the same
   record (or the catalog is unavailable, in which case the stored
   mapping stands with `cached` provenance).
5. No newer trusted live metadata contradicts the stored values; when
   it does, live wins and the entry is refreshed.

Age (`Date.now() - fetchedAt`) is recorded and diagnosable but never a
validity condition. Identity conflict, schema incompatibility, or
unprovable belonging invalidates.

### Configuration status

`ModelConfigurationStatus`: `configured` (live complete),
`configured-lkg` (live failed, valid LKG complete), `degraded`
(user-accepted incomplete), `discovered-incomplete`, `unmatched`,
`ambiguous`, `metadata-unavailable`, `invalid-metadata`.
`isNormallyPublishable(status)` is true only for `configured` and
`configured-lkg`. `isPublishableWithDegradedAcceptance` adds `degraded`.
Adapters filter host registration through these predicates, never
through ad-hoc reimplementation.

### Provenance

Existing `FieldProvenance { source, detail? }` gains source values
`lkg` and `canonical-inheritance` (plus `degraded-accepted` marking on
the degraded wrapper, not on fields). `detail` carries chains such as
`models.dev -> provider xiaomi -> model mimo-v2.6-pro`,
`canonical inheritance -> canonical identity foo`,
`LKG originally fetched at <ISO> (age <n>ms), live unavailable: <kind>`.
Per-field provenance covers context, output, input/output modalities,
tools, reasoning, levels, identity resolution, live/fallback/LKG choice.

## Alternatives considered

- Changing `ModelCapabilities.tools: boolean` to a tri-state wire type:
  rejected as an unnecessary breaking change; the legacy boolean stays
  for wire compatibility while the policy uses the new assessment.
  Host mapping of `unknown` tools is conservative-disable plus
  degraded labeling, documented in adapter changes.
- TTL-based LKG expiry: rejected per task requirements; capability facts
  do not decay with time alone.
- Blocking publication on `unknown` protocol support: rejected; the
  documented chat fallback is the safe invocation default and existing
  fixtures depend on it. Unknown support stays reported.
