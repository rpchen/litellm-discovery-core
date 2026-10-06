import { describe, expect, test } from "bun:test"
import modelsDev from "./fixtures/models-dev.json" with { type: "json" }
import { groupLiteLLMDeployments } from "../src/core/litellm.ts"
import {
  buildVariants,
  candidateModelIDs,
  relationTargets,
  releaseTimestamp,
  selectModelsDevRecord,
  selectModelsDevRecordDetailed,
} from "../src/core/modelsdev.ts"
import {
  DEEPSEEK_V4_1_FLASH_CATALOG,
  DEEPSEEK_V4_1_FLASH_LITELLM,
  RELATION_SEMANTICS_CATALOG,
} from "./fixtures/models-dev-catalog-fixtures.ts"

function one(modelName: string, model: string, info: Record<string, unknown> = {}) {
  return groupLiteLLMDeployments({
    data: [{ model_name: modelName, litellm_params: { model }, model_info: { mode: "chat", ...info } }],
  })[0]!
}

describe("models.dev 记录选择", () => {
  test("候选顺序为 base_model、去路由前缀、model_name", () => {
    expect(candidateModelIDs(one("route-name", "openai/upstream", { base_model: "base" }))).toEqual([
      "base",
      "upstream",
      "route-name",
    ])
  })

  test("canonical identity prefers the original provider record", () => {
    const selected = selectModelsDevRecord(
      one("minimax-m3", "openai/minimax-m3", { base_model: "minimax-m3" }),
      modelsDev,
    )
    expect(selected?.providerID).toBe("minimax")
    expect(selected?.modelID).toBe("MiniMax-M3")
  })

  test("原厂缺失时使用 OpenCode Zen", () => {
    const selected = selectModelsDevRecord(one("kimi-k2.6", "openai/kimi-k2.6"), modelsDev)
    expect(selected?.providerID).toBe("opencode")
  })

  test("显式 models_dev_provider 覆盖家族识别", () => {
    const selected = selectModelsDevRecord(
      one("route", "openai/glm-fallback", { models_dev_provider: "zhipuai" }),
      modelsDev,
    )
    expect(selected?.providerID).toBe("zhipuai")
  })

  test("只有多个转售商时不选择记录，且不模糊去后缀", () => {
    expect(selectModelsDevRecord(one("shared-model", "custom/shared-model"), modelsDev)).toBeUndefined()
    expect(selectModelsDevRecord(one("gpt-5.5-free", "openai/gpt-5.5-free"), modelsDev)).toBeUndefined()
  })

  test("原厂备选 provider（-cn）在无原厂记录时生效", () => {
    const selected = selectModelsDevRecord(one("kimi-cn-only", "openai/kimi-cn-only"), modelsDev)
    expect(selected?.providerID).toBe("moonshotai-cn")
    expect(selected?.modelID).toBe("kimi-cn-only")
  })

  test("canonical_model_id 可自动识别未硬编码的新原厂", () => {
    const catalog = {
      "future-lab": {
        models: {
          "nova-1": {
            id: "nova-1",
            canonical_model_id: "future-lab/nova-1",
            limit: { context: 500_000, output: 50_000 },
          },
        },
      },
      openrouter: {
        models: {
          "nova-1": {
            id: "nova-1",
            canonical_model_id: "future-lab/nova-1",
            limit: { context: 400_000, output: 40_000 },
          },
        },
      },
    }
    expect(selectModelsDevRecord(one("nova-1", "custom/nova-1"), catalog)).toMatchObject({
      providerID: "future-lab",
      modelID: "nova-1",
      selectionSource: "canonical-original",
    })
  })

  test("原厂未知且多 provider 同名时 fallback 顺序为 OpenCode > OpenRouter", () => {
    const withOpenRouter = {
      openrouter: {
        models: {
          "hy4-preview": {
            id: "hy4-preview",
            canonical_model_id: "tencent/hy4-preview",
            limit: { context: 1_024_000, output: 64_000 },
            tool_call: true,
            reasoning: true,
          },
        },
      },
      opencode: {
        models: {
          "hy4-preview": {
            id: "hy4-preview",
            canonical_model_id: "tencent/hy4-preview",
            limit: { context: 1_000_000, output: 32_000 },
          },
        },
      },
      reseller: {
        models: {
          "hy4-preview": {
            id: "hy4-preview",
            limit: { context: 128_000, output: 8_000 },
          },
        },
      },
    }
    expect(selectModelsDevRecord(one("hy4-preview", "openai/hy4-preview"), withOpenRouter)).toMatchObject({
      providerID: "opencode",
      modelID: "hy4-preview",
      selectionSource: "opencode-fallback",
    })

    const withoutOpenCode = {
      openrouter: withOpenRouter.openrouter,
      reseller: withOpenRouter.reseller,
    }
    expect(selectModelsDevRecord(one("hy4-preview", "openai/hy4-preview"), withoutOpenCode)).toMatchObject({
      providerID: "openrouter",
      modelID: "hy4-preview",
      selectionSource: "openrouter-fallback",
    })
  })

  test("没有原厂/OpenRouter/OpenCode 且仍有多个同名 provider 时保持歧义", () => {
    const ambiguous = {
      "reseller-a": { models: { "hy4-preview": { id: "hy4-preview" } } },
      "reseller-b": { models: { "hy4-preview": { id: "hy4-preview" } } },
    }
    expect(selectModelsDevRecord(one("hy4-preview", "custom/hy4-preview"), ambiguous)).toBeUndefined()
  })

  test("同名多部署指向不同模型时保持冲突，不按部署顺序取首个", () => {
    const group = groupLiteLLMDeployments({
      data: [
        {
          model_name: "route",
          litellm_params: { model: "openai/first" },
          model_info: { mode: "chat", base_model: "gpt-5.5" },
        },
        {
          model_name: "route",
          litellm_params: { model: "openai/second" },
          model_info: { mode: "chat", base_model: "gpt-6-sol" },
        },
      ],
    })[0]!
    expect(candidateModelIDs(group)).toEqual(["gpt-5.5", "first", "gpt-6-sol", "second", "route"])
    // Candidate order still lists deployment ids, but a group whose
    // deployments provably name different models must not pick the first
    // candidate as the shared identity.
    expect(selectModelsDevRecordDetailed(group, modelsDev).outcome).toBe("ambiguous")
    expect(selectModelsDevRecord(group, modelsDev)).toBeUndefined()
  })
})

