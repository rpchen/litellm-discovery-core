import { expect, test } from "bun:test";
import { groupLiteLLMDeployments } from "../src/core/litellm.ts";
import { candidateModelIDs, canonicalModelID, groupIdentityEvidence, selectModelsDevRecord, selectModelsDevRecordDetailed } from "../src/core/modelsdev.ts";
import { resolveModel } from "../src/core/resolve.ts";
import { group, metadataCatalog, modelRecord, options, response } from "./fixtures/metadata-priority.ts";
test("[T03] official then OpenCode then OpenRouter selects one whole record", () => {
  const official = modelRecord({ tool_call: false, reasoning: true, reasoning_options: [{ type: "effort", values: ["low"] }] });
  const code = modelRecord({ limit: { context: 200000, output: 20000 } });
  const router = modelRecord({ limit: { context: 300000, output: 30000 } });
  const catalog = { models: { "lab/model": {} }, providers: {
      lab: { models: { model: official } }, opencode: { models: { model: code } }, openrouter: { models: { "lab/model": router } },
    } };
  expect(resolveModel(group(), catalog).selected?.record).toEqual(official);
  delete (catalog.providers as Record<string, unknown>).lab;
  expect(resolveModel(group(), catalog).selected?.record).toEqual(code);
  delete (catalog.providers as Record<string, unknown>).opencode;
  expect(resolveModel(group(), catalog).selected?.record).toEqual(router);
});
test("[T04] confirmed organization aliases select a record", () => {
  const record = modelRecord({ id: "hy4-preview", canonical_model_id: "tencent/hy4-preview" });
  const catalog = { models: { "tencent/hy4-preview": {} }, providers: { "tencent-tokenhub": { models: { "hy4-preview": record } } } };
  expect(selectModelsDevRecord(group("hy4-preview"), catalog)?.providerID).toBe("tencent-tokenhub");
});
test("[T07/T08] only model_name participates in identity across deployments", () => {
  const deployments = [response("model", { base_model: "wrong/version", models_dev_provider: "other", id: "a" }, { model: "internal/route", custom_llm_provider: "openai" }).data[0]!,
    response("model", { base_model: "different", models_dev_provider: "lab", id: "b", supports_function_calling: false }, { model: "another/route" }).data[0]!];
  const combined = groupLiteLLMDeployments({ data: deployments })[0]!;
  const expected = resolveModel(group(), metadataCatalog()).spec;
  expect(resolveModel(combined, metadataCatalog()).spec).toEqual(expected);
  expect(candidateModelIDs(combined)).toEqual(["model"]);
  expect(groupIdentityEvidence(combined, undefined)).toEqual({ status: "known", identity: "model" });
});
test("[T07/T26] full canonical and unique bare names preserve request id and namespace", () => {
  const selected = selectModelsDevRecord(group("lab/model"), metadataCatalog());
  expect(selected?.modelID).toBe("model");
  expect(resolveModel(group("lab/model"), metadataCatalog()).spec.id).toBe("lab/model");
  expect(canonicalModelID(" Lab/Model_2026-Free ")).toBe("lab/model-2026-free");
});
test("[T09] a same-name record pointing at a dated version is excluded", () => {
  const catalog = { models: { "lab/model": {}, "lab/model-0813": {} }, providers: {
      lab: { models: { model: modelRecord({ canonical_model_id: "lab/model-0813" }) } },
      opencode: { models: { model: modelRecord() } },
    } };
  expect(selectModelsDevRecord(group(), catalog)?.providerID).toBe("opencode");
});
test("[T09] free and pro reseller SKUs never stand in for the original", () => {
  const catalog = { models: { "lab/model": {} }, providers: { opencode: { models: { "model-free": modelRecord({ id: "model-free" }) } },
      openrouter: { models: { "lab/model-pro": modelRecord({ id: "lab/model-pro" }) } } } };
  expect(selectModelsDevRecord(group(), catalog)).toBeUndefined();
  expect(resolveModel(group(), catalog).status).toBe("unmatched");
});
test("[T09] ambiguous bare identities stay unresolved, qualified identities do not merge", () => {
  const catalog = { models: { "lab/model": {}, "other/model": {} }, providers: metadataCatalog().providers };
  expect(selectModelsDevRecordDetailed(group(), catalog).outcome).toBe("ambiguous");
  expect(selectModelsDevRecord(group("lab/model"), catalog)?.providerID).toBe("lab");
});
test("[T10] a selected record never fills missing fields from registry, lower providers or LiteLLM", () => {
  const incomplete = modelRecord();
  delete incomplete.tool_call;
  const catalog = { models: { "lab/model": modelRecord() }, providers: {
      lab: { models: { model: incomplete } }, opencode: { models: { model: modelRecord() } },
    } };
  const resolved = resolveModel(group("model", { supports_function_calling: true }), catalog);
  expect(resolved.selected?.providerID).toBe("lab");
  expect(resolved.fields["capabilities.tools"]?.value).toBeUndefined();
  expect(resolved.publishable).toBe(false);
});
test("[T10/T12] selected record false, modalities and limit dimensions override no other sources", () => {
  const record = modelRecord({ tool_call: false, reasoning: false, limit: { context: 100000, output: 10000 } });
  const resolved = resolveModel(group("model", { supports_function_calling: true, supports_reasoning: true, supports_vision: true, max_input_tokens: 7, max_output_tokens: 2 }), metadataCatalog(record), options);
  expect(resolved.publishable).toBe(true);
  expect(resolved.spec.capabilities).toEqual({ tools: false, input: ["text"], output: ["text"] });
  expect(resolved.spec.limit).toEqual({ context: 100000, input: 0, output: 10000 });
});
test("[T12] input capacity cannot become context", () => {
  const record = modelRecord({ limit: { input: 500000, output: 10000 } });
  const resolved = resolveModel(group(), metadataCatalog(record));
  expect(resolved.spec.limit.context).toBe(0);
  expect(resolved.publishable).toBe(false);
});
test("[T25/T26] catalog input guards and future top-level fields preserve existing behavior", () => {
  const catalog = metadataCatalog();
  expect(resolveModel(group(), { ...catalog, timestamp: "future", version: 999 }).spec).toEqual(resolveModel(group(), catalog).spec);
  for (const invalid of [null, [], {}, { models: catalog.models }, { providers: catalog.providers }, catalog.providers, { ...catalog, models: 1 }]) {
    expect(resolveModel(group(), invalid).publishable).toBe(false);
    expect(resolveModel(group(), invalid).status).toBe("metadata-unavailable");
  }
});
