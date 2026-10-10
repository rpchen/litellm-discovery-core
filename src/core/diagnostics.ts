import { buildModelSpecs, type BuildOptions, type ModelSpec } from "./build.js";
import { normalizeModelsDevCatalog } from "./catalog-input.js";
import type { FieldResolution } from "./evidence.js";
import { groupLiteLLMDeployments, isRecord, type DeploymentGroup } from "./litellm.js";
import { type ReasoningSupportResolution, type SelectedModelRecord } from "./modelsdev.js";
import { resolveProtocolResolution, resolveProtocolSupport, type ProtocolReason, type ProtocolSupport, } from "./protocol.js";
import { assessmentFromResolved } from "./publication.js";
import { resolveModel, type ResolvedModel } from "./resolve.js";
export const DISCOVERY_DIAGNOSTICS_SCHEMA_VERSION = 1 as const;
export type DiagnosticSeverity = "info" | "warning" | "error";
export type DiagnosticStage = "model-info" | "models-list" | "models-dev" | "protocol" | "mapping" | "publication";
export type DiagnosticFieldSource = "override" | "litellm" | "models.dev" | "derived" | "default" | "none" | "lkg" | "canonical-inheritance";
export interface DiagnosticIssue {
  readonly severity: DiagnosticSeverity;
  readonly stage: DiagnosticStage;
  readonly code: string;
  readonly message: string;
  readonly modelId?: string;
}
export interface FieldProvenance {
  readonly source: DiagnosticFieldSource;
  readonly detail?: string;
}
export interface MetadataConflictDiagnostic {
  readonly field: string;
  readonly resolution: string;
}
export interface ModelQualityDiagnostic {
  readonly identity: {
    readonly canonicalCandidates: readonly string[];
    readonly matchKind?: SelectedModelRecord["matchKind"];
    readonly matchedCandidate?: string;
    readonly canonicalModelID?: string;
    readonly canonicalEvidence?: ResolvedModel["identity"]["evidence"];
    readonly canonicalStatus?: ResolvedModel["identity"]["status"];
  };
  readonly reasoning: ReasoningSupportResolution;
  readonly protocolSupport: ProtocolSupport;
  readonly fallback: "enriched" | "litellm-only";
  readonly conflicts: readonly MetadataConflictDiagnostic[];
  readonly metadataSource?: {
    readonly providerID: string;
    readonly recordID: string;
  };
  readonly reasoningLevelsState?: "unknown" | "known";
  readonly catalogKind?: ResolvedModel["catalogKind"];
}
export interface ModelDiagnostic {
  readonly id: string;
  readonly deploymentCount: number;
  readonly candidates: readonly string[];
  readonly modelsDev: {
    readonly matched: boolean;
    readonly providerID?: string;
    readonly modelID?: string;
    /** Which precedence step selected this record (observational). */
    readonly selectionSource?: string;
  };
  readonly protocol: {
    readonly value: ModelSpec["protocol"];
    readonly reason: ProtocolReason;
    readonly support: ProtocolSupport;
    readonly deploymentProtocols: readonly ModelSpec["protocol"][];
  };
  readonly quality: ModelQualityDiagnostic;
  readonly publication: {
    readonly status: import("./publication.js").ModelConfigurationStatus;
    readonly publishable: boolean;
    readonly missingFields: readonly string[];
    readonly unknownFields: readonly string[];
    readonly illegalFields: readonly string[];
    readonly conflictFields: readonly string[];
    readonly toolState: import("./publication.js").CapabilityState;
    readonly reasoningState: import("./publication.js").CapabilityState;
    readonly reasoningLevelsKnown: boolean;
    readonly reasoningLevels: readonly string[];
    readonly inheritedFields: readonly string[];
    readonly inheritanceChain: readonly string[];
    /** Recorded value differences that source authority already resolved. */
    readonly discrepancies: readonly FieldResolution[];
    /** Genuine conflicts that no authority can decide; these withhold the model. */
    readonly conflicts: readonly FieldResolution[];
    /** Proven endpoint runtime constraints that narrowed an effective value. */
    readonly deploymentConstraints: readonly {
      readonly field: string;
      readonly value: number;
    }[];
    readonly usingLKG: boolean;
    readonly lkgDetail?: string;
  };
  readonly provenance: {
    readonly protocol: FieldProvenance;
    readonly reasoning: FieldProvenance;
    readonly capabilities: {
      readonly tools: FieldProvenance;
      readonly input: FieldProvenance;
      readonly output: FieldProvenance;
    };
    readonly context: FieldProvenance;
    readonly outputLimit: FieldProvenance;
    readonly pricing: {
      readonly input: FieldProvenance;
      readonly output: FieldProvenance;
      readonly cacheRead: FieldProvenance;
      readonly cacheWrite: FieldProvenance;
    };
    readonly release: FieldProvenance;
  };
}
export interface DiscoveryMappingStats {
  readonly responseEntries: number;
  readonly deployments: number;
  readonly filteredEntries: number;
  readonly models: number;
  readonly modelsDevMatched: number;
  readonly modelsDevUnmatched: number;
  readonly protocolFallbacks: number;
}
export interface DiscoveryDiagnostics {
  readonly schemaVersion: typeof DISCOVERY_DIAGNOSTICS_SCHEMA_VERSION;
  readonly modelInfo: {
    readonly status: "ok" | "invalid";
    readonly primaryPath: "/v1/model/info";
    readonly fallbackPath: "/model/info";
  };
  readonly modelsList: {
    readonly status: "unused";
    readonly path: "/v1/models";
    readonly reason: string;
  };
  readonly modelsDev: {
    readonly status: "ok" | "degraded";
  };
  readonly stats: DiscoveryMappingStats;
  readonly models: readonly ModelDiagnostic[];
  readonly issues: readonly DiagnosticIssue[];
}
export interface DiagnoseModelSpecsResult {
  readonly models: ModelSpec[];
  readonly diagnostics: DiscoveryDiagnostics;
}
export type DiscoveryCacheSource = "network" | "memory-cache" | "stale" | "snapshot" | "none";
export interface DiscoveryCacheDiagnostics {
  readonly source: DiscoveryCacheSource;
  readonly stale: boolean;
  readonly refreshedAt?: number;
  readonly ageMs?: number;
  readonly failureCount: number;
  readonly nextRetryAt?: number;
  readonly pending: boolean;
}
export interface DiscoveryCacheDiagnosticsInput {
  readonly source: DiscoveryCacheSource;
  readonly stale?: boolean;
  readonly refreshedAt?: number;
  readonly failureCount?: number;
  readonly nextRetryAt?: number;
  readonly pending?: boolean;
}
function field(source: DiagnosticFieldSource, detail?: string): FieldProvenance { return { source, detail }; }
function catalogHasRecords(catalog: unknown): boolean { return normalizeModelsDevCatalog(catalog).kind === "complete"; }
function modelDiagnostic(group: DeploymentGroup, spec: ModelSpec, catalog: unknown, options: BuildOptions): {
  diagnostic: ModelDiagnostic;
  issues: DiagnosticIssue[];
} {
  const resolved = resolveModel(group, catalog, options);
  const selected = resolved.selected;
  const assessment = assessmentFromResolved(resolved);
  const protocol = resolveProtocolResolution(group, options.protocolOverrides);
  const support = resolveProtocolSupport(group);
  const source = (key: string): FieldProvenance => {
    const basis = resolved.fields[key]?.basis;
    return basis === "models.dev" ? field("models.dev", selected ? selected.providerID + "/" + selected.modelID : undefined)
      : basis === "litellm-declared" ? field("litellm") : field("none");
  };
  const issues: DiagnosticIssue[] = [];
  if (!assessment.publishable)
    issues.push({ severity: "warning", stage: "publication", code: "model-not-configured", modelId: group.modelName,
      message: assessment.status === "metadata-unavailable" ? "Model metadata is unavailable; retry discovery."
        : assessment.status === "unmatched" || assessment.status === "ambiguous" ? "No unique metadata record matches this model name."
          : "Model configuration is missing or has invalid fields: " + [...assessment.missingFields, ...assessment.unknownFields, ...assessment.illegalFields].join(", ") });
  return { issues, diagnostic: {
      id: spec.id, deploymentCount: group.deployments.length, candidates: [group.modelName],
      modelsDev: { matched: selected !== undefined, providerID: selected?.providerID, modelID: selected?.modelID, selectionSource: selected?.selectionSource },
      protocol: { value: spec.protocol, reason: protocol.reason, support, deploymentProtocols: protocol.deployments.map((item) => item.protocol) },
      quality: { identity: { canonicalCandidates: resolved.identity.canonicalModelID ? [resolved.identity.canonicalModelID] : [],
          canonicalModelID: resolved.identity.canonicalModelID, canonicalStatus: resolved.identity.status, canonicalEvidence: resolved.identity.evidence,
          matchKind: selected?.matchKind, matchedCandidate: selected?.matchedCandidate },
        reasoning: { supported: assessment.reasoning.state === "supported", source: selected ? "models.dev" : "litellm", conflict: assessment.reasoning.conflict },
        protocolSupport: support, fallback: selected ? "enriched" : "litellm-only", conflicts: [],
        metadataSource: selected ? { providerID: selected.providerID, recordID: selected.modelID } : undefined,
        reasoningLevelsState: resolved.reasoningLevels.state, catalogKind: resolved.catalogKind },
      publication: { status: assessment.status, publishable: assessment.publishable,
        missingFields: assessment.missingFields, unknownFields: assessment.unknownFields, illegalFields: assessment.illegalFields, conflictFields: assessment.conflictFields,
        toolState: assessment.tools.state, reasoningState: assessment.reasoning.state, reasoningLevelsKnown: assessment.reasoning.levelsKnown, reasoningLevels: assessment.reasoning.levels,
        inheritedFields: [], inheritanceChain: [], discrepancies: [], conflicts: assessment.conflicts, deploymentConstraints: [], usingLKG: false },
      provenance: { protocol: field(protocol.reason === "override" ? "override" : protocol.reason === "fallback" || protocol.reason === "mixed-fallback" ? "default" : "litellm"),
        reasoning: source("reasoning"), capabilities: { tools: source("capabilities.tools"), input: source("capabilities.input"), output: source("capabilities.output") },
        context: source("limit.context"), outputLimit: source("limit.output"), release: source("releaseDate"),
        pricing: { input: source("price.input"), output: source("price.output"), cacheRead: source("price.cacheRead"), cacheWrite: source("price.cacheWrite") } },
    } };
}
export function diagnoseModelSpecs(litellmResponse: unknown, modelsDevCatalog: unknown, options: BuildOptions): DiagnoseModelSpecsResult {
  const models = buildModelSpecs(litellmResponse, modelsDevCatalog, options);
  const groups = groupLiteLLMDeployments(litellmResponse);
  const byID = new Map(models.map((model) => [model.id, model]));
  const modelInfoData = isRecord(litellmResponse) && Array.isArray(litellmResponse.data)
    ? litellmResponse.data
    : undefined;
  const modelInfoValid = modelInfoData !== undefined;
  const responseEntries = modelInfoData?.length ?? 0;
  const deployments = groups.reduce((count, group) => count + group.deployments.length, 0);
  const issues: DiagnosticIssue[] = [];
  if (!modelInfoValid) {
    issues.push({
      severity: "error",
      stage: "model-info",
      code: "model-info-invalid",
      message: "LiteLLM model-info response does not contain a data array.",
    });
  }
  const hasCatalog = catalogHasRecords(modelsDevCatalog);
  const catalogKind = normalizeModelsDevCatalog(modelsDevCatalog).kind;
  if (!hasCatalog) {
    issues.push({
      severity: "warning",
      stage: "models-dev",
      code: catalogKind === "providers-only" ? "models-dev-providers-only" : "models-dev-degraded",
      message: catalogKind === "providers-only"
        ? "models.dev returned an unsupported catalog format; retry with catalog.json."
        : "models.dev metadata is unavailable; retry discovery.",
    });
  }
  issues.push({
    severity: "info",
    stage: "models-list",
    code: "models-list-unused",
    message: "/v1/models is intentionally not used as a discovery source because it can contain stale allow-list entries.",
  });
  const modelDiagnostics: ModelDiagnostic[] = [];
  for (const group of groups) {
    const spec = byID.get(group.modelName);
    if (!spec)
      continue;
    const result = modelDiagnostic(group, spec, modelsDevCatalog, options);
    modelDiagnostics.push(result.diagnostic);
    issues.push(...result.issues);
  }
  modelDiagnostics.sort((left, right) => left.id.localeCompare(right.id, "en"));
  const matched = modelDiagnostics.filter((item) => item.modelsDev.matched).length;
  const protocolFallbacks = modelDiagnostics.filter((item) => item.protocol.reason === "fallback" || item.protocol.reason === "mixed-fallback").length;
  return {
    models,
    diagnostics: {
      schemaVersion: DISCOVERY_DIAGNOSTICS_SCHEMA_VERSION,
      modelInfo: {
        status: modelInfoValid ? "ok" : "invalid",
        primaryPath: "/v1/model/info",
        fallbackPath: "/model/info",
      },
      modelsList: {
        status: "unused",
        path: "/v1/models",
        reason: "Not a trusted discovery source; model-info remains authoritative.",
      },
      modelsDev: { status: hasCatalog ? "ok" : "degraded" },
      stats: {
        responseEntries,
        deployments,
        filteredEntries: Math.max(0, responseEntries - deployments),
        models: models.length,
        modelsDevMatched: matched,
        modelsDevUnmatched: modelDiagnostics.length - matched,
        protocolFallbacks,
      },
      models: modelDiagnostics,
      issues,
    },
  };
}
export function createDiscoveryCacheDiagnostics(input: DiscoveryCacheDiagnosticsInput, now = Date.now()): DiscoveryCacheDiagnostics {
  const refreshedAt = input.refreshedAt;
  return {
    source: input.source,
    stale: input.stale ?? (input.source === "stale" || input.source === "snapshot"),
    refreshedAt,
    ageMs: refreshedAt === undefined ? undefined : Math.max(0, now - refreshedAt),
    failureCount: Math.max(0, Math.floor(input.failureCount ?? 0)),
    nextRetryAt: input.nextRetryAt,
    pending: input.pending ?? false,
  };
}
