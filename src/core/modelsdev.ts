/** Compatibility projection of the selected model metadata. */
import { isRecord, optionalBoolean, optionalString, type DeploymentGroup } from "./litellm.js";
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
export type ModelsDevMatchKind = "exact" | "canonical" | "alias"
/** Matched through a deterministic metadata relation (canonical_model_id / base_model). */
 | "relation";
export type ModelsDevSelectionSource = "explicit-provider" | "canonical-original" | "openrouter-fallback" | "opencode-fallback" | "unique-match"
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
/** Compatibility projection of the selected model metadata. */
export function canUseSelectedModelsDevPrice(selected: SelectedModelRecord | undefined): boolean {
  return selected !== undefined;
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
const LEGACY_FAMILY_COMPATIBILITY_RULES: Array<[
  RegExp,
  string
]> = [
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
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}
/** Compatibility projection of the selected model metadata. */
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
  return [group.modelName];
}
/**
 * Non-publication compatibility helper. Returns a name-prefix provider guess
 * and never participates in trusted identity resolution.
 */
export function legacyFamilyCompatibilityProvider(group: DeploymentGroup): string | undefined {
  for (const candidate of candidateModelIDs(group)) {
    const normalized = canonicalModelID(candidate);
    const match = LEGACY_FAMILY_COMPATIBILITY_RULES.find(([pattern]) => pattern.test(normalized));
    if (match)
      return match[1];
  }
  return undefined;
}
/** Compatibility projection of the selected model metadata. */
export function selectModelsDevRecord(group: DeploymentGroup, catalog: unknown): SelectedModelRecord | undefined {
  return selectModelsDevRecordDetailed(group, catalog).selected;
}
/**
 * Explicit reasoning support; options never imply support.
 */
export function modelsDevReasoning(selected: SelectedModelRecord | undefined): boolean | undefined {
  return optionalBoolean(selected?.record.reasoning);
}
export function resolveReasoningSupport(group: DeploymentGroup, selected: SelectedModelRecord | undefined): ReasoningSupportResolution {
  const state = resolveReasoningState(group, selected);
  return { supported: state.state === "supported", source: state.source, conflict: state.conflict };
}
function effortVariants(options: unknown, protocol: Protocol): ModelVariant[] {
  if (!isRecord(options) || options.type !== "effort" || !Array.isArray(options.values))
    return [];
  const key = protocol === "messages" ? "effort" : "reasoningEffort";
  const values = options.values.filter((value): value is string => typeof value === "string");
  return [...new Set(values)].map((value) => ({ id: value, settings: { [key]: value } }));
}
function budgetVariants(options: unknown, protocol: Protocol): ModelVariant[] {
  if (!isRecord(options) || options.type !== "budget_tokens" || protocol !== "messages")
    return [];
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
/** Compatibility projection of the selected model metadata. */
export function buildVariants(selected: SelectedModelRecord | undefined, protocol: Protocol): ModelVariant[] {
  const options = selected?.record.reasoning_options;
  if (selected?.record.reasoning !== true || !Array.isArray(options))
    return [];
  const byID = new Map<string, ModelVariant>();
  for (const option of options) {
    for (const variant of [...effortVariants(option, protocol), ...budgetVariants(option, protocol)]) {
      if (!byID.has(variant.id))
        byID.set(variant.id, variant);
    }
  }
  return [...byID.values()];
}
export function releaseTimestamp(selected: SelectedModelRecord | undefined): number {
  const value = selected?.record.release_date;
  if (typeof value === "number" && Number.isFinite(value))
    return value;
  if (typeof value !== "string")
    return 0;
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
/** Compatibility projection of the selected model metadata. */
export function resolveReasoningState(group: DeploymentGroup, selected: SelectedModelRecord | undefined): ReasoningStateResolution {
  if (selected) {
    const declared = modelsDevReasoning(selected);
    return { state: declared === undefined ? "unknown" : declared ? "supported" : "unsupported", source: "models.dev", conflict: false };
  }
  const aggregated = aggregateTriState(group.deployments.map((deployment) => optionalBoolean(deployment.modelInfo.supports_reasoning)));
  return { state: aggregated.state, source: aggregated.source, conflict: aggregated.conflict };
}
export interface ReasoningLevelsResolution {
  /** Whether level metadata was explicitly declared (possibly empty). */
  readonly known: boolean;
  /** Selectable level ids; empty is legal alongside supported reasoning. */
  readonly values: readonly string[];
}
/** Compatibility projection of the selected model metadata. */
export function resolveReasoningLevels(selected: SelectedModelRecord | undefined, protocol: Protocol): ReasoningLevelsResolution {
  const options = selected?.record.reasoning_options;
  if (!Array.isArray(options))
    return { known: false, values: [] };
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
/** Compatibility projection of the selected model metadata. */
/** Deprecated compatibility helper: provider declarations no longer affect metadata. */
export function groupExplicitProviderConflict(_group: DeploymentGroup): {
  providers: string[];
} | undefined {
  return undefined;
}
export type GroupIdentityStatus = "known" | "unknown" | "conflict";
export interface GroupIdentityEvidence {
  readonly status: GroupIdentityStatus;
  /** Deterministic stable identity; defined iff `status === "known"`. */
  readonly identity?: string;
  /** Why the group cannot be trusted; defined for unknown/conflict. */
  readonly reason?: string;
}
/** Compatibility projection of the selected model metadata. */
export function groupIdentityEvidence(group: DeploymentGroup, _catalog: unknown): GroupIdentityEvidence {
  return { status: "known", identity: group.modelName };
}
/**
 * Compatibility wrapper over `groupIdentityEvidence`.
 */
export function groupIdentityConflict(group: DeploymentGroup, catalog: unknown): string | undefined {
  const evidence = groupIdentityEvidence(group, catalog);
  return evidence.status === "known" ? undefined : evidence.reason;
}
/** Compatibility projection of the selected model metadata. */
export function selectModelsDevRecordDetailed(group: DeploymentGroup, catalog: unknown): DetailedSelection {
  const resolved = resolveModel(group, catalog, {});
  return { outcome: resolved.selected ? "matched" : resolved.identity.status === "ambiguous" ? "ambiguous" : "unmatched",
    selected: resolved.selected, candidates: [group.modelName], matchCount: resolved.selected ? 1 : 0, ambiguousProviders: [] };
}
/** Existing declaration aggregation used only when no record is selected. */
export function aggregateTriState(deploymentValues: readonly (boolean | undefined)[], modelLevel?: boolean): {
  state: CapabilityState;
  conflict: boolean;
  source: "litellm" | "models.dev" | "derived" | "default";
} {
  const defined = deploymentValues.filter((value): value is boolean => value !== undefined);
  const hasUnknown = deploymentValues.some((value) => value === undefined);
  const agreesWithModel = modelLevel === undefined || defined.every((value) => value === modelLevel);
  const deploymentConflict = defined.some((value) => value === true) && defined.some((value) => value === false);
  const modelConflict = modelLevel !== undefined && defined.some((value) => value !== modelLevel);
  if (defined.length === 0) {
    if (modelLevel === true)
      return { state: "supported", conflict: false, source: "models.dev" };
    if (modelLevel === false)
      return { state: "unsupported", conflict: false, source: "models.dev" };
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
/** Compatibility projection of the selected model metadata. */
export function resolveInheritedRecord(selected: SelectedModelRecord | undefined, catalog: unknown): InheritedRecord | undefined {
  void selected;
  void catalog;
  return undefined;
}
