/**
 * Host-independent assembly of LiteLLM deployments and models.dev catalog into ModelSpec[].
 * This module contains no host SDK imports; protocol mapping belongs to each plugin adapter.
 *
 * Single-resolver invariant (D9): every ModelSpec is projected from a
 * `ResolvedModel` via `toModelSpec()`. There is no independent parsing here.
 */
import type { ModelCapabilities, ModelCost, ModelLimits } from "./capabilities.js";
import { groupLiteLLMDeployments, isRecord } from "./litellm.js";
import type { CapabilityState, ModelVariant } from "./modelsdev.js";
import type { Protocol } from "./protocol.js";
import { resolveModel, toModelSpec } from "./resolve.js";
export interface BuildOptions {
  /** Deprecated: accepted but ignored; prices never narrow capabilities. */
  contextTierCap: boolean;
  protocolOverrides: Readonly<Record<string, Protocol>>;
}
export interface ModelSpec {
  id: string;
  name: string;
  protocol: Protocol;
  capabilities: ModelCapabilities;
  variants: ModelVariant[];
  released: number;
  releaseUnit?: "unix-ms" | "unknown" | "none";
  cost: ModelCost;
  limit: ModelLimits;
  /**
   * Core-resolved reasoning support, independent from `variants`.
   * `supported` with empty `variants` is legal (no selectable levels).
   * Optional for wire compatibility with hand-built specs; adapters must
   * treat a missing value as unknown, never derive it from variant count.
   */
  reasoningSupported?: CapabilityState;
}
export type { CapabilityState } from "./modelsdev.js";
/**
 * Whether a neutral model has the minimum positive token limits required by
 * Pi/OpenCode to expose it as an operational conversational model.
 *
 * Core may retain zero as "unknown" for diagnostics/fingerprints, but adapters
 * must not publish zero context/output limits to their hosts.
 */
export function hasOperationalLimits(spec: Pick<ModelSpec, "limit">): boolean {
  return Number.isFinite(spec.limit.context) && spec.limit.context > 0 && Number.isFinite(spec.limit.output) && spec.limit.output > 0;
}
/** Shared existing critical-content checks for publication caches and snapshots. */
export function hasValidCriticalConfiguration(value: unknown): value is ModelSpec {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || value.name !== value.id)
    return false;
  if (value.protocol !== "chat" && value.protocol !== "responses" && value.protocol !== "messages")
    return false;
  if (!isRecord(value.limit) || !hasOperationalLimits(value as unknown as ModelSpec) ||
    typeof value.limit.input !== "number" || !Number.isFinite(value.limit.input) || value.limit.input < 0)
    return false;
  if (!isRecord(value.capabilities) || typeof value.capabilities.tools !== "boolean")
    return false;
  const modalities = (list: unknown) => Array.isArray(list) && list.length > 0 && list.every((item) => typeof item === "string");
  if (!modalities(value.capabilities.input) || !modalities(value.capabilities.output))
    return false;
  if (value.reasoningSupported !== "supported" && value.reasoningSupported !== "unsupported")
    return false;
  return Array.isArray(value.variants) && value.variants.every((variant) => isRecord(variant) &&
    typeof variant.id === "string" && variant.id.length > 0 && isRecord(variant.settings));
}
export function buildModelSpecs(litellmResponse: unknown, modelsDevCatalog: unknown, options: BuildOptions): ModelSpec[] {
  return groupLiteLLMDeployments(litellmResponse)
    .map((group) => {
    const resolved = resolveModel(group, modelsDevCatalog, {
      protocolOverrides: options.protocolOverrides,
      contextTierCap: options.contextTierCap,
    });
    return resolved.spec;
  })
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
}
function stableValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(stableValue);
  if (typeof value !== "object" || value === null)
    return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, item]) => [key, stableValue(item)]));
}
export function modelFingerprint(models: readonly ModelSpec[]): string {
  return JSON.stringify(stableValue(models));
}
/** Cache integrity for model identity, protocol and capabilities, excluding display metadata. */
export function criticalModelFingerprint(models: readonly ModelSpec[]): string {
  return JSON.stringify(stableValue(models.map(({ cost, released, releaseUnit, ...critical }) => critical)));
}
export { toModelSpec };
