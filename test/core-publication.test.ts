import { describe, expect, test } from "bun:test"
import litellmFixture from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDevFixture from "./fixtures/models-dev.json" with { type: "json" }
import { buildModelSpecs } from "../src/core/build.ts"
import { groupLiteLLMDeployments, type DeploymentGroup } from "../src/core/litellm.ts"
import {
  resolveInheritedRecord,
  resolveReasoningLevels,
  resolveReasoningState,
  selectModelsDevRecord,
  selectModelsDevRecordDetailed,
} from "../src/core/modelsdev.ts"
import { resolveProtocol } from "../src/core/protocol.ts"
import {
  acceptDegradedConfiguration,
  assessModelConfiguration,
  buildPublicationResult,
  classifyMetadataFailure,
  createLastKnownGoodEntry,
  createLastKnownGoodStore,
  isNormallyPublishable,
  isPublishableWithDegradedAcceptance,
  lastKnownGoodKey,
  metadataFailureFor,
  resolveConfigurationWithLKG,
  validateLastKnownGood,
  type CompletenessAssessment,
} from "../src/core/publication.ts"

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

function assess(
  modelName: string,
  model: string | undefined,
  modelInfo: Record<string, unknown>,
  catalog: unknown,
  catalogAvailable = true,
): CompletenessAssessment {
  return assessModelConfiguration(group(modelName, model, modelInfo), catalog, options, { catalogAvailable })
}

/** A group with no LiteLLM declarations: completeness depends on models.dev. */
function bareGroup(modelName: string, model?: string): DeploymentGroup {
  return group(modelName, model)
}

const COMPLETE_INFO = {
  max_input_tokens: 200000,
  max_output_tokens: 32000,
  supports_function_calling: true,
  supports_reasoning: false,
}

// ---------------------------------------------------------------------------
// Normal match
// ---------------------------------------------------------------------------

describe("publication: normal match", () => {
  test("primary metadata source hit is publishable", () => {
    const catalog = {
      openai: { models: { "gpt-5.5": { id: "gpt-5.5", limit: { context: 1000, output: 100 }, tool_call: true, reasoning: false } } },
    }
    const result = assess("gpt-5.5", "openai/gpt-5.5", {}, catalog)
    expect(result.publishable).toBeTrue()
    expect(result.status).toBe("configured")
    expect(result.missingFields).toEqual([])
    expect(result.unknownFields).toEqual([])
    expect(result.illegalFields).toEqual([])
  })

  test("original provider data wins over resellers", () => {
    const catalog = {
      alibaba: { models: { "qwen3.7-plus": { id: "qwen3.7-plus", canonical_model_id: "alibaba/qwen3.7-plus", limit: { context: 500, output: 50 }, tool_call: true, reasoning: false } } },
      openrouter: { models: { "qwen3.7-plus": { id: "qwen3.7-plus", limit: { context: 999, output: 99 } } } },
    }
    const detailed = selectModelsDevRecordDetailed(group("qwen3.7-plus", "dashscope/qwen3.7-plus"), catalog)
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.providerID).toBe("alibaba")
    expect(detailed.selected?.selectionSource).toBe("canonical-original")
  })

  test("next trusted source is used when the preferred one is absent", () => {
    const catalog = {
      openrouter: { models: { "kimi-k2.6": { id: "kimi-k2.6", limit: { context: 262144, output: 65536 }, tool_call: true, reasoning: true, reasoning_options: [{ type: "effort", values: ["low", "high"] }] } } },
      opencode: { models: { "kimi-k2.6": { id: "kimi-k2.6", limit: { context: 1, output: 1 } } } },
    }
    const detailed = selectModelsDevRecordDetailed(group("kimi-k2.6", "openrouter/kimi-k2.6"), catalog)
    expect(detailed.selected?.providerID).toBe("openrouter")
    expect(detailed.selected?.selectionSource).toBe("openrouter-fallback")
  })

  test("canonical identity resolves", () => {
    const catalog = {
      alibaba: { models: { "qwen-3.7-plus": { id: "qwen-3.7-plus", limit: { context: 100, output: 10 }, tool_call: false, reasoning: false } } },
    }
    const g = group("route", "openai/route", { base_model: "Alibaba/Qwen_3.7 Plus" })
    const detailed = selectModelsDevRecordDetailed(g, catalog)
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.matchKind).toBe("canonical")
  })

  test("alias resolves", () => {
    const catalog = { openai: { models: { "gpt-versioned": { id: "gpt-versioned", aliases: ["gpt-stable"], limit: { context: 100, output: 10 }, tool_call: true, reasoning: false } } } }
    const detailed = selectModelsDevRecordDetailed(group("gpt-stable"), catalog)
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.matchKind).toBe("alias")
  })

  test("equivalent relation resolves deterministically", () => {
    const catalog = {
      vendor: {
        models: {
          "model-b": { id: "model-b", equivalent_to: "vendor/model-a", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false },
          "model-a": { id: "model-a", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false },
        },
      },
    }
    const detailed = selectModelsDevRecordDetailed(group("model-b", "vendor/model-b"), catalog)
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.modelID).toBe("model-b")
  })

  test("provenance names provider and model", () => {
    const catalog = {
      openai: { models: { "gpt-5.5": { id: "gpt-5.5", limit: { context: 1000, output: 100 }, tool_call: true, reasoning: false } } },
    }
    const result = assess("gpt-5.5", "openai/gpt-5.5", {}, catalog)
    expect(result.context.provenance.detail).toContain("openai")
    expect(result.context.provenance.detail).toContain("gpt-5.5")
  })
})

