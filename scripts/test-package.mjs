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
import { buildModelSpecs, normalizeLiteLLMURL } from "litellm-discovery-core"

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
console.log("external consumer import and call ok")
`

const typeConsumerSource = `
import { buildModelSpecs, type ModelSpec } from "litellm-discovery-core"

const models: ModelSpec[] = buildModelSpecs(
  { data: [] },
  {},
  { contextTierCap: true, protocolOverrides: {} },
)
void models
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
