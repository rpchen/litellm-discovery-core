/**
 * Single resolver (D9). Every discovery input is resolved once into a
 * `ResolvedModel`; `buildModelSpecs`, the publication assessment and
 * partition, diagnostics, LKG capture, and LKG validation all derive from
 * that result. `toModelSpec()` is the sole ModelSpec constructor.
 *
 * Branch algorithm (D6, per field, per deployment group):
 * ```
 * if serving proven AND record resolved:
 *     if record has field: base = serving (basis serving)
 *     else: base = serving-absence policy (same-dimension LiteLLM fill as
 *           litellm-declared, else unknown; NEVER refill from canonical)
 * elif canonical proven AND registry has field:
 *     base = canonical (basis canonical)
 * elif LiteLLM declared (every deployment declares, all agree):
 *     base = litellm-declared
 * else: base = unknown
 * ```
 * effective = base (D7a proven set is empty: no enforcement narrowing).
 * LiteLLM declared-observable differing from a serving/canonical base is a
 * resolved discrepancy; cross-deployment disagreement is an unresolved
 * conflict; partially declared LiteLLM stays unknown.
 *
 * Dimension isolation (invariant, no exceptions): `max_input_tokens` is
 * input capacity and NEVER becomes `limit.context` — in the canonical and
 * serving branches it is never compared to context, and in the LiteLLM-only
 * branch (no canonical, no serving) there is no context key at all, so a
 * private model without a context-semantic declaration stays missing and is
 * withheld (design Risks "LiteLLM-only 更严格", G30).
 */
import { createHash } from "node:crypto";
import { normalizeModelsDevCatalog, type NormalizedCatalog } from "./catalog-input.js";
import {
  isRecord,
  optionalBoolean,
  optionalNumber,
  optionalString,
  positiveInteger,
  type DeploymentGroup,
} from "./litellm.js";
import { resolveProtocol, type Protocol } from "./protocol.js";
import { deploymentCandidates, parseWireID } from "./wire-id.js";
import type { BuildOptions, ModelSpec } from "./build.js";
import type { ModelCost, ModelLimits } from "./capabilities.js";

export type FieldBasis = "serving" | "canonical" | "litellm-declared" | "unknown" | "enforcement-narrowed";

export type IdentityStatus = "proven" | "unproven" | "ambiguous" | "conflict";
export type IdentityEvidenceKind = "qualified-deployment" | "registry-unique" | "serving-relation" | "none";
export type ServingStatus =
  | "declared"
  | "declared-unmatched"
  | "serving-record-unresolved"
  | "serving-ambiguous"
  | "unproven";
export type IdentityKind = "canonical" | "litellm-only" | "serving-only";

export interface ResolvedIdentity {
  readonly status: IdentityStatus;
  readonly canonicalModelID?: string;
  readonly evidence: IdentityEvidenceKind;
  readonly reason?: string;
  readonly parse: { readonly adapterSegment?: string; readonly customLLMProvider?: string };
  /** Route-vs-base_model difference is diagnostic only. */
  readonly routeDiffers?: boolean;
}

export interface ResolvedServing {
  readonly status: ServingStatus;
  readonly providerID?: string;
  readonly recordID?: string;
  readonly record?: Record<string, unknown>;
  readonly reason?: string;
}

export interface FieldResolutionWithBasis {
  readonly field: string;
  readonly basis: FieldBasis;
  readonly value?: number | boolean | readonly string[];
  readonly status: "selected" | "resolved-discrepancy" | "unresolved-conflict" | "unknown" | "missing" | "illegal";
  readonly resolution: string;
  readonly discrepancy: boolean;
  readonly conflict: boolean;
}

export interface ReasoningLevelsState {
  readonly state: "unknown" | "known";
  readonly values: readonly string[];
  /** Operator-configured effort, diagnostic only. */
  readonly operatorDefaultEffort?: string;
  /** Concrete variants for the resolved protocol (effort or budget settings). */
  readonly variants: ReadonlyArray<{ readonly id: string; readonly settings: Record<string, unknown> }>;
}

export interface DiagnosticCandidate {
  readonly providerID: string;
  readonly recordID: string;
  readonly why: string;
}

export interface LKGProof {
  readonly deploymentEvidence: ReadonlyArray<{
    readonly deploymentID: string;
    readonly normalizedInputs: readonly string[];
    readonly identityKind: IdentityKind;
    readonly canonicalModelID?: string;
    readonly canonicalEvidenceKind?: "qualified-deployment" | "registry-unique" | "serving-relation";
  }>;
  readonly registryDigest?: string;
  readonly serving?: {
    readonly providerID: string;
    readonly recordID: string;
    readonly declarations: ReadonlyArray<{ readonly deploymentID: string; readonly declared: string }>;
    readonly recordDigest: string;
  };
  readonly fields: Readonly<Record<string, FieldBasis>>;
  readonly enforcementFingerprint: string;
  readonly litellmFingerprint?: string;
}

export interface ResolvedModel {
  readonly group: DeploymentGroup;
  readonly protocol: Protocol;
  readonly catalogKind: "complete" | "providers-only" | "unavailable";
  readonly identity: ResolvedIdentity;
  readonly serving: ResolvedServing;
  readonly fields: Readonly<Record<string, FieldResolutionWithBasis>>;
  readonly reasoningLevels: ReasoningLevelsState;
  readonly diagnosticCandidates: readonly DiagnosticCandidate[];
  readonly operatorConfigurationKeys: readonly string[];
  readonly status: "configured" | "discovered-incomplete" | "unmatched" | "ambiguous" | "metadata-unavailable" | "invalid-metadata";
  readonly publishable: boolean;
  readonly reasons: readonly string[];
  readonly discrepancies: readonly FieldResolutionWithBasis[];
  readonly conflicts: readonly FieldResolutionWithBasis[];
  readonly proof: LKGProof;
  readonly spec: ModelSpec;
  readonly release: { readonly released: number; readonly releaseUnit: "unix-ms" | "unknown" | "none" };
}

/** `litellm_params` keys that are Operator-Declared Pricing (D8), never enforcement. */
export const MIRRORED_PRICING_KEYS = [
  "input_cost_per_token",
  "output_cost_per_token",
  "input_cost_per_character",
  "output_cost_per_character",
  "cache_read_input_token_cost",
  "cache_creation_input_token_cost",
  "tiered_pricing",
] as const;

/** Non-pricing `litellm_params` keys are operator configuration (D7a empty proven set). */
const FROZEN_ENFORCED_KEYS: readonly string[] = [];

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

function registryEntries(catalog: NormalizedCatalog): Array<[string, Record<string, unknown>]> {
  return Object.entries(catalog.models).flatMap(([key, value]) =>
    isRecord(value) ? [[key, value] as [string, Record<string, unknown>]] : [],
  );
}

function registryKeyLower(key: string): string {
  return key.trim().toLowerCase();
}

function bareModelPart(registryKey: string): string {
  const slash = registryKey.indexOf("/");
  return slash >= 0 ? registryKey.slice(slash + 1).toLowerCase() : registryKey.toLowerCase();
}

// ---------------------------------------------------------------------------
// Identity (D3.2)
// ---------------------------------------------------------------------------

interface DeploymentIdentity {
  readonly canonicalID?: string;
  readonly evidence: IdentityEvidenceKind;
  readonly ambiguous: boolean;
  readonly lookupKeys: string[];
  readonly parse: { adapterSegment?: string; customLLMProvider?: string };
  readonly baseDecided: boolean;
  readonly routeDiffers: boolean;
}

function resolveDeploymentIdentity(
  candidates: Array<{ value: string; customProvider: string | undefined; isBaseModel: boolean }>,
  registry: Array<[string, Record<string, unknown>]>,
): DeploymentIdentity {
  const byKey = new Map<string, string>();
  for (const [key] of registry) byKey.set(registryKeyLower(key), key);
  const bareIndex = new Map<string, string[]>();
  for (const [key] of registry) {
    const bare = bareModelPart(key);
    const list = bareIndex.get(bare) ?? [];
    list.push(key);
    bareIndex.set(bare, list);
  }
  let parse: { adapterSegment?: string; customLLMProvider?: string } = {};
  const lookupKeys: string[] = [];
  let baseResult: { canonicalID?: string; evidence: IdentityEvidenceKind; ambiguous: boolean } | undefined;
  let routeResult: { canonicalID?: string; evidence: IdentityEvidenceKind; ambiguous: boolean } | undefined;

  for (const candidate of candidates) {
    const parsed = parseWireID(candidate.value, candidate.customProvider);
    if (!parsed) continue;
    if (!parse.adapterSegment && parsed.adapterSegment) {
      parse = { adapterSegment: parsed.adapterSegment, customLLMProvider: parsed.customLLMProvider };
    }
    for (const key of parsed.lookupKeys) {
      if (!lookupKeys.includes(key)) lookupKeys.push(key);
    }
    const result = matchCandidate(parsed, byKey, bareIndex);
    if (candidate.isBaseModel) {
      if (!baseResult) baseResult = result;
    } else if (!routeResult) {
      routeResult = result;
    }
  }
  // D3.2 precedence: a base_model with a unique proof decides the deployment;
  // a different route result is diagnostic only. An ambiguous base_model
  // decides as ambiguous (fail closed; the route cannot override it).
  // A zero-match base_model is NOT a decision: the route keeps its chance.
  if (baseResult && (baseResult.canonicalID !== undefined || baseResult.ambiguous)) {
    const routeDiffers = routeResult !== undefined &&
      (routeResult.canonicalID ?? null) !== (baseResult.canonicalID ?? null);
    return {
      canonicalID: baseResult.canonicalID,
      evidence: baseResult.evidence,
      ambiguous: baseResult.ambiguous,
      lookupKeys,
      parse,
      baseDecided: true,
      routeDiffers,
    };
  }
  return {
    canonicalID: routeResult?.canonicalID,
    evidence: routeResult?.evidence ?? "none",
    ambiguous: routeResult?.ambiguous ?? false,
    lookupKeys,
    parse,
    baseDecided: false,
    routeDiffers: false,
  };
}

