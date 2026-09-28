import { describe, expect, test } from "bun:test"
import {
  createDiscoveryCacheDiagnostics,
  diagnoseModelSpecs,
  resolveProtocolResolution,
} from "../src/index.ts"
import { groupLiteLLMDeployments } from "../src/core/litellm.ts"

const options = { contextTierCap: true, protocolOverrides: {} }

describe("discovery diagnostics", () => {
  test("explains matching, protocol and metadata provenance without changing model output", () => {
    const litellm = {
      data: [
        {
          model_name: "gpt-diagnostic",
          litellm_params: { model: "openai/gpt-diagnostic" },
          model_info: {
            supported_endpoints: ["/v1/responses", "/v1/chat/completions"],
            max_input_tokens: 200000,
            max_output_tokens: 12000,
            input_cost_per_token: 0.000001,
            output_cost_per_token: 0.000002,
          },
        },
        {
          model_name: "gpt-image-unused",
          litellm_params: { model: "openai/gpt-image-unused" },
          model_info: {},
        },
      ],
    }
    const catalog = {
      openai: {
        models: {
          "gpt-diagnostic": {
            id: "gpt-diagnostic",
            release_date: "2026-05-01",
            tool_call: true,
            modalities: { input: ["text", "image"], output: ["text"] },
            reasoning_options: [{ type: "effort", values: ["low", "high"] }],
            limit: { context: 300000, output: 16000 },
            cost: { input: 3, output: 6 },
          },
        },
      },
    }

    const result = diagnoseModelSpecs(litellm, catalog, options)
    expect(result.models.map((model) => model.id)).toEqual(["gpt-diagnostic"])
    expect(result.diagnostics.modelInfo.status).toBe("ok")
    expect(result.diagnostics.modelsList).toMatchObject({ status: "unused", path: "/v1/models" })
    expect(result.diagnostics.stats).toEqual({
      responseEntries: 2,
      deployments: 1,
      filteredEntries: 1,
      models: 1,
      modelsDevMatched: 1,
      modelsDevUnmatched: 0,
      protocolFallbacks: 0,
    })

    const diagnostic = result.diagnostics.models[0]!
    expect(diagnostic.modelsDev).toEqual({
      matched: true,
      providerID: "openai",
      modelID: "gpt-diagnostic",
    })
    expect(diagnostic.protocol).toMatchObject({
      value: "responses",
      reason: "supported-endpoints",
      deploymentProtocols: ["responses"],
    })
    expect(diagnostic.provenance.protocol.source).toBe("litellm")
    expect(diagnostic.provenance.reasoning.source).toBe("models.dev")
    expect(diagnostic.provenance.context.source).toBe("derived")
    expect(diagnostic.provenance.outputLimit.source).toBe("litellm")
    expect(diagnostic.provenance.pricing.input.source).toBe("litellm")
    expect(diagnostic.provenance.release.source).toBe("models.dev")
  })

  test("reports degraded models.dev and conservative protocol fallback", () => {
    const litellm = {
      data: [
        {
          model_name: "mixed-model",
          litellm_params: { model: "openai/mixed-model" },
          model_info: { supported_endpoints: ["/v1/responses"] },
        },
        {
          model_name: "mixed-model",
          litellm_params: { model: "openai/mixed-model" },
          model_info: { supported_endpoints: ["/v1/chat/completions"] },
        },
      ],
    }

    const result = diagnoseModelSpecs(litellm, {}, options)
    expect(result.models[0]?.protocol).toBe("chat")
    expect(result.diagnostics.modelsDev.status).toBe("degraded")
    expect(result.diagnostics.models[0]?.protocol.reason).toBe("mixed-fallback")
    expect(result.diagnostics.stats.modelsDevUnmatched).toBe(1)
    expect(result.diagnostics.stats.protocolFallbacks).toBe(1)
    expect(result.diagnostics.issues.map((issue) => issue.code)).toContain("models-dev-degraded")
    expect(result.diagnostics.issues.map((issue) => issue.code)).toContain("models-dev-unmatched")
    expect(result.diagnostics.issues.map((issue) => issue.code)).toContain("protocol-mixed-fallback")
  })

  test("protocol resolution exposes overrides without changing resolve semantics", () => {
    const groups = groupLiteLLMDeployments({
      data: [{
        model_name: "forced-model",
        litellm_params: { model: "openai/forced-model" },
        model_info: { supported_endpoints: ["/v1/responses"] },
      }],
    })
    expect(resolveProtocolResolution(groups[0]!, { "forced-model": "chat" })).toMatchObject({
      protocol: "chat",
      reason: "override",
    })
  })

  test("cache diagnostics exposes source, freshness and age", () => {
    expect(createDiscoveryCacheDiagnostics({
      source: "snapshot",
      refreshedAt: 1_000,
      failureCount: 2,
      nextRetryAt: 5_000,
    }, 4_000)).toEqual({
      source: "snapshot",
      stale: true,
      refreshedAt: 1_000,
      ageMs: 3_000,
      failureCount: 2,
      nextRetryAt: 5_000,
      pending: false,
    })
  })
})
