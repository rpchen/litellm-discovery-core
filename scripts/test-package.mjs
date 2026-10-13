import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const npmExecPath = process.env.npm_execpath
const npm = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm"
const temp = mkdtempSync(path.join(tmpdir(), "litellm-discovery-core-consumer-"))

function npmRun(args, options) {
  return execFileSync(npm, npmExecPath ? [npmExecPath, ...args] : args, {
    shell: !npmExecPath && process.platform === "win32",
    ...options,
  })
}

const consumerSource = `
import assert from "node:assert/strict"
import { buildModelSpecs, normalizeLiteLLMURL, groupLiteLLMDeployments, selectModelsDevRecord, mapCapabilities,
  buildPublicationResult, resolveModel, createLastKnownGoodEntry, createLastKnownGoodStore, capturedPublicationVerdict,
  diagnoseModelSpecs, resolveNumericField, resolveBooleanField, resolveModalityField,
  mergeDiscoveryDiagnostics, mergePublicationResults, modelNameDelta, modelNamesOfResponse,
  needsCatalogRefresh, responseForModelNames, temporaryMetadataFailureModelNames } from "litellm-discovery-core"

const resolved = await import.meta.resolve("litellm-discovery-core")
assert.match(resolved, /\\/node_modules\\/litellm-discovery-core\\/dist\\/index\\.js$/)
const models = buildModelSpecs(
  { data: [{ model_name: "consumer-model", litellm_params: { model: "openai/consumer-model" }, model_info: { mode: "chat" } }] },
  {},
  { contextTierCap: true, protocolOverrides: {} },
)
assert.equal(models[0]?.id, "consumer-model")
assert.deepEqual(normalizeLiteLLMURL("http://litellm.example:4000/v1"), {
  rootURL: "http://litellm.example:4000",
  apiBaseURL: "http://litellm.example:4000/v1",
  modelInfoURL: "http://litellm.example:4000/v1/model/info",
  legacyModelInfoURL: "http://litellm.example:4000/model/info",
})
const body = { data: [{ model_name: "consumer-model", model_info: { mode: "chat" }, litellm_params: {} }] }
assert.deepEqual(modelNamesOfResponse(body), ["consumer-model"])
assert.deepEqual(modelNameDelta(["consumer-model"], ["consumer-model", "consumer-new"]).added, ["consumer-new"])
assert.equal(responseForModelNames({ data: [...body.data, { model_name: "consumer-new" }] }, new Set(["consumer-new"])).data.length, 1)
const record = { id: "consumer-model", canonical_model_id: "lab/consumer-model", tool_call: true, reasoning: true,
  reasoning_options: [{ type: "effort", values: ["low", "max"] }], modalities: { input: ["text"], output: ["text"] },
  limit: { context: 100000, output: 10000 } }
const catalog = { models: { "lab/consumer-model": {} }, providers: { lab: { models: { "consumer-model": record } } } }
const options = { contextTierCap: true, protocolOverrides: {} }
const group = groupLiteLLMDeployments(body)[0]
const selected = selectModelsDevRecord(group, catalog)
assert.equal(selected.providerID, "lab")
const resolvedModel = resolveModel(group, catalog, options)
assert.equal(resolvedModel.publishable, true)
assert.deepEqual(resolvedModel.spec.variants.map(({ id }) => id), ["low", "max"])
assert.deepEqual(mapCapabilities(group, selected, true), {
  capabilities: resolvedModel.spec.capabilities, limit: resolvedModel.spec.limit, cost: resolvedModel.spec.cost,
})
assert.equal(resolveNumericField({ group, field: "context", intrinsic: 100000 }).value, 100000)
assert.equal(resolveBooleanField({ group, field: "reasoning", descriptiveKey: "supports_reasoning", intrinsic: true, fallbackState: "unknown", fallbackConflict: false }).state, "supported")
assert.equal(resolveModalityField({ group, direction: "input", intrinsic: ["text"] }).known, true)
const namespacedGroup = groupLiteLLMDeployments({ data: [{ model_name: "lab/model", model_info: { mode: "chat" } }] })[0]
assert.equal(resolveNumericField({ group: namespacedGroup, field: "context", intrinsic: 100000 }).value, 100000)
assert.equal(resolveNumericField({ group: namespacedGroup, field: "context", intrinsic: 100000 }).known, true)
assert.equal(resolveBooleanField({ group: namespacedGroup, field: "reasoning", descriptiveKey: "supports_reasoning", intrinsic: true, fallbackState: "unknown", fallbackConflict: false }).state, "supported")
assert.equal(resolveBooleanField({ group: namespacedGroup, field: "capabilities.tools", descriptiveKey: "supports_function_calling", intrinsic: false, fallbackState: "unknown", fallbackConflict: false }).state, "unsupported")
assert.deepEqual(resolveModalityField({ group: namespacedGroup, direction: "input", intrinsic: ["text", "image"] }).values, ["text", "image"])
assert.equal(resolveModalityField({ group: namespacedGroup, direction: "input", intrinsic: ["text", "image"] }).known, true)
const live = buildPublicationResult(body, catalog, options).publishable[0]
const entry = createLastKnownGoodEntry(group, selected, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), catalog, options)
const store = createLastKnownGoodStore(); store.set("consumer-model", entry)
const restored = buildPublicationResult(body, undefined, options, { store }).publishable[0]
assert.equal(restored.assessment.status, "configured-lkg")
assert.equal(restored.assessment.reasoning.state, "supported")
assert.deepEqual(restored.spec, live.spec)
assert.deepEqual(diagnoseModelSpecs(body, catalog, options).models[0], live.spec)

const addedRecord = { ...record, id: "consumer-new", canonical_model_id: "lab/consumer-new" }
const addedCatalog = {
  models: { "lab/consumer-model": {}, "lab/consumer-new": {} },
  providers: { lab: { models: { "consumer-model": record, "consumer-new": addedRecord } } },
}
const addedBody = { data: [{ ...body.data[0], model_name: "consumer-new" }] }
const addedSet = new Set(["consumer-new"])
const addedPublication = buildPublicationResult(addedBody, addedCatalog, options)
assert.equal(needsCatalogRefresh(addedPublication, addedSet), false, "a locally matched added model needs no latest catalog")
assert.equal(needsCatalogRefresh(buildPublicationResult(addedBody, {}, options), addedSet), true, "a local miss requests the latest catalog")
const mergedPublication = mergePublicationResults(buildPublicationResult(body, catalog, options), addedPublication, new Set(["consumer-model"]))
assert.deepEqual(mergedPublication.publishable.map(entry => entry.spec.id), ["consumer-model", "consumer-new"])

const previousDiagnostics = diagnoseModelSpecs({ data: [body.data[0], { ...body.data[0], model_name: "consumer-deleted" }] }, {
  models: { "lab/consumer-model": {}, "lab/consumer-deleted": {} },
  providers: { lab: { models: { "consumer-model": record, "consumer-deleted": { ...record, id: "consumer-deleted", canonical_model_id: "lab/consumer-deleted" } } } },
}, options).diagnostics
const addedDiagnostics = diagnoseModelSpecs(addedBody, addedCatalog, options).diagnostics
const currentBody = { data: [body.data[0], addedBody.data[0]] }
const mergedDiagnostics = mergeDiscoveryDiagnostics(previousDiagnostics, addedDiagnostics, currentBody,
  ["consumer-model", "consumer-new"], addedSet)
assert.deepEqual(mergedDiagnostics.models.map(model => model.id), ["consumer-model", "consumer-new"])
assert.deepEqual(mergedDiagnostics.stats, { ...mergedDiagnostics.stats, responseEntries: 2, deployments: 2, models: 2, modelsDevMatched: 2, modelsDevUnmatched: 0 })
const deletedDiagnostics = mergeDiscoveryDiagnostics(previousDiagnostics, undefined, body, ["consumer-model"], new Set())
assert.deepEqual(deletedDiagnostics.models.map(model => model.id), ["consumer-model"])
assert.deepEqual(deletedDiagnostics.stats, { ...deletedDiagnostics.stats, responseEntries: 1, deployments: 1, models: 1, modelsDevMatched: 1, modelsDevUnmatched: 0 })
assert.deepEqual(temporaryMetadataFailureModelNames(buildPublicationResult(addedBody, {}, options), diagnoseModelSpecs(addedBody, {}, options).diagnostics), ["consumer-new"])
console.log("external consumer import and call ok")
`

