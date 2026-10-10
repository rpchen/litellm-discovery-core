import { isRecord, optionalNumber, type DeploymentGroup, type LiteLLMDeployment } from "./litellm.js";
import { canonicalModelID, type SelectedModelRecord } from "./modelsdev.js";
import { resolveSelectedModel, type FieldResolutionWithBasis } from "./resolve.js";
export interface FieldEvidence {
  readonly source: EvidenceSource;
  readonly origin: EvidenceOrigin;
  readonly value: FieldEvidenceValue;
  readonly detail?: string;
}
export interface FieldResolution {
  readonly field: string;
  readonly status: FieldResolutionStatus;
  readonly value?: FieldEvidenceValue;
  readonly selectedSource: EvidenceSource;
  readonly resolution: string;
  readonly evidence: readonly FieldEvidence[];
}
export interface RuntimeConstraintKeys {
  readonly context: readonly string[];
  readonly input: readonly string[];
  readonly output: readonly string[];
  readonly modalityFlags: readonly string[];
}
export interface PublicationFieldDescriptor {
  readonly field: string;
  readonly descriptiveKeys: readonly string[];
  readonly constraintKeys: readonly string[];
  readonly intrinsicPointer: string;
}
export interface NumericFieldInput {
  readonly field: "context" | "input" | "output";
  readonly group: DeploymentGroup;
  readonly intrinsic?: number;
  readonly intrinsicDetail?: string;
  readonly intrinsicAuthority?: IntrinsicAuthority;
  readonly bounds?: readonly number[];
}
export interface NumericFieldResolution {
  readonly resolution: FieldResolution;
  readonly value: number | undefined;
  readonly known: boolean;
  readonly missing: boolean;
  readonly unknown: boolean;
  readonly illegal: boolean;
  readonly conflict: boolean;
  readonly discrepancy: boolean;
}
export interface BooleanFieldInput {
  readonly field: string;
  readonly descriptiveKey: string;
  readonly constraintKey?: string;
  readonly group: DeploymentGroup;
  readonly intrinsic?: boolean;
  readonly intrinsicDetail?: string;
  readonly intrinsicAuthority?: IntrinsicAuthority;
  readonly fallbackState: "supported" | "unsupported" | "unknown";
  readonly fallbackConflict: boolean;
}
export interface BooleanFieldResolution {
  readonly resolution: FieldResolution;
  readonly state: "supported" | "unsupported" | "unknown";
  readonly conflict: boolean;
  readonly discrepancy: boolean;
}
export interface ModalityDimension {
  readonly key: string;
  readonly modality: string;
}
export interface ModalityFieldInput {
  readonly direction: "input" | "output";
  readonly group: DeploymentGroup;
  readonly intrinsic?: readonly string[];
  readonly intrinsicDetail?: string;
  readonly intrinsicAuthority?: IntrinsicAuthority;
}
export interface ModalityFieldResolution {
  readonly resolution: FieldResolution;
  readonly values: readonly string[];
  readonly known: boolean;
  readonly discrepancy: boolean;
  readonly conflict: boolean;
}
export type EvidenceSource = "litellm" | "models.dev" | "derived" | "none";
export type EvidenceOrigin = "authoritative-intrinsic" | "fallback-serving" | "descriptive-metadata" | "deployment-constraint" | "unknown-provenance";
export type FieldEvidenceValue = string | number | boolean | readonly string[];
export type FieldResolutionStatus = "selected" | "resolved-discrepancy" | "unresolved-conflict" | "unknown" | "missing" | "illegal";
export type IntrinsicAuthority = "authoritative" | "fallback-serving";
export const RUNTIME_CONSTRAINT_KEYS: RuntimeConstraintKeys = {
  context: [],
  input: [],
  output: [],
  modalityFlags: [],
};
export const NUMERIC_FIELD_DESCRIPTORS: Readonly<Record<"context" | "input" | "output", PublicationFieldDescriptor>> = {
  context: {
    field: "limit.context",
    // Dimension isolation (D6): max_input_tokens is input capacity and NEVER
    // becomes limit.context. No LiteLLM key declares total context.
    descriptiveKeys: [],
    constraintKeys: RUNTIME_CONSTRAINT_KEYS.context,
    intrinsicPointer: "limit.context",
  },
  input: {
    field: "limit.input",
    descriptiveKeys: ["max_input_tokens"],
    constraintKeys: RUNTIME_CONSTRAINT_KEYS.input,
    intrinsicPointer: "limit.input",
  },
  output: {
    field: "limit.output",
    descriptiveKeys: ["max_output_tokens", "max_tokens"],
    constraintKeys: RUNTIME_CONSTRAINT_KEYS.output,
    intrinsicPointer: "limit.output",
  },
};
export const INPUT_MODALITY_DIMENSIONS: readonly ModalityDimension[] = [
  { key: "supports_vision", modality: "image" },
  { key: "supports_pdf_input", modality: "pdf" },
  { key: "supports_audio_input", modality: "audio" },
  { key: "supports_video_input", modality: "video" },
] as const;
export const OUTPUT_MODALITY_DIMENSIONS: readonly ModalityDimension[] = [
  { key: "supports_audio_output", modality: "audio" },
] as const;
export function modalityDimensions(direction: "input" | "output"): readonly ModalityDimension[] {
  return direction === "input" ? INPUT_MODALITY_DIMENSIONS : OUTPUT_MODALITY_DIMENSIONS;
}
function projection(group: DeploymentGroup, record?: Record<string, unknown>) {
  const name = canonicalModelID(group.modelName);
  const providerID = name.includes("/") ? name.split("/")[0]! : "metadata";
  return resolveSelectedModel(group, record ? { providerID, modelID: group.modelName, record } : undefined);
}
function evidence(item: FieldResolutionWithBasis): FieldResolution {
  return { field: item.field, value: item.value, status: item.status, selectedSource: item.basis === "models.dev" ? "models.dev" : item.basis === "litellm-declared" ? "litellm" : "none", resolution: item.resolution, evidence: [] };
}
export function isResolvedDiscrepancy(resolution: FieldResolution): boolean { return resolution.status === "resolved-discrepancy"; }
export function isUnresolvedConflict(resolution: FieldResolution): boolean { return resolution.status === "unresolved-conflict"; }
export function deploymentNumericValue(deployment: LiteLLMDeployment, descriptor: PublicationFieldDescriptor): {
  value: number;
  origin: EvidenceOrigin;
  key: string;
} | undefined {
  for (const key of descriptor.descriptiveKeys) {
    const value = optionalNumber(deployment.modelInfo[key]);
    if (value !== undefined)
      return { value, origin: "descriptive-metadata", key };
  }
  return undefined;
}
export function deploymentNumericEvidence(group: DeploymentGroup, descriptor: PublicationFieldDescriptor): readonly FieldEvidence[] {
  return group.deployments.flatMap((deployment) => { const result = deploymentNumericValue(deployment, descriptor); return result ? [{ source: "litellm" as const, origin: result.origin, value: result.value, detail: result.key }] : []; });
}
export function deploymentConstraintValue(_group: DeploymentGroup, _keys: readonly string[]): number | undefined { return undefined; }
export function modelsDevNumeric(selected: SelectedModelRecord | undefined, pointer: string): number | undefined {
  return isRecord(selected?.record.limit) ? optionalNumber(selected.record.limit[pointer.split(".").at(-1)!]) : undefined;
}
export function resolveNumericField(input: NumericFieldInput): NumericFieldResolution {
  const item = projection(input.group, input.intrinsic === undefined ? undefined : { limit: { [input.field]: input.intrinsic } }).fields["limit." + input.field]!;
  return { resolution: evidence(item), value: typeof item.value === "number" ? item.value : undefined, known: item.status === "selected", missing: item.status === "missing", unknown: item.status === "unknown", illegal: item.status === "illegal", conflict: item.conflict, discrepancy: false };
}
export function resolveBooleanField(input: BooleanFieldInput): BooleanFieldResolution {
  const name = input.field === "reasoning" ? "reasoning" : "capabilities.tools";
  const item = projection(input.group, input.intrinsic === undefined ? undefined : { [name === "reasoning" ? "reasoning" : "tool_call"]: input.intrinsic }).fields[name]!;
  return { resolution: evidence(item), state: item.value === undefined ? "unknown" : item.value === true ? "supported" : "unsupported", conflict: item.conflict, discrepancy: false };
}
export function resolveModalityField(input: ModalityFieldInput): ModalityFieldResolution {
  const item = projection(input.group, input.intrinsic === undefined ? undefined : { modalities: { [input.direction]: input.intrinsic } }).fields["capabilities." + input.direction]!;
  return { resolution: evidence(item), values: Array.isArray(item.value) ? item.value : [], known: item.value !== undefined, discrepancy: false, conflict: item.conflict };
}
export function materialDiscrepancies(resolutions: readonly FieldResolution[]): readonly FieldResolution[] { return resolutions.filter(isResolvedDiscrepancy); }
export function materialConflicts(resolutions: readonly FieldResolution[]): readonly FieldResolution[] { return resolutions.filter(isUnresolvedConflict); }