describe("推理档位", () => {
  test("effort 档位保留全部取值", () => {
    const selected = selectModelsDevRecord(one("gpt-5.5", "openai/gpt-5.5"), modelsDev)
    expect(buildVariants(selected, "responses").map((variant) => variant.id)).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
    ])
  })

  test("Messages budget 生成 high 与 max，无 max 时只生成 high", () => {
    const withMax = selectModelsDevRecord(one("claude-sonnet-4-5", "anthropic/claude-sonnet-4-5"), modelsDev)
    const withoutMax = selectModelsDevRecord(one("claude-opus-4-1", "anthropic/claude-opus-4-1"), modelsDev)
    expect(buildVariants(withMax, "messages")).toEqual([
      { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16000 } } },
      { id: "max", settings: { thinking: { type: "enabled", budgetTokens: 64000 } } },
    ])
    expect(buildVariants(withoutMax, "messages")).toEqual([
      { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16000 } } },
    ])
  })

  test("声明最大值小于 16000 时 high 取该值且不再生成 max", () => {
    const record = {
      providerID: "x",
      modelID: "m",
      record: { reasoning_options: [{ type: "budget_tokens", max: 8000 }] },
    }
    expect(buildVariants(record, "messages")).toEqual([
      { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 8000 } } },
    ])
  })

  test("toggle 与非 Messages budget 不生成档位", () => {
    const toggle = selectModelsDevRecord(one("glm-5.3", "openai/glm-5.3"), modelsDev)
    const budget = selectModelsDevRecord(one("claude-sonnet-4-5", "anthropic/claude-sonnet-4-5"), modelsDev)
    expect(buildVariants(toggle, "chat")).toEqual([])
    expect(buildVariants(budget, "chat")).toEqual([])
  })

  test("无选中记录时不生成档位", () => {
    expect(buildVariants(undefined, "chat")).toEqual([])
  })
})

describe("release_date", () => {
  test("字符串日期解析为 Unix 毫秒", () => {
    const selected = selectModelsDevRecord(one("gpt-5.5", "openai/gpt-5.5"), modelsDev)
    expect(releaseTimestamp(selected)).toBe(Date.parse("2026-03-01"))
  })

  test("数字原值直接返回，缺失为 0", () => {
    expect(releaseTimestamp({ providerID: "x", modelID: "m", record: { release_date: 1700000000000 } })).toBe(
      1700000000000,
    )
    expect(releaseTimestamp(undefined)).toBe(0)
  })
})


