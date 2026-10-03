/**
 * Host-independent models.dev record selection and reasoning variant extraction.
 */
import {
  isRecord,
  optionalBoolean,
  optionalNumber,
  optionalString,
  stripRoutePrefix,
  type DeploymentGroup,
} from "./litellm.js"
import type { Protocol } from "./protocol.js"

export interface ModelsDevRecord extends Record<string, unknown> {
  id?: unknown
  name?: unknown
  aliases?: unknown
  canonical_model_id?: unknown
  reasoning?: unknown
  release_date?: unknown
  modalities?: unknown
  limit?: unknown
  cost?: unknown
  tool_call?: unknown
  reasoning_options?: unknown
}

export type ModelsDevMatchKind = "exact" | "canonical" | "alias"

export type ModelsDevSelectionSource =
  | "explicit-provider"
  | "canonical-original"
  | "openrouter-fallback"
  | "opencode-fallback"
  | "unique-match"
  /**
   * Isolated non-publication compatibility only. Never produced by
   * `selectModelsDevRecord` or `selectModelsDevRecordDetailed`, and never
   * eligible for trusted publication or models.dev price fallback.
   */
  | "legacy-family-compatibility"

export interface SelectedModelRecord {
  providerID: string
  modelID: string
  record: ModelsDevRecord
  matchedCandidate?: string
  matchKind?: ModelsDevMatchKind
  selectionSource?: ModelsDevSelectionSource
}

/**
 * Whether provider-scoped models.dev pricing can be treated as a plausible
 * fallback for the deployed model. Gateway/reseller records selected only for
 * capability enrichment must never masquerade as the LiteLLM route price.
 */
export function canUseSelectedModelsDevPrice(selected: SelectedModelRecord | undefined): boolean {
  // Undefined is kept for backwards-compatible direct callers/tests that
  // construct SelectedModelRecord manually without going through the selector.
  return selected?.selectionSource === undefined ||
    selected.selectionSource === "explicit-provider" ||
    selected.selectionSource === "canonical-original"
}

export interface ModelVariant {
  id: string
  settings: Record<string, unknown>
}

export type ReasoningSupportSource = "litellm" | "models.dev" | "derived" | "default"

export interface ReasoningSupportResolution {
  readonly supported: boolean
  readonly source: ReasoningSupportSource
  readonly conflict: boolean
}

/**
 * Name-prefix provider guesses. Isolated from trusted publication: neither
 * `selectModelsDevRecord` nor `selectModelsDevRecordDetailed` consults this
 * table. A model name starting with `qwen` is not evidence of `alibaba`.
 */
const LEGACY_FAMILY_COMPATIBILITY_RULES: Array<[RegExp, string]> = [
  [/^(?:gpt-|o\d|.*codex)/, "openai"],
  [/^claude-/, "anthropic"],
  [/^gemini-/, "google"],
  [/^grok-/, "xai"],
  [/^glm-/, "zai"],
  [/^deepseek-/, "deepseek"],
  [/^kimi-/, "moonshotai"],
  [/^mimo-/, "xiaomi"],
  [/^minimax-/, "minimax"],
  [/^qwen/, "alibaba"],
]

function providers(catalog: unknown): Array<[string, Record<string, unknown>]> {
  if (!isRecord(catalog)) return []
  return Object.entries(catalog).flatMap(([providerID, provider]) => {
    if (!isRecord(provider) || !isRecord(provider.models)) return []
    return [[providerID, provider.models] as [string, Record<string, unknown>]]
  })
}

/**
 * Conservative canonicalization for identity matching only. It deliberately does
 * not strip semantic suffixes such as "-free", dates, sizes, or provider tiers.
 */
export function canonicalModelID(value: string): string {
  return stripRoutePrefix(value.trim())
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
}

function recordAliases(key: string, value: ModelsDevRecord): string[] {
  const aliases = Array.isArray(value.aliases)
    ? value.aliases.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  return [key, optionalString(value.id), ...aliases].filter((item): item is string => item !== undefined)
}

