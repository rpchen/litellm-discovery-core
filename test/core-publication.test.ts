import { expect, test } from "bun:test";
import { assessModelConfiguration, buildPublicationResult, classifyMetadataFailure, describeAssessment, hostReasoningFlag, hostToolsFlag, metadataFailureFor, withheldReasons } from "../src/core/publication.ts";
import { group, metadataCatalog, modelRecord, options, response } from "./fixtures/metadata-priority.ts";
test("publication failure classification preserves existing retry behavior", () => {
  expect(classifyMetadataFailure(Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" })).kind).toBe("unreachable");
  expect(classifyMetadataFailure({ status: 503 }).kind).toBe("server-5xx");
  expect(classifyMetadataFailure({ status: 404 }).kind).toBe("not-found");
  expect(metadataFailureFor("timeout").retryable).toBe(true);
  expect(metadataFailureFor("missing-field").retryable).toBe(false);
});
test("publication descriptions, flags and partition reflect the selected record", () => {
  const catalog = metadataCatalog(modelRecord({ reasoning: true, tool_call: false }));
  const configured = assessModelConfiguration(group(), catalog, options);
  expect(withheldReasons(configured)).toEqual([]);
  expect(describeAssessment(configured)).toBe("configured: publishable");
  expect(hostReasoningFlag(configured)).toBe(true);
  expect(hostToolsFlag(configured, false)).toBe(false);
  const incomplete = assessModelConfiguration(group("unknown"), catalog, options);
  expect(withheldReasons(incomplete).length).toBeGreaterThan(0);
  expect(describeAssessment(incomplete)).toContain("blocked");
  const result = buildPublicationResult({ data: [...response().data, ...response("unknown").data] }, catalog, options);
  expect(result.publishable.map(({ spec }) => spec.id)).toEqual(["model"]);
  expect(result.blocked.map(({ spec }) => spec.id)).toEqual(["unknown"]);
  expect(result.assessments.size).toBe(2);
});
