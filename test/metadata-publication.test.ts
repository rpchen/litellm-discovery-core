import { expect, test } from "bun:test";
import { buildModelSpecs, criticalModelFingerprint } from "../src/core/build.ts";
import { mapCapabilities } from "../src/core/capabilities.ts";
import { diagnoseModelSpecs } from "../src/core/diagnostics.ts";
import { buildVariants, resolveReasoningState, selectModelsDevRecord } from "../src/core/modelsdev.ts";
import { assessModelConfiguration, buildPublicationResult, capturedPublicationVerdict, createLastKnownGoodEntry, createLastKnownGoodStore, describeAssessment, hostReasoningFlag, hostToolsFlag, isLKGEntryCompatible, PUBLICATION_SCHEMA_VERSION, validateLastKnownGood, withheldReasons } from "../src/core/publication.ts";
import { resolveModel } from "../src/core/resolve.ts";
import { compareDiscoverySnapshots, createDiscoverySnapshot, DISCOVERY_SNAPSHOT_SCHEMA_VERSION, endpointFingerprint, inspectDiscoverySnapshot } from "../src/core/snapshot.ts";
import { group, metadataCatalog, modelRecord, options, response } from "./fixtures/metadata-priority.ts";
for (const [label, reasoning, reasoningOptions, expected] of [
  ["unsupported", false, [{ type: "effort", values: ["high"] }], []],
  ["empty", true, [], []], ["toggle", true, [{ type: "toggle" }], []],
  ["effort", true, [{ type: "effort", values: ["none", "low", "max"] }], ["none", "low", "max"]],
] as const) {
  test(`[T14] ${label} reasoning support is independent from selectable levels`, () => {
    const catalog = metadataCatalog(modelRecord({ reasoning, reasoning_options: reasoningOptions }));
    const result = resolveModel(group(), catalog);
    expect(result.publishable).toBe(true);
    expect(result.spec.reasoningSupported).toBe(reasoning ? "supported" : "unsupported");
    expect(result.spec.variants.map(({ id }) => id)).toEqual([...expected]);
    expect(resolveReasoningState(group(), result.selected).state).toBe(result.spec.reasoningSupported!);
    expect(buildVariants(result.selected, result.protocol)).toEqual(result.spec.variants);
  });
}
test("[T15] existing Messages effort and budget mappings are preserved", () => {
  const record = modelRecord({ reasoning: true, reasoning_options: [{ type: "effort", values: ["low", "high"] }] });
  const selected = selectModelsDevRecord(group(), metadataCatalog(record));
  expect(buildVariants(selected, "messages")).toEqual([{ id: "low", settings: { effort: "low" } }, { id: "high", settings: { effort: "high" } }]);
  expect(buildVariants({ ...selected!, record: { ...record, reasoning_options: [{ type: "budget_tokens", max: 32000 }] } }, "messages"))
    .toEqual([{ id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16000 } } }, { id: "max", settings: { thinking: { type: "enabled", budgetTokens: 32000 } } }]);
});
test("[T10] explicit false is complete; missing tool or reasoning declarations remain unknown", () => {
  const record = modelRecord({ reasoning: false, tool_call: false });
  expect(assessModelConfiguration(group(), metadataCatalog(record), options).publishable).toBe(true);
  for (const key of ["tool_call", "reasoning"]) {
    const missing = { ...record };
    delete missing[key];
    const assessment = assessModelConfiguration(group(), metadataCatalog(missing), options);
    expect(assessment.publishable).toBe(false);
    expect(key === "tool_call" ? assessment.tools.state : assessment.reasoning.state).toBe("unknown");
  }
});
test("[T14/T24] effort options alone never supply reasoning support in a public helper", () => {
  const record = modelRecord({ reasoning_options: [{ type: "effort", values: ["high"] }] });
  delete record.reasoning;
  const selected = selectModelsDevRecord(group(), metadataCatalog(record));
  expect(resolveReasoningState(group(), selected).state).toBe("unknown");
  expect(buildVariants(selected, "chat")).toEqual([]);
  expect(resolveModel(group(), metadataCatalog(record)).spec.variants).toEqual([]);
});
test("[T12] invalid selected context/output cannot publish and another model remains available", () => {
  for (const value of [0, 0.5, -1, Infinity, NaN, "100"]) {
    const catalog = metadataCatalog(modelRecord({ limit: { context: value, output: 10000 } }));
    const assessment = assessModelConfiguration(group(), catalog, options);
    expect(assessment.publishable).toBe(false);
    expect(withheldReasons(assessment).some(({ code }) => code === "illegal-metadata")).toBe(true);
  }
  const catalog = metadataCatalog();
  const result = buildPublicationResult({ data: [...response().data, ...response("unknown").data] }, catalog, options);
  expect(result.publishable.map(({ spec }) => spec.id)).toEqual(["model"]);
  expect(result.blocked.map(({ spec }) => spec.id)).toEqual(["unknown"]);
});
test("[T11] existing mixed-deployment protocol fallback and override do not block publication", () => {
  const body = { data: [...response("model", { mode: "chat" }).data, ...response("model", { mode: "responses" }).data] };
  expect(buildPublicationResult(body, metadataCatalog(), options).publishable[0]?.spec.protocol).toBe("chat");
  expect(buildPublicationResult(body, metadataCatalog(), { ...options, protocolOverrides: { model: "responses" } }).publishable[0]?.spec.protocol).toBe("responses");
});
test("[T10/T12] empty conversation modalities and malformed capability values report their actual fields", () => {
  for (const [key, record] of [
    ["capabilities.input", modelRecord({ modalities: { input: [], output: ["text"] } })],
    ["capabilities.tools", modelRecord({ tool_call: "true" })],
    ["reasoning", modelRecord({ reasoning: "false" })],
  ] as const) {
    const assessment = assessModelConfiguration(group(), metadataCatalog(record), options);
    expect(assessment.publishable).toBe(false);
    expect(describeAssessment(assessment)).toContain(key);
    expect(withheldReasons(assessment).flatMap(({ fields }) => fields)).toContain(key);
  }
});
test("[T16/T17] optional prices never change publication, limits, variants or critical integrity", () => {
  const baseline = resolveModel(group(), metadataCatalog()).spec;
  for (const cost of [undefined, {}, { input: 0, output: 0 }, { input: -1, output: "bad", cache_read: Infinity, cache_write: NaN }, { input: 8, output: 9 }]) {
    const catalog = metadataCatalog(modelRecord({ cost }));
    const body = response("model", { tiered_pricing: [{ range: [272000, null] }], input_cost_per_token: 999, max_input_tokens: 7 }, { input_cost_per_token: 888 });
    const result = buildPublicationResult(body, catalog, { ...options, contextTierCap: true });
    expect(result.publishable).toHaveLength(1);
    const spec = result.publishable[0]!.spec;
    expect(criticalModelFingerprint([spec])).toBe(criticalModelFingerprint([baseline]));
    expect(spec.cost.input).toBe(typeof cost?.input === "number" && cost.input >= 0 ? cost.input : 0);
  }
  const record = modelRecord({ limit: { context: 1050000, output: 128000 } });
  expect(resolveModel(group("model", { input_cost_per_token_above_272k_tokens: 1 }), metadataCatalog(record), { contextTierCap: true }).spec.limit.context).toBe(1050000);
});
function seed() {
  const g = group();
  const catalog = metadataCatalog();
  const resolved = resolveModel(g, catalog);
  const assessment = assessModelConfiguration(g, catalog, options);
  const entry = createLastKnownGoodEntry(g, resolved.selected, resolved.spec, 1000000, capturedPublicationVerdict(assessment, resolved.spec), catalog, options);
  const store = createLastKnownGoodStore();
  store.set("model", entry);
  return { g, entry, store, spec: resolved.spec };
}
test("[T18/T20] LKG restores whole configuration through outage despite internal route changes", () => {
  const { entry, store, spec } = seed();
  const changed = response("model", { base_model: "other-version", models_dev_provider: "wrong", id: "changed", input_cost_per_token: 99 }, { model: "private/new-route" });
  expect(validateLastKnownGood(entry, group("model", changed.data[0]!.model_info, changed.data[0]!.litellm_params), undefined, 99999999999, options, undefined).valid).toBe(true);
  const result = buildPublicationResult(changed, undefined, options, { store });
  expect(result.publishable[0]?.spec).toEqual(spec);
  expect(result.publishable[0]?.assessment.status).toBe("configured-lkg");
  expect(buildPublicationResult(response(), metadataCatalog(), options, { store }).publishable[0]?.assessment.status).toBe("configured");
});
test("[T19] LKG schema9 rejects old schema8 and critical damage, but normalizes bad prices", () => {
  const { g, entry, store, spec } = seed();
  expect(PUBLICATION_SCHEMA_VERSION).toBe(9);
  expect(isLKGEntryCompatible(entry)).toBe(true);
  expect(isLKGEntryCompatible({ ...entry, schemaVersion: 8 })).toBe(false);
  expect(isLKGEntryCompatible({ ...entry, spec: { ...spec, limit: { ...spec.limit, context: 1 } } })).toBe(false);
  expect(isLKGEntryCompatible({ ...entry, spec: { ...spec, variants: [{ id: "forged", settings: {} }] } })).toBe(false);
  const damagedPrice = { ...entry, spec: { ...spec, cost: { input: -1, output: NaN, cacheRead: Infinity, cacheWrite: "bad" } } } as never;
  expect(validateLastKnownGood(damagedPrice, g, undefined).valid).toBe(true);
  store.set("model", damagedPrice);
  expect(buildPublicationResult(response(), undefined, options, { store }).publishable[0]?.spec.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});
test("[T18] LKG restores the reasoning and tool facts consumed by hosts", () => {
  const catalog = metadataCatalog(modelRecord({ reasoning: true, reasoning_options: [{ type: "effort", values: ["low", "max"] }] }));
  const live = buildPublicationResult(response(), catalog, options).publishable[0]!;
  const store = createLastKnownGoodStore();
  store.set("model", createLastKnownGoodEntry(group(), undefined, live.spec, 1000000, capturedPublicationVerdict(live.assessment, live.spec), catalog, options));
  const restored = buildPublicationResult(response(), undefined, options, { store }).publishable[0]!;
  expect(hostReasoningFlag(restored.assessment)).toBe(true);
  expect(hostToolsFlag(restored.assessment, restored.spec.capabilities.tools)).toBe(true);
  expect(restored.assessment.reasoning.levels).toEqual(["low", "max"]);
  expect(describeAssessment(restored.assessment)).toBe("configured-lkg: publishable");
});
test("[T19] LKG cannot capture an incomplete or divergent critical configuration", () => {
  const { g, spec } = seed();
  expect(() => createLastKnownGoodEntry(g, undefined, { ...spec, capabilities: { ...spec.capabilities, tools: false } }, 1, undefined, metadataCatalog(), options)).toThrow();
  expect(() => createLastKnownGoodEntry(g, undefined, spec, 1, undefined, undefined, options)).toThrow();
});
test("[T20/T21] deleted models and another endpoint store never restore an old model", () => {
  const { store } = seed();
  expect(buildPublicationResult({ data: [] }, undefined, options, { store }).publishable).toEqual([]);
  expect(buildPublicationResult(response("other"), undefined, options, { store }).publishable).toEqual([]);
  expect(buildPublicationResult(response(), undefined, options, { store: createLastKnownGoodStore() }).publishable).toEqual([]);
});
test("[T19/T21] snapshot2 protects critical contents and endpoint scope but ignores bad prices", () => {
  const { spec } = seed();
  const endpoint = endpointFingerprint({ baseUrl: "http://litellm.example:4000", credentialKey: "sk-test" });
  const snapshot = createDiscoverySnapshot(endpoint, [spec]);
  expect(DISCOVERY_SNAPSHOT_SCHEMA_VERSION).toBe(2);
  expect(inspectDiscoverySnapshot({ ...snapshot, schemaVersion: 1 }, endpoint).compatible).toBe(false);
  expect(inspectDiscoverySnapshot({ ...snapshot, models: [{ ...spec, limit: { ...spec.limit, context: 1 } }] }, endpoint).reason).toBe("corrupt");
  const withoutCost = { ...spec } as Partial<typeof spec>;
  delete withoutCost.cost;
  expect(inspectDiscoverySnapshot({ ...snapshot, models: [withoutCost] }, endpoint).snapshot?.models[0]?.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  const another = endpointFingerprint({ baseUrl: "http://litellm.example:4000", credentialKey: "sk-other" });
  expect(inspectDiscoverySnapshot(snapshot, another).reason).toBe("endpoint");
});
test("[T16/T17] price and deprecated cap changes update display without availability drift", () => {
  const { spec } = seed();
  const before = createDiscoverySnapshot("scope", [spec]);
  const after = createDiscoverySnapshot("scope", [{ ...spec, cost: { ...spec.cost, input: 9 } }]);
  expect(compareDiscoverySnapshots(before, after)).toMatchObject({ changed: true, drift: false, metadataChanged: ["model"] });
  const input = { baseUrl: "http://litellm.example:4000", credentialKey: "sk-test" };
  expect(endpointFingerprint({ ...input, buildOptions: { ...options, contextTierCap: true } })).toBe(endpointFingerprint({ ...input, buildOptions: options }));
});
test("[T22/T23/T24] build, publication, diagnostics and public mapping share facts and allowlisted output", () => {
  const secret = "sk-injected-secret";
  const internal = "http://private.example.invalid";
  const body = response("model", { api_key: secret, api_base: internal, base_model: internal }, { model: internal, api_key: secret });
  const catalog = metadataCatalog(modelRecord({ api_key: secret, api_base: internal }));
  const spec = buildModelSpecs(body, catalog, options)[0]!;
  const publication = buildPublicationResult(body, catalog, options);
  const diagnostic = diagnoseModelSpecs(body, catalog, options);
  expect(publication.publishable[0]?.spec).toEqual(spec);
  expect(diagnostic.models[0]).toEqual(spec);
  expect(diagnostic.diagnostics.stats.modelsDevMatched).toBe(1);
  expect(diagnostic.diagnostics.models[0]?.modelsDev.providerID).toBe("lab");
  expect(diagnostic.diagnostics.models[0]?.publication.reasoningState).toBe("unsupported");
  const text = JSON.stringify(diagnostic);
  for (const forbidden of [secret, internal, "models_dev_provider", "serving", "proof", "operatorConfiguration"])
    expect(text).not.toContain(forbidden);
  expect(mapCapabilities(group(), selectModelsDevRecord(group(), catalog), true)).toEqual({ capabilities: spec.capabilities, limit: spec.limit, cost: spec.cost });
});
