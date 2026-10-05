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
 * What the user has already been told about. Persisted across host
 * restarts so the same problem set is not reported twice. This state is
 * never consulted when deciding whether a model is publishable.
 */
export interface DegradationAcknowledgement {
  readonly version: 1
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

function modelKey(id: string): string {
  return id.trim().toLowerCase()
}

function modelFingerprintMap(withheld: readonly WithheldModelEntry[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const entry of withheld) map[modelKey(entry.id)] = entry.fingerprint
  return map
}

/**
 * Decide whether this round may be surfaced, and what the next suppression
 * state should be.
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
export function decideAcknowledgement(
  previous: DegradationAcknowledgement | undefined,
  catalog: CatalogPublication,
  acknowledgedAt: string,
): AcknowledgementDecision {
  const currentFingerprint = catalog.fingerprint
  const currentModels = modelFingerprintMap(catalog.withheld)

  if (catalog.withheld.length === 0) {
    return {
      notify: false,
      reason: "catalog-recovered",
      next: undefined,
    }
  }

  if (catalog.unusable) {
    return {
      notify: true,
      reason: "catalog-unusable",
      next: {
        version: 1,
        fingerprint: currentFingerprint,
        models: currentModels,
        acknowledgedAt,
      },
    }
  }

  if (!previous || previous.version !== 1) {
    const regression = catalog.regressions.length > 0
    return {
      notify: regression,
      reason: regression ? "regression" : "first-observation",
      next: regression
        ? { version: 1, fingerprint: currentFingerprint, models: currentModels, acknowledgedAt }
        : undefined,
    }
  }

  const previousModels = previous.models ?? {}
  const regressionUnacknowledged = catalog.regressions.some(
    (entry) => previousModels[modelKey(entry.id)] !== entry.fingerprint,
  )
  if (regressionUnacknowledged) {
    return {
      notify: true,
      reason: "regression",
      next: {
        version: 1,
        fingerprint: currentFingerprint,
        models: currentModels,
        acknowledgedAt,
      },
    }
  }

  const currentKeys = Object.keys(currentModels)
  const isSubsetOrEqual = currentKeys.every((key) => previousModels[key] === currentModels[key])
  if (isSubsetOrEqual) {
    const unchanged = currentKeys.length === Object.keys(previousModels).length
    return {
      notify: false,
      reason: unchanged ? "unchanged" : "improved",
      next: {
        version: 1,
        fingerprint: currentFingerprint,
        models: currentModels,
        acknowledgedAt: previous.acknowledgedAt,
      },
    }
  }

  return {
    notify: true,
    reason: "new-issues",
    next: {
      version: 1,
      fingerprint: currentFingerprint,
      models: currentModels,
      acknowledgedAt,
    },
  }
}

export function isDegradationAcknowledgement(value: unknown): value is DegradationAcknowledgement {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.version === 1 &&
    typeof candidate.fingerprint === "string" &&
    typeof candidate.acknowledgedAt === "string" &&
    typeof candidate.models === "object" &&
    candidate.models !== null
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
