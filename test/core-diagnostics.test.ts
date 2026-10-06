import { describe, expect, test } from "bun:test"
import {
  buildModelSpecs,
  createDiscoveryCacheDiagnostics,
  diagnoseModelSpecs,
  resolveProtocolResolution,
} from "../src/index.ts"
import { groupLiteLLMDeployments } from "../src/core/litellm.ts"

const options = { contextTierCap: true, protocolOverrides: {} }

describe("discovery diagnostics", () => {
  test("diagnostics models are exactly the normal build result and all field provenance is explicit", () => {
    const litellm = {
      data: [
        {
          model_name: "gpt-diagnostic",
          litellm_params: {
            model: "openai/gpt-diagnostic",
            api_key: "sk-core-secret",
            api_base: "https://private.example/v1",
          },
          model_info: {
            supported_endpoints: ["/v1/responses", "/v1/chat/completions"],
            max_input_tokens: 200000,
            max_output_tokens: 12000,
            input_cost_per_token: 0.000001,
            output_cost_per_token: 0.000002,
            debug_error: "upstream failed with sk-core-secret at https://private.example",
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
            cost: {
              input: 3,
              output: 6,
              cache_read: 0.5,
              cache_write: 0.75,
            },
          },
        },
      },
    }

    const result = diagnoseModelSpecs(litellm, catalog, options)
    expect(result.models).toEqual(buildModelSpecs(litellm, catalog, options))
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
      selectionSource: "unique-match",
    })
    expect(diagnostic.protocol).toMatchObject({
      value: "responses",
      reason: "supported-endpoints",
      deploymentProtocols: ["responses"],
    })
    expect(diagnostic.provenance).toEqual({
      protocol: { source: "litellm", detail: "supported_endpoints" },
      reasoning: { source: "models.dev", detail: "reasoning_options" },
      capabilities: {
        tools: { source: "models.dev" },
        input: { source: "models.dev" },
        output: { source: "models.dev" },
      },
      context: { source: "models.dev", detail: "limit.context" },
      outputLimit: { source: "litellm" },
      pricing: {
        input: { source: "litellm" },
        output: { source: "litellm" },
        cacheRead: { source: "default", detail: "models.dev unique-match price ignored; capability fallback is not deployment pricing" },
        cacheWrite: { source: "default", detail: "models.dev unique-match price ignored; capability fallback is not deployment pricing" },
      },
      release: { source: "models.dev" },
    })

    const serialized = JSON.stringify(result.diagnostics)
    expect(serialized).not.toContain("sk-core-secret")
    expect(serialized).not.toContain("private.example")
    expect(serialized).not.toContain("upstream failed")
  })

  test("diagnostics are pure and never perform discovery network I/O", () => {
    const originalFetch = globalThis.fetch
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      throw new Error("unexpected network")
    }) as unknown as typeof fetch

    try {
      const result = diagnoseModelSpecs({
        data: [{
          model_name: "offline-model",
          litellm_params: { model: "openai/offline-model" },
          model_info: { mode: "chat" },
        }],
      }, {}, options)
      expect(result.models.map((model) => model.id)).toEqual(["offline-model"])
      expect(result.diagnostics.modelsList.status).toBe("unused")
      expect(fetches).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
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
    expect(result.models).toEqual(buildModelSpecs(litellm, {}, options))
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

  test("cache diagnostics distinguishes every adapter source and freshness rule", () => {
    const cases = [
      { source: "network" as const, stale: false },
      { source: "memory-cache" as const, stale: false },
      { source: "stale" as const, stale: true },
      { source: "snapshot" as const, stale: true },
      { source: "none" as const, stale: false },
    ]

    for (const item of cases) {
      expect(createDiscoveryCacheDiagnostics({
        source: item.source,
        refreshedAt: 1_000,
        failureCount: 2,
        nextRetryAt: 5_000,
        pending: item.source === "none",
      }, 4_000)).toEqual({
        source: item.source,
        stale: item.stale,
        refreshedAt: 1_000,
        ageMs: 3_000,
        failureCount: 2,
        nextRetryAt: 5_000,
        pending: item.source === "none",
      })
    }
  })
})

// ---------------------------------------------------------------------------
// Canonical identity / metadata provider / selection source visibility
// (fix-canonical-provider-selection-precedence)
// ---------------------------------------------------------------------------
import { DEEPSEEK_V4_1_FLASH_CATALOG } from "./fixtures/models-dev-catalog-fixtures.ts"

describe("selection diagnostics", () => {
  const optionsNoTier = { contextTierCap: false, protocolOverrides: {} } as const

  test("canonical original selection reports identity, provider, and source separately", () => {
    const litellm = {
      data: [{
        model_name: "deepseek-v4.1-flash",
        litellm_params: { model: "deepseek-v4.1-flash" },
        model_info: { mode: "responses", base_model: "deepseek-v4.1-flash" },
      }],
    }
    const diagnosed = diagnoseModelSpecs(litellm, DEEPSEEK_V4_1_FLASH_CATALOG, optionsNoTier)
    const model = diagnosed.diagnostics.models.find((item) => item.id === "deepseek-v4.1-flash")!
    expect(model.modelsDev).toMatchObject({
      matched: true,
      providerID: "deepseek",
      selectionSource: "canonical-original",
    })
    // The record that served the identity carries its own canonical_model_id
    // relation, so the identity provenance names the provider relation.
    expect(model.quality.identity.identityProvenance).toBe("provider-relation")
  })

  test("fallback selection keeps the canonical identity intact in diagnostics", () => {
    const litellm = {
      data: [{
        model_name: "vendor-foo",
        litellm_params: { model: "openai/vendor-foo" },
        model_info: { mode: "chat" },
      }],
    }
    const catalog = {
      vendor: { models: { "vendor-foo": { id: "vendor-foo", canonical_model_id: "vendor/vendor-foo", limit: { context: 1, output: 1 } } } },
      opencode: { models: { "vendor-foo": { id: "vendor-foo", canonical_model_id: "vendor/vendor-foo", limit: { context: 1, output: 1 } } } },
      "other-reseller": { models: { "vendor-foo": { id: "vendor-foo", canonical_model_id: "vendor/vendor-foo", limit: { context: 1, output: 1 } } } },
    }
    const diagnosed = diagnoseModelSpecs(litellm, { opencode: catalog.opencode, "other-reseller": catalog["other-reseller"], vendorfoo: { models: { "unused": { id: "unused" } } } } as never, optionsNoTier)
    const model = diagnosed.diagnostics.models.find((item) => item.id === "vendor-foo")!
    expect(model.modelsDev).toMatchObject({
      matched: true,
      providerID: "opencode",
      selectionSource: "opencode-fallback",
    })
    // The canonical identity candidate list stays the deployment's own names:
    // the fallback provider never renames it.
    expect(model.candidates).toContain("vendor-foo")
    expect(model.quality.identity.canonicalCandidates).toContain("vendor-foo")
  })

  test("provider-relation identity provenance is reported for relation-matched records", () => {
    const litellm = {
      data: [{
        model_name: "rel-model",
        litellm_params: { model: "canonicalvendor/rel-model" },
        model_info: { mode: "chat" },
      }],
    }
    const catalog = {
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
    }
    const diagnosed = diagnoseModelSpecs(litellm, catalog, optionsNoTier)
    const model = diagnosed.diagnostics.models.find((item) => item.id === "rel-model")!
    expect(model.modelsDev).toMatchObject({ providerID: "canonicalvendor", selectionSource: "canonical-original" })
    // The direct-id match upgrades to the record's relation proof context.
    expect(model.quality.identity.matchKind).toBe("relation")
  })
})
