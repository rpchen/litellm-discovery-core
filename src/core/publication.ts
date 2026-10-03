/**
 * Trusted model-capability publication loop.
 *
 * Single business source of truth for answering: "is this discovered
 * model's metadata reliable enough to publish as a fully configured
 * model?" Covers completeness/publishability policy, false-vs-unknown
 * semantics, reasoning/levels decoupling, deterministic inheritance,
 * failure taxonomy, TTL-free Last Known Good, explicit degradation,
 * configuration states, and field-level provenance.
 *
 * No I/O, no timers, no host SDK imports. Adapters consume the verdicts
 * without reimplementing policy.
 */
import {
  mapCapabilities,
  type ModelLimits,
} from "./capabilities.js"
import {
  canonicalModelID,
  candidateModelIDs,
  resolveInheritedRecord,
  resolveReasoningLevels,
  resolveReasoningState,
  selectModelsDevRecordDetailed,
  type CapabilityState,
  type DetailedSelection,
  type SelectedModelRecord,
} from "./modelsdev.js"
import {
  isRecord,
  optionalBoolean,
  optionalNumber,
  groupLiteLLMDeployments,
  type DeploymentGroup,
} from "./litellm.js"
import { resolveProtocol, type Protocol } from "./protocol.js"
import { buildModelSpecs, type BuildOptions, type ModelSpec } from "./build.js"

export type { CapabilityState }

/** Per-model configuration state. Names are domain semantics, not wire enums. */
export type ModelConfigurationStatus =
  | "configured"
  | "configured-lkg"
  | "discovered-incomplete"
  | "unmatched"
  | "ambiguous"
  | "metadata-unavailable"
  | "invalid-metadata"
  | "degraded"

export type MetadataFailureKind =
  | "timeout"
  | "server-5xx"
  | "unreachable"
  | "not-found"
  | "ambiguous"
  | "missing-field"
  | "illegal-value"
  | "schema-incompatible"
  | "cached"
  | "recovered-after-retry"

export interface MetadataFailure {
  readonly kind: MetadataFailureKind
  /** Whether retrying the same fetch may succeed. */
  readonly retryable: boolean
  readonly detail?: string
  readonly httpStatus?: number
}

/** Pure classification of a metadata fetch/merge failure. Never emits defaults. */
export function classifyMetadataFailure(error: unknown): MetadataFailure {
  const code = (
    (isRecord(error) && typeof error.code === "string" ? error.code : undefined) ??
    (error instanceof Error ? error.name : undefined) ??
    ""
  ).toUpperCase()
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase()
  const status = isRecord(error) &&
      (typeof error.status === "number" || typeof error.statusCode === "number")
    ? Number(isRecord(error) ? (error.status ?? error.statusCode) : NaN)
    : (error instanceof Response ? error.status : undefined)
  const httpStatus = typeof status === "number" && Number.isFinite(status) ? status : undefined

  if (/^(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|FETCH_FAILED|NETWORK)/.test(code) ||
    /fetch failed|network|econnrefused|enotfound|socket hang up/.test(message)) {
    if (/timeout|timed out|etimeout|etimedout|abort/.test(code + " " + message)) {
      return { kind: "timeout", retryable: true, detail: message || undefined, httpStatus }
    }
    return { kind: "unreachable", retryable: true, detail: message || undefined, httpStatus }
  }
  if (/TIMEOUT|ETIMEDOUT|ETIMEOUT|ABORT/.test(code) || /timeout|timed out|aborted/.test(message)) {
    return { kind: "timeout", retryable: true, detail: message || undefined, httpStatus }
  }
  if (httpStatus !== undefined) {
    if (httpStatus === 408 || httpStatus === 429) {
      return { kind: "timeout", retryable: true, detail: `HTTP ${httpStatus}`, httpStatus }
    }
    if (httpStatus >= 500) {
      return { kind: "server-5xx", retryable: true, detail: `HTTP ${httpStatus}`, httpStatus }
    }
    if (httpStatus === 404) {
      return { kind: "not-found", retryable: false, detail: `HTTP 404`, httpStatus }
    }
    if (httpStatus === 422) {
      return { kind: "schema-incompatible", retryable: false, detail: `HTTP 422`, httpStatus }
    }
  }
  if (/AMBIGU/.test(code) || /ambiguous|multiple.*candidate/.test(message)) {
    return { kind: "ambiguous", retryable: false, detail: message || undefined, httpStatus }
  }
  if (/SCHEMA|VALIDAT|INCOMPATIBLE|ZOD/.test(code) || /schema|incompatible|cannot read|unexpected token/.test(message)) {
    return { kind: "schema-incompatible", retryable: false, detail: message || undefined, httpStatus }
  }
  if (/ILLEGAL|INVALID.*(value|limit|metadata)/.test(code) || /illegal|invalid (metadata|limit|value)/.test(message)) {
    return { kind: "illegal-value", retryable: false, detail: message || undefined, httpStatus }
  }
  if (/NOT.*FOUND|ENOENT/.test(code) || /not found|no such model/.test(message)) {
    return { kind: "not-found", retryable: false, detail: message || undefined, httpStatus }
  }
  return { kind: "missing-field", retryable: false, detail: message || undefined, httpStatus }
}

