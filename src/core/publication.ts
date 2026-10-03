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
  aggregateTriState,
  resolveInheritedRecord,
  resolveReasoningLevels,
  resolveReasoningState,
  selectModelsDevRecordDetailed,
  modelsDevReasoning,
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
  type LiteLLMDeployment,
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
  /** Positive agreed value when known; otherwise 0, never a usable default. */
  readonly value: number
  readonly valid: boolean
  readonly missing: boolean
  readonly unknown: boolean
  readonly conflict: boolean
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
  /** Fields whose deployment/model-level evidence contradicts itself. */
  readonly conflictFields: readonly string[]
  readonly failure?: MetadataFailure
  readonly usingLKG: boolean
  readonly lkgDetail?: string
}

function toolProvenance(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  inherited: boolean,
): PublicationFieldProvenance {
  if (group.deployments.some((d) => optionalBoolean(d.modelInfo.supports_function_calling) !== undefined)) {
    return { source: "litellm", detail: "supports_function_calling" }
  }
  if (optionalBoolean(selected?.record.tool_call) !== undefined) {
    const detail = `tool_call -> provider ${selected?.providerID} -> model ${selected?.modelID}`
    return inherited
      ? { source: "canonical-inheritance", detail }
      : { source: "models.dev", detail }
  }
  return { source: "none", detail: "no trusted tool-call evidence" }
}

/**
 * Per-deployment explicit limit plus the trusted model-level fallback.
 * Values are never aggregated here; aggregation happens once, in one place.
 *
 * Context evidence is two different dimensions by design: LiteLLM
 * `max_input_tokens` is the deployment's input capacity, while models.dev
 * `limit.context` is the total context window. They never conflict across
 * dimensions; the model-level total wins when present (it is the more
 * precise fact), and deployment inputs fall back to being the group's
 * context evidence only when models.dev declares no total.
 */
function deploymentLimitEvidence(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  field: "context" | "output",
): { deploymentValues: Array<number | undefined>; modelLevel: number | undefined } {
  const liteLLMKeys = field === "context" ? ["max_input_tokens"] : ["max_output_tokens", "max_tokens"]
  const deploymentValues = group.deployments.map((deployment) => {
    for (const key of liteLLMKeys) {
      const value = optionalNumber(deployment.modelInfo[key])
      if (value !== undefined) return value
    }
    return undefined
  })
  const recordLimit = isRecord(selected?.record.limit)
    ? optionalNumber((selected!.record.limit as Record<string, unknown>)[field])
    : undefined
  return { deploymentValues, modelLevel: recordLimit }
}

type ScalarEvidenceState = "known" | "unknown" | "conflict"

export interface ScalarEvidence {
  readonly state: ScalarEvidenceState
  /** The agreed value when known; 0 otherwise. */
  readonly value: number
  readonly conflict: boolean
  readonly source: "litellm" | "models.dev" | "derived" | "none"
}

function firstTierPoint(deployment: LiteLLMDeployment): number | undefined {
  const points: number[] = []
  for (const [key, rawValue] of Object.entries(deployment.modelInfo)) {
    const match = /^input_cost_per_token_above_(\d+)k_tokens$/.exec(key)
    const value = optionalNumber(rawValue)
    if (match?.[1] && value !== undefined && value !== 0) points.push(Number(match[1]) * 1000)
  }
  const tiers = deployment.modelInfo.tiered_pricing
  if (Array.isArray(tiers)) {
    for (const tier of tiers) {
      if (!isRecord(tier) || !Array.isArray(tier.range)) continue
      const start = optionalNumber(tier.range[0])
      if (start !== undefined && start > 0) points.push(Math.floor(start))
    }
  }
  return points.length > 0 ? Math.min(...points) : undefined
}

/**
 * Scalar group aggregation preserving unknown and conflict. Never drops
 * missing declarations: `value + unknown` stays unknown. Deployment
 * disagreement and same-dimension deployment-vs-model-level disagreement
 * are conflicts, not silently-minimum merges.
 *
 * `modelLevelAuthoritative` marks fields where the model-level value is a
 * distinct, more precise dimension (context): there it decides known on
 * its own and never conflicts with deployment inputs.
 */
