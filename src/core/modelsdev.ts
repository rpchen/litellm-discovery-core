/**
 * Host-independent models.dev record selection and reasoning variant extraction.
 *
 * Canonical catalog model (D3–D5):
 * - Canonical identity is proven only against the canonical registry
 *   (`catalog.models`) through deterministic evidence; see `resolve.ts`.
 * - Serving records are selected only under a proven serving provider
 *   (`models_dev_provider`) by exact parsed-key match; see `resolve.ts`.
 * - Unproven provider records (OpenCode, OpenRouter, unique-match,
 *   first-party, same-name) NEVER supply publication facts. They appear only
 *   as diagnostic candidates.
 * - `resolveInheritedRecord` field inheritance is DELETED: intrinsic facts
 *   come only from the canonical registry entry; a serving record is the
 *   final serving view.
 *
 * This module keeps the shared record-reader helpers and the deprecated
 * selection entry points as thin shims over the single resolver so existing
 * callers keep compiling; new code must use `resolveModel()` directly.
 */
import {
  isRecord,
  optionalBoolean,
  optionalString,
  stripRoutePrefix,
  type DeploymentGroup,
} from "./litellm.js";
import type { Protocol } from "./protocol.js";
import { resolveModel } from "./resolve.js";

export interface ModelsDevRecord extends Record<string, unknown> {
  id?: unknown;
  name?: unknown;
  aliases?: unknown;
  canonical_model_id?: unknown;
  reasoning?: unknown;
  release_date?: unknown;
  modalities?: unknown;
  limit?: unknown;
  cost?: unknown;
  tool_call?: unknown;
  reasoning_options?: unknown;
}

export type ModelsDevMatchKind =
  | "exact"
  | "canonical"
  | "alias"
  /** Matched through a deterministic metadata relation (canonical_model_id / base_model). */
  | "relation";

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
  | "legacy-family-compatibility";

export interface SelectedModelRecord {
  providerID: string;
  modelID: string;
  record: ModelsDevRecord;
  matchedCandidate?: string;
  matchKind?: ModelsDevMatchKind;
  selectionSource?: ModelsDevSelectionSource;
  /**
   * Canonical identity the matched record declares via a deterministic
   * relation (`canonical_model_id` ?? `base_model`), when present. Used to
   * prove canonical-original selection; never a name heuristic.
   */
  recordCanonicalID?: string;
}

/**
 * Whether provider-scoped models.dev pricing can be treated as a plausible
 * fallback for the deployed model. Only proven serving records (explicit
 * provider, and legacy canonical-original) may serve as a price source;
 * reseller/unique fallbacks must never masquerade as route pricing.
 */
export function canUseSelectedModelsDevPrice(selected: SelectedModelRecord | undefined): boolean {
  if (selected?.selectionSource === undefined) return true;
  if (selected.selectionSource === "canonical-original") return true;
  if (selected.selectionSource === "explicit-provider") return true;
  return false;
}

export interface ModelVariant {
  id: string;
  settings: Record<string, unknown>;
}

export type ReasoningSupportSource = "litellm" | "models.dev" | "derived" | "default";

export interface ReasoningSupportResolution {
  readonly supported: boolean;
  readonly source: ReasoningSupportSource;
  readonly conflict: boolean;
}

/**
 * Name-prefix provider guesses. Isolated from trusted publication: neither
 * the resolver nor `selectModelsDevRecordDetailed` consults this table.
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
];

/**
 * Conservative canonicalization for identity matching only. It deliberately does
 * not strip semantic suffixes such as "-free", dates, sizes, or provider tiers.
 */
export function canonicalModelID(value: string): string {
  return stripRoutePrefix(value.trim())
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Deterministic canonical relations a provider-scoped record may declare to
 * point at the canonical model it serves. Only `canonical_model_id` /
 * `base_model` carry canonical-namespace meaning; `inherits` /
 * `equivalent_to` / `equivalents` never prove identity (0 occurrences in
 * the real catalog) and are inert.
 */
export interface RecordRelationTargets {
  /** Preferred canonical identity the record declares, route prefix kept. */
  readonly canonical?: string;
  /** Additional identity relation targets, route-prefixed values only. */
  readonly other: readonly string[];
}

export function relationTargets(record: ModelsDevRecord): RecordRelationTargets {
  const canonical = optionalString(record.canonical_model_id) ??
    optionalString((record as Record<string, unknown>).base_model);
  return { canonical, other: [] };
}

export function candidateModelIDs(group: DeploymentGroup): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    result.push(value);
  };

  for (const deployment of group.deployments) {
    add(optionalString(deployment.modelInfo.base_model));
    const routed = optionalString(deployment.litellmParams.model);
    add(routed ? stripRoutePrefix(routed) : undefined);
  }
  add(group.modelName);
  return result;
}