function matchCandidate(
  parsed: { full: string; bare?: string; afterAdapter?: string },
  byKey: Map<string, string>,
  bareIndex: Map<string, string[]>,
): { canonicalID?: string; evidence: IdentityEvidenceKind; ambiguous: boolean } {
  // 1. full exactly equals a registry key.
  const fullMatch = byKey.get(registryKeyLower(parsed.full));
  if (fullMatch) return { canonicalID: fullMatch, evidence: "qualified-deployment", ambiguous: false };
  // 2. adapter-evidenced remainder exactly equals a registry key, or bare
  //    unique match when the remainder is bare.
  if (parsed.afterAdapter) {
    const remainderMatch = byKey.get(registryKeyLower(parsed.afterAdapter));
    if (remainderMatch) return { canonicalID: remainderMatch, evidence: "qualified-deployment", ambiguous: false };
    if (!parsed.afterAdapter.includes("/")) {
      const bareMatches = bareIndex.get(parsed.afterAdapter.toLowerCase()) ?? [];
      if (bareMatches.length === 1) return { canonicalID: bareMatches[0], evidence: "registry-unique", ambiguous: false };
      if (bareMatches.length > 1) return { evidence: "none", ambiguous: true };
    }
  }
  // 3. bare candidate: 0 -> no proof, 1 -> proven, >1 -> ambiguous (stop).
  if (parsed.bare) {
    const bareMatches = bareIndex.get(parsed.bare.toLowerCase()) ?? [];
    if (bareMatches.length === 1) return { canonicalID: bareMatches[0], evidence: "registry-unique", ambiguous: false };
    if (bareMatches.length > 1) return { evidence: "none", ambiguous: true };
  }
  return { evidence: "none", ambiguous: false };
}

// ---------------------------------------------------------------------------
// Serving (D4)
// ---------------------------------------------------------------------------

function servingRecordCandidates(
  providerModels: Record<string, unknown>,
  lookupKeys: string[],
): Array<{ id: string; record: Record<string, unknown> }> {
  const result: Array<{ id: string; record: Record<string, unknown> }> = [];
  const seen = new Set<Record<string, unknown>>();
  const lowerKeys = lookupKeys.map((key) => key.toLowerCase());
  for (const [key, value] of Object.entries(providerModels)) {
    if (!isRecord(value)) continue;
    const record = value as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id ? record.id : key;
    if (lowerKeys.includes(key.toLowerCase()) || lowerKeys.includes(id.toLowerCase())) {
      if (!seen.has(record)) {
        seen.add(record);
        result.push({ id, record });
      }
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id, "en"));
}

function publicationCriticalFacts(record: Record<string, unknown>): string {
  // Identity relation is publication-critical: exact serving records naming
  // DIFFERENT canonical identities are never the same record, even when every
  // capability and price matches. Facts-equal is not identity-equal (D3.3).
  return JSON.stringify({
    canonical_model_id: typeof record.canonical_model_id === "string" ? record.canonical_model_id : null,
    limit: record.limit ?? null,
    modalities: record.modalities ?? null,
    tool_call: record.tool_call ?? null,
    reasoning: record.reasoning ?? null,
    reasoning_options: record.reasoning_options ?? null,
    cost: record.cost ?? null,
  });
}

function resolveServing(
  group: DeploymentGroup,
  catalog: NormalizedCatalog,
  perDeploymentLookups: string[][],
): ResolvedServing {
  const declared = group.deployments.map((deployment) =>
    optionalString(deployment.modelInfo.models_dev_provider)?.toLowerCase(),
  );
  const present = declared.filter((value): value is string => value !== undefined);
  const distinct = [...new Set(present)];
  if (distinct.length > 1) {
    // Order-independent message (G23).
    return { status: "unproven", reason: `deployments declare different models_dev_provider values (${[...distinct].sort().join(", ")})` };
  }
  if (present.length < group.deployments.length) {
    // D4: proven iff EVERY deployment of the group declares the same provider.
    // A partial declaration is not a group proof; the group then resolves
    // through the canonical/LiteLLM branches exactly like an undeclared group.
    return {
      status: "unproven",
      reason: `only ${present.length} of ${group.deployments.length} deployments declare models_dev_provider; a partial declaration is not a group proof`,
    };
  }
  const providerName = distinct[0];
  if (!providerName) return { status: "unproven" };
  const providerEntry = Object.entries(catalog.providers).find(([key]) => key.toLowerCase() === providerName);
  if (!providerEntry || !isRecord(providerEntry[1])) {
    return { status: "declared-unmatched", providerID: declared.find((v) => v !== undefined), reason: `declared provider ${providerName} is absent from the catalog` };
  }
  const providerID = providerEntry[0];
  const models = isRecord((providerEntry[1] as Record<string, unknown>).models)
    ? ((providerEntry[1] as Record<string, unknown>).models as Record<string, unknown>)
    : {};
  // Deterministic group record selection (D4, order-independent):
  // - every deployment must hold at least one exact candidate, otherwise the
  //   SKU stays unresolved no matter which deployment is listed first;
  // - the publication-critical facts (INCLUDING canonical_model_id) of ALL
  //   candidates of ALL deployments must form ONE equivalence class, otherwise
  //   the group is serving-ambiguous and fails closed — never first-wins and
  //   never decided by record order;
  // - the representative record is the deterministically lowest record id.
  const perDeployment = perDeploymentLookups.map((keys) => servingRecordCandidates(models, keys));
  if (perDeployment.some((list) => list.length === 0)) {
    // Relation-only check: does the provider hold records whose
    // canonical_model_id names the canonical identity? Those prove identity
    // only (handled by the caller), never the SKU.
    return {
      status: "serving-record-unresolved",
      providerID,
      reason: `provider ${providerID} holds no record matching the wire id; relation-only records never resolve the SKU`,
    };
  }
  const factClasses = new Set<string>();
  for (const list of perDeployment) {
    for (const item of list) factClasses.add(publicationCriticalFacts(item.record));
  }
  if (factClasses.size > 1) {
    return {
      status: "serving-ambiguous",
      providerID,
      reason: "exact serving records for one group name different canonical identities or carry materially different facts",
    };
  }
  const representative = perDeployment.flat()[0]!;
  return { status: "declared", providerID, recordID: representative.id, record: representative.record };
}

// ---------------------------------------------------------------------------
// Field matrix (D6)
// ---------------------------------------------------------------------------

function allDeclaredNumbers(group: DeploymentGroup, keys: readonly string[], from: "modelInfo" | "litellmParams"): number[] | undefined {
  const values: number[] = [];
  for (const deployment of group.deployments) {
    const source = from === "modelInfo" ? deployment.modelInfo : deployment.litellmParams;
    let found: number | undefined;
    for (const key of keys) {
      const value = optionalNumber((source as Record<string, unknown>)[key]);
      if (value !== undefined) {
        found = value;
        break;
      }
    }
    if (found === undefined) return undefined;
    values.push(found);
  }
  return values;
}

function litellmDeclaredValue(group: DeploymentGroup, keys: readonly string[]): { value: number; consistent: boolean; conflict: boolean; partial: boolean } {
  const values = allDeclaredNumbers(group, keys, "modelInfo");
  if (values === undefined) {
    // Partial: at least one deployment declares.
    const any = group.deployments.some((deployment) =>
      keys.some((key) => optionalNumber(deployment.modelInfo[key]) !== undefined),
    );
    return { value: 0, consistent: false, conflict: false, partial: any };
  }
  if (new Set(values).size > 1) return { value: 0, consistent: false, conflict: true, partial: false };
  return { value: values[0]!, consistent: true, conflict: false, partial: false };
}

function litellmDeclaredBoolean(
  group: DeploymentGroup,
  key: string,
): { value?: boolean; consistent: boolean; partial: boolean; conflict: boolean } {
  const values = group.deployments.map((deployment) => optionalBoolean(deployment.modelInfo[key]));
  const defined = values.filter((value): value is boolean => value !== undefined);
  if (defined.length === 0) return { consistent: false, partial: false, conflict: false };
  if (defined.length < values.length) return { consistent: false, partial: true, conflict: false };
  if (new Set(defined).size > 1) return { consistent: false, partial: false, conflict: true };
  return { value: defined[0], consistent: true, partial: false, conflict: false };
}

function modalityDeclared(
  group: DeploymentGroup,
  dimensions: ReadonlyArray<{ key: string; modality: string }>,
): { known: boolean; values: string[]; conflict: boolean; partial: boolean; detail: string } {
  const supported = new Set<string>();
  for (const dimension of dimensions) {
    const result = litellmDeclaredBoolean(group, dimension.key);
    if (result.conflict) return { known: false, values: [], conflict: true, partial: false, detail: dimension.key };
    if (!result.consistent || result.value === undefined) {
      return { known: false, values: [], conflict: false, partial: true, detail: dimension.key };
    }
    if (result.value === true) supported.add(dimension.modality);
  }
  return { known: true, values: ["text", ...supported], conflict: false, partial: false, detail: "every dimension declared" };
}

const INPUT_MODALITY_DIMENSIONS = [
  { key: "supports_vision", modality: "image" },
  { key: "supports_pdf_input", modality: "pdf" },
  { key: "supports_audio_input", modality: "audio" },
  { key: "supports_video_input", modality: "video" },
] as const;

const OUTPUT_MODALITY_DIMENSIONS = [{ key: "supports_audio_output", modality: "audio" }] as const;

function numericLimitFromRecord(record: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!record || !isRecord(record.limit)) return undefined;
  const value = optionalNumber((record.limit as Record<string, unknown>)[key]);
  return value !== undefined && value > 0 ? Math.floor(value) : undefined;
}

