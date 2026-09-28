/**
 * Host-independent protocol resolution. Host SDK package mapping belongs to plugin adapters.
 */
import {
  optionalString,
  stripRoutePrefix,
  type DeploymentGroup,
  type LiteLLMDeployment,
} from "./litellm.js"

/** LiteLLM call protocol chosen for a model. */
export type Protocol = "chat" | "responses" | "messages"

/** Protocol capability independent from the protocol currently selected by Core. */
export type ProtocolSupport = "chat" | "responses" | "both" | "messages" | "unknown"

export type ProtocolReason =
  | "override"
  | "anthropic"
  | "supported-endpoints"
  | "mode"
  | "fallback"
  | "mixed-fallback"

export interface DeploymentProtocolResolution {
  readonly protocol: Protocol
  readonly reason: Exclude<ProtocolReason, "override" | "mixed-fallback">
}

export interface ProtocolResolution {
  readonly protocol: Protocol
  readonly reason: ProtocolReason
  readonly deployments: readonly DeploymentProtocolResolution[]
}

function isClaudeName(value: unknown): boolean {
  const model = optionalString(value)
  return model !== undefined && stripRoutePrefix(model).toLowerCase().startsWith("claude-")
}

function isAnthropic(deployment: LiteLLMDeployment): boolean {
  const upstream = optionalString(deployment.modelInfo.litellm_provider)?.toLowerCase()
  const custom = optionalString(deployment.litellmParams.custom_llm_provider)?.toLowerCase()
  const routedModel = optionalString(deployment.litellmParams.model)

  return (
    upstream === "anthropic" ||
    custom === "anthropic" ||
    routedModel?.toLowerCase().startsWith("anthropic/") === true ||
    isClaudeName(deployment.modelInfo.base_model) ||
    isClaudeName(routedModel) ||
    isClaudeName(deployment.modelName)
  )
}

function normalizeEndpoint(value: string): string {
  return value.toLowerCase().replace(/^\//, "").replace(/^v1\//, "")
}

function supportedEndpointFlags(deployment: LiteLLMDeployment): { chat: boolean; responses: boolean } | undefined {
  const endpoints = deployment.modelInfo.supported_endpoints
  if (!Array.isArray(endpoints)) return undefined
  const normalized = new Set(
    endpoints
      .filter((endpoint): endpoint is string => typeof endpoint === "string")
      .map(normalizeEndpoint),
  )
  return {
    chat: normalized.has("chat/completions"),
    responses: normalized.has("responses"),
  }
}

export function deploymentProtocolSupport(deployment: LiteLLMDeployment): ProtocolSupport {
  if (isAnthropic(deployment)) return "messages"

  const endpoints = supportedEndpointFlags(deployment)
  if (endpoints?.chat && endpoints.responses) return "both"
  if (endpoints?.responses) return "responses"
  if (endpoints?.chat) return "chat"

  const mode = optionalString(deployment.modelInfo.mode)?.toLowerCase()
  if (mode === "responses") return "responses"
  if (mode === "chat") return "chat"
  return "unknown"
}

function protocolSet(support: ProtocolSupport): Set<Protocol> {
  switch (support) {
    case "chat":
      return new Set(["chat"])
    case "responses":
      return new Set(["responses"])
    case "both":
      return new Set(["chat", "responses"])
    case "messages":
      return new Set(["messages"])
    case "unknown":
      return new Set()
  }
}

export function resolveProtocolSupport(group: DeploymentGroup): ProtocolSupport {
  if (group.deployments.length === 0) return "unknown"
  const sets = group.deployments.map((deployment) => protocolSet(deploymentProtocolSupport(deployment)))
  const common = [...sets[0]!].filter((protocol) => sets.every((set) => set.has(protocol)))
  if (common.length === 0) return "unknown"
  if (common.includes("messages")) return common.length === 1 ? "messages" : "unknown"
  const chat = common.includes("chat")
  const responses = common.includes("responses")
  if (chat && responses) return "both"
  if (responses) return "responses"
  if (chat) return "chat"
  return "unknown"
}

export function deploymentProtocolResolution(
  deployment: LiteLLMDeployment,
): DeploymentProtocolResolution {
  if (isAnthropic(deployment)) return { protocol: "messages", reason: "anthropic" }

  const endpoints = supportedEndpointFlags(deployment)
  if (endpoints?.responses) return { protocol: "responses", reason: "supported-endpoints" }
  if (endpoints?.chat) return { protocol: "chat", reason: "supported-endpoints" }

  const mode = optionalString(deployment.modelInfo.mode)?.toLowerCase()
  if (mode === "responses") return { protocol: "responses", reason: "mode" }
  if (mode === "chat") return { protocol: "chat", reason: "mode" }
  return { protocol: "chat", reason: "fallback" }
}

export function deploymentProtocol(deployment: LiteLLMDeployment): Protocol {
  return deploymentProtocolResolution(deployment).protocol
}

export function resolveProtocolResolution(
  group: DeploymentGroup,
  overrides: Readonly<Record<string, Protocol>> = {},
): ProtocolResolution {
  const deployments = group.deployments.map(deploymentProtocolResolution)
  const override = overrides[group.modelName]
  if (override) return { protocol: override, reason: "override", deployments }

  const protocols = new Set(deployments.map((item) => item.protocol))
  if (protocols.size !== 1) return { protocol: "chat", reason: "mixed-fallback", deployments }

  const protocol = deployments[0]?.protocol ?? "chat"
  const reasons = new Set(deployments.map((item) => item.reason))
  const reason = reasons.size === 1
    ? (deployments[0]?.reason ?? "fallback")
    : deployments.some((item) => item.reason === "fallback")
      ? "fallback"
      : "supported-endpoints"
  return { protocol, reason, deployments }
}

export function resolveProtocol(
  group: DeploymentGroup,
  overrides: Readonly<Record<string, Protocol>> = {},
): Protocol {
  return resolveProtocolResolution(group, overrides).protocol
}
