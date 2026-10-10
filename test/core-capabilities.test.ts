import { expect, test } from "bun:test";
import { mapCapabilities } from "../src/core/capabilities.ts";
import { selectModelsDevRecord } from "../src/core/modelsdev.ts";
import { group, metadataCatalog, modelRecord } from "./fixtures/metadata-priority.ts";
test("[T24] direct capability mapping uses only its selected whole record", () => {
  const catalog = metadataCatalog(modelRecord({ tool_call: false }));
  const selected = selectModelsDevRecord(group(), catalog);
  const mapped = mapCapabilities(group("model", { supports_function_calling: true, max_input_tokens: 1, input_cost_per_token: 100 }), selected, true);
  expect(mapped.capabilities.tools).toBe(false);
  expect(mapped.limit.context).toBe(100000);
  expect(mapped.cost.input).toBe(1);
});
test("[T24] mapping without metadata does not manufacture text or positive context", () => {
  const mapped = mapCapabilities(group(), undefined, false);
  expect(mapped.limit.context).toBe(0);
  expect(mapped.capabilities.input).toEqual([]);
});
