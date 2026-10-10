import { describe, expect, test } from "bun:test";
import { deploymentProtocol, deploymentProtocolSupport, groupLiteLLMDeployments, resolveProtocolSupport, type DeploymentGroup } from "../src/index.ts";
const options = { contextTierCap: false, protocolOverrides: {} };
function group(modelName: string, model = `openai/${modelName}`, modelInfo: Record<string, unknown> = {}): DeploymentGroup {
  return groupLiteLLMDeployments({
    data: [{
        model_name: modelName,
        litellm_params: { model },
        model_info: { mode: "chat", ...modelInfo },
      }],
  })[0]!;
}
describe("protocol and operational boundaries", () => {
  test("protocol capability distinguishes both from selected protocol and preserves unknown fallback", () => {
    const both = group("dual", "openai/dual", {
      supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
    });
    expect(deploymentProtocolSupport(both.deployments[0]!)).toBe("both");
    expect(resolveProtocolSupport(both)).toBe("both");
    expect(deploymentProtocol(both.deployments[0]!)).toBe("responses");
    const unknown = groupLiteLLMDeployments({
      data: [{
          model_name: "private",
          litellm_params: { model: "custom/private" },
          model_info: {},
        }],
    })[0]!;
    expect(resolveProtocolSupport(unknown)).toBe("unknown");
    expect(deploymentProtocol(unknown.deployments[0]!)).toBe("chat");
  });
});