function findMatch(
  models: Record<string, unknown>,
  candidate: string,
): [string, ModelsDevRecord, ModelsDevMatchKind] | undefined {
  const raw = stripRoutePrefix(candidate.trim()).toLowerCase()
  const canonical = canonicalModelID(candidate)

  for (const [key, value] of Object.entries(models)) {
    if (!isRecord(value)) continue
    const id = optionalString(value.id) ?? key
    const aliases = recordAliases(key, value)

    for (const alias of aliases) {
      const normalizedAlias = stripRoutePrefix(alias.trim()).toLowerCase()
      if (normalizedAlias === raw) {
        const kind: ModelsDevMatchKind =
          alias === key || alias === optionalString(value.id) ? "exact" : "alias"
        return [id, value, kind]
      }
    }

    for (const alias of aliases) {
      if (canonicalModelID(alias) === canonical) {
        const kind: ModelsDevMatchKind =
          alias === key || alias === optionalString(value.id) ? "canonical" : "alias"
        return [id, value, kind]
      }
    }
  }
  return undefined
}

export function candidateModelIDs(group: DeploymentGroup): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined) => {
    if (!value) return
    const normalized = value.toLowerCase()
    if (seen.has(normalized)) return
    seen.add(normalized)
    result.push(value)
  }

  for (const deployment of group.deployments) {
    add(optionalString(deployment.modelInfo.base_model))
    const routed = optionalString(deployment.litellmParams.model)
    add(routed ? stripRoutePrefix(routed) : undefined)
  }
  add(group.modelName)
  return result
}

/**
 * Non-publication compatibility helper. Returns a name-prefix provider guess
 * and never participates in trusted identity resolution.
 *
 * Callers that need a publishable identity must use
 * `selectModelsDevRecord` / `selectModelsDevRecordDetailed`.
 */
export function legacyFamilyCompatibilityProvider(group: DeploymentGroup): string | undefined {
  for (const candidate of candidateModelIDs(group)) {
    const normalized = canonicalModelID(candidate)
    const match = LEGACY_FAMILY_COMPATIBILITY_RULES.find(([pattern]) => pattern.test(normalized))
    if (match) return match[1]
  }
  return undefined
}

function selected(
  providerID: string,
  candidate: string,
  match: [string, ModelsDevRecord, ModelsDevMatchKind],
  selectionSource?: ModelsDevSelectionSource,
): SelectedModelRecord {
  return {
    providerID,
    modelID: match[0],
    record: match[1],
    matchedCandidate: candidate,
    matchKind: match[2],
    selectionSource,
  }
}

function canonicalProviderCandidates(matches: SelectedModelRecord[]): string[] {
  const providers = new Set<string>()
  for (const match of matches) {
    const canonical = optionalString(match.record.canonical_model_id)
    if (!canonical) continue
    const slash = canonical.indexOf("/")
    if (slash <= 0) continue
    providers.add(canonical.slice(0, slash).toLowerCase())
  }
  return [...providers]
}

/**
 * Trusted identity resolution. Provider choice uses only verifiable
 * relations: explicit `models_dev_provider`, `canonical_model_id`,
 * alias / equivalent / inherits metadata consumed by matching, OpenRouter,
 * OpenCode, or a genuinely unique remaining record.
 *
 * Model-name prefixes and family substrings never select a provider.
 * Multiple remaining records stay unresolved (`undefined`) so publication
 * can report `ambiguous` instead of guessing.
 */
export function selectModelsDevRecord(
  group: DeploymentGroup,
  catalog: unknown,
): SelectedModelRecord | undefined {
  return selectModelsDevRecordDetailed(group, catalog).selected
}

function modelsDevReasoning(selected: SelectedModelRecord | undefined): boolean | undefined {
  const declared = optionalBoolean(selected?.record.reasoning)
  if (declared !== undefined) return declared
  const options = selected?.record.reasoning_options
  return Array.isArray(options) && options.length > 0 ? true : undefined
}

export function resolveReasoningSupport(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
): ReasoningSupportResolution {
  const state = resolveReasoningState(group, selected)
  const explicit = group.deployments.map((deployment) =>
    optionalBoolean(deployment.modelInfo.supports_reasoning)
  )
  const source = explicit.every((value) => value !== undefined)
    ? "litellm"
    : state.source
  return {
    // Boolean transport cannot carry unknown. Publication uses
    // resolveReasoningState and never treats this false as confirmed.
    supported: state.state === "supported",
    source,
    conflict: state.conflict,
  }
}

