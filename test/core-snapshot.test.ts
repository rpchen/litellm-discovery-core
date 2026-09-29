import { describe, expect, test } from "bun:test"
import {
  compareDiscoverySnapshots,
  createDiscoverySnapshot,
  DISCOVERY_SNAPSHOT_SCHEMA_VERSION,
  endpointFingerprint,
  inspectDiscoverySnapshot,
  isEndpointID,
} from "../src/core/snapshot.ts"
import type { ModelSpec } from "../src/core/build.ts"

function spec(id: string, overrides: Partial<ModelSpec> = {}): ModelSpec {
  return {
    id,
    name: id,
    protocol: "chat",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    released: 0,
    releaseUnit: "none",
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    limit: { context: 100, input: 100, output: 10 },
    ...overrides,
  }
}

describe("endpointFingerprint", () => {
  test("normalizes URL and is stable for equivalent option key ordering", () => {
    const first = endpointFingerprint({
      baseUrl: "https://litellm.example/v1/",
      credentialKey: "sk-secret",
      buildOptions: {
        contextTierCap: true,
        protocolOverrides: { beta: "responses", alpha: "chat" },
      },
    })
    const second = endpointFingerprint({
      baseUrl: "https://litellm.example",
      credentialKey: "sk-secret",
      buildOptions: {
        contextTierCap: true,
        protocolOverrides: { alpha: "chat", beta: "responses" },
      },
    })
    expect(first).toBe(second)
    expect(first.startsWith("sha256:")).toBeTrue()
    expect(first).not.toContain("sk-secret")
    expect(first).not.toContain("litellm.example")
  })

  test("changes for credentials or result-affecting options", () => {
    const base = {
      baseUrl: "https://litellm.example",
      credentialKey: "sk-a",
      buildOptions: { contextTierCap: true, protocolOverrides: {} },
    } as const
    expect(endpointFingerprint(base)).not.toBe(endpointFingerprint({ ...base, credentialKey: "sk-b" }))
    expect(endpointFingerprint(base)).not.toBe(endpointFingerprint({
      ...base,
      buildOptions: { contextTierCap: false, protocolOverrides: {} },
    }))
  })

  test("explicit endpoint identity isolates otherwise identical endpoints without breaking legacy snapshots", () => {
    const legacy = {
      baseUrl: "https://litellm.example/v1",
      credentialKey: "sk-shared",
      buildOptions: { contextTierCap: true, protocolOverrides: {} },
    } as const
    const legacyFingerprint = endpointFingerprint(legacy)
    expect(endpointFingerprint({ ...legacy })).toBe(legacyFingerprint)
    expect(endpointFingerprint({ ...legacy, endpointID: "company" })).not.toBe(legacyFingerprint)
    expect(endpointFingerprint({ ...legacy, endpointID: "company" })).not.toBe(
      endpointFingerprint({ ...legacy, endpointID: "personal" }),
    )
  })

  test("endpoint ids use the stable lowercase ASCII slug contract", () => {
    for (const id of ["default", "company", "team-1", "team_2", "a0"]) expect(isEndpointID(id)).toBeTrue()
    for (const id of ["", "-team", "_team", "Team", "team.one", "团队", " team"]) expect(isEndpointID(id)).toBeFalse()

    expect(() => endpointFingerprint({
      endpointID: "Team",
      baseUrl: "https://litellm.example",
      credentialKey: "sk-secret",
    })).toThrow("endpointID")
  })
})

describe("discovery snapshots", () => {
  test("round-trips a compatible snapshot and rejects endpoint mismatch", () => {
    const endpoint = endpointFingerprint({ baseUrl: "https://litellm.example", credentialKey: "sk-a" })
    const snapshot = createDiscoverySnapshot(endpoint, [spec("a")], "2026-09-28T00:00:00.000Z")
    expect(snapshot.schemaVersion).toBe(DISCOVERY_SNAPSHOT_SCHEMA_VERSION)

    const compatible = inspectDiscoverySnapshot(JSON.parse(JSON.stringify(snapshot)), endpoint)
    expect(compatible.reason).toBe("compatible")
    expect(compatible.snapshot).toEqual(snapshot)

    const other = endpointFingerprint({ baseUrl: "https://litellm.example", credentialKey: "sk-b" })
    expect(inspectDiscoverySnapshot(snapshot, other).reason).toBe("endpoint")
  })

  test("rejects unsupported schema and tampered model content", () => {
    const endpoint = endpointFingerprint({ baseUrl: "https://litellm.example", credentialKey: "sk-a" })
    const snapshot = createDiscoverySnapshot(endpoint, [spec("a")])
    expect(inspectDiscoverySnapshot({ ...snapshot, schemaVersion: 99 }, endpoint).reason).toBe("schema-version")
    expect(inspectDiscoverySnapshot({
      ...snapshot,
      models: [{ ...snapshot.models[0]!, limit: { context: 101, input: 100, output: 10 } }],
    }, endpoint).reason).toBe("corrupt")
  })
})

describe("compareDiscoverySnapshots", () => {
  test("classifies topology/protocol/capability drift separately from metadata-only change", () => {
    const endpoint = endpointFingerprint({ baseUrl: "https://litellm.example", credentialKey: "sk-a" })
    const before = createDiscoverySnapshot(endpoint, [
      spec("a"),
      spec("b"),
      spec("c"),
      spec("d"),
    ])
    const after = createDiscoverySnapshot(endpoint, [
      spec("a", { protocol: "responses" }),
      spec("b", { capabilities: { tools: false, input: ["text"], output: ["text"] } }),
      spec("c", { limit: { context: 200, input: 200, output: 10 } }),
      spec("e"),
    ])
    expect(compareDiscoverySnapshots(before, after)).toEqual({
      changed: true,
      drift: true,
      endpointChanged: false,
      added: ["e"],
      removed: ["d"],
      protocolChanged: ["a"],
      capabilityChanged: ["b"],
      metadataChanged: ["c"],
    })
  })

  test("metadata-only changes are changed but not compatibility drift", () => {
    const endpoint = endpointFingerprint({ baseUrl: "https://litellm.example", credentialKey: "sk-a" })
    const before = createDiscoverySnapshot(endpoint, [spec("a")])
    const after = createDiscoverySnapshot(endpoint, [spec("a", {
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    })])
    const diff = compareDiscoverySnapshots(before, after)
    expect(diff.changed).toBeTrue()
    expect(diff.drift).toBeFalse()
    expect(diff.metadataChanged).toEqual(["a"])
  })
})