// ---------------------------------------------------------------------------
// Canonical provider selection precedence (fix-canonical-provider-selection-precedence)
// ---------------------------------------------------------------------------

function deepseekGroup(model: string, extraInfo: Record<string, unknown> = {}) {
  const row = structuredClone(DEEPSEEK_V4_1_FLASH_LITELLM.data[0]!) as {
    litellm_params: Record<string, unknown>
    model_info: Record<string, unknown>
  }
  row.litellm_params = { ...row.litellm_params, model }
  row.model_info = { ...row.model_info, ...extraInfo }
  return groupLiteLLMDeployments({ data: [row as never] })[0]!
}

describe("canonical provider selection: DeepSeek regression", () => {
  test("official provider SKU records win over OpenRouter reseller metadata", () => {
    const selected = selectModelsDevRecord(deepseekGroup("deepseek-v4.1-flash"), DEEPSEEK_V4_1_FLASH_CATALOG)
    expect(selected?.providerID).toBe("deepseek")
    expect(selected?.modelID).toBe("deepseek-flash")
    expect(selected?.selectionSource).toBe("canonical-original")
    // Deterministic SKU tie-break, independent of catalog object order.
    expect(selected?.modelID).not.toBe("deepseek-v4-flash-vision-exp")
  })

  test("selection is stable regardless of catalog iteration order", () => {
    const reordered = {
      opencode: DEEPSEEK_V4_1_FLASH_CATALOG.opencode,
      openrouter: DEEPSEEK_V4_1_FLASH_CATALOG.openrouter,
      deepseek: DEEPSEEK_V4_1_FLASH_CATALOG.deepseek,
    }
    const first = selectModelsDevRecord(deepseekGroup("deepseek-v4.1-flash"), DEEPSEEK_V4_1_FLASH_CATALOG)
    const second = selectModelsDevRecord(deepseekGroup("deepseek-v4.1-flash"), reordered)
    expect(second?.providerID).toBe(first?.providerID)
    expect(second?.modelID).toBe(first?.modelID)
    expect(second?.selectionSource).toBe(first?.selectionSource)
  })

  test("canonical identity is never rewritten by the metadata provider", () => {
    const selected = selectModelsDevRecord(deepseekGroup("deepseek-v4.1-flash"), DEEPSEEK_V4_1_FLASH_CATALOG)
    expect(selected?.providerID).toBe("deepseek")
    // Even in the fallback-only catalog the record choice cannot rename the model.
    const fallbackOnly = {
      openrouter: DEEPSEEK_V4_1_FLASH_CATALOG.openrouter,
      opencode: DEEPSEEK_V4_1_FLASH_CATALOG.opencode,
    }
    const fallback = selectModelsDevRecordDetailed(deepseekGroup("deepseek-v4.1-flash"), fallbackOnly)
    expect(fallback.selected?.providerID).toBe("opencode")
    expect(fallback.selected?.selectionSource).toBe("opencode-fallback")
    expect(fallback.candidates[0]).toBe("deepseek-v4.1-flash")
  })

  test("official SKUs without a routed namespace still prove the canonical namespace", () => {
    // A bare base_model route (no namespace) with official + reseller records:
    // the declared relation values agree on exactly one namespace.
    const group = deepseekGroup("openai/deepseek-v4.1-flash")
    const selected = selectModelsDevRecord(group, DEEPSEEK_V4_1_FLASH_CATALOG)
    expect(selected?.providerID).toBe("deepseek")
    expect(selected?.selectionSource).toBe("canonical-original")
  })

  test("without any official record, official-namespace proof requires relation agreement", () => {
    // Keep only resellers: no provider id equals the canonical namespace, and
    // OpenCode records may not masquerade as the original.
    const resellersOnly = {
      openrouter: DEEPSEEK_V4_1_FLASH_CATALOG.openrouter,
      opencode: DEEPSEEK_V4_1_FLASH_CATALOG.opencode,
    }
    const fallback = selectModelsDevRecord(deepseekGroup("deepseek-v4.1-flash"), resellersOnly)
    expect(fallback?.providerID).toBe("opencode")
    expect(fallback?.selectionSource).toBe("opencode-fallback")
  })

  test("a reseller record may relation-point at the canonical model without becoming the original", () => {
    // Only openrouter: the relation points at deepseek/deepseek-v4.1-flash but
    // openrouter != deepseek, so the selection stays a fallback.
    const openRouterOnly = { openrouter: DEEPSEEK_V4_1_FLASH_CATALOG.openrouter }
    const selected = selectModelsDevRecord(deepseekGroup("deepseek-v4.1-flash"), openRouterOnly)
    expect(selected?.providerID).toBe("openrouter")
    expect(selected?.selectionSource).toBe("openrouter-fallback")
    expect(selected?.matchKind).toBe("relation")
    expect(selected?.recordCanonicalID).toBe("deepseek/deepseek-v4.1-flash")
  })
})

