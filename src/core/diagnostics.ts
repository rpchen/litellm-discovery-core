import { buildModelSpecs, hasOperationalLimits, type BuildOptions, type ModelSpec } from "./build.js";
import {
  groupLiteLLMDeployments,
  isRecord,
  optionalBoolean,
  optionalNumber,
  optionalString,
  positiveInteger,
  type DeploymentGroup,
  type LiteLLMDeployment,
} from "./litellm.js";
import {
  canUseSelectedModelsDevPrice,
  candidateModelIDs,
  canonicalModelID,
  resolveReasoningSupport,
  selectModelsDevRecord,
  type ReasoningSupportResolution,
  type SelectedModelRecord,
} from "./modelsdev.js";
import { assessmentFromResolved, type CompletenessAssessment } from "./publication.js";
import { normalizeModelsDevCatalog } from "./catalog-input.js";
import { resolveModel, type FieldBasis, type ResolvedModel } from "./resolve.js";
import type { FieldResolution } from "./evidence.js";
import {
  resolveProtocolResolution,
  resolveProtocolSupport,
  type ProtocolReason,
  type ProtocolSupport,
} from "./protocol.js";

export const DISCOVERY_DIAGNOSTICS_SCHEMA_VERSION = 1 as const;

export type DiagnosticSeverity = "info" | "warning" | "error";
export type DiagnosticStage = "model-info" | "models-list" | "models-dev" | "protocol" | "mapping" | "publication";
export type DiagnosticFieldSource =
  | "override"
  | "litellm"
  | "models.dev"
  | "derived"
  | "default"
  | "none"
  | "lkg"
  | "canonical-inheritance";

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
    readonly matchKind?: "exact" | "canonical" | "alias" | "relation";
    readonly matchedCandidate?: string;
    /**
     * Where the canonical identity evidence comes from: a provider-declared
     * canonical relation, the deployments' own declarations, or nothing
     * provable. Observational only.
     */
    readonly identityProvenance?: "provider-relation" | "deployment-declaration" | "unknown";
    /** Canonical identity from the single resolver (D9, diagnostics 4.3). */
    readonly canonicalModelID?: string;
    readonly canonicalEvidence?: ResolvedModel["identity"]["evidence"];
    readonly canonicalStatus?: ResolvedModel["identity"]["status"];
    readonly adapterSegment?: string;
    readonly customLLMProvider?: string;
  };
  readonly reasoning: ReasoningSupportResolution;
  readonly protocolSupport: ProtocolSupport;
  readonly fallback: "enriched" | "litellm-only";
  readonly conflicts: readonly MetadataConflictDiagnostic[];
  /** Serving status from the single resolver. */
  readonly serving?: {
    readonly status: ResolvedModel["serving"]["status"];
    readonly providerID?: string;
    readonly recordID?: string;
  };
  /** Per-field basis from the single resolver. */
  readonly fieldBasis?: Readonly<Record<string, FieldBasis>>;
  /** Selectable reasoning levels state (unknown vs known). */
  readonly reasoningLevelsState?: "unknown" | "known";
  /** Non-pricing litellm_params keys as operator configuration (never enforcement). */
  readonly operatorConfigurationKeys?: readonly string[];
  /** Unproven exact-id records listed as declaration hints only. */
  readonly diagnosticCandidates?: ReadonlyArray<{ providerID: string; recordID: string; why: string }>;
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

function field(source: DiagnosticFieldSource, detail?: string): FieldProvenance {
  return detail ? { source, detail } : { source };
}

function catalogHasRecords(catalog: unknown): boolean {
  const normalized = normalizeModelsDevCatalog(catalog);
  if (normalized.kind !== "complete") return false;
  return Object.values(normalized.providers).some((provider) =>
    isRecord(provider) &&
    isRecord(provider.models) &&
    Object.keys(provider.models).length > 0
  );
}

function basisProvenance(basis: FieldBasis | undefined, modelDevDetail: string, litellmDetail: string): FieldProvenance {
  if (basis === "serving" || basis === "canonical") return field("models.dev", modelDevDetail);
  if (basis === "litellm-declared") return field("litellm", litellmDetail);
  if (basis === "enforcement-narrowed") return field("override", "promoted runtime-enforcement key");
  return field("default", "no trusted evidence");
}

function modelsDevBoolean(selected: SelectedModelRecord | undefined, key: string): boolean {
  return optionalBoolean(selected?.record[key]) !== undefined;
}