export function aggregateScalarEvidence(
  deploymentValues: readonly (number | undefined)[],
  modelLevel: number | undefined,
  modelLevelAuthoritative = false,
): ScalarEvidence {
  const defined = deploymentValues.filter((value): value is number => value !== undefined)
  const hasUnknown = deploymentValues.length > defined.length
  const useModel = modelLevel !== undefined && modelLevel > 0
  const model = useModel ? modelLevel! : undefined

  if (useModel && modelLevelAuthoritative) {
    return { state: "known", value: model!, conflict: false, source: "models.dev" }
  }
  if (defined.length === 0) {
    if (useModel) return { state: "known", value: model!, conflict: false, source: "models.dev" }
    return { state: "unknown", value: 0, conflict: false, source: "none" }
  }
  const deploymentConflict = !defined.every((value) => value === defined[0])
  // Model-level evidence must not turn `value + unknown` into known even
  // when it happens to agree with the declared deployments; it may only
  // fill a group where every deployment left the field undeclared. When
  // every deployment declares and all agree, an agreeing model-level value
  // corroborates; a contradicting one is a real conflict.
  const everyDeclared = defined.length === deploymentValues.length
  const corroborates = useModel && everyDeclared && defined.every((value) => value === model)
  const modelConflict = useModel && !corroborates && defined.some((value) => value !== model)
  if (deploymentConflict || modelConflict) {
    return { state: "conflict", value: 0, conflict: true, source: useModel ? "derived" : "litellm" }
  }
  if (hasUnknown) return { state: "unknown", value: 0, conflict: false, source: "litellm" }
  return { state: "known", value: defined[0]!, conflict: false, source: useModel && corroborates ? "derived" : "litellm" }
}

/**
 * The group's agreed limit value, mirroring exactly what the published
 * spec carries (context capped when `contextTierCap` is enabled).
 * `undefined` when the group evidence is unknown or conflicting.
 */
export function agreedLimitValue(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  field: "context" | "output",
  contextTierCap = false,
): number | undefined {
  const { deploymentValues, modelLevel } = deploymentLimitEvidence(group, selected, field)
  const aggregate = aggregateScalarEvidence(
    deploymentValues,
    modelLevel,
    field === "context" && modelLevel !== undefined && modelLevel > 0,
  )
  if (aggregate.state !== "known" || !(aggregate.value > 0)) return undefined
  if (field === "context" && contextTierCap) {
    const tierPoints = group.deployments
      .map(firstTierPoint)
      .filter((value): value is number => value !== undefined)
    const firstTier = tierPoints.length > 0 ? Math.min(...tierPoints) : undefined
    if (firstTier !== undefined) return Math.min(aggregate.value, firstTier)
  }
  return aggregate.value
}

/**
 * Group limit evidence with unknown/conflict semantics, then legality.
 *
 * Illegality is a declared fact: any explicitly declared non-positive
 * value — deployment or trusted model-level, context or output — is
 * illegal metadata regardless of the group decision. A declared `0` is
 * never treated as missing or unknown.
 */
function assessGroupLimit(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  field: "context" | "output",
  options: BuildOptions,
): LimitAssessment {
  const { deploymentValues, modelLevel } = deploymentLimitEvidence(group, selected, field)
  const knownValue = agreedLimitValue(group, selected, field, options.contextTierCap)
  const provenance = (detail: string, source: PublicationFieldProvenance["source"]): PublicationFieldProvenance => {
    if (source === "models.dev") {
      return {
        source,
        detail: `limit.${field} -> provider ${selected?.providerID ?? "unknown-provider"} -> model ${selected?.modelID ?? "unknown-model"}`,
      }
    }
    return { source, detail }
  }
  const knownSource = modelLevel !== undefined && modelLevel > 0 && field === "context" ? "models.dev" : "litellm"

  const illegal = deploymentValues.some((value) => value !== undefined && !(value > 0)) ||
    (modelLevel !== undefined && !(modelLevel > 0))
  if (illegal) {
    return {
      value: 0, valid: false, missing: false, unknown: false, conflict: false, illegal: true,
      provenance: { source: "litellm", detail: `illegal ${field} limit metadata` },
    }
  }
  if (knownValue !== undefined) {
    return {
      value: Math.floor(knownValue), valid: true, missing: false, unknown: false, conflict: false, illegal: false,
      provenance: provenance(`limit.${field} group evidence`, knownSource),
    }
  }

  const defined = deploymentValues.filter((value): value is number => value !== undefined)
  const declaredConflict = defined.length > 0 && !defined.every((value) => value === defined[0]) ||
    (defined.length > 0 && modelLevel !== undefined && modelLevel > 0 && field === "output" && defined[0] !== modelLevel)
  if (declaredConflict) {
    return {
      value: 0, valid: false, missing: false, unknown: false, conflict: true, illegal: false,
      provenance: provenance(`limit.${field} deployment or model-level conflict`, "derived"),
    }
  }
  const everythingUndeclared = deploymentValues.every((value) => value === undefined) &&
    !(modelLevel !== undefined && modelLevel > 0)
  if (everythingUndeclared) {
    return {
      value: 0, valid: false, missing: true, unknown: false, conflict: false, illegal: false,
      provenance: provenance(`no ${field} limit metadata`, "none"),
    }
  }
  return {
    value: 0, valid: false, missing: false, unknown: true, conflict: false, illegal: false,
    provenance: provenance(`partial ${field} limit evidence; unknown is not coerced`, "litellm"),
  }
}