function hasLimitKey(record: Record<string, unknown> | undefined, key: string): boolean {
  if (!record || !isRecord(record.limit)) return false;
  return (record.limit as Record<string, unknown>)[key] !== undefined;
}

function stableDigest(value: unknown): string {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable);
    if (typeof input !== "object" || input === null) return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([k, v]) => [k, stable(v)]),
    );
  };
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex").slice(0, 32);
}

/** Registry facts that can feed a canonical basis (intrinsic only). */
function pickRegistryFacts(entry: Record<string, unknown>): unknown {
  return {
    limit: entry.limit ?? null,
    modalities: entry.modalities ?? null,
    tool_call: entry.tool_call ?? null,
    reasoning: entry.reasoning ?? null,
    release_date: entry.release_date ?? null,
  };
}

/** Serving-record facts that can feed a serving basis. */
function pickServingFacts(record: Record<string, unknown>): unknown {
  return {
    limit: record.limit ?? null,
    modalities: record.modalities ?? null,
    tool_call: record.tool_call ?? null,
    reasoning: record.reasoning ?? null,
    reasoning_options: record.reasoning_options ?? null,
    cost: record.cost ?? null,
    release_date: record.release_date ?? null,
  };
}

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  readonly protocolOverrides?: Readonly<Record<string, Protocol>>;
  readonly contextTierCap?: boolean;
}

export function resolveModel(
  group: DeploymentGroup,
  catalogInput: unknown,
  options: ResolveOptions = {},
): ResolvedModel {
  const catalog = normalizeModelsDevCatalog(catalogInput);
  const protocol = resolveProtocol(group, options.protocolOverrides ?? {});
  const operatorConfigurationKeys = collectOperatorConfigurationKeys(group);

  if (catalog.kind !== "complete") {
    return resolveWithoutCatalog(group, catalog.kind, protocol, operatorConfigurationKeys, options);
  }

  const registry = registryEntries(catalog);
  // Distinct explicit providers across one group: the host model identity
  // cannot be stated as one fact (conflict, never first-deployment wins).
  const declaredProviders = [...new Set(
    group.deployments
      .map((deployment) => optionalString(deployment.modelInfo.models_dev_provider)?.toLowerCase())
      .filter((value): value is string => value !== undefined),
  )];
  if (declaredProviders.length > 1) {
    const conflictIdentity: ResolvedIdentity = {
      status: "ambiguous",
      evidence: "none",
      reason: `deployments declare different models_dev_provider values (${declaredProviders.sort().join(", ")})`,
      parse: {},
    };
    return finishResolution(group, catalog, protocol, operatorConfigurationKeys, conflictIdentity, { status: "unproven" }, "ambiguous", undefined, options);
  }
  const perDeployment = group.deployments.map((deployment) => {
    const candidates = deploymentCandidates({
      modelInfo: deployment.modelInfo as Record<string, unknown>,
      litellmParams: deployment.litellmParams as Record<string, unknown>,
    });
    return resolveDeploymentIdentity(candidates, registry);
  });

  // Group identity: every deployment must resolve to the same canonical, or
  // the group is ambiguous. Identity-less deployments block the group.
  let identity: ResolvedIdentity;
  const ambiguousDeployments = perDeployment.filter((item) => item.ambiguous);
  const identified = perDeployment.filter((item) => item.canonicalID !== undefined);
  const unidentified = perDeployment.filter((item) => item.canonicalID === undefined && !item.ambiguous);
  const parse = perDeployment[0]?.parse ?? {};
  const routeDiffers = perDeployment.some((item) => item.routeDiffers);
  if (ambiguousDeployments.length > 0) {
    identity = { status: "ambiguous", evidence: "none", reason: "a bare lookup matches more than one registry entry (identity-ambiguous)", parse };
  } else if (unidentified.length > 0 && identified.length > 0) {
    identity = { status: "ambiguous", evidence: "none", reason: "some deployments resolve to a registry entry while others do not (identity-ambiguous)", parse, routeDiffers };
  } else if (unidentified.length === group.deployments.length) {
    identity = { status: "unproven", evidence: "none", parse, routeDiffers };
  } else if (identified.length > 0) {
    const ids = new Set(identified.map((item) => item.canonicalID!));
    if (ids.size > 1) {
      identity = { status: "ambiguous", evidence: "none", reason: `deployments resolve to different registry entries (${[...ids].sort().join(" vs ")})`, parse, routeDiffers };
    } else {
      // Deterministic evidence rank (G23): qualified-deployment outranks
      // registry-unique outranks serving-relation, independent of
      // deployment order. Ties break on sorted lookup keys.
      const rank = (evidence: IdentityEvidenceKind): number =>
        evidence === "qualified-deployment" ? 2 : evidence === "registry-unique" ? 1 : 0;
      const winner = [...identified].sort((a, b) =>
        rank(b.evidence) - rank(a.evidence) ||
        [...a.lookupKeys].sort().join("\0").localeCompare([...b.lookupKeys].sort().join("\0"), "en"),
      )[0]!;
      identity = { status: "proven", canonicalModelID: [...ids][0], evidence: winner.evidence, parse: winner.parse, routeDiffers };
    }
  } else {
    identity = { status: "unproven", evidence: "none", parse };
  }

  const perDeploymentLookups = perDeployment.map((item) => item.lookupKeys);
  let serving = resolveServing(group, catalog, perDeploymentLookups);

  // D3.3 serving-relation identity: only the record deterministically
  // selected for the group (resolved by parsed lookup keys, D4) can prove the
  // underlying canonical identity. Relation-only records that do NOT match the
  // deployment's wire id are never candidates — scanning the whole provider
  // would infer identity from unrelated SKUs (review issue 1).
  if (identity.status === "unproven" && serving.status === "declared" && serving.record) {
    const relation = typeof serving.record.canonical_model_id === "string" ? serving.record.canonical_model_id : undefined;
    const registryKey = relation
      ? Object.keys(catalog.models).find((key) => registryKeyLower(key) === registryKeyLower(relation))
      : undefined;
    if (registryKey) {
      identity = { status: "proven", canonicalModelID: registryKey, evidence: "serving-relation", parse, routeDiffers };
    }
  }
  // Canonical/provider contradiction: both sides deterministic, differ ->
  // identity conflict, fail closed.
  if (identity.status === "proven" && serving.status === "declared" && serving.record) {
    const relation = typeof serving.record.canonical_model_id === "string" ? serving.record.canonical_model_id : undefined;
    if (relation && registryKeyLower(relation) !== registryKeyLower(identity.canonicalModelID!)) {
      const conflictIdentity: ResolvedIdentity = {
        status: "conflict",
        evidence: "none",
        reason: `deployment evidence resolves ${identity.canonicalModelID} but serving record declares ${relation} (identity-ambiguous)`,
        parse,
      };
      return finishResolution(group, catalog, protocol, operatorConfigurationKeys, conflictIdentity, { status: "unproven" }, "ambiguous", undefined, options);
    }
  }

  // serving-record-unresolved / declared-unmatched / serving-ambiguous all
  // resolve through canonical/LiteLLM branches as if serving were unproven,
  // but the ORIGINAL serving status is preserved for diagnostics and LKG.
  const servingUsable = serving.status === "declared" && serving.record ? serving : { status: "unproven" } as ResolvedServing;
  const groupStatus = identity.status === "ambiguous" || identity.status === "conflict"
    ? "ambiguous"
    : serving.status === "serving-ambiguous"
      ? "ambiguous"
      : undefined;
  return finishResolution(
    group,
    catalog,
    protocol,
    operatorConfigurationKeys,
    identity,
    servingUsable,
    groupStatus,
    serving,
    options,
  );
}

function collectOperatorConfigurationKeys(group: DeploymentGroup): string[] {
  const keys = new Set<string>();
  for (const deployment of group.deployments) {
    for (const key of Object.keys(deployment.litellmParams)) {
      if ((MIRRORED_PRICING_KEYS as readonly string[]).includes(key)) continue;
      if (FROZEN_ENFORCED_KEYS.includes(key)) continue;
      keys.add(`litellm_params.${key}`);
    }
  }
  return [...keys].sort();
}

function resolveWithoutCatalog(
  group: DeploymentGroup,
  kind: "providers-only" | "unavailable",
  protocol: Protocol,
  operatorConfigurationKeys: string[],
  options: ResolveOptions = {},
): ResolvedModel {
  // No canonical resolution, no provider record use. LiteLLM-complete models
  // publish as litellm-declared; the rest are metadata-unavailable (LKG may
  // still apply at the partition layer).
  const fields = resolveLiteLLMOnlyFields(group, undefined, undefined);
  const levels: ReasoningLevelsState = { state: "unknown", values: [], variants: [] };
  const operatorDefaultEffort = optionalString(group.deployments[0]?.litellmParams.reasoning_effort);
  const withEffort: ReasoningLevelsState = operatorDefaultEffort
    ? { ...levels, operatorDefaultEffort }
    : levels;
  // Dimension isolation (no exception): max_input_tokens never becomes
  // limit.context, so a LiteLLM-only group without a context-semantic
  // declaration stays context-missing and is withheld (G30 / design Risks
  // "LiteLLM-only 更严格").
  const withIllegal = applyIllegality(group, undefined, undefined, fields);
  const withTier = applyTierCap(group, withIllegal, options.contextTierCap);
  const identity: ResolvedIdentity = { status: "unproven", evidence: "none", parse: {} };
  const serving: ResolvedServing = { status: "unproven" };
  return assembleResolved(group, kind, protocol, operatorConfigurationKeys, identity, serving, withTier, withEffort, []);
}

