import { groupLiteLLMDeployments } from "../../src/core/litellm.ts";
export const options = { contextTierCap: false, protocolOverrides: {} };
export function modelRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "model", canonical_model_id: "lab/model", tool_call: true, reasoning: false, reasoning_options: [],
    modalities: { input: ["text"], output: ["text"] }, limit: { context: 100000, input: 90000, output: 10000 },
    cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 }, ...overrides };
}
export function metadataCatalog(record: Record<string, unknown> = modelRecord()) {
  return { models: { "lab/model": { ...modelRecord(), ...record } }, providers: { lab: { models: { model: record } } } };
}
export function response(name = "model", info: Record<string, unknown> = {}, params: Record<string, unknown> = {}) {
  return { data: [{ model_name: name, model_info: { mode: "chat", ...info }, litellm_params: params }] };
}
export function group(name = "model", info: Record<string, unknown> = {}, params: Record<string, unknown> = {}) {
  return groupLiteLLMDeployments(response(name, info, params))[0]!;
}