const INPUT_MODALITY_FIELDS = [
  ["supports_vision", "image"],
  ["supports_pdf_input", "pdf"],
  ["supports_audio_input", "audio"],
  ["supports_video_input", "video"],
] as const

const OUTPUT_MODALITY_FIELDS = [
  ["supports_audio_output", "audio"],
] as const

/**
 * Raw per-dimension evidence for one direction. Each dimension carries
 * every deployment's declaration so aggregation can distinguish
 * all-unknown, partially-declared, fully-declared-agreed, and conflicting.
 */
function modalityDimensionEvidence(
  group: DeploymentGroup,
  direction: "input" | "output",
): Array<{ modality: string; values: Array<boolean | undefined> }> {
  const fields = direction === "input" ? INPUT_MODALITY_FIELDS : OUTPUT_MODALITY_FIELDS
  return fields.map(([key, modality]) => ({
    modality,
    values: group.deployments.map((d) => optionalBoolean(d.modelInfo[key])),
  }))
}

/**
 * models.dev complete modality set: listed means supported, unlisted means
 * not in the declared set. Only consumed when trusted record-level metadata
 * exists for the direction.
 */
function modelsDevModalitySet(
  selected: SelectedModelRecord | undefined,
  direction: "input" | "output",
): ReadonlySet<string> | undefined {
  const modalities = selected?.record.modalities
  if (!isRecord(modalities) || !Array.isArray(modalities[direction])) return undefined
  const list = (modalities[direction] as unknown[]).filter((value): value is string => typeof value === "string")
  if (list.length === 0) return undefined
  return new Set(list)
}

