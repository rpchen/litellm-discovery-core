import { describe, expect, test } from "bun:test"
import litellmFixture from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDevFixture from "./fixtures/models-dev.json" with { type: "json" }
import { buildModelSpecs } from "../src/core/build.ts"
import { groupLiteLLMDeployments, type DeploymentGroup } from "../src/core/litellm.ts"
import {
  groupIdentityConflict,
  resolveInheritedRecord,
  resolveReasoningLevels,
  resolveReasoningState,
  selectModelsDevRecord,
  selectModelsDevRecordDetailed,
} from "../src/core/modelsdev.ts"
import { resolveProtocol } from "../src/core/protocol.ts"
import {
  assessModelConfiguration,
  buildPublicationResult,
  capturedPublicationVerdict,
  classifyMetadataFailure,
  createLastKnownGoodEntry,
  createLastKnownGoodStore,
  isLKGEntryCompatible,
  isNormallyPublishable,
  isPublicationEvidenceAuthority,
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
    // OpenCode ranks before OpenRouter in the corrected fallback precedence.
    const detailed = selectModelsDevRecordDetailed(group("kimi-k2.6", "openrouter/kimi-k2.6"), catalog)
    expect(detailed.selected?.providerID).toBe("opencode")
    expect(detailed.selected?.selectionSource).toBe("opencode-fallback")

    const withoutOpenCode = { openrouter: catalog.openrouter }
    const openRouterOnly = selectModelsDevRecordDetailed(group("kimi-k2.6", "openrouter/kimi-k2.6"), withoutOpenCode)
    expect(openRouterOnly.selected?.providerID).toBe("openrouter")
    expect(openRouterOnly.selected?.selectionSource).toBe("openrouter-fallback")
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

  test("explicit model-level output <= 0 is illegal, not missing", () => {
    // No deployment declares an output limit, so only the trusted
    // model-level value speaks — and a declared 0/-1 is illegal metadata.
    for (const output of [0, -1]) {
      const result = assess("m", "openai/m", { max_input_tokens: 1000, ...toolReason }, {
        openai: { models: { m: { id: "m", limit: { context: 1000, output } } } },
      })
      expect(result.publishable).toBeFalse()
      expect(result.status).toBe("invalid-metadata")
      expect(result.illegalFields).toContain("limit.output")
      expect(result.missingFields).not.toContain("limit.output")
    }
  })

  test("explicit model-level context <= 0 alone is illegal, not missing", () => {
    const result = assess("m", "openai/m", { max_output_tokens: 100, ...toolReason }, {
      openai: { models: { m: { id: "m", limit: { context: 0, output: 100 } } } },
    })
    expect(result.publishable).toBeFalse()
    expect(result.status).toBe("invalid-metadata")
    expect(result.illegalFields).toContain("limit.context")
    expect(result.missingFields).not.toContain("limit.context")
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

  function qualifiedRecord() {
    return { id: "foo", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } }
  }

  const qualifiedCatalog = () => ({
    openai: { models: { foo: qualifiedRecord() } },
    anthropic: { models: { foo: qualifiedRecord() } },
  })

  test("provider-qualified identities keep their provider namespace", () => {
    // openai/foo + anthropic/foo are distinct identities — ambiguous in
    // both deployment orders, never merged by the shared `foo` name.
    for (const deployments of [
      [{ model: "openai/foo" }, { model: "anthropic/foo" }],
      [{ model: "anthropic/foo" }, { model: "openai/foo" }],
    ]) {
      const g = multi("shared", deployments)
      expect(groupIdentityConflict(g, qualifiedCatalog())).toContain("cannot be proven")
      expect(selectModelsDevRecordDetailed(g, qualifiedCatalog()).outcome).toBe("ambiguous")
      expect(assessModelConfiguration(g, qualifiedCatalog(), options).status).toBe("ambiguous")
    }

    // openai/foo + openai/foo is one identity: no group conflict, and with
    // a uniquely matching record the model publishes normally.
    const same = multi("shared", [{ model: "openai/foo" }, { model: "openai/foo" }])
    expect(groupIdentityConflict(same, qualifiedCatalog())).toBeUndefined()
    const openaiOnly = { openai: { models: { foo: qualifiedRecord() } } }
    expect(selectModelsDevRecordDetailed(same, openaiOnly).outcome).toBe("matched")
    expect(assessModelConfiguration(same, openaiOnly, options).status).toBe("configured")

    // openai/foo + unqualified foo without deterministic proof is NOT
    // automatically the same identity — in either order.
    for (const deployments of [
      [{ model: "openai/foo" }, { model: "foo" }],
      [{ model: "foo" }, { model: "openai/foo" }],
    ]) {
      const g = multi("shared", deployments)
      expect(groupIdentityConflict(g, qualifiedCatalog())).toContain("cannot be proven")
      expect(selectModelsDevRecordDetailed(g, qualifiedCatalog()).outcome).toBe("ambiguous")
      expect(assessModelConfiguration(g, qualifiedCatalog(), options).status).toBe("ambiguous")
    }

    // An explicit models_dev_provider on the unqualified deployment is the
    // deterministic namespace proof: both sides resolve to openai/foo.
    const declared = multi("shared", [{ model: "openai/foo" }, { model: "foo", models_dev_provider: "openai" }])
    expect(groupIdentityConflict(declared, qualifiedCatalog())).toBeUndefined()
    const detailed = selectModelsDevRecordDetailed(declared, qualifiedCatalog())
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.providerID).toBe("openai")
    expect(assessModelConfiguration(declared, qualifiedCatalog(), options).status).toBe("configured")
  })

  test("identity equivalence reconciliation is order-independent", () => {
    // The only relation is stored on `other/bar`; `vendor/foo` declares
    // nothing. Connectivity is symmetric, so both orders resolve.
    const catalog = {
      vendor: { models: { foo: { id: "foo", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
      other: { models: { bar: { id: "bar", canonical_model_id: "vendor/foo", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    }
    for (const deployments of [
      [{ model: "vendor/foo" }, { model: "other/bar" }],
      [{ model: "other/bar" }, { model: "vendor/foo" }],
    ]) {
      const g = multi("shared", deployments)
      expect(groupIdentityConflict(g, catalog)).toBeUndefined()
      expect(selectModelsDevRecordDetailed(g, catalog).outcome).toBe("matched")
      expect(assessModelConfiguration(g, catalog, options).status).toBe("configured")
    }

    // vendor/foo + anthropic/foo with no relation stay ambiguous in both
    // orders: a shared unqualified name never bridges two namespaces.
    const unrelated = {
      vendor: { models: { foo: { id: "foo" } } },
      anthropic: { models: { foo: { id: "foo" } } },
    }
    for (const deployments of [
      [{ model: "vendor/foo" }, { model: "anthropic/foo" }],
      [{ model: "anthropic/foo" }, { model: "vendor/foo" }],
    ]) {
      const g = multi("shared", deployments)
      expect(groupIdentityConflict(g, unrelated)).toContain("cannot be proven")
      expect(selectModelsDevRecordDetailed(g, unrelated).outcome).toBe("ambiguous")
      expect(assessModelConfiguration(g, unrelated, options).status).toBe("ambiguous")
    }
  })

  /** Deployment-level identity declarations only; no synthetic defaults. */
  function raw(deployments: Array<{ route?: string; base?: string; provider?: string }>) {
    return groupLiteLLMDeployments({
      data: deployments.map((declared) => ({
        model_name: "shared",
        litellm_params: declared.route !== undefined ? { model: declared.route } : {},
        model_info: {
          mode: "chat",
          ...(declared.base !== undefined ? { base_model: declared.base } : {}),
          ...(declared.provider !== undefined ? { models_dev_provider: declared.provider } : {}),
        },
      })),
    })[0]!
  }

  test("group identity requires positive evidence for every deployment", () => {
    const catalog = {
      openai: { models: { foo: { id: "foo", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    }

    // Known + identity-less: blocked in BOTH deployment orders. Absence
    // of a detected conflict is not proof of identity consistency.
    for (const deployments of [
      [{ route: "openai/foo" }, {}],
      [{}, { route: "openai/foo" }],
    ]) {
      const g = raw(deployments)
      expect(groupIdentityConflict(g, catalog)).toContain("no provable identity")
      expect(selectModelsDevRecordDetailed(g, catalog).outcome).toBe("ambiguous")
      const result = assessModelConfiguration(g, catalog, options)
      expect(result.status).toBe("ambiguous")
      expect(result.publishable).toBeFalse()
    }

    // Two identity-less deployments do not agree merely by having no conflict.
    const bothUnknown = raw([{}, {}])
    expect(groupIdentityConflict(bothUnknown, catalog)).toContain("no provable identity")
    expect(assessModelConfiguration(bothUnknown, catalog, options).status).toBe("ambiguous")
    expect(assessModelConfiguration(bothUnknown, catalog, options).publishable).toBeFalse()

    // A declared provider without any model id proves a provider, not a model.
    const providerOnly = raw([{ provider: "openai" }, { route: "openai/foo" }])
    expect(groupIdentityConflict(providerOnly, catalog)).toContain("no provable identity")
    expect(assessModelConfiguration(providerOnly, catalog, options).status).toBe("ambiguous")

    // A single identity-less deployment is incomplete as well: model_name
    // is the aggregate route alias, never per-deployment identity evidence.
    const solo = groupLiteLLMDeployments({
      data: [{
        model_name: "shared",
        litellm_params: {},
        model_info: {
          mode: "chat",
          max_input_tokens: 100,
          max_output_tokens: 10,
          supports_function_calling: true,
          supports_reasoning: false,
          supports_vision: false,
          supports_pdf_input: false,
          supports_audio_input: false,
          supports_video_input: false,
          supports_audio_output: false,
        },
      }],
    })[0]!
    expect(assessModelConfiguration(solo, catalog, options).status).toBe("ambiguous")
    expect(assessModelConfiguration(solo, catalog, options).publishable).toBeFalse()
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
      { openai: { models: { [modelName]: { id: modelName, limit: { context: 1000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } },
      options,
    )
    return specs.find((spec) => spec.id === modelName)!
  }

  const GOOD_CATALOG = {
    openai: { models: { m: { id: "m", limit: { context: 1000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] }, canonical_model_id: "openai/m" } } },
  }

  function seedLKG(store: ReturnType<typeof createLastKnownGoodStore>, atMs: number) {
    // Review findings 1/2: intrinsic authority requires a canonical relation
    // proof. The capture group declares the explicit provider and the record
    // carries the canonical relation, so the captured values are the
    // authoritative intrinsic ones (context 1000 vs descriptive 200k stays a
    // recorded resolved discrepancy, never a conflict).
    const captureGroup = group("m", "openai/m", { ...COMPLETE_INFO, models_dev_provider: "openai" })
    const catalog = { openai: { models: { m: { id: "m", limit: { context: 1000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] }, canonical_model_id: "openai/m" } } } }
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
      stableIdentity: "openai/m",
      canonicalID: "other-model",
      providerID: "openai",
      evidenceAuthority: "authoritative-intrinsic",
      fetchedAt: new Date(1000).toISOString(),
      fetchedAtEpochMs: 1000,
      spec,
      captured: { tools: "supported", reasoning: "unsupported", inputModalitiesKnown: true, outputModalitiesKnown: true, inputModalities: ["text"], outputModalities: ["text"], context: 1000, input: 1000, output: 32000 },
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
// Publication gate is not user-overridable
// ---------------------------------------------------------------------------

describe("publication: no user override path", () => {
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
    const catalog = { vendor: { models: { partial: { id: "partial", canonical_model_id: "vendor/partial", tool_call: true, reasoning: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 100, output: 10 } } } } }
    // Same routed identity on both deployments, so group identity is provable.
    const sameIdentity = (extra: Record<string, unknown>) => ({ model: "custom/partial", ...extra })
    const filled = assessModelConfiguration(two("partial", sameIdentity({ max_input_tokens: 100 }), sameIdentity({ max_output_tokens: 10 })), catalog, options)
    expect(filled.tools.state).toBe("supported")
    expect(filled.tools.provenance.source).toBe("models.dev")
    expect(filled.reasoning.state).toBe("supported")

    // One deployment's descriptive `false` next to an undeclared sibling is
    // lower-authority evidence: the trusted intrinsic verdict decides and the
    // difference is retained as a resolved discrepancy.
    const d = assessModelConfiguration(two("partial", sameIdentity({ supports_function_calling: false }), sameIdentity({})), catalog, options)
    expect(d.tools.state).toBe("supported")
    expect(d.discrepancies.map((item) => item.field)).toContain("capabilities.tools")
    expect(d.conflicts).toEqual([])
    // The authoritative record also fills the dimensions LiteLLM left
    // undeclared, so the model is fully publishable.
    expect(d.publishable).toBeTrue()
    expect(d.status).toBe("configured")

    // Two deployments that explicitly disagree stay a genuine conflict: a
    // model-level record cannot prove which route the host will use.
    const conflicted = assessModelConfiguration(two("partial", sameIdentity({ supports_function_calling: false }), sameIdentity({ supports_function_calling: true })), catalog, options)
    expect(conflicted.tools.state).toBe("unknown")
    expect(conflicted.conflicts.map((item) => item.field)).toContain("capabilities.tools")
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
    const imageSet = { vendor: { models: { mm: { id: "mm", canonical_model_id: "vendor/mm", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text", "image"], output: ["text"] } } } } }
    const groupFor = (extra: Record<string, unknown>) => two("mm", { ...base, model: "custom/mm", ...extra }, { ...base, model: "custom/mm" })
    const filled = assessModelConfiguration(groupFor({}), imageSet, options)
    expect(filled.inputModalities.known).toBeTrue()
    expect([...filled.inputModalities.values].sort()).toEqual(["image", "text"])

    // Authoritative intrinsic modalities decide; the contradicting descriptive
    // flag is a resolved discrepancy, never an automatic conflict.
    const disagrees = assessModelConfiguration(groupFor({ supports_vision: false }), imageSet, options)
    expect(disagrees.inputModalities.known).toBeTrue()
    expect([...disagrees.inputModalities.values].sort()).toEqual(["image", "text"])
    expect(disagrees.discrepancies.map((item) => item.field)).toContain("capabilities.input")
    expect(disagrees.conflicts).toEqual([])
    expect(disagrees.missingFields).toEqual([])
    expect(disagrees.unknownFields).toEqual([])

    // But two deployments that explicitly disagree stay unresolved.
    const crossDeployment = assessModelConfiguration(
      two("mm", { ...base, model: "custom/mm", supports_vision: true }, { ...base, model: "custom/mm", supports_vision: false }),
      imageSet,
      options,
    )
    expect(crossDeployment.inputModalities.known).toBeFalse()
    expect(crossDeployment.conflicts.map((item) => item.field)).toContain("capabilities.input")
    expect(crossDeployment.publishable).toBeFalse()
  })
})

describe("publication: forged LKG", () => {
  function specWith(extraModelInfo: Record<string, unknown> = {}) {
    return buildModelSpecs(
      { data: [{ model_name: "m", litellm_params: { model: "openai/m" }, model_info: { mode: "chat", ...COMPLETE_INFO, ...extraModelInfo } }] },
      {},
      options,
    )[0]!
  }

  function forged(
    overrides: Partial<LastKnownGoodEntry["captured"]> = {},
    spec = specWith(),
  ): LastKnownGoodEntry {
    return {
      schemaVersion: PUBLICATION_SCHEMA_VERSION,
      modelName: "m",
      stableIdentity: "openai/m",
      canonicalID: "m",
      providerID: "openai",
      evidenceAuthority: "authoritative-intrinsic",
      fetchedAt: new Date(1000).toISOString(),
      fetchedAtEpochMs: 1000,
      spec,
      captured: {
        tools: "supported",
        reasoning: "unsupported",
        inputModalitiesKnown: true,
        outputModalitiesKnown: true,
        inputModalities: [...spec.capabilities.input],
        outputModalities: [...spec.capabilities.output],
        context: spec.limit.context,
        input: spec.limit.input,
        output: spec.limit.output,
        ...overrides,
      },
      provenanceDetail: "forged",
    }
  }

  test("positive limits with unknown tools, reasoning, or modalities are rejected", () => {
    expect(validateCapturedPublication(forged()).valid).toBeTrue()
    expect(validateCapturedPublication(forged({ tools: "unknown" })).valid).toBeFalse()
    expect(validateCapturedPublication(forged({ reasoning: "unknown" })).valid).toBeFalse()
    expect(validateCapturedPublication(forged({ inputModalitiesKnown: false })).valid).toBeFalse()
    expect(validateCapturedPublication(forged({ outputModalitiesKnown: false })).valid).toBeFalse()
    const store = createLastKnownGoodStore()
    store.set(lastKnownGoodKey("m"), forged({ tools: "unknown" }))
    const live = assessModelConfiguration(bareGroup("m"), {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(resolveConfigurationWithLKG(live, bareGroup("m"), {}, options, store, 2000).lkg).toBeUndefined()
  })

  test("captured facts must match the stored spec they would restore", () => {
    // Consistent snapshot: every captured fact equals the stored spec.
    expect(validateCapturedPublication(forged()).valid).toBeTrue()

    // Same-shaped snapshot whose modality set merely changes order still
    // passes: comparison is canonical set equality, never array order.
    const imageSpec = specWith({ supports_vision: true })
    expect(imageSpec.capabilities.input).toEqual(["text", "image"])
    expect(validateCapturedPublication(forged({}, imageSpec)).valid).toBeTrue()
    expect(validateCapturedPublication(forged({
      inputModalities: [...imageSpec.capabilities.input].reverse(),
    }, imageSpec)).valid).toBeTrue()

    // Forged limits: same shape, shifted numbers.
    expect(validateCapturedPublication(forged({ context: 64000 })).valid).toBeFalse()
    expect(validateCapturedPublication(forged({ output: 16000 })).valid).toBeFalse()
    expect(validateCapturedPublication(forged({ input: 64000 })).valid).toBeFalse()

    // Forged modality sets: a genuinely different set fails.
    expect(validateCapturedPublication(forged({ inputModalities: ["text", "image"] })).valid).toBeFalse()
    expect(validateCapturedPublication(forged({ outputModalities: ["text", "audio"] })).valid).toBeFalse()

    // Forged capability verdicts.
    expect(validateCapturedPublication(forged({ tools: "unsupported" })).valid).toBeFalse()
    expect(validateCapturedPublication(forged({ reasoning: "supported" })).valid).toBeFalse()

    // A forged entry never restores through the LKG path either.
    const store = createLastKnownGoodStore()
    store.set(lastKnownGoodKey("m"), forged({ context: 64000 }))
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
    const modelCatalog = { vendor: { models: { lm: { id: "lm", canonical_model_id: "vendor/lm", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } }
    const filled = assessModelConfiguration(two("lm", { ...base }, { ...base }), modelCatalog, options)
    expect(filled.context).toMatchObject({ value: 128000, valid: true })
    expect(filled.output).toMatchObject({ value: 32000, valid: true })
    expect(filled.status).toBe("configured")

    // Both deployments agree on a descriptive 16000 while the authoritative
    // intrinsic record says 32000: authority selects 32000 and records the
    // difference as a resolved discrepancy instead of blocking the model.
    const differing = assessModelConfiguration(two("lm", { ...base, max_output_tokens: 16000 }, { ...base, max_output_tokens: 16000 }), modelCatalog, options)
    expect(differing.output).toMatchObject({ value: 32000, conflict: false, discrepancy: true })
    expect(differing.status).toBe("configured")

    // Deployments that disagree with each other are still a genuine conflict.
    const crossDeployment = assessModelConfiguration(two("lm", { ...base, max_output_tokens: 16000 }, { ...base, max_output_tokens: 8000 }), modelCatalog, options)
    expect(crossDeployment.output).toMatchObject({ value: 0, conflict: true })
    expect(crossDeployment.status).toBe("invalid-metadata")
  })

  test("partial deployment evidence is only filled by an authoritative intrinsic record", () => {
    const modelCatalog = { vendor: { models: { lm: { id: "lm", canonical_model_id: "vendor/lm", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } }
    // One deployment declares, one is silent, and the trusted record exists:
    // the intrinsic value decides and the partial declaration is recorded.
    const filled = assessModelConfiguration(two("lm", { ...base, max_output_tokens: 16000 }, {}), modelCatalog, options)
    expect(filled.output).toMatchObject({ value: 32000, conflict: false, discrepancy: true })
    expect(filled.publishable).toBeTrue()

    // Without authority the same partial declaration stays unknown.
    const partial = assessModelConfiguration(two("lm", { ...base, max_output_tokens: 32000 }, {}), {}, options)
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
  /**
   * `__params` is hoisted into the operator's own deployment configuration
   * (`litellm_params`), the only LiteLLM evidence that proves an enforced
   * endpoint runtime constraint.
   */
  function two(modelName: string, deployments: Array<Record<string, unknown>>) {
    return groupLiteLLMDeployments({
      data: deployments.map((modelInfo) => {
        const { __params, ...info } = modelInfo as { __params?: Record<string, unknown> }
        return {
          model_name: modelName,
          litellm_params: { model: "openai/m", ...__params },
          model_info: { mode: "chat", ...info },
        }
      }),
    })[0]!
  }

  const base = { max_input_tokens: 128000, max_output_tokens: 32000, supports_function_calling: true, supports_reasoning: false, supports_vision: false, supports_pdf_input: false, supports_audio_input: false, supports_video_input: false, supports_audio_output: false } as const
  /** Live body during an outage: capability flags only, no limits. */
  const liveBase = { supports_function_calling: true, supports_reasoning: false, supports_vision: false, supports_pdf_input: false, supports_audio_input: false, supports_video_input: false, supports_audio_output: false }
  /** Live body with only tools/reasoning flags: modality evidence stays incomplete. */
  const sparseLive = { supports_function_calling: true, supports_reasoning: false }

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
    const spec = specs.find((item) => item.id === "m")!
    store.set(lastKnownGoodKey("m"), createLastKnownGoodEntry(
      captureGroup,
      assessment.identity.selected,
      spec,
      atMs,
      capturedPublicationVerdict(assessment, spec),
    ))
    return store
  }

  const TRUSTED = { openai: { models: { m: { id: "m", canonical_model_id: "openai/m", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } }

  test("same live fact is not a conflict and LKG still applies", () => {
    const store = capture(TRUSTED)
    const group = two("m", [liveBase]); const live = assessModelConfiguration(group, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    const resolved = resolveConfigurationWithLKG(live, group, {}, options, store, 2000)
    expect(resolved.assessment.status).toBe("configured-lkg")
  })

  test("live input disagreement rejects the whole entry (input capacity is not total context)", () => {
    const store = capture(TRUSTED)
    const group = two("m", [{ ...liveBase, __params: { max_input_tokens: 64000 } }])
    const live = assessModelConfiguration(group, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    const resolved = resolveConfigurationWithLKG(live, group, {}, options, store, 2000)
    expect(resolved.lkg).toBeUndefined()
    expect(resolved.assessment.publishable).toBeFalse()
    // The rejection is an input-dimension contradiction: captured input is
    // 128000 while the live input capacity is 64000. It is never reported
    // as a total-context conflict just because both are token limits.
    const entry = store.get(lastKnownGoodKey("m"))!
    expect(entry.captured.context).toBe(128000)
    expect(entry.captured.input).toBe(128000)
    const validation = validateLastKnownGood(entry, group, undefined, 2000, options)
    expect(validation.valid).toBeFalse()
    expect(validation.reason).toContain("input")
    expect(validation.reason).not.toContain("context")
  })

  test("live input capacity matching the captured input is not a conflict even without a total-context fact", () => {
    // Capture: trusted total context 128000 with a 64000 deployment input.
    const PARTIAL = {
      openai: { models: { m: { id: "m", canonical_model_id: "openai/m", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    }
    const store = capture(PARTIAL, 1000, { ...base, max_input_tokens: 64000 })
    const entry = store.get(lastKnownGoodKey("m"))!
    expect(entry.captured.context).toBe(128000)
    // The captured input is the trusted intrinsic input capacity, not the
    // lower-authority descriptive deployment declaration.
    expect(entry.captured.input).toBe(128000)

    // Live: same 64000 input, and the trusted total-context fact is gone
    // (incomplete live metadata) — no fact contradicts the snapshot.
    const group = two("m", [{ ...liveBase, max_input_tokens: 64000 }])
    const live = assessModelConfiguration(group, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    const resolved = resolveConfigurationWithLKG(live, group, {}, options, store, 2000)
    expect(resolved.assessment.status).toBe("configured-lkg")
    expect(resolved.assessment.publishable).toBeTrue()
  })

  test("new trusted model-level context conflicts with LKG", () => {
    const store = capture(TRUSTED)
    const group = two("m", [sparseLive])
    // models.dev now declares total context 64000 while another field stays
    // incomplete, so LKG would be attempted — and must refuse.
    const liveCatalog = { openai: { models: { m: { id: "m", limit: { context: 64000, output: 32000 } } } } }
    const live = assessModelConfiguration(group, liveCatalog, options)
    expect(live.status).toBe("discovered-incomplete")
    expect(resolveConfigurationWithLKG(live, group, liveCatalog, options, store, 2000).lkg).toBeUndefined()

    const entry = store.get(lastKnownGoodKey("m"))!
    const detailed = selectModelsDevRecordDetailed(group, liveCatalog)
    const validation = validateLastKnownGood(entry, group, detailed.selected, 2000, options)
    expect(validation.valid).toBeFalse()
    expect(validation.reason).toContain("context")
  })

  test("agreeing trusted model-level context keeps LKG valid", () => {
    const store = capture(TRUSTED)
    const group = two("m", [sparseLive])
    const liveCatalog = { openai: { models: { m: { id: "m", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false } } } }
    const live = assessModelConfiguration(group, liveCatalog, options)
    expect(live.publishable).toBeFalse()
    const resolved = resolveConfigurationWithLKG(live, group, liveCatalog, options, store, 2000)
    expect(resolved.assessment.status).toBe("configured-lkg")
  })

  test("new trusted model-level output conflicts with LKG", () => {
    const store = capture(TRUSTED)
    const group = two("m", [sparseLive])
    const liveCatalog = { openai: { models: { m: { id: "m", limit: { context: 128000, output: 16000 } } } } }
    const live = assessModelConfiguration(group, liveCatalog, options)
    expect(live.status).toBe("discovered-incomplete")
    expect(resolveConfigurationWithLKG(live, group, liveCatalog, options, store, 2000).lkg).toBeUndefined()

    const entry = store.get(lastKnownGoodKey("m"))!
    const detailed = selectModelsDevRecordDetailed(group, liveCatalog)
    const validation = validateLastKnownGood(entry, group, detailed.selected, 2000, options)
    expect(validation.valid).toBeFalse()
    expect(validation.reason).toContain("output")
  })

  test("live output disagreement rejects the whole entry", () => {
    const store = capture(TRUSTED)
    const group = two("m", [{ ...liveBase, __params: { max_tokens: 16000 } }])
    const live = assessModelConfiguration(group, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(resolveConfigurationWithLKG(live, group, {}, options, store, 2000).lkg).toBeUndefined()
  })

  test("descriptive-only disagreement is a resolved discrepancy and never invalidates LKG", () => {
    const store = capture(TRUSTED)
    // LiteLLM `model_info` describes a different output/input than the
    // authoritative snapshot. That is secondary evidence, not a new fact.
    const group = two("m", [{ ...sparseLive, max_output_tokens: 16000, max_input_tokens: 64000 }])
    const live = assessModelConfiguration(group, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(live.publishable).toBeFalse()
    const resolved = resolveConfigurationWithLKG(live, group, {}, options, store, 2000)
    expect(resolved.assessment.status).toBe("configured-lkg")
    expect(resolved.lkg).toBeDefined()
  })

  test("live output matching the captured output keeps LKG valid", () => {
    const store = capture(TRUSTED)
    const entry = store.get(lastKnownGoodKey("m"))!
    expect(entry.captured.output).toBe(32000)
    const group = two("m", [{ ...liveBase, max_output_tokens: 32000 }])
    const live = assessModelConfiguration(group, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(resolveConfigurationWithLKG(live, group, {}, options, store, 2000).assessment.status).toBe("configured-lkg")
  })

  test("live vision=false rejects a captured image-capable snapshot and vice versa", () => {
    const IMAGE_TRUSTED = { openai: { models: { m: { id: "m", canonical_model_id: "openai/m", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text", "image"], output: ["text"] } } } } }
    const imageStore = capture(IMAGE_TRUSTED, 1000, { ...base, supports_vision: true })
    // A proven endpoint constraint declares vision unsupported -> reject.
    const noVision = two("m", [{ ...liveBase, __params: { supports_vision: false } }])
    const live1 = assessModelConfiguration(noVision, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(resolveConfigurationWithLKG(live1, noVision, {}, options, imageStore, 2000).lkg).toBeUndefined()

    const textStore = capture(TRUSTED)
    // A declared `true` can never *add* a modality the snapshot lacks, so a
    // text-only snapshot stays valid and conservative.
    const withVision = two("m", [{ ...liveBase, __params: { supports_vision: true } }])
    const live2 = assessModelConfiguration(withVision, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(resolveConfigurationWithLKG(live2, withVision, {}, options, textStore, 2000).assessment.status).toBe("configured-lkg")

    // Descriptive `supports_vision=false` is secondary evidence and must not
    // invalidate a trusted snapshot on its own.
    const descriptiveNoVision = two("m", [{ ...liveBase, supports_vision: false }])
    const live3 = assessModelConfiguration(descriptiveNoVision, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    expect(resolveConfigurationWithLKG(live3, descriptiveNoVision, {}, options, imageStore, 2000).assessment.status).toBe("configured-lkg")
  })

  function outage(groupBody: Record<string, unknown>[]) {
    const group = two("m", groupBody)
    const live = assessModelConfiguration(group, {}, options, { catalogAvailable: false, failure: metadataFailureFor("timeout") })
    return { group, live }
  }

  test("LKG modality conflict checks every deployment and ignores deployment order", () => {
    const IMAGE_TRUSTED = { openai: { models: { m: { id: "m", canonical_model_id: "openai/m", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text", "image"], output: ["text"] } } } } }
    const imageStore = capture(IMAGE_TRUSTED, 1000, { ...base, supports_vision: true })
    const textStore = capture(TRUSTED)
    // Body without a vision flag: `undefined` on that dimension only.
    const flagless = { supports_function_calling: true, supports_reasoning: false, supports_pdf_input: false, supports_audio_input: false, supports_video_input: false, supports_audio_output: false }

    // Captured image: any explicit false among ANY deployment rejects,
    // regardless of deployment array order. An undefined sibling never
    // masks the conflicting declaration.
    const capturedImageRejects: Array<Array<Record<string, unknown>>> = [
      [{ ...flagless, __params: { supports_vision: false } }, flagless],
      [flagless, { ...flagless, __params: { supports_vision: false } }],
      [{ ...flagless, __params: { supports_vision: false } }, { ...flagless, supports_vision: true }],
      [{ ...flagless, supports_vision: true }, { ...flagless, __params: { supports_vision: false } }],
    ]
    for (const bodies of capturedImageRejects) {
      const { group, live } = outage(bodies)
      expect(resolveConfigurationWithLKG(live, group, {}, options, imageStore, 2000).lkg).toBeUndefined()
    }

    // Captured text-only: any explicit true among ANY deployment rejects,
    // regardless of deployment array order.
    // Captured text-only: only a proven endpoint constraint could remove a
    // modality, and a LiteLLM declaration can never *add* one, so a
    // text-only snapshot simply stays valid and conservative.
    const capturedTextAcceptsDescriptive: Array<Array<Record<string, unknown>>> = [
      [{ ...flagless, supports_vision: true }, { ...flagless, supports_vision: false }],
      [{ ...flagless, supports_vision: false }, { ...flagless, supports_vision: true }],
      [{ ...flagless, supports_vision: true }, flagless],
      [flagless, { ...flagless, supports_vision: true }],
    ]
    for (const bodies of capturedTextAcceptsDescriptive) {
      const { group, live } = outage(bodies)
      expect(resolveConfigurationWithLKG(live, group, {}, options, textStore, 2000).assessment.status).toBe("configured-lkg")
    }

    // A proven constraint that declares image unsupported rejects the stored
    // image-capable snapshot regardless of deployment order.
    const capturedImageConstraintRejects: Array<Array<Record<string, unknown>>> = [
      [{ ...flagless, __params: { supports_vision: false } }, flagless],
      [flagless, { ...flagless, __params: { supports_vision: false } }],
    ]
    for (const bodies of capturedImageConstraintRejects) {
      const { group, live } = outage(bodies)
      expect(resolveConfigurationWithLKG(live, group, {}, options, imageStore, 2000).lkg).toBeUndefined()
    }

    // `undefined` is not a contradiction: agreement (or silence) on every
    // side keeps the entry valid — also order-independent.
    const capturedImageAccepts: Array<Array<Record<string, unknown>>> = [
      [{ ...flagless, supports_vision: true }, { ...flagless, supports_vision: true }],
      [{ ...flagless, supports_vision: true }, flagless],
      [flagless, { ...flagless, supports_vision: true }],
      // Descriptive `false` is secondary evidence: a resolved discrepancy,
      // not a new fact, so the trusted snapshot stays valid.
      [{ ...flagless, supports_vision: false }, flagless],
    ]
    for (const bodies of capturedImageAccepts) {
      const { group, live } = outage(bodies)
      expect(resolveConfigurationWithLKG(live, group, {}, options, imageStore, 2000).assessment.status).toBe("configured-lkg")
    }
    const capturedTextAccepts: Array<Array<Record<string, unknown>>> = [
      [{ ...flagless, supports_vision: false }, { ...flagless, supports_vision: false }],
      [{ ...flagless, supports_vision: false }, flagless],
      [flagless, { ...flagless, supports_vision: false }],
      // A declared `true` cannot add a modality the snapshot lacks.
      [{ ...flagless, supports_vision: true }, flagless],
    ]
    for (const bodies of capturedTextAccepts) {
      const { group, live } = outage(bodies)
      expect(resolveConfigurationWithLKG(live, group, {}, options, textStore, 2000).assessment.status).toBe("configured-lkg")
    }
  })

  test("live reasoning=false rejects a captured reasoning snapshot", () => {
    const REASONING_TRUSTED = { openai: { models: { m: { id: "m", canonical_model_id: "openai/m", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: true, modalities: { input: ["text"], output: ["text"] } } } } }
    const store = capture(REASONING_TRUSTED, 1000, { ...base, supports_reasoning: true })
    const group = two("m", [{ ...liveBase, __params: { supports_reasoning: false } }])
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

describe("publication: LKG stable identity", () => {
  const FOO_CATALOG = {
    openai: { models: { foo: { id: "foo", canonical_model_id: "openai/foo", limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
  }
  const CAPTURE_INFO = {
    max_input_tokens: 128000,
    max_output_tokens: 32000,
    supports_function_calling: true,
    supports_reasoning: false,
    supports_vision: false,
    supports_pdf_input: false,
    supports_audio_input: false,
    supports_video_input: false,
    supports_audio_output: false,
  }

  function fooResponse(route: string, info: Record<string, unknown> = {}) {
    return { data: [{ model_name: "foo", litellm_params: { model: route }, model_info: { mode: "chat", ...info } }] }
  }

  function captureFoo(route: string, extraInfo: Record<string, unknown> = {}) {
    const response = fooResponse(route, { ...CAPTURE_INFO, ...extraInfo })
    const group = groupLiteLLMDeployments(response)[0]!
    const assessment = assessModelConfiguration(group, FOO_CATALOG, options)
    expect(assessment.status).toBe("configured")
    const spec = buildModelSpecs(response, FOO_CATALOG, options).find((item) => item.id === "foo")!
    const store = createLastKnownGoodStore()
    store.set(lastKnownGoodKey("foo"), createLastKnownGoodEntry(
      group,
      assessment.identity.selected,
      spec,
      1000,
      capturedPublicationVerdict(assessment, spec),
    ))
    return store
  }

  /** Outage-time group: identity declarations only, no capability evidence. */
  function outageGroup(route: string, info: Record<string, unknown> = {}) {
    return groupLiteLLMDeployments(fooResponse(route, info))[0]!
  }

  function outageResolve(store: ReturnType<typeof createLastKnownGoodStore>, group: DeploymentGroup) {
    const live = assessModelConfiguration(group, {}, options, {
      catalogAvailable: false,
      failure: metadataFailureFor("server-5xx", "HTTP 503"),
    })
    return resolveConfigurationWithLKG(live, group, {}, options, store, 2000)
  }

  test("provider changed during metadata outage rejects the LKG entry", () => {
    const store = captureFoo("openai/foo")
    const entry = store.get(lastKnownGoodKey("foo"))!
    expect(entry.stableIdentity).toBe("openai/foo")

    const live = outageGroup("anthropic/foo")
    // No enrichment source: `selected` is undefined, yet identity must
    // still be decided from the deployments alone.
    expect(selectModelsDevRecordDetailed(live, {}).outcome).toBe("unmatched")
    const validation = validateLastKnownGood(entry, live, undefined, 2000, options, {})
    expect(validation.valid).toBeFalse()
    expect(validation.reason).toContain("stable identity changed")

    const assessment = assessModelConfiguration(live, {}, options, {
      catalogAvailable: false,
      failure: metadataFailureFor("server-5xx", "HTTP 503"),
    })
    expect(resolveConfigurationWithLKG(assessment, live, {}, options, store, 2000).lkg).toBeUndefined()
  })

  test("same provider-qualified identity survives the outage", () => {
    const store = captureFoo("openai/foo")
    const resolved = outageResolve(store, outageGroup("openai/foo"))
    expect(resolved.assessment.status).toBe("configured-lkg")
    expect(resolved.assessment.publishable).toBeTrue()
  })

  test("unqualified identity never equals a qualified one without proof", () => {
    const store = captureFoo("openai/foo")
    const live = outageGroup("foo")
    const validation = validateLastKnownGood(store.get(lastKnownGoodKey("foo"))!, live, undefined, 2000, options, {})
    expect(validation.valid).toBeFalse()
    expect(validation.reason).toContain("stable identity changed")
    expect(outageResolve(store, live).lkg).toBeUndefined()
  })

  test("explicit models_dev_provider proves the namespace for an unqualified route", () => {
    const store = captureFoo("openai/foo")
    const live = outageGroup("foo", { models_dev_provider: "openai" })
    expect(outageResolve(store, live).assessment.status).toBe("configured-lkg")
  })

  test("base_model provider change rejects the LKG entry", () => {
    const store = captureFoo("openai/foo", { base_model: "openai/foo" })
    const entry = store.get(lastKnownGoodKey("foo"))!
    expect(entry.stableIdentity).toBe("openai/foo")

    const live = outageGroup("openai/foo", { base_model: "anthropic/foo" })
    const validation = validateLastKnownGood(entry, live, undefined, 2000, options, {})
    expect(validation.valid).toBeFalse()
    expect(validation.reason).toContain("stable identity changed")
    expect(outageResolve(store, live).lkg).toBeUndefined()
  })

  test("LKG restore requires a provable live group identity", () => {
    const store = captureFoo("openai/foo")
    const entry = store.get(lastKnownGoodKey("foo"))!

    // Unreconcilable multi-deployment group: LKG may not prove what the
    // live group cannot.
    const conflictGroup = groupLiteLLMDeployments({
      data: [
        { model_name: "foo", litellm_params: { model: "openai/foo" }, model_info: { mode: "chat" } },
        { model_name: "foo", litellm_params: { model: "anthropic/foo" }, model_info: { mode: "chat" } },
      ],
    })[0]!
    const conflict = validateLastKnownGood(entry, conflictGroup, undefined, 2000, options, {})
    expect(conflict.valid).toBeFalse()
    expect(conflict.reason).toContain("cannot be proven")

    // Identity-less live member: incomplete evidence fails closed too.
    const unknownGroup = groupLiteLLMDeployments({
      data: [
        { model_name: "foo", litellm_params: { model: "openai/foo" }, model_info: { mode: "chat" } },
        { model_name: "foo", litellm_params: {}, model_info: { mode: "chat" } },
      ],
    })[0]!
    const unknown = validateLastKnownGood(entry, unknownGroup, undefined, 2000, options, {})
    expect(unknown.valid).toBeFalse()
    expect(unknown.reason).toContain("no provable identity")

    const live = assessModelConfiguration(conflictGroup, {}, options, {
      catalogAvailable: false,
      failure: metadataFailureFor("timeout"),
    })
    expect(resolveConfigurationWithLKG(live, conflictGroup, {}, options, store, 2000).lkg).toBeUndefined()
  })

  test("LKG capture refuses a group without provable identity", () => {
    const store = captureFoo("openai/foo")
    const entry = store.get(lastKnownGoodKey("foo"))!
    const spec = buildModelSpecs(fooResponse("openai/foo", CAPTURE_INFO), FOO_CATALOG, options).find((item) => item.id === "foo")!

    const identityLess = groupLiteLLMDeployments({
      data: [{ model_name: "foo", litellm_params: {}, model_info: { mode: "chat", ...CAPTURE_INFO } }],
    })[0]!
    expect(() => createLastKnownGoodEntry(identityLess, undefined, spec, 1000, entry.captured)).toThrow("provable identity")

    const partial = groupLiteLLMDeployments({
      data: [
        { model_name: "foo", litellm_params: { model: "openai/foo" }, model_info: { mode: "chat", ...CAPTURE_INFO } },
        { model_name: "foo", litellm_params: {}, model_info: { mode: "chat", ...CAPTURE_INFO } },
      ],
    })[0]!
    expect(() => createLastKnownGoodEntry(partial, undefined, spec, 1000, entry.captured)).toThrow("provable identity")
  })
})

function publishedByID(result: ReturnType<typeof buildPublicationResult>, id: string) {
  const entry = result.publishable.find((item) => item.spec.id === id)
  expect(entry).toBeDefined()
  return entry!
}

describe("publication: fixture regression", () => {
  test("fixture models keep their publishability verdicts", () => {
    const result = buildPublicationResult(litellmFixture, modelsDevFixture, options)
    const byID = new Map(result.publishable.map((entry) => [entry.spec.id, entry]))
    const blockedByID = new Map(result.blocked.map((entry) => [entry.spec.id, entry]))
    expect(byID.get("kimi-k2.6")?.assessment.status).toBe("configured")
    expect(byID.get("kimi-k2.6")?.assessment.outputModalities.known).toBeTrue()
    // gpt-6-sol: LiteLLM describes pdf=true while the trusted record's set
    // [text,image] omits pdf. models.dev is authoritative for the model's
    // intrinsic modalities, so this is a resolved discrepancy: the direction
    // is known, the descriptive difference is retained, and the model is
    // publishable.
    const gpt = publishedByID(result, "gpt-6-sol")
    expect(gpt.assessment.inputModalities.known).toBeTrue()
    expect(gpt.assessment.unknownFields).not.toContain("capabilities.input")
    expect(gpt.assessment.discrepancies.map((item) => item.field)).toContain("capabilities.input")
    expect(blockedByID.get("qwen3.7-plus")?.assessment.unknownFields).toContain("reasoning")
    expect(blockedByID.get("qwen3.7-plus")?.assessment.identity.selected?.selectionSource).not.toBe("legacy-family-compatibility")
    // Every blocked model carries an explicit non-configured status.
    for (const blocked of result.blocked) {
      expect(blocked.assessment.publishable).toBeFalse()
      expect(isNormallyPublishable(blocked.assessment.status)).toBeFalse()
    }
  })
})


// ---------------------------------------------------------------------------
// Schema-7 runtime guard for persisted evidence authority (review blocker)
// ---------------------------------------------------------------------------

describe("LKG evidence authority runtime guard", () => {
  function localSpec() {
    return buildModelSpecs(
      { data: [{ model_name: "m", litellm_params: { model: "openai/m" }, model_info: { mode: "chat", ...COMPLETE_INFO } }] },
      {},
      options,
    )[0]!
  }

  function forgedAuthority(evidenceAuthority: unknown, overrides: Record<string, unknown> = {}) {
    const spec = localSpec()
    const base = {
      schemaVersion: PUBLICATION_SCHEMA_VERSION,
      modelName: "m",
      stableIdentity: "openai/m",
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
        inputModalities: [...spec.capabilities.input],
        outputModalities: [...spec.capabilities.output],
        context: spec.limit.context,
        input: spec.limit.input,
        output: spec.limit.output,
      },
      provenanceDetail: "forged",
    }
    return { ...base, evidenceAuthority, ...overrides } as unknown as LastKnownGoodEntry
  }

  test("schemaVersion=7 + missing evidenceAuthority is incompatible", () => {
    const entry = forgedAuthority(undefined)
    expect(isLKGEntryCompatible(entry)).toBeFalse()
    expect(validateLastKnownGood(entry, bareGroup("m", "openai/m"), undefined, 2000, options, {}).valid).toBeFalse()
  })

  test("schemaVersion=7 + invalid evidenceAuthority is incompatible", () => {
    for (const invalid of ["authoritative", "fallback", "", 1, null, "FALLBACK-SERVING"]) {
      const entry = forgedAuthority(invalid)
      expect(isLKGEntryCompatible(entry)).toBeFalse()
      const validation = validateLastKnownGood(entry, bareGroup("m", "openai/m"), undefined, 2000, options, {})
      expect(validation.valid).toBeFalse()
      // Missing/unknown authority never defaults to authoritative: the
      // store path (compatibility guard) and the defensive validation both
      // reject it.
      expect(validation.reason).toContain("authority")
    }
  })

  test("corrupted authority LKG is never configured-lkg through the outage path", () => {
    const store = createLastKnownGoodStore()
    // Persist a well-formed-looking entry whose authority field was corrupted.
    store.set(lastKnownGoodKey("m"), forgedAuthority(undefined) as never)
    const live = assessModelConfiguration(bareGroup("m", "openai/m"), {}, options, {
      catalogAvailable: false,
      failure: metadataFailureFor("timeout"),
    })
    const resolved = resolveConfigurationWithLKG(live, bareGroup("m", "openai/m"), {}, options, store, 2000)
    expect(resolved.assessment.usingLKG ?? false).toBeFalse()
    expect(resolved.assessment.publishable).toBeFalse()
    expect(resolved.lkg).toBeUndefined()
  })

  test("well-formed authorities still pass the guard", () => {
    expect(isLKGEntryCompatible(forgedAuthority("authoritative-intrinsic"))).toBeTrue()
    expect(isLKGEntryCompatible(forgedAuthority("fallback-serving"))).toBeTrue()
  })
})