interface FieldSet {
  readonly context: FieldResolutionWithBasis;
  readonly input: FieldResolutionWithBasis;
  readonly output: FieldResolutionWithBasis;
  readonly tools: FieldResolutionWithBasis;
  readonly reasoning: FieldResolutionWithBasis;
  readonly inputModalities: FieldResolutionWithBasis;
  readonly outputModalities: FieldResolutionWithBasis;
  readonly priceInput: FieldResolutionWithBasis;
  readonly priceOutput: FieldResolutionWithBasis;
  readonly priceCacheRead: FieldResolutionWithBasis;
  readonly priceCacheWrite: FieldResolutionWithBasis;
  readonly releaseDate: FieldResolutionWithBasis;
}

function resolveLiteLLMOnlyFields(
  group: DeploymentGroup,
  servingRecord: Record<string, unknown> | undefined,
  registryEntry: Record<string, unknown> | undefined,
): FieldSet {
  // Shared helper for the LiteLLM-only branch. Serving/canonical branches use
  // resolveBranchFields below; this helper is only for no-catalog or
  // unproven-identity paths where servingRecord/registryEntry are undefined.
  void servingRecord;
  void registryEntry;
  return resolveBranchFields(group, undefined, undefined);
}

function resolveBranchFields(
  group: DeploymentGroup,
  servingRecord: Record<string, unknown> | undefined,
  registryEntry: Record<string, unknown> | undefined,
): FieldSet {
  const servingUsable = servingRecord !== undefined;
  const canonicalUsable = !servingUsable && registryEntry !== undefined;

  const field = (
    name: string,
    servingValue: number | boolean | readonly string[] | undefined,
    servingHas: boolean,
    canonicalValue: number | boolean | readonly string[] | undefined,
    canonicalHas: boolean,
    litellm: () => { value: number | boolean | readonly string[] | undefined; basis: FieldBasis; detail: string; discrepancyWith?: number | boolean | readonly string[]; conflict?: boolean; partial?: boolean },
  ): FieldResolutionWithBasis => {
    // Explicit cross-deployment disagreement is an unresolved conflict under
    // every branch: no record-level fact can prove which route the host uses.
    const peek = litellm();
    if (peek.conflict) {
      return {
        field: name,
        basis: "unknown",
        status: "unresolved-conflict",
        resolution: `deployments declare different values for ${peek.detail}; a record-level fact cannot prove which route the host will use`,
        discrepancy: false,
        conflict: true,
      };
    }
    if (servingUsable) {
      if (servingHas && servingValue !== undefined) {
        const lit = litellm();
        const discrepancy = lit.basis === "litellm-declared" && !sameValue(lit.value, servingValue);
        void lit;
        return {
          field: name,
          basis: "serving",
          value: servingValue,
          status: discrepancy ? "resolved-discrepancy" : "selected",
          resolution: discrepancy
            ? "serving record decides; differing LiteLLM declaration retained as a resolved discrepancy"
            : "proven serving record decides",
          discrepancy,
          conflict: false,
        };
      }
      // Serving-absence policy: same-dimension LiteLLM fill, else unknown.
      // NEVER refill from canonical.
      const lit = litellm();
      if (lit.basis === "litellm-declared" && lit.value !== undefined) {
        return {
          field: name,
          basis: "litellm-declared",
          value: lit.value,
          status: "selected",
          resolution: `serving record omits this field (final serving view); same-dimension LiteLLM declaration fills the gap (${lit.detail})`,
          discrepancy: false,
          conflict: false,
        };
      }
      if (lit.conflict) {
        return {
          field: name,
          basis: "unknown",
          status: "unresolved-conflict",
          resolution: `deployments disagree on ${lit.detail}; no authority can decide`,
          discrepancy: false,
          conflict: true,
        };
      }
      return {
        field: name,
        basis: "unknown",
        status: lit.partial ? "unknown" : "missing",
        resolution: `serving record omits this field and no consistent LiteLLM declaration fills it (${lit.detail})`,
        discrepancy: false,
        conflict: false,
      };
    }
    if (canonicalUsable) {
      if (canonicalHas && canonicalValue !== undefined) {
        const lit = litellm();
        // Dimension isolation: input-capacity declarations are never compared
        // to total context.
        const comparable = name === "limit.context" ? undefined : lit.basis === "litellm-declared" ? lit.value : undefined;
        const discrepancy = comparable !== undefined && !sameValue(comparable, canonicalValue);
        void lit;
        return {
          field: name,
          basis: "canonical",
          value: canonicalValue,
          status: discrepancy ? "resolved-discrepancy" : "selected",
          resolution: discrepancy
            ? "canonical registry decides; differing LiteLLM declaration retained as a resolved discrepancy"
            : "canonical registry decides",
          discrepancy,
          conflict: false,
        };
      }
      const lit = litellm();
      if (lit.basis === "litellm-declared" && lit.value !== undefined) {
        return {
          field: name,
          basis: "litellm-declared",
          value: lit.value,
          status: "selected",
          resolution: `registry omits this field; LiteLLM declaration fills it (${lit.detail})`,
          discrepancy: false,
          conflict: false,
        };
      }
      if (lit.conflict) {
        return {
          field: name,
          basis: "unknown",
          status: "unresolved-conflict",
          resolution: `deployments disagree on ${lit.detail}; no authority can decide`,
          discrepancy: false,
          conflict: true,
        };
      }
      return {
        field: name,
        basis: "unknown",
        status: lit.partial ? "unknown" : "missing",
        resolution: `neither the registry nor LiteLLM declares this field (${lit.detail})`,
        discrepancy: false,
        conflict: false,
      };
    }
    // LiteLLM-only branch (no serving, no canonical): every consistent
    // declaration publishes as litellm-declared, including context from
    // max_input_tokens (R11; private models have no other context key).
    const lit = litellm();
    if (lit.basis === "litellm-declared" && lit.value !== undefined) {
      return {
        field: name,
        basis: "litellm-declared",
        value: lit.value,
        status: "selected",
        resolution: `LiteLLM declarations decide (${lit.detail})`,
        discrepancy: false,
        conflict: false,
      };
    }
    if (lit.conflict) {
      return {
        field: name,
        basis: "unknown",
        status: "unresolved-conflict",
        resolution: `deployments disagree on ${lit.detail}; no authority can decide`,
        discrepancy: false,
        conflict: true,
      };
    }
    return {
      field: name,
      basis: "unknown",
      status: lit.partial ? "unknown" : "missing",
      resolution: `no trusted source declares this field (${lit.detail})`,
      discrepancy: false,
      conflict: false,
    };
  };

  // LiteLLM declared-observable readers per field.
  const readContextLiteLLM = () => {
    // Canonical/serving branches: NO LiteLLM context key exists (dimension
    // isolation). The LiteLLM-only branch uses max_input_tokens as the
    // private-model context declaration (see finishResolution).
    return { value: undefined as number | undefined, basis: "unknown" as FieldBasis, detail: "no LiteLLM context key (max_input_tokens is input capacity)" };
  };
  const readInputLiteLLM = () => {
    const lit = litellmDeclaredValue(group, ["max_input_tokens"]);
    if (lit.conflict) {
      return { value: undefined as number | undefined, basis: "unknown" as FieldBasis, detail: "model_info.max_input_tokens", conflict: true, partial: false };
    }
    if (!lit.consistent) {
      return { value: undefined as number | undefined, basis: "unknown" as FieldBasis, detail: "model_info.max_input_tokens", partial: lit.partial };
    }
    return { value: lit.value as number | undefined, basis: "litellm-declared" as FieldBasis, detail: "model_info.max_input_tokens" };
  };
  const readOutputLiteLLM = () => {
    const values = allDeclaredNumbers(group, ["max_output_tokens", "max_tokens"], "modelInfo");
    if (values === undefined) {
      const any = group.deployments.some((d) =>
        optionalNumber(d.modelInfo.max_output_tokens) !== undefined || optionalNumber(d.modelInfo.max_tokens) !== undefined,
      );
      // Cross-deployment disagreement check.
      const first = group.deployments.map((d) =>
        optionalNumber(d.modelInfo.max_output_tokens) ?? optionalNumber(d.modelInfo.max_tokens),
      ).filter((v): v is number => v !== undefined);
      if (new Set(first).size > 1) {
        return { value: undefined as number | undefined, basis: "unknown" as FieldBasis, detail: "model_info.max_output_tokens", conflict: true, partial: false };
      }
      return { value: undefined as number | undefined, basis: "unknown" as FieldBasis, detail: "model_info.max_output_tokens", partial: any };
    }
    if (new Set(values).size > 1) {
      return { value: undefined as number | undefined, basis: "unknown" as FieldBasis, detail: "model_info.max_output_tokens", conflict: true, partial: false };
    }
    return { value: values[0] as number | undefined, basis: "litellm-declared" as FieldBasis, detail: "model_info.max_output_tokens" };
  };
  const readToolsLiteLLM = () => {
    const result = litellmDeclaredBoolean(group, "supports_function_calling");
    if (result.conflict) return { value: undefined as boolean | undefined, basis: "unknown" as FieldBasis, detail: "model_info.supports_function_calling", conflict: true, partial: false };
    if (!result.consistent || result.value === undefined) {
      return { value: undefined as boolean | undefined, basis: "unknown" as FieldBasis, detail: "model_info.supports_function_calling", partial: result.partial };
    }
    return { value: result.value as boolean | undefined, basis: "litellm-declared" as FieldBasis, detail: "model_info.supports_function_calling" };
  };
  const readReasoningLiteLLM = () => {
    const result = litellmDeclaredBoolean(group, "supports_reasoning");
    if (result.conflict) return { value: undefined as boolean | undefined, basis: "unknown" as FieldBasis, detail: "model_info.supports_reasoning", conflict: true, partial: false };
    if (!result.consistent || result.value === undefined) {
      return { value: undefined as boolean | undefined, basis: "unknown" as FieldBasis, detail: "model_info.supports_reasoning", partial: result.partial };
    }
    return { value: result.value as boolean | undefined, basis: "litellm-declared" as FieldBasis, detail: "model_info.supports_reasoning" };
  };
  const readInputModalitiesLiteLLM = () => {
    const declared = modalityDeclared(group, INPUT_MODALITY_DIMENSIONS);
    if (declared.conflict) return { value: undefined as readonly string[] | undefined, basis: "unknown" as FieldBasis, detail: "input modality flags", conflict: true, partial: false };
    if (!declared.known) return { value: undefined as readonly string[] | undefined, basis: "unknown" as FieldBasis, detail: "input modality flags", partial: declared.partial };
    return { value: declared.values as readonly string[] | undefined, basis: "litellm-declared" as FieldBasis, detail: "input modality flags" };
  };
  const readOutputModalitiesLiteLLM = () => {
    const declared = modalityDeclared(group, OUTPUT_MODALITY_DIMENSIONS);
    if (declared.conflict) return { value: undefined as readonly string[] | undefined, basis: "unknown" as FieldBasis, detail: "output modality flags", conflict: true, partial: false };
    if (!declared.known) return { value: undefined as readonly string[] | undefined, basis: "unknown" as FieldBasis, detail: "output modality flags", partial: declared.partial };
    return { value: declared.values as readonly string[] | undefined, basis: "litellm-declared" as FieldBasis, detail: "output modality flags" };
  };

  const servingLimit = (key: string) => numericLimitFromRecord(servingRecord, key);
  const registryLimit = (key: string) => numericLimitFromRecord(registryEntry, key);
  const servingTool = servingRecord ? optionalBoolean((servingRecord as Record<string, unknown>).tool_call) : undefined;
  const registryTool = registryEntry ? optionalBoolean((registryEntry as Record<string, unknown>).tool_call) : undefined;
  const servingReasoning = servingRecord ? optionalBoolean((servingRecord as Record<string, unknown>).reasoning) : undefined;
  const registryReasoning = registryEntry ? optionalBoolean((registryEntry as Record<string, unknown>).reasoning) : undefined;
  const servingModalities = (direction: "input" | "output"): readonly string[] | undefined => {
    if (!servingRecord || !isRecord((servingRecord as Record<string, unknown>).modalities)) return undefined;
    const list = ((servingRecord as Record<string, unknown>).modalities as Record<string, unknown>)[direction];
    if (!Array.isArray(list)) return undefined;
    const values = list.filter((v): v is string => typeof v === "string");
    return values.length > 0 ? values : undefined;
  };
  const registryModalities = (direction: "input" | "output"): readonly string[] | undefined => {
    if (!registryEntry || !isRecord((registryEntry as Record<string, unknown>).modalities)) return undefined;
    const list = ((registryEntry as Record<string, unknown>).modalities as Record<string, unknown>)[direction];
    if (!Array.isArray(list)) return undefined;
    const values = list.filter((v): v is string => typeof v === "string");
    return values.length > 0 ? values : undefined;
  };
  const registryHasModalitiesObject = registryEntry ? isRecord((registryEntry as Record<string, unknown>).modalities) : false;

  // Modality complete-set semantics: a present list decides the direction;
  // contradicting LiteLLM flags are a resolved discrepancy.
  const modalityField = (
    name: string,
    servingList: readonly string[] | undefined,
    servingPresent: boolean,
    registryList: readonly string[] | undefined,
    registryPresent: boolean,
    readLiteLLM: () => { value: readonly string[] | undefined; basis: FieldBasis; detail: string; conflict?: boolean; partial?: boolean },
  ): FieldResolutionWithBasis => {
    const peek = readLiteLLM();
    if (peek.conflict) {
      return {
        field: name,
        basis: "unknown",
        value: undefined,
        status: "unresolved-conflict",
        resolution: `deployments declare different values for ${peek.detail}; a record-level fact cannot prove which route the host will use`,
        discrepancy: false,
        conflict: true,
      };
    }
    if (servingUsable) {
      if (servingPresent && servingList) {
        const lit = readLiteLLM();
        const litSet = lit.basis === "litellm-declared" && lit.value !== undefined ? lit.value : undefined;
        const discrepancy = litSet !== undefined && !sameValue(litSet, servingList);
        return {
          field: name, basis: "serving", value: servingList,
          status: discrepancy ? "resolved-discrepancy" : "selected",
          resolution: discrepancy
            ? "proven serving record modalities decide (complete set); contradicting LiteLLM flags retained as a resolved discrepancy"
            : "proven serving record modalities decide (complete set)",
          discrepancy, conflict: false,
        };
      }
      if (servingPresent && !servingList) {
        return {
          field: name, basis: "unknown", value: undefined, status: "missing",
          resolution: "serving record declares no usable modality set", discrepancy: false, conflict: false,
        };
      }
      const lit = readLiteLLM();
      if (lit.basis === "litellm-declared" && lit.value !== undefined) {
        return {
          field: name, basis: "litellm-declared", value: lit.value, status: "selected",
          resolution: `serving record omits modalities; LiteLLM declaration fills it (${lit.detail})`, discrepancy: false, conflict: false,
        };
      }
      return {
        field: name, basis: "unknown", value: undefined, status: lit.partial ? "unknown" : "missing",
        resolution: "serving record omits modalities and LiteLLM declares incompletely", discrepancy: false, conflict: !!lit.conflict,
      };
    }
    if (canonicalUsable) {
      if (registryPresent && registryList) {
        const lit = readLiteLLM();
        // A fully declared LiteLLM direction that disagrees with the
        // complete registry set is a resolved discrepancy (G19c): the
        // registry set still decides (e.g. audio unsupported).
        const litSet = lit.basis === "litellm-declared" && lit.value !== undefined ? lit.value : undefined;
        const discrepancy = litSet !== undefined && !sameValue(litSet, registryList);
        return {
          field: name, basis: "canonical", value: registryList,
          status: discrepancy ? "resolved-discrepancy" : "selected",
          resolution: discrepancy
            ? "canonical registry modalities decide (complete set); contradicting LiteLLM flags retained as a resolved discrepancy"
            : "canonical registry modalities decide (complete set)",
          discrepancy, conflict: false,
        };
      }
      if (registryEntry && !registryHasModalitiesObject) {
        return {
          field: name, basis: "unknown", value: undefined, status: "unknown",
          resolution: "registry has no modalities object; unknown is never coerced to text-only", discrepancy: false, conflict: false,
        };
      }
      const lit = readLiteLLM();
      if (lit.basis === "litellm-declared" && lit.value !== undefined) {
        return {
          field: name, basis: "litellm-declared", value: lit.value, status: "selected",
          resolution: `registry omits this direction; LiteLLM declaration fills it (${lit.detail})`, discrepancy: false, conflict: false,
        };
      }
      return {
        field: name, basis: "unknown", value: undefined, status: lit.partial ? "unknown" : "missing",
        resolution: "neither the registry nor LiteLLM declares this direction completely", discrepancy: false, conflict: !!lit.conflict,
      };
    }
    const lit = readLiteLLM();
    if (lit.basis === "litellm-declared" && lit.value !== undefined) {
      return {
        field: name, basis: "litellm-declared", value: lit.value, status: "selected",
        resolution: `LiteLLM declarations decide (${lit.detail})`, discrepancy: false, conflict: false,
      };
    }
    if (lit.conflict) {
      return {
        field: name, basis: "unknown", value: undefined, status: "unresolved-conflict",
        resolution: `deployments disagree on ${lit.detail}`, discrepancy: false, conflict: true,
      };
    }
    return {
      field: name, basis: "unknown", value: undefined, status: lit.partial ? "unknown" : "missing",
      resolution: `no trusted source declares this direction (${lit.detail})`, discrepancy: false, conflict: false,
    };
  };

  const context = field(
    "limit.context",
    servingLimit("context"),
    servingRecord ? hasLimitKey(servingRecord, "context") : false,
    registryLimit("context"),
    registryEntry ? hasLimitKey(registryEntry, "context") : false,
    readContextLiteLLM,
  );
  const input = field(
    "limit.input",
    servingLimit("input"),
    servingRecord ? hasLimitKey(servingRecord, "input") : false,
    registryLimit("input"),
    registryEntry ? hasLimitKey(registryEntry, "input") : false,
    readInputLiteLLM,
  );
  const output = field(
    "limit.output",
    servingLimit("output"),
    servingRecord ? hasLimitKey(servingRecord, "output") : false,
    registryLimit("output"),
    registryEntry ? hasLimitKey(registryEntry, "output") : false,
    readOutputLiteLLM,
  );
  const tools = field(
    "capabilities.tools",
    servingTool,
    servingRecord ? (servingRecord as Record<string, unknown>).tool_call !== undefined : false,
    registryTool,
    registryEntry ? (registryEntry as Record<string, unknown>).tool_call !== undefined : false,
    readToolsLiteLLM,
  );
  const reasoning = field(
    "reasoning",
    servingReasoning,
    servingRecord ? (servingRecord as Record<string, unknown>).reasoning !== undefined : false,
    registryReasoning,
    registryEntry ? (registryEntry as Record<string, unknown>).reasoning !== undefined : false,
    readReasoningLiteLLM,
  );
  const inputModalities = modalityField(
    "capabilities.input",
    servingModalities("input"),
    servingRecord ? isRecord((servingRecord as Record<string, unknown>).modalities) : false,
    registryModalities("input"),
    registryEntry ? isRecord((registryEntry as Record<string, unknown>).modalities) : false,
    readInputModalitiesLiteLLM,
  );
  const outputModalities = modalityField(
    "capabilities.output",
    servingModalities("output"),
    servingRecord ? isRecord((servingRecord as Record<string, unknown>).modalities) : false,
    registryModalities("output"),
    registryEntry ? isRecord((registryEntry as Record<string, unknown>).modalities) : false,
    readOutputModalitiesLiteLLM,
  );

  const priceInput = resolvePriceComponent(group, "input", servingRecord);
  const priceOutput = resolvePriceComponent(group, "output", servingRecord);
  const priceCacheRead = resolvePriceComponent(group, "cacheRead", servingRecord);
  const priceCacheWrite = resolvePriceComponent(group, "cacheWrite", servingRecord);
  const releaseDate = resolveReleaseDate(servingRecord, registryEntry, servingUsable, canonicalUsable);

  return {
    context, input, output, tools, reasoning, inputModalities, outputModalities,
    priceInput, priceOutput, priceCacheRead, priceCacheWrite, releaseDate,
  };
}

