import { createHash } from "node:crypto"
import { modelFingerprint, type BuildOptions, type ModelSpec } from "./build.js"
import { isRecord, normalizeLiteLLMURL } from "./litellm.js"

export const DISCOVERY_SNAPSHOT_SCHEMA_VERSION = 1 as const

export interface EndpointFingerprintInput {
  readonly baseUrl: string
  readonly credentialKey: string
  readonly buildOptions?: Pick<BuildOptions, "contextTierCap" | "protocolOverrides">
}

export interface DiscoverySnapshot {
  readonly schemaVersion: typeof DISCOVERY_SNAPSHOT_SCHEMA_VERSION
  readonly endpointFingerprint: string
  readonly discoveredAt: string
  readonly modelFingerprint: string
  readonly models: ModelSpec[]
}

export type DiscoverySnapshotCompatibilityReason =
  | "compatible"
  | "missing"
  | "invalid"
  | "schema-version"
  | "endpoint"
  | "corrupt"

export interface DiscoverySnapshotCompatibility {
  readonly compatible: boolean
  readonly reason: DiscoverySnapshotCompatibilityReason
  readonly snapshot?: DiscoverySnapshot
}

export interface DiscoverySnapshotDiff {
  readonly changed: boolean
  readonly drift: boolean
  readonly endpointChanged: boolean
  readonly added: readonly string[]
  readonly removed: readonly string[]
  readonly protocolChanged: readonly string[]
  readonly capabilityChanged: readonly string[]
  readonly metadataChanged: readonly string[]
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

function stableJSON(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isModelSpec(value: unknown): value is ModelSpec {
  if (!isRecord(value)) return false
  if (!nonEmptyString(value.id) || !nonEmptyString(value.name)) return false
  if (value.protocol !== "chat" && value.protocol !== "responses" && value.protocol !== "messages") return false
  if (!isRecord(value.capabilities) || typeof value.capabilities.tools !== "boolean") return false
  if (!stringArray(value.capabilities.input) || !stringArray(value.capabilities.output)) return false
  if (!Array.isArray(value.variants)) return false
  if (!finiteNumber(value.released)) return false
  if (
    value.releaseUnit !== undefined &&
    value.releaseUnit !== "unix-ms" &&
    value.releaseUnit !== "unknown" &&
    value.releaseUnit !== "none"
  ) return false
  if (!isRecord(value.cost)) return false
  if (
    !finiteNumber(value.cost.input) ||
    !finiteNumber(value.cost.output) ||
    !finiteNumber(value.cost.cacheRead) ||
    !finiteNumber(value.cost.cacheWrite)
  ) return false
  if (!isRecord(value.limit)) return false
  return finiteNumber(value.limit.context) && finiteNumber(value.limit.input) && finiteNumber(value.limit.output)
}

function cloneModels(models: readonly ModelSpec[]): ModelSpec[] {
  return structuredClone(models) as ModelSpec[]
}

export function endpointFingerprint(input: EndpointFingerprintInput): string {
  if (!nonEmptyString(input.credentialKey)) {
    throw new Error("credentialKey must be a non-empty string")
  }
  const rootURL = normalizeLiteLLMURL(input.baseUrl).rootURL
  const material = stableJSON({
    rootURL,
    credentialKey: input.credentialKey,
    buildOptions: input.buildOptions
      ? {
          contextTierCap: input.buildOptions.contextTierCap,
          protocolOverrides: input.buildOptions.protocolOverrides,
        }
      : null,
  })
  return `sha256:${createHash("sha256").update(material).digest("hex")}`
}

export function createDiscoverySnapshot(
  endpoint: string,
  models: readonly ModelSpec[],
  discoveredAt = new Date().toISOString(),
): DiscoverySnapshot {
  if (!nonEmptyString(endpoint)) throw new Error("endpointFingerprint must be a non-empty string")
  if (!Number.isFinite(Date.parse(discoveredAt))) throw new Error("discoveredAt must be a valid date")
  const copied = cloneModels(models)
  return {
    schemaVersion: DISCOVERY_SNAPSHOT_SCHEMA_VERSION,
    endpointFingerprint: endpoint,
    discoveredAt,
    modelFingerprint: modelFingerprint(copied),
    models: copied,
  }
}

export function inspectDiscoverySnapshot(
  value: unknown,
  expectedEndpointFingerprint: string,
): DiscoverySnapshotCompatibility {
  if (value === undefined || value === null) return { compatible: false, reason: "missing" }
  if (!isRecord(value)) return { compatible: false, reason: "invalid" }
  if (value.schemaVersion !== DISCOVERY_SNAPSHOT_SCHEMA_VERSION) {
    return { compatible: false, reason: "schema-version" }
  }
  if (
    !nonEmptyString(value.endpointFingerprint) ||
    !nonEmptyString(value.discoveredAt) ||
    !Number.isFinite(Date.parse(value.discoveredAt)) ||
    !nonEmptyString(value.modelFingerprint) ||
    !Array.isArray(value.models) ||
    !value.models.every(isModelSpec)
  ) {
    return { compatible: false, reason: "invalid" }
  }
  if (value.endpointFingerprint !== expectedEndpointFingerprint) {
    return { compatible: false, reason: "endpoint" }
  }

  const snapshot: DiscoverySnapshot = {
    schemaVersion: DISCOVERY_SNAPSHOT_SCHEMA_VERSION,
    endpointFingerprint: value.endpointFingerprint,
    discoveredAt: value.discoveredAt,
    modelFingerprint: value.modelFingerprint,
    models: cloneModels(value.models),
  }
  if (modelFingerprint(snapshot.models) !== snapshot.modelFingerprint) {
    return { compatible: false, reason: "corrupt" }
  }
  return { compatible: true, reason: "compatible", snapshot }
}

function singleModelFingerprint(model: ModelSpec): string {
  return modelFingerprint([model])
}

export function compareDiscoverySnapshots(
  previous: DiscoverySnapshot,
  current: DiscoverySnapshot,
): DiscoverySnapshotDiff {
  const previousByID = new Map(previous.models.map((model) => [model.id, model]))
  const currentByID = new Map(current.models.map((model) => [model.id, model]))
  const added = [...currentByID.keys()].filter((id) => !previousByID.has(id)).sort((a, b) => a.localeCompare(b, "en"))
  const removed = [...previousByID.keys()].filter((id) => !currentByID.has(id)).sort((a, b) => a.localeCompare(b, "en"))
  const protocolChanged: string[] = []
  const capabilityChanged: string[] = []
  const metadataChanged: string[] = []

  for (const [id, before] of previousByID) {
    const after = currentByID.get(id)
    if (!after) continue
    if (before.protocol !== after.protocol) protocolChanged.push(id)
    if (stableJSON(before.capabilities) !== stableJSON(after.capabilities)) capabilityChanged.push(id)
    if (
      singleModelFingerprint(before) !== singleModelFingerprint(after) &&
      before.protocol === after.protocol &&
      stableJSON(before.capabilities) === stableJSON(after.capabilities)
    ) {
      metadataChanged.push(id)
    }
  }

  const endpointChanged = previous.endpointFingerprint !== current.endpointFingerprint
  const changed = endpointChanged || previous.modelFingerprint !== current.modelFingerprint
  const drift =
    endpointChanged ||
    added.length > 0 ||
    removed.length > 0 ||
    protocolChanged.length > 0 ||
    capabilityChanged.length > 0

  return {
    changed,
    drift,
    endpointChanged,
    added,
    removed,
    protocolChanged: protocolChanged.sort((a, b) => a.localeCompare(b, "en")),
    capabilityChanged: capabilityChanged.sort((a, b) => a.localeCompare(b, "en")),
    metadataChanged: metadataChanged.sort((a, b) => a.localeCompare(b, "en")),
  }
}
