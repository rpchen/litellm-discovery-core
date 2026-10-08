/**
 * `buildModelSpecs` contract (adopt-modelsdev-canonical-catalog, task 6.3 rewrite).
 *
 * Single-resolver invariant: every spec is `toModelSpec(resolveModel(...))`.
 * Rewritten cases (old → new, with reasons):
 * - 完整快照 → 保留快照机制并刷新（行为变化清单见 PR：未证明记录不再供给、
 *   档位仅 serving、价格仅声明/proven serving、无跨维度 context）。
 * - 协议覆盖档位 → 无 serving 证明时无档位；有 serving 记录时按协议生成。
 * - contextTierCap → 作用于 canonical/serving context（fixtures 改用 catalog 形状）。
 * - releaseUnit → 仅 resolved serving 记录的日期（缺失不回填 canonical）。
 */
import { describe, expect, test } from "bun:test"
import litellm from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDev from "./fixtures/models-dev.json" with { type: "json" }
import { buildModelSpecs, modelFingerprint } from "../src/core/build.ts"

const options = { contextTierCap: true, protocolOverrides: {} }

function catalogDoc(models: Record<string, unknown>, providers: Record<string, unknown>) {
  return {
    models,
    providers: Object.fromEntries(
      Object.entries(providers).map(([provider, records]) => [provider, { models: records }]),
    ),
  }
}

describe("buildModelSpecs", () => {
  test("输出与 fixtures 的完整快照一致", () => {
    expect(buildModelSpecs(litellm, modelsDev, options)).toMatchSnapshot()
  })

  test("稳定排序：按 id 的 en 顺序", () => {
    const specs = buildModelSpecs(litellm, modelsDev, options)
    const ids = specs.map((spec) => spec.id)
    expect(ids).toEqual([...ids].sort((left, right) => left.localeCompare(right, "en")))
  })

  test("协议覆盖影响 spec.protocol；档位仅来自已证明 serving 记录", () => {
    const doc = catalogDoc(
      { "labA/claude-x": { limit: { context: 200000, output: 32000 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: true } },
      {
        labA: {
          "claude-x": {
            id: "claude-x",
            limit: { context: 200000, output: 32000 },
            modalities: { input: ["text"], output: ["text"] },
            tool_call: true,
            reasoning: true,
            reasoning_options: [{ type: "budget_tokens", max: 64000 }],
          },
        },
      },
    )
    const input = {
      data: [{ model_name: "claude-x", litellm_params: { model: "claude-x" }, model_info: { mode: "chat", models_dev_provider: "labA", max_input_tokens: 200000, max_output_tokens: 32000, supports_function_calling: true, supports_reasoning: true } }],
    }
    // Serving unproven (no declaration) → messages protocol but no variants.
    const unproven = buildModelSpecs(
      {
        data: [{ model_name: "claude-x", litellm_params: { model: "anthropic/claude-sonnet-4-5" }, model_info: { mode: "chat" } }],
      },
      modelsDev,
      options,
    )[0]!
    expect(unproven.protocol).toBe("messages")
    expect(unproven.variants).toEqual([])

    // Proven serving record → budget variants for the messages protocol.
    const messagesSpec = buildModelSpecs(input, doc, options)[0]!
    expect(messagesSpec.protocol).toBe("messages")
    expect(messagesSpec.variants.map((variant) => variant.id)).toEqual(["high", "max"])

    const chatSpec = buildModelSpecs(input, doc, { ...options, protocolOverrides: { "claude-x": "chat" } })[0]!
    expect(chatSpec.protocol).toBe("chat")
    expect(chatSpec.variants).toEqual([])
  })

  test("contextTierCap 截断 canonical context，可关闭", () => {
    const doc = catalogDoc(
      { "labA/g": { limit: { context: 1000000, input: 922000, output: 128000 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false } },
      {},
    )
    const input = {
      data: [{ model_name: "g", litellm_params: { model: "g" }, model_info: { mode: "chat", max_input_tokens: 922000, max_output_tokens: 128000, supports_function_calling: true, supports_reasoning: false, supports_vision: false, supports_pdf_input: false, supports_audio_input: false, supports_video_input: false, supports_audio_output: false, input_cost_per_token_above_272k_tokens: 1 } }],
    }
    expect(buildModelSpecs(input, doc, options)[0]!.limit.context).toBe(272000)
    expect(buildModelSpecs(input, doc, { ...options, contextTierCap: false })[0]!.limit.context).toBe(1000000)
  })

  test("releaseUnit 仅来自 resolved serving 记录；缺失不回填 canonical", () => {
    const doc = catalogDoc(
      { "openai/gpt-x": { limit: { context: 100000, output: 10000 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false, release_date: "2026-05-01" } },
      {
        openai: {
          "gpt-x": { id: "gpt-x", limit: { context: 100000, output: 10000 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false, release_date: "2026-06-01" },
          "gpt-numeric": { id: "gpt-numeric", limit: { context: 100000, output: 10000 }, release_date: 1700000000000 },
        },
      },
    )
    const input = (name: string, extra: Record<string, unknown> = {}) => ({
      data: [{ model_name: name, litellm_params: { model: name }, model_info: { mode: "chat", models_dev_provider: "openai", max_input_tokens: 100000, max_output_tokens: 10000, supports_function_calling: true, supports_reasoning: false, supports_vision: false, supports_pdf_input: false, supports_audio_input: false, supports_video_input: false, supports_audio_output: false, ...extra } }],
    })
    // Serving record date wins while serving is proven.
    const serving = buildModelSpecs(input("gpt-x"), doc, options)[0]!
    expect(serving.releaseUnit).toBe("unix-ms")
    expect(serving.released).toBe(Date.parse("2026-06-01"))
    // Numeric serving date passes through as unit-unknown.
    const numeric = buildModelSpecs(input("gpt-numeric"), doc, options)[0]!
    expect(numeric.releaseUnit).toBe("unknown")
    expect(numeric.released).toBe(1700000000000)
  })

  test("成功空响应产生空清单", () => {
    expect(buildModelSpecs({ data: [] }, modelsDev, options)).toEqual([])
  })
})

describe("modelFingerprint", () => {
  test("同输入同指纹", () => {
    const first = buildModelSpecs(litellm, modelsDev, options)
    const second = buildModelSpecs(litellm, modelsDev, options)
    expect(modelFingerprint(first)).toBe(modelFingerprint(second))
  })

  test("任一字段变化指纹变化", () => {
    const specs = buildModelSpecs(litellm, modelsDev, options)
    const changed = specs.map((spec, index) =>
      index === 0 ? { ...spec, limit: { ...spec.limit, context: spec.limit.context + 1 } } : spec,
    )
    expect(modelFingerprint(specs)).not.toBe(modelFingerprint(changed))
  })

  test("键顺序不影响指纹", () => {
    const specs = buildModelSpecs(litellm, modelsDev, options)
    const shuffled = specs.map((spec) => {
      const reordered = Object.fromEntries(Object.entries(spec).reverse()) as typeof spec
      return reordered
    })
    expect(modelFingerprint(shuffled)).toBe(modelFingerprint(specs))
  })
})