function sameValue(left: number | boolean | readonly string[] | undefined, right: number | boolean | readonly string[] | undefined): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    const a = new Set(left);
    const b = new Set(right);
    if (a.size !== b.size) return false;
    for (const value of a) if (!b.has(value)) return false;
    return true;
  }
  return left === right;
}

const PRICE_LITELLM_PARAMS_KEYS: Record<string, readonly string[]> = {
  input: ["input_cost_per_token"],
  output: ["output_cost_per_token"],
  cacheRead: ["cache_read_input_token_cost"],
  cacheWrite: ["cache_creation_input_token_cost"],
};

const PRICE_MODEL_INFO_KEYS: Record<string, readonly string[]> = {
  input: ["input_cost_per_token"],
  output: ["output_cost_per_token"],
  cacheRead: ["cache_read_input_token_cost", "cache_read_cost_per_token"],
  cacheWrite: ["cache_creation_input_token_cost", "cache_write_input_token_cost"],
};

const PRICE_SERVING_KEYS: Record<string, string> = {
  input: "input",
  output: "output",
  cacheRead: "cache_read",
  cacheWrite: "cache_write",
};

function resolvePriceComponent(
  group: DeploymentGroup,
  component: "input" | "output" | "cacheRead" | "cacheWrite",
  servingRecord: Record<string, unknown> | undefined,
): FieldResolutionWithBasis {
  const fieldName = `price.${component}`;
  // Operator-declared pricing: litellm_params keys first, then model_info,
  // highest across deployments.
  const paramKeys = PRICE_LITELLM_PARAMS_KEYS[component]!;
  const infoKeys = PRICE_MODEL_INFO_KEYS[component]!;
  let paramMax: number | undefined;
  for (const deployment of group.deployments) {
    for (const key of paramKeys) {
      const value = optionalNumber(deployment.litellmParams[key]);
      if (value !== undefined && value >= 0) paramMax = Math.max(paramMax ?? -1, value);
    }
  }
  if (paramMax !== undefined && paramMax >= 0) {
    return {
      field: fieldName, basis: "litellm-declared", value: paramMax * 1_000_000, status: "selected",
      resolution: `operator-declared pricing from litellm_params (${paramKeys.join("/")})`, discrepancy: false, conflict: false,
    };
  }
  let infoMax: number | undefined;
  for (const deployment of group.deployments) {
    for (const key of infoKeys) {
      const value = optionalNumber(deployment.modelInfo[key]);
      if (value !== undefined && value >= 0) infoMax = Math.max(infoMax ?? -1, value);
    }
  }
  if (infoMax !== undefined && infoMax >= 0) {
    return {
      field: fieldName, basis: "litellm-declared", value: infoMax * 1_000_000, status: "selected",
      resolution: `operator-declared pricing from model_info (${infoKeys.join("/")})`, discrepancy: false, conflict: false,
    };
  }
  if (servingRecord && isRecord(servingRecord.cost)) {
    const raw = optionalNumber((servingRecord.cost as Record<string, unknown>)[PRICE_SERVING_KEYS[component]!]);
    if (raw !== undefined && raw >= 0) {
      return {
        field: fieldName, basis: "serving", value: raw, status: "selected",
        resolution: "proven serving record cost", discrepancy: false, conflict: false,
      };
    }
  }
  return {
    field: fieldName, basis: "unknown", value: 0, status: "selected",
    resolution: "no operator-declared pricing and no proven serving cost; unknown (0)", discrepancy: false, conflict: false,
  };
}