describe("provider selection precedence matrix", () => {
  const identity = { tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } }

  const groupFor = (route: string) =>
    groupLiteLLMDeployments({ data: [{ model_name: "m", litellm_params: { model: route }, model_info: { mode: "chat" } }] })[0]!

  test("Case 1: original + OpenCode + OpenRouter -> canonical-original", () => {
    const catalog = {
      tencent: { models: { "hy4": { id: "hy4", canonical_model_id: "tencent/hy4", limit: { context: 1000, output: 100 }, ...identity } } },
      opencode: { models: { "hy4": { id: "hy4", canonical_model_id: "tencent/hy4", limit: { context: 2000, output: 200 }, ...identity } } },
      openrouter: { models: { "hy4": { id: "hy4", canonical_model_id: "tencent/hy4", limit: { context: 3000, output: 300 }, ...identity } } },
    }
    expect(selectModelsDevRecord(groupFor("openai/hy4"), catalog)).toMatchObject({
      providerID: "tencent",
      selectionSource: "canonical-original",
    })
  })

  test("Case 2: no original, OpenCode + OpenRouter -> opencode-fallback", () => {
    const catalog = {
      opencode: { models: { "hy4": { id: "hy4", canonical_model_id: "tencent/hy4", limit: { context: 2000, output: 200 }, ...identity } } },
      openrouter: { models: { "hy4": { id: "hy4", canonical_model_id: "tencent/hy4", limit: { context: 3000, output: 300 }, ...identity } } },
    }
    expect(selectModelsDevRecord(groupFor("openai/hy4"), catalog)).toMatchObject({
      providerID: "opencode",
      selectionSource: "opencode-fallback",
    })
  })

  test("Case 3: only OpenRouter -> openrouter-fallback", () => {
    const catalog = {
      openrouter: { models: { "hy4": { id: "hy4", canonical_model_id: "tencent/hy4", limit: { context: 3000, output: 300 }, ...identity } } },
    }
    expect(selectModelsDevRecord(groupFor("openai/hy4"), catalog)).toMatchObject({
      providerID: "openrouter",
      selectionSource: "openrouter-fallback",
    })
  })

  test("Case 4: none of the above but a unique remaining provider -> unique-match", () => {
    const catalog = {
      somevendor: { models: { "hy4": { id: "hy4", limit: { context: 4000, output: 400 }, ...identity } } },
    }
    expect(selectModelsDevRecord(groupFor("openai/hy4"), catalog)).toMatchObject({
      providerID: "somevendor",
      selectionSource: "unique-match",
    })
  })

  test("Case 5: multiple unrankable providers -> ambiguous", () => {
    const catalog = {
      vendorx: { models: { "hy4": { id: "hy4", limit: { context: 1, output: 1 }, ...identity } } },
      vendory: { models: { "hy4": { id: "hy4", limit: { context: 2, output: 2 }, ...identity } } },
    }
    const detailed = selectModelsDevRecordDetailed(groupFor("openai/hy4"), catalog)
    expect(detailed.outcome).toBe("ambiguous")
    expect(detailed.ambiguousProviders).toEqual(["vendorx", "vendory"])
    expect(detailed.selected).toBeUndefined()
  })

  test("Case 6: explicit models_dev_provider always ranks first", () => {
    const catalog = {
      tencent: { models: { "hy4": { id: "hy4", canonical_model_id: "tencent/hy4", limit: { context: 1000, output: 100 }, ...identity } } },
      openrouter: { models: { "hy4": { id: "hy4", canonical_model_id: "tencent/hy4", limit: { context: 3000, output: 300 }, ...identity } } },
    }
    const group = groupLiteLLMDeployments({
      data: [{ model_name: "m", litellm_params: { model: "openai/hy4" }, model_info: { mode: "chat", models_dev_provider: "openrouter" } }],
    })[0]!
    expect(selectModelsDevRecord(group, catalog)).toMatchObject({
      providerID: "openrouter",
      selectionSource: "explicit-provider",
    })
  })

  test("Case 7: conflicting explicit providers across deployments stay ambiguous", () => {
    const catalog = {
      tencent: { models: { "hy4": { id: "hy4", canonical_model_id: "tencent/hy4", limit: { context: 1000, output: 100 }, ...identity } } },
      openrouter: { models: { "hy4": { id: "hy4", canonical_model_id: "tencent/hy4", limit: { context: 3000, output: 300 }, ...identity } } },
    }
    const group = groupLiteLLMDeployments({
      data: [
        { model_name: "m", litellm_params: { model: "openai/hy4" }, model_info: { mode: "chat", models_dev_provider: "openrouter" } },
        { model_name: "m", litellm_params: { model: "openai/hy4" }, model_info: { mode: "chat", models_dev_provider: "tencent" } },
      ],
    })[0]!
    const detailed = selectModelsDevRecordDetailed(group, catalog)
    expect(detailed.outcome).toBe("ambiguous")
    expect(detailed.ambiguousProviders).toEqual(["openrouter", "tencent"])
  })

  test("multi-deployment groups keep one shared identity and one selection", () => {
    const catalog = DEEPSEEK_V4_1_FLASH_CATALOG
    const group = groupLiteLLMDeployments({
      data: [
        { model_name: "deepseek-v4.1-flash", litellm_params: { model: "deepseek-v4.1-flash" }, model_info: { mode: "responses", base_model: "deepseek-v4.1-flash", max_output_tokens: 384_000 } },
        { model_name: "deepseek-v4.1-flash", litellm_params: { model: "openai/deepseek-v4.1-flash" }, model_info: { mode: "chat", base_model: "deepseek-v4.1-flash", max_output_tokens: 384_000 } },
      ],
    })[0]!
    const detailed = selectModelsDevRecordDetailed(group, catalog)
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.providerID).toBe("deepseek")
    expect(detailed.selected?.selectionSource).toBe("canonical-original")
  })
})

