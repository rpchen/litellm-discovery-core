/**
 * Real-schema catalog fixtures for `adopt-modelsdev-canonical-catalog`
 * (tasks 1.2, 6.2). Shapes follow the true models.dev schema:
 * `catalog.json` = `{ providers, models }`; registry entries carry only
 * intrinsic facts (no `cost`, no `reasoning_options`, no `provider`); serving
 * records carry `cost` + `reasoning_options`; relations only via
 * `canonical_model_id`. No `aliases`/`inherits`/`equivalent_to` dependence.
 *
 * Grabbed-shape reference: live catalog 2026-10-07 13:11 UTC, models.dev
 * repo `sst/models.dev@450aa1d5`. Values below mirror the live rows named in
 * `acceptance.md` R1–R11 (trimmed to the exercised fields).
 */

export interface RegistryEntry {
  name?: string;
  limit?: { context?: number; input?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
  tool_call?: boolean;
  reasoning?: boolean;
  release_date?: string;
}

export interface ServingRecord {
  id?: string;
  canonical_model_id?: string;
  limit?: { context?: number; input?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
  tool_call?: boolean;
  reasoning?: boolean;
  reasoning_options?: unknown[];
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  release_date?: string;
}

export function catalogDoc(
  models: Record<string, RegistryEntry>,
  providers: Record<string, Record<string, ServingRecord>>,
): { providers: Record<string, { models: Record<string, ServingRecord> }>; models: Record<string, RegistryEntry> } {
  return {
    providers: Object.fromEntries(
      Object.entries(providers).map(([provider, records]) => [provider, { models: records }]),
    ),
    models,
  };
}

const TEXT_MODALITIES = { input: ["text"], output: ["text"] };

function effortOptions(values: string[]): unknown[] {
  return [{ type: "effort", values }];
}

/** R1: mimo-v2.6-pro. Registry 1048576/no-input/131072; OpenRouter reseller ignored. */
export const R1_CATALOG = catalogDoc(
  {
    "xiaomi/mimo-v2.6-pro": {
      name: "mimo-v2.6-pro",
      limit: { context: 1048576, output: 131072 },
      modalities: { input: ["text", "image"], output: ["text"] },
      tool_call: true,
      reasoning: true,
    },
  },
  {
    openrouter: {
      "mimo-v2.6-pro": {
        id: "mimo-v2.6-pro",
        canonical_model_id: "xiaomi/mimo-v2.6-pro",
        limit: { context: 1050000, output: 131072 },
        cost: { input: 1, output: 2 },
      },
    },
  },
);

export function R1_LITELLM() {
  return {
    data: [
      {
        model_name: "mimo-v2.6-pro",
        litellm_params: { model: "mimo-v2.6-pro", custom_llm_provider: "openai" },
        model_info: {
          mode: "chat",
          max_input_tokens: 1048576,
          max_output_tokens: 131072,
          supports_function_calling: true,
          supports_reasoning: true,
          supports_vision: true,
          input_cost_per_token: 2e-7,
          output_cost_per_token: 8e-7,
        },
      },
    ],
  };
}

/** R2: mimo-v2.6-flash + free variant that must never be selected. */
export const R2_CATALOG = catalogDoc(
  {
    "xiaomi/mimo-v2.6-flash": {
      name: "mimo-v2.6-flash",
      limit: { context: 1048576, output: 131072 },
      modalities: { input: ["text", "image"], output: ["text"] },
      tool_call: true,
      reasoning: true,
    },
  },
  {
    opencode: {
      "mimo-v2.6-flash-free": {
        id: "mimo-v2.6-flash-free",
        canonical_model_id: "xiaomi/mimo-v2.6-flash",
        limit: { context: 200000, output: 32000 },
        cost: { input: 0, output: 0 },
      },
    },
  },
);

export function R2_LITELLM() {
  return {
    data: [
      {
        model_name: "mimo-v2.6-flash",
        litellm_params: { model: "mimo-v2.6-flash", custom_llm_provider: "openai" },
        model_info: {
          mode: "chat",
          max_input_tokens: 1048576,
          max_output_tokens: 131072,
          supports_function_calling: true,
          supports_reasoning: true,
          supports_vision: true,
        },
      },
    ],
  };
}

/** R3 family: MiniMax-M3 (A unproven / B minimax / C opencode / D operator-config). */
export const R3_CATALOG = catalogDoc(
  {
    "minimax/MiniMax-M3": {
      name: "MiniMax-M3",
      limit: { context: 1048576, output: 512000 },
      modalities: { input: ["text", "image", "video"], output: ["text"] },
      tool_call: true,
      reasoning: true,
    },
  },
  {
    minimax: {
      "MiniMax-M3": {
        id: "MiniMax-M3",
        limit: { context: 1000000, input: 1000000, output: 512000 },
        modalities: { input: ["text", "image", "video"], output: ["text"] },
        tool_call: true,
        reasoning: true,
        reasoning_options: [{ type: "toggle" }],
        cost: { input: 0.3, output: 1.2, cache_read: 0.06 },
      },
    },
    opencode: {
      "minimax-m3": {
        id: "minimax-m3",
        canonical_model_id: "minimax/MiniMax-M3",
        limit: { context: 512000, output: 128000 },
        modalities: { input: ["text", "image", "video"], output: ["text"] },
        tool_call: true,
        reasoning: true,
        reasoning_options: [],
        cost: { input: 0.4, output: 1.0, cache_read: 0.06 },
      },
    },
  },
);

export function R3_LITELLM(extraInfo: Record<string, unknown> = {}, extraParams: Record<string, unknown> = {}) {
  return {
    data: [
      {
        model_name: "minimax-m3",
        litellm_params: { model: "minimax-m3", ...extraParams },
        model_info: {
          mode: "chat",
          base_model: "minimax-m3",
          max_input_tokens: 1000000,
          max_output_tokens: 131072,
          supports_function_calling: true,
          supports_reasoning: true,
          supports_vision: true,
          input_cost_per_token: 3e-7,
          output_cost_per_token: 12e-7,
          ...extraInfo,
        },
      },
    ],
  };
}

/**
 * R4 family: DeepSeek v4.1-flash.
 * A: serving unproven -> canonical 384000 (behavior change from 393216).
 * B: provider declared, no exact SKU -> serving-record-unresolved, still 384000.
 * C: provider + exact SKU (deepseek-flash) -> serving 393216.
 */
export const R4_CATALOG = catalogDoc(
  {
    "deepseek/deepseek-v4.1-flash": {
      name: "deepseek-v4.1-flash",
      limit: { context: 1000000, output: 384000 },
      modalities: { input: ["text"], output: ["text"] },
      tool_call: true,
      reasoning: true,
    },
  },
  {
    deepseek: {
      "deepseek-flash": {
        id: "deepseek-flash",
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
        limit: { context: 1000000, output: 393216 },
        modalities: { input: ["text"], output: ["text"] },
        tool_call: true,
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
        cost: { input: 0.2, output: 0.8 },
      },
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
        limit: { context: 1000000, output: 393216 },
        cost: { input: 0.2, output: 0.8 },
      },
      "deepseek-v4-flash-vision-exp": {
        id: "deepseek-v4-flash-vision-exp",
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
        limit: { context: 1000000, output: 393216 },
        cost: { input: 0.2, output: 0.8 },
      },
    },
  },
);

export function R4_LITELLM(extraInfo: Record<string, unknown> = {}, extraParams: Record<string, unknown> = {}) {
  return {
    data: [
      {
        model_name: "deepseek-v4.1-flash",
        litellm_params: { model: "deepseek-v4.1-flash", allowed_openai_params: ["reasoning_effort"], ...extraParams },
        model_info: {
          mode: "chat",
          base_model: "deepseek-v4.1-flash",
          max_input_tokens: 1000000,
          max_output_tokens: 131072,
          supports_function_calling: true,
          supports_reasoning: true,
          ...extraInfo,
        },
      },
    ],
  };
}

/** R5: glm-5.3-flash. Levels unknown without serving (was low/high/max). */
export const R5_CATALOG = catalogDoc(
  {
    "zhipuai/glm-5.3-flash": {
      name: "glm-5.3-flash",
      limit: { context: 1000000, output: 131072 },
      modalities: { input: ["text", "image"], output: ["text"] },
      tool_call: true,
      reasoning: true,
    },
  },
  {
    zhipuai: {
      "glm-5.3-flash": {
        id: "glm-5.3-flash",
        limit: { context: 1000000, output: 131072 },
        reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
        cost: { input: 0.5, output: 1.0 },
      },
    },
  },
);

export function R5_LITELLM() {
  return {
    data: [
      {
        model_name: "glm-5.3-flash",
        litellm_params: { model: "glm-5.3-flash" },
        model_info: {
          mode: "chat",
          max_input_tokens: 1000000,
          max_output_tokens: 131072,
          supports_function_calling: true,
          supports_reasoning: true,
          supports_vision: true,
        },
      },
    ],
  };
}

/** R6 family: kimi-k3 (canonical output 131072; serving moonshotai 1048576). */
export const R6_CATALOG = catalogDoc(
  {
    "moonshotai/kimi-k3": {
      name: "kimi-k3",
      limit: { context: 1048576, output: 131072 },
      modalities: { input: ["text", "image"], output: ["text"] },
      tool_call: true,
      reasoning: true,
    },
  },
  {
    moonshotai: {
      "kimi-k3": {
        id: "kimi-k3",
        limit: { context: 1048576, input: 1048576, output: 1048576 },
        modalities: { input: ["text", "image"], output: ["text"] },
        tool_call: true,
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
        cost: { input: 0.6, output: 2.0 },
      },
    },
  },
);

export function R6_LITELLM(extraInfo: Record<string, unknown> = {}) {
  return {
    data: [
      {
        model_name: "kimi-k3",
        litellm_params: { model: "kimi-k3" },
        model_info: {
          mode: "chat",
          max_input_tokens: 1048576,
          max_output_tokens: 1048576,
          supports_function_calling: true,
          supports_reasoning: true,
          supports_vision: true,
          ...extraInfo,
        },
      },
    ],
  };
}

/** R7: hy4-preview. Lab tencent has no provider; OpenRouter same-name ignored. */
export const R7_CATALOG = catalogDoc(
  {
    "tencent/hy4-preview": {
      name: "hy4-preview",
      limit: { context: 1024000, input: 1024000, output: 64000 },
      modalities: { input: ["text"], output: ["text"] },
      tool_call: true,
      reasoning: true,
    },
  },
  {
    openrouter: {
      "hy4-preview": {
        id: "hy4-preview",
        canonical_model_id: "tencent/hy4-preview",
        limit: { context: 1048576, output: 64000 },
        reasoning_options: [{ type: "effort", values: ["none", "low", "high"] }],
        cost: { input: 0.1, output: 0.2 },
      },
    },
  },
);

export function R7_LITELLM() {
  return {
    data: [
      {
        model_name: "hy4-preview",
        litellm_params: { model: "hy4-preview" },
        model_info: {
          mode: "chat",
          supports_function_calling: true,
          supports_reasoning: true,
          input_cost_per_token: 1e-7,
          output_cost_per_token: 2e-7,
        },
      },
    ],
  };
}

/** R8: kimi-k2.7-code via base_model minimax-m2.7 (route differs, diagnostic). */
export const R8_CATALOG = catalogDoc(
  {
    "minimax/MiniMax-M2.7": {
      name: "MiniMax-M2.7",
      limit: { context: 204800, input: 204800, output: 131072 },
      modalities: { input: ["text"], output: ["text"] },
      tool_call: true,
      reasoning: true,
    },
  },
  {
    opencode: {
      "minimax-m2.7": {
        id: "minimax-m2.7",
        canonical_model_id: "minimax/MiniMax-M2.7",
        limit: { context: 204800, output: 131072 },
        cost: { input: 0.3, output: 1.0 },
      },
    },
  },
);

export function R8_LITELLM() {
  return {
    data: [
      {
        model_name: "kimi-k2.7-code",
        litellm_params: { model: "kimi-k2.7-code" },
        model_info: {
          mode: "chat",
          base_model: "minimax-m2.7",
          max_input_tokens: 204800,
          max_output_tokens: 131072,
          supports_function_calling: true,
          supports_reasoning: true,
        },
      },
    ],
  };
}

/** R9: gpt-5.6-sol. Registry input 922000; no context/input discrepancy. */
export const R9_CATALOG = catalogDoc(
  {
    "openai/gpt-5.6-sol": {
      name: "gpt-5.6-sol",
      limit: { context: 1050000, input: 922000, output: 128000 },
      modalities: { input: ["text", "image"], output: ["text"] },
      tool_call: true,
      reasoning: true,
    },
    "openai/gpt-5.6": {
      name: "gpt-5.6",
      limit: { context: 1050000, input: 900000, output: 128000 },
      modalities: { input: ["text", "image"], output: ["text"] },
      tool_call: true,
      reasoning: true,
    },
  },
  {},
);

export function R9_LITELLM(extraParams: Record<string, unknown> = {}) {
  return {
    data: [
      {
        model_name: "gpt-5.6-sol",
        litellm_params: { model: "gpt-5.6-sol", ...extraParams },
        model_info: {
          mode: "chat",
          max_input_tokens: 922000,
          max_output_tokens: 128000,
          supports_function_calling: true,
          supports_reasoning: true,
          supports_vision: true,
          input_cost_per_token: 1e-7,
          output_cost_per_token: 5e-7,
        },
      },
    ],
  };
}

/** R9b: gpt-6-luna with operator-configured reasoning_effort (diagnostic only). */
export const R9B_CATALOG = catalogDoc(
  {
    "openai/gpt-6-luna": {
      name: "gpt-6-luna",
      limit: { context: 1050000, input: 922000, output: 128000 },
      modalities: { input: ["text", "image"], output: ["text"] },
      tool_call: true,
      reasoning: true,
    },
  },
  {
    openai: {
      "gpt-6-luna": {
        id: "gpt-6-luna",
        limit: { context: 1050000, input: 922000, output: 128000 },
        reasoning_options: [{ type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] }],
        cost: { input: 1.0, output: 4.0 },
      },
    },
  },
);