export function metadataFailureFor(kind: MetadataFailureKind, detail?: string): MetadataFailure {
  return {
    kind,
    retryable: kind === "timeout" || kind === "server-5xx" || kind === "unreachable",
    detail,
  }
}

export type ProvenanceSource =
  | "override"
  | "litellm"
  | "models.dev"
  | "derived"
  | "default"
  | "none"
  | "lkg"
  | "canonical-inheritance"

export interface PublicationFieldProvenance {
  readonly source: ProvenanceSource
  readonly detail?: string
}

export interface ToolAssessment {
  readonly state: CapabilityState
  readonly provenance: PublicationFieldProvenance
}

export interface ReasoningAssessment {
  readonly state: CapabilityState
  readonly levelsKnown: boolean
  readonly levels: readonly string[]
  readonly provenance: PublicationFieldProvenance
  readonly levelsProvenance: PublicationFieldProvenance
  readonly conflict: boolean
}

export interface LimitAssessment {
  /** Merged value; 0 means unknown, never a usable default. */
  readonly value: number
  readonly valid: boolean
  readonly missing: boolean
  readonly illegal: boolean
  readonly provenance: PublicationFieldProvenance
}

export interface ModalityAssessment {
  readonly values: readonly string[]
  /** False means the text-only baseline is used without explicit evidence. */
  readonly known: boolean
  readonly provenance: PublicationFieldProvenance
}

export interface CompletenessAssessment {
  readonly publishable: boolean
  readonly status: ModelConfigurationStatus
  readonly tools: ToolAssessment
  readonly reasoning: ReasoningAssessment
  readonly context: LimitAssessment
  readonly output: LimitAssessment
  readonly inputModalities: ModalityAssessment
  readonly outputModalities: ModalityAssessment
  readonly identity: DetailedSelection
  readonly inheritedFields: readonly string[]
  readonly inheritanceChain: readonly string[]
  readonly missingFields: readonly string[]
  readonly unknownFields: readonly string[]
  readonly illegalFields: readonly string[]
  readonly failure?: MetadataFailure
  readonly usingLKG: boolean
  readonly lkgDetail?: string
}

function toolProvenance(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  state: CapabilityState,
): PublicationFieldProvenance {
  if (group.deployments.some((d) => optionalBoolean(d.modelInfo.supports_function_calling) !== undefined)) {
    return { source: "litellm", detail: "supports_function_calling" }
  }
  if (optionalBoolean(selected?.record.tool_call) !== undefined) {
    const inherited = selected?.record.tool_call === undefined ? false : false
    void inherited
    return { source: "models.dev", detail: "tool_call" }
  }
  return state === "unknown"
    ? { source: "none", detail: "no trusted tool-call evidence" }
    : { source: "none", detail: "no trusted tool-call evidence" }
}