function resolveReleaseDate(
  servingRecord: Record<string, unknown> | undefined,
  registryEntry: Record<string, unknown> | undefined,
  servingUsable: boolean,
  canonicalUsable: boolean,
): FieldResolutionWithBasis {
  if (servingUsable && servingRecord) {
    const value = servingRecord.release_date;
    if (typeof value === "string" || typeof value === "number") {
      return {
        field: "releaseDate", basis: "serving", value: undefined, status: "selected",
        resolution: "resolved serving record release_date", discrepancy: false, conflict: false,
      };
    }
    // Serving缺失不回填canonical (Revision 7).
    return {
      field: "releaseDate", basis: "unknown", value: undefined, status: "missing",
      resolution: "serving record omits release_date; never refilled from canonical", discrepancy: false, conflict: false,
    };
  }
  if (canonicalUsable && registryEntry) {
    const value = registryEntry.release_date;
    if (typeof value === "string" || typeof value === "number") {
      return {
        field: "releaseDate", basis: "canonical", value: undefined, status: "selected",
        resolution: "canonical registry release_date", discrepancy: false, conflict: false,
      };
    }
  }
  return {
    field: "releaseDate", basis: "unknown", value: undefined, status: "missing",
    resolution: "no release_date from serving or canonical", discrepancy: false, conflict: false,
  };
}

function finishResolution(
  group: DeploymentGroup,
  catalog: NormalizedCatalog,
  protocol: Protocol,
  operatorConfigurationKeys: string[],
  identity: ResolvedIdentity,
  servingUsable: ResolvedServing,
  forcedStatus?: ResolvedModel["status"],
  originalServing?: ResolvedServing,
  options: ResolveOptions = {},
): ResolvedModel {
  const servingRecord = servingUsable.record as Record<string, unknown> | undefined;
  const registryEntry = identity.status === "proven" && identity.canonicalModelID
    ? (catalog.models[identity.canonicalModelID] as Record<string, unknown> | undefined)
    : undefined;
  const registryValid = registryEntry !== undefined && isRecord(registryEntry) ? registryEntry : undefined;

  let fields: FieldSet;
  if (identity.status === "proven" || servingUsable.status === "declared") {
    fields = resolveBranchFields(group, servingRecord, registryValid);
  } else {
    // Unproven identity, no usable serving: LiteLLM-only branch. Dimension
    // isolation has no exception here — max_input_tokens is input capacity
    // and never a context declaration, so context stays missing (G30) and the
    // group is withheld unless a valid LKG restores it.
    fields = resolveBranchFields(group, undefined, undefined);
  }
  fields = applyIllegality(group, servingRecord, registryValid, fields);

  // contextTierCap (legacy BuildOption): narrow context/input to the first
  // pricing-tier point. Applies to the resolved values, never as evidence.
  fields = applyTierCap(group, fields, options.contextTierCap);

  // Release metadata: resolved serving record wins; canonical registry next;
  // a serving omission is never refilled from canonical (Revision 7).
  const release = servingUsable.status === "declared"
    ? releaseInfoFromRecord(servingRecord)
    : registryValid
      ? releaseInfoFromRecord(registryValid)
      : { released: 0, releaseUnit: "none" as const };

  // Reasoning levels: only from the proven serving record's reasoning_options.
  const levels = resolveReasoningLevels(servingRecord, protocol);
  const operatorDefaultEffort = optionalString(group.deployments[0]?.litellmParams.reasoning_effort);
  const reasoningLevels: ReasoningLevelsState = operatorDefaultEffort
    ? { ...levels, operatorDefaultEffort }
    : levels;

  const diagnosticCandidates = buildDiagnosticCandidates(group, catalog, identity, originalServing ?? servingUsable);

  const digests = {
    registryDigest: registryValid ? stableDigest(pickRegistryFacts(registryValid)) : undefined,
    recordDigest: servingRecord ? stableDigest(pickServingFacts(servingRecord)) : undefined,
  };

  return assembleResolved(
    group,
    catalog.kind,
    protocol,
    operatorConfigurationKeys,
    identity,
    originalServing ?? servingUsable,
    fields,
    reasoningLevels,
    diagnosticCandidates,
    forcedStatus,
    digests,
    release,
  );
}

/**
 * Illegal metadata: an explicitly declared non-positive limit (descriptive
 * or operator-configuration, deployment-level or trusted record-level) is
 * illegal, never missing or a default. Attaches to the affected field.
 */
function applyIllegality(
  group: DeploymentGroup,
  servingRecord: Record<string, unknown> | undefined,
  registryEntry: Record<string, unknown> | undefined,
  fields: FieldSet,
): FieldSet {
  const illegalInputDeclared = group.deployments.some((deployment) => {
    const values = [
      optionalNumber(deployment.modelInfo.max_input_tokens),
      optionalNumber(deployment.litellmParams.max_input_tokens),
    ];
    return values.some((value) => value !== undefined && !(value > 0));
  });
  const illegalOutputDeclared = group.deployments.some((deployment) => {
    const values = [
      optionalNumber(deployment.modelInfo.max_output_tokens),
      optionalNumber(deployment.modelInfo.max_tokens),
      optionalNumber(deployment.litellmParams.max_tokens),
      optionalNumber(deployment.litellmParams.max_output_tokens),
      optionalNumber(deployment.litellmParams.max_completion_tokens),
    ];
    return values.some((value) => value !== undefined && !(value > 0));
  });
  const recordIllegal = (record: Record<string, unknown> | undefined, key: string): boolean => {
    if (!record || !isRecord(record.limit)) return false;
    const value = optionalNumber((record.limit as Record<string, unknown>)[key]);
    return value !== undefined && !(value > 0);
  };
  const illegalInputRecord = recordIllegal(servingRecord, "input") || recordIllegal(registryEntry, "input");
  const illegalOutputRecord = recordIllegal(servingRecord, "output") ||
    recordIllegal(registryEntry, "output") ||
    recordIllegal(servingRecord, "context") ||
    recordIllegal(registryEntry, "context");
  const illegalContextRecord = recordIllegal(servingRecord, "context") || recordIllegal(registryEntry, "context");
  if (!illegalInputDeclared && !illegalOutputDeclared && !illegalInputRecord && !illegalOutputRecord && !illegalContextRecord) {
    return fields;
  }
  const illegal = (field: FieldResolutionWithBasis, detail: string): FieldResolutionWithBasis => ({
    ...field,
    value: undefined,
    status: "illegal",
    resolution: detail,
    discrepancy: false,
    conflict: false,
  });
  let next = fields;
  if (illegalInputDeclared || illegalInputRecord) {
    next = { ...next, input: illegal(next.input, "declared non-positive input limit is illegal metadata; never treated as missing or as a default") };
  }
  if (illegalOutputDeclared || illegalOutputRecord) {
    next = { ...next, output: illegal(next.output, "declared non-positive output limit is illegal metadata; never treated as missing or as a default") };
  }
  if (illegalContextRecord) {
    next = { ...next, context: illegal(next.context, "trusted record non-positive context limit is illegal metadata; never treated as missing or as a default") };
  }
  return next;
}

