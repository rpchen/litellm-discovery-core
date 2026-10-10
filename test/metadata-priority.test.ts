import { describe, expect, test } from "bun:test";
import { groupLiteLLMDeployments } from "../src/core/litellm.ts";
import { selectModelsDevRecord } from "../src/core/modelsdev.ts";
import { buildPublicationResult } from "../src/core/publication.ts";
import { resolveModel } from "../src/core/resolve.ts";
import oracle from "./fixtures/metadata-priority/expected-16.json" with { type: "json" };
import catalog from "./fixtures/metadata-priority/modelsdev-subset.json" with { type: "json" };
import discovery from "./fixtures/metadata-priority/synthetic-discovery.json" with { type: "json" };
const options = { contextTierCap: false, protocolOverrides: {} };
describe("restore-model-metadata-priority", () => {
  for (const expected of oracle.models) {
    test(`[T01/T13] ${expected.id} uses its own frozen metadata record`, () => {
      const group = groupLiteLLMDeployments(discovery).find((item) => item.modelName === expected.id)!;
      const selected = selectModelsDevRecord(group, catalog);
      expect(selected?.providerID).toBe(expected.provider);
      expect(selected?.modelID).toBe(expected.recordKey);
      const resolved = resolveModel(group, catalog, options);
      expect(resolved.publishable).toBe(true);
      expect(resolved.identity.canonicalModelID).toBe(expected.canonicalID);
      expect(resolved.spec.id).toBe(expected.id);
      expect(String(resolved.spec.protocol)).toBe(expected.protocol);
      expect(String(resolved.spec.reasoningSupported)).toBe(expected.reasoningSupported);
      expect(resolved.spec.variants.map((variant) => variant.id)).toEqual(expected.levels);
      expect(resolved.spec.limit.context).toBe(expected.limit.context);
      expect(resolved.spec.limit.output).toBe(expected.limit.output);
      expect(resolved.spec.capabilities).toEqual({ tools: expected.tools, input: expected.input, output: expected.output });
      const cost = expected.cost;
      expect(resolved.spec.cost).toEqual({ input: cost.input ?? 0, output: cost.output ?? 0, cacheRead: cost.cache_read ?? 0, cacheWrite: cost.cache_write ?? 0 });
    });
  }
  test("[T02] DeepSeek canonical name selects the non-deprecated official API alias", () => {
    const expected = oracle.models.find(({ id }) => id === "deepseek-v4.1-flash")!;
    const group = groupLiteLLMDeployments(discovery).find(({ modelName }) => modelName === expected.id)!;
    const resolved = resolveModel(group, catalog, options);
    expect(resolved.selected?.providerID).toBe("deepseek");
    expect(resolved.selected?.modelID).toBe("deepseek-flash");
    expect(resolved.selected?.matchKind).toBe("relation");
    expect(resolved.publishable).toBe(true);
    expect(resolved.spec.id).toBe(expected.id);
    expect(resolved.spec.limit.output).toBe(expected.limit.output);
    expect(resolved.spec.variants.map(({ id }) => id)).toEqual(expected.levels);
  });
  test.each(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"])(
    "[T02] exact deprecated official API %s remains matchable",
    (modelName) => {
      const group = groupLiteLLMDeployments({ data: [{ model_name: modelName, model_info: { mode: "chat" } }] })[0]!;
      const resolved = resolveModel(group, catalog, options);
      expect(resolved.selected?.providerID).toBe("deepseek");
      expect(resolved.selected?.modelID).toBe(modelName);
      expect(resolved.selected?.record.status).toBe("deprecated");
      expect(resolved.selected?.matchKind).toBe("exact");
      expect(resolved.identity.canonicalModelID).toBe("deepseek/deepseek-v4.1-flash");
      expect(resolved.publishable).toBe(true);
      expect(resolved.spec.id).toBe(modelName);
      expect(resolved.spec.variants.map(({ id }) => id)).toEqual(["low", "high", "max"]);
    },
  );
  test("[T01] all 16 discovered names are published without provider declarations", () => {
    const result = buildPublicationResult(discovery, catalog, options);
    expect(result.blocked).toEqual([]);
    expect(result.publishable.map(({ spec }) => spec.id).sort()).toEqual(oracle.models.map(({ id }) => id).sort());
  });
});