function explicitLimit(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  field: "context" | "output",
): { raw: number | undefined; provenance: PublicationFieldProvenance } {
  const liteLLMKeys = field === "context" ? ["max_input_tokens"] : ["max_output_tokens", "max_tokens"]
  for (const deployment of group.deployments) {
    for (const key of liteLLMKeys) {
      const value = optionalNumber(deployment.modelInfo[key])
      if (value !== undefined) {
        return { raw: value, provenance: { source: "litellm", detail: key } }
      }
    }
  }
  const recordLimit = isRecord(selected?.record.limit)
    ? optionalNumber((selected!.record.limit as Record<string, unknown>)[field])
    : undefined
  if (recordLimit !== undefined) {
    const provider = selected?.providerID ?? "unknown-provider"
    const model = selected?.modelID ?? "unknown-model"
    return {
      raw: recordLimit,
      provenance: { source: "models.dev", detail: `limit.${field} -> provider ${provider} -> model ${model}` },
    }
  }
  return { raw: undefined, provenance: { source: "none", detail: `no ${field} limit metadata` } }
}

function assessLimit(
  merged: number,
  explicit: { raw: number | undefined; provenance: PublicationFieldProvenance },
): LimitAssessment {
  if (merged > 0 && Number.isFinite(merged)) {
    return { value: Math.floor(merged), valid: true, missing: false, illegal: false, provenance: explicit.provenance }
  }
  if (explicit.raw !== undefined && !(explicit.raw > 0)) {
    return {
      value: 0,
      valid: false,
      missing: false,
      illegal: true,
      provenance: { source: explicit.provenance.source, detail: `illegal ${explicit.provenance.detail} = ${explicit.raw}` },
    }
  }
  return { value: 0, valid: false, missing: true, illegal: false, provenance: explicit.provenance }
}

function assessModalities(
  values: readonly string[],
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  direction: "input" | "output",
): ModalityAssessment {
  const fields = direction === "input"
    ? ["supports_vision", "supports_pdf_input", "supports_audio_input", "supports_video_input"]
    : ["supports_audio_output"]
  const liteLLMDeclares = fields.some((key) =>
    group.deployments.some((d) => optionalBoolean(d.modelInfo[key]) !== undefined)
  )
  const modalities = selected?.record.modalities
  const mdDeclares = isRecord(modalities) && Array.isArray(modalities[direction]) &&
    (modalities[direction] as unknown[]).length > 0
  if (liteLLMDeclares) return { values, known: true, provenance: { source: "litellm", detail: `${direction} modality declarations` } }
  if (mdDeclares) {
    return {
      values,
      known: true,
      provenance: {
        source: "models.dev",
        detail: `modalities.${direction} -> provider ${selected?.providerID} -> model ${selected?.modelID}`,
      },
    }
  }
  return { values, known: false, provenance: { source: "default", detail: "text-only baseline without explicit evidence" } }
}

export interface AssessInput {
  readonly catalogAvailable: boolean
  readonly failure?: MetadataFailure
}

function catalogHasProviders(catalog: unknown): boolean {
  if (!isRecord(catalog)) return false
  return Object.values(catalog).some((provider) =>
    isRecord(provider) && isRecord(provider.models) && Object.keys(provider.models).length > 0
  )
}

/**
 * Assess one deployment group for normal publication.
 *
 * Pure function of already-fetched inputs: it never fills defaults to
 * hide gaps and never guesses from names or families.
 */
