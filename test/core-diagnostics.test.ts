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
            model: "gpt-diagnostic",
            api_key: "sk-core-secret",
            api_base: "https://private.example/v1",
          },
          model_info: {
            supported_endpoints: ["/v1/responses", "/v1/chat/completions"],
            max_input_tokens: 200000,
            max_output_tokens: 12000,
            supports_function_calling: true,
            supports_reasoning: false,
            supports_vision: true,
            supports_pdf_input: false,
            supports_audio_input: false,
            supports_video_input: false,
            supports_audio_output: false,
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
    // Catalog shape (D2): canonical registry + serving records. No serving
    // provider is declared, so the openai record stays unproven and supplies
    // no facts; identity proves via the bare registry id.
    const catalog = {
      models: {
        "labA/gpt-diagnostic": {
          limit: { context: 300000, output: 16000 },
          modalities: { input: ["text", "image"], output: ["text"] },
          tool_call: true,
          reasoning: false,
          release_date: "2026-05-01",
        },
      },
      providers: {
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
      modelsDevMatched: 0,
      modelsDevUnmatched: 1,
      protocolFallbacks: 0,
    })

    const diagnostic = result.diagnostics.models[0]!
    // No serving provider declared: no record is matched, canonical identity
    // is proven from the registry instead.
    expect(diagnostic.modelsDev).toEqual({ matched: false })
    expect(diagnostic.quality.identity.canonicalModelID).toBe("labA/gpt-diagnostic")
    expect(diagnostic.quality.identity.canonicalEvidence).toBe("registry-unique")
    expect(diagnostic.quality.identity.canonicalStatus).toBe("proven")
    expect(diagnostic.quality.serving).toMatchObject({ status: "unproven" })
    expect(diagnostic.quality.fieldBasis).toMatchObject({
      "limit.context": "canonical",
      "limit.input": "litellm-declared",
      "limit.output": "canonical",
    })
    expect(diagnostic.quality.reasoningLevelsState).toBe("unknown")
    expect(diagnostic.protocol).toMatchObject({
      value: "responses",
      reason: "supported-endpoints",
      deploymentProtocols: ["responses"],
    })
    expect(diagnostic.provenance).toEqual({
      protocol: { source: "litellm", detail: "supported_endpoints" },
      reasoning: { source: "litellm", detail: "supports_reasoning" },
      capabilities: {
        tools: { source: "litellm" },
        input: { source: "litellm" },
        output: { source: "litellm" },
      },
      context: { source: "models.dev", detail: "limit.context" },
      outputLimit: { source: "models.dev", detail: "limit.output" },
      pricing: {
        input: { source: "litellm" },
        output: { source: "litellm" },
        cacheRead: { source: "default", detail: "missing price metadata maps to zero" },
        cacheWrite: { source: "default", detail: "missing price metadata maps to zero" },
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
// Canonical identity / serving visibility (adopt-modelsdev-canonical-catalog)
// ---------------------------------------------------------------------------

describe("selection diagnostics", () => {
  const optionsNoTier = { contextTierCap: false, protocolOverrides: {} } as const

  function shape(models: Record<string, unknown>, providers: Record<string, unknown>) {
    return {
      models,
      providers: Object.fromEntries(
        Object.entries(providers).map(([provider, records]) => [provider, { models: records }]),
      ),
    }
  }

  test("canonical-only identity reports registry proof without a record match", () => {
    const litellm = {
      data: [{
        model_name: "deepseek-v4.1-flash",
        litellm_params: { model: "deepseek-v4.1-flash" },
        model_info: { mode: "responses", base_model: "deepseek-v4.1-flash" },
      }],
    }
    const doc = shape(
      { "deepseek/deepseek-v4.1-flash": { limit: { context: 1000000, output: 384000 } } },
      {
        deepseek: {
          "deepseek-flash": { id: "deepseek-flash", canonical_model_id: "deepseek/deepseek-v4.1-flash", limit: { context: 1000000, output: 393216 } },
        },
      },
    )
    const diagnosed = diagnoseModelSpecs(litellm, doc, optionsNoTier)
    const model = diagnosed.diagnostics.models.find((item) => item.id === "deepseek-v4.1-flash")!
    expect(model.modelsDev).toEqual({ matched: false })
    expect(model.quality.identity.canonicalModelID).toBe("deepseek/deepseek-v4.1-flash")
    expect(model.quality.identity.canonicalEvidence).toBe("registry-unique")
    expect(model.quality.serving).toMatchObject({ status: "unproven" })
  })

  test("declared serving provider reports the resolved record", () => {
    const litellm = {
      data: [{
        model_name: "vendor-foo",
        litellm_params: { model: "vendor-foo" },
        model_info: { mode: "chat", models_dev_provider: "vendor" },
      }],
    }
    const doc = shape(
      {},
      { vendor: { "vendor-foo": { id: "vendor-foo", limit: { context: 1, output: 1 } } } },
    )
    const diagnosed = diagnoseModelSpecs(litellm, doc, optionsNoTier)
    const model = diagnosed.diagnostics.models.find((item) => item.id === "vendor-foo")!
    expect(model.modelsDev).toMatchObject({
      matched: true,
      providerID: "vendor",
      selectionSource: "explicit-provider",
    })
    expect(model.quality.serving).toMatchObject({ status: "declared", providerID: "vendor", recordID: "vendor-foo" })
    // Unproven same-name reseller records stay diagnostic candidates only.
    expect(model.candidates).toContain("vendor-foo")
  })

  test("serving-record-unresolved lists selectable relation SKUs as candidates", () => {
    const litellm = {
      data: [{
        model_name: "rel-model",
        litellm_params: { model: "rel-model" },
        model_info: { mode: "chat", models_dev_provider: "canonicalvendor" },
      }],
    }
    const doc = shape(
      { "canonicalvendor/rel-model": { limit: { context: 50000, output: 5000 } } },
      {
        canonicalvendor: {
          "rel-model-alias": { id: "rel-model-alias", canonical_model_id: "canonicalvendor/rel-model", limit: { context: 50000, output: 5000 } },
        },
      },
    )
    const diagnosed = diagnoseModelSpecs(litellm, doc, optionsNoTier)
    const model = diagnosed.diagnostics.models.find((item) => item.id === "rel-model")!
    expect(model.modelsDev).toEqual({ matched: false })
    expect(model.quality.serving).toMatchObject({ status: "serving-record-unresolved" })
    expect(model.quality.diagnosticCandidates?.map((item) => item.recordID)).toContain("rel-model-alias")
  })
})
