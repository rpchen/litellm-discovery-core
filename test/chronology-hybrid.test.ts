import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

// ---------------------------------------------------------------------------
// Hybrid chronology gate semantics (governance PR: Git primary, committed
// fixture refines squash collisions only).
// ---------------------------------------------------------------------------

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A tiny git repo so Git ancestry is REAL (not the tmpdir-no-git case). */
function gitRepo(withCommits = true): string {
  const root = mkdtempSync(path.join(tmpdir(), "chronology-git-"))
  roots.push(root)
  const git = (args: string) => execFileSync("git", args.split(" "), { cwd: root, encoding: "utf8" })
  git("init -b main")
  git("config user.email chronology@example.invalid")
  git("config user.name Chronology Fixture")
  if (withCommits) {
    writeFileSync(path.join(root, "seed.txt"), "seed\n")
    git("add seed.txt")
    git("commit -m seed")
  }
  return root
}

const MODIFIED_DELTA = (name: string) => `# delta:${name} Specification

## MODIFIED Requirements

### Requirement: Existing behavior
The extension SHALL do the final thing.

#### Scenario: The final state
- **WHEN** the operation runs
- **THEN** the final behavior is observable
`

const ADDED_DELTA = (name: string) => `# delta:${name} Specification

## ADDED Requirements

### Requirement: Existing behavior
The extension SHALL do the initial thing.

#### Scenario: The initial state
- **WHEN** the operation runs
- **THEN** the initial behavior is observable
`

interface ArchiveSpec {
  name: string
  /** Commit message producing the archive introduction; distinct messages create distinct commits. */
  commit: string
  content: string
}

interface HybridFixture {
  archive: string
  content: string
  canonical: string
  chronology: unknown
}

/**
 * Build a real git repo with each archive introduced by its own commit
 * (identical commit messages collapse into one commit per archive file
 * addition — every archive gets its own commit by changing a seed file
 * between additions, or sharing one commit for the squash-collision case).
 */
function buildScenario(spec: {
  archives: ArchiveSpec[]
  /** Archives introduced in ONE shared commit (the squash collision). */
  collapse?: string[][]
  fixture?: unknown
  commitBetween?: boolean
}): { root: string; result: () => ReturnType<typeof runChecker> } {
  const root = gitRepo()
  const openspec = path.join(root, "openspec")
  const archiveDir = path.join(openspec, "changes", "archive")
  mkdirSync(path.join(openspec, "specs", "cap"), { recursive: true })
  // The canonical spec mirrors the LAST archive's final semantic state in
  // canonical shape (Purpose + Requirements), so the closure replay finds
  // the requirement present with the final semantics.
  const finalContent = spec.archives.at(-1)!.content
    .replace(/^# delta:.*$/m, "# cap Specification")
    .replace(/^## (MODIFIED|ADDED) Requirements$/m, "## Requirements")
  writeFileSync(path.join(openspec, "specs", "cap", "spec.md"), finalContent +
    (finalContent.includes("## Purpose") ? "" : ""))
  const git = (args: string) => execFileSync("git", args.split(" ") as never[], { cwd: root, encoding: "utf8" })
  git("add .")
  git("commit -m canonical")

  const allNames = spec.archives.map((archive) => archive.name)
  const collapsed = new Set((spec.collapse ?? []).flat())
  for (const archive of spec.archives) {
    const target = path.join(archiveDir, archive.name, "specs", "cap")
    mkdirSync(target, { recursive: true })
    writeFileSync(path.join(target, "spec.md"), archive.content)
    git("add .")
    if (collapsed.has(archive.name)) {
      // squash collision members accumulate in ONE shared commit, applied after
      // the last independent member completes.
      continue
    }
    writeFileSync(path.join(root, "seed.txt"), archive.name + "\n")
    git("add .")
    git(`commit -m introduce-${archive.name}`)
  }
  // Apply all collapse members in a single commit (the squash shape).
  if (collapsed.size > 0) {
    writeFileSync(path.join(root, "seed.txt"), "squash\n")
    git("add .")
    git("commit -m squash-collapsed-archives")
  }
  if (spec.fixture !== undefined) {
    writeFileSync(path.join(openspec, "openspec-chronology.json"), JSON.stringify(spec.fixture))
  }
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "chronology-fixture-repo", private: true }),
  )
  return {
    root,
    result: () => runChecker(root),
  }
}