export function assessModelConfiguration(
  group: DeploymentGroup,
  catalog: unknown,
  options: BuildOptions,
  input: AssessInput = { catalogAvailable: catalogHasProviders(catalog) },
): CompletenessAssessment {
  const detailed = selectModelsDevRecordDetailed(group, catalog)
  const inherited = resolveInheritedRecord(detailed.selected, catalog)
  const effectiveSelected = inherited
    ? { ...detailed.selected!, record: inherited.record }
    : detailed.selected
  const protocol: Protocol = resolveProtocol(group, options.protocolOverrides)
  const mapped = mapCapabilities(group, effectiveSelected, options.contextTierCap)

  const mdTools = optionalBoolean(effectiveSelected?.record.tool_call)
  const liteLLMTools = group.deployments.map((d) => optionalBoolean(d.modelInfo.supports_function_calling))
  const definedTools = liteLLMTools.filter((v): v is boolean => v !== undefined)
  let toolState: CapabilityState
  if (definedTools.length > 0) {
    toolState = definedTools.every((v) => v) ? "supported" : definedTools.every((v) => !v) ? "unsupported" : "unknown"
  } else if (mdTools === true) toolState = "supported"
  else if (mdTools === false) toolState = "unsupported"
  else toolState = "unknown"
  if (definedTools.some((v) => v === true) && mdTools === false) {
    // Explicit LiteLLM true wins per deployment; conservative group state
    // stays supported only when every deployment agrees (handled above).
  }

  const reasoningState = resolveReasoningState(group, effectiveSelected)
  const levels = resolveReasoningLevels(effectiveSelected, protocol)
  const context = assessLimit(mapped.limit.context, explicitLimit(group, effectiveSelected, "context"))
  const output = assessLimit(mapped.limit.output, explicitLimit(group, effectiveSelected, "output"))
  const inputModalities = assessModalities(mapped.capabilities.input, group, effectiveSelected, "input")
  const outputModalities = assessModalities(mapped.capabilities.output, group, effectiveSelected, "output")

  const missingFields: string[] = []
  const unknownFields: string[] = []
  const illegalFields: string[] = []
  if (context.missing) missingFields.push("limit.context")
  if (output.missing) missingFields.push("limit.output")
  if (context.illegal) illegalFields.push("limit.context")
  if (output.illegal) illegalFields.push("limit.output")
  if (toolState === "unknown") unknownFields.push("capabilities.tools")
  if (reasoningState.state === "unknown") unknownFields.push("reasoning")

  const catalogDown = !input.catalogAvailable
  let status: ModelConfigurationStatus
  if (input.failure && !catalogDown && detailed.outcome === "matched") {
    // A fetch failure with matched-but-incomplete data stays incomplete;
    // LKG substitution is decided by resolveConfigurationWithLKG.
  }
  if (detailed.outcome === "ambiguous") status = "ambiguous"
  else if (detailed.outcome === "unmatched" && catalogDown) status = "metadata-unavailable"
  else if (detailed.outcome === "unmatched") status = "unmatched"
  else if (illegalFields.length > 0) status = "invalid-metadata"
  else if (catalogDown && (missingFields.length > 0 || unknownFields.length > 0)) status = "metadata-unavailable"
  else if (missingFields.length > 0 || unknownFields.length > 0) status = "discovered-incomplete"
  else status = "configured"

  // LiteLLM-only private models with sufficient declarations publish normally.
  if (detailed.outcome === "unmatched" && missingFields.length === 0 && unknownFields.length === 0 && illegalFields.length === 0) {
    status = "configured"
  }

  const publishable = status === "configured"
  return {
    publishable,
    status,
    tools: { state: toolState, provenance: toolProvenance(group, effectiveSelected, toolState) },
    reasoning: {
      state: reasoningState.state,
      levelsKnown: levels.known,
      levels: levels.values,
      provenance: reasoningState.source === "litellm"
        ? { source: "litellm", detail: "supports_reasoning" }
        : reasoningState.source === "models.dev"
          ? { source: "models.dev", detail: `reasoning -> provider ${effectiveSelected?.providerID} -> model ${effectiveSelected?.modelID}` }
          : reasoningState.source === "derived"
            ? { source: "derived", detail: "LiteLLM and models.dev reasoning evidence" }
            : { source: "none", detail: "no reasoning support metadata" },
      levelsProvenance: levels.known
        ? { source: "models.dev", detail: "reasoning_options" }
        : { source: "none", detail: "no reasoning level metadata" },
      conflict: reasoningState.conflict,
    },
    context: inherited && inherited.inheritedFields.includes("limit") && context.valid
      ? { ...context, provenance: { source: "canonical-inheritance", detail: inherited.chain.join("; ") } }
      : context,
    output: inherited && inherited.inheritedFields.includes("limit") && output.valid
      ? { ...output, provenance: { source: "canonical-inheritance", detail: inherited.chain.join("; ") } }
      : output,
    inputModalities,
    outputModalities,
    identity: detailed,
    inheritedFields: inherited?.inheritedFields ?? [],
    inheritanceChain: inherited?.chain ?? [],
    missingFields,
    unknownFields,
    illegalFields,
    failure: input.failure,
    usingLKG: false,
  }
}

/** True only for `configured` and `configured-lkg`. Degraded needs its own path. */
export function isNormallyPublishable(status: ModelConfigurationStatus): boolean {
  return status === "configured" || status === "configured-lkg"
}

