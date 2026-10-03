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
  capturedPublicationVerdict,
  classifyMetadataFailure,
  createLastKnownGoodEntry,
  createLastKnownGoodStore,
  degradationEligibility,
  isDegradationEligible,
  isNormallyPublishable,
  isPublishableWithDegradedAcceptance,
  lastKnownGoodKey,
  metadataFailureFor,
  resolveConfigurationWithLKG,
  validateCapturedPublication,
  validateLastKnownGood,
  PUBLICATION_SCHEMA_VERSION,
  type CompletenessAssessment,
  type LastKnownGoodEntry,
} from "../src/core/publication.ts"
import { aggregateTriState, legacyFamilyCompatibilityProvider } from "../src/core/modelsdev.ts"

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
  supports_vision: false,
  supports_audio_output: false,
}

// ---------------------------------------------------------------------------
// Normal match
// ---------------------------------------------------------------------------

describe("publication: normal match", () => {
  test("primary metadata source hit is publishable", () => {
    const catalog = {
      openai: { models: { "gpt-5.5": { id: "gpt-5.5", limit: { context: 1000, output: 100 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
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
      alibaba: { models: { "qwen3.7-plus": { id: "qwen3.7-plus", canonical_model_id: "alibaba/qwen3.7-plus", limit: { context: 500, output: 50 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
      openrouter: { models: { "qwen3.7-plus": { id: "qwen3.7-plus", limit: { context: 999, output: 99 } } } },
    }
    const detailed = selectModelsDevRecordDetailed(group("qwen3.7-plus", "dashscope/qwen3.7-plus"), catalog)
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.providerID).toBe("alibaba")
    expect(detailed.selected?.selectionSource).toBe("canonical-original")
  })

  test("next trusted source is used when the preferred one is absent", () => {
    const catalog = {
      openrouter: { models: { "kimi-k2.6": { id: "kimi-k2.6", limit: { context: 262144, output: 65536 }, tool_call: true, reasoning: true, modalities: { input: ["text"], output: ["text"] }, reasoning_options: [{ type: "effort", values: ["low", "high"] }] } } },
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
    const catalog = { openai: { models: { "gpt-versioned": { id: "gpt-versioned", aliases: ["gpt-stable"], limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } }
    const detailed = selectModelsDevRecordDetailed(group("gpt-stable"), catalog)
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.matchKind).toBe("alias")
  })

  test("equivalent relation resolves deterministically", () => {
    const catalog = {
      vendor: {
        models: {
          "model-b": { id: "model-b", equivalent_to: "vendor/model-a", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } },
          "model-a": { id: "model-a", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } },
        },
      },
    }
    const detailed = selectModelsDevRecordDetailed(group("model-b", "vendor/model-b"), catalog)
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.modelID).toBe("model-b")
  })

  test("provenance names provider and model", () => {
    const catalog = {
      openai: { models: { "gpt-5.5": { id: "gpt-5.5", limit: { context: 1000, output: 100 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
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
    const result = assess("m", "openai/m", {
      ...COMPLETE_INFO,
      supports_pdf_input: false,
      supports_audio_input: false,
      supports_video_input: false,
    }, {
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
            modalities: { input: ["text"], output: ["text"] },
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
            modalities: { input: ["text"], output: ["text"] },
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
  // Every input modality flag declared false: confirmed text-only under
  // the documented sparse-flag rule.
  const toolReason = {
    supports_function_calling: true,
    supports_reasoning: false,
    supports_vision: false,
    supports_pdf_input: false,
    supports_audio_input: false,
    supports_video_input: false,
    supports_audio_output: false,
  }

  test("sufficient trustworthy info is publishable", () => {
    const result = assess("m", "openai/m", { max_input_tokens: 1000, max_output_tokens: 100, ...toolReason }, {})
    expect(result.publishable).toBeTrue()
    expect(result.status).toBe("configured")
  })

  test("missing context blocks publication", () => {
    const result = assess("m", "openai/m", { ...toolReason }, {
      openai: { models: { m: { id: "m", limit: { output: 100 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    })
    expect(result.publishable).toBeFalse()
    expect(result.missingFields).toContain("limit.context")
    expect(result.status).toBe("discovered-incomplete")
  })

  test("missing output blocks publication", () => {
    const result = assess("m", "openai/m", { ...toolReason }, {
      openai: { models: { m: { id: "m", limit: { context: 1000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
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
// Group identity consistency
// ---------------------------------------------------------------------------

describe("publication: group identity", () => {
  function multi(modelName: string, deployments: Array<Record<string, unknown>>) {
    return groupLiteLLMDeployments({
      data: deployments.map((deployment, index) => ({
        model_name: modelName,
        litellm_params: { model: deployment.model ?? `${modelName}-${index}` },
        model_info: { mode: "chat", ...deployment },
      })),
    })[0]!
  }

  test("consistent explicit provider resolves normally", () => {
    const catalog = { openai: { models: { shared: { id: "shared", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } }
    const g = multi("shared", [{ models_dev_provider: "openai", model: "openai/shared" }, { models_dev_provider: "openai", model: "foo/shared" }])
    const detailed = selectModelsDevRecordDetailed(g, catalog)
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.providerID).toBe("openai")
    const result = assessModelConfiguration(g, catalog, options)
    expect(result.status).toBe("configured")
  })

  test("conflicting explicit providers are ambiguous, never first-wins", () => {
    const g = multi("shared", [{ models_dev_provider: "openai", model: "openai/shared" }, { models_dev_provider: "anthropic", model: "openai/shared" }])
    const detailed = selectModelsDevRecordDetailed(g, {})
    expect(detailed.outcome).toBe("ambiguous")
    expect(detailed.ambiguousProviders).toEqual(["anthropic", "openai"])
    const result = assessModelConfiguration(g, {}, options)
    expect(result.status).toBe("ambiguous")
    expect(result.publishable).toBeFalse()
  })

  test("distinct routed identities without proven equivalence stay ambiguous", () => {
    const g = multi("shared", [{ model: "vendor/foo" }, { model: "other/bar" }])
    const detailed = selectModelsDevRecordDetailed(g, { vendor: { models: { foo: { id: "foo" } } }, other: { models: { bar: { id: "bar" } } } })
    expect(detailed.outcome).toBe("ambiguous")
    const result = assessModelConfiguration(g, { vendor: { models: { foo: { id: "foo" } } }, other: { models: { bar: { id: "bar" } } } }, options)
    expect(result.status).toBe("ambiguous")
    expect(result.publishable).toBeFalse()
  })

  test("same routed identity resolves normally", () => {
    const catalog = { vendor: { models: { foo: { id: "foo", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } }
    const g = multi("shared", [{ model: "vendor/foo" }, { model: "vendor/foo" }])
    expect(selectModelsDevRecordDetailed(g, catalog).outcome).toBe("matched")
    const result = assessModelConfiguration(g, catalog, options)
    expect(result.status).toBe("configured")
  })

  test("distinct routed identities with declared equivalence resolve deterministically", () => {
    const catalog = {
      vendor: { models: { foo: { id: "foo", equivalent_to: "other/bar", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
      other: { models: { bar: { id: "bar", canonical_model_id: "other/bar", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    }
    const g = multi("shared", [{ model: "vendor/foo" }, { model: "other/bar" }])
    const detailed = selectModelsDevRecordDetailed(g, catalog)
    expect(detailed.outcome).toBe("matched")
    const result = assessModelConfiguration(g, catalog, options)
    expect(result.status).toBe("configured")
  })
})

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe("publication: identity", () => {
  test("provider-specific canonical match", () => {
    const catalog = {
      moonshotai: { models: { "kimi-k2.5": { id: "kimi-k2.5", limit: { context: 10, output: 1 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
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

  test("family-name matches stay ambiguous without verifiable identity", () => {
    const qwen = selectModelsDevRecordDetailed(group("qwen-future-model"), {
      alibaba: { models: { "qwen-future-model": { id: "qwen-future-model", tool_call: true, reasoning: true } } },
      "reseller-x": { models: { "qwen-future-model": { id: "qwen-future-model", tool_call: false, reasoning: false } } },
    })
    expect(qwen.outcome).toBe("ambiguous")
    expect(qwen.selected).toBeUndefined()
    expect(qwen.ambiguousProviders).toEqual(["alibaba", "reseller-x"])

    const claude = selectModelsDevRecordDetailed(group("claude-future-model"), {
      anthropic: { models: { "claude-future-model": { id: "claude-future-model" } } },
      "reseller-y": { models: { "claude-future-model": { id: "claude-future-model" } } },
    })
    expect(claude.outcome).toBe("ambiguous")
    expect(claude.selected).toBeUndefined()
    expect(legacyFamilyCompatibilityProvider(group("qwen-future-model"))).toBe("alibaba")
    expect(selectModelsDevRecord(group("qwen-future-model"), {
      alibaba: { models: { "qwen-future-model": { id: "qwen-future-model" } } },
      "reseller-x": { models: { "qwen-future-model": { id: "qwen-future-model" } } },
    })).toBeUndefined()
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
    expect(result.unknownFields).toContain("capabilities.input")
    expect(result.publishable).toBeFalse()
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
      openai: { models: { m: { id: "m", limit: { context: 1000, output: 100 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
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
      { openai: { models: { [modelName]: { id: modelName, limit: { context: 1000, output: 100 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } },
      options,
    )
    return specs.find((spec) => spec.id === modelName)!
  }

  const GOOD_CATALOG = {
    openai: { models: { m: { id: "m", limit: { context: 1000, output: 100 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
  }

  function seedLKG(store: ReturnType<typeof createLastKnownGoodStore>, atMs: number) {
    const captureGroup = group("m", "openai/m", { ...COMPLETE_INFO })
    const catalog = { openai: { models: { m: { id: "m", limit: { context: 1000, output: 100 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } }
    store.set(lastKnownGoodKey("m"), createLastKnownGoodEntry(
      captureGroup,
      { providerID: "openai", modelID: "m", record: {} },
      completeSpecFor("m"),
      atMs,
      undefined,
      catalog,
      options,
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
      schemaVersion: PUBLICATION_SCHEMA_VERSION,
      modelName: "m",
      canonicalID: "other-model",
      providerID: "openai",
      fetchedAt: new Date(1000).toISOString(),
      fetchedAtEpochMs: 1000,
      spec,
      captured: { tools: "supported", reasoning: "unsupported", inputModalitiesKnown: true, outputModalitiesKnown: true, inputModalities: ["text"], outputModalities: ["text"], context: 1000, output: 100 },
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
      {
        ...(createLastKnownGoodEntry(g, { providerID: "openai", modelID: "m", record: {} }, spec, 1000, undefined, GOOD_CATALOG, options)),
        schemaVersion: 999 as never,
      },
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
    const live = assessModelConfiguration(g, { openai: { models: { m: { id: "m", tool_call: true, reasoning: false } } } }, options, { catalogAvailable: true })
    expect(live.publishable).toBeFalse()
    const degraded = acceptDegradedConfiguration(live, { reason: "user accepted in TUI" })
    expect(degraded.status).toBe("degraded")
    expect(degraded.assessment.status).toBe("degraded")
    expect(degraded.remainingGaps.length).toBeGreaterThan(0)
    expect(isPublishableWithDegradedAcceptance("degraded")).toBeTrue()
    expect(isNormallyPublishable("degraded")).toBeFalse()
  })

  test("degradation is allowed only for incomplete and unavailable states", () => {
    const incomplete = assess("gap", "openai/gap", { max_input_tokens: 1000, max_output_tokens: 100 }, { openai: { models: { gap: { id: "gap" } } } })
    expect(incomplete.status).toBe("discovered-incomplete")
    expect(isDegradationEligible(incomplete)).toBeTrue()
    expect(acceptDegradedConfiguration(incomplete, {}).status).toBe("degraded")

    const unavailable = assessModelConfiguration(bareGroup("down"), {}, options, {
      catalogAvailable: false,
      failure: metadataFailureFor("timeout"),
    })
    expect(unavailable.status).toBe("metadata-unavailable")
    expect(degradationEligibility(unavailable).eligible).toBeTrue()

    const ambiguous = assessModelConfiguration(group("shared"), {
      a: { models: { shared: { id: "shared" } } },
      b: { models: { shared: { id: "shared" } } },
    }, options)
    expect(ambiguous.status).toBe("ambiguous")
    expect(() => acceptDegradedConfiguration(ambiguous, {})).toThrow(/ambiguous/)

    const invalid = assess("bad", "openai/bad", { max_input_tokens: 0, max_output_tokens: 10, supports_function_calling: true, supports_reasoning: false, supports_vision: false, supports_audio_output: false }, { openai: { models: { bad: { id: "bad" } } } })
    expect(invalid.status).toBe("invalid-metadata")
    expect(() => acceptDegradedConfiguration(invalid, {})).toThrow(/illegal/)

    const sufficientPrivate = assess("private-complete", "custom/private-complete", {
      ...COMPLETE_INFO,
      supports_pdf_input: false,
      supports_audio_input: false,
      supports_video_input: false,
    }, { openai: { models: { other: { id: "other" } } } })
    expect(sufficientPrivate.status).toBe("configured")
    const unmatched = assess("private", "custom/private", { max_input_tokens: 100, max_output_tokens: 10, supports_function_calling: true, supports_reasoning: false }, { openai: { models: { other: { id: "other" } } } })
    expect(unmatched.status).toBe("discovered-incomplete")
    expect(unmatched.identity.outcome).toBe("unmatched")
    expect(isDegradationEligible(unmatched)).toBeFalse()
    expect(() => acceptDegradedConfiguration(unmatched, {})).toThrow(/unmatched/)

    const configured = assess("ok", "openai/ok", {
      ...COMPLETE_INFO,
      supports_pdf_input: false,
      supports_audio_input: false,
      supports_video_input: false,
    }, {})
    expect(configured.status).toBe("configured")
    expect(() => acceptDegradedConfiguration(configured, {})).toThrow(/configured/)
    const lkg = { ...configured, status: "configured-lkg" as const, publishable: true, usingLKG: true, identity: { ...configured.identity, outcome: "matched" as const } }
    expect(() => acceptDegradedConfiguration(lkg, {})).toThrow(/configured/)
    const already = acceptDegradedConfiguration(incomplete, {})
    expect(() => acceptDegradedConfiguration(already.assessment, {})).toThrow(/already degraded/)
  })

  test("degraded is never mislabeled configured", () => {
    const g = group("m", "openai/m", { max_input_tokens: 1000, supports_reasoning: false })
    const live = assessModelConfiguration(g, { openai: { models: { m: { id: "m" } } } }, options, { catalogAvailable: true })
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
          "base": { id: "base", limit: { context: 100000, output: 10000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } },
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

describe("publication: modality completeness", () => {
  const modalityCatalog = {
    vendor: {
      models: {
        "text-only": { id: "text-only", modalities: { input: ["text"], output: ["text"] }, limit: { context: 100, output: 10 }, tool_call: true, reasoning: false },
        "image-model": { id: "image-model", modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 100, output: 10 }, tool_call: true, reasoning: false },
      },
    },
  }

  test("explicit models.dev text-only is known and publishable", () => {
    const result = assessModelConfiguration(group("text-only", "vendor/text-only"), modalityCatalog, options)
    expect(result.inputModalities.known).toBeTrue()
    expect(result.outputModalities.known).toBeTrue()
    expect(result.inputModalities.values).toEqual(["text"])
    expect(result.publishable).toBeTrue()
  })

  test("sparse LiteLLM vision=true alone does not complete the input set", () => {
    const result = assess("declared", "custom/declared", {
      max_input_tokens: 200000,
      max_output_tokens: 32000,
      supports_function_calling: true,
      supports_reasoning: false,
      supports_vision: true,
      supports_audio_output: false,
    }, {})
    expect(result.inputModalities.known).toBeFalse()
    expect(result.inputModalities.values).toEqual(["text", "image"])
    expect(result.unknownFields).toContain("capabilities.input")
    expect(result.publishable).toBeFalse()
  })

  test("all current input flags false is the documented confirmed text-only shape", () => {
    const result = assess("declared", "custom/declared", { ...COMPLETE_INFO, supports_pdf_input: false, supports_audio_input: false, supports_video_input: false }, {})
    expect(result.inputModalities.known).toBeTrue()
    expect(result.inputModalities.values).toEqual(["text"])
    expect(result.publishable).toBeTrue()
  })

  test("no modality evidence blocks normal publication", () => {
    const result = assess("bare", "custom/bare", {
      max_input_tokens: 100,
      max_output_tokens: 10,
      supports_function_calling: true,
      supports_reasoning: false,
    }, {})
    expect(result.inputModalities.known).toBeFalse()
    expect(result.outputModalities.known).toBeFalse()
    expect(result.inputModalities.values).toEqual(["text"])
    expect(result.unknownFields).toContain("capabilities.input")
    expect(result.unknownFields).toContain("capabilities.output")
    expect(result.publishable).toBeFalse()
    expect(result.status).toBe("discovered-incomplete")
  })

  test("explicit image metadata is preserved and names do not infer modalities", () => {
    const image = assessModelConfiguration(group("image-model", "vendor/image-model"), modalityCatalog, options)
    expect(image.inputModalities.known).toBeTrue()
    expect([...image.inputModalities.values].sort()).toEqual(["image", "text"])
    const named = assess("vision-pro-max", "custom/vision-pro-max", {
      max_input_tokens: 100,
      max_output_tokens: 10,
      supports_function_calling: false,
      supports_reasoning: false,
    }, {})
    expect(named.inputModalities.values).toEqual(["text"])
    expect(named.inputModalities.known).toBeFalse()
    expect(named.publishable).toBeFalse()
  })
})

describe("publication: tri-state deployment aggregation", () => {
  function two(modelName: string, left: Record<string, unknown>, right: Record<string, unknown>) {
    const info = (record: Record<string, unknown>) => {
      const model = typeof record.model === "string" ? record.model : undefined
      const rest = { ...record }
      delete (rest as Record<string, unknown>).model
      return { route: model ?? `custom/${modelName}`, modelInfo: rest }
    }
    const l = info(left)
    const r = info(right)
    return groupLiteLLMDeployments({
      data: [
        { model_name: modelName, litellm_params: { model: l.route }, model_info: { mode: "chat", ...l.modelInfo } },
        { model_name: modelName, litellm_params: { model: r.route }, model_info: { mode: "chat", ...r.modelInfo } },
      ],
    })[0]!
  }

  const cases: Array<[string, boolean | undefined, boolean | undefined, "supported" | "unsupported" | "unknown"]> = [
    ["true + true", true, true, "supported"],
    ["false + false", false, false, "unsupported"],
    ["true + false", true, false, "unknown"],
    ["true + unknown", true, undefined, "unknown"],
    ["false + unknown", false, undefined, "unknown"],
    ["unknown + unknown", undefined, undefined, "unknown"],
  ]

  for (const [label, left, right, expected] of cases) {
    test(`tools ${label} -> ${expected}`, () => {
      expect(aggregateTriState([left, right]).state).toBe(expected)
      const info = (value: boolean | undefined) => ({
        model: "custom/tools",
        max_input_tokens: 100,
        max_output_tokens: 10,
        supports_reasoning: false,
        supports_vision: false,
        supports_audio_output: false,
        ...(value === undefined ? {} : { supports_function_calling: value }),
      })
      const result = assessModelConfiguration(two("tools", info(left), info(right)), {}, options)
      expect(result.tools.state).toBe(expected)
      if (expected === "unknown") expect(result.publishable).toBeFalse()
    })

    test(`reasoning ${label} -> ${expected}`, () => {
      expect(aggregateTriState([left, right]).state).toBe(expected)
      const info = (value: boolean | undefined) => ({
        model: "custom/reason",
        max_input_tokens: 100,
        max_output_tokens: 10,
        supports_function_calling: true,
        supports_vision: false,
        supports_audio_output: false,
        ...(value === undefined ? {} : { supports_reasoning: value }),
      })
      const result = assessModelConfiguration(two("reason", info(left), info(right)), {}, options)
      expect(result.reasoning.state).toBe(expected)
      if (expected === "unknown") expect(result.unknownFields).toContain("reasoning")
    })
  }

  test("trusted model-level evidence fills an entirely unevidenced group and records conflicts", () => {
    const catalog = { vendor: { models: { partial: { id: "partial", tool_call: true, reasoning: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 100, output: 10 } } } } }
    // Same routed identity on both deployments, so group identity is provable.
    const sameIdentity = (extra: Record<string, unknown>) => ({ model: "custom/partial", ...extra })
    const filled = assessModelConfiguration(two("partial", sameIdentity({ max_input_tokens: 100 }), sameIdentity({ max_output_tokens: 10 })), catalog, options)
    expect(filled.tools.state).toBe("supported")
    expect(filled.tools.provenance.source).toBe("models.dev")
    expect(filled.reasoning.state).toBe("supported")

    const conflicted = assessModelConfiguration(two("partial", sameIdentity({ supports_function_calling: false }), sameIdentity({})), catalog, options)
    expect(conflicted.tools.state).toBe("unknown")
    expect(conflicted.tools.provenance.detail).toContain("conflicts")
    expect(conflicted.publishable).toBeFalse()
  })
})

describe("publication: modality multi-deployment", () => {
  function two(modelName: string, left: Record<string, unknown>, right: Record<string, unknown>) {
    return groupLiteLLMDeployments({
      data: [
        { model_name: modelName, litellm_params: { model: "custom/mod" }, model_info: { mode: "chat", ...left } },
        { model_name: modelName, litellm_params: { model: "custom/mod" }, model_info: { mode: "chat", ...right } },
      ],
    })[0]!
  }

  const base = { max_input_tokens: 100, max_output_tokens: 10, supports_function_calling: true, supports_reasoning: false, supports_pdf_input: false, supports_audio_input: false, supports_video_input: false, supports_audio_output: false, model: "custom/mod" } as Record<string, unknown>

  test("image agreement resolves; sparse and conflicting combinations stay unknown", () => {
    const supported = assessModelConfiguration(two("m", { ...base, supports_vision: true }, { ...base, supports_vision: true }), {}, options)
    expect(supported.inputModalities.known).toBeTrue()

    const unsupported = assessModelConfiguration(two("m", { ...base, supports_vision: false }, { ...base, supports_vision: false }), {}, options)
    expect(unsupported.inputModalities.known).toBeTrue()
    expect(unsupported.inputModalities.values).toEqual(["text"])

    const partialTrue = assessModelConfiguration(two("m", { ...base, supports_vision: true }, { ...base }), {}, options)
    expect(partialTrue.inputModalities.known).toBeFalse()
    expect(partialTrue.publishable).toBeFalse()

    const partialFalse = assessModelConfiguration(two("m", { ...base, supports_vision: false }, { ...base }), {}, options)
    expect(partialFalse.inputModalities.known).toBeFalse()

    const conflict = assessModelConfiguration(two("m", { ...base, supports_vision: true }, { ...base, supports_vision: false }), {}, options)
    expect(conflict.inputModalities.known).toBeFalse()
    expect(conflict.publishable).toBeFalse()
  })

  test("sparse single-deployment flags never complete the set", () => {
    const visionOnly = assessModelConfiguration(group("m", "custom/m", {
      max_input_tokens: 1, max_output_tokens: 1, supports_function_calling: true, supports_reasoning: false,
      supports_vision: false, supports_audio_output: false,
    }), {}, options)
    expect(visionOnly.inputModalities.known).toBeFalse()
    expect(visionOnly.unknownFields).toContain("capabilities.input")
    // output has a single dimension: one explicit flag settles the direction
    expect(visionOnly.outputModalities.known).toBeTrue()
  })

  test("models.dev complete set fills undeclared dimensions and conflicts with disagreeing flags", () => {
    const imageSet = { vendor: { models: { mm: { id: "mm", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text", "image"], output: ["text"] } } } } }
    const groupFor = (extra: Record<string, unknown>) => two("mm", { ...base, model: "custom/mm", ...extra }, { ...base, model: "custom/mm" })
    const filled = assessModelConfiguration(groupFor({}), imageSet, options)
    expect(filled.inputModalities.known).toBeTrue()
    expect([...filled.inputModalities.values].sort()).toEqual(["image", "text"])

    const disagrees = assessModelConfiguration(groupFor({ supports_vision: false }), imageSet, options)
    expect(disagrees.inputModalities.known).toBeFalse()
    expect(disagrees.publishable).toBeFalse()
  })
})

describe("publication: forged LKG", () => {
  function forged(overrides: Partial<LastKnownGoodEntry["captured"]>): LastKnownGoodEntry {
    const spec = buildModelSpecs(
      { data: [{ model_name: "m", litellm_params: { model: "openai/m" }, model_info: { mode: "chat", ...COMPLETE_INFO } }] },
      {},
      options,
    )[0]!
    return {
      schemaVersion: PUBLICATION_SCHEMA_VERSION,
      modelName: "m",
      canonicalID: "m",
      providerID: "openai",
      fetchedAt: new Date(1000).toISOString(),
      fetchedAtEpochMs: 1000,
      spec,
      captured: {
        tools: "supported",
        reasoning: "unsupported",
        inputModalitiesKnown: true,
        outputModalitiesKnown: true,
        inputModalities: ["text"],
        outputModalities: ["text"],
        context: 1000,
        output: 100,
        ...overrides,
      },
      provenanceDetail: "forged",
    }
  }

  test("positive limits with unknown tools, reasoning, or modalities are rejected", () => {
    expect(validateCapturedPublication(forged({ tools: "unknown" })).valid).toBeFalse()
    expect(validateCapturedPublication(forged({ reasoning: "unknown" })).valid).toBeFalse()
    expect(validateCapturedPublication(forged({ inputModalitiesKnown: false })).valid).toBeFalse()
    expect(validateCapturedPublication(forged({ outputModalitiesKnown: false })).valid).toBeFalse()
    const store = createLastKnownGoodStore()
    store.set(lastKnownGoodKey("m"), forged({ tools: "unknown" }))
    const live = assessModelConfiguration(bareGroup("m"), {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(resolveConfigurationWithLKG(live, bareGroup("m"), {}, options, store, 2000).lkg).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Group limit evidence
// ---------------------------------------------------------------------------

describe("publication: group limit evidence", () => {
  function two(modelName: string, left: Record<string, unknown>, right: Record<string, unknown>) {
    return groupLiteLLMDeployments({
      data: [
        { model_name: modelName, litellm_params: { model: "custom/lim" }, model_info: { mode: "chat", ...left } },
        { model_name: modelName, litellm_params: { model: "custom/lim" }, model_info: { mode: "chat", ...right } },
      ],
    })[0]!
  }

  const base = { supports_function_calling: true, supports_reasoning: false, supports_vision: false, supports_pdf_input: false, supports_audio_input: false, supports_video_input: false, supports_audio_output: false } as const

  test("context: same values are known; disagreement conflicts; value+unknown stays unknown", () => {
    const same = assessModelConfiguration(two("m", { ...base, max_input_tokens: 128000 }, { max_input_tokens: 128000 }), {}, options)
    expect(same.context).toMatchObject({ value: 128000, valid: true, unknown: false, conflict: false })

    const differing = assessModelConfiguration(two("m", { ...base, max_input_tokens: 128000 }, { max_input_tokens: 64000 }), {}, options)
    expect(differing.context).toMatchObject({ value: 0, conflict: true })
    expect(differing.status).toBe("invalid-metadata")
    expect(differing.conflictFields).toContain("limit.context")

    const partial = assessModelConfiguration(two("m", { ...base, max_input_tokens: 128000 }, {}), {}, options)
    expect(partial.context).toMatchObject({ value: 0, unknown: true, conflict: false })
    expect(partial.publishable).toBeFalse()
  })

  test("output: same values known; differing values conflict; value+unknown unknown", () => {
    const same = assessModelConfiguration(two("m", { ...base, max_output_tokens: 32000 }, { max_output_tokens: 32000 }), {}, options)
    expect(same.output).toMatchObject({ value: 32000, valid: true, conflict: false })

    const differing = assessModelConfiguration(two("m", { ...base, max_output_tokens: 32000 }, { max_output_tokens: 16000 }), {}, options)
    expect(differing.output).toMatchObject({ value: 0, conflict: true })
    expect(differing.status).toBe("invalid-metadata")

    const partial = assessModelConfiguration(two("m", { ...base, max_output_tokens: 32000 }, {}), {}, options)
    expect(partial.output).toMatchObject({ value: 0, unknown: true, conflict: false })
    expect(partial.publishable).toBeFalse()
  })

  test("all deployments unknown fall back to trusted model-level, and disagreeing model-level conflicts", () => {
    const modelCatalog = { vendor: { models: { lm: { id: "lm", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } }
    const filled = assessModelConfiguration(two("lm", { ...base }, { ...base }), modelCatalog, options)
    expect(filled.context).toMatchObject({ value: 128000, valid: true })
    expect(filled.output).toMatchObject({ value: 32000, valid: true })
    expect(filled.status).toBe("configured")

    const conflicted = assessModelConfiguration(two("lm", { ...base, max_output_tokens: 16000 }, { ...base, max_output_tokens: 16000 }), modelCatalog, options)
    expect(conflicted.output).toMatchObject({ value: 0, conflict: true })
    expect(conflicted.publishable).toBeFalse()
  })

  test("partial deployment evidence is not filled by model-level metadata", () => {
    const modelCatalog = { vendor: { models: { lm: { id: "lm", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } }
    const partial = assessModelConfiguration(two("lm", { ...base, max_output_tokens: 32000 }, {}), modelCatalog, options)
    expect(partial.output).toMatchObject({ value: 0, unknown: true, conflict: false })
    expect(partial.publishable).toBeFalse()
  })

  test("private unmatched models obey the same group completeness rule", () => {
    const partial = assessModelConfiguration(two("pm", { ...base, max_input_tokens: 128000 }, {}), {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(partial.status).toBe("metadata-unavailable")
    expect(partial.publishable).toBeFalse()
    const same = assessModelConfiguration(two("pm", { ...base, max_input_tokens: 128000, max_output_tokens: 32000 }, { ...base, max_input_tokens: 128000, max_output_tokens: 32000 }), {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(same.status).toBe("configured")
  })
})

describe("publication: LKG actual-value conflicts", () => {
  function two(modelName: string, deployments: Array<Record<string, unknown>>) {
    return groupLiteLLMDeployments({
      data: deployments.map((modelInfo) => ({
        model_name: modelName,
        litellm_params: { model: "openai/m" },
        model_info: { mode: "chat", ...modelInfo },
      })),
    })[0]!
  }

  const base = { max_input_tokens: 128000, max_output_tokens: 32000, supports_function_calling: true, supports_reasoning: false, supports_vision: false, supports_pdf_input: false, supports_audio_input: false, supports_video_input: false, supports_audio_output: false } as const
  /** Live body during an outage: capability flags only, no limits. */
  const liveBase = { supports_function_calling: true, supports_reasoning: false, supports_vision: false, supports_pdf_input: false, supports_audio_input: false, supports_video_input: false, supports_audio_output: false }

  function capture(catalog: unknown, atMs = 1000, captureInfo: Record<string, unknown> = base) {
    const store = createLastKnownGoodStore()
    const captureGroup = two("m", [captureInfo])
    const assessment = assessModelConfiguration(captureGroup, catalog, options)
    expect(assessment.status).toBe("configured")
    const specs = buildModelSpecs(
      { data: [{ model_name: "m", litellm_params: { model: "openai/m" }, model_info: { mode: "chat", ...captureInfo } }] },
      catalog,
      options,
    )
    store.set(lastKnownGoodKey("m"), createLastKnownGoodEntry(
      captureGroup,
      assessment.identity.selected,
      specs.find((spec) => spec.id === "m")!,
      atMs,
      capturedPublicationVerdict(assessment),
    ))
    return store
  }

  const TRUSTED = { openai: { models: { m: { id: "m", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } }

  test("same live fact is not a conflict and LKG still applies", () => {
    const store = capture(TRUSTED)
    const group = two("m", [liveBase]); const live = assessModelConfiguration(group, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    const resolved = resolveConfigurationWithLKG(live, group, {}, options, store, 2000)
    expect(resolved.assessment.status).toBe("configured-lkg")
  })

  test("live context disagreement rejects the whole entry", () => {
    const store = capture(TRUSTED)
    const group = two("m", [{ ...liveBase, max_input_tokens: 64000 }])
    const live = assessModelConfiguration(group, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    const resolved = resolveConfigurationWithLKG(live, group, {}, options, store, 2000)
    expect(resolved.lkg).toBeUndefined()
    expect(resolved.assessment.publishable).toBeFalse()
  })

  test("live output disagreement rejects the whole entry", () => {
    const store = capture(TRUSTED)
    const group = two("m", [{ ...liveBase, max_output_tokens: 16000 }])
    const live = assessModelConfiguration(group, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(resolveConfigurationWithLKG(live, group, {}, options, store, 2000).lkg).toBeUndefined()
  })

  test("live vision=false rejects a captured image-capable snapshot and vice versa", () => {
    const IMAGE_TRUSTED = { openai: { models: { m: { id: "m", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text", "image"], output: ["text"] } } } } }
    const imageStore = capture(IMAGE_TRUSTED, 1000, { ...base, supports_vision: true })
    const noVision = two("m", [{ ...liveBase, supports_vision: false }])
    const live1 = assessModelConfiguration(noVision, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(resolveConfigurationWithLKG(live1, noVision, {}, options, imageStore, 2000).lkg).toBeUndefined()

    const textStore = capture(TRUSTED)
    const withVision = two("m", [{ ...liveBase, supports_vision: true }])
    const live2 = assessModelConfiguration(withVision, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(resolveConfigurationWithLKG(live2, withVision, {}, options, textStore, 2000).lkg).toBeUndefined()
  })

  test("live reasoning=false rejects a captured reasoning snapshot", () => {
    const REASONING_TRUSTED = { openai: { models: { m: { id: "m", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: true, modalities: { input: ["text"], output: ["text"] } } } } }
    const store = capture(REASONING_TRUSTED, 1000, { ...base, supports_reasoning: true })
    const group = two("m", [{ ...liveBase, supports_reasoning: false }])
    const live = assessModelConfiguration(group, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(resolveConfigurationWithLKG(live, group, {}, options, store, 2000).lkg).toBeUndefined()
  })

  test("illegal live limit never restores LKG", () => {
    const store = capture(TRUSTED)
    const group = two("m", [{ ...liveBase, max_input_tokens: 0 }])
    const live = assessModelConfiguration(group, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(live.status).toBe("invalid-metadata")
    expect(resolveConfigurationWithLKG(live, group, {}, options, store, 2000).lkg).toBeUndefined()
    expect(resolveConfigurationWithLKG(live, group, {}, options, store, 2000).assessment.status).toBe("invalid-metadata")
  })
})

describe("publication: fixture regression", () => {
  test("fixture models keep their publishability verdicts", () => {
    const result = buildPublicationResult(litellmFixture, modelsDevFixture, options)
    const byID = new Map(result.publishable.map((entry) => [entry.spec.id, entry]))
    const blockedByID = new Map(result.blocked.map((entry) => [entry.spec.id, entry]))
    expect(byID.get("kimi-k2.6")?.assessment.status).toBe("configured")
    expect(byID.get("kimi-k2.6")?.assessment.outputModalities.known).toBeTrue()
    // gpt-6-sol: LiteLLM declares pdf=true but the trusted record's set
    // [text,image] omits pdf — a real conflict, and audio stays undeclared
    // on both sides, so the input direction cannot be named known.
    expect(blockedByID.get("gpt-6-sol")?.assessment.unknownFields).toContain("capabilities.input")
    expect(blockedByID.get("qwen3.7-plus")?.assessment.unknownFields).toContain("reasoning")
    expect(blockedByID.get("qwen3.7-plus")?.assessment.identity.selected?.selectionSource).not.toBe("legacy-family-compatibility")
    // Every blocked model carries an explicit non-configured status.
    for (const blocked of result.blocked) {
      expect(blocked.assessment.publishable).toBeFalse()
      expect(isNormallyPublishable(blocked.assessment.status)).toBeFalse()
    }
  })
})
