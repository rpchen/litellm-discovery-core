import { expect, test } from "bun:test"
import {
  buildModelSpecs,
  buildPublicationResult,
  capturedPublicationVerdict,
  createLastKnownGoodEntry,
  createLastKnownGoodStore,
  diagnoseModelSpecs,
  groupLiteLLMDeployments,
  lastKnownGoodKey,
  mergePublicationResults,
  modelNameDelta,
  modelNamesOfResponse,
} from "../src/index.ts"
import info from "./fixtures/blocked-deployments/model-info.json" with { type: "json" }
import visible from "./fixtures/blocked-deployments/visible-models.json" with { type: "json" }
import catalog from "./fixtures/blocked-deployments/modelsdev-catalog.json" with { type: "json" }

const options = { contextTierCap: false, protocolOverrides: {} }
const disabled = ["gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra", "gpt-6-luna", "gpt-6-sol"]
const activeInfo = () => ({ data: info.data.map((row) => ({ ...row, model_info: { ...row.model_info, blocked: false } })) })

test("[BLOCKED-LIST] publication is a subset of visible models and excludes seven paused GPTs and embedding", () => {
  expect(info.data).toHaveLength(29)
  expect(new Set(info.data.map((row) => row.model_name)).size).toBe(25)
  expect(visible.data).toHaveLength(15)
  expect(buildPublicationResult(activeInfo(), catalog, options).publishable).toHaveLength(20)

  const result = buildPublicationResult(info, catalog, options)
  const ids = result.publishable.map((entry) => entry.spec.id)
  expect(ids).toHaveLength(13)
  const visibleIds = new Set(visible.data.map((row) => row.id))
  expect(ids.every((id) => visibleIds.has(id))).toBeTrue()
  for (const id of disabled) expect(ids).not.toContain(id)
  expect(ids).not.toContain("text-embedding-test")
  expect(ids).not.toContain("metadata-missing-chat")
  expect(result.blocked.map((entry) => entry.spec.id)).toEqual(["metadata-missing-chat"])
})

test("[BLOCKED-MIXED] only active deployments contribute to a mixed group's configuration", () => {
  const body = { data: [
    { model_name: "mixed", model_info: { mode: "responses", blocked: true } },
    { model_name: "mixed", model_info: { mode: "chat", blocked: false } },
    { model_name: "fully-paused", model_info: { mode: "chat", blocked: true } },
    { model_name: "fully-paused", model_info: { mode: "responses", blocked: true } },
  ] }
  const original = structuredClone(body)
  const groups = groupLiteLLMDeployments(body)
  expect(groups.map((group) => group.modelName)).toEqual(["mixed"])
  expect(groups[0]?.deployments).toHaveLength(1)
  expect(groups[0]?.deployments[0]?.sourceIndex).toBe(1)
  expect(buildModelSpecs(body, {}, options).map((model) => [model.id, model.protocol])).toEqual([["mixed", "chat"]])
  expect(body).toEqual(original)
})

test("[BLOCKED-MIXED] only boolean true pauses a deployment, matching LiteLLM 1.99.0", () => {
  for (const value of [undefined, false, null, "true", 1]) {
    const body = { data: [{ model_name: "ordinary-model", model_info: { mode: "chat", ...(value === undefined ? {} : { blocked: value }) } }] }
    expect(modelNamesOfResponse(body)).toEqual(["ordinary-model"])
  }
  expect(modelNamesOfResponse({ data: [{ model_name: "ordinary-model", model_info: { mode: "chat", blocked: true } }] })).toEqual([])
})

test("[BLOCKED-REFRESH] pausing unchanged raw names removes prior publication and prevents LKG resurrection", () => {
  const before = activeInfo()
  const previous = buildPublicationResult(before, catalog, options)
  const groups = new Map(groupLiteLLMDeployments(before).map((group) => [group.modelName, group]))
  const store = createLastKnownGoodStore()
  for (const entry of previous.publishable) {
    store.set(lastKnownGoodKey(entry.spec.id), createLastKnownGoodEntry(
      groups.get(entry.spec.id)!, entry.assessment.identity.selected, entry.spec, 1000,
      capturedPublicationVerdict(entry.assessment, entry.spec), catalog, options,
    ))
  }
  expect(disabled.every((id) => store.get(lastKnownGoodKey(id)) !== undefined)).toBeTrue()
  expect(before.data.map((row) => row.model_name)).toEqual(info.data.map((row) => row.model_name))
  const currentNames = modelNamesOfResponse(info)
  const delta = modelNameDelta(modelNamesOfResponse(before), currentNames)
  expect(delta.added).toEqual([])
  expect([...delta.removed].sort()).toEqual([...disabled].sort())
  const merged = mergePublicationResults(previous, undefined, new Set(currentNames))
  expect(merged.publishable).toHaveLength(13)
  const degraded = buildPublicationResult(info, {}, options, { store, now: 2000 })
  expect(degraded.publishable).toHaveLength(13)
  const diagnostics = diagnoseModelSpecs(info, catalog, options)
  expect(diagnostics.models.map((model) => model.id)).toEqual(buildModelSpecs(info, catalog, options).map((model) => model.id))
  for (const id of disabled) {
    expect(merged.assessments.has(id)).toBeFalse()
    expect(degraded.assessments.has(id)).toBeFalse()
    expect(diagnostics.diagnostics.models.map((model) => model.id)).not.toContain(id)
  }
})