function assessModalities(
  values: readonly string[],
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  direction: "input" | "output",
): ModalityAssessment {
  const dimensions = modalityDimensionEvidence(group, direction)
  const modelSet = modelsDevModalitySet(selected, direction)

  let conflict = false
  const supported = new Set<string>()
  for (const dimension of dimensions) {
    const defined = dimension.values.filter((value): value is boolean => value !== undefined)
    if (defined.length === 0) {
      if (modelSet?.has(dimension.modality)) supported.add(dimension.modality)
      continue
    }
    if (!defined.every((value) => value === defined[0])) {
      conflict = true
      continue
    }
    const isSupported = defined[0] === true
    if (modelSet !== undefined && modelSet.has(dimension.modality) !== isSupported) conflict = true
    if (isSupported) supported.add(dimension.modality)
  }

  const known = !conflict && dimensions.every((dimension) => {
    const defined = dimension.values.filter((value): value is boolean => value !== undefined)
    if (defined.length === 0) return modelSet !== undefined
    return defined.length === dimension.values.length &&
      defined.every((value) => value === defined[0])
  })

  if (known && !supported.has("text")) supported.add("text")

  return {
    values: known ? [...supported] : values,
    known,
    provenance: conflict
      ? { source: "derived", detail: `${direction} modality evidence conflicts; not coerced to a set` }
      : known
        ? {
          source: modelSet !== undefined ? "models.dev" : "litellm",
          detail: `${direction} modality evidence covers every dimension`,
        }
        : { source: "default", detail: `${direction} modality evidence incomplete; text baseline without full evidence` },
  }
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

  const toolAggregation = aggregateTriState(
    group.deployments.map((d) => optionalBoolean(d.modelInfo.supports_function_calling)),
    optionalBoolean(effectiveSelected?.record.tool_call),
  )
  const toolState = toolAggregation.state

  const reasoningState = resolveReasoningState(group, effectiveSelected)
  const levels = resolveReasoningLevels(effectiveSelected, protocol)
  const context = assessGroupLimit(group, effectiveSelected, "context", options)
  const output = assessGroupLimit(group, effectiveSelected, "output", options)
  const inputModalities = assessModalities(mapped.capabilities.input, group, effectiveSelected, "input")
  const outputModalities = assessModalities(mapped.capabilities.output, group, effectiveSelected, "output")

  const missingFields: string[] = []
  const unknownFields: string[] = []
  const illegalFields: string[] = []
  const conflictFields: string[] = []
  if (context.missing) missingFields.push("limit.context")
  if (output.missing) missingFields.push("limit.output")
  if (context.illegal) illegalFields.push("limit.context")
  if (output.illegal) illegalFields.push("limit.output")
  if (context.conflict) conflictFields.push("limit.context")
  if (output.conflict) conflictFields.push("limit.output")
  if (toolState === "unknown") unknownFields.push("capabilities.tools")
  if (reasoningState.state === "unknown") unknownFields.push("reasoning")
  if (!inputModalities.known) unknownFields.push("capabilities.input")
  if (!outputModalities.known) unknownFields.push("capabilities.output")
  if (context.unknown || output.unknown) {
    // Unknown limits participate as unknowns, not missing values.
    if (context.unknown) unknownFields.push("limit.context")
    if (output.unknown) unknownFields.push("limit.output")
  }

  const catalogDown = !input.catalogAvailable
  const litellmOnlyComplete = detailed.outcome === "unmatched" &&
    missingFields.length === 0 &&
    unknownFields.length === 0 &&
    illegalFields.length === 0 &&
    conflictFields.length === 0
  const groupConflicts = conflictFields.length > 0
  let status: ModelConfigurationStatus
  if (detailed.outcome === "ambiguous") status = "ambiguous"
  else if (groupConflicts || illegalFields.length > 0) status = "invalid-metadata"
  else if (litellmOnlyComplete) status = "configured"
  else if (detailed.outcome === "unmatched" && catalogDown) status = "metadata-unavailable"
  else if (detailed.outcome === "unmatched" && missingFields.length === 0 && unknownFields.length === 0) status = "unmatched"
  else if (catalogDown && (missingFields.length > 0 || unknownFields.length > 0 || detailed.outcome === "unmatched")) {
    status = "metadata-unavailable"
  } else if (missingFields.length > 0 || unknownFields.length > 0) status = "discovered-incomplete"
  else if (detailed.outcome === "unmatched") status = "unmatched"
  else status = "configured"

  const publishable = status === "configured"
  return {
    publishable,
    status,
    tools: {
      state: toolState,
      provenance: toolAggregation.conflict
        ? { source: "derived", detail: "deployment or model-level tool evidence conflicts; unknown is not coerced" }
        : toolProvenance(group, effectiveSelected, inherited?.inheritedFields.includes("tool_call") ?? false),
    },
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
    conflictFields,
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

/**
 * Bumped when publication completeness grows or captured facts change
 * meaning. An older number cannot satisfy a newer policy; restoration
 * also re-checks the captured verdict against the stored spec so a
 * same-number entry with unknown capabilities or inconsistent facts
 * still fails closed.
 */
export const PUBLICATION_SCHEMA_VERSION = 3 as const

export interface LastKnownGoodCapabilityVerdict {
  readonly tools: CapabilityState
  readonly reasoning: CapabilityState
  readonly inputModalitiesKnown: boolean
  readonly outputModalitiesKnown: boolean
  /** Actual modality sets when known, so live evidence can conflict-check them. */
  readonly inputModalities: readonly string[]
  readonly outputModalities: readonly string[]
  /**
   * Captured limit facts used for live conflict detection. Each value is
   * compared only against the same dimension: `context` is total context
   * (models.dev `limit.context`), `input` is input capacity (LiteLLM
   * `max_input_tokens` / models.dev `limit.input`), `output` is the
   * output limit. Never compared across dimensions.
   */
  readonly context: number
  readonly input: number
  readonly output: number
}

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
  /** Completeness verdict captured when the snapshot passed publication policy. */
  readonly captured: LastKnownGoodCapabilityVerdict
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

/**
 * Capture the publication facts proven by an assessment.
 *
 * `spec` supplies the input limit (the assessment has no input gate);
 * when omitted, `input` is `0` and `createLastKnownGoodEntry` backfills it
 * from the spec it stores, so adapters seeding through the legacy
 * single-argument call keep producing valid entries.
 */
export function capturedPublicationVerdict(
  assessment: CompletenessAssessment,
  spec?: ModelSpec,
): LastKnownGoodCapabilityVerdict {
  return {
    tools: assessment.tools.state,
    reasoning: assessment.reasoning.state,
    inputModalitiesKnown: assessment.inputModalities.known,
    outputModalitiesKnown: assessment.outputModalities.known,
    inputModalities: [...assessment.inputModalities.values],
    outputModalities: [...assessment.outputModalities.values],
    context: assessment.context.value,
    input: spec !== undefined ? Math.floor(spec.limit.input) : 0,
    output: assessment.output.value,
  }
}

export function createLastKnownGoodEntry(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  spec: ModelSpec,
  now = Date.now(),
  captured?: LastKnownGoodCapabilityVerdict,
  catalog?: unknown,
  options?: BuildOptions,
): LastKnownGoodEntry {
  const raw = captured ?? (catalog !== undefined && options !== undefined
    ? capturedPublicationVerdict(assessModelConfiguration(group, catalog, options), spec)
    : undefined)
  if (!raw) {
    throw new Error("LKG can only be captured from a snapshot that passes current publication policy")
  }
  // The stored input fact is the spec's input limit; a caller that could
  // not know it yet contributes no input fact of its own.
  const proof: LastKnownGoodCapabilityVerdict = {
    ...raw,
    input: raw.input > 0 ? Math.floor(raw.input) : Math.floor(spec.limit.input),
  }
  if (!validateCapturedPublication({ spec, captured: proof }).valid) {
    throw new Error("LKG can only be captured from a snapshot that passes current publication policy")
  }
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
    captured: proof,
    provenanceDetail: selected
      ? `LKG originally fetched at ${new Date(now).toISOString()} via provider ${selected.providerID} -> model ${selected.modelID}`
      : `LKG originally fetched at ${new Date(now).toISOString()} via LiteLLM-only declarations`,
  }
}

function isCapabilityState(value: unknown): value is CapabilityState {
  return value === "supported" || value === "unsupported" || value === "unknown"
}

function isCapturedVerdict(value: unknown): value is LastKnownGoodCapabilityVerdict {
  if (!isRecord(value)) return false
  return isCapabilityState(value.tools) &&
    isCapabilityState(value.reasoning) &&
    typeof value.inputModalitiesKnown === "boolean" &&
    typeof value.outputModalitiesKnown === "boolean" &&
    Array.isArray(value.inputModalities) &&
    Array.isArray(value.outputModalities) &&
    typeof value.context === "number" &&
    typeof value.input === "number" &&
    typeof value.output === "number"
}

/** Set equality over canonical modality names; array order never matters. */
function sameModalitySet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size !== rightSet.size) return false
  for (const value of leftSet) {
    if (!rightSet.has(value)) return false
  }
  return true
}

