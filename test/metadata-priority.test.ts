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
  test("[T01] all 16 discovered names are published without provider declarations", () => {
    const result = buildPublicationResult(discovery, catalog, options);
    expect(result.blocked).toEqual([]);
    expect(result.publishable.map(({ spec }) => spec.id).sort()).toEqual(oracle.models.map(({ id }) => id).sort());
  });
});
