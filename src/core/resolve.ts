/** Model names select one whole models.dev record. No serving-provider proof. */
import type { ModelSpec } from "./build.js";
import { normalizeModelsDevCatalog, type NormalizedCatalog } from "./catalog-input.js";
import { isRecord, optionalBoolean, optionalNumber, optionalString, type DeploymentGroup } from "./litellm.js";
import { buildVariants, canonicalModelID, relationTargets, releaseTimestamp, type SelectedModelRecord } from "./modelsdev.js";
import { resolveProtocol, type Protocol } from "./protocol.js";
export type FieldBasis = "models.dev" | "litellm-declared" | "unknown";
export type IdentityStatus = "proven" | "unproven" | "ambiguous";
export type IdentityEvidenceKind = "model-name" | "registry-unique" | "record-relation" | "none";
export interface ResolvedIdentity {
  readonly status: IdentityStatus;
  readonly canonicalModelID?: string;
  readonly evidence: IdentityEvidenceKind;
}
export interface FieldResolutionWithBasis {
  readonly field: string;
  readonly basis: FieldBasis;
  readonly value?: number | boolean | readonly string[];
  readonly status: "selected" | "unresolved-conflict" | "unknown" | "missing" | "illegal";
  readonly resolution: string;
  readonly discrepancy: boolean;
  readonly conflict: boolean;
}
export interface ReasoningLevelsState {
  readonly state: "unknown" | "known";
  readonly values: readonly string[];
  readonly variants: ModelSpec["variants"];
}
export interface ResolvedModel {
  readonly group: DeploymentGroup;
  readonly protocol: Protocol;
  readonly catalogKind: NormalizedCatalog["kind"];
  readonly identity: ResolvedIdentity;
  readonly selected?: SelectedModelRecord;
  readonly fields: Readonly<Record<string, FieldResolutionWithBasis>>;
  readonly reasoningLevels: ReasoningLevelsState;
  readonly status: "configured" | "discovered-incomplete" | "unmatched" | "ambiguous" | "metadata-unavailable" | "invalid-metadata";
  readonly publishable: boolean;
  readonly reasons: readonly string[];
  readonly discrepancies: readonly FieldResolutionWithBasis[];
  readonly conflicts: readonly FieldResolutionWithBasis[];
  readonly spec: ModelSpec;
  readonly release: {
    readonly released: number;
    readonly releaseUnit: "unix-ms" | "unknown" | "none";
  };
}
export interface ResolveOptions {
  readonly protocolOverrides?: Readonly<Record<string, Protocol>>;
  /** Deprecated: accepted for compatibility, ignored. */
  readonly contextTierCap?: boolean;
}
// Confirmed organization relationships, never model-name or capability tables.
const OFFICIAL_PROVIDER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  tencent: ["tencent-tokenhub"], zhipuai: ["zai"],
};
function bare(id: string): string { return id.slice(id.lastIndexOf("/") + 1); }
function records(catalog: NormalizedCatalog, providerID: string): Array<[
  string,
  Record<string, unknown>
]> {
  const provider = catalog.providers[providerID];
  return isRecord(provider) && isRecord(provider.models)
    ? Object.entries(provider.models).filter((item): item is [
      string,
      Record<string, unknown>
    ] => isRecord(item[1])) : [];
}
function recordCanonical(record: Record<string, unknown>): string | undefined {
  const id = relationTargets(record).canonical;
  return id ? canonicalModelID(id) : undefined;
}
function exactName(key: string, record: Record<string, unknown>, name: string, canonical?: string): boolean {
  const names = [key, optionalString(record.id)].filter((id): id is string => id !== undefined).map(canonicalModelID);
  if (names.includes(name) || (canonical !== undefined && names.includes(canonical)))
    return true;
  // A documented organization namespace can differ (e.g. z-ai).
  return canonical !== undefined && recordCanonical(record) === canonical && names.some((id) => bare(id) === bare(canonical));
}
function selectRecord(group: DeploymentGroup, catalog: NormalizedCatalog): {
  identity: ResolvedIdentity;
  selected?: SelectedModelRecord;
} {
  const name = canonicalModelID(group.modelName);
  const keys = Object.keys(catalog.models);
  const exact = keys.filter((key) => canonicalModelID(key) === name);
  let targets = exact.length ? exact : keys.filter((key) => !name.includes("/") && bare(canonicalModelID(key)) === name);
  if (targets.length === 0) {
    targets = [...new Set(Object.keys(catalog.providers).flatMap((providerID) => records(catalog, providerID).flatMap(([key, record]) => {
        if (!exactName(key, record, name))
          return [];
        const relation = recordCanonical(record);
        return relation ? keys.filter((key) => canonicalModelID(key) === relation) : [];
      })))];
  }
  if (targets.length > 1)
    return { identity: { status: "ambiguous", evidence: "none" } };
  const canonical = targets[0];
  if (!canonical)
    return { identity: { status: "unproven", evidence: "none" } };
  const canonicalID = canonicalModelID(canonical);
  const owner = canonicalID.split("/")[0]!;
  const identity: ResolvedIdentity = { status: "proven", canonicalModelID: canonical,
    evidence: exact.length ? "model-name" : !name.includes("/") && bare(canonicalID) === name ? "registry-unique" : "record-relation" };
  const official = [owner, ...(OFFICIAL_PROVIDER_ALIASES[owner] ?? [])];
  for (const providerID of [...official, "opencode", "openrouter"]) {
    const corresponding = records(catalog, providerID).filter(([, record]) => {
      const relation = recordCanonical(record);
      return relation === undefined || relation === canonicalID;
    });
    const exactRecords = corresponding.filter(([key, record]) => exactName(key, record, name, canonicalID));
    // Renamed official APIs can use explicit canonical relations. Resellers
    // must match the model name, so free/pro/highspeed SKUs stay distinct.
    const aliases = official.includes(providerID) ? corresponding.filter(([, record]) => recordCanonical(record) === canonicalID) : [];
    const matches = exactRecords.length ? exactRecords : aliases;
    if (matches.length !== 1)
      continue;
    const [modelID, record] = matches[0]!;
    return { identity, selected: { providerID, modelID, record, matchedCandidate: group.modelName,
        matchKind: exactRecords.length ? "exact" : "relation",
        selectionSource: providerID === "opencode" ? "opencode-fallback" : providerID === "openrouter" ? "openrouter-fallback" : "canonical-original",
        recordCanonicalID: canonical } };
  }
  return { identity };
}
function field(name: string, value: FieldResolutionWithBasis["value"], basis: FieldBasis, status: FieldResolutionWithBasis["status"] = value === undefined ? "missing" : "selected"): FieldResolutionWithBasis {
  return { field: name, value, basis: value === undefined ? "unknown" : basis, status,
    resolution: value === undefined ? `${name} is not declared` : `${basis}: ${name}`,
    discrepancy: false, conflict: status === "unresolved-conflict" };
}
function recordFields(record: Record<string, unknown>): Record<string, FieldResolutionWithBasis> {
  const limits = isRecord(record.limit) ? record.limit : {};
  const modalities = isRecord(record.modalities) ? record.modalities : {};
  const result: Record<string, FieldResolutionWithBasis> = {};
  for (const key of ["context", "input", "output"] as const) {
    const raw = limits[key];
    const numeric = optionalNumber(raw);
    const value = numeric === undefined ? undefined : Math.floor(numeric);
    result[`limit.${key}`] = field(`limit.${key}`, value !== undefined && value > 0 ? value : undefined, "models.dev", raw === undefined ? "missing" : value === undefined || value <= 0 ? "illegal" : "selected");
  }
  for (const [name, key] of [["capabilities.tools", "tool_call"], ["reasoning", "reasoning"]] as const) {
    const raw = record[key];
    result[name] = field(name, optionalBoolean(raw), "models.dev", raw === undefined ? "unknown" : typeof raw === "boolean" ? "selected" : "illegal");
  }
  for (const direction of ["input", "output"] as const) {
    const raw = modalities[direction];
    const valid = Array.isArray(raw) && raw.every((value) => typeof value === "string");
    result[`capabilities.${direction}`] = field(`capabilities.${direction}`, valid ? raw as string[] : undefined, "models.dev", raw === undefined ? "unknown" : valid ? "selected" : "illegal");
  }
  return result;
}
/** Existing independent LiteLLM-only declarations; never fill a selected record. */
function declaredFields(group: DeploymentGroup): Record<string, FieldResolutionWithBasis> {
  const result: Record<string, FieldResolutionWithBasis> = { "limit.context": field("limit.context", undefined, "unknown") };
  const aggregate = (name: string, read: (info: Record<string, unknown>) => FieldResolutionWithBasis["value"]) => {
    const values = group.deployments.map((deployment) => read(deployment.modelInfo));
    const declared = values.filter((value) => value !== undefined);
    const different = new Set(declared.map((value) => JSON.stringify(value))).size > 1;
    result[name] = field(name, !different && declared.length === values.length && values.length > 0 ? values[0] : undefined, "litellm-declared", different ? "unresolved-conflict" : declared.length === values.length && values.length > 0 ? "selected" : "unknown");
  };
  aggregate("limit.input", (info) => optionalNumber(info.max_input_tokens));
  aggregate("limit.output", (info) => optionalNumber(info.max_output_tokens) ?? optionalNumber(info.max_tokens));
  aggregate("capabilities.tools", (info) => optionalBoolean(info.supports_function_calling));
  aggregate("reasoning", (info) => optionalBoolean(info.supports_reasoning));
  for (const [direction, mappings] of [
    ["input", [["supports_vision", "image"], ["supports_audio_input", "audio"], ["supports_video_input", "video"], ["supports_pdf_input", "pdf"]]],
    ["output", [["supports_audio_output", "audio"]]],
  ] as const) {
    aggregate(`capabilities.${direction}`, (info) => mappings.every(([key]) => typeof info[key] === "boolean")
      ? ["text", ...mappings.flatMap(([key, modality]) => info[key] === true ? [modality] : [])] : undefined);
  }
  for (const name of ["limit.input", "limit.output"]) {
    const current = result[name]!;
    if (typeof current.value === "number" && current.value <= 0)
      result[name] = { ...current, value: undefined, status: "illegal" };
  }
  return result;
}
export function resolveModel(group: DeploymentGroup, catalogInput: unknown, options: ResolveOptions = {}): ResolvedModel {
  const catalog = normalizeModelsDevCatalog(catalogInput);
  const protocol = resolveProtocol(group, options.protocolOverrides ?? {});
  const { identity, selected } = catalog.kind === "complete" ? selectRecord(group, catalog) : { identity: { status: "unproven", evidence: "none" } as ResolvedIdentity, selected: undefined };
  const fields = selected ? recordFields(selected.record) : declaredFields(group);
  const optionsKnown = Array.isArray(selected?.record.reasoning_options);
  const variants = fields.reasoning?.value === true ? buildVariants(selected, protocol) : [];
  const reasoningLevels: ReasoningLevelsState = { state: optionsKnown ? "known" : "unknown", values: variants.map(({ id }) => id), variants };
  const rawRelease = selected?.record.release_date;
  const released = releaseTimestamp(selected);
  const release: ResolvedModel["release"] = { released, releaseUnit: rawRelease === undefined ? "none" : released === 0 || typeof rawRelease === "number" ? "unknown" : "unix-ms" };
  const cost = isRecord(selected?.record.cost) ? selected.record.cost : {};
  for (const [name, key] of [["input", "input"], ["output", "output"], ["cacheRead", "cache_read"], ["cacheWrite", "cache_write"]] as const) {
    const raw = optionalNumber(cost[key]);
    fields[`price.${name}`] = field(`price.${name}`, raw !== undefined && raw >= 0 ? raw : 0, selected ? "models.dev" : "unknown");
  }
  fields.releaseDate = field("releaseDate", released, selected ? "models.dev" : "unknown");
  const essential = ["limit.context", "limit.output", "capabilities.tools", "reasoning", "capabilities.input", "capabilities.output"].map((key) => fields[key]!);
  const invalid = essential.some((item) => item.status === "illegal" || item.conflict);
  const complete = essential.every((item) => item.value !== undefined && (!Array.isArray(item.value) || item.value.length > 0));
  const status: ResolvedModel["status"] = identity.status === "ambiguous" ? "ambiguous" : invalid ? "invalid-metadata" : complete ? "configured" : catalog.kind !== "complete" ? "metadata-unavailable" : selected ? "discovered-incomplete" : "unmatched";
  const partial = { group, protocol, catalogKind: catalog.kind, identity, selected, fields, reasoningLevels,
    status, publishable: status === "configured", reasons: essential.filter((item) => item.value === undefined || item.conflict || (Array.isArray(item.value) && item.value.length === 0)).map((item) => item.field),
    discrepancies: [], conflicts: Object.values(fields).filter((item) => item.conflict), release };
  return { ...partial, spec: toModelSpec(partial) };
}
/** Compatibility for callers that already obtained one selected record. */
export function resolveSelectedModel(group: DeploymentGroup, selected: SelectedModelRecord | undefined): ResolvedModel {
  const canonical = selected?.recordCanonicalID ?? (selected ? relationTargets(selected.record).canonical : undefined) ??
    (group.modelName.includes("/") ? canonicalModelID(group.modelName) : (selected?.providerID ?? "unknown") + "/" + canonicalModelID(group.modelName));
  const catalog = selected ? { models: { [canonical]: {} }, providers: { [selected.providerID]: { models: { [selected.modelID]: selected.record } } } } : undefined;
  return resolveModel(group, catalog);
}
export function toModelSpec(resolved: Omit<ResolvedModel, "spec"> & {
  spec?: ModelSpec;
}): ModelSpec {
  const number = (key: string) => typeof resolved.fields[key]?.value === "number" ? resolved.fields[key]!.value as number : 0;
  const list = (key: string) => Array.isArray(resolved.fields[key]?.value) ? [...resolved.fields[key]!.value as readonly string[]] : [];
  const reasoning = resolved.fields.reasoning?.value;
  return { id: resolved.group.modelName, name: resolved.group.modelName, protocol: resolved.protocol,
    capabilities: { tools: resolved.fields["capabilities.tools"]?.value === true, input: list("capabilities.input"), output: list("capabilities.output") },
    reasoningSupported: reasoning === undefined ? "unknown" : reasoning === true ? "supported" : "unsupported",
    variants: structuredClone(resolved.reasoningLevels.variants), released: resolved.release.released, releaseUnit: resolved.release.releaseUnit,
    limit: { context: number("limit.context"), input: number("limit.input"), output: number("limit.output") },
    cost: { input: number("price.input"), output: number("price.output"), cacheRead: number("price.cacheRead"), cacheWrite: number("price.cacheWrite") } };
}
