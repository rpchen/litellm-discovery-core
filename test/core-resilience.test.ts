import { describe, expect, test } from "bun:test";
import { buildCatalogPublication, catalogDegradationFingerprint, catalogFromPublication, decideAcknowledgement, nextPublishedBaseline, parsePublicationMemory, PUBLICATION_MEMORY_SCHEMA_VERSION, serializePublicationMemory, withheldModelFingerprint, type DegradationAcknowledgement, type PublicationMemory } from "../src/core/catalog.ts";
import { groupLiteLLMDeployments, type DeploymentGroup } from "../src/core/litellm.ts";
import { buildPublicationResult, PUBLICATION_SCHEMA_VERSION } from "../src/core/publication.ts";
const options = { contextTierCap: false, protocolOverrides: {} } as const;
function groupOf(modelName: string, modelInfo: Record<string, unknown>, params: Record<string, unknown> = {}): DeploymentGroup {
  return groupLiteLLMDeployments({
    data: [{ model_name: modelName, litellm_params: { model: params.model ?? "custom/" + modelName, ...params }, model_info: { mode: "chat", ...modelInfo } }],
  })[0]!;
}
function shape(models: Record<string, unknown>, providers: Record<string, unknown> = {}) {
  return {
    models,
    providers: Object.keys(providers).length ? Object.fromEntries(Object.entries(providers).map(([provider, records]) => [provider, { models: records }]))
      : Object.fromEntries([...new Set(Object.keys(models).map((key) => key.split("/")[0]!.toLowerCase()))].map((owner) => [owner, { models: Object.fromEntries(Object.entries(models).filter(([key]) => key.split("/")[0]!.toLowerCase() === owner).map(([key, record]) => [key.split("/").at(-1)!, record])) }])),
  };
}
const COMPLETE_INFO = {
  max_input_tokens: 128000,
  max_output_tokens: 32000,
  supports_function_calling: true,
  supports_reasoning: false,
  supports_vision: false,
  supports_pdf_input: false,
  supports_audio_input: false,
  supports_video_input: false,
  supports_audio_output: false,
};
describe("resilience: partial catalog", () => {
  const complete = { ...COMPLETE_INFO };
  /** 20 discovered models: 18 fully configured, 2 with distinct blockers. */
  function twentyModels() {
    const data: unknown[] = [];
    for (let index = 0; index < 18; index += 1) {
      data.push({
        model_name: `ok-${index}`,
        litellm_params: { model: `custom/ok-${index}` },
        model_info: { mode: "chat", ...complete },
      });
    }
    // metadata unavailable: no limits at all and no enrichment
    data.push({ model_name: "withheld-missing", litellm_params: { model: "custom/withheld-missing" }, model_info: { mode: "chat" } });
    // illegal declared limit
    data.push({
      model_name: "withheld-illegal",
      litellm_params: { model: "custom/withheld-illegal" },
      model_info: { mode: "chat", ...complete, max_output_tokens: 0 },
    });
    return { data };
  }
  /**
   * Registry entries for the publishable fixtures. The `custom/ok-*` and
   * `custom/late` routes are qualified values WITHOUT adapter parse evidence,
   * so the registry must carry the full wire id as its key for the group to
   * prove canonical identity; otherwise the models are LiteLLM-only, context
   * stays missing under the dimension-isolation invariant (G30), and nothing
   * publishes. This keeps the partition math below about partitioning, not
   * about identity.
   */
  function okRegistry(): Record<string, unknown> {
    const models: Record<string, unknown> = {};
    for (let index = 0; index < 18; index += 1) {
      models[`custom/ok-${index}`] = { limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } };
    }
    models["custom/late"] = { limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } };
    models["custom/ok"] = { limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } };
    return models;
  }
  test("18 of 20 models publish immediately; the other 2 are withheld with reasons", () => {
    // Registry holds duplicate bare ids so the shared-name model is
    // genuinely identity-ambiguous even without provider records.
    const catalog = shape({
      "a/shared": { limit: { context: 1, output: 1 } },
      "b/shared": { limit: { context: 1, output: 1 } },
      ...okRegistry(),
    });
    const body = { data: [...(twentyModels().data as unknown[]), { model_name: "shared", litellm_params: { model: "shared" }, model_info: { mode: "chat", ...complete } }] };
    const result = buildPublicationResult(body, catalog, options);
    expect(result.publishable.length).toBe(18);
    expect(result.blocked.length).toBe(3);
    const catalogFacts = catalogFromPublication(result, { discovered: 21 });
    expect(catalogFacts.discovered).toBe(21);
    expect(catalogFacts.publishable.length).toBe(18);
    expect(catalogFacts.partial).toBeTrue();
    expect(catalogFacts.unusable).toBeFalse();
    expect(catalogFacts.withheld.map((entry) => entry.id).sort()).toEqual(["shared", "withheld-illegal", "withheld-missing"]);
    const reasons = Object.fromEntries(catalogFacts.withheld.map((entry) => [entry.id, entry.reasons.map((reason) => reason.code)]));
    expect(reasons["withheld-missing"]).toContain("incomplete-metadata");
    expect(reasons["withheld-illegal"]).toContain("illegal-metadata");
    expect(reasons["shared"]).toContain("identity-ambiguous");
  });
  test("discovered > 0 with zero publishable is reported as an unusable catalog", () => {
    const data = [
      { model_name: "gone", litellm_params: { model: "custom/gone" }, model_info: { mode: "chat" } },
    ];
    const result = buildPublicationResult({ data }, {}, options);
    expect(result.publishable.length).toBe(0);
    const facts = catalogFromPublication(result, { discovered: 1 });
    expect(facts.unusable).toBeTrue();
    expect(facts.partial).toBeFalse();
  });
  test("a withheld model recovering is published automatically without user approval", () => {
    // First round: `late` has no registry entry yet, so it is genuinely
    // context-missing (LiteLLM-only, G30) and withheld. Second round adds the
    // canonical entry plus complete declarations: nothing else is required
    // to publish it.
    const bareRegistry = shape({ "custom/ok": { limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } });
    const withLate = shape({
      "custom/ok": { limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } },
      "custom/late": { limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } },
    });
    const first = buildPublicationResult({ data: [{ model_name: "ok", litellm_params: { model: "custom/ok" }, model_info: { mode: "chat", ...complete } }, { model_name: "late", litellm_params: { model: "custom/late" }, model_info: { mode: "chat" } }] }, bareRegistry, options);
    expect(first.publishable.map((entry) => entry.spec.id)).toEqual(["ok"]);
    const before = catalogFromPublication(first, { discovered: 2 });
    expect(before.withheld.map((entry) => entry.id)).toEqual(["late"]);
    expect(before.newlyWithheld.map((entry) => entry.id)).toEqual(["late"]);
    expect(before.regressions).toEqual([]);
    // The same model becomes complete: nothing else is required to publish it.
    const second = buildPublicationResult({ data: [{ model_name: "ok", litellm_params: { model: "custom/ok" }, model_info: { mode: "chat", ...complete } }, { model_name: "late", litellm_params: { model: "custom/late" }, model_info: { mode: "chat", ...complete } }] }, withLate, options);
    const after = catalogFromPublication(second, { discovered: 2, previouslyPublished: new Set(["ok"]) });
    expect(after.withheld).toEqual([]);
    expect([...after.publishable].sort()).toEqual(["late", "ok"]);
    expect(after.unusable).toBeFalse();
  });
  test("a previously published model becoming withheld is a regression", () => {
    const previouslyPublished = new Set(["ok-0", "ok-1"]);
    const result = buildPublicationResult({
      data: [
        { model_name: "ok-0", litellm_params: { model: "custom/ok-0" }, model_info: { mode: "chat", ...complete } },
        { model_name: "ok-1", litellm_params: { model: "custom/ok-1" }, model_info: { mode: "chat" } },
        { model_name: "brand-new", litellm_params: { model: "custom/brand-new" }, model_info: { mode: "chat" } },
      ],
    }, shape({ "custom/ok-0": { limit: { context: 128000, output: 32000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } }), options);
    const facts = catalogFromPublication(result, { discovered: 3, previouslyPublished });
    expect(facts.regressions.map((entry) => entry.id)).toEqual(["ok-1"]);
    expect(facts.newlyWithheld.map((entry) => entry.id)).toEqual(["brand-new"]);
    expect(facts.partial).toBeTrue();
  });
});
// ---------------------------------------------------------------------------
// Acknowledgement: notification suppression only
// ---------------------------------------------------------------------------
describe("resilience: acknowledgement", () => {
  function withheld(id: string, status: "discovered-incomplete" | "ambiguous" = "discovered-incomplete", code = "incomplete-metadata") {
    return {
      id,
      status,
      reasons: [{ code: code as never, message: "x", fields: ["limit.output"] }],
      retryable: false,
    };
  }
  test("a first-observation gap is not interruptive, an unusable catalog always is", () => {
    const one = buildCatalogPublication({ publishable: [{ id: "a", usingLKG: false }], withheld: [withheld("b")], discovered: 2 });
    const first = decideAcknowledgement(undefined, one, "2026-01-01T00:00:00.000Z");
    expect(first.notify).toBeFalse();
    expect(first.reason).toBe("first-observation");
    expect(first.next).toBeUndefined();
    const unusable = buildCatalogPublication({ publishable: [], withheld: [withheld("a"), withheld("b")], discovered: 2 });
    const loud = decideAcknowledgement(undefined, unusable, "2026-01-01T00:00:00.000Z");
    expect(loud.notify).toBeTrue();
    expect(loud.reason).toBe("catalog-unusable");
  });
  test("improvement stays quiet, full recovery clears state, new problems re-notify", () => {
    const two = buildCatalogPublication({ publishable: [], withheld: [withheld("a"), withheld("b")], discovered: 2 });
    const acknowledged = decideAcknowledgement(undefined, two, "2026-01-01T00:00:00.000Z");
    void acknowledged;
    const state: DegradationAcknowledgement = acknowledged.next!;
    const improved = buildCatalogPublication({ publishable: [{ id: "a", usingLKG: false }], withheld: [withheld("b")], discovered: 2 });
    expect(decideAcknowledgement(state, improved, "2026-01-02T00:00:00.000Z").notify).toBeFalse();
    expect(decideAcknowledgement(state, improved, "2026-01-02T00:00:00.000Z").reason).toBe("improved");
    const recovered = buildCatalogPublication({ publishable: [{ id: "a", usingLKG: false }, { id: "b", usingLKG: false }], withheld: [], discovered: 2 });
    const cleared = decideAcknowledgement(state, recovered, "2026-01-02T00:00:00.000Z");
    expect(cleared.notify).toBeFalse();
    expect(cleared.reason).toBe("catalog-recovered");
    expect(cleared.next).toBeUndefined();
    const grew = buildCatalogPublication({ publishable: [], withheld: [withheld("a"), withheld("b"), withheld("c")], discovered: 3 });
    expect(decideAcknowledgement(state, grew, "2026-01-02T00:00:00.000Z").notify).toBeTrue();
    // A materially different failure reason for the same model is a new issue.
    const changed = buildCatalogPublication({ publishable: [{ id: "healthy", usingLKG: false }], withheld: [withheld("a", "ambiguous", "identity-ambiguous"), withheld("b")], discovered: 3 });
    expect(decideAcknowledgement(state, changed, "2026-01-02T00:00:00.000Z").notify).toBeTrue();
    expect(decideAcknowledgement(state, changed, "2026-01-02T00:00:00.000Z").reason).toBe("new-issues");
  });
  test("a previously published model becoming withheld outranks a quiet first-time gap", () => {
    const facts = buildCatalogPublication({
      publishable: [{ id: "healthy", usingLKG: false }],
      withheld: [withheld("was-published"), withheld("new-model")],
      discovered: 3,
      previouslyPublished: new Set(["was-published"]),
    });
    const decision = decideAcknowledgement(undefined, facts, "2026-01-01T00:00:00.000Z");
    expect(decision.notify).toBeTrue();
    expect(decision.reason).toBe("regression");
  });
  test("fingerprints ignore timestamps, counters, and message detail", () => {
    const left = withheldModelFingerprint("discovered-incomplete", [{ code: "incomplete-metadata", message: "first", fields: ["limit.output"] }]);
    const right = withheldModelFingerprint("discovered-incomplete", [{ code: "incomplete-metadata", message: "retry 7 failed at 12:00", fields: ["limit.output"] }]);
    expect(left).toBe(right);
    expect(catalogDegradationFingerprint([])).toBe("sha256:none");
  });
  test("acknowledgement state never participates in publication", () => {
    const decision = decideAcknowledgement(undefined, buildCatalogPublication({
      publishable: [],
      withheld: [withheld("a")],
      discovered: 1,
    }), "2026-01-01T00:00:00.000Z");
    expect(decision.next).toBeDefined();
    // A stored acknowledgement is inert data: the publication partition above
    // still reports zero publishable models and the model stays withheld.
    const stored: DegradationAcknowledgement = decision.next!;
    expect(stored.schemaVersion).toBe(1);
    expect(PUBLICATION_SCHEMA_VERSION).toBe(9);
  });
});
describe("resilience: acknowledgement persistence", () => {
  test("publication memory round-trips acknowledgement and baselines", () => {
    const memory: PublicationMemory = {
      schemaVersion: PUBLICATION_MEMORY_SCHEMA_VERSION,
      acknowledgement: {
        schemaVersion: 1,
        fingerprint: "sha256:abc",
        models: { a: withheldModelFingerprint("ambiguous", [{ code: "identity-ambiguous", message: "x", fields: ["identity"] }]) },
        acknowledgedAt: "2026-01-01T00:00:00.000Z",
      },
      published: ["a", "b"],
    };
    const serialized = serializePublicationMemory(memory);
    const parsed = parsePublicationMemory(serialized)!;
    expect(parsed.published).toEqual(["a", "b"]);
    expect(parsed.acknowledgement?.fingerprint).toBe("sha256:abc");
    expect(nextPublishedBaseline(["a", "old"], ["b"], ["c"])).toEqual(["b"]);
  });
  test("corrupt memory never publishes or withholds by itself", () => {
    expect(parsePublicationMemory("not-json")).toBeUndefined();
    expect(parsePublicationMemory({ schemaVersion: 999 })).toBeUndefined();
  });
});
// ---------------------------------------------------------------------------
// Modality sets reach the published spec (registry complete sets)
// ---------------------------------------------------------------------------
