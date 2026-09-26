import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const temp = mkdtempSync(path.join(tmpdir(), "litellm-discovery-core-consumer-"))
try {
  const packed = JSON.parse(execFileSync(npm, ["pack", "--json", "--pack-destination", temp], { cwd: root, encoding: "utf8", shell: process.platform === "win32" }))[0]
  const tarball = path.join(temp, packed.filename)
  execFileSync(npm, ["init", "--yes"], { cwd: temp, stdio: "ignore", shell: process.platform === "win32" })
  execFileSync(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], {
    cwd: temp,
    stdio: "ignore",
    shell: process.platform === "win32",
  })
  const pkg = JSON.parse(readFileSync(path.join(temp, "node_modules", "litellm-discovery-core", "package.json"), "utf8"))
  assert.equal(pkg.name, "litellm-discovery-core")
  const core = await import("litellm-discovery-core")
  assert.equal(typeof core.buildModelSpecs, "function")
  assert.equal(typeof core.normalizeLiteLLMURL, "function")
  assert.deepEqual(core.normalizeLiteLLMURL("http://litellm.example:4000/v1"), {
    rootURL: "http://litellm.example:4000",
    apiBaseURL: "http://litellm.example:4000/v1",
    modelInfoURL: "http://litellm.example:4000/v1/model/info",
    legacyModelInfoURL: "http://litellm.example:4000/model/info",
  })
  console.log("isolated consumer import ok")
} finally {
  rmSync(temp, { recursive: true, force: true })
}




