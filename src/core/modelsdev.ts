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

export type ModelsDevMatchKind =
  | "exact"
  | "canonical"
  | "alias"
  /** Matched through a deterministic metadata relation (canonical_model_id / base_model). */
  | "relation"

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
  /**
   * Canonical identity the matched record declares via a deterministic
   * relation (`canonical_model_id` ?? `base_model`), when present. Used to
   * prove canonical-original selection; never a name heuristic.
   */
  recordCanonicalID?: string
}

/**
 * Whether provider-scoped models.dev pricing can be treated as a plausible
 * fallback for the deployed model. Gateway/reseller records selected only for
 * capability enrichment must never masquerade as the LiteLLM route price.
 */
export function canUseSelectedModelsDevPrice(selected: SelectedModelRecord | undefined): boolean {
  // Undefined is kept for backwards-compatible direct callers/tests that
  // construct SelectedModelRecord manually without going through the selector.
  if (selected?.selectionSource === undefined) return true
  // Canonical-original records, and explicit-provider records whose own
  // metadata carries the deterministic canonical relation, may serve as a
  // plausible price fallback. Unique trusted matches and reseller fallbacks
  // must never masquerade as the LiteLLM route price; an explicit provider
  // choice without a canonical relation proof proves only which record was
  // selected, not that its price describes the deployed model's own origin.
  if (selected.selectionSource === "canonical-original") return true
  if (selected.selectionSource === "explicit-provider") {
    return selected.recordCanonicalID !== undefined
  }
  return false
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

/**
 * Relation-kind for a metadata-declared identity link between a record and
 * the candidate it serves. `relation` entries carry the record's declared
 * canonical identity so precedence can prove an original provider.
 */
const RELATION_KIND: ModelsDevMatchKind = "relation"

/**
 * All provider-scoped records that serve the candidate: direct key/id/alias
 * matches plus records whose deterministic relation (`canonical_model_id` /
 * `base_model`) points at the candidate. Relation matching compares declared
 * metadata values only — never name prefixes, families, or catalog order.
 *
 * `kind: "relation"` results carry `recordCanonicalID` (the declared
 * relation value) so selection can prove namespace identity.
 */
function findMatchesByRelation(
  models: Record<string, unknown>,
  candidate: string,
): Array<[string, ModelsDevRecord, ModelsDevMatchKind, string?]> {
  const results: Array<[string, ModelsDevRecord, ModelsDevMatchKind, string?]> = []
  const candidateName = identityNodeID(stripRoutePrefix(candidate.trim()))
  if (!candidateName) return results
  const raw = stripRoutePrefix(candidate.trim()).toLowerCase()
  const canonicalCandidate = canonicalModelID(candidate)
  const seen = new Set<ModelsDevRecord>()
  for (const [key, value] of Object.entries(models)) {
    if (!isRecord(value)) continue
    const record = value as ModelsDevRecord
    const targets = relationTargets(record)
    const canonical = targets.canonical
    const id = optionalString(record.id) ?? key
    // Direct match: key, declared id, or alias equals the candidate. Every
    // matching record is collected (review finding 4: a provider may hold
    // several serving records for one candidate; object order never picks).
    const aliases = recordAliases(key, record)
    const primary = optionalString(record.id) ?? key
    const rawAlias = aliases.find((alias) => stripRoutePrefix(alias.trim()).toLowerCase() === raw)
    const canonicalAlias = rawAlias ?? aliases.find((alias) => canonicalModelID(alias) === canonicalCandidate)
    if (canonicalAlias !== undefined && !seen.has(record)) {
      seen.add(record)
      const isPrimary = canonicalAlias === key || canonicalAlias === primary
      const kind: ModelsDevMatchKind = rawAlias !== undefined
        ? isPrimary ? "exact" : "alias"
        : isPrimary ? "canonical" : "alias"
      // A direct match whose record itself declares a canonical relation
      // keeps that declaration: the record serving the candidate under its
      // own name is itself proof of the canonical identity it names.
      results.push(canonical ? [id, record, RELATION_KIND, canonical] : [id, record, kind])
      continue
    }
    if (!canonical) continue
    // Relation match: the declared relation names the candidate identity.
    const slash = canonical.indexOf("/")
    // A namespaced declaration qualifies by its model part; the record's own
    // provider namespace is expressed by the providerID, not by this value.
    const declaredName = identityNodeID(stripRoutePrefix((slash > 0 ? canonical.slice(slash + 1) : canonical).trim()))
    if (!declaredName || declaredName !== candidateName) continue
    if (seen.has(record)) continue
    seen.add(record)
    results.push([id, record, RELATION_KIND, canonical])
  }
  return results
}

/**
 * Deterministic canonical relations a provider-scoped record may declare to
 * point at the canonical model it serves.
 *
 * `canonical_model_id` is the canonical namespace proof (`deepseek/deepseek-v4.1-flash`
 * names both the provider namespace and the canonical model). `base_model` is the
 * same family of relation ("this record serves that upstream model") without
 * encoding the namespace; matching compares its model part only.
 * `inherits` / `equivalent_to` / `equivalents` are identity relations without a
 * canonical-namespace meaning and never prove an original provider by themselves.
 */
export interface RecordRelationTargets {
  /** Preferred canonical identity the record declares, route prefix kept. */
  readonly canonical?: string
  /** Additional identity relation targets, route-prefixed values only. */
  readonly other: readonly string[]
}

export function relationTargets(record: ModelsDevRecord): RecordRelationTargets {
  const canonical = optionalString(record.canonical_model_id) ??
    optionalString((record as Record<string, unknown>).base_model)
  return { canonical, other: inheritanceTargets(record) }
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
 * relations: explicit `models_dev_provider`, deterministic canonical
 * relations (`canonical_model_id` / `base_model`) with a namespace proof,
 * alias / equivalent / inherits metadata consumed by matching, OpenCode,
 * OpenRouter, or a genuinely unique remaining record.
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

/**
 * Trusted model-level reasoning evidence: explicit `reasoning`, else the
 * presence of `reasoning_options`. `undefined` means the record declares
 * nothing. Exported so LKG conflict detection consumes the same source
 * extraction instead of re-deriving it.
 */
export function modelsDevReasoning(selected: SelectedModelRecord | undefined): boolean | undefined {
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
 * Normalized identity node used by group identity reconciliation.
 *
 * Unlike `canonicalModelID` (record matching), this keeps the provider
 * namespace: `openai/foo`, `anthropic/foo`, and an unqualified `foo` are
 * three distinct identities until deterministic metadata proves them the
 * same. Never strips a `/` prefix here.
 */
function identityNodeID(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-")
}

/**
 * Routed/base identity ids per deployment (base_model first: it is
 * LiteLLM's own declared upstream identity; the routed param is a route).
 *
 * Provider semantics are preserved:
 * - a qualified name keeps its namespace (`openai/foo` stays `openai/foo`);
 * - an unqualified name stays unqualified (`foo`);
 * - an explicit `models_dev_provider` is the deterministic namespace proof
 *   for that deployment, so its names qualify as `<provider>/<name>` and a
 *   pure route prefix never masquerades as an identity.
 *
 * An empty result means the deployment carries no identity evidence at
 * all; callers must treat that as identity-unknown, never as skippable.
 */
function deploymentIdentityIDs(deployment: { modelInfo: Record<string, unknown>; litellmParams: { model?: unknown } }): string[] {
  const declaredProvider = optionalString(deployment.modelInfo.models_dev_provider)
  const provider = declaredProvider !== undefined ? identityNodeID(declaredProvider) : undefined
  const ids: string[] = []
  const push = (raw: string | undefined) => {
    const trimmed = raw?.trim()
    if (!trimmed) return
    const name = identityNodeID(stripRoutePrefix(trimmed))
    if (!name) return
    if (provider) {
      ids.push(`${provider}/${name}`)
      return
    }
    const slash = trimmed.indexOf("/")
    const namespace = slash > 0 ? identityNodeID(trimmed.slice(0, slash)) : ""
    ids.push(namespace ? `${namespace}/${name}` : name)
  }
  push(optionalString(deployment.modelInfo.base_model))
  push(optionalString(deployment.litellmParams.model))
  return [...new Set(ids)]
}

export type GroupIdentityStatus = "known" | "unknown" | "conflict"

/**
 * Group-wide identity evidence. Identity is publication-critical like
 * every other capability: the absence of a detected conflict is NOT
 * proof of identity.
 *
 * - `known`: every deployment carries positive identity evidence and all
 *   ids reconcile into one component. `identity` is deterministic and
 *   order-independent — the sorted union of every deployment's
 *   provider-aware ids, joined by `|`. It preserves provider namespaces
 *   (`openai/foo` never collapses to `foo`) and is never derived from
 *   `model_name`, family names, or a sibling deployment's evidence.
 * - `unknown`: one or more deployments declare no identity at all
 *   (no route, no base model, no deterministic provider proof).
 * - `conflict`: deployments provably cannot name the same model.
 *
 * The same evidence serves live selection/publication and LKG
 * capture/restore, so provider-aware publication and LKG matching can
 * never drift apart.
 */
export interface GroupIdentityEvidence {
  readonly status: GroupIdentityStatus
  /** Deterministic stable identity; defined iff `status === "known"`. */
  readonly identity?: string
  /** Why the group cannot be trusted; defined for unknown/conflict. */
  readonly reason?: string
}

/**
 * Group identity evidence. Pure over the group and catalog.
 *
 * Reconciliation runs on the identity equivalence graph: nodes are
 * normalized identity strings (provider namespace preserved), edges come
 * from deployment declarations plus catalog relations
 * (`canonical_model_id`, `aliases`, `equivalent_to`, `equivalents`,
 * `inherits`). Connectivity is symmetric, so the verdict never depends
 * on deployment array order nor on which side of a relation stores the
 * declaration. The graph proves identity membership only — capability
 * values never inherit through it.
 */
export function groupIdentityEvidence(group: DeploymentGroup, catalog: unknown): GroupIdentityEvidence {
  const providerConflict = groupExplicitProviderConflict(group)
  if (providerConflict) {
    return {
      status: "conflict",
      reason: `deployments declare different models_dev_provider values (${providerConflict.providers.join(", ")})`,
    }
  }
  // Every deployment must carry positive identity evidence; an
  // identity-less member is never filtered out of the judgment.
  const idSets = group.deployments.map(deploymentIdentityIDs)
  const identityLess = idSets.filter((ids) => ids.length === 0).length
  if (identityLess > 0) {
    return {
      status: "unknown",
      reason: `one or more deployments have no provable identity (${identityLess} of ${idSets.length} deployments declare no route, base model, or deterministic provider proof)`,
    }
  }
  const stableIdentity = [...new Set(idSets.flat())].sort().join("|")
  if (idSets.length <= 1) {
    return { status: "known", identity: stableIdentity }
  }

  // Union-find over identity strings. Node identity is the normalized
  // string itself, so a deployment id and a catalog record/target with the
  // same qualified name are the same node without any directionality.
  const parent: number[] = []
  const index = new Map<string, number>()
  const node = (id: string): number => {
    const found = index.get(id)
    if (found !== undefined) return found
    const created = parent.length
    parent.push(created)
    index.set(id, created)
    return created
  }
  const find = (value: number): number => (parent[value] === value ? value : (parent[value] = find(parent[value]!)))
  const union = (left: number, right: number): void => {
    const rootLeft = find(left)
    const rootRight = find(right)
    if (rootLeft !== rootRight) parent[rootLeft] = rootRight
  }
  const link = (left: string | undefined, right: string | undefined): void => {
    if (left && right && left !== right) union(node(left), node(right))
  }

  // Catalog metadata relations. Each record's qualified identity links to
  // its aliases and to relation targets; targets keep their namespace as
  // written (`vendor/foo` never collapses to `foo`). Unqualified alias
  // names qualify with the record's own provider, so an alias can never
  // bridge two different providers' names by accident.
  for (const [providerID, models] of providers(catalog)) {
    const namespace = identityNodeID(providerID)
    if (!namespace) continue
    for (const [key, value] of Object.entries(models)) {
      if (!isRecord(value)) continue
      const primary = identityNodeID(optionalString(value.id) ?? key)
      if (!primary) continue
      const recordNode = `${namespace}/${primary}`
      node(recordNode)
      const aliasKey = identityNodeID(key)
      if (aliasKey && aliasKey !== primary) link(recordNode, `${namespace}/${aliasKey}`)
      if (Array.isArray(value.aliases)) {
        for (const alias of value.aliases) {
          if (typeof alias !== "string") continue
          const trimmed = alias.trim()
          const name = identityNodeID(stripRoutePrefix(trimmed))
          if (!name) continue
          const slash = trimmed.indexOf("/")
          const aliasNamespace = slash > 0 ? identityNodeID(trimmed.slice(0, slash)) : namespace
          link(recordNode, `${aliasNamespace}/${name}`)
        }
      }
      for (const target of inheritanceTargets(value)) {
        const slash = target.indexOf("/")
        if (slash <= 0) continue
        const targetName = identityNodeID(target.slice(slash + 1))
        if (!targetName) continue
        link(recordNode, `${identityNodeID(target.slice(0, slash))}/${targetName}`)
      }
    }
  }

  // A deployment's own declarations jointly identify it: one hub node
  // unions its ids, so shared-id and metadata edges reconcile deployments
  // regardless of array order.
  const hubs = idSets.map((ids, position) => {
    const hub = node(` deployment#${position}`)
    for (const id of ids) union(hub, node(id))
    return hub
  })

  const roots = new Set(hubs.map((hub) => find(hub)))
  if (roots.size > 1) {
    return {
      status: "conflict",
      reason: `deployment identities cannot be proven to name the same model (${idSets.map((ids) => ids.join("|")).join(" vs ")})`,
    }
  }
  return { status: "known", identity: stableIdentity }
}

/**
 * Compatibility wrapper over `groupIdentityEvidence`: any non-known
 * state blocks trusted identity the same way. Prefer the evidence form
 * when the unknown/conflict distinction matters.
 */
export function groupIdentityConflict(group: DeploymentGroup, catalog: unknown): string | undefined {
  const evidence = groupIdentityEvidence(group, catalog)
  return evidence.status === "known" ? undefined : evidence.reason
}

/**
 * Detailed models.dev selection outcome.
 *
 * Trusted precedence is explicit provider > canonical-original >
 * OpenCode > OpenRouter > unique match. Name/family heuristics are not a
 * step. Multiple remaining records stay `ambiguous` instead of collapsing
 * into an arbitrary reseller or a name-prefix provider.
 *
 * Canonical Model Identity and Metadata Provider Selection are separate
 * concerns: the identity of the deployment group comes from the
 * deployments' own deterministic evidence (see `groupIdentityEvidence`),
 * while this function only chooses which provider-scoped record serves as
 * the enrichment source. A fallback record never rewrites the canonical
 * identity.
 *
 * Canonical-original proof = a deterministic canonical relation
 * (`canonical_model_id` / `base_model`) pointing at the canonical identity
 * AND the record's provider namespace equal to the canonical namespace. A
 * reseller (OpenRouter, OpenCode, ...) may relation-point at the canonical
 * model - that proves which canonical model it serves, never that it is
 * the original provider.
 *
 * Group consistency: distinct explicit `models_dev_provider` values,
 * deployment identities that metadata cannot prove equivalent, or any
 * deployment with no positive identity evidence, make the whole group
 * `ambiguous` — never first-deployment wins, and never a silent pass
 * because no conflict was detected.
 */
export function selectModelsDevRecordDetailed(
  group: DeploymentGroup,
  catalog: unknown,
): DetailedSelection {
  const candidates = candidateModelIDs(group)
  const allProviders = providers(catalog)
  const decided = decideTrustedSelection(group, candidates, allProviders, catalog)
  if (decided) return decided
  return { outcome: "unmatched", selected: undefined, candidates, matchCount: 0, ambiguousProviders: [] }
}

/**
 * Walk the deterministic candidate order and select one trusted record.
 * `undefined` means no candidate produced any provider match (`unmatched`).
 */
function decideTrustedSelection(
  group: DeploymentGroup,
  candidates: readonly string[],
  allProviders: Array<[string, Record<string, unknown>]>,
  catalog: unknown,
): DetailedSelection | undefined {
  const identityEvidence = groupIdentityEvidence(group, catalog)
  if (identityEvidence.status !== "known") {
    // Identity-incomplete groups (`unknown`) and unprovable/conflicting
    // groups both stay `ambiguous`: no detected conflict is not proof of
    // identity, and never first-deployment wins.
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
    const matches = allProviders.flatMap(([providerID, models]) =>
      findMatchesByRelation(models, candidate).map(([modelID, record, matchKind, recordCanonicalID]) => ({
        providerID,
        candidate,
        modelID,
        record,
        matchKind,
        recordCanonicalID,
      })),
    )
    if (matches.length === 0) continue

    const decision = selectTrustedRecord(group, candidate, matches)
    return {
      outcome: decision.outcome,
      selected: decision.selection,
      candidates,
      matchCount: matches.length,
      ambiguousProviders: decision.ambiguousProviders ?? [],
    }
  }
  return undefined
}

interface CandidateMatch {
  readonly providerID: string
  readonly candidate: string
  readonly modelID: string
  readonly record: ModelsDevRecord
  readonly matchKind: ModelsDevMatchKind
  readonly recordCanonicalID?: string
}

interface TrustedDecision {
  readonly outcome: SelectionOutcomeKind
  readonly selection?: SelectedModelRecord
  readonly ambiguousProviders?: readonly string[]
}

/**
 * Deterministically pick the trusted record for one candidate match set.
 *
 * Every step compares record-intrinsic facts or metadata proofs - never
 * catalog iteration order. The final tie-break (`localeCompare` on ids)
 * exists to keep the result total and reproducible; the candidates it
 * disambiguates are provably equivalent enrichment records.
 */
function selectTrustedRecord(group: DeploymentGroup, candidate: string, matches: CandidateMatch[]): TrustedDecision {
  // 1. Explicit provider proof always wins.
  const explicitProvider = explicitModelsDevProvider(group)
  if (explicitProvider) {
    const explicit = resolveSingleProviderMatches(
      matches.filter((match) => match.providerID.toLowerCase() === explicitProvider),
    )
    // An explicitly proven provider whose own records conflict stays
    // unresolved: the explicit proof picks a provider, never a winner among
    // materially different records.
    if (explicit === undefined) {
      return { outcome: "ambiguous", ambiguousProviders: [explicitProvider] }
    }
    return { outcome: "matched", selection: toSelected(explicit, "explicit-provider") }
  }

  // 2. Canonical/original provider: deterministic relation pointing at the
  // canonical identity plus provider namespace == canonical namespace.
  const original = canonicalOriginalRecord(candidate, matches, deploymentQualifiedNamespaces(group))
  if (original === "conflict") {
    // Original-provider candidates exist but their publication-critical
    // facts conflict with no rule to rank them: fail closed for this
    // candidate instead of letting a lower-precedence reseller record win.
    return { outcome: "ambiguous", ambiguousProviders: [canonicalNamespaceFor(candidate, matches) ?? "canonical-original"] }
  }
  if (original) {
    return { outcome: "matched", selection: toSelected(original, "canonical-original") }
  }

  // 3./4. Reseller fallback: OpenCode before OpenRouter.
  const openCode = resolveSingleProviderMatches(
    matches.filter((match) => match.providerID.toLowerCase() === "opencode"),
  )
  const openRouter = resolveSingleProviderMatches(
    matches.filter((match) => match.providerID.toLowerCase() === "openrouter"),
  )
  if (openCode !== undefined) {
    return { outcome: "matched", selection: toSelected(openCode, "opencode-fallback") }
  }
  if (openRouter !== undefined) {
    return { outcome: "matched", selection: toSelected(openRouter, "openrouter-fallback") }
  }

  // 5. A genuinely unique remaining trusted provider.
  const distinctProviders = [...new Set(matches.map((match) => match.providerID))]
  if (distinctProviders.length === 1) {
    const sole = resolveSingleProviderMatches(matches)
    // The provider is unique, but its records must still agree; a solo
    // provider with materially different records stays unresolved instead
    // of letting object iteration order pick one (review finding 4).
    if (sole === undefined) {
      return { outcome: "ambiguous", ambiguousProviders: distinctProviders.sort() }
    }
    return { outcome: "matched", selection: toSelected(sole, "unique-match") }
  }

  // 6. Multiple providers nobody can rank: stay unresolved.
  return { outcome: "ambiguous", ambiguousProviders: distinctProviders.sort() }
}

/**
 * Deterministically pick one record from a single provider's matches, or
 * `undefined` when the records cannot be ranked.
 *
 * Records whose publication-critical facts are provably identical are
 * equivalent enrichment sources; the deterministic tie (deprecated count ->
 * shortest model id -> localeCompare) stays total and independent of
 * `models` object order. Records that materially differ in serving
 * metadata have no rule proving which one describes the host's usage, so
 * the whole set fails closed (`undefined`) instead of picking arbitrarily.
 */
function resolveSingleProviderMatches(providerMatches: readonly CandidateMatch[]): CandidateMatch | undefined {
  if (providerMatches.length === 0) return undefined
  if (providerMatches.length === 1) return providerMatches[0]
  const equivalents = providerMatches.filter((match) =>
    providerMatches.every((other) => publicationEquivalent(match, other)),
  )
  if (equivalents.length !== providerMatches.length) return undefined
  const [best] = providerMatches
    .map((match, index) => ({ match, index, status: optionalString((match.record as Record<string, unknown>).status) }))
    .map((item) => ({ ...item, deprecated: item.status === "deprecated" ? 1 : 0 }))
    .sort((left, right) => {
      if (left.deprecated !== right.deprecated) return left.deprecated - right.deprecated
      const byLength = left.match.modelID.length - right.match.modelID.length
      if (byLength !== 0) return byLength
      if (left.match.modelID !== right.match.modelID) {
        return left.match.modelID.localeCompare(right.match.modelID, "en")
      }
      return left.index - right.index
    })
  return best?.match
}

/**
 * Whether two records declare the same publication-critical facts. Cost,
 * release dates, and presentation-only fields never participate: they do
 * not reach the published capability facts.
 */
function publicationEquivalent(left: CandidateMatch, right: CandidateMatch): boolean {
  return JSON.stringify(publicationCriticalFacts(left)) === JSON.stringify(publicationCriticalFacts(right))
}

function publicationCriticalFacts(match: CandidateMatch): unknown {
  const record = match.record as Record<string, unknown>
  return {
    limit: record.limit ?? null,
    modalities: record.modalities ?? null,
    tool_call: record.tool_call ?? null,
    reasoning: record.reasoning ?? null,
    reasoning_options: record.reasoning_options ?? null,
    canonical: match.recordCanonicalID ?? null,
  }
}

function toSelected(match: CandidateMatch, selectionSource: ModelsDevSelectionSource): SelectedModelRecord {
  const result: SelectedModelRecord = {
    providerID: match.providerID,
    modelID: match.modelID,
    record: match.record,
    matchedCandidate: match.candidate,
    matchKind: match.matchKind,
    selectionSource,
  }
  if (match.recordCanonicalID !== undefined) result.recordCanonicalID = match.recordCanonicalID
  return result
}

/**
 * Prove the original provider for one candidate match set.
 *
 * Namespace-first: the canonical namespace comes from the candidate's own
 * `namespace/model` form when available (e.g. the routed
 * `deepseek/deepseek-v4.1-flash`); a bare `base_model: deepseek-v4.1-flash`
 * declaration has no embedded namespace and never proves a namespace by
 * itself. When no qualified candidate exists, a relation declaration
 * written `namespace/model` may prove the namespace only if every
 * relation-match in the set agrees on that one namespace.
 *
 * The record's provider ID must equal the canonical namespace. This also
 * rejects resellers: their provider ID differs from the canonical
 * namespace even when their relation points at the same canonical model.
 *
 * Several official records may legitimately serve one canonical model
 * (serving SKUs, deprecated forms). They are ranked deterministically:
 * fewer `status: deprecated` records first, then the shortest model id,
 * then `localeCompare`. Every step compares record-intrinsic facts, so
 * catalog object order never matters.
 */
/**
 * The namespaces provable from the deployments' own identity declarations
 * (`openai/foo` routed identity, explicit `models_dev_provider`). A
 * relation-less record may be the original only when the canonical namespace
 * is one of these -- never when the namespace was borrowed from another
 * provider's relation (review finding 6).
 */
function deploymentQualifiedNamespaces(group: DeploymentGroup): ReadonlySet<string> {
  const namespaces = new Set<string>()
  for (const deployment of group.deployments) {
    const declaredProvider = optionalString(deployment.modelInfo.models_dev_provider)
    if (declaredProvider) namespaces.add(identityNodeID(declaredProvider))
    for (const id of deploymentIdentityIDs(deployment)) {
      const slash = id.indexOf("/")
      if (slash > 0) namespaces.add(identityNodeID(id.slice(0, slash)))
    }
  }
  return namespaces
}

function canonicalOriginalRecord(
  candidate: string,
  matches: CandidateMatch[],
  deploymentQualifiedNamespaces: ReadonlySet<string>,
): CandidateMatch | undefined | "conflict" {
  const canonicalNamespace = canonicalNamespaceFor(candidate, matches)
  if (!canonicalNamespace) return undefined
  // A relation-less record qualifies as the original only when the canonical
  // namespace is proven by the deployment's own evidence, never from another
  // provider's declared relation: a reseller's relation speaks for the
  // reseller's record only (review finding 6).
  const originals = matches.filter((match) =>
    match.providerID.toLowerCase() === canonicalNamespace &&
    (match.recordCanonicalID !== undefined || deploymentQualifiedNamespaces.has(canonicalNamespace)),
  )
  // Same provider + multiple matching records follows the frozen rule for
  // every selection path: publication-critical facts provably equivalent ->
  // deterministic tie-break (deprecated count -> modelID length ->
  // localeCompare); materially different serving facts -> fail closed
  // (review blocker 2). The tie-break below runs on equivalent records only,
  // so catalog object order never decides between different serving facts.
  const equivalents = originals.filter((match) =>
    originals.every((other) => publicationEquivalent(match, other)),
  )
  if (equivalents.length !== originals.length) return "conflict"
  const [best] = originals
    .map((match, index) => ({
      match,
      index,
      status: optionalString((match.record as Record<string, unknown>).status),
      deprecated: 0,
    }))
    .map((item) => ({ ...item, deprecated: item.status === "deprecated" ? 1 : 0 }))
    .sort((left, right) => {
      if (left.deprecated !== right.deprecated) return left.deprecated - right.deprecated
      const byLength = left.match.modelID.length - right.match.modelID.length
      if (byLength !== 0) return byLength
      if (left.match.modelID !== right.match.modelID) {
        return left.match.modelID.localeCompare(right.match.modelID, "en")
      }
      return left.index - right.index
    })
  return best?.match
}

/**
 * The canonical namespace for one candidate match set.
 *
 * Proven from the candidate's own `namespace/model` form when available
 * (e.g. routed `deepseek/deepseek-v4.1-flash`); otherwise from the
 * declared relation values when they agree on a single namespace.
 */
function canonicalNamespaceFor(candidate: string, matches: readonly CandidateMatch[]): string | undefined {
  const slash = candidate.indexOf("/")
  if (slash > 0) {
    const namespace = identityNodeID(candidate.slice(0, slash))
    if (namespace) return namespace
  }
  const declaredNamespaces = new Set<string>()
  for (const match of matches) {
    if (match.matchKind !== "relation" || match.recordCanonicalID === undefined) continue
    const declared = match.recordCanonicalID.indexOf("/")
    if (declared > 0) declaredNamespaces.add(identityNodeID(match.recordCanonicalID.slice(0, declared)))
  }
  return declaredNamespaces.size === 1 ? [...declaredNamespaces][0] : undefined
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
