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
  reasoning?: unknown
  release_date?: unknown
  modalities?: unknown
  limit?: unknown
  cost?: unknown
  tool_call?: unknown
  reasoning_options?: unknown
}

export type ModelsDevMatchKind = "exact" | "canonical" | "alias"

export interface SelectedModelRecord {
  providerID: string
  modelID: string
  record: ModelsDevRecord
  matchedCandidate?: string
  matchKind?: ModelsDevMatchKind
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

interface FamilyProviders {
  primary: string
  alternatives: string[]
}

const FAMILY_RULES: Array<[RegExp, FamilyProviders]> = [
  [/^(?:gpt-|o\d|.*codex)/, { primary: "openai", alternatives: [] }],
  [/^claude-/, { primary: "anthropic", alternatives: [] }],
  [/^gemini-/, { primary: "google", alternatives: [] }],
  [/^grok-/, { primary: "xai", alternatives: [] }],
  [/^glm-/, { primary: "zai", alternatives: ["zhipuai"] }],
  [/^deepseek-/, { primary: "deepseek", alternatives: [] }],
  [/^kimi-/, { primary: "moonshotai", alternatives: ["moonshotai-cn"] }],
  [/^mimo-/, { primary: "xiaomi", alternatives: [] }],
  [/^minimax-/, { primary: "minimax", alternatives: ["minimax-cn"] }],
  [/^qwen/, { primary: "alibaba", alternatives: ["alibaba-cn"] }],
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

export function familyProviders(group: DeploymentGroup): FamilyProviders | undefined {
  for (const deployment of group.deployments) {
    const explicit = optionalString(deployment.modelInfo.models_dev_provider)
    if (explicit) return { primary: explicit, alternatives: [] }
  }

  for (const candidate of candidateModelIDs(group)) {
    const normalized = canonicalModelID(candidate)
    const match = FAMILY_RULES.find(([pattern]) => pattern.test(normalized))
    if (match) return match[1]
  }
  return undefined
}

function selected(
  providerID: string,
  candidate: string,
  match: [string, ModelsDevRecord, ModelsDevMatchKind],
): SelectedModelRecord {
  return {
    providerID,
    modelID: match[0],
    record: match[1],
    matchedCandidate: candidate,
    matchKind: match[2],
  }
}

export function selectModelsDevRecord(
  group: DeploymentGroup,
  catalog: unknown,
): SelectedModelRecord | undefined {
  const allProviders = providers(catalog)
  const family = familyProviders(group)
  const preferred = family ? [family.primary, ...family.alternatives] : []

  for (const candidate of candidateModelIDs(group)) {
    // Prefer the original provider when Core can identify it from explicit
    // metadata or a well-known family. When that is unavailable, prefer
    // broadly useful capability catalogs in a stable order instead of
    // declaring same-name multi-provider records ambiguous immediately.
    const fallbackProviders = [...preferred, "openrouter", "opencode"]
    const seenProviders = new Set<string>()
    for (const providerID of fallbackProviders) {
      const normalized = providerID.toLowerCase()
      if (seenProviders.has(normalized)) continue
      seenProviders.add(normalized)
      const provider = allProviders.find(([id]) => id.toLowerCase() === normalized)
      if (!provider) continue
      const match = findMatch(provider[1], candidate)
      if (match) return selected(provider[0], candidate, match)
    }

    const matches = allProviders.flatMap(([providerID, models]) => {
      const match = findMatch(models, candidate)
      return match ? [selected(providerID, candidate, match)] : []
    })
    if (matches.length === 1) return matches[0]
  }

  return undefined
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
  const modelsDev = modelsDevReasoning(selected)
  const explicit = group.deployments.map((deployment) =>
    optionalBoolean(deployment.modelInfo.supports_reasoning)
  )
  const conflict = modelsDev !== undefined &&
    explicit.some((value) => value !== undefined && value !== modelsDev)
  const supported = explicit.every((value) => value ?? modelsDev ?? false)

  if (explicit.every((value) => value !== undefined)) {
    return { supported, source: "litellm", conflict }
  }
  if (explicit.every((value) => value === undefined) && modelsDev !== undefined) {
    return { supported, source: "models.dev", conflict }
  }
  if (explicit.some((value) => value !== undefined) || modelsDev !== undefined) {
    return { supported, source: "derived", conflict }
  }
  return { supported: false, source: "default", conflict: false }
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
