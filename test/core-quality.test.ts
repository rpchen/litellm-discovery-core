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

    const catalog = {
      alibaba: {
        models: {
          "qwen-3.7-plus": { id: "qwen-3.7-plus", limit: { context: 100000 } },
        },
      },
    }
    const selected = selectModelsDevRecord(
      group("route", "openai/route", { base_model: "Alibaba/Qwen_3.7 Plus" }),
      catalog,
    )
    expect(selected).toMatchObject({
      providerID: "alibaba",
      modelID: "qwen-3.7-plus",
      matchKind: "canonical",
      matchedCandidate: "Alibaba/Qwen_3.7 Plus",
    })
  })

  test("explicit aliases match, while ambiguous reseller matches stay unresolved", () => {
    const aliasCatalog = {
      openai: {
        models: {
          "gpt-versioned": {
            id: "gpt-versioned",
            aliases: ["gpt-stable"],
          },
        },
      },
    }
    expect(selectModelsDevRecord(group("gpt-stable"), aliasCatalog)).toMatchObject({
      providerID: "openai",
      modelID: "gpt-versioned",
      matchKind: "alias",
    })

    const ambiguous = {
      "reseller-a": { models: { "shared-model": { id: "shared-model" } } },
      "reseller-b": { models: { "shared-model": { id: "shared-model" } } },
    }
    expect(selectModelsDevRecord(group("shared_model", "custom/shared_model"), ambiguous)).toBeUndefined()
  })

  test("reasoning support uses explicit LiteLLM evidence before models.dev and reports conflicts", () => {
    const catalog = {
      openai: {
        models: {
          "reasoner": { id: "reasoner", reasoning: true, reasoning_options: [{ type: "effort", values: ["high"] }] },
        },
      },
    }
    const g = group("reasoner", "openai/reasoner", { supports_reasoning: false })
    const selected = selectModelsDevRecord(g, catalog)
    expect(resolveReasoningSupport(g, selected)).toEqual({
      supported: false,
      source: "litellm",
      conflict: true,
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
      openai: {
        models: {
          "limit-model": {
            id: "limit-model",
            limit: { context: 1000000, input: 900000, output: 128000 },
          },
        },
      },
    }
    const spec = buildModelSpecs({
      data: [{
        model_name: "limit-model",
        litellm_params: { model: "openai/limit-model" },
        model_info: { mode: "chat", max_input_tokens: 800000, max_output_tokens: 64000 },
      }],
    }, catalog, options)[0]!
    expect(spec.limit).toEqual({ context: 1000000, input: 800000, output: 64000 })

    const fallback = buildModelSpecs({
      data: [{
        model_name: "limit-model",
        litellm_params: { model: "openai/limit-model" },
        model_info: { mode: "chat" },
      }],
    }, catalog, options)[0]!
    expect(fallback.limit).toEqual({ context: 1000000, input: 900000, output: 128000 })

    const clamped = buildModelSpecs({
      data: [{
        model_name: "limit-model",
        litellm_params: { model: "openai/limit-model" },
        model_info: { mode: "chat", max_input_tokens: 1200000 },
      }],
    }, catalog, options)[0]!
    expect(clamped.limit).toEqual({ context: 1000000, input: 1000000, output: 128000 })
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

  test("hy4-preview uses OpenRouter capabilities when original provider is absent, without losing LiteLLM price", () => {
    const litellm = {
      data: [{
        model_name: "hy4-preview",
        litellm_params: { model: "openai/hy4-preview" },
        model_info: {
          mode: "chat",
          input_cost_per_token: 0.000000834,
          output_cost_per_token: 0.000002501,
          cache_read_input_token_cost: 0.000000042,
        },
      }],
    }
    const catalog = {
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
            limit: { context: 1000000, output: 32000 },
          },
        },
      },
    }

    const spec = buildModelSpecs(litellm, catalog, options)[0]!
    expect(spec.limit).toEqual({ context: 1024000, input: 1024000, output: 64000 })
    expect(spec.cost.input).toBeCloseTo(0.834)
    expect(spec.cost.output).toBeCloseTo(2.501)
    expect(spec.cost.cacheRead).toBeCloseTo(0.042)
    expect(spec.cost.cacheWrite).toBe(0)

    const diagnosed = diagnoseModelSpecs(litellm, catalog, options)
    expect(diagnosed.diagnostics.stats.modelsDevMatched).toBe(1)
    expect(diagnosed.diagnostics.models[0]!.modelsDev).toMatchObject({
      matched: true,
      providerID: "openrouter",
      modelID: "hy4-preview",
    })
    expect(diagnosed.diagnostics.issues.some((issue) => issue.code === "models-dev-unmatched")).toBeFalse()
  })

  test("capability fallback prices are not presented as LiteLLM route prices", () => {
    const spec = buildModelSpecs({
      data: [{
        model_name: "hy4-preview",
        litellm_params: { model: "openai/hy4-preview" },
        model_info: { mode: "chat" },
      }],
    }, {
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
    }, options)[0]!

    expect(spec.limit).toEqual({ context: 1024000, input: 1024000, output: 64000 })
    expect(spec.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

    const diagnosed = diagnoseModelSpecs({
      data: [{
        model_name: "hy4-preview",
        litellm_params: { model: "openai/hy4-preview" },
        model_info: { mode: "chat" },
      }],
    }, {
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
    }, options)
    expect(diagnosed.diagnostics.models[0]!.provenance.pricing.input).toMatchObject({
      source: "default",
    })
    expect(diagnosed.diagnostics.models[0]!.provenance.pricing.input.detail).toContain("price ignored")
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
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      variants: [],
      released: 0,
      releaseUnit: "none",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      limit: { context: 0, input: 0, output: 0 },
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
    const catalog = {
      openai: {
        models: {
          "quality-model": {
            id: "quality-model",
            reasoning: true,
            tool_call: true,
            limit: { context: 100000, input: 90000, output: 16000 },
            cost: { input: 1 },
            reasoning_options: [{ type: "effort", values: ["high"] }],
          },
        },
      },
    }

    const result = diagnoseModelSpecs(litellm, catalog, options)
    const quality = result.diagnostics.models[0]!.quality
    expect(quality.identity.canonicalCandidates).toContain("quality-model")
    expect(quality.identity.matchKind).toBe("canonical")
    expect(quality.reasoning).toEqual({ supported: false, source: "litellm", conflict: true })
    expect(quality.protocolSupport).toBe("chat")
    expect(quality.fallback).toBe("enriched")
    expect(quality.conflicts.map((item) => item.field)).toEqual([
      "capabilities.tools",
      "reasoning",
      "limit.input",
      "limit.output",
      "pricing.input",
    ])
    expect(result.diagnostics.issues.filter((issue) => issue.code === "metadata-conflict")).toHaveLength(5)
  })
})