/** True for normally publishable states plus user-accepted `degraded`. */
export function isPublishableWithDegradedAcceptance(status: ModelConfigurationStatus): boolean {
  return isNormallyPublishable(status) || status === "degraded"
}

// ---------------------------------------------------------------------------
// Last Known Good (no fixed TTL)
// ---------------------------------------------------------------------------

export const PUBLICATION_SCHEMA_VERSION = 1 as const

export interface LastKnownGoodEntry {
  readonly schemaVersion: typeof PUBLICATION_SCHEMA_VERSION
  /** Stable LiteLLM model name this entry was captured for. */
  readonly modelName: string
  readonly canonicalID: string
  readonly providerID: string
  readonly matchKind?: string
  readonly fetchedAt: string
  readonly fetchedAtEpochMs: number
  readonly spec: ModelSpec
  readonly provenanceDetail: string
}

export interface LKGValidation {
  readonly valid: boolean
  readonly reason: string
  readonly ageMs?: number
}

export function lastKnownGoodKey(modelName: string): string {
  return modelName.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-")
}

export function createLastKnownGoodEntry(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  spec: ModelSpec,
  now = Date.now(),
): LastKnownGoodEntry {
  const canonicals = [...new Set(candidateModelIDs(group).map(canonicalModelID))]
  return {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    modelName: group.modelName,
    canonicalID: canonicals[0] ?? group.modelName.toLowerCase(),
    providerID: selected?.providerID ?? "litellm-only",
    matchKind: selected?.matchKind,
    fetchedAt: new Date(now).toISOString(),
    fetchedAtEpochMs: now,
    spec: structuredClone(spec),
    provenanceDetail: selected
      ? `LKG originally fetched at ${new Date(now).toISOString()} via provider ${selected.providerID} -> model ${selected.modelID}`
      : `LKG originally fetched at ${new Date(now).toISOString()} via LiteLLM-only declarations`,
  }
}

/**
 * Validate a stored entry against the current discovery inputs.
 * Age is reported but never a validity condition.
 */
export function validateLastKnownGood(
  entry: LastKnownGoodEntry,
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  now = Date.now(),
): LKGValidation {
  const ageMs = Math.max(0, now - entry.fetchedAtEpochMs)
  if (entry.schemaVersion !== PUBLICATION_SCHEMA_VERSION) {
    return { valid: false, reason: "schema-incompatible LKG entry", ageMs }
  }
  if (typeof entry.modelName !== "string" || entry.modelName.length === 0) {
    return { valid: false, reason: "LKG entry has no provable model identity", ageMs }
  }
  if (lastKnownGoodKey(entry.modelName) !== lastKnownGoodKey(group.modelName)) {
    return { valid: false, reason: `model identity changed (${entry.modelName} != ${group.modelName})`, ageMs }
  }
  const canonicals = [...new Set(candidateModelIDs(group).map(canonicalModelID))]
  const currentCanonical = canonicals[0] ?? group.modelName.toLowerCase()
  if (currentCanonical.toLowerCase() !== entry.canonicalID.toLowerCase()) {
    return { valid: false, reason: `canonical identity changed (${entry.canonicalID} != ${currentCanonical})`, ageMs }
  }
  // When the live catalog is unavailable there is no current provider
  // mapping to compare against; the stored mapping stands with cached
  // provenance. Only a positively selected conflicting provider rejects.
  const currentProvider = selected?.providerID
  if (currentProvider !== undefined && currentProvider.toLowerCase() !== entry.providerID.toLowerCase()) {
    return { valid: false, reason: `provider identity conflict (${entry.providerID} != ${currentProvider})`, ageMs }
  }
  if (!Number.isFinite(Date.parse(entry.fetchedAt))) {
    return { valid: false, reason: "LKG fetch timestamp is not provable", ageMs }
  }
  return { valid: true, reason: "identity, provider, and schema agree; no conflicting live metadata", ageMs }
}

export function isLKGEntryCompatible(value: unknown): value is LastKnownGoodEntry {
  if (!isRecord(value)) return false
  return value.schemaVersion === PUBLICATION_SCHEMA_VERSION &&
    typeof value.modelName === "string" &&
    typeof value.canonicalID === "string" &&
    typeof value.providerID === "string" &&
    typeof value.fetchedAt === "string" &&
    typeof value.fetchedAtEpochMs === "number"
}