/**
 * Re-prove that a stored snapshot still satisfies the current publication
 * completeness policy AND describes the very spec it would restore.
 * Positive limits alone are not enough: unknown tools, reasoning, or
 * modalities, any illegal captured field, and any mismatch between the
 * captured facts and `entry.spec` (limits, tools, reasoning, modality
 * sets) fail closed. A forged fact that merely parses is still rejected.
 */
export function validateCapturedPublication(
  entry: Pick<LastKnownGoodEntry, "spec" | "captured">,
): { valid: boolean; reason: string } {
  if (!isCapturedVerdict(entry.captured)) {
    return { valid: false, reason: "LKG completeness verdict is missing or incompatible" }
  }
  if (!(entry.spec.limit.context > 0 && entry.spec.limit.output > 0)) {
    return { valid: false, reason: "LKG operational limits are not positive" }
  }
  if (entry.captured.tools === "unknown") {
    return { valid: false, reason: "LKG tools were unknown when captured" }
  }
  if (entry.captured.reasoning === "unknown") {
    return { valid: false, reason: "LKG reasoning was unknown when captured" }
  }
  if (!entry.captured.inputModalitiesKnown || !entry.captured.outputModalitiesKnown) {
    return { valid: false, reason: "LKG modalities were not known when captured" }
  }
  if (entry.spec.reasoningSupported === "unknown") {
    return { valid: false, reason: "LKG spec reasoning is unknown" }
  }
  // Captured facts must be the facts of the stored spec that restoration
  // actually publishes; a consistent-looking entry with shifted numbers
  // (or shifted sets/verdicts) is forged and never restores.
  if (
    entry.captured.context !== entry.spec.limit.context ||
    entry.captured.input !== entry.spec.limit.input ||
    entry.captured.output !== entry.spec.limit.output
  ) {
    return { valid: false, reason: "LKG captured limits do not match the stored spec" }
  }
  if ((entry.captured.tools === "supported") !== entry.spec.capabilities.tools) {
    return { valid: false, reason: "LKG captured tools verdict does not match the stored spec" }
  }
  if (entry.captured.reasoning !== entry.spec.reasoningSupported) {
    return { valid: false, reason: "LKG captured reasoning verdict does not match the stored spec" }
  }
  if (!sameModalitySet(entry.captured.inputModalities, entry.spec.capabilities.input)) {
    return { valid: false, reason: "LKG captured input modalities do not match the stored spec" }
  }
  if (!sameModalitySet(entry.captured.outputModalities, entry.spec.capabilities.output)) {
    return { valid: false, reason: "LKG captured output modalities do not match the stored spec" }
  }
  return { valid: true, reason: "captured publication verdict still satisfies current completeness policy" }
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
  options?: Pick<BuildOptions, "contextTierCap">,
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
  const liveConflict = liveCapabilityConflict(group, selected, entry, options)
  if (liveConflict) return { valid: false, reason: liveConflict, ageMs }
  return { valid: true, reason: "identity, provider, schema, and live facts agree", ageMs }
}