function effortVariants(options: unknown, protocol: Protocol): ModelVariant[] {
  if (!isRecord(options) || options.type !== "effort" || !Array.isArray(options.values)) return []
  const key = protocol === "messages" ? "effort" : "reasoningEffort"
  const values = options.values.filter((value): value is string => typeof value === "string")
  return [...new Set(values)].map((value) => ({ id: value, settings: { [key]: value } }))
}

function budgetVariants(options: unknown, protocol: Protocol): ModelVariant[] {
  if (!isRecord(options) || options.type !== "budget_tokens" || protocol !== "messages") return []
  const declaredMax = optionalNumber(options.max)
  const maximum = declaredMax !== undefined && declaredMax > 0 ? Math.floor(declaredMax) : undefined
  const high = maximum === undefined ? 16000 : Math.min(16000, maximum)
  const result: ModelVariant[] = [
    { id: "high", settings: { thinking: { type: "enabled", budgetTokens: high } } },
  ]
  if (maximum !== undefined && maximum > high) {
    result.push({
      id: "max",
      settings: { thinking: { type: "enabled", budgetTokens: maximum } },
    })
  }
  return result
}

export function buildVariants(
  selected: SelectedModelRecord | undefined,
  protocol: Protocol,
): ModelVariant[] {
  const options = selected?.record.reasoning_options
  if (!Array.isArray(options)) return []

  const byID = new Map<string, ModelVariant>()
  for (const option of options) {
    for (const variant of [...effortVariants(option, protocol), ...budgetVariants(option, protocol)]) {
      if (!byID.has(variant.id)) byID.set(variant.id, variant)
    }
  }
  return [...byID.values()]
}

