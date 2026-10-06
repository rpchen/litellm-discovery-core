/**
 * Partial-catalog facts: availability, regression, recovery, and
 * notification acknowledgement.
 *
 * The catalog is a *set* of independently judged models. One model's
 * failure never gates another's publication, so a discovery round is
 * always allowed to be partially available. This module is the single
 * business source of truth for describing that outcome:
 *
 * - how many models were discovered, published, and withheld;
 * - whether the catalog is partially available or entirely unusable;
 * - which withheld model previously *was* published (a regression);
 * - whether a previously acknowledged problem set has materially changed.
 *
 * Acknowledgement can only suppress a repeated notification about the
 * same unchanged problem set. It can never change publication: no field
 * here participates in `publishable(model)`.
 *
 * No I/O, no timers, no host SDK imports.
 */
import { createHash } from "node:crypto"
import { withheldReasons, type ModelConfigurationStatus, type WithheldReason } from "./publication.js"

export type WithheldRetryability = "retryable" | "not-retryable"

/** One model that cannot be safely published this round, with its reasons. */
export interface WithheldModelEntry {
  readonly id: string
  readonly status: ModelConfigurationStatus
  readonly reasons: readonly WithheldReason[]
  /** Stable identity of this model's degradation, over reasons and fields. */
  readonly fingerprint: string
  /** True when the previous applied catalog published this model. */
  readonly previouslyPublished: boolean
  readonly retryability: WithheldRetryability
}

export interface CatalogPublication {
  readonly discovered: number
  readonly publishable: readonly string[]
  readonly lkgBacked: readonly string[]
  readonly withheld: readonly WithheldModelEntry[]
  /** Discovered models exist and at least one is publishable but not all are. */
  readonly partial: boolean
  /** Discovered models exist and none can be safely published. */
  readonly unusable: boolean
  /** Withheld models that were published by the previous applied catalog. */
  readonly regressions: readonly WithheldModelEntry[]
  /** Withheld models that were not published before (first-time withholding). */
  readonly newlyWithheld: readonly WithheldModelEntry[]
  /** Stable identity of the whole withheld problem set. */
  readonly fingerprint: string
}

function digest(material: string): string {
  return createHash("sha256").update(material).digest("hex")
}

/**
 * Stable per-model degradation identity: status, reason codes, and the
 * affected field names. Timestamps, retry counters, failure detail
 * strings, and durations are deliberately excluded so that cosmetic
 * changes never count as a new problem.
 */
export function withheldModelFingerprint(
  status: ModelConfigurationStatus,
  reasons: readonly WithheldReason[],
): string {
  const material = [
    status,
    ...reasons
      .map((reason) => `${reason.code}:${[...reason.fields].sort().join("+")}`)
      .sort((left, right) => left.localeCompare(right, "en")),
  ].join("|")
  return `sha256:${digest(material).slice(0, 32)}`
}

/** Stable identity of a whole withheld set, order-independent. */
export function catalogDegradationFingerprint(withheld: readonly WithheldModelEntry[]): string {
  if (withheld.length === 0) return "sha256:none"
  const material = withheld
    .map((entry) => `${entry.id.toLowerCase()}=${entry.fingerprint}`)
    .sort((left, right) => left.localeCompare(right, "en"))
    .join("\n")
  return `sha256:${digest(material)}`
}

export interface CatalogPublicationInput {
  readonly publishable: readonly { readonly id: string; readonly usingLKG: boolean }[]
  readonly withheld: readonly {
    readonly id: string
    readonly status: ModelConfigurationStatus
    readonly reasons: readonly WithheldReason[]
    readonly retryable: boolean
  }[]
  readonly discovered: number
  /** Model ids the previously applied catalog published. */
  readonly previouslyPublished?: ReadonlySet<string>
}

