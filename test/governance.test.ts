import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function runClosureGate(tasks: string) {
  const root = mkdtempSync(path.join(tmpdir(), "litellm-openspec-"))
  roots.push(root)
  const change = path.join(root, "completed-change")
  mkdirSync(change, { recursive: true })
  writeFileSync(path.join(change, "tasks.md"), tasks)
  return Bun.spawnSync({
    cmd: ["node", "scripts/check-openspec-closure.mjs"],
    env: { ...process.env, OPENSPEC_CHANGES_DIR: root },
    stdout: "pipe",
    stderr: "pipe",
  })
}

describe("OpenSpec closure gate", () => {
  test("rejects a completed change that remains active", () => {
    const result = runClosureGate("- [x] Implement\n- [x] Verify\n")
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain("completed-change")
  })

  test("allows an in-progress active change", () => {
    const result = runClosureGate("- [x] Implement\n- [ ] Verify\n")
    expect(result.exitCode).toBe(0)
  })
})
