/**
 * Wire-ID parsing (D3.1). Parsing carries no authority: it produces lookup
 * keys only. Whether a leading segment is a LiteLLM adapter is proven only
 * by an explicit `custom_llm_provider` equal to that first segment.
 *
 * Rules (case-insensitive comparison, no separator/semantic folding):
 * - bare value (no `/`) -> `bare` = value itself.
 * - qualified value -> `full` = whole value; plus `afterAdapter` = remainder
 *   after the first segment, ONLY when parse evidence exists
 *   (`custom_llm_provider` present and equals the first segment).
 * - NEVER take the last segment (tail) of an arbitrary qualified value.
 */
import { optionalString } from "./litellm.js";

export interface ParsedWireID {
  /** Original candidate value (trimmed). */
  readonly raw: string;
  /** Full value (always present). */
  readonly full: string;
  /** Bare value when the candidate has no `/`. */
  readonly bare?: string;
  /** Remainder after the adapter segment, only with parse evidence. */
  readonly afterAdapter?: string;
  /** Adapter segment that was stripped (parse metadata only). */
  readonly adapterSegment?: string;
  /** `custom_llm_provider` that provided the parse evidence, if any. */
  readonly customLLMProvider?: string;
  /** Ordered lookup keys: full -> afterAdapter (if any) -> bare (if any). */
  readonly lookupKeys: readonly string[];
}

function firstSegment(value: string): string {
  const slash = value.indexOf("/");
  return slash <= 0 ? "" : value.slice(0, slash);
}

/**
 * Parse one candidate value with its deployment's `custom_llm_provider`.
 * Returns `undefined` for empty values.
 */
export function parseWireID(candidate: string | undefined, customLLMProvider: string | undefined): ParsedWireID | undefined {
  const raw = candidate?.trim();
  if (!raw) return undefined;
  const custom = customLLMProvider?.trim();
  const customNormalized = custom ? custom.toLowerCase() : undefined;
  if (!raw.includes("/")) {
    return { raw, full: raw, bare: raw, lookupKeys: [raw] };
  }
  const full = raw;
  const first = firstSegment(raw);
  if (customNormalized && first.toLowerCase() === customNormalized) {
    const remainder = raw.slice(first.length + 1).trim();
    if (!remainder) return { raw, full, adapterSegment: first, customLLMProvider: custom, lookupKeys: [full] };
    const keys = [full, remainder];
    return {
      raw,
      full,
      afterAdapter: remainder,
      adapterSegment: first,
      customLLMProvider: custom,
      lookupKeys: keys,
    };
  }
  return { raw, full, adapterSegment: undefined, customLLMProvider: custom, lookupKeys: [full] };
}

/**
 * Ordered deployment candidate values: `model_info.base_model` first, then
 * `litellm_params.model`. Each paired with the deployment's parse evidence.
 */
export function deploymentCandidates(deployment: {
  modelInfo: Record<string, unknown>;
  litellmParams: Record<string, unknown>;
}): Array<{ value: string; customProvider: string | undefined; isBaseModel: boolean }> {
  const customProvider = optionalString(
    (deployment.litellmParams as Record<string, unknown>).custom_llm_provider,
  );
  const result: Array<{ value: string; customProvider: string | undefined; isBaseModel: boolean }> = [];
  const base = optionalString((deployment.modelInfo as Record<string, unknown>).base_model);
  if (base?.trim()) result.push({ value: base.trim(), customProvider, isBaseModel: true });
  const routed = optionalString((deployment.litellmParams as Record<string, unknown>).model);
  if (routed?.trim()) result.push({ value: routed.trim(), customProvider, isBaseModel: false });
  return result;
}