function explicitBooleanConflict(
  values: readonly (boolean | undefined)[],
  captured: CapabilityState,
): boolean {
  if (captured !== "supported" && captured !== "unsupported") return false
  const expected = captured === "supported"
  return values.some((value) => value !== undefined && value !== expected)
}

/**
 * Modality conflict over EVERY live explicit declaration, per dimension.
 * Any deployment's explicit flag contradicting the captured set fails the
 * whole entry; `undefined` is not a contradiction but can never mask a
 * sibling deployment's conflicting value. The verdict is a predicate over
 * the full value set, so deployment array order cannot change it.
 *
 * `LKG contains image` + any `live supports_vision=false` and
 * `LKG text-only` + any `live supports_vision=true` both reject.
 */
function explicitModalityConflict(
  group: DeploymentGroup,
  capturedSet: ReadonlySet<string>,
  direction: "input" | "output",
): boolean {
  const fields = direction === "input" ? INPUT_MODALITY_FIELDS : OUTPUT_MODALITY_FIELDS
  return fields.some(([key, modality]) => {
    const expected = capturedSet.has(modality)
    return group.deployments.some((deployment) => {
      const live = optionalBoolean(deployment.modelInfo[key])
      return live !== undefined && live !== expected
    })
  })
}

/** Illegal live deployment limit values are never hidden behind an LKG restore. */
function illegalLiveLimit(group: DeploymentGroup): boolean {
  return group.deployments.some((deployment) =>
    ["max_input_tokens", "max_output_tokens", "max_tokens"].some((key) => {
      const value = optionalNumber(deployment.modelInfo[key])
      return value !== undefined && !(value > 0)
    })
  )
}

/** Raw trusted model-level limit from the effective (possibly inherited) record. */
function modelLevelLimit(
  selected: SelectedModelRecord | undefined,
  field: "context" | "input" | "output",
): number | undefined {
  if (!isRecord(selected?.record.limit)) return undefined
  return optionalNumber((selected!.record.limit as Record<string, unknown>)[field])
}

/**
 * Trusted model-level modality set reduced exactly the way the published
 * spec derives it (text baseline + the direction's mapped dimensions), so
 * a live models.dev set compares like-for-like with the captured set.
 */
function modelsDevDerivedModalitySet(
  selected: SelectedModelRecord | undefined,
  direction: "input" | "output",
): ReadonlySet<string> | undefined {
  const set = modelsDevModalitySet(selected, direction)
  if (set === undefined) return undefined
  const fields = direction === "input" ? INPUT_MODALITY_FIELDS : OUTPUT_MODALITY_FIELDS
  const derived = new Set<string>(["text"])
  for (const [, modality] of fields) {
    if (set.has(modality)) derived.add(modality)
  }
  return derived
}

