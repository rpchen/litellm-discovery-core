import { describe, expect, test } from "bun:test";
import { groupLiteLLMDeployments } from "../src/core/litellm.ts";
import { resolveModel } from "../src/core/resolve.ts";
import { buildPublicationResult } from "../src/core/publication.ts";
import { createDiscoverySnapshot, inspectDiscoverySnapshot } from "../src/core/snapshot.ts";
import observed from "./fixtures/canonical-name-redirect.json" with { type: "json" };

const record = (id: string, canonical: string, output: number) => ({
  id, canonical_model_id: canonical, reasoning: true, tool_call: true,
  reasoning_options: [{ type: "effort", values: ["low", "high"] }],
  modalities: { input: ["text"], output: ["text"] },
  limit: { context: 1048576, output },
});
const previous = "acme/flash";
const updated = "acme/flash-revision";
const options = { contextTierCap: false, protocolOverrides: {} };
function fixture() {
  return {
    models: { [previous]: {}, [updated]: {} },
    providers: {
      acme: { models: { "flash-api": record("flash-api", updated, 393216) } },
      opencode: { models: { flash: record("flash", updated, 384000) } },
      openrouter: { models: { [previous]: record(previous, previous, 943718) } },
    },
  };
}
const input = (model_name = "flash") => ({ data: [{ model_name,
  model_info: { mode: "chat", max_output_tokens: 384000, max_input_tokens: 1000000 },
}] });
const resolve = (catalog: unknown, name = "flash") => resolveModel(groupLiteLLMDeployments(input(name))[0]!, catalog);

describe("same-name canonical redirect", () => {
  test("[CANONICAL-REDIRECT] exact OpenCode name bridges to the official whole record", () => {
    const catalog = fixture();
    const resolved = resolve(catalog);
    expect(resolved.identity.canonicalModelID).toBe(updated);
    expect(resolved.identity.evidence).toBe("record-relation");
    expect(resolved.selected?.providerID).toBe("acme");
    expect(resolved.selected?.modelID).toBe("flash-api");
    expect(resolved.spec.id).toBe("flash");
    expect(resolved.spec.limit).toEqual({ context: 1048576, input: 0, output: 393216 });
    // A LiteLLM declaration must not replace the selected catalog record.
    expect(resolved.spec.limit.output).not.toBe(384000);
    const published = buildPublicationResult(input(), catalog, options);
    expect(published.blocked).toEqual([]);
    expect(published.publishable[0]!.spec.limit.output).toBe(393216);
    expect(published.publishable[0]!.spec.limit.context).toBeGreaterThan(published.publishable[0]!.spec.limit.output);
  });
  test("[CANONICAL-REFRESH] observed model-info and catalog replace an oversized snapshot on rediscovery", () => {
    const result = buildPublicationResult(observed.discovery, observed.catalog, options);
    expect(result.blocked).toEqual([]);
    const spec = result.publishable[0]!.spec;
    expect(spec.id).toBe("deepseek-v4.1-flash");
    expect(spec.limit).toEqual({ context: 1048576, input: 0, output: 393216 });
    const oldSpec = { ...spec, limit: { ...spec.limit, output: 943718 } };
    const old = createDiscoverySnapshot("test-endpoint", [oldSpec]);
    expect(inspectDiscoverySnapshot(old, "test-endpoint").snapshot?.models[0]!.limit.output).toBe(943718);
    const refreshed = createDiscoverySnapshot("test-endpoint", [spec]);
    const restored = inspectDiscoverySnapshot(refreshed, "test-endpoint");
    expect(restored.compatible).toBe(true);
    expect(restored.snapshot?.models[0]!.limit.output).toBe(393216);
    expect(restored.snapshot?.models[0]!.limit.output).toBeLessThan(restored.snapshot!.models[0]!.limit.context);
  });
  test("[CANONICAL-OFFICIAL-FIRST] an exact official record determines identity before OpenCode", () => {
    const catalog = fixture();
    Object.assign(catalog.providers.acme.models, { flash: record("flash", previous, 32000) });
    const resolved = resolve(catalog);
    expect(resolved.identity.canonicalModelID).toBe(previous);
    expect(resolved.selected?.providerID).toBe("acme");
    expect(resolved.selected?.modelID).toBe("flash");
    expect(resolved.spec.limit.output).toBe(32000);
  });
  test("[CANONICAL-EXPLICIT] an explicitly qualified canonical name stays pinned", () => {
    const resolved = resolve(fixture(), previous);
    expect(resolved.identity.canonicalModelID).toBe(previous);
    expect(resolved.selected?.providerID).toBe("openrouter");
    expect(resolved.spec.limit.output).toBe(943718);
  });
  test("[CANONICAL-NO-GUESS] a similar name does not redirect identity", () => {
    const catalog = fixture();
    const entry = catalog.providers.opencode.models.flash;
    Object.assign(catalog.providers.opencode.models, { "flash-free": { ...entry, id: "flash-free" } });
    delete (catalog.providers.opencode.models as Record<string, unknown>).flash;
    const resolved = resolve(catalog);
    expect(resolved.identity.canonicalModelID).toBe(previous);
    expect(resolved.selected?.providerID).toBe("openrouter");
  });
});
