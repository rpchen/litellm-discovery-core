import { describe, expect, test } from "bun:test"
import {
  buildPublicationResult,
  diagnoseModelSpecs,
  mergeDiscoveryDiagnostics,
  mergePublicationResults,
  modelNameDelta,
  modelNamesOfResponse,
  needsCatalogRefresh,
  responseForModelNames,
  temporaryMetadataFailureModelNames,
} from "../src/index.ts"

const options = { contextTierCap: false, protocolOverrides: {} }

function response(names: readonly string[]): unknown {
  return {
    data: names.map((model_name) => ({
      model_name,
      litellm_params: { model: `openai/${model_name}` },
      model_info: {
        mode: "chat",
        max_input_tokens: 100000,
        max_output_tokens: 10000,
        supports_function_calling: true,
        supports_reasoning: false,
        supports_vision: false,
        supports_pdf_input: false,
        supports_audio_input: false,
        supports_video_input: false,
        supports_audio_output: false,
      },
    })),
  }
}

function catalog(names: readonly string[]): unknown {
  const models = Object.fromEntries(names.map((name) => [`openai/${name}`, {}]))
  const records = Object.fromEntries(names.map((name) => [name, {
    limit: { context: 100000, output: 10000 },
    tool_call: true,
    reasoning: false,
    modalities: { input: ["text"], output: ["text"] },
  }]))
  return { models, providers: { openai: { models: records } } }
}

describe("incremental discovery core helpers", () => {
  test("compares and filters model_name identities only", () => {
    const body = response(["b", "a"])
    expect(modelNamesOfResponse(body)).toEqual(["a", "b"])
    expect(modelNameDelta(["a", "old"], ["b", "a"])).toMatchObject({ added: ["b"], removed: ["old"] })
    expect((responseForModelNames(body, new Set(["b"])) as { data: unknown[] }).data).toHaveLength(1)
  })

  test("merges only processed publication identities", () => {
    const previous = buildPublicationResult(response(["a"]), catalog(["a"]), options)
    const processed = buildPublicationResult(response(["b"]), catalog(["b"]), options)
    const merged = mergePublicationResults(previous, processed, new Set(["a"]))
    expect(merged.publishable.map((entry) => entry.spec.id)).toEqual(["a", "b"])
    expect(needsCatalogRefresh(merged, new Set(["b"]))).toBeFalse()
    const localMiss = buildPublicationResult(response(["b"]), {}, options)
    expect(needsCatalogRefresh(localMiss, new Set(["b"]))).toBeTrue()
  })

  test("merges diagnostics for additions and deletions using current response statistics", () => {
    const previousResponse = response(["a", "deleted"])
    const addedResponse = response(["b"])
    const currentResponse = response(["a", "b"])
    const previous = diagnoseModelSpecs(previousResponse, catalog(["a", "deleted"]), options).diagnostics
    const changed = diagnoseModelSpecs(addedResponse, catalog(["b"]), options).diagnostics

    const afterAdd = mergeDiscoveryDiagnostics(previous, changed, currentResponse, ["a", "b"], new Set(["b"]))
    expect(afterAdd.models.map((model) => model.id)).toEqual(["a", "b"])
    expect(afterAdd.stats).toMatchObject({ responseEntries: 2, deployments: 2, models: 2, modelsDevMatched: 2, modelsDevUnmatched: 0 })

    const afterDelete = mergeDiscoveryDiagnostics(previous, undefined, response(["a"]), ["a"], new Set())
    expect(afterDelete.models.map((model) => model.id)).toEqual(["a"])
    expect(afterDelete.stats).toMatchObject({ responseEntries: 1, deployments: 1, models: 1, modelsDevMatched: 1, modelsDevUnmatched: 0 })
  })

  test("only degraded metadata-withheld models are recovery candidates", () => {
    const body = response(["missing"])
    const result = buildPublicationResult(body, {}, options)
    const diagnostics = diagnoseModelSpecs(body, {}, options).diagnostics
    expect(temporaryMetadataFailureModelNames(result, diagnostics)).toEqual(["missing"])
    expect(temporaryMetadataFailureModelNames(result, { modelsDev: { status: "ok" } })).toEqual([])
  })
})
