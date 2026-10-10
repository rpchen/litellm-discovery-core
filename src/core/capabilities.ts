/** Public compatibility mapping delegates to the same model resolver. */
import { isRecord, optionalNumber, type DeploymentGroup } from "./litellm.js";
import type { SelectedModelRecord } from "./modelsdev.js";
import { resolveSelectedModel } from "./resolve.js";
export interface ModelCapabilities {
  tools: boolean;
  input: string[];
  output: string[];
}
export interface ModelLimits {
  context: number;
  input: number;
  output: number;
}
export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
export interface CapabilityResult {
  capabilities: ModelCapabilities;
  limit: ModelLimits;
  cost: ModelCost;
}
/** Optional reference prices never affect configuration validity. */
export function normalizeModelCost(value: unknown): ModelCost {
  const cost = isRecord(value) ? value : {};
  const price = (key: string) => { const value = optionalNumber(cost[key]); return value !== undefined && value >= 0 ? value : 0; };
  return { input: price("input"), output: price("output"), cacheRead: price("cacheRead"), cacheWrite: price("cacheWrite") };
}
export function mapCapabilities(group: DeploymentGroup, selected: SelectedModelRecord | undefined, contextTierCap: boolean): CapabilityResult {
  const { capabilities, limit, cost } = resolveSelectedModel(group, selected).spec;
  return { capabilities, limit, cost };
}