describe("relation semantics: base_model and canonical_model_id are one relation family", () => {
  test("relationTargets reads canonical_model_id before base_model", () => {
    expect(relationTargets({ canonical_model_id: "a/x", base_model: "b/y" })).toMatchObject({ canonical: "a/x" })
    expect(relationTargets({ base_model: "b/y" })).toMatchObject({ canonical: "b/y" })
    expect(relationTargets({ canonical_model_id: "a/x" }).canonical).toBe("a/x")
  })

  test("base_model relation matches and proves canonical-original with the namespace", () => {
    const group = groupLiteLLMDeployments({
      data: [{ model_name: "m", litellm_params: { model: "base-sku" }, model_info: { mode: "chat", base_model: "base-sku" } }],
    })[0]!
    const detailed = selectModelsDevRecordDetailed(group, { vendorbase: RELATION_SEMANTICS_CATALOG.vendorbase })
    expect(detailed.selected?.providerID).toBe("vendorbase")
    expect(detailed.selected?.selectionSource).toBe("canonical-original")
    expect(detailed.selected?.matchKind).toBe("relation")
  })

  test("canonical_model_id relation resolves an official record behind a different id", () => {
    const group = groupLiteLLMDeployments({
      data: [{ model_name: "rel-model", litellm_params: { model: "openai/rel-model" }, model_info: { mode: "chat" } }],
    })[0]!
    const detailed = selectModelsDevRecordDetailed(group, {
      canonicalvendor: RELATION_SEMANTICS_CATALOG.canonicalvendor,
      reseller: { models: { "rel-model-clone": { id: "rel-model-clone", canonical_model_id: "canonicalvendor/rel-model", limit: { context: 1, output: 1 } } } },
    })
    expect(detailed.selected?.providerID).toBe("canonicalvendor")
    expect(detailed.selected?.selectionSource).toBe("canonical-original")
  })

  test("secondary identity relations reconcile identity without proving a provider alone", () => {
    // Two deployments of one host model: one routed at the official record id
    // (namespace-carried), one at a reseller SKU whose `equivalent_to` names
    // the same canonical model. The relation reconciles the identities; the
    // official record still wins only through its namespace proof.
    const group = groupLiteLLMDeployments({
      data: [
        { model_name: "m", litellm_params: { model: "canonicalvendor/rel-model" }, model_info: { mode: "chat" } },
        { model_name: "m", litellm_params: { model: "vendorequiv/equiv-sku" }, model_info: { mode: "chat" } },
      ],
    })[0]!
    const detailed = selectModelsDevRecordDetailed(group, {
      vendorequiv: RELATION_SEMANTICS_CATALOG.vendorequiv,
      canonicalvendor: RELATION_SEMANTICS_CATALOG.canonicalvendor,
    })
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.providerID).toBe("canonicalvendor")
    expect(detailed.selected?.selectionSource).toBe("canonical-original")
  })

  test("equivalents array relations reconcile identical identities order-independently", () => {
    const group = groupLiteLLMDeployments({
      data: [
        { model_name: "m", litellm_params: { model: "canonicalvendor/rel-model" }, model_info: { mode: "chat" } },
        { model_name: "m", litellm_params: { model: "vendorequivs/equivs-sku" }, model_info: { mode: "chat" } },
      ],
    })[0]!
    const forward = selectModelsDevRecordDetailed(group, {
      vendorequivs: RELATION_SEMANTICS_CATALOG.vendorequivs,
      canonicalvendor: RELATION_SEMANTICS_CATALOG.canonicalvendor,
    })
    const reversed = selectModelsDevRecordDetailed(group, {
      canonicalvendor: RELATION_SEMANTICS_CATALOG.canonicalvendor,
      vendorequivs: RELATION_SEMANTICS_CATALOG.vendorequivs,
    })
    expect(forward.selected?.providerID).toBe("canonicalvendor")
    expect(reversed.selected?.providerID).toBe("canonicalvendor")
  })

  test("alias relations stay inside one provider namespace", () => {
    // A vendor's alias names a model in the vendor's own namespace; it never
    // bridges a different provider's record. This group proves conflict, not
    // identity, unless a real canonical relation links the two.
    const group = groupLiteLLMDeployments({
      data: [
        { model_name: "m", litellm_params: { model: "canonicalvendor/rel-model" }, model_info: { mode: "chat" } },
        { model_name: "m", litellm_params: { model: "vendoralias/rel-model" }, model_info: { mode: "chat" } },
      ],
    })[0]!
    const detailed = selectModelsDevRecordDetailed(group, {
      vendoralias: RELATION_SEMANTICS_CATALOG.vendoralias,
      canonicalvendor: RELATION_SEMANTICS_CATALOG.canonicalvendor,
    })
    expect(detailed.outcome).toBe("ambiguous")
    // With a declared equivalence the same alias bridge becomes provable:
    const bridged = selectModelsDevRecordDetailed(group, {
      vendoralias: RELATION_SEMANTICS_CATALOG.vendoralias,
      canonicalvendor: RELATION_SEMANTICS_CATALOG.canonicalvendor,
      vendorequiv: { models: { "alias-bridge": { id: "alias-bridge", equivalent_to: "canonicalvendor/rel-model", limit: { context: 1, output: 1 } } } },
    })
    // vendoralias/rel-model and vendorequiv/alias-bridge still don't reconcile:
    // only declared relations on the records themselves bridge providers.
    expect(bridged.outcome).toBe("ambiguous")
  })

  test("alias relations reconcile when the record id and alias share the namespace", () => {
    const group = groupLiteLLMDeployments({
      data: [
        { model_name: "m", litellm_params: { model: "canonicalvendor/rel-model" }, model_info: { mode: "chat" } },
        { model_name: "m", litellm_params: { model: "canonicalvendor/rel-model-alias" }, model_info: { mode: "chat" } },
      ],
    })[0]!
    const detailed = selectModelsDevRecordDetailed(group, {
      canonicalvendor: { models: { "rel-model": { id: "rel-model", aliases: ["rel-model-alias"], canonical_model_id: "canonicalvendor/rel-model", limit: { context: 50_000, output: 5_000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    })
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.providerID).toBe("canonicalvendor")
    expect(detailed.selected?.selectionSource).toBe("canonical-original")
  })
})