/** In-memory LKG store. Persistence belongs to adapters; validity belongs here. */
export function createLastKnownGoodStore() {
  const entries = new Map<string, LastKnownGoodEntry>()
  return {
    set(key: string, entry: LastKnownGoodEntry): void {
      entries.set(key, structuredClone(entry))
    },
    get(key: string): LastKnownGoodEntry | undefined {
      const found = entries.get(key)
      return found ? structuredClone(found) : undefined
    },
    delete(key: string): void {
      entries.delete(key)
    },
    clear(): void {
      entries.clear()
    },
    size(): number {
      return entries.size
    },
  }
}

export type LastKnownGoodStore = ReturnType<typeof createLastKnownGoodStore>

export interface ConfigurationWithLKG {
  readonly assessment: CompletenessAssessment
  /** Present when a valid LKG entry substitutes for failed live metadata. */
  readonly lkg?: LastKnownGoodEntry
  readonly lkgValidation?: LKGValidation
}

/**
 * Resolve the final configuration, substituting valid LKG only when live
 * metadata is incomplete/unavailable AND a provably belonging entry exists
 * whose stored spec itself passes completeness.
 */
export function resolveConfigurationWithLKG(
  assessment: CompletenessAssessment,
  group: DeploymentGroup,
  catalog: unknown,
  options: BuildOptions,
  store: LastKnownGoodStore,
  now = Date.now(),
): ConfigurationWithLKG {
  if (assessment.publishable) return { assessment }
  if (assessment.status !== "discovered-incomplete" && assessment.status !== "metadata-unavailable") {
    return { assessment }
  }
  const detailed = selectModelsDevRecordDetailed(group, catalog)
  const keys = [lastKnownGoodKey(group.modelName)]
  for (const key of keys) {
    const entry = store.get(key)
    if (!entry || !isLKGEntryCompatible(entry)) continue
    const validation = validateLastKnownGood(entry, group, detailed.selected, now)
    if (!validation.valid) continue
    // The stored spec must itself have been complete when captured.
    if (!(entry.spec.limit.context > 0 && entry.spec.limit.output > 0)) continue
    return {
      assessment: {
        ...assessment,
        publishable: true,
        status: "configured-lkg",
        usingLKG: true,
        lkgDetail: `${entry.provenanceDetail} (age ${validation.ageMs}ms), live unavailable: ${assessment.failure?.kind ?? assessment.status}`,
      },
      lkg: entry,
      lkgValidation: validation,
    }
  }
  return { assessment }
}

// ---------------------------------------------------------------------------
// Explicit degradation
// ---------------------------------------------------------------------------

export interface DegradationAcceptance {
  readonly acceptedAt: string
  readonly reason?: string
  readonly acceptedFields: readonly string[]
}

export interface DegradedConfiguration {
  readonly status: "degraded"
  readonly assessment: CompletenessAssessment
  readonly acceptance: DegradationAcceptance
  /** Still lists every gap; acceptance never erases unknowns. */
  readonly remainingGaps: readonly string[]
}

/**
 * User-accepted degradation. The returned wrapper stays `degraded` and
 * keeps every missing/unknown/illegal field listed; it is publishable
 * only through the degraded path, never as `configured`.
 */
export function acceptDegradedConfiguration(
  assessment: CompletenessAssessment,
  acceptance: { reason?: string; acceptedAt?: string },
): DegradedConfiguration {
  if (assessment.publishable) {
    throw new Error("fully configured models do not need degradation acceptance")
  }
  return {
    status: "degraded",
    assessment: {
      ...assessment,
      publishable: false,
      status: "degraded",
    },
    acceptance: {
      acceptedAt: acceptance.acceptedAt ?? new Date().toISOString(),
      reason: acceptance.reason,
      acceptedFields: [...assessment.missingFields, ...assessment.unknownFields, ...assessment.illegalFields],
    },
    remainingGaps: [...assessment.missingFields, ...assessment.unknownFields, ...assessment.illegalFields],
  }
}

export function describeAssessment(assessment: CompletenessAssessment): string {
  const gaps = [...assessment.missingFields, ...assessment.unknownFields, ...assessment.illegalFields]
  return gaps.length === 0
    ? `${assessment.status}: publishable`
    : `${assessment.status}: blocked (${gaps.join(", ")})`
}