export function buildCatalogPublication(input: CatalogPublicationInput): CatalogPublication {
  const previouslyPublished = input.previouslyPublished ?? new Set<string>()
  const withheld: WithheldModelEntry[] = input.withheld
    .map((item) => ({
      id: item.id,
      status: item.status,
      reasons: item.reasons,
      fingerprint: withheldModelFingerprint(item.status, item.reasons),
      previouslyPublished: previouslyPublished.has(item.id),
      retryability: (item.retryable ? "retryable" : "not-retryable") as WithheldRetryability,
    }))
    .sort((left, right) => left.id.localeCompare(right.id, "en"))

  const publishable = input.publishable.map((item) => item.id)
  const lkgBacked = input.publishable.filter((item) => item.usingLKG).map((item) => item.id)
  const discovered = Math.max(input.discovered, publishable.length + withheld.length)

  return {
    discovered,
    publishable,
    lkgBacked,
    withheld,
    partial: publishable.length > 0 && withheld.length > 0,
    unusable: discovered > 0 && publishable.length === 0,
    regressions: withheld.filter((entry) => entry.previouslyPublished),
    newlyWithheld: withheld.filter((entry) => !entry.previouslyPublished),
    fingerprint: catalogDegradationFingerprint(withheld),
  }
}

// ---------------------------------------------------------------------------
// Acknowledgement: notification suppression only
// ---------------------------------------------------------------------------

/**
 * Bumped when the persisted publication memory changes shape or meaning.
 * An unreadable or older record is dropped, which can only cause one
 * repeated notification — never a publication change.
 */
export const PUBLICATION_MEMORY_SCHEMA_VERSION = 1 as const

/** Versioned shape of the acknowledgement record itself. */
export const ACKNOWLEDGEMENT_SCHEMA_VERSION = 1 as const

/**
 * What the user has already been told about. Persisted across host
 * restarts so the same problem set is not reported twice. This state is
 * never consulted when deciding whether a model is publishable.
 */
export interface DegradationAcknowledgement {
  readonly schemaVersion: typeof ACKNOWLEDGEMENT_SCHEMA_VERSION
  /** Whole-set fingerprint at the moment the user reviewed the state. */
  readonly fingerprint: string
  /** Model id (case-insensitive) → per-model degradation fingerprint. */
  readonly models: Readonly<Record<string, string>>
  readonly acknowledgedAt: string
}

export type AcknowledgementReason =
  | "catalog-recovered"
  | "unchanged"
  | "improved"
  | "regression"
  | "new-issues"
  | "catalog-unusable"
  | "first-observation"

export interface AcknowledgementDecision {
  /** Whether the host should surface this round to the user. */
  readonly notify: boolean
  readonly reason: AcknowledgementReason
  /** Updated suppression state; `undefined` clears it (nothing to suppress). */
  readonly next: DegradationAcknowledgement | undefined
}

/**
 * Everything an adapter must persist per endpoint to keep notification
 * decisions stable across host restarts:
 *
 * - `acknowledgement` — the problem sets the user has already seen;
 * - `published` — the regression baseline ("this model was published by the
 *   applied catalog"), so a withdrawal is still a regression after a restart.
 *
 * Both fields are reporting state. Neither participates in publication.
 */
export interface PublicationMemory {
  readonly schemaVersion: typeof PUBLICATION_MEMORY_SCHEMA_VERSION
  readonly acknowledgement?: DegradationAcknowledgement
  readonly published: readonly string[]
}

const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{32}$/

function parseAcknowledgementRecord(value: unknown): DegradationAcknowledgement | undefined {
  if (!isRecord(value)) return undefined
  if (value.schemaVersion !== ACKNOWLEDGEMENT_SCHEMA_VERSION) return undefined
  if (typeof value.fingerprint !== "string" || value.fingerprint.length === 0) return undefined
  if (typeof value.acknowledgedAt !== "string" || !Number.isFinite(Date.parse(value.acknowledgedAt))) return undefined
  if (!isRecord(value.models)) return undefined
  const models: Record<string, string> = {}
  for (const [key, fingerprint] of Object.entries(value.models)) {
    const normalized = key.trim().toLowerCase()
    if (normalized.length === 0) return undefined
    if (typeof fingerprint !== "string" || !FINGERPRINT_PATTERN.test(fingerprint)) return undefined
    models[normalized] = fingerprint
  }
  return {
    schemaVersion: ACKNOWLEDGEMENT_SCHEMA_VERSION,
    fingerprint: value.fingerprint,
    models,
    acknowledgedAt: value.acknowledgedAt,
  }
}

