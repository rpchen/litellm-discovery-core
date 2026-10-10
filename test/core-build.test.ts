import { expect, test } from "bun:test";
import { buildModelSpecs, criticalModelFingerprint, modelFingerprint } from "../src/core/build.ts";
import { metadataCatalog, options, response } from "./fixtures/metadata-priority.ts";
test("[T24] build fingerprints distinguish display updates from critical changes", () => {
  const before = buildModelSpecs(response(), metadataCatalog(), options);
  const after = structuredClone(before);
  after[0]!.cost.input = 7;
  expect(modelFingerprint(before)).not.toBe(modelFingerprint(after));
  expect(criticalModelFingerprint(before)).toBe(criticalModelFingerprint(after));
  after[0]!.limit.context = 1;
  expect(criticalModelFingerprint(before)).not.toBe(criticalModelFingerprint(after));
});