function resolveReasoningLevels(servingRecord: Record<string, unknown> | undefined, protocol: Protocol): ReasoningLevelsState {
  if (!servingRecord) return { state: "unknown", values: [], variants: [] };
  const options = (servingRecord as Record<string, unknown>).reasoning_options;
  if (!Array.isArray(options)) return { state: "unknown", values: [], variants: [] };
  const effortKey = protocol === "messages" ? "effort" : "reasoningEffort";
  const values: string[] = [];
  const variants: Array<{ id: string; settings: Record<string, unknown> }> = [];
  const push = (id: string, settings: Record<string, unknown>) => {
    if (!values.includes(id)) {
      values.push(id);
      variants.push({ id, settings });
    }
  };
  for (const option of options) {
    if (!isRecord(option)) continue;
    if (option.type === "effort" && Array.isArray(option.values)) {
      for (const value of option.values) {
        if (typeof value === "string" && value) push(value, { [effortKey]: value });
      }
    } else if (option.type === "budget_tokens" && protocol === "messages") {
      // Legacy budget semantics (unchanged): always a high tier, plus max.
      const raw = optionalNumber(option.max);
      const maximum = raw !== undefined && raw > 0 ? Math.floor(raw) : undefined;
      const high = maximum === undefined ? 16000 : Math.min(16000, maximum);
      push("high", { thinking: { type: "enabled", budgetTokens: high } });
      if (maximum !== undefined && maximum > high) {
        push("max", { thinking: { type: "enabled", budgetTokens: maximum } });
      }
    }
    // `toggle` and unknown option types contribute no selectable levels.
  }
  // known, possibly empty (toggle-only, [] or unrecognized options).
  return { state: "known", values, variants };
}

function buildDiagnosticCandidates(
  group: DeploymentGroup,
  catalog: NormalizedCatalog,
  identity: ResolvedIdentity,
  serving: ResolvedServing,
): DiagnosticCandidate[] {
  if (catalog.kind !== "complete") return [];
  const wireIDs = new Set<string>();
  for (const deployment of group.deployments) {
    const routed = optionalString(deployment.litellmParams.model);
    if (routed) wireIDs.add(routed.trim().toLowerCase());
    const base = optionalString(deployment.modelInfo.base_model);
    if (base) wireIDs.add(base.trim().toLowerCase());
  }
  const candidates: DiagnosticCandidate[] = [];
  const push = (providerID: string, recordID: string, why: string) => {
    if (!candidates.some((c) => c.providerID === providerID && c.recordID === recordID)) {
      candidates.push({ providerID, recordID, why });
    }
  };
  const order = (providerID: string): number => {
    const lower = providerID.toLowerCase();
    if (lower === "opencode") return 0;
    if (lower === "openrouter") return 1;
    return 2;
  };
  const all: DiagnosticCandidate[] = [];
  for (const [providerID, provider] of Object.entries(catalog.providers)) {
    if (!isRecord(provider) || !isRecord((provider as Record<string, unknown>).models)) continue;
    const models = (provider as Record<string, unknown>).models as Record<string, unknown>;
    for (const [key, record] of Object.entries(models)) {
      if (!isRecord(record)) continue;
      const id = typeof (record as Record<string, unknown>).id === "string" && ((record as Record<string, unknown>).id as string)
        ? ((record as Record<string, unknown>).id as string)
        : key;
      if (wireIDs.has(key.toLowerCase()) || wireIDs.has(id.toLowerCase())) {
        all.push({ providerID, recordID: id, why: `same wire id; declare models_dev_provider: ${providerID} to select it` });
      }
    }
  }
  // Serving-record-unresolved: the declared provider holds only relation-only
  // SKU records. List the ones naming the proven canonical identity so the
  // operator knows which exact wire ids are selectable (R4b).
  if (serving.status === "serving-record-unresolved" && serving.providerID && identity.canonicalModelID) {
    const provider = catalog.providers[serving.providerID];
    if (isRecord(provider) && isRecord((provider as Record<string, unknown>).models)) {
      const models = (provider as Record<string, unknown>).models as Record<string, unknown>;
      for (const [key, record] of Object.entries(models)) {
        if (!isRecord(record)) continue;
        const relation = (record as Record<string, unknown>).canonical_model_id;
        if (typeof relation !== "string" || registryKeyLower(relation) !== registryKeyLower(identity.canonicalModelID)) continue;
        const id = typeof (record as Record<string, unknown>).id === "string" && ((record as Record<string, unknown>).id as string)
          ? ((record as Record<string, unknown>).id as string)
          : key;
        all.push({ providerID: serving.providerID, recordID: id, why: `relation-only SKU; use wire id ${id} with models_dev_provider: ${serving.providerID} to resolve it` });
      }
    }
  }
  all.sort((a, b) => order(a.providerID) - order(b.providerID) || a.recordID.localeCompare(b.recordID, "en"));
  for (const item of all) push(item.providerID, item.recordID, item.why);
  return candidates;
}

function assembleResolved(
  group: DeploymentGroup,
  catalogKind: NormalizedCatalog["kind"],
  protocol: Protocol,
  operatorConfigurationKeys: string[],
  identity: ResolvedIdentity,
  serving: ResolvedServing,
  fields: FieldSet,
  reasoningLevels: ReasoningLevelsState,
  diagnosticCandidates: readonly DiagnosticCandidate[],
  forcedStatus?: ResolvedModel["status"],
  digests: { registryDigest?: string; recordDigest?: string } = {},
  release: ResolvedModel["release"] = { released: 0, releaseUnit: "none" },
): ResolvedModel {
  const discrepancies = Object.values(fields).filter((f) => f.discrepancy);
  const conflicts = Object.values(fields).filter((f) => f.conflict);

  let status: ResolvedModel["status"];
  let publishable: boolean;
  const reasons: string[] = [];
  if (forcedStatus === "ambiguous") {
    status = "ambiguous";
    publishable = false;
    reasons.push(identity.reason ?? serving.reason ?? "identity-ambiguous");
  } else if (catalogKind !== "complete") {
    // LiteLLM-complete publishes; the rest are metadata-unavailable.
    // Illegal declared values fail in every branch (never masked).
    const gated: FieldResolutionWithBasis[] = [fields.context, fields.output, fields.tools, fields.reasoning, fields.inputModalities, fields.outputModalities];
    const blocked = gated.some((f) => f.basis === "unknown" || f.conflict);
    if (gated.some((f) => f.status === "illegal")) {
      status = "invalid-metadata";
      publishable = false;
      reasons.push("illegal-metadata");
    } else if (conflicts.length > 0) {
      status = "invalid-metadata";
      publishable = false;
      reasons.push("authoritative-conflict");
    } else if (blocked) {
      status = "metadata-unavailable";
      publishable = false;
      reasons.push("metadata-unavailable");
    } else {
      status = "configured";
      publishable = true;
    }
  } else if (identity.status === "ambiguous" || identity.status === "conflict") {
    status = "ambiguous";
    publishable = false;
    reasons.push("identity-ambiguous");
  } else if (serving.status === "serving-ambiguous") {
    status = "ambiguous";
    publishable = false;
    reasons.push("identity-ambiguous");
  } else if (conflicts.length > 0) {
    status = "invalid-metadata";
    publishable = false;
    reasons.push("authoritative-conflict");
  } else {
    const gated: FieldResolutionWithBasis[] = [fields.context, fields.output, fields.tools, fields.reasoning, fields.inputModalities, fields.outputModalities];
    const illegal = gated.filter((f) => f.status === "illegal");
    if (illegal.length > 0) {
      status = "invalid-metadata";
      publishable = false;
      reasons.push("illegal-metadata");
      for (const item of illegal) reasons.push(`${item.field}: illegal-metadata`);
    } else {
      const missing = gated.filter((f) => f.basis === "unknown");
      if (missing.length > 0) {
        status = "discovered-incomplete";
        reasons.push("incomplete-metadata");
        publishable = false;
      } else {
        status = "configured";
        publishable = true;
      }
    }
  }

  const proof = buildProof(group, identity, serving, fields, digests);
  const partial: ResolvedModel = {
    group,
    protocol,
    catalogKind,
    identity,
    serving,
    fields: {
      "limit.context": fields.context,
      "limit.input": fields.input,
      "limit.output": fields.output,
      "capabilities.tools": fields.tools,
      reasoning: fields.reasoning,
      "capabilities.input": fields.inputModalities,
      "capabilities.output": fields.outputModalities,
      "price.input": fields.priceInput,
      "price.output": fields.priceOutput,
      "price.cacheRead": fields.priceCacheRead,
      "price.cacheWrite": fields.priceCacheWrite,
      releaseDate: fields.releaseDate,
    },
    reasoningLevels,
    diagnosticCandidates,
    operatorConfigurationKeys,
    status,
    publishable,
    reasons,
    discrepancies,
    conflicts,
    proof,
    release,
    spec: undefined as unknown as ModelSpec,
  };
  const spec = toModelSpec(partial);
  return { ...partial, spec };
}