/**
 * Read persisted publication memory. A missing, corrupt, foreign, or
 * older-schema record yields `undefined`, which at worst repeats a
 * notification on the next round; it can never publish or withhold a model.
 */
export function parsePublicationMemory(value: unknown): PublicationMemory | undefined {
  const candidate = typeof value === "string" ? safeJSON(value) : value
  if (!isRecord(candidate)) return undefined
  if (candidate.schemaVersion !== PUBLICATION_MEMORY_SCHEMA_VERSION) return undefined
  const published = Array.isArray(candidate.published)
    ? candidate.published.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : []
  const acknowledgement = candidate.acknowledgement === undefined || candidate.acknowledgement === null
    ? undefined
    : parseAcknowledgementRecord(candidate.acknowledgement)
  // A record whose acknowledgement is present but unreadable is dropped as a
  // whole: partially trusting it could wrongly suppress a real problem.
  if (candidate.acknowledgement !== undefined && candidate.acknowledgement !== null && acknowledgement === undefined) {
    return { schemaVersion: PUBLICATION_MEMORY_SCHEMA_VERSION, published }
  }
  return {
    schemaVersion: PUBLICATION_MEMORY_SCHEMA_VERSION,
    acknowledgement,
    published: [...new Set(published)],
  }
}

/** Stable, versioned payload an adapter stores verbatim. */
export function serializePublicationMemory(memory: PublicationMemory): unknown {
  const published = [...new Set(memory.published)].sort((left, right) => left.localeCompare(right, "en"))
  const acknowledgement = memory.acknowledgement
  return {
    schemaVersion: PUBLICATION_MEMORY_SCHEMA_VERSION,
    acknowledgement: acknowledgement === undefined
      ? null
      : {
        schemaVersion: acknowledgement.schemaVersion,
        fingerprint: acknowledgement.fingerprint,
        models: Object.fromEntries(
          Object.entries(acknowledgement.models).sort(([left], [right]) => left.localeCompare(right, "en")),
        ),
        acknowledgedAt: acknowledgement.acknowledgedAt,
      },
    published,
  }
}

/**
 * Next regression baseline: keep previously published models that the
 * endpoint still serves (published or withheld), add the ones published now,
 * and forget models LiteLLM no longer returns at all so the set stays bounded.
 */
