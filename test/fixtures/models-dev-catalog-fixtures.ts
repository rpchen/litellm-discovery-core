/**
 * Sanitized, offline fixtures for the canonical provider selection precedence
 * regression (see `fix-canonical-provider-selection-precedence`).
 *
 * The DeepSeek shape mirrors the real public models.dev catalog: the official
 * provider serves the canonical model under serving-SKU record ids
 * (`deepseek-v4-flash`, `deepseek-flash`), each carrying a
 * `canonical_model_id` relation pointing at `deepseek/deepseek-v4.1-flash`,
 * while OpenRouter resells it under its own namespaced id with a reseller
 * serving limit (943718) and OpenCode lists it with its own serving limit.
 *
 * These are data fixtures only: no production code may branch on a model or
 * provider name to reproduce any expected outcome here.
 */

/** Real-catalog DeepSeek V4.1 Flash shape across three providers. */
export const DEEPSEEK_V4_1_FLASH_CATALOG = {
  deepseek: {
    models: {
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 393_216 },
        cost: { input: 0.15, output: 0.6 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
      "deepseek-flash": {
        id: "deepseek-flash",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 393_216 },
        cost: { input: 0.15, output: 0.6 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
      "deepseek-v4-flash-vision-exp": {
        id: "deepseek-v4-flash-vision-exp",
        status: "deprecated",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 393_216 },
        cost: { input: 0.15, output: 0.6 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
    },
  },
  openrouter: {
    models: {
      "deepseek/deepseek-v4.1-flash": {
        id: "deepseek/deepseek-v4.1-flash",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_048_576, output: 943_718 },
        cost: { input: 0.0033, output: 3.3, cache_read: 0.0033 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
    },
  },
  opencode: {
    models: {
      "deepseek-v4.1-flash": {
        id: "deepseek-v4.1-flash",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 384_000 },
        cost: { input: 0.3, output: 1.2, cache_read: 0.006 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
    },
  },
} as const

/** LiteLLM model_info for the observed real deployment (route `deepseek-v4.1-flash`). */
export const DEEPSEEK_V4_1_FLASH_LITELLM = {
  data: [
    {
      model_name: "deepseek-v4.1-flash",
      litellm_params: { model: "deepseek-v4.1-flash", custom_llm_provider: "openai" },
      model_info: {
        mode: "responses",
        base_model: "deepseek-v4.1-flash",
        max_input_tokens: 1_000_000,
        max_output_tokens: 384_000,
        max_tokens: 384_000,
        supports_vision: true,
        supports_pdf_input: false,
        supports_audio_input: false,
        supports_function_calling: true,
        supports_reasoning: true,
      },
    },
  ],
} as const

/**
 * Deterministic canonical relation records for relation-semantics coverage.
 * Every entry proves its identity through exactly one declared relation kind.
 */
export const RELATION_SEMANTICS_CATALOG = {
  /** `base_model` relation (provider-scoped record serving an upstream model). */
  vendorbase: {
    models: {
      "base-sku": {
        id: "base-sku",
        base_model: "vendorbase/rel-model",
        limit: { context: 100_000, output: 10_000 },
        tool_call: true,
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
  /** `canonical_model_id` relation. */
  vendorcmi: {
    models: {
      "cmi-sku": {
        id: "cmi-sku",
        canonical_model_id: "vendorcmi/rel-model",
        limit: { context: 100_000, output: 10_000 },
        tool_call: true,
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
  /** `inherits` relation (identity relation, not a canonical-namespace proof). */
  vendorinherits: {
    models: {
      "inherits-sku": {
        id: "inherits-sku",
        inherits: "canonicalvendor/rel-model",
        limit: { context: 90_000, output: 9_000 },
        tool_call: false,
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
  /** `equivalent_to` relation. */
  vendorequiv: {
    models: {
      "equiv-sku": {
        id: "equiv-sku",
        equivalent_to: "canonicalvendor/rel-model",
        limit: { context: 80_000, output: 8_000 },
        tool_call: false,
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
  /** `equivalents` array relation. */
  vendorequivs: {
    models: {
      "equivs-sku": {
        id: "equivs-sku",
        equivalents: ["canonicalvendor/rel-model"],
        limit: { context: 70_000, output: 7_000 },
        tool_call: false,
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
  /** `aliases` relation. */
  vendoralias: {
    models: {
      "alias-target": {
        id: "alias-target",
        aliases: ["rel-model"],
        limit: { context: 60_000, output: 6_000 },
        tool_call: false,
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
  /** The canonical model itself, as the official provider record. */
  canonicalvendor: {
    models: {
      "rel-model": {
        id: "rel-model",
        canonical_model_id: "canonicalvendor/rel-model",
        limit: { context: 50_000, output: 5_000 },
        tool_call: true,
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
} as const