/**
 * Positive live declarations that contradict the captured capability
 * verdict. Deployment-level facts (tool/reasoning/modality flags, limit
 * values) and trusted current model-level facts (record modalities,
 * context/input/output, tool_call, reasoning) are both checked. Every
 * comparison is like-for-like inside one capability dimension:
 *
 * - `context` (total context) compares only against the trusted
 *   model-level `limit.context`; a LiteLLM `max_input_tokens` is input
 *   capacity and never proves or contradicts total context.
 * - `output` compares every explicit output fact (deployment
 *   `max_output_tokens`/`max_tokens` and model-level `limit.output`).
 * - `input` compares the recomputed current input limit (same derivation
 *   as the published spec) against the captured input; absent live input
 *   evidence is unknown, not a contradiction.
 *
 * Any single conflict invalidates the whole entry (no field-level merge).
 */
function liveCapabilityConflict(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  entry: LastKnownGoodEntry,
  options?: Pick<BuildOptions, "contextTierCap">,
): string | undefined {
  if (!isCapturedVerdict(entry.captured)) return "LKG completeness verdict is missing"
  const captured = entry.captured
  if (explicitBooleanConflict(
    group.deployments.map((deployment) => optionalBoolean(deployment.modelInfo.supports_function_calling)),
    captured.tools,
  )) return "live tool declaration conflicts with captured LKG"
  if (explicitBooleanConflict(
    group.deployments.map((deployment) => optionalBoolean(deployment.modelInfo.supports_reasoning)),
    captured.reasoning,
  )) return "live reasoning declaration conflicts with captured LKG"
  if (explicitModalityConflict(group, new Set(captured.inputModalities), "input")) {
    return "live input modality declaration conflicts with captured LKG"
  }
  if (explicitModalityConflict(group, new Set(captured.outputModalities), "output")) {
    return "live output modality declaration conflicts with captured LKG"
  }
  if (illegalLiveLimit(group)) return "live limit metadata is illegal; LKG cannot mask invalid metadata"

  // Trusted current model-level facts. These records (after canonical
  // inheritance) participated in the captured verdict, so a changed
  // model-level value is a contradiction even when deployments are silent.
  const mdContext = modelLevelLimit(selected, "context")
  const mdOutput = modelLevelLimit(selected, "output")
  if (mdContext !== undefined && !(mdContext > 0)) {
    return "live model-level context limit is illegal; LKG cannot mask invalid metadata"
  }
  if (mdOutput !== undefined && !(mdOutput > 0)) {
    return "live model-level output limit is illegal; LKG cannot mask invalid metadata"
  }
  const mdTools = optionalBoolean(selected?.record.tool_call)
  if (mdTools !== undefined && (captured.tools === "supported") !== mdTools) {
    return "live model-level tool declaration conflicts with captured LKG"
  }
  const mdReasoning = modelsDevReasoning(selected)
  if (mdReasoning !== undefined && (captured.reasoning === "supported") !== mdReasoning) {
    return "live model-level reasoning declaration conflicts with captured LKG"
  }
  const mdInputSet = modelsDevDerivedModalitySet(selected, "input")
  if (mdInputSet !== undefined && !sameModalitySet([...mdInputSet], captured.inputModalities)) {
    return "live model-level input modalities conflict with captured LKG"
  }
  const mdOutputSet = modelsDevDerivedModalitySet(selected, "output")
  if (mdOutputSet !== undefined && !sameModalitySet([...mdOutputSet], captured.outputModalities)) {
    return "live model-level output modalities conflict with captured LKG"
  }

  // Total context: only a trusted total-context fact participates.
  if (captured.context > 0 && mdContext !== undefined && Math.floor(mdContext) !== captured.context) {
    return `live model-level context ${Math.floor(mdContext)} conflicts with captured LKG context ${captured.context}`
  }

  // Output: every explicit output fact in the output dimension.
  if (captured.output > 0) {
    if (mdOutput !== undefined && Math.floor(mdOutput) !== captured.output) {
      return `live model-level output ${Math.floor(mdOutput)} conflicts with captured LKG output ${captured.output}`
    }
    const outputValues = deploymentLimitEvidence(group, selected, "output").deploymentValues
      .filter((value): value is number => value !== undefined)
    if (outputValues.some((value) => Math.floor(value) !== captured.output)) {
      return `live output limit conflicts with captured LKG output ${captured.output}`
    }
  }

  // Input: recompute the current input limit with the exact derivation the
  // published spec uses (deployment max_input_tokens, models.dev
  // limit.input, context/tier caps) and compare like-for-like.
  if (captured.input > 0) {
    const liveInput = mapCapabilities(group, selected, options?.contextTierCap ?? false).limit.input
    if (liveInput > 0 && Math.floor(liveInput) !== captured.input) {
      return `live input limit ${Math.floor(liveInput)} conflicts with captured LKG input ${captured.input}`
    }
  }
  return undefined
}

