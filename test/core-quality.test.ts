import { describe, expect, test } from "bun:test"
import {
  buildModelSpecs,
  canonicalModelID,
  deploymentProtocol,
  deploymentProtocolSupport,
  diagnoseModelSpecs,
  groupLiteLLMDeployments,
  hasOperationalLimits,
  mapCapabilities,
  resolveProtocolSupport,
  resolveReasoningSupport,
  selectModelsDevRecord,
  type DeploymentGroup,
} from "../src/index.ts"

const options = { contextTierCap: false, protocolOverrides: {} }

function group(
  modelName: string,
  model = `openai/${modelName}`,
  modelInfo: Record<string, unknown> = {},
): DeploymentGroup {
  return groupLiteLLMDeployments({
    data: [{
      model_name: modelName,
      litellm_params: { model },
      model_info: { mode: "chat", ...modelInfo },
    }],
  })[0]!
}

describe("PR8 discovery quality", () => {
  test("canonicalization normalizes route prefixes, case, spaces, and underscores without stripping semantic suffixes", () => {
    expect(canonicalModelID("OPENAI/Qwen_3.7 Plus")).toBe("qwen-3.7-plus")
    expect(canonicalModelID("openai/gpt-5.5-free")).toBe("gpt-5.5-free")

    // Registry matching itself never folds separators: only an exact
    // (case-insensitive) registry key proves identity. Serving selection
    // needs an exact wire-id hit under the declared provider.
    const proven = selectModelsDevRecord(
      group("route", "qwen-3.7-plus", { base_model: "alibaba/qwen-3.7-plus", models_dev_provider: "alibaba" }),
      { models: {}, providers: { alibaba: { models: { "qwen-3.7-plus": { id: "qwen-3.7-plus" } } } } }
    )
    expect(proven?.providerID).toBe("alibaba")
  })

  test("explicit aliases never match; ambiguous reseller matches stay unresolved", () => {
    const aliasCatalog = {
      models: {},
      providers: {
        openai: { models: { "gpt-versioned": { id: "gpt-versioned", aliases: ["gpt-stable"] } } },
      },
    }
    // `aliases` is inert in the real schema: no match, no record.
    expect(selectModelsDevRecord(group("gpt-stable"), aliasCatalog)).toBeUndefined()

    const ambiguous = {
      models: {},
      providers: {
        "reseller-a": { models: { "shared-model": { id: "shared-model" } } },
        "reseller-b": { models: { "shared-model": { id: "shared-model" } } },
      },
    }
    expect(selectModelsDevRecord(group("shared_model", "custom/shared_model"), ambiguous)).toBeUndefined()
  })

  test("reasoning support uses explicit LiteLLM evidence and reports no conflict without record evidence", () => {
    const g = group("reasoner", "openai/reasoner", { supports_reasoning: false })
    expect(resolveReasoningSupport(g, undefined)).toEqual({
      supported: false,
      source: "litellm",
      conflict: false,
    })

    const liteLLMOnly = group("private-reasoner", "custom/private-reasoner", { supports_reasoning: true })
    expect(resolveReasoningSupport(liteLLMOnly, undefined)).toEqual({
      supported: true,
      source: "litellm",
      conflict: false,
    })
    expect(resolveReasoningSupport(group("unknown"), undefined)).toEqual({
      supported: false,
      source: "default",
      conflict: false,
    })
  })

  test("context, input, and output limits keep distinct semantics with deterministic fallback", () => {
    const catalog = {
      models: {
        "openai/limit-model": { limit: { context: 1000000, input: 900000, output: 128000 } },
      },
      providers: {},
    }
    // Descriptive LiteLLM metadata never overrides authoritative intrinsic
    // metadata once the canonical identity is reliably resolved. max_input
    // is input capacity: it is only compared with the input dimension.
    const descriptive = buildModelSpecs({
      data: [{
        model_name: "limit-model",
        litellm_params: { model: "openai/limit-model" },
        model_info: { mode: "chat", max_input_tokens: 800000, max_output_tokens: 64000 },
      }],
    }, catalog, options)[0]!
    expect(descriptive.limit).toEqual({ context: 1000000, input: 900000, output: 128000 })

    const fallback = buildModelSpecs({
      data: [{
        model_name: "limit-model",
        litellm_params: { model: "openai/limit-model" },
        model_info: { mode: "chat" },
      }],
    }, catalog, options)[0]!
    expect(fallback.limit).toEqual({ context: 1000000, input: 900000, output: 128000 })

    // Operator-configuration keys (D7a empty proven set) never narrow:
    // the enforced input/output caps of the old model are gone.
    const constrained = buildModelSpecs({
      data: [{
        model_name: "limit-model",
        litellm_params: { model: "openai/limit-model", max_input_tokens: 250000, max_tokens: 32000 },
        model_info: { mode: "chat", max_input_tokens: 1200000 },
      }],
    }, catalog, options)[0]!
    expect(constrained.limit).toEqual({ context: 1000000, input: 900000, output: 128000 })

    // Without a trusted canonical record the descriptive declarations are
    // the only evidence and the published limits fall back to them.
    const liteLLMOnly = buildModelSpecs({
      data: [{
        model_name: "private-limit-model",
        litellm_params: { model: "custom/private-limit-model" },
        model_info: { mode: "chat", max_input_tokens: 1200000, max_output_tokens: 64000 },
      }],
    }, catalog, options)[0]!
    expect(liteLLMOnly.limit).toEqual({ context: 1200000, input: 1200000, output: 64000 })
  })

  test("multi-deployment capabilities use conservative intersection and pricing uses highest LiteLLM declaration", () => {
    const g = groupLiteLLMDeployments({
      data: [
        {
          model_name: "shared",
          litellm_params: { model: "custom/shared" },
          model_info: {
            mode: "chat",
            supports_function_calling: true,
            input_cost_per_token: 0.0000001,
          },
        },
        {
          model_name: "shared",
          litellm_params: { model: "custom/shared" },
          model_info: {
            mode: "chat",
            supports_function_calling: false,
            input_cost_per_token: 0.0000002,
          },
        },
      ],
    })[0]!
    const selected = {
      providerID: "custom",
      modelID: "shared",
      record: { tool_call: true, cost: { input: 0.05 } },
    }
    const mapped = mapCapabilities(g, selected, false)
    expect(mapped.capabilities.tools).toBeFalse()
    expect(mapped.cost.input).toBeCloseTo(0.2)
  })

  test("protocol capability distinguishes both from selected protocol and preserves unknown fallback", () => {
    const both = group("dual", "openai/dual", {
      supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
    })
    expect(deploymentProtocolSupport(both.deployments[0]!)).toBe("both")
    expect(resolveProtocolSupport(both)).toBe("both")
    expect(deploymentProtocol(both.deployments[0]!)).toBe("responses")

    const unknown = groupLiteLLMDeployments({
      data: [{
        model_name: "private",
        litellm_params: { model: "custom/private" },
        model_info: {},
      }],
    })[0]!
    expect(resolveProtocolSupport(unknown)).toBe("unknown")
    expect(deploymentProtocol(unknown.deployments[0]!)).toBe("chat")
  })

  test("hy4-preview resolves from the canonical registry while reseller records stay diagnostic", () => {
    const litellm = {
      data: [{
        model_name: "hy4-preview",
        litellm_params: { model: "hy4-preview" },
        model_info: {
          mode: "chat",
          max_input_tokens: 1024000,
          max_output_tokens: 64000,
          supports_function_calling: true,
          supports_reasoning: true,
          input_cost_per_token: 0.000000834,
          output_cost_per_token: 0.000002501,
          cache_read_input_token_cost: 0.000000042,
        },
      }],
    }
    const catalog = {
      models: {
        "tencent/hy4-preview": {
          limit: { context: 1024000, input: 1024000, output: 64000 },
          modalities: { input: ["text"], output: ["text"] },
          tool_call: true,
          reasoning: true,
        },
      },
      providers: {
        openrouter: {
          models: {
            "hy4-preview": {
              id: "hy4-preview",
              canonical_model_id: "tencent/hy4-preview",
              reasoning: true,
              tool_call: true,
              modalities: { input: ["text"], output: ["text"] },
              limit: { context: 1024000, output: 64000 },
              cost: { input: 99, output: 99 },
            },
          },
        },
        opencode: {
          models: {
            "hy4-preview": {
              id: "hy4-preview",
              canonical_model_id: "tencent/hy4-preview",
              reasoning: true,
              tool_call: true,
              modalities: { input: ["text"], output: ["text"] },
              limit: { context: 1000000, output: 32000 },
            },
          },
        },
      },
    }

    // Unproven reseller records supply nothing (D5); LiteLLM declares the
    // price, the registry declares the limits.
    const spec = buildModelSpecs(litellm, catalog, options)[0]!
    expect(spec.limit).toEqual({ context: 1024000, input: 1024000, output: 64000 })
    expect(spec.cost.input).toBeCloseTo(0.834)
    expect(spec.cost.output).toBeCloseTo(2.501)
    expect(spec.cost.cacheRead).toBeCloseTo(0.042)
    expect(spec.cost.cacheWrite).toBe(0)

    const diagnosed = diagnoseModelSpecs(litellm, catalog, options)
    expect(diagnosed.diagnostics.stats.modelsDevMatched).toBe(0)
    expect(diagnosed.diagnostics.models[0]!.modelsDev).toEqual({ matched: false })
    expect(diagnosed.diagnostics.issues.some((issue) => issue.code === "models-dev-unmatched")).toBeFalse()
  })

  test("capability fallback prices are not presented as LiteLLM route prices", () => {
    const spec = buildModelSpecs({
      data: [{
        model_name: "hy4-preview",
        litellm_params: { model: "hy4-preview" },
        model_info: { mode: "chat", max_input_tokens: 1024000, max_output_tokens: 64000, supports_function_calling: true, supports_reasoning: true },
      }],
    }, {
      models: {
        "tencent/hy4-preview": {
          limit: { context: 1024000, input: 1024000, output: 64000 },
          modalities: { input: ["text"], output: ["text"] },
          tool_call: true,
          reasoning: true,
        },
      },
      providers: {
        openrouter: {
          models: {
            "hy4-preview": {
              id: "hy4-preview",
              canonical_model_id: "tencent/hy4-preview",
              limit: { context: 1024000, output: 64000 },
              cost: { input: 0.834, output: 2.501, cache_read: 0.042 },
            },
          },
        },
        opencode: {
          models: {
            "hy4-preview": {
              id: "hy4-preview",
              canonical_model_id: "tencent/hy4-preview",
              limit: { context: 1000000, output: 32000 },
              cost: { input: 999, output: 999 },
            },
          },
        },
      },
    }, options)[0]!

    expect(spec.limit).toEqual({ context: 1024000, input: 1024000, output: 64000 })
    expect(spec.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

    const diagnosed = diagnoseModelSpecs({
      data: [{
        model_name: "hy4-preview",
        litellm_params: { model: "hy4-preview" },
        model_info: { mode: "chat", max_input_tokens: 1024000, max_output_tokens: 64000, supports_function_calling: true, supports_reasoning: true },
      }],
    }, {
      models: {},
      providers: {
        openrouter: {
          models: {
            "hy4-preview": {
              id: "hy4-preview",
              canonical_model_id: "tencent/hy4-preview",
              limit: { context: 1024000, output: 64000 },
              cost: { input: 0.834, output: 2.501 },
            },
          },
        },
      },
    }, options)
    expect(diagnosed.diagnostics.models[0]!.provenance.pricing.input).toMatchObject({
      source: "default",
    })
  })

  test("unknown models stay discoverable with deterministic LiteLLM-only fallback", () => {
    const specs = buildModelSpecs({
      data: [{
        model_name: "private-model",
        litellm_params: { model: "custom/private-model" },
        model_info: { mode: "chat" },
      }],
    }, {}, options)
    expect(specs).toEqual([{
      id: "private-model",
      name: "private-model",
      protocol: "chat",
      capabilities: { tools: false, input: ["text"], output: ["text"] },
      variants: [],
      released: 0,
      releaseUnit: "none",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      limit: { context: 0, input: 0, output: 0 },
      // Unknown reasoning evidence stays unknown on the neutral spec; it is
      // never collapsed into false (adapters read this verdict).
      reasoningSupported: "unknown",
    }])
    expect(hasOperationalLimits(specs[0]!)).toBeFalse()

    const diagnosed = diagnoseModelSpecs({
      data: [{
        model_name: "private-model",
        litellm_params: { model: "custom/private-model" },
        model_info: { mode: "chat" },
      }],
    }, {}, options)
    expect(diagnosed.diagnostics.issues.map((issue) => issue.code)).toContain(
      "model-operational-limits-missing",
    )
  })

  test("diagnostics expose identity, reasoning, protocol support, fallback, and conflict resolution", () => {
    const litellm = {
      data: [{
        model_name: "quality-model",
        litellm_params: { model: "openai/quality_model" },
        model_info: {
          mode: "chat",
          supports_function_calling: false,
          supports_reasoning: false,
          max_input_tokens: 80000,
          max_output_tokens: 12000,
          input_cost_per_token: 0.000002,
        },
      }],
    }
    // Underscores never fold: the qualified route cannot prove labA/quality-model.
    const catalog = {
      models: {
        "labA/quality-model": {
          reasoning: true,
          tool_call: true,
          limit: { context: 100000, input: 90000, output: 16000 },
          cost: { input: 1 },
        },
      },
      providers: {},
    }

    const result = diagnoseModelSpecs(litellm, catalog, options)
    const quality = result.diagnostics.models[0]!.quality
    expect(quality.identity.canonicalCandidates).toContain("quality-model")
    expect(quality.identity.canonicalStatus).toBe("unproven")
    expect(quality.reasoning).toEqual({ supported: false, source: "litellm", conflict: false })
    expect(quality.protocolSupport).toBe("chat")
    expect(quality.fallback).toBe("litellm-only")
    expect(quality.conflicts).toEqual([])
  })
})