export function nextPublishedBaseline(
  previous: readonly string[],
  currentPublishable: readonly string[],
  currentWithheld: readonly string[],
): string[] {
  const known = new Set([...currentPublishable, ...currentWithheld])
  const next = new Set(currentPublishable)
  for (const id of previous) {
    if (known.has(id)) next.add(id)
  }
  return [...next]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeJSON(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function modelKey(id: string): string {
  return id.trim().toLowerCase()
}

function modelFingerprintMap(withheld: readonly WithheldModelEntry[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const entry of withheld) map[modelKey(entry.id)] = entry.fingerprint
  return map
}

function acknowledgementOf(
  fingerprint: string,
  models: Record<string, string>,
  acknowledgedAt: string,
): DegradationAcknowledgement {
  return { schemaVersion: ACKNOWLEDGEMENT_SCHEMA_VERSION, fingerprint, models, acknowledgedAt }
}

/**
 * Decide whether this round may be surfaced, and what the next suppression
 * state should be. The returned state is what an adapter persists, so a
 * restart re-observes the same problem set as `unchanged`.
 *
 * - full recovery clears the acknowledgement;
 * - a strict subset (a withheld model recovered, the rest unchanged) is an
 *   improvement and stays quiet while updating the baseline;
 * - a previously published model becoming withheld is a regression and is
 *   always surfaced, even when the user acknowledged other problems;
 * - a newly discovered model that cannot be published is visible in
 *   diagnostics but is not interruptive on its own;
 * - `discovered > 0 && publishable = 0` is always surfaced: the endpoint is
 *   reachable but the catalog is currently unusable.
 */
/**
 * Decide whether this round may be surfaced, and what the next suppression
 * state should be. The returned state is what an adapter persists, so after a
 * restart the same problem set is recognised as .
 *
 * - a previously published model becoming withheld is a regression and is
 *   always surfaced, even when the user acknowledged other problems;
 * - an unusable catalog (discovered > 0, nothing publishable) is surfaced the
 *   first time it is observed and whenever it materially grows; a continuing
 *   identical state stays quiet and remains visible in diagnostics;
 * - full recovery clears the acknowledgement;
 * - a strict subset (a withheld model recovered, the rest unchanged) is an
 *   improvement and stays quiet while updating the baseline;
 * - a newly discovered model that cannot be published is visible in
 *   diagnostics but is not interruptive on its own.
 */
export function decideAcknowledgement(
  previous: DegradationAcknowledgement | undefined,
  catalog: CatalogPublication,
  acknowledgedAt: string,
): AcknowledgementDecision {
  const currentFingerprint = catalog.fingerprint
  const currentModels = modelFingerprintMap(catalog.withheld)

  if (catalog.withheld.length === 0) {
    return { notify: false, reason: "catalog-recovered", next: undefined }
  }

  const currentKeys = Object.keys(currentModels)
  const usablePrevious = previous?.schemaVersion === ACKNOWLEDGEMENT_SCHEMA_VERSION ? previous : undefined
  const previousModels = usablePrevious?.models ?? {}
  const regressionUnacknowledged = catalog.regressions.some(
    (entry) => previousModels[modelKey(entry.id)] !== entry.fingerprint,
  )

  if (!usablePrevious) {
    if (regressionUnacknowledged) {
      return { notify: true, reason: "regression", next: acknowledgementOf(currentFingerprint, currentModels, acknowledgedAt) }
    }
    if (catalog.unusable) {
      return { notify: true, reason: "catalog-unusable", next: acknowledgementOf(currentFingerprint, currentModels, acknowledgedAt) }
    }
    return { notify: false, reason: "first-observation", next: undefined }
  }

  if (regressionUnacknowledged) {
    return { notify: true, reason: "regression", next: acknowledgementOf(currentFingerprint, currentModels, acknowledgedAt) }
  }

  const isSubsetOrEqual = currentKeys.every((key) => previousModels[key] === currentModels[key])
  if (isSubsetOrEqual) {
    const unchanged = currentKeys.length === Object.keys(previousModels).length
    return {
      notify: false,
      reason: unchanged ? "unchanged" : "improved",
      next: acknowledgementOf(currentFingerprint, currentModels, usablePrevious.acknowledgedAt),
    }
  }

  return {
    notify: true,
    reason: catalog.unusable ? "catalog-unusable" : "new-issues",
    next: acknowledgementOf(currentFingerprint, currentModels, acknowledgedAt),
  }
}

export function isDegradationAcknowledgement(value: unknown): value is DegradationAcknowledgement {
  return parseAcknowledgementRecord(value) !== undefined
}

/**
 * Build catalog facts from a Core publication partition. Adapters pass the
 * model ids their previously *applied* catalog published so a withdrawn
 * model can be reported as a regression instead of a first-time gap.
 */
export function catalogFromPublication(
  result: {
    readonly publishable: readonly { readonly spec: { readonly id: string }; readonly assessment: { readonly usingLKG: boolean } }[]
    readonly blocked: readonly { readonly spec: { readonly id: string }; readonly assessment: import("./publication.js").CompletenessAssessment }[]
  },
  options: { readonly previouslyPublished?: ReadonlySet<string>; readonly discovered?: number } = {},
): CatalogPublication {
  return buildCatalogPublication({
    publishable: result.publishable.map((entry) => ({
      id: entry.spec.id,
      usingLKG: entry.assessment.usingLKG,
    })),
    withheld: result.blocked.map((entry) => ({
      id: entry.spec.id,
      status: entry.assessment.status,
      reasons: withheldReasons(entry.assessment),
      retryable: entry.assessment.failure?.retryable ?? false,
    })),
    discovered: options.discovered ?? result.publishable.length + result.blocked.length,
    previouslyPublished: options.previouslyPublished,
  })
}