function modelsDevNumber(
  selected: SelectedModelRecord | undefined,
  objectKey: "limit" | "cost",
  key: string,
): number | undefined {
  const object = selected?.record[objectKey];
  return isRecord(object) ? optionalNumber(object[key]) : undefined;
}

function modelsDevObjectNumber(
  selected: SelectedModelRecord | undefined,
  objectKey: "limit" | "cost",
  key: string,
): boolean {
  return modelsDevNumber(selected, objectKey, key) !== undefined;
}

function anyDeploymentBoolean(group: DeploymentGroup, key: string): boolean {
  return group.deployments.some((deployment) => optionalBoolean(deployment.modelInfo[key]) !== undefined);
}

function anyDeploymentPositiveInteger(group: DeploymentGroup, keys: readonly string[]): boolean {
  return group.deployments.some((deployment) =>
    keys.some((key) => positiveInteger(deployment.modelInfo[key]) !== undefined)
  );
}

function anyDeploymentNonNegativeNumber(group: DeploymentGroup, keys: readonly string[]): boolean {
  return group.deployments.some((deployment) =>
    keys.some((key) => {
      const value = optionalNumber(deployment.modelInfo[key]);
      return value !== undefined && value >= 0;
    })
  );
}

function anyModelsDevModalities(
  selected: SelectedModelRecord | undefined,
  direction: "input" | "output",
): boolean {
  const modalities = selected?.record.modalities;
  return isRecord(modalities) && Array.isArray(modalities[direction]) && modalities[direction].length > 0;
}

function capabilitySource(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  kind: "tools" | "input" | "output",
): FieldProvenance {
  if (kind === "tools") {
    if (anyDeploymentBoolean(group, "supports_function_calling")) return field("litellm");
    if (modelsDevBoolean(selected, "tool_call")) return field("models.dev");
    return field("default", "tools defaults to enabled when neither source declares support");
  }

  const fields = kind === "input"
    ? ["supports_vision", "supports_pdf_input", "supports_audio_input", "supports_video_input"]
    : ["supports_audio_output"];
  if (fields.some((key) => anyDeploymentBoolean(group, key))) return field("litellm");
  if (anyModelsDevModalities(selected, kind)) return field("models.dev");
  return field("default", "text-only baseline");
}