function runChecker(root: string) {
  return spawnSync(process.execPath, [path.resolve("scripts/check-openspec-closure.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, OPENSPEC_CHANGES_DIR: path.join(root, "openspec", "changes") },
    stdio: ["ignore", "pipe", "pipe"],
  })
}

describe("hybrid chronology gate (Git primary, fixture refines collisions)", () => {
  test("Case 1: Git proves A < B but the fixture orders B < A -> FAIL", () => {
    const { result } = buildScenario({
      archives: [
        { name: "2026-01-01-a", commit: "a", content: ADDED_DELTA("a"), },
        { name: "2026-01-02-b", commit: "b", content: MODIFIED_DELTA("b") },
      ],
      fixture: { edges: [["2026-01-02-b", "2026-01-01-a"]] },
    })
    const r = result()
    expect(r.status).not.toBe(0)
    expect(r.stdout + r.stderr).toContain("contradicts Git provenance")
  })

  test("Case 2: same squash commit + fixture order -> PASS (fixture refinement)", () => {
    // Two archives collapsed into one introduction commit; ADDED(a) then
    // MODIFIED(b) ordering makes the replay deterministic.
    const { result } = buildScenario({
      archives: [
        { name: "2026-01-01-a", commit: "a", content: ADDED_DELTA("a") },
        { name: "2026-01-02-b", commit: "b", content: MODIFIED_DELTA("b") },
      ],
      collapse: [["2026-01-01-a", "2026-01-02-b"]],
      fixture: { edges: [["2026-01-01-a", "2026-01-02-b"]] },
    })
    const r = result()
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("0 ambiguous histories")
    expect(r.stdout).toContain("injected-fixture chronology histories")
  })

  test("Case 3: a new Git-provable archive C absent from the fixture -> PASS", () => {
    const { result } = buildScenario({
      archives: [
        { name: "2026-01-01-a", commit: "a", content: ADDED_DELTA("a") },
        { name: "2026-01-02-b", commit: "b", content: MODIFIED_DELTA("b") },
        { name: "2026-01-03-c", commit: "c", content: MODIFIED_DELTA("c") },
      ],
      fixture: { edges: [] },
    })
    const r = result()
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("ancestry-resolved chronology histories")
  })

  test("Case 4: same squash commit without fixture order -> FAIL CLOSED", () => {
    const { result } = buildScenario({
      archives: [
        { name: "2026-01-01-a", commit: "a", content: ADDED_DELTA("a") },
        { name: "2026-01-02-b", commit: "b", content: MODIFIED_DELTA("b") },
      ],
      collapse: [["2026-01-01-a", "2026-01-02-b"]],
      fixture: { edges: [] },
    })
    const r = result()
    expect(r.status).not.toBe(0)
    expect(r.stdout + r.stderr).toContain("AMBIGUOUS")
  })

  test("Case 5: the fixture cannot re-order two distinct Git commits (opposite order is a FAIL, not a silent swap)", () => {
    // Distinct commits a < b < c; fixture claims c < a (a multi-edge rewrite
    // attempt) -> hard failure, never a fixture-driven history.
    const { result } = buildScenario({
      archives: [
        { name: "2026-01-01-a", commit: "a", content: ADDED_DELTA("a") },
        { name: "2026-01-02-b", commit: "b", content: MODIFIED_DELTA("b") },
        { name: "2026-01-03-c", commit: "c", content: MODIFIED_DELTA("c") },
      ],
      fixture: { edges: [["2026-01-03-c", "2026-01-01-a"]] },
    })
    const r = result()
    expect(r.status).not.toBe(0)
    expect(r.stdout + r.stderr).toContain("contradicts Git provenance")
  })

  test("mutation: deleting the collision fixture order flips Case 2 to fail-closed", () => {
    const scenario = buildScenario({
      archives: [
        { name: "2026-01-01-a", commit: "a", content: ADDED_DELTA("a") },
        { name: "2026-01-02-b", commit: "b", content: MODIFIED_DELTA("b") },
      ],
      collapse: [["2026-01-01-a", "2026-01-02-b"]],
      fixture: { edges: [["2026-01-01-a", "2026-01-02-b"]] },
    })
    expect(scenario.result().status).toBe(0)
    // Mutation: remove the fixture file -> the collision loses its refinement.
    const fixturePath = path.join(scenario.root, "openspec", "openspec-chronology.json")
    const before = readFileSync(fixturePath, "utf8")
    rmSync(fixturePath)
    const mutated = scenario.result()
    expect(mutated.status).not.toBe(0)
    expect(mutated.stdout + mutated.stderr).toContain("AMBIGUOUS")
    // Restore for the shared-root cleanup sanity.
    writeFileSync(fixturePath, before)
    expect(scenario.result().status).toBe(0)
  })

  test("mutation: a Git-provable archive added after the fixture needs no fixture entry", () => {
    const scenario = buildScenario({
      archives: [
        { name: "2026-01-01-a", commit: "a", content: ADDED_DELTA("a") },
        { name: "2026-01-02-b", commit: "b", content: MODIFIED_DELTA("b") },
      ],
      collapse: [["2026-01-01-a", "2026-01-02-b"]],
      fixture: { edges: [["2026-01-01-a", "2026-01-02-b"]] },
    })
    expect(scenario.result().status).toBe(0)
    // Append archive C with its own introduction commit AFTER the fixture
    // was written: Git proves a<b<c and the fixture stays untouched.
    const git = (args: string) => execFileSync("git", args.split(" ") as never[], { cwd: scenario.root, encoding: "utf8" })
    const target = path.join(scenario.root, "openspec", "changes", "archive", "2026-01-03-c", "specs", "cap")
    mkdirSync(target, { recursive: true })
    writeFileSync(path.join(target, "spec.md"), MODIFIED_DELTA("c"))
    writeFileSync(path.join(scenario.root, "seed.txt"), "c-new\n")
    git("add .")
    git("commit -m introduce-c")
    const r = scenario.result()
    expect(r.status).toBe(0)
  })
})