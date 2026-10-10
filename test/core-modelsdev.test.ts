import { expect, test } from "bun:test";
import { aggregateTriState, canonicalModelID, releaseTimestamp, resolveInheritedRecord } from "../src/core/modelsdev.ts";
test("[T24/T26] canonical normalization retains namespace, version and SKU", () => {
  expect(canonicalModelID(" OpenAI/GPT_6-Luna-Free ")).toBe("openai/gpt-6-luna-free");
  expect(canonicalModelID("lab/model-2026-10-10:thinking")).toBe("lab/model-2026-10-10:thinking");
});
test("[T24] release metadata parsing remains compatible", () => {
  expect(releaseTimestamp({ providerID: "lab", modelID: "model", record: { release_date: "2026-10-10" } })).toBe(Date.parse("2026-10-10"));
  expect(releaseTimestamp(undefined)).toBe(0);
  expect(releaseTimestamp({ providerID: "lab", modelID: "model", record: { release_date: "invalid" } })).toBe(0);
});
test("[T24] independent tri-state declaration aggregation does not discard missing values", () => {
  expect(aggregateTriState([false, false]).state).toBe("unsupported");
  expect(aggregateTriState([true, undefined]).state).toBe("unknown");
  expect(aggregateTriState([true, false]).conflict).toBe(true);
  expect(resolveInheritedRecord(undefined, {})).toBeUndefined();
});