function releaseInfoFromRecord(record: Record<string, unknown> | undefined): { released: number; releaseUnit: "unix-ms" | "unknown" | "none" } {
  const sourceDate = record?.release_date;
  if (typeof sourceDate === "number" && Number.isFinite(sourceDate)) return { released: sourceDate, releaseUnit: "unknown" };
  if (typeof sourceDate === "string" && Number.isFinite(Date.parse(sourceDate))) {
    return { released: Date.parse(sourceDate), releaseUnit: "unix-ms" };
  }
  return { released: 0, releaseUnit: "none" };
}

/** First pricing-tier point in a group (contextTierCap BuildOption, unchanged legacy behavior). */
function firstTierPointOf(group: DeploymentGroup): number | undefined {
  const points: number[] = [];
  for (const deployment of group.deployments) {
    for (const [key, rawValue] of Object.entries(deployment.modelInfo)) {
      const match = /^input_cost_per_token_above_(\d+)k_tokens$/.exec(key);
      const value = optionalNumber(rawValue);
      if (match?.[1] && value !== undefined && value !== 0) points.push(Number(match[1]) * 1000);
    }
    const tiers = deployment.modelInfo.tiered_pricing;
    if (Array.isArray(tiers)) {
      for (const tier of tiers) {
        if (!isRecord(tier) || !Array.isArray(tier.range)) continue;
        const start = optionalNumber(tier.range[0]);
        if (start !== undefined && start > 0) points.push(Math.floor(start));
      }
    }
  }
  return points.length > 0 ? Math.min(...points) : undefined;
}

function applyTierCap(
  group: DeploymentGroup,
  fields: FieldSet,
  enabled: boolean | undefined,
): FieldSet {
  if (!enabled) return fields;
  const tier = firstTierPointOf(group);
  if (tier === undefined) return fields;
  const cap = (field: FieldResolutionWithBasis): FieldResolutionWithBasis =>
    typeof field.value === "number" && field.value > 0
      ? { ...field, value: Math.min(field.value, tier) }
      : field;
  return { ...fields, context: cap(fields.context), input: cap(fields.input) };
}

function deploymentStableID(deployment: { modelInfo: Record<string, unknown> }, lookupKeys: string[]): string {
  const id = optionalString(deployment.modelInfo.id);
  if (id) return `model_info.id:${id}`;
  return `evidence:${stableDigest([...lookupKeys].sort())}`;
}

function buildProof(
  group: DeploymentGroup,
  identity: ResolvedIdentity,
  serving: ResolvedServing,
  fields: FieldSet,
  digests: { registryDigest?: string; recordDigest?: string },
): LKGProof {
  const perDeployment = group.deployments.map((deployment) => {
    const candidates = deploymentCandidates({
      modelInfo: deployment.modelInfo as Record<string, unknown>,
      litellmParams: deployment.litellmParams as Record<string, unknown>,
    });
    const normalizedInputs = [...new Set(candidates.map((c) => c.value.toLowerCase()))].sort();
    const lookupKeys = normalizedInputs;
    const identityKind: IdentityKind = identity.status === "proven" && identity.canonicalModelID
      ? "canonical"
      : serving.status === "declared"
        ? "serving-only"
        : "litellm-only";
    return {
      deploymentID: deploymentStableID(deployment as { modelInfo: Record<string, unknown> }, lookupKeys),
      normalizedInputs,
      identityKind,
      // Carried BEFORE sorting so a reorder can never attach one
      // deployment's declaration to another's evidence item (review 6c).
      declared: (optionalString(deployment.modelInfo.models_dev_provider) ?? "").toLowerCase(),
      ...(identityKind === "canonical"
        ? { canonicalModelID: identity.canonicalModelID!, canonicalEvidenceKind: identity.evidence === "none" ? "registry-unique" as const : (identity.evidence as "qualified-deployment" | "registry-unique" | "serving-relation") }
        : {}),
    };
  });
  const sorted = [...perDeployment].sort((a, b) => a.deploymentID.localeCompare(b.deploymentID, "en"));

  const fieldBasis: Record<string, FieldBasis> = {
    "limit.context": fields.context.basis,
    "limit.input": fields.input.basis,
    "limit.output": fields.output.basis,
    "capabilities.tools": fields.tools.basis,
    reasoning: fields.reasoning.basis,
    "capabilities.input": fields.inputModalities.basis,
    "capabilities.output": fields.outputModalities.basis,
    "price.input": fields.priceInput.basis,
    "price.output": fields.priceOutput.basis,
    "price.cacheRead": fields.priceCacheRead.basis,
    "price.cacheWrite": fields.priceCacheWrite.basis,
    releaseDate: fields.releaseDate.basis,
  };
  const anyCanonical = Object.values(fieldBasis).includes("canonical");
  const anyLitellm = Object.values(fieldBasis).includes("litellm-declared");

  const proof: LKGProof = {
    deploymentEvidence: sorted.map(({ declared, ...item }) => item),
    ...(anyCanonical && digests.registryDigest ? { registryDigest: digests.registryDigest } : {}),
    ...(serving.status === "declared" && serving.record && digests.recordDigest
      ? {
        serving: {
          providerID: serving.providerID!,
          recordID: serving.recordID!,
          declarations: sorted.map((item) => ({
            deploymentID: item.deploymentID,
            declared: item.declared,
          })),
          recordDigest: digests.recordDigest,
        },
      }
      : {}),
    fields: fieldBasis,
    // D7a proven set is empty: shape frozen, contents empty.
    enforcementFingerprint: `sha256:${stableDigest({ proven: FROZEN_ENFORCED_KEYS })}`,
    ...(anyLitellm ? { litellmFingerprint: `sha256:${stableDigest(litellmDeclaredMaterial(group))}` } : {}),
  };
  return proof;
}

function litellmDeclaredMaterial(group: DeploymentGroup): unknown {
  // Per-deployment declared material, order-independent (review 6b): sorting
  // the serialized entries keeps the digest stable when deployments are
  // reordered. Mirrored pricing keys follow the SAME precedence as the price
  // resolution (D8/G18c/G44: litellm_params first, model_info fallback), so a
  // price that actually decides also decides the fingerprint (review 6a).
  const entries = group.deployments.map((deployment) => ({
    max_input_tokens: deployment.modelInfo.max_input_tokens ?? null,
    max_output_tokens: deployment.modelInfo.max_output_tokens ?? deployment.modelInfo.max_tokens ?? null,
    supports_function_calling: deployment.modelInfo.supports_function_calling ?? null,
    supports_reasoning: deployment.modelInfo.supports_reasoning ?? null,
    supports_vision: deployment.modelInfo.supports_vision ?? null,
    supports_pdf_input: deployment.modelInfo.supports_pdf_input ?? null,
    supports_audio_input: deployment.modelInfo.supports_audio_input ?? null,
    supports_video_input: deployment.modelInfo.supports_video_input ?? null,
    supports_audio_output: deployment.modelInfo.supports_audio_output ?? null,
    input_cost_per_token: deployment.litellmParams.input_cost_per_token ?? deployment.modelInfo.input_cost_per_token ?? null,
    output_cost_per_token: deployment.litellmParams.output_cost_per_token ?? deployment.modelInfo.output_cost_per_token ?? null,
    cache_read_input_token_cost: deployment.litellmParams.cache_read_input_token_cost ?? deployment.modelInfo.cache_read_input_token_cost ?? null,
    cache_creation_input_token_cost: deployment.litellmParams.cache_creation_input_token_cost ?? deployment.modelInfo.cache_creation_input_token_cost ?? null,
  }));
  return entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
}

// ---------------------------------------------------------------------------
// toModelSpec: the sole ModelSpec constructor
// ---------------------------------------------------------------------------

export function toModelSpec(resolved: Omit<ResolvedModel, "spec"> & { spec?: ModelSpec }): ModelSpec {
  const fields = resolved.fields;
  const num = (name: string): number => {
    const field = fields[name]!;
    return typeof field.value === "number" && field.value > 0 ? Math.floor(field.value) : 0;
  };
  const bool = (name: string): boolean => fields[name]!.value === true;
  const list = (name: string): string[] => {
    const value = fields[name]!.value;
    return Array.isArray(value) ? [...value] : ["text"];
  };
  const tools = fields["capabilities.tools"]!.basis === "unknown" ? false : bool("capabilities.tools");
  const reasoningState = fields["reasoning"]!.basis === "unknown"
    ? "unknown" as const
    : bool("reasoning") ? "supported" as const : "unsupported" as const;
  const limit: ModelLimits = {
    context: num("limit.context"),
    input: num("limit.input"),
    output: num("limit.output"),
  };
  const cost: ModelCost = {
    input: typeof fields["price.input"]!.value === "number" ? (fields["price.input"]!.value as number) : 0,
    output: typeof fields["price.output"]!.value === "number" ? (fields["price.output"]!.value as number) : 0,
    cacheRead: typeof fields["price.cacheRead"]!.value === "number" ? (fields["price.cacheRead"]!.value as number) : 0,
    cacheWrite: typeof fields["price.cacheWrite"]!.value === "number" ? (fields["price.cacheWrite"]!.value as number) : 0,
  };
  const variants = buildSpecVariants(resolved);
  return {
    id: resolved.group.modelName,
    name: resolved.group.modelName,
    protocol: resolved.protocol,
    capabilities: { tools, input: list("capabilities.input"), output: list("capabilities.output") },
    variants,
    released: resolved.release.released,
    releaseUnit: resolved.release.releaseUnit,
    cost,
    limit,
    reasoningSupported: reasoningState,
  };
}

function buildSpecVariants(resolved: Omit<ResolvedModel, "spec"> & { spec?: ModelSpec }): ModelSpec["variants"] {
  return resolved.reasoningLevels.variants.map((variant) => ({ id: variant.id, settings: { ...variant.settings } }));
}