// ---------------------------------------------------------------------------
// Reasoning
// ---------------------------------------------------------------------------

describe("publication: reasoning", () => {
  test("reasoning=false is publishable and explicit", () => {
    const result = assess("m", "openai/m", { ...COMPLETE_INFO, supports_reasoning: false }, {
      openai: { models: { m: { id: "m", reasoning: false } } },
    })
    expect(result.reasoning.state).toBe("unsupported")
    expect(result.publishable).toBeTrue()
  })

  test("reasoning=true with levels", () => {
    const catalog = {
      xiaomi: {
        models: {
          "mimo-v2.6-pro": {
            id: "mimo-v2.6-pro",
            reasoning: true,
            reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
            limit: { context: 1048576, output: 131072 },
            tool_call: false,
          },
        },
      },
    }
    const g = group("mimo-v2.6-pro", "xiaomi/mimo-v2.6-pro")
    const selected = selectModelsDevRecord(g, catalog)
    expect(resolveReasoningState(g, selected).state).toBe("supported")
    const levels = resolveReasoningLevels(selected, resolveProtocol(g, {}))
    expect(levels.known).toBeTrue()
    expect([...levels.values]).toEqual(["low", "medium", "high"])
    const result = assessModelConfiguration(g, catalog, options)
    expect(result.publishable).toBeTrue()
    expect(result.reasoning.levelsKnown).toBeTrue()
  })

  test("reasoning=true without levels is legal and publishable", () => {
    const catalog = {
      vendor: {
        models: {
          "thinker": {
            id: "thinker",
            reasoning: true,
            limit: { context: 100000, output: 10000 },
            tool_call: false,
          },
        },
      },
    }
    const g = group("thinker", "vendor/thinker")
    const selected = selectModelsDevRecord(g, catalog)
    expect(resolveReasoningState(g, selected).state).toBe("supported")
    const levels = resolveReasoningLevels(selected, resolveProtocol(g, {}))
    expect(levels.known).toBeFalse()
    expect(levels.values).toEqual([])
    const result = assessModelConfiguration(g, catalog, options)
    expect(result.publishable).toBeTrue()
    expect(result.status).toBe("configured")
  })

  test("reasoning unknown stays unknown", () => {
    const result = assess("m", "openai/m", { max_input_tokens: 1000, max_output_tokens: 100 }, {
      openai: { models: { m: { id: "m", limit: { context: 1000, output: 100 } } } },
    })
    expect(result.reasoning.state).toBe("unknown")
    expect(result.publishable).toBeFalse()
    expect(result.unknownFields).toContain("reasoning")
  })

  test("missing levels never flip support to false", () => {
    const g = group("m", "openai/m", { supports_reasoning: true, max_input_tokens: 100, max_output_tokens: 10, supports_function_calling: false })
    expect(resolveReasoningState(g, undefined).state).toBe("supported")
    expect(resolveReasoningLevels(undefined, "chat").known).toBeFalse()
  })

  test("support=true never requires non-empty levels", () => {
    const g = group("m", "openai/m", { supports_reasoning: true })
    const state = resolveReasoningState(g, undefined)
    expect(state.state).toBe("supported")
    // No invariant links support to levels; assessment of the full model
    // only fails on limits/tools here, never on "levels missing".
    const result = assessModelConfiguration(g, {}, options, { catalogAvailable: true })
    expect(result.unknownFields).not.toContain("reasoning")
    expect(result.reasoning.levels).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

describe("publication: completeness", () => {
  const toolReason = { supports_function_calling: true, supports_reasoning: false }

  test("sufficient trustworthy info is publishable", () => {
    const result = assess("m", "openai/m", { max_input_tokens: 1000, max_output_tokens: 100, ...toolReason }, {})
    expect(result.publishable).toBeTrue()
    expect(result.status).toBe("configured")
  })

  test("missing context blocks publication", () => {
    const result = assess("m", "openai/m", { ...toolReason }, {
      openai: { models: { m: { id: "m", limit: { output: 100 }, tool_call: true, reasoning: false } } },
    })
    expect(result.publishable).toBeFalse()
    expect(result.missingFields).toContain("limit.context")
    expect(result.status).toBe("discovered-incomplete")
  })

  test("missing output blocks publication", () => {
    const result = assess("m", "openai/m", { ...toolReason }, {
      openai: { models: { m: { id: "m", limit: { context: 1000 }, tool_call: true, reasoning: false } } },
    })
    expect(result.publishable).toBeFalse()
    expect(result.missingFields).toContain("limit.output")
  })

  test("contextWindow=0 is illegal, not a default", () => {
    const result = assess("m", "openai/m", { max_input_tokens: 0, max_output_tokens: 100, ...toolReason }, {
      openai: { models: { m: { id: "m", limit: { context: 0, output: 100 } } } },
    })
    expect(result.publishable).toBeFalse()
    expect(result.illegalFields).toContain("limit.context")
    expect(result.status).toBe("invalid-metadata")
  })

  test("maxTokens=0 is illegal, not a default", () => {
    const result = assess("m", "openai/m", { max_input_tokens: 1000, max_output_tokens: 0, ...toolReason }, {
      openai: { models: { m: { id: "m", limit: { context: 1000, output: 0 } } } },
    })
    expect(result.publishable).toBeFalse()
    expect(result.illegalFields).toContain("limit.output")
  })

  test("unknown key capability blocks publication", () => {
    const result = assess("m", "openai/m", { max_input_tokens: 1000, max_output_tokens: 100, supports_reasoning: false }, {
      openai: { models: { m: { id: "m", limit: { context: 1000, output: 100 }, reasoning: false } } },
    })
    expect(result.tools.state).toBe("unknown")
    expect(result.publishable).toBeFalse()
    expect(result.unknownFields).toContain("capabilities.tools")
  })

  test("illegal metadata is rejected", () => {
    const result = assess("m", "openai/m", { max_input_tokens: -5, max_output_tokens: 100, ...toolReason }, {
      openai: { models: { m: { id: "m", limit: { context: -5, output: 100 } } } },
    })
    expect(result.publishable).toBeFalse()
    expect(result.illegalFields).toContain("limit.context")
  })

  test("schema-incompatible catalog is not used as fact", () => {
    const g = group("m", "openai/m", { max_input_tokens: 1000, max_output_tokens: 100, ...toolReason })
    const result = assessModelConfiguration(g, { openai: "not-a-provider-map" }, options, { catalogAvailable: false })
    // LiteLLM-only declarations still satisfy completeness; the broken
    // catalog shape is ignored, never treated as capability fact.
    expect(result.publishable).toBeTrue()
    expect(result.status).toBe("configured")
  })
})

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe("publication: identity", () => {
  test("provider-specific canonical match", () => {
    const catalog = {
      moonshotai: { models: { "kimi-k2.5": { id: "kimi-k2.5", limit: { context: 10, output: 1 }, tool_call: true, reasoning: false } } },
    }
    const detailed = selectModelsDevRecordDetailed(group("kimi-k2.5", "moonshotai/kimi-k2.5"), catalog)
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.providerID).toBe("moonshotai")
  })

  test("OpenRouter fallback", () => {
    const catalog = {
      openrouter: { models: { "hy4-preview": { id: "hy4-preview", limit: { context: 10, output: 1 }, tool_call: false, reasoning: false } } },
    }
    const detailed = selectModelsDevRecordDetailed(group("hy4-preview", "custom/hy4-preview"), catalog)
    expect(detailed.selected?.selectionSource).toBe("openrouter-fallback")
  })

  test("OpenCode fallback", () => {
    const catalog = {
      opencode: { models: { "kimi-k2.6": { id: "kimi-k2.6", limit: { context: 10, output: 1 }, tool_call: false, reasoning: false } } },
    }
    const detailed = selectModelsDevRecordDetailed(group("kimi-k2.6", "custom/kimi-k2.6"), catalog)
    expect(detailed.selected?.selectionSource).toBe("opencode-fallback")
  })

  test("alias resolves", () => {
    const catalog = { openai: { models: { "gpt-versioned": { id: "gpt-versioned", aliases: ["gpt-stable"] } } } }
    expect(selectModelsDevRecordDetailed(group("gpt-stable"), catalog).outcome).toBe("matched")
  })

  test("equivalent relation resolves", () => {
    const catalog = {
      vendor: { models: { "b": { id: "b", equivalent_to: "vendor/a" }, "a": { id: "a" } } },
    }
    expect(selectModelsDevRecordDetailed(group("b", "vendor/b"), catalog).outcome).toBe("matched")
  })

  test("unique global match", () => {
    const catalog = { solo: { models: { "lonely": { id: "lonely" } } } }
    const detailed = selectModelsDevRecordDetailed(group("lonely", "custom/lonely"), catalog)
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.selectionSource).toBe("unique-match")
  })

  test("ambiguous model stays ambiguous with providers listed", () => {
    const catalog = {
      "reseller-a": { models: { "shared-model": { id: "shared-model" } } },
      "reseller-b": { models: { "shared-model": { id: "shared-model" } } },
    }
    const detailed = selectModelsDevRecordDetailed(group("shared_model", "custom/shared_model"), catalog)
    expect(detailed.outcome).toBe("ambiguous")
    expect(detailed.selected).toBeUndefined()
    expect([...detailed.ambiguousProviders].sort()).toEqual(["reseller-a", "reseller-b"])
    const result = assessModelConfiguration(group("shared_model", "custom/shared_model"), catalog, options)
    expect(result.status).toBe("ambiguous")
    expect(result.publishable).toBeFalse()
  })

  test("unmatched model stays unmatched", () => {
    const catalog = { openai: { models: { "other": { id: "other" } } } }
    const detailed = selectModelsDevRecordDetailed(group("no-such-model-xyz"), catalog)
    expect(detailed.outcome).toBe("unmatched")
  })

  test("no heuristic family guessing", () => {
    // A novel "flash" model shares a substring with a reasoning-capable
    // sibling, but capabilities must not leak across identities.
    const catalog = {
      vendor: {
        models: {
          "foo-4.1-pro": { id: "foo-4.1-pro", reasoning: true, reasoning_options: [{ type: "effort", values: ["high"] }], limit: { context: 1000000, output: 64000 }, tool_call: true },
          "foo-4.1-flash": { id: "foo-4.1-flash", limit: { context: 500000, output: 32000 } },
        },
      },
    }
    const g = group("foo-4.1-flash", "vendor/foo-4.1-flash")
    expect(resolveReasoningState(g, selectModelsDevRecord(g, catalog)).state).toBe("unknown")
    // Name substrings never imply support either.
    const thinking = group("my-thinking-model", "vendor/my-thinking-model")
    expect(resolveReasoningState(thinking, undefined).state).toBe("unknown")
    // Modalities are not copied from the sibling: flash record declares no
    // modalities, so only the text baseline is known.
    const result = assessModelConfiguration(g, catalog, options)
    expect(result.inputModalities.values).toEqual(["text"])
    expect(result.inputModalities.known).toBeFalse()
  })
})

// ---------------------------------------------------------------------------
// Network and LKG
// ---------------------------------------------------------------------------

describe("publication: network and LKG", () => {
  test("timeout is classified and retryable", () => {
    const failure = classifyMetadataFailure(Object.assign(new Error("fetch failed: timeout"), { code: "ETIMEDOUT" }))
    expect(failure.kind).toBe("timeout")
    expect(failure.retryable).toBeTrue()
  })

  test("5xx is classified and retryable", () => {
    const failure = classifyMetadataFailure({ status: 503, message: "Service Unavailable" })
    expect(failure.kind).toBe("server-5xx")
    expect(failure.retryable).toBeTrue()
  })

  test("unreachable is classified and retryable", () => {
    const failure = classifyMetadataFailure(Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" }))
    expect(failure.kind).toBe("unreachable")
    expect(failure.retryable).toBeTrue()
  })

  test("retry recovery restores publication", () => {
    const goodCatalog = {
      openai: { models: { m: { id: "m", limit: { context: 1000, output: 100 }, tool_call: true, reasoning: false } } },
    }
    const g = group("m", "openai/m")
    const failed = assessModelConfiguration(g, {}, options, {
      catalogAvailable: false,
      failure: metadataFailureFor("timeout", "first attempt timed out"),
    })
    expect(failed.status).toBe("metadata-unavailable")
    expect(failed.publishable).toBeFalse()
    const recovered = assessModelConfiguration(g, goodCatalog, options, {
      catalogAvailable: true,
      failure: metadataFailureFor("recovered-after-retry"),
    })
    expect(recovered.status).toBe("configured")
    expect(recovered.publishable).toBeTrue()
  })

  function completeSpecFor(modelName: string) {
    const specs = buildModelSpecs(
      { data: [{ model_name: modelName, litellm_params: { model: `openai/${modelName}` }, model_info: { mode: "chat", ...COMPLETE_INFO } }] },
      { openai: { models: { [modelName]: { id: modelName, limit: { context: 1000, output: 100 }, tool_call: true, reasoning: false } } } },
      options,
    )
    return specs.find((spec) => spec.id === modelName)!
  }

  const GOOD_CATALOG = {
    openai: { models: { m: { id: "m", limit: { context: 1000, output: 100 }, tool_call: true, reasoning: false } } },
  }

  function seedLKG(store: ReturnType<typeof createLastKnownGoodStore>, atMs: number) {
    // Entry captured while metadata was complete; the live group below
    // declares nothing itself so an outage leaves it incomplete.
    const captureGroup = group("m", "openai/m", { ...COMPLETE_INFO })
    store.set(lastKnownGoodKey("m"), createLastKnownGoodEntry(
      captureGroup,
      { providerID: "openai", modelID: "m", record: {} },
      completeSpecFor("m"),
      atMs,
    ))
  }

  test("valid LKG keeps publication while live fails", () => {
    const store = createLastKnownGoodStore()
    seedLKG(store, 1000)
    const live = assessModelConfiguration(bareGroup("m", "openai/m"), {}, options, {
      catalogAvailable: false,
      failure: metadataFailureFor("server-5xx", "HTTP 503"),
    })
    expect(live.publishable).toBeFalse()
    const resolved = resolveConfigurationWithLKG(live, bareGroup("m", "openai/m"), {}, options, store, 2000)
    expect(resolved.assessment.status).toBe("configured-lkg")
    expect(resolved.assessment.publishable).toBeTrue()
    expect(resolved.assessment.usingLKG).toBeTrue()
    expect(resolved.lkgValidation?.valid).toBeTrue()
    expect(isNormallyPublishable(resolved.assessment.status)).toBeTrue()
    // The published spec is the complete LKG snapshot, not the gap.
    expect(resolved.lkg?.spec.limit.context).toBe(1000)
  })

  test("old but stable LKG stays valid (no TTL)", () => {
    const store = createLastKnownGoodStore()
    seedLKG(store, 1000)
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
    const live = assessModelConfiguration(bareGroup("m", "openai/m"), {}, options, {
      catalogAvailable: false,
      failure: metadataFailureFor("timeout"),
    })
    const resolved = resolveConfigurationWithLKG(live, bareGroup("m", "openai/m"), {}, options, store, 1000 + thirtyDaysMs)
    expect(resolved.assessment.status).toBe("configured-lkg")
    expect(resolved.lkgValidation?.ageMs).toBe(thirtyDaysMs)
  })

  test("LKG identity conflict invalidates", () => {
    const store = createLastKnownGoodStore()
    const spec = completeSpecFor("m")
    const g = bareGroup("m", "openai/m")
    store.set(lastKnownGoodKey("m"), {
      schemaVersion: 1,
      modelName: "m",
      canonicalID: "other-model",
      providerID: "openai",
      fetchedAt: new Date(1000).toISOString(),
      fetchedAtEpochMs: 1000,
      spec,
      provenanceDetail: "test",
    })
    const live = assessModelConfiguration(g, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    const resolved = resolveConfigurationWithLKG(live, g, {}, options, store, 2000)
    expect(resolved.assessment.publishable).toBeFalse()
    expect(resolved.lkg).toBeUndefined()
  })

  test("LKG provider conflict invalidates", () => {
    const store = createLastKnownGoodStore()
    seedLKG(store, 1000)
    const otherCatalog = {
      other: { models: { m: { id: "m", tool_call: false, reasoning: false } } },
    }
    const g = bareGroup("m", "openai/m")
    const live = assessModelConfiguration(g, otherCatalog, options, { catalogAvailable: true })
    // The alternative provider record leaves limits missing, so LKG
    // substitution is attempted but must refuse on provider conflict.
    expect(live.publishable).toBeFalse()
    const resolved = resolveConfigurationWithLKG(live, g, otherCatalog, options, store, 2000)
    expect(resolved.lkg).toBeUndefined()
  })

  test("newer trusted live metadata wins over LKG", () => {
    const store = createLastKnownGoodStore()
    seedLKG(store, 1000)
    const g = bareGroup("m", "openai/m")
    // Live metadata is complete on its own: no substitution needed.
    const live = assessModelConfiguration(g, GOOD_CATALOG, options)
    expect(live.publishable).toBeTrue()
    const resolved = resolveConfigurationWithLKG(live, g, GOOD_CATALOG, options, store, 2000)
    expect(resolved.lkg).toBeUndefined()
    expect(resolved.assessment.context.value).toBe(1000)
  })

  test("schema change invalidates LKG", () => {
    const g = group("m", "openai/m", { ...COMPLETE_INFO })
    const spec = completeSpecFor("m")
    const validation = validateLastKnownGood(
      { ...(createLastKnownGoodEntry(g, { providerID: "openai", modelID: "m", record: {} }, spec, 1000)), schemaVersion: 999 as never },
      g,
      { providerID: "openai", modelID: "m", record: {} },
      2000,
    )
    expect(validation.valid).toBeFalse()
    expect(validation.reason).toContain("schema")
  })
})

// ---------------------------------------------------------------------------
// Explicit degradation
// ---------------------------------------------------------------------------

describe("publication: explicit degradation", () => {
  test("no LKG plus fetch failure is never normally published", () => {
    const g = bareGroup("m", "openai/m")
    const live = assessModelConfiguration(g, {}, options, {
      catalogAvailable: false,
      failure: metadataFailureFor("unreachable", "connection refused"),
    })
    expect(live.publishable).toBeFalse()
    expect(isNormallyPublishable(live.status)).toBeFalse()
    const resolved = resolveConfigurationWithLKG(live, g, {}, options, createLastKnownGoodStore(), 2000)
    expect(resolved.assessment.publishable).toBeFalse()
  })

  test("incomplete metadata is never normally published", () => {
    const result = assess("m", "openai/m", { max_input_tokens: 1000, supports_reasoning: false }, {})
    expect(result.publishable).toBeFalse()
    expect(isNormallyPublishable(result.status)).toBeFalse()
  })

  test("accepted degradation stays degraded", () => {
    const g = group("m", "openai/m", { max_input_tokens: 1000, supports_reasoning: false })
    const live = assessModelConfiguration(g, {}, options, { catalogAvailable: true })
    expect(live.publishable).toBeFalse()
    const degraded = acceptDegradedConfiguration(live, { reason: "user accepted in TUI" })
    expect(degraded.status).toBe("degraded")
    expect(degraded.assessment.status).toBe("degraded")
    expect(degraded.remainingGaps.length).toBeGreaterThan(0)
    expect(isPublishableWithDegradedAcceptance("degraded")).toBeTrue()
    expect(isNormallyPublishable("degraded")).toBeFalse()
  })

  test("degraded is never mislabeled configured", () => {
    const g = group("m", "openai/m", { max_input_tokens: 1000, supports_reasoning: false })
    const live = assessModelConfiguration(g, {}, options, { catalogAvailable: true })
    const degraded = acceptDegradedConfiguration(live, {})
    expect(degraded.assessment.status).not.toBe("configured")
    expect(degraded.assessment.status).not.toBe("configured-lkg")
    expect(degraded.acceptance.acceptedFields.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Deterministic inheritance
// ---------------------------------------------------------------------------

describe("publication: deterministic inheritance", () => {
  test("canonical inheritance fills missing fields with provenance", () => {
    const catalog = {
      vendor: {
        models: {
          "base": { id: "base", limit: { context: 100000, output: 10000 }, tool_call: true, reasoning: false },
          "alias-model": { id: "alias-model", canonical_model_id: "vendor/base" },
        },
      },
    }
    const g = group("alias-model", "vendor/alias-model")
    const selected = selectModelsDevRecord(g, catalog)
    expect(selected?.modelID).toBe("alias-model")
    const inherited = resolveInheritedRecord(selected, catalog)
    expect(inherited).toBeDefined()
    expect(inherited?.inheritedFields).toContain("limit")
    expect(inherited?.chain.join(";")).toContain("vendor/base")
    const result = assessModelConfiguration(g, catalog, options)
    expect(result.publishable).toBeTrue()
    expect(result.inheritedFields).toContain("limit")
  })

  test("no inheritance without declared relation", () => {
    const catalog = {
      vendor: {
        models: {
          "rich": { id: "rich", limit: { context: 100000, output: 10000 }, tool_call: true, reasoning: true },
          "plain": { id: "plain" },
        },
      },
    }
    const g = group("plain", "vendor/plain")
    expect(resolveInheritedRecord(selectModelsDevRecord(g, catalog), catalog)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Fixture regression: real-world models
// ---------------------------------------------------------------------------

describe("publication: fixture regression", () => {
  test("fixture models keep their publishability verdicts", () => {
    const result = buildPublicationResult(litellmFixture, modelsDevFixture, options)
    const byID = new Map(result.publishable.map((entry) => [entry.spec.id, entry]))
    // Fully described fixture models publish normally, including the
    // reasoning-with-levels mimo models.
    for (const id of ["kimi-k2.6", "mimo-v2.6-pro", "mimo-v2.6-flash", "gpt-6-sol"]) {
      expect(byID.get(id)?.assessment.status).toBe("configured")
    }
    // Models with unknown key capabilities are blocked, never silently
    // published: qwen3.7-plus has no reasoning evidence anywhere.
    const blockedByID = new Map(result.blocked.map((entry) => [entry.spec.id, entry]))
    expect(blockedByID.get("qwen3.7-plus")?.assessment.unknownFields).toContain("reasoning")
    // Every blocked model carries an explicit non-configured status.
    for (const blocked of result.blocked) {
      expect(blocked.assessment.publishable).toBeFalse()
      expect(isNormallyPublishable(blocked.assessment.status)).toBeFalse()
    }
  })
})