const typeConsumerSource = `
import { buildModelSpecs, modelNameDelta, type ModelNameDelta, type ModelSpec } from "litellm-discovery-core"

const models: ModelSpec[] = buildModelSpecs(
  { data: [] },
  {},
  { contextTierCap: true, protocolOverrides: {} },
)
void models
const delta: ModelNameDelta = modelNameDelta([], ["consumer-model"])
void delta
`

try {
  const packed = JSON.parse(npmRun(["pack", "--json", "--pack-destination", temp], { cwd: root, encoding: "utf8" }))[0]
  const tarball = path.join(temp, packed.filename)
  npmRun(["init", "--yes"], { cwd: temp, stdio: "ignore" })
  npmRun(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], {
    cwd: temp,
    stdio: "ignore",
  })

  const packageRoot = path.join(temp, "node_modules", "litellm-discovery-core")
  const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"))
  assert.equal(pkg.name, "litellm-discovery-core")

  const consumerPath = path.join(temp, "consumer.mjs")
  writeFileSync(consumerPath, consumerSource, "utf8")
  execFileSync(process.execPath, [consumerPath], { cwd: temp, stdio: "inherit" })

  const typeConsumerPath = path.join(temp, "consumer.ts")
  const typeConfigPath = path.join(temp, "tsconfig.json")
  writeFileSync(typeConsumerPath, typeConsumerSource, "utf8")
  writeFileSync(
    typeConfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022"],
          strict: true,
          types: [],
          skipLibCheck: false,
        },
        files: [typeConsumerPath],
      },
      null,
      2,
    ),
    "utf8",
  )
  const tscPath = path.join(root, "node_modules", "typescript", "bin", "tsc")
  execFileSync(process.execPath, [tscPath, "--noEmit", "--pretty", "false", "-p", typeConfigPath], {
    cwd: temp,
    stdio: "inherit",
  })
  console.log("external TypeScript consumer typecheck ok")

  rmSync(path.join(packageRoot, "dist", "index.js"))
  const broken = spawnSync(process.execPath, [consumerPath], { cwd: temp, encoding: "utf8" })
  assert.notEqual(broken.status, 0, "consumer must reject a package missing its public entry file")
  console.log("broken package rejected")
} finally {
  rmSync(temp, { recursive: true, force: true })
}