export function R9B_LITELLM() {
  return {
    data: [
      {
        model_name: "gpt-6-luna",
        litellm_params: { model: "gpt-6-luna", reasoning_effort: "max" },
        model_info: {
          mode: "chat",
          max_input_tokens: 922000,
          max_output_tokens: 128000,
          supports_function_calling: true,
          supports_reasoning: true,
          supports_vision: true,
        },
      },
    ],
  };
}

/** R10 family: unregistered private model with same-name reseller records. */
export const R10_CATALOG = catalogDoc(
  {},
  {
    opencode: {
      "acme-private-1": {
        id: "acme-private-1",
        limit: { context: 100000, output: 8000 },
        modalities: { input: ["text"], output: ["text"] },
        tool_call: true,
        reasoning: false,
        cost: { input: 0.1, output: 0.2 },
      },
    },
    openrouter: {
      "acme-private-1": {
        id: "acme-private-1",
        limit: { context: 200000, output: 16000 },
        modalities: { input: ["text"], output: ["text"] },
        tool_call: false,
        reasoning: false,
        cost: { input: 0.15, output: 0.25 },
      },
    },
  },
);

export function R10_LITELLM_BARE() {
  return {
    data: [
      {
        model_name: "acme-private-1",
        litellm_params: { model: "acme-private-1" },
        model_info: { mode: "chat" },
      },
    ],
  };
}