export function isLKGEntryCompatible(value: unknown): value is LastKnownGoodEntry {
  if (!isRecord(value)) return false
  return value.schemaVersion === PUBLICATION_SCHEMA_VERSION &&
    typeof value.modelName === "string" &&
    typeof value.canonicalID === "string" &&
    typeof value.providerID === "string" &&
    typeof value.fetchedAt === "string" &&
    typeof value.fetchedAtEpochMs === "number" &&
    isCapturedVerdict(value.captured)
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
  // Same effective record the live assessment uses (canonical inheritance
  // included): model-level facts compared against LKG must be the facts
  // that would be published live today.
  const inherited = resolveInheritedRecord(detailed.selected, catalog)
  const effectiveSelected = inherited
    ? { ...detailed.selected!, record: inherited.record }
    : detailed.selected
  const keys = [lastKnownGoodKey(group.modelName)]
  for (const key of keys) {
    const entry = store.get(key)
    if (!entry || !isLKGEntryCompatible(entry)) continue
    const validation = validateLastKnownGood(entry, group, effectiveSelected, now, options)
    if (!validation.valid) continue
    const captured = validateCapturedPublication(entry)
    if (!captured.valid) continue
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

export type DegradationEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: string }

/**
 * Which blocked states a user may explicitly accept.
 *
 * Only known-identity incompleteness and a failed metadata source are
 * "the user knows what is missing". Ambiguous identity, illegal values,
 * and unmatched identity are different failures and stay blocked.
 */
export function degradationEligibility(assessment: CompletenessAssessment): DegradationEligibility {
  if (
    assessment.identity.outcome === "unmatched" &&
    assessment.status !== "configured" &&
    assessment.status !== "metadata-unavailable"
  ) {
    return { eligible: false, reason: "unmatched identity is not ordinary incompleteness" }
  }
  if (assessment.status === "discovered-incomplete" || assessment.status === "metadata-unavailable") {
    return { eligible: true }
  }
  const reason = assessment.status === "ambiguous"
    ? "ambiguous identity cannot be accepted as a missing-field risk"
    : assessment.status === "invalid-metadata"
      ? "illegal metadata cannot be accepted as an unknown risk"
      : assessment.status === "unmatched"
        ? "unmatched identity is not ordinary incompleteness"
        : assessment.status === "configured" || assessment.status === "configured-lkg"
          ? "fully configured models do not need degradation acceptance"
          : assessment.status === "degraded"
            ? "model is already degraded"
            : `status ${assessment.status} is not eligible for degradation`
  return { eligible: false, reason }
}

export function isDegradationEligible(assessment: CompletenessAssessment): boolean {
  return degradationEligibility(assessment).eligible
}

/**
 * User-accepted degradation. The returned wrapper stays `degraded` and
 * keeps every missing/unknown/illegal field listed; it is publishable
 * only through the degraded path, never as `configured`.
 *
 * Ineligible states throw so adapters cannot report a successful accept
 * for ambiguous, invalid, unmatched, or already-configured models.
 */
export function acceptDegradedConfiguration(
  assessment: CompletenessAssessment,
  acceptance: { reason?: string; acceptedAt?: string },
): DegradedConfiguration {
  const eligibility = degradationEligibility(assessment)
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason)
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

    if (buildOptions.acceptedDegradedIDs?.has(group.modelName) && isDegradationEligible(live)) {
      const degraded = acceptDegradedConfiguration(live, { reason: buildOptions.degradationReason })
      publishable.push({ spec, assessment: degraded.assessment, degraded })
      assessments.set(group.modelName, degraded.assessment)
      continue
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