/**
 * Non-publication compatibility helper. Returns a name-prefix provider guess
 * and never participates in trusted identity resolution.
 */
export function legacyFamilyCompatibilityProvider(group: DeploymentGroup): string | undefined {
  for (const candidate of candidateModelIDs(group)) {
    const normalized = canonicalModelID(candidate);
    const match = LEGACY_FAMILY_COMPATIBILITY_RULES.find(([pattern]) => pattern.test(normalized));
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Trusted identity resolution (compat shim over the single resolver).
 *
 * Only a proven serving record under a declared `models_dev_provider`,
 * resolved by exact parsed-key match, is returned. Canonical-only identity
 * carries no provider record by design, so this returns `undefined` for it;
 * callers that need canonical identity must use `resolveModel()`.
 */
export function selectModelsDevRecord(
  group: DeploymentGroup,
  catalog: unknown,
): SelectedModelRecord | undefined {
  return selectModelsDevRecordDetailed(group, catalog).selected;
}

/**
 * Trusted-publication reasoning evidence from a record: explicit
 * `reasoning`, else the presence of `reasoning_options`. `undefined` means
 * the record declares nothing.
 */
export function modelsDevReasoning(selected: SelectedModelRecord | undefined): boolean | undefined {
  const declared = optionalBoolean(selected?.record.reasoning);
  if (declared !== undefined) return declared;
  const options = selected?.record.reasoning_options;
  return Array.isArray(options) && options.length > 0 ? true : undefined;
}

export function resolveReasoningSupport(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
): ReasoningSupportResolution {
  const state = resolveReasoningState(group, selected);
  const explicit = group.deployments.map((deployment) =>
    optionalBoolean(deployment.modelInfo.supports_reasoning),
  );
  const source = explicit.every((value) => value !== undefined)
    ? "litellm"
    : state.source;
  return {
    supported: state.state === "supported",
    source,
    conflict: state.conflict,
  };
}

function effortVariants(options: unknown, protocol: Protocol): ModelVariant[] {
  if (!isRecord(options) || options.type !== "effort" || !Array.isArray(options.values)) return [];
  const key = protocol === "messages" ? "effort" : "reasoningEffort";
  const values = options.values.filter((value): value is string => typeof value === "string");
  return [...new Set(values)].map((value) => ({ id: value, settings: { [key]: value } }));
}

function budgetVariants(options: unknown, protocol: Protocol): ModelVariant[] {
  if (!isRecord(options) || options.type !== "budget_tokens" || protocol !== "messages") return [];
  const raw = isRecord(options) ? (options as Record<string, unknown>).max : undefined;
  const declaredMax = typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  const maximum = declaredMax !== undefined && declaredMax > 0 ? Math.floor(declaredMax) : undefined;
  const high = maximum === undefined ? 16000 : Math.min(16000, maximum);
  const result: ModelVariant[] = [
    { id: "high", settings: { thinking: { type: "enabled", budgetTokens: high } } },
  ];
  if (maximum !== undefined && maximum > high) {
    result.push({
      id: "max",
      settings: { thinking: { type: "enabled", budgetTokens: maximum } },
    });
  }
  return result;
}

/**
 * Reasoning variants from a PROVEN serving record's `reasoning_options`.
 * Callers must only pass the resolved serving record; unproven records,
 * `reasoning_effort`, and `allowed_openai_params` never produce variants.
 */
export function buildVariants(
  selected: SelectedModelRecord | undefined,
  protocol: Protocol,
): ModelVariant[] {
  const options = selected?.record.reasoning_options;
  if (!Array.isArray(options)) return [];

  const byID = new Map<string, ModelVariant>();
  for (const option of options) {
    for (const variant of [...effortVariants(option, protocol), ...budgetVariants(option, protocol)]) {
      if (!byID.has(variant.id)) byID.set(variant.id, variant);
    }
  }
  return [...byID.values()];
}

export function releaseTimestamp(selected: SelectedModelRecord | undefined): number {
  const value = selected?.record.release_date;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** Unknown-aware capability state: `unknown` means no trusted evidence. */
export type CapabilityState = "supported" | "unsupported" | "unknown";

export interface ReasoningStateResolution {
  readonly state: CapabilityState;
  readonly source: ReasoningSupportSource;
  readonly conflict: boolean;
}

/**
 * Tri-state reasoning support, independent from variant levels.
 */
export function resolveReasoningState(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
): ReasoningStateResolution {
  const aggregated = aggregateTriState(
    group.deployments.map((deployment) => optionalBoolean(deployment.modelInfo.supports_reasoning)),
    modelsDevReasoning(selected),
  );
  return { state: aggregated.state, source: aggregated.source, conflict: aggregated.conflict };
}

export interface ReasoningLevelsResolution {
  /** Whether level metadata was explicitly declared (possibly empty). */
  readonly known: boolean;
  /** Selectable level ids; empty is legal alongside supported reasoning. */
  readonly values: readonly string[];
}

/**
 * Reasoning levels from a record's `reasoning_options`. Only meaningful for
 * proven serving records; see `resolve.ts` for the authority rule.
 */
export function resolveReasoningLevels(
  selected: SelectedModelRecord | undefined,
  protocol: Protocol,
): ReasoningLevelsResolution {
  const options = selected?.record.reasoning_options;
  if (!Array.isArray(options)) return { known: false, values: [] };
  return { known: true, values: buildVariants(selected, protocol).map((variant) => variant.id) };
}

export type SelectionOutcomeKind = "matched" | "unmatched" | "ambiguous";

export interface DetailedSelection {
  readonly outcome: SelectionOutcomeKind;
  readonly selected?: SelectedModelRecord;
  readonly candidates: readonly string[];
  /** How many provider records matched the deciding candidate. */
  readonly matchCount: number;
  /** Provider ids involved when the outcome is ambiguous. */
  readonly ambiguousProviders: readonly string[];
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
  )];
  return declared.length > 1 ? { providers: declared } : undefined;
}

/**
 * Normalized identity node used by group identity reconciliation.
 */
function identityNodeID(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}

/**
 * Routed/base identity ids per deployment (base_model first). An empty
 * result means the deployment carries no identity evidence at all.
 */
function deploymentIdentityIDs(deployment: { modelInfo: Record<string, unknown>; litellmParams: { model?: unknown } }): string[] {
  const declaredProvider = optionalString(deployment.modelInfo.models_dev_provider);
  const provider = declaredProvider !== undefined ? identityNodeID(declaredProvider) : undefined;
  const ids: string[] = [];
  const push = (raw: string | undefined) => {
    const trimmed = raw?.trim();
    if (!trimmed) return;
    const name = identityNodeID(stripRoutePrefix(trimmed));
    if (!name) return;
    if (provider) {
      ids.push(`${provider}/${name}`);
      return;
    }
    const slash = trimmed.indexOf("/");
    const namespace = slash > 0 ? identityNodeID(trimmed.slice(0, slash)) : "";
    ids.push(namespace ? `${namespace}/${name}` : name);
  };
  push(optionalString(deployment.modelInfo.base_model));
  push(optionalString(deployment.litellmParams.model));
  return [...new Set(ids)];
}

export type GroupIdentityStatus = "known" | "unknown" | "conflict";

export interface GroupIdentityEvidence {
  readonly status: GroupIdentityStatus;
  /** Deterministic stable identity; defined iff `status === "known"`. */
  readonly identity?: string;
  /** Why the group cannot be trusted; defined for unknown/conflict. */
  readonly reason?: string;
}

/**
 * Group identity evidence. Every deployment must carry positive identity
 * evidence; an identity-less member is never filtered out. `model_name`
 * never substitutes for per-deployment evidence.
 */
export function groupIdentityEvidence(group: DeploymentGroup, catalog: unknown): GroupIdentityEvidence {
  void catalog;
  const providerConflict = groupExplicitProviderConflict(group);
  if (providerConflict) {
    return {
      status: "conflict",
      reason: `deployments declare different models_dev_provider values (${providerConflict.providers.join(", ")})`,
    };
  }
  const idSets = group.deployments.map(deploymentIdentityIDs);
  const identityLess = idSets.filter((ids) => ids.length === 0).length;
  if (identityLess > 0) {
    return {
      status: "unknown",
      reason: `one or more deployments have no provable identity (${identityLess} of ${idSets.length} deployments declare no route, base model, or deterministic provider proof)`,
    };
  }
  const stableIdentity = [...new Set(idSets.flat())].sort().join("|");
  if (idSets.length <= 1) {
    return { status: "known", identity: stableIdentity };
  }
  // Multi-deployment groups reconcile only on exact shared ids (order
  // independent). Catalog-relation bridging was removed with relation
  // fan-out (D5): identity comes from deployments' own declarations.
  const first = new Set(idSets[0]!);
  const shared = idSets.every((ids) => ids.some((id) => first.has(id)));
  if (!shared) {
    return {
      status: "conflict",
      reason: `deployment identities cannot be proven to name the same model (${idSets.map((ids) => ids.join("|")).join(" vs ")})`,
    };
  }
  return { status: "known", identity: stableIdentity };
}

/**
 * Compatibility wrapper over `groupIdentityEvidence`.
 */
export function groupIdentityConflict(group: DeploymentGroup, catalog: unknown): string | undefined {
  const evidence = groupIdentityEvidence(group, catalog);
  return evidence.status === "known" ? undefined : evidence.reason;
}

/**
 * Detailed selection outcome (compat shim over the single resolver).
 *
 * `matched` with a `selected` record happens ONLY for a proven serving
 * provider with an exactly resolved record (`explicit-provider`).
 * Canonical-only identity, unproven providers, relation-only matches,
 * and reseller/unique records never produce a selection.
 */
export function selectModelsDevRecordDetailed(
  group: DeploymentGroup,
  catalog: unknown,
): DetailedSelection {
  const candidates = candidateModelIDs(group);
  // Lazy import target: resolveModel lives in resolve.ts, which does not
  // import this module, so a static import is cycle-free. Kept dynamic-free
  // on purpose for bundlers; use a direct static import below.
  return detailedFromResolver(group, catalog, candidates);
}

function detailedFromResolver(
  group: DeploymentGroup,
  catalog: unknown,
  candidates: string[],
): DetailedSelection {
  const resolved = resolveModel(group, catalog, {});
  if (resolved.serving.status === "declared" && resolved.serving.record) {
    const record = resolved.serving.record as ModelsDevRecord;
    return {
      outcome: "matched",
      selected: {
        providerID: resolved.serving.providerID!,
        modelID: resolved.serving.recordID!,
        record,
        matchKind: "exact",
        selectionSource: "explicit-provider",
        recordCanonicalID: typeof record.canonical_model_id === "string" ? record.canonical_model_id : undefined,
      },
      candidates,
      matchCount: 1,
      ambiguousProviders: [],
    };
  }
  if (resolved.identity.status === "ambiguous" ||
    resolved.identity.status === "conflict" ||
    resolved.serving.status === "serving-ambiguous") {
    return {
      outcome: "ambiguous",
      selected: undefined,
      candidates,
      matchCount: 0,
      ambiguousProviders: resolved.serving.providerID ? [resolved.serving.providerID] : [],
    };
  }
  return { outcome: "unmatched", selected: undefined, candidates, matchCount: 0, ambiguousProviders: [] };
}

/**
 * Tri-state aggregation for one capability across deployments.
 */
export function aggregateTriState(
  deploymentValues: readonly (boolean | undefined)[],
  modelLevel?: boolean,
): { state: CapabilityState; conflict: boolean; source: "litellm" | "models.dev" | "derived" | "default" } {
  const defined = deploymentValues.filter((value): value is boolean => value !== undefined);
  const hasUnknown = deploymentValues.some((value) => value === undefined);
  const agreesWithModel = modelLevel === undefined || defined.every((value) => value === modelLevel);
  const deploymentConflict = defined.some((value) => value === true) && defined.some((value) => value === false);
  const modelConflict = modelLevel !== undefined && defined.some((value) => value !== modelLevel);

  if (defined.length === 0) {
    if (modelLevel === true) return { state: "supported", conflict: false, source: "models.dev" };
    if (modelLevel === false) return { state: "unsupported", conflict: false, source: "models.dev" };
    return { state: "unknown", conflict: false, source: "default" };
  }
  if (deploymentConflict || hasUnknown || !agreesWithModel) {
    return {
      state: "unknown",
      conflict: deploymentConflict || modelConflict,
      source: modelLevel === undefined ? "litellm" : "derived",
    };
  }
  return {
    state: defined[0] === true ? "supported" : "unsupported",
    conflict: false,
    source: "litellm",
  };
}

export interface InheritedRecord {
  /** Effective record after deterministic inheritance. */
  readonly record: ModelsDevRecord;
  /** Provenance chain, e.g. `canonical: xiaomi/mimo-v2.6-pro`. */
  readonly chain: readonly string[];
  /** Field names inherited from another declared identity. */
  readonly inheritedFields: readonly string[];
}

/**
 * DELETED (D5): cross-provider field inheritance. Intrinsic facts come only
 * from the canonical registry entry; serving records are final views.
 * Kept as a deprecated stub returning `undefined` so stale callers fail
 * open in the safe direction (no inheritance) instead of crashing.
 *
 * @deprecated Do not use. Resolved by `resolveModel()`; always `undefined`.
 */
export function resolveInheritedRecord(
  selected: SelectedModelRecord | undefined,
  catalog: unknown,
): InheritedRecord | undefined {
  void selected;
  void catalog;
  return undefined;
}