export function R10_LITELLM_COMPLETE(extraInfo: Record<string, unknown> = {}) {
  return {
    data: [
      {
        model_name: "acme-private-1",
        litellm_params: { model: "acme-private-1" },
        model_info: {
          mode: "chat",
          max_input_tokens: 50000,
          max_output_tokens: 4000,
          supports_function_calling: true,
          supports_reasoning: false,
          supports_vision: false,
          supports_pdf_input: false,
          supports_audio_input: false,
          supports_video_input: false,
          supports_audio_output: false,
          ...extraInfo,
        },
      },
    ],
  };
}

/** R11: private LiteLLM-only model, no records at all. */
export const R11_CATALOG = catalogDoc({}, {});

export function R11_LITELLM() {
  return {
    data: [
      {
        model_name: "acme-private-2",
        litellm_params: { model: "acme-private-2" },
        model_info: {
          mode: "chat",
          max_input_tokens: 32000,
          max_output_tokens: 8000,
          supports_function_calling: false,
          supports_reasoning: false,
          supports_vision: false,
          supports_pdf_input: false,
          supports_audio_input: false,
          supports_video_input: false,
          supports_audio_output: false,
        },
      },
    ],
  };
}

/** Requesty hy3 shape: serving record omits limit.input via base_model_omit. */
export const HY3_CATALOG = catalogDoc(
  {
    "tencent/hy3": {
      name: "hy3",
      limit: { context: 256000, input: 192000, output: 32000 },
      modalities: { input: ["text"], output: ["text"] },
      tool_call: true,
      reasoning: false,
    },
  },
  {
    requesty: {
      hy3: {
        id: "hy3",
        canonical_model_id: "tencent/hy3",
        // NOTE: no limit.input — models.dev generated this view with
        // base_model_omit = ["limit.input"]. Core must not refill it.
        limit: { context: 256000, output: 32000 },
        modalities: { input: ["text"], output: ["text"] },
        tool_call: true,
        reasoning: false,
        cost: { input: 0.2, output: 0.5 },
      },
    },
  },
);

export function HY3_LITELLM(extraInfo: Record<string, unknown> = {}) {
  return {
    data: [
      {
        model_name: "hy3",
        litellm_params: { model: "hy3" },
        model_info: {
          mode: "chat",
          base_model: "tencent/hy3",
          max_input_tokens: 192000,
          max_output_tokens: 32000,
          supports_function_calling: true,
          supports_reasoning: false,
          ...extraInfo,
        },
      },
    ],
  };
}

export { effortOptions };