function firstTierPoint(deployment: LiteLLMDeployment): number | undefined {
  const points: number[] = [];
  for (const [key, raw] of Object.entries(deployment.modelInfo)) {
    const match = /^input_cost_per_token_above_(\d+)k_tokens$/.exec(key);
    const value = optionalNumber(raw);
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
  return points.length > 0 ? Math.min(...points) : undefined;
}

function contextProvenance(resolved: ResolvedModel): FieldProvenance {
  return basisProvenance(resolved.fields["limit.context"]?.basis, "limit.context", "LiteLLM context declaration");
}

function outputLimitProvenance(resolved: ResolvedModel): FieldProvenance {
  return basisProvenance(resolved.fields["limit.output"]?.basis, "limit.output", "max_output_tokens");
}

function pricingProvenance(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  deploymentFields: readonly string[],
  modelsDevKey: string,
  resolvedBasis: FieldBasis | undefined,
): FieldProvenance {
  if (anyDeploymentNonNegativeNumber(group, deploymentFields)) return field("litellm");
  if (modelsDevObjectNumber(selected, "cost", modelsDevKey)) {
    if (canUseSelectedModelsDevPrice(selected)) return field("models.dev");
    return field(
      "default",
      `models.dev ${selected?.selectionSource ?? "fallback"} price ignored; capability fallback is not deployment pricing`,
    );
  }
  if (resolvedBasis === "litellm-declared") return field("litellm", "operator-declared pricing");
  if (resolvedBasis === "serving") return field("models.dev", "proven serving record cost");
  return field("default", "missing price metadata maps to zero");
}

function metadataConflicts(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  reasoning: ReasoningSupportResolution,
): MetadataConflictDiagnostic[] {
  const conflicts: MetadataConflictDiagnostic[] = [];
  const mdTools = optionalBoolean(selected?.record.tool_call);
  if (
    mdTools !== undefined &&
    group.deployments.some((deployment) => {
      const value = optionalBoolean(deployment.modelInfo.supports_function_calling);
      return value !== undefined && value !== mdTools;
    })
  ) {
    conflicts.push({
      field: "capabilities.tools",
      resolution: "explicit LiteLLM values win per deployment; the group uses the conservative intersection",
    });
  }

  if (reasoning.conflict) {
    conflicts.push({
      field: "reasoning",
      resolution: "explicit LiteLLM supports_reasoning wins per deployment before models.dev fallback",
    });
  }

  return conflicts;
}

function releaseProvenance(resolved: ResolvedModel): FieldProvenance {
  const basis = resolved.fields["releaseDate"]?.basis;
  if (basis === "serving" || basis === "canonical") return field("models.dev");
  return field("none");
}

function protocolProvenance(reason: ProtocolReason): FieldProvenance {
  switch (reason) {
    case "override":
      return field("override", "protocolOverrides");
    case "anthropic":
      return field("litellm", "Anthropic provider or Claude-family evidence");
    case "supported-endpoints":
      return field("litellm", "supported_endpoints");
    case "mode":
      return field("litellm", "mode");
    case "mixed-fallback":
      return field("derived", "deployment protocols disagree; conservative chat fallback");
    case "fallback":
      return field("default", "no stronger protocol evidence; chat fallback");
  }
}

/**
 * Whether every deployment of the group declares its own identity evidence
 * (base model or route). Pure observation for diagnostics.
 */
function identityProvenanceFromDeployment(group: DeploymentGroup): boolean {
  return group.deployments.every((deployment) =>
    optionalString(deployment.modelInfo.base_model) !== undefined ||
    optionalString(deployment.litellmParams.model) !== undefined,
  );
}

function modelDiagnostic(
  group: DeploymentGroup,
  spec: ModelSpec,
  catalog: unknown,
  options: BuildOptions,
): { diagnostic: ModelDiagnostic; issues: DiagnosticIssue[] } {
  // Single-resolver derivation: one resolution feeds the spec-equality
  // invariant, the publication assessment, and every diagnostic field.
  const resolved = resolveModel(group, catalog, {
    protocolOverrides: options.protocolOverrides,
    contextTierCap: options.contextTierCap,
  });
  const selected = selectModelsDevRecord(group, catalog);
  const protocol = resolveProtocolResolution(group, options.protocolOverrides);
  const reasoning = resolveReasoningSupport(group, selected);
  const conflicts = metadataConflicts(group, selected, reasoning);
  const publication: CompletenessAssessment = assessmentFromResolved(resolved);
  const issues: DiagnosticIssue[] = [];

  if (!selected) {
    if (publication.identity.outcome === "ambiguous") {
      issues.push({
        severity: "warning",
        stage: "models-dev",
        code: "models-dev-ambiguous",
        modelId: group.modelName,
        message: `Multiple models.dev providers match this LiteLLM model (${publication.identity.ambiguousProviders.join(", ")}); enrichment stays unresolved instead of guessing.`,
      });
    } else if (resolved.identity.status === "proven") {
      issues.push({
        severity: "info",
        stage: "models-dev",
        code: "models-dev-canonical-only",
        modelId: group.modelName,
        message: `Canonical identity ${resolved.identity.canonicalModelID} proven from the registry; no serving provider declared, so intrinsic facts apply without serving overrides.`,
      });
    } else {
      issues.push({
        severity: "warning",
        stage: "models-dev",
        code: "models-dev-unmatched",
        modelId: group.modelName,
        message: "No models.dev record matched this LiteLLM model.",
      });
    }
  }
  if (resolved.serving.status === "serving-record-unresolved") {
    issues.push({
      severity: "warning",
      stage: "models-dev",
      code: "serving-record-unresolved",
      modelId: group.modelName,
      message: `Provider ${resolved.serving.providerID} is declared but holds no record matching the wire id; relation-only records never resolve the SKU. Declare an exact wire id or change the provider declaration.`,
    });
  }
  if (resolved.serving.status === "declared-unmatched") {
    issues.push({
      severity: "warning",
      stage: "models-dev",
      code: "serving-declared-unmatched",
      modelId: group.modelName,
      message: `Declared provider is absent or holds no matching record; resolving as serving-unproven.`,
    });
  }
  if (resolved.serving.status === "serving-ambiguous") {
    issues.push({
      severity: "warning",
      stage: "models-dev",
      code: "serving-ambiguous",
      modelId: group.modelName,
      message: `Provider holds materially different exact records for the wire id; withheld instead of guessing.`,
    });
  }
  if (resolved.identity.routeDiffers) {
    issues.push({
      severity: "info",
      stage: "models-dev",
      code: "identity-route-differs",
      modelId: group.modelName,
      message: `base_model decides the deployment identity; the route resolves differently (diagnostic only).`,
    });
  }
  for (const key of resolved.operatorConfigurationKeys) {
    issues.push({
      severity: "info",
      stage: "mapping",
      code: "operator-configuration",
      modelId: group.modelName,
      message: `${key} is operator configuration (no proven enforcement): it narrows nothing and enters no fingerprint.`,
    });
  }
  // Configuration-validity diagnostics (D7a/G20d): a non-positive operator-
  // configuration limit is reported so the operator can fix the deployment
  // configuration, but it is NOT capability evidence — it never withholds
  // the model, never marks a field illegal, and never invalidates an LKG
  // entry. The publication gate stays untouched by these keys.
  for (const key of resolved.operatorConfigurationIssueKeys) {
    issues.push({
      severity: "warning",
      stage: "mapping",
      code: "operator-configuration-invalid-value",
      modelId: group.modelName,
      message: `${key} declares a non-positive limit; the operator configuration is invalid, but unproven keys never gate publication — fix the deployment configuration.`,
    });
  }
  if (!hasOperationalLimits(spec)) {
    issues.push({
      severity: "warning",
      stage: "mapping",
      code: "model-operational-limits-missing",
      modelId: group.modelName,
      message: "Model context/output limits are not positive; host adapters must not publish this model as operational.",
    });
  }
  if (!publication.publishable) {
    const gaps = [...publication.missingFields, ...publication.unknownFields, ...publication.illegalFields, ...publication.conflictFields];
    issues.push({
      severity: "warning",
      stage: "publication",
      code: `publication-${publication.status}`,
      modelId: group.modelName,
      message: `Model is not normally publishable (status ${publication.status})${gaps.length > 0 ? `: ${gaps.join(", ")}` : ""}.`,
    });
  }
  for (const conflict of publication.conflicts) {
    issues.push({
      severity: "warning",
      stage: "publication",
      code: "publication-conflict",
      modelId: group.modelName,
      message: `${conflict.field}: unresolved conflict from same-level evidence; ${conflict.resolution}`,
    });
  }
  for (const discrepancy of publication.discrepancies) {
    issues.push({
      severity: "info",
      stage: "publication",
      code: "metadata-discrepancy",
      modelId: group.modelName,
      message: `${discrepancy.field}: resolved discrepancy; ${discrepancy.resolution}`,
    });
  }
  for (const conflict of conflicts) {
    issues.push({
      severity: "info",
      stage: "mapping",
      code: "metadata-conflict",
      modelId: group.modelName,
      message: `${conflict.field}: ${conflict.resolution}`,
    });
  }

  if (protocol.reason === "mixed-fallback") {
    issues.push({
      severity: "warning",
      stage: "protocol",
      code: "protocol-mixed-fallback",
      modelId: group.modelName,
      message: "Deployments disagree on protocol; chat fallback is used.",
    });
  } else if (protocol.reason === "fallback") {
    issues.push({
      severity: "info",
      stage: "protocol",
      code: "protocol-default-fallback",
      modelId: group.modelName,
      message: "No explicit protocol evidence was found; chat fallback is used.",
    });
  }

  const fieldBasis: Record<string, FieldBasis> = Object.fromEntries(
    Object.entries(resolved.fields).map(([name, item]) => [name, item.basis]),
  );

  return {
    diagnostic: {
      id: group.modelName,
      deploymentCount: group.deployments.length,
      candidates: candidateModelIDs(group),
      modelsDev: selected
        ? { matched: true, providerID: selected.providerID, modelID: selected.modelID, selectionSource: selected.selectionSource }
        : { matched: false },
      protocol: {
        value: spec.protocol,
        reason: protocol.reason,
        support: resolveProtocolSupport(group),
        deploymentProtocols: protocol.deployments.map((item) => item.protocol),
      },
      quality: {
        identity: {
          canonicalCandidates: [...new Set(candidateModelIDs(group).map(canonicalModelID))],
          matchKind: selected?.matchKind,
          matchedCandidate: selected?.matchedCandidate,
          identityProvenance: selected?.recordCanonicalID !== undefined
            ? "provider-relation"
            : selected !== undefined || identityProvenanceFromDeployment(group)
              ? "deployment-declaration"
              : "unknown",
          canonicalModelID: resolved.identity.canonicalModelID,
          canonicalEvidence: resolved.identity.evidence,
          canonicalStatus: resolved.identity.status,
          adapterSegment: resolved.identity.parse.adapterSegment,
          customLLMProvider: resolved.identity.parse.customLLMProvider,
        },
        reasoning,
        protocolSupport: resolveProtocolSupport(group),
        fallback: selected ? "enriched" : "litellm-only",
        conflicts,
        serving: {
          status: resolved.serving.status,
          providerID: resolved.serving.providerID,
          recordID: resolved.serving.recordID,
        },
        fieldBasis,
        reasoningLevelsState: resolved.reasoningLevels.state,
        operatorConfigurationKeys: [...resolved.operatorConfigurationKeys],
        diagnosticCandidates: resolved.diagnosticCandidates.map((item) => ({ ...item })),
        catalogKind: resolved.catalogKind,
      },
      publication: {
        status: publication.status,
        publishable: publication.publishable,
        missingFields: [...publication.missingFields],
        unknownFields: [...publication.unknownFields],
        illegalFields: [...publication.illegalFields],
        conflictFields: [...publication.conflictFields],
        toolState: publication.tools.state,
        reasoningState: publication.reasoning.state,
        reasoningLevelsKnown: publication.reasoning.levelsKnown,
        reasoningLevels: [...publication.reasoning.levels],
        inheritedFields: [...publication.inheritedFields],
        inheritanceChain: [...publication.inheritanceChain],
        discrepancies: publication.discrepancies.map((resolution) => ({ ...resolution })),
        conflicts: publication.conflicts.map((resolution) => ({ ...resolution })),
        deploymentConstraints: [],
        usingLKG: publication.usingLKG,
        lkgDetail: publication.lkgDetail,
      },
      provenance: {
        protocol: protocolProvenance(protocol.reason),
        reasoning: resolved.reasoningLevels.values.length > 0
          ? field("models.dev", "reasoning_options")
          : reasoning.source === "litellm"
            ? field("litellm", "supports_reasoning")
            : reasoning.source === "models.dev"
              ? field("models.dev", "reasoning")
              : reasoning.source === "derived"
                ? field("derived", "LiteLLM and models.dev reasoning evidence")
                : field("none", "no reasoning support metadata"),
        capabilities: {
          tools: capabilitySource(group, selected, "tools"),
          input: capabilitySource(group, selected, "input"),
          output: capabilitySource(group, selected, "output"),
        },
        context: contextProvenance(resolved),
        outputLimit: outputLimitProvenance(resolved),
        pricing: {
          input: pricingProvenance(group, selected, ["input_cost_per_token"], "input", resolved.fields["price.input"]?.basis),
          output: pricingProvenance(group, selected, ["output_cost_per_token"], "output", resolved.fields["price.output"]?.basis),
          cacheRead: pricingProvenance(
            group,
            selected,
            ["cache_read_input_token_cost", "cache_read_cost_per_token"],
            "cache_read",
            resolved.fields["price.cacheRead"]?.basis,
          ),
          cacheWrite: pricingProvenance(
            group,
            selected,
            ["cache_creation_input_token_cost", "cache_write_input_token_cost"],
            "cache_write",
            resolved.fields["price.cacheWrite"]?.basis,
          ),
        },
        release: releaseProvenance(resolved),
      },
    },
    issues,
  };
}

/**
 * Diagnose discovery. `buildModelSpecs` models equal the diagnostics models
 * (single-resolver invariant G22): both project the same resolutions.
 */
export function diagnoseModelSpecs(
  litellmResponse: unknown,
  modelsDevCatalog: unknown,
  options: BuildOptions,
): DiagnoseModelSpecsResult {
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
        ? "models.dev payload is a legacy provider map without a canonical registry; canonical identity is unavailable, LiteLLM-only metadata is used."
        : "models.dev metadata is unavailable or empty; LiteLLM-only metadata is used.",
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
    if (!spec) continue;
    const result = modelDiagnostic(group, spec, modelsDevCatalog, options);
    modelDiagnostics.push(result.diagnostic);
    issues.push(...result.issues);
  }
  modelDiagnostics.sort((left, right) => left.id.localeCompare(right.id, "en"));

  const matched = modelDiagnostics.filter((item) => item.modelsDev.matched).length;
  const protocolFallbacks = modelDiagnostics.filter(
    (item) => item.protocol.reason === "fallback" || item.protocol.reason === "mixed-fallback",
  ).length;

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

export function createDiscoveryCacheDiagnostics(
  input: DiscoveryCacheDiagnosticsInput,
  now = Date.now(),
): DiscoveryCacheDiagnostics {
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