// ---------------------------------------------------------------------------
// Publication result: specs partitioned for adapters
// ---------------------------------------------------------------------------

export interface PublishableEntry {
  readonly spec: ModelSpec
  readonly assessment: CompletenessAssessment
  readonly degraded?: DegradedConfiguration
}

export interface BlockedEntry {
  readonly spec: ModelSpec
  readonly assessment: CompletenessAssessment
}

export interface PublicationResult {
  readonly publishable: readonly PublishableEntry[]
  readonly blocked: readonly BlockedEntry[]
  /** Live assessment by model id (before LKG substitution details). */
  readonly assessments: ReadonlyMap<string, CompletenessAssessment>
}

export interface BuildPublicationOptions {
  readonly store?: LastKnownGoodStore
  /** Model ids the user explicitly accepted as degraded. */
  readonly acceptedDegradedIDs?: ReadonlySet<string>
  readonly degradationReason?: string
  /** Classified metadata failure when the catalog itself failed to load. */
  readonly failure?: MetadataFailure
  readonly now?: number
}

/**
 * Partition discovery output for adapters.
 *
 * Publishable entries are `configured`, `configured-lkg`, or
 * user-accepted `degraded` only. Everything else is blocked with its
 * assessment. Adapters must not reimplement this partition; they only
 * map entries to host shapes and still honor the operational-limits
 * guard before host registration.
 */
export function buildPublicationResult(
  litellmResponse: unknown,
  catalog: unknown,
  options: BuildOptions,
  buildOptions: BuildPublicationOptions = {},
): PublicationResult {
  const now = buildOptions.now ?? Date.now()
  const specs = buildModelSpecs(litellmResponse, catalog, options)
  const groups = groupLiteLLMDeployments(litellmResponse)
  const byID = new Map(specs.map((spec) => [spec.id, spec]))
  const catalogAvailable = catalogHasProviders(catalog)

  const publishable: PublishableEntry[] = []
  const blocked: BlockedEntry[] = []
  const assessments = new Map<string, CompletenessAssessment>()

  for (const group of groups) {
    const spec = byID.get(group.modelName)
    if (!spec) continue
    const live = assessModelConfiguration(group, catalog, options, {
      catalogAvailable,
      failure: buildOptions.failure,
    })
    assessments.set(group.modelName, live)

    if (live.publishable) {
      publishable.push({ spec, assessment: live })
      continue
    }

    if (buildOptions.store) {
      const resolved = resolveConfigurationWithLKG(live, group, catalog, options, buildOptions.store, now)
      if (resolved.assessment.publishable && resolved.lkg) {
        publishable.push({
          spec: resolved.lkg.spec,
          assessment: {
            ...resolved.assessment,
            identity: live.identity,
            inheritedFields: live.inheritedFields,
            inheritanceChain: live.inheritanceChain,
          },
        })
        assessments.set(group.modelName, resolved.assessment)
        continue
      }
    }

    if (buildOptions.acceptedDegradedIDs?.has(group.modelName)) {
      try {
        const degraded = acceptDegradedConfiguration(live, { reason: buildOptions.degradationReason })
        publishable.push({ spec, assessment: degraded.assessment, degraded })
        assessments.set(group.modelName, degraded.assessment)
        continue
      } catch {
        // Fully configured models never reach here; fall through to blocked.
      }
    }

    blocked.push({ spec, assessment: live })
  }

  publishable.sort((a, b) => a.spec.id.localeCompare(b.spec.id, "en"))
  blocked.sort((a, b) => a.spec.id.localeCompare(b.spec.id, "en"))
  return { publishable, blocked, assessments }
}

/** Host-transport mapping for a publishable reasoning state. Conservative: unknown never reaches here. */
export function hostReasoningFlag(assessment: CompletenessAssessment): boolean {
  return assessment.reasoning.state === "supported"
}

/** Host-transport mapping for a publishable tool state. Conservative-disable when unknown. */
export function hostToolsFlag(assessment: CompletenessAssessment, legacyTools: boolean): boolean {
  return assessment.tools.state === "unknown" ? false : legacyTools
}

export type { ModelLimits }