export function releaseTimestamp(selected: SelectedModelRecord | undefined): number {
  const value = selected?.record.release_date
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

/**
 * Trusted-publication additions (see `trusted-model-capability-publication`).
 *
 * The legacy boolean/zero defaults above stay wire-compatible. The helpers
 * below expose the unknown-aware semantics the publication policy needs:
 * tri-state capability states, detailed selection outcomes, and
 * deterministic canonical inheritance with provenance. Nothing here
 * performs I/O or guesses capabilities from names or families.
 */

/** Unknown-aware capability state: `unknown` means no trusted evidence. */
export type CapabilityState = "supported" | "unsupported" | "unknown"

export interface ReasoningStateResolution {
  readonly state: CapabilityState
  readonly source: ReasoningSupportSource
  readonly conflict: boolean
}

/**
 * Tri-state reasoning support, independent from variant levels.
 *
 * Unlike the legacy boolean resolver (which maps "no evidence" to
 * `false`), this resolver reports `unknown` when neither LiteLLM nor
 * models.dev supplies trusted evidence, and when explicit LiteLLM
 * declarations disagree with each other.
 */
export function resolveReasoningState(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
): ReasoningStateResolution {
  const aggregated = aggregateTriState(
    group.deployments.map((deployment) => optionalBoolean(deployment.modelInfo.supports_reasoning)),
    modelsDevReasoning(selected),
  )
  return { state: aggregated.state, source: aggregated.source, conflict: aggregated.conflict }
}

export interface ReasoningLevelsResolution {
  /** Whether level metadata was explicitly declared (possibly empty). */
  readonly known: boolean
  /** Selectable level ids; empty is legal alongside supported reasoning. */
  readonly values: readonly string[]
}

/**
 * Reasoning levels decoupled from support. `known=true` with empty
 * `values` means the model reasons without user-selectable grades; it
 * never implies lack of support. `known=false` means no level metadata
 * was declared at all.
 */
export function resolveReasoningLevels(
  selected: SelectedModelRecord | undefined,
  protocol: Protocol,
): ReasoningLevelsResolution {
  const options = selected?.record.reasoning_options
  if (!Array.isArray(options)) return { known: false, values: [] }
  return { known: true, values: buildVariants(selected, protocol).map((variant) => variant.id) }
}

export type SelectionOutcomeKind = "matched" | "unmatched" | "ambiguous"

export interface DetailedSelection {
  readonly outcome: SelectionOutcomeKind
  readonly selected?: SelectedModelRecord
  readonly candidates: readonly string[]
  /** How many provider records matched the deciding candidate. */
  readonly matchCount: number
  /** Provider ids involved when the outcome is ambiguous. */
  readonly ambiguousProviders: readonly string[]
}

function explicitModelsDevProvider(group: DeploymentGroup): string | undefined {
  return group.deployments
    .map((deployment) => optionalString(deployment.modelInfo.models_dev_provider)?.toLowerCase())
    .find((value): value is string => value !== undefined)
}

/**
 * Group-wide explicit provider evidence. Distinct explicit
 * `models_dev_provider` values inside one deployment group mean the host
 * model identity cannot be stated as one fact: that is a conflict, not a
 * first-deployment choice.
 */
export function groupExplicitProviderConflict(group: DeploymentGroup): { providers: string[] } | undefined {
  const declared = [...new Set(
    group.deployments
      .map((deployment) => optionalString(deployment.modelInfo.models_dev_provider)?.toLowerCase())
      .filter((value): value is string => value !== undefined),
  )]
  return declared.length > 1 ? { providers: declared } : undefined
}

/**
 * Routed/base identity ids per deployment (base_model first: it is
 * LiteLLM's own declared upstream identity; the routed param is a route).
 * Deployments without any id cannot be judged and are skipped.
 */
function deploymentIdentityIDs(deployment: { modelInfo: Record<string, unknown>; litellmParams: { model?: unknown } }): string[] {
  const ids: string[] = []
  const base = optionalString(deployment.modelInfo.base_model)
  if (base) ids.push(canonicalModelID(base))
  const routed = optionalString(deployment.litellmParams.model)
  if (routed) {
    const stripped = canonicalModelID(stripRoutePrefix(routed))
    if (stripped.length > 0) ids.push(stripped)
  }
  return [...new Set(ids)]
}

function recordIdentityNames(record: ModelsDevRecord): string[] {
  const names = new Set<string>()
  const add = (value: string | undefined) => {
    if (value) names.add(canonicalModelID(value))
  }
  const id = optionalString(record.id)
  add(id)
  const aliases = Array.isArray(record.aliases)
    ? record.aliases.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  for (const alias of aliases) add(alias)
  for (const target of inheritanceTargets(record)) add(target.includes("/") ? target.slice(target.indexOf("/") + 1) : target)
  return [...names]
}

/**
 * Group identity conflict. Pure over the group and catalog.
 *
 * Returns a reason when deployments provably cannot name the same model:
 * distinct explicit `models_dev_provider` values, or deployment id sets
 * that neither overlap nor are reconciled by metadata equivalence
 * (alias / canonical / equivalent / inherits relations). Absent a
 * conflict the group shares one provable identity and first-vs-later
 * candidate order stops mattering.
 */
export function groupIdentityConflict(group: DeploymentGroup, catalog: unknown): string | undefined {
  const providerConflict = groupExplicitProviderConflict(group)
  if (providerConflict) {
    return `deployments declare different models_dev_provider values (${providerConflict.providers.join(", ")})`
  }
  if (group.deployments.length > 1) {
    const idSets = group.deployments.map(deploymentIdentityIDs).filter((ids) => ids.length > 0)
    if (idSets.length > 1) {
      // Union-find over deployments linked by shared ids or by metadata
      // equivalence between one deployment's ids and another's.
      const links = (a: string[], b: string[]): boolean => {
        if (a.some((id) => b.includes(id))) return true
        for (const id of a) {
          for (const match of matchesForID(id, catalog)) {
            const names = recordIdentityNames(match.record)
            if (b.some((other) => names.includes(other))) return true
          }
        }
        return false
      }
      const parent = idSets.map((_, index) => index)
      const find = (value: number): number => parent[value] === value ? value : (parent[value] = find(parent[value]!))
      for (let i = 0; i < idSets.length; i++) {
        for (let j = i + 1; j < idSets.length; j++) {
          if (links(idSets[i]!, idSets[j]!)) {
            parent[find(i)!] = find(j)!
          }
        }
      }
      const roots = new Set(idSets.map((_, index) => find(index)))
      if (roots.size > 1) {
        return `deployment identities cannot be proven to name the same model (${idSets.map((ids) => ids.join("|")).join(" vs ")})`
      }
    }
  }
  return undefined
}

/** Records matching one candidate id, at most one per provider. */
function matchesForID(id: string, catalog: unknown): SelectedModelRecord[] {
  return providers(catalog).flatMap(([providerID, models]) => {
    const match = findMatch(models, id)
    return match ? [selected(providerID, id, match)] : []
  })
}

/**
 * Detailed models.dev selection outcome.
 *
 * Trusted precedence is explicit provider > canonical-original >
 * OpenRouter > OpenCode > unique match. Name/family heuristics are not a
 * step. Multiple remaining records stay `ambiguous` instead of collapsing
 * into an arbitrary reseller or a name-prefix provider.
 *
 * Group consistency: distinct explicit `models_dev_provider` values, or
 * distinct per-deployment candidate identities that metadata cannot prove
 * equivalent, make the whole group `ambiguous` — never first-deployment
 * wins.
 */
export function selectModelsDevRecordDetailed(
  group: DeploymentGroup,
  catalog: unknown,
): DetailedSelection {
  const candidates = candidateModelIDs(group)
  const allProviders = providers(catalog)

  const identityConflict = groupIdentityConflict(group, catalog)
  if (identityConflict) {
    return {
      outcome: "ambiguous",
      selected: undefined,
      candidates,
      matchCount: 0,
      ambiguousProviders: [...new Set(group.deployments
        .map((deployment) => optionalString(deployment.modelInfo.models_dev_provider))
        .filter((value): value is string => value !== undefined))]
        .sort(),
    }
  }

  for (const candidate of candidates) {
    const matches = allProviders.flatMap(([providerID, models]) => {
      const match = findMatch(models, candidate)
      return match ? [selected(providerID, candidate, match)] : []
    })
    if (matches.length === 0) continue

    const explicitProvider = explicitModelsDevProvider(group)
    if (explicitProvider) {
      const explicit = matches.find((match) => match.providerID.toLowerCase() === explicitProvider)
      if (explicit) return { outcome: "matched", selected: { ...explicit, selectionSource: "explicit-provider" }, candidates, matchCount: matches.length, ambiguousProviders: [] }
    }

    const canonicalProviders = canonicalProviderCandidates(matches)
    if (canonicalProviders.length === 1) {
      const original = matches.find(
        (match) => match.providerID.toLowerCase() === canonicalProviders[0],
      )
      if (original) return { outcome: "matched", selected: { ...original, selectionSource: "canonical-original" }, candidates, matchCount: matches.length, ambiguousProviders: [] }
    }

    const openRouter = matches.find((match) => match.providerID.toLowerCase() === "openrouter")
    if (openRouter) return { outcome: "matched", selected: { ...openRouter, selectionSource: "openrouter-fallback" }, candidates, matchCount: matches.length, ambiguousProviders: [] }
    const openCode = matches.find((match) => match.providerID.toLowerCase() === "opencode")
    if (openCode) return { outcome: "matched", selected: { ...openCode, selectionSource: "opencode-fallback" }, candidates, matchCount: matches.length, ambiguousProviders: [] }

    if (matches.length === 1) return { outcome: "matched", selected: { ...matches[0]!, selectionSource: "unique-match" }, candidates, matchCount: matches.length, ambiguousProviders: [] }

    return {
      outcome: "ambiguous",
      selected: undefined,
      candidates,
      matchCount: matches.length,
      ambiguousProviders: [...new Set(matches.map((match) => match.providerID))].sort(),
    }
  }

  return { outcome: "unmatched", selected: undefined, candidates, matchCount: 0, ambiguousProviders: [] }
}

/**
 * Tri-state aggregation for one capability across deployments.
 *
 * `undefined` is unknown, not a value that can be dropped. A missing
 * deployment declaration therefore cannot turn the group into supported
 * or unsupported. Model-level evidence fills only an entirely unevidenced
 * group; an explicit deployment disagreement with that evidence stays a
 * conflict.
 */
export function aggregateTriState(
  deploymentValues: readonly (boolean | undefined)[],
  modelLevel?: boolean,
): { state: CapabilityState; conflict: boolean; source: "litellm" | "models.dev" | "derived" | "default" } {
  const defined = deploymentValues.filter((value): value is boolean => value !== undefined)
  const hasUnknown = deploymentValues.some((value) => value === undefined)
  const agreesWithModel = modelLevel === undefined || defined.every((value) => value === modelLevel)
  const deploymentConflict = defined.some((value) => value === true) && defined.some((value) => value === false)
  const modelConflict = modelLevel !== undefined && defined.some((value) => value !== modelLevel)

  if (defined.length === 0) {
    if (modelLevel === true) return { state: "supported", conflict: false, source: "models.dev" }
    if (modelLevel === false) return { state: "unsupported", conflict: false, source: "models.dev" }
    return { state: "unknown", conflict: false, source: "default" }
  }
  if (deploymentConflict || hasUnknown || !agreesWithModel) {
    return {
      state: "unknown",
      conflict: deploymentConflict || modelConflict,
      source: modelLevel === undefined ? "litellm" : "derived",
    }
  }
  return {
    state: defined[0] === true ? "supported" : "unsupported",
    conflict: false,
    // All deployments declared and agreed; a corroborating model-level
    // record means litellm and models.dev agree — provenance still names
    // the endpoint declarations as the group evidence.
    source: "litellm",
  }
}

export interface InheritedRecord {
  /** Effective record after deterministic inheritance. */
  readonly record: ModelsDevRecord
  /** Provenance chain, e.g. `canonical: xiaomi/mimo-v2.6-pro`. */
  readonly chain: readonly string[]
  /** Field names inherited from another declared identity. */
  readonly inheritedFields: readonly string[]
}

function lookupProviderModels(catalog: unknown, providerID: string): Record<string, unknown> | undefined {
  if (!isRecord(catalog)) return undefined
  const provider = catalog[providerID]
  if (!isRecord(provider) || !isRecord(provider.models)) {
    const lower = providerID.toLowerCase()
    for (const [key, value] of Object.entries(catalog)) {
      if (key.toLowerCase() === lower && isRecord(value) && isRecord(value.models)) {
        return value.models as Record<string, unknown>
      }
    }
    return undefined
  }
  return provider.models as Record<string, unknown>
}

function inheritanceTargets(record: ModelsDevRecord): string[] {
  const targets: string[] = []
  const push = (value: unknown) => {
    if (typeof value === "string" && value.includes("/")) targets.push(value)
  }
  push(record.canonical_model_id)
  push(record.inherits)
  const equivalent = (record as Record<string, unknown>).equivalent_to
  if (typeof equivalent === "string") push(equivalent)
  else if (Array.isArray(equivalent)) for (const item of equivalent) push(item)
  const equivalents = (record as Record<string, unknown>).equivalents
  if (Array.isArray(equivalents)) for (const item of equivalents) push(item)
  return [...new Set(targets)]
}

const INHERITABLE_FIELDS = [
  "reasoning",
  "reasoning_options",
  "modalities",
  "limit",
  "tool_call",
  "cost",
  "release_date",
] as const

/**
 * Deterministic capability inheritance.
 *
 * Only metadata-expressed relations (`canonical_model_id`,
 * `inherits`, `equivalent_to` / `equivalents` naming a
 * `provider/model` identity) may supply missing fields. Name similarity,
 * family membership, or neighbor-model values never inherit. Every
 * inherited field is reported so provenance can name its source.
 */
export function resolveInheritedRecord(
  selected: SelectedModelRecord | undefined,
  catalog: unknown,
): InheritedRecord | undefined {
  if (!selected) return undefined
  const chain: string[] = []
  const inheritedFields: string[] = []
  const merged: Record<string, unknown> = { ...selected.record }

  for (const target of inheritanceTargets(selected.record)) {
    const slash = target.indexOf("/")
    if (slash <= 0) continue
    const providerID = target.slice(0, slash)
    const modelRef = target.slice(slash + 1)
    const models = lookupProviderModels(catalog, providerID)
    if (!models) continue
    const match = findMatch(models, modelRef)
    if (!match || !isRecord(match[1])) continue
    const source = match[1] as Record<string, unknown>
    const label = `${providerID}/${match[0]}`
    for (const field of INHERITABLE_FIELDS) {
      if (merged[field] !== undefined) continue
      if (source[field] === undefined) continue
      merged[field] = source[field]
      inheritedFields.push(field)
    }
    if (inheritedFields.length > 0) chain.push(`canonical: ${label}`)
    if (inheritedFields.length > 0) break
  }

  if (inheritedFields.length === 0) return undefined
  return {
    record: merged as ModelsDevRecord,
    chain,
    inheritedFields: [...new Set(inheritedFields)],
  }
}
