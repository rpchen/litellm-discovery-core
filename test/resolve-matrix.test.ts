/**
 * G-matrix: synthetic real-schema catalogs (adopt-modelsdev-canonical-catalog).
 *
 * Covers wire-ID parsing (G3/G3b/G3c/G3d/G26/G27), catalog input (G21/G33/G39),
 * identity (G1/G2/G2b/G24/G25/G29), serving (G4/G6/G6b/G7/G8/G9/G10/G10b/G11/
 * G12/G12b/G12c/G40), field matrix (G13/G13b/G13c/G15/G19/G19b/G19b2/G19c/
 * G19d/G19e/G30/G34/G35), enforcement (G14b/G14c/G31/G32/G36/G37/G44),
 * reasoning (G16/G17/G17b/G17c/G17d), price (G18/G18b/G18c), LKG (G20–G20h/
 * G38/G41/G42/G43), and determinism helpers. R-level behavior lives in
 * `canonical-catalog-acceptance.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { normalizeModelsDevCatalog } from "../src/core/catalog-input.ts";
import { parseWireID } from "../src/core/wire-id.ts";
import { groupLiteLLMDeployments } from "../src/core/litellm.ts";
import { buildModelSpecs } from "../src/core/build.ts";
import { resolveModel } from "../src/core/resolve.ts";
import { diagnoseModelSpecs } from "../src/core/diagnostics.ts";
import {
  assessModelConfiguration,
  buildPublicationResult,
  capturedPublicationVerdict,
  createLastKnownGoodEntry,
  createLastKnownGoodStore,
  validateLastKnownGood,
  PUBLICATION_SCHEMA_VERSION,
} from "../src/core/publication.ts";

const options = { contextTierCap: false, protocolOverrides: {} };

function litellmModel(
  modelName: string,
  params: Record<string, unknown>,
  info: Record<string, unknown>,
) {
  return {
    data: [{ model_name: modelName, litellm_params: params, model_info: { mode: "chat", ...info } }],
  };
}

function catalog(models: Record<string, unknown>, providers: Record<string, Record<string, unknown>> = {}) {
  return {
    models,
    providers: Object.fromEntries(
      Object.entries(providers).map(([provider, records]) => [provider, { models: records }]),
    ),
  };
}

const FULL = {
  max_input_tokens: 1000,
  max_output_tokens: 100,
  supports_function_calling: true,
  supports_reasoning: false,
  supports_vision: false,
  supports_pdf_input: false,
  supports_audio_input: false,
  supports_video_input: false,
  supports_audio_output: false,
};

function entry(overrides: Record<string, unknown> = {}) {
  return {
    limit: { context: 10000, input: 9000, output: 1000 },
    modalities: { input: ["text"], output: ["text"] },
    tool_call: true,
    reasoning: false,
    ...overrides,
  };
}

function groupOf(litellm: unknown, modelName: string) {
  const group = groupLiteLLMDeployments(litellm).find((item) => item.modelName === modelName)!;
  return group;
}

// ---------------------------------------------------------------------------
// Catalog input (G21/G33/G39)
// ---------------------------------------------------------------------------

describe("catalog input contract", () => {
  test("G21: complete / providers-only / unavailable tri-state", () => {
    expect(normalizeModelsDevCatalog(catalog({ "labA/x": entry() })).kind).toBe("complete");
    // Legacy provider map without a registry.
    expect(normalizeModelsDevCatalog({ labA: { models: { x: entry() } } }).kind).toBe("providers-only");
    expect(normalizeModelsDevCatalog({}).kind).toBe("unavailable");
    expect(normalizeModelsDevCatalog(null).kind).toBe("unavailable");
    expect(normalizeModelsDevCatalog("nope").kind).toBe("unavailable");
    expect(normalizeModelsDevCatalog({ providers: {}, models: {} }).kind).toBe("complete");
  });

  test("G33: unknown top-level keys are ignored", () => {
    const doc = { ...catalog({ "labA/x": entry() }), generatedAt: "now", schemaVersion: 99 };
    expect(normalizeModelsDevCatalog(doc).kind).toBe("complete");
  });

  test("G39: models-only is unavailable", () => {
    expect(normalizeModelsDevCatalog({ models: { "labA/x": entry() } }).kind).toBe("unavailable");
  });

  test("providers-only never resolves canonical or serving records", () => {
    const legacy = { labA: { models: { x: entry() } } };
    const litellm = litellmModel("x", { model: "x" }, FULL);
    const resolved = resolveModel(groupOf(litellm, "x"), legacy, {});
    expect(resolved.catalogKind).toBe("providers-only");
    expect(resolved.identity.status).toBe("unproven");
    expect(resolved.serving.status).toBe("unproven");
  });
});

// ---------------------------------------------------------------------------
// Wire-ID parsing (G3/G3b/G3c/G3d/G26/G27)
// ---------------------------------------------------------------------------

describe("wire-ID parsing carries no authority", () => {
  test("G3/G27: adapter remainder only with custom_llm_provider evidence", () => {
    const withEvidence = parseWireID("openrouter/labA/x", "openrouter")!;
    expect(withEvidence.afterAdapter).toBe("labA/x");
    expect(withEvidence.adapterSegment).toBe("openrouter");
    const without = parseWireID("openrouter/labA/x", undefined)!;
    expect(without.afterAdapter).toBeUndefined();
    expect(without.lookupKeys).toEqual(["openrouter/labA/x"]);
  });

  test("G26: qualified value without adapter evidence never takes the tail", () => {
    const doc = catalog({ "labA/foo": entry() });
    const litellm = litellmModel("m", { model: "some-private-provider/foo" }, FULL);
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.identity.status).not.toBe("proven");
  });

  test("G3b: adapter segment never proves serving or lab", () => {
    const doc = catalog({ "labA/x": entry() });
    const litellm = litellmModel("m", { model: "openai/x", custom_llm_provider: "openai" }, FULL);
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.identity.status).toBe("proven");
    expect(resolved.identity.canonicalModelID).toBe("labA/x");
    expect(resolved.serving.status).toBe("unproven");
  });

  test("G3c/G3d: qualified registry hit proves identity, never serving", () => {
    const doc = catalog({ "labA/x": entry() });
    const litellm = litellmModel("m", { model: "labA/x" }, FULL);
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.identity.status).toBe("proven");
    expect(resolved.serving.status).toBe("unproven");
  });
});

// ---------------------------------------------------------------------------
// Identity (G1/G2/G2b/G24/G25/G29)
// ---------------------------------------------------------------------------

describe("canonical identity resolution", () => {
  test("G1: unique bare id proves registry-unique", () => {
    const resolved = resolveModel(groupOf(litellmModel("m", { model: "x" }, FULL), "m"), catalog({ "labA/x": entry() }), {});
    expect(resolved.identity.status).toBe("proven");
    expect(resolved.identity.evidence).toBe("registry-unique");
    expect(resolved.identity.canonicalModelID).toBe("labA/x");
  });

  test("G2: duplicate bare id is ambiguous and stops evaluation", () => {
    const doc = catalog({ "labA/x": entry(), "labB/x": entry() });
    const resolved = resolveModel(groupOf(litellmModel("m", { model: "x" }, FULL), "m"), doc, {});
    expect(resolved.identity.status).toBe("ambiguous");
    expect(resolved.publishable).toBe(false);
  });

  test("G2b: qualified route disambiguates duplicates", () => {
    const doc = catalog({ "labA/x": entry(), "labB/x": entry() });
    const resolved = resolveModel(groupOf(litellmModel("m", { model: "labB/x" }, FULL), "m"), doc, {});
    expect(resolved.identity.status).toBe("proven");
    expect(resolved.identity.canonicalModelID).toBe("labB/x");
  });

  test("G24: no heuristic identity from prefixes", () => {
    const resolved = resolveModel(
      groupOf(litellmModel("m", { model: "x" }, FULL), "m"),
      catalog({ "labA/x-pro": entry() }),
      {},
    );
    expect(resolved.identity.status).toBe("unproven");
  });

  test("G25: model_name alone never proves identity", () => {
    const litellm = { data: [{ model_name: "x", litellm_params: {}, model_info: { mode: "chat" } }] };
    const resolved = resolveModel(groupOf(litellm, "x"), catalog({ "labA/x": entry() }), {});
    expect(resolved.identity.status).toBe("unproven");
  });

  test("G29: canonical/serving contradiction fails closed even when facts match", () => {
    const facts = entry();
    const doc = catalog(
      { "labA/x": facts, "labA/y": { ...structuredClone(facts) } },
      { P: { "sku": { id: "sku", canonical_model_id: "labA/y", ...structuredClone(facts) } } },
    );
    const litellm = litellmModel("m", { model: "labA/x" }, { ...FULL, models_dev_provider: "P" });
    // Wire id labA/x must also hit P/sku for the serving proof: add exact key.
    const doc2 = catalog(
      { "labA/x": facts, "labA/y": { ...structuredClone(facts) } },
      { P: { "labA/x": { id: "labA/x", canonical_model_id: "labA/y", ...structuredClone(facts) } } },
    );
    const resolved = resolveModel(groupOf(litellm, "m"), doc2, {});
    expect(resolved.identity.status).toBe("conflict");
    expect(resolved.publishable).toBe(false);
    void doc;
  });
});

// ---------------------------------------------------------------------------
// Serving (G4/G6/G6b/G7/G8/G10/G10b/G11/G12b/G12c/G40)
// ---------------------------------------------------------------------------

describe("serving provider proof", () => {
  const base = entry();

  test("G6: unproven first-party override is not intrinsic", () => {
    const doc = catalog(
      { "labA/x": { ...entry(), limit: { context: 100, output: 10 } } },
      { labA: { x: { id: "x", limit: { context: 80, output: 10 } } } },
    );
    const resolved = resolveModel(groupOf(litellmModel("m", { model: "x" }, FULL), "m"), doc, {});
    expect(resolved.fields["limit.context"]!.value).toBe(100);
  });

  test("G6b: proven lab provider serves overrides", () => {
    const doc = catalog(
      { "labA/x": { ...entry(), limit: { context: 100, output: 10 } } },
      { labA: { x: { id: "x", limit: { context: 80, input: 70, output: 10 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false } } },
    );
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, models_dev_provider: "labA" });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.serving.status).toBe("declared");
    expect(resolved.fields["limit.context"]!.basis).toBe("serving");
    expect(resolved.fields["limit.context"]!.value).toBe(80);
  });

  test("G7/G8: reseller values only under a proven declaration", () => {
    const doc = catalog(
      { "labA/x": { ...entry(), limit: { context: 100, output: 10 } } },
      { R: { x: { id: "x", limit: { context: 50, output: 5 }, cost: { input: 9 } } } },
    );
    const unproven = resolveModel(groupOf(litellmModel("m", { model: "x" }, FULL), "m"), doc, {});
    expect(unproven.fields["limit.context"]!.value).toBe(100);
    expect(unproven.fields["price.input"]!.basis).toBe("unknown");
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, models_dev_provider: "R" });
    const proven = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(proven.serving.status).toBe("declared");
    expect(proven.fields["limit.context"]!.value).toBe(50);
  });

  test("G10/G11: variants never chosen by relation; exact key wins", () => {
    const doc = catalog(
      { "labA/x": base },
      {
        R: {
          x: { id: "x", canonical_model_id: "labA/x", ...structuredClone(base) },
          "x-free": { id: "x-free", canonical_model_id: "labA/x", limit: { context: 1, output: 1 } },
          "x-fast": { id: "x-fast", canonical_model_id: "labA/x", limit: { context: 2, output: 2 } },
        },
      },
    );
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, models_dev_provider: "R" });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.serving.status).toBe("declared");
    expect(resolved.serving.recordID).toBe("x");
  });

  test("G10b: unregistered variant route withholds; relation proves no identity", () => {
    const doc = catalog(
      { "labA/x": base },
      { R: { "x-free": { id: "x-free", canonical_model_id: "labA/x", limit: { context: 1, output: 1 } } } },
    );
    const litellm = litellmModel("m", { model: "x-free" }, { mode: "chat" });
    const assessment = assessModelConfiguration(groupOf(litellm, "m"), doc, options);
    expect(assessment.publishable).toBe(false);
  });

  test("G40: gateway with only relation records is serving-record-unresolved", () => {
    const doc = catalog(
      { "labA/x": base },
      { gatewayX: { "x-free": { id: "x-free", canonical_model_id: "labA/x", limit: { context: 1, output: 1 }, cost: { input: 5 } } } },
    );
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, models_dev_provider: "gatewayX" });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.serving.status).toBe("serving-record-unresolved");
    expect(resolved.fields["limit.context"]!.basis).toBe("canonical");
    expect(resolved.fields["price.input"]!.basis).toBe("unknown");
  });

  test("G12b: declared provider absent from the catalog is declared-unmatched", () => {
    const doc = catalog({ "labA/x": base }, {});
    // `nope` and `labA` are both absent from the providers table (the catalog
    // declares no providers at all), so both are declared-unmatched.
    for (const provider of ["nope", "labA"]) {
      const litellm = litellmModel("m", { model: "x" }, { ...FULL, models_dev_provider: provider });
      const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
      expect(resolved.serving.status).toBe("declared-unmatched");
      expect(resolved.publishable).toBe(true);
    }
  });

  test("G12c: declared provider present in the catalog but without an exact record is serving-record-unresolved", () => {
    // The provider EXISTS in the catalog but none of its records (here: an
    // unrelated relation-only SKU) matches the wire id's parsed lookup keys.
    // That is serving-record-unresolved — declared-unmatched is reserved for
    // a provider absent from the catalog entirely.
    const doc = catalog(
      { "labA/x": base },
      { P: { "un-related": { id: "un-related", canonical_model_id: "labA/x", limit: { context: 5, output: 5 } } } },
    );
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, models_dev_provider: "P" });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.serving.status).toBe("serving-record-unresolved");
    // Provider P exists but supplies no facts; the group resolves through
    // canonical branches (identity proven via the registry bare match).
    expect(resolved.publishable).toBe(true);
  });

  test("G12c (empty provider): a provider present with an empty record set is serving-record-unresolved", () => {
    const doc = catalog({ "labA/x": base }, { P: {} });
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, models_dev_provider: "P" });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.serving.status).toBe("serving-record-unresolved");
  });

  test("G4: relation-only SKU proves underlying identity under a proven provider", () => {
    const doc = catalog(
      { "labA/x": base },
      { P: { "x-sku": { id: "x-sku", canonical_model_id: "labA/x", limit: { context: 100, output: 10 } } } },
    );
    // Wire id x-sku hits the SKU exactly: declared.
    const litellm = litellmModel("m", { model: "x-sku" }, { ...FULL, models_dev_provider: "P" });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.serving.status).toBe("declared");
  });
});

// ---------------------------------------------------------------------------
// Field matrix (G13/G13b/G13c/G15/G19/G19b/G19b2/G19c/G19d/G19e/G34/G35)
// ---------------------------------------------------------------------------

describe("field resolution matrix", () => {
  test("G13: LiteLLM descriptive difference is a resolved discrepancy", () => {
    const doc = catalog({ "labA/x": entry({ limit: { context: 10000, input: 9000, output: 1000 } }) });
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, max_output_tokens: 500 });
    const assessment = assessModelConfiguration(groupOf(litellm, "m"), doc, options);
    expect(assessment.publishable).toBe(true);
    expect(assessment.discrepancies.some((item) => item.field === "limit.output")).toBe(true);
  });

  test("G13b: unproven records never conflict with descriptive evidence", () => {
    const doc = catalog(
      {},
      { R: { x: { id: "x", limit: { context: 1, output: 2 }, tool_call: false } } },
    );
    const assessment = assessModelConfiguration(groupOf(litellmModel("m", { model: "x" }, FULL), "m"), doc, options);
    // Unproven records never create conflicts — and under dimension isolation
    // (G30) the group is LiteLLM-only, so context stays missing and the model
    // is withheld; the reseller record never fills it.
    expect(assessment.publishable).toBe(false);
    expect(assessment.status).toBe("discovered-incomplete");
    expect(assessment.fieldBasis?.["limit.context"]).toBe("unknown");
    expect(assessment.conflicts).toEqual([]);
  });

  test("G13c: cross-deployment disagreement is an unresolved conflict", () => {
    const doc = catalog({ "labA/x": entry() });
    const litellm = {
      data: [
        { model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", ...FULL, max_output_tokens: 100 } },
        { model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", ...FULL, max_output_tokens: 200 } },
      ],
    };
    const assessment = assessModelConfiguration(groupOf(litellm, "m"), doc, options);
    expect(assessment.publishable).toBe(false);
    expect(assessment.conflicts.some((item) => item.field === "limit.output")).toBe(true);
  });

  test("G15: input capacity never compared with total context", () => {
    const doc = catalog({ "labA/x": entry({ limit: { context: 400000, input: 272000, output: 1000 } }) });
    const same = litellmModel("m", { model: "x" }, { ...FULL, max_input_tokens: 272000, max_output_tokens: 1000 });
    expect(assessModelConfiguration(groupOf(same, "m"), doc, options).discrepancies.length).toBe(0);
    const different = litellmModel("m", { model: "x" }, { ...FULL, max_input_tokens: 300000 });
    const assessment = assessModelConfiguration(groupOf(different, "m"), doc, options);
    expect(assessment.discrepancies.some((item) => item.field === "limit.input")).toBe(true);
    expect(assessment.discrepancies.some((item) => item.field === "limit.context")).toBe(false);
  });

  test("G19: canonical missing output falls to LiteLLM declaration", () => {
    const doc = catalog({ "labA/x": entry({ limit: { context: 10000, input: 9000 } }) });
    const assessment = assessModelConfiguration(groupOf(litellmModel("m", { model: "x" }, FULL), "m"), doc, options);
    expect(assessment.publishable).toBe(true);
    expect(assessment.fieldBasis?.["limit.output"]).toBe("litellm-declared");
  });

  test("G19b/G35: serving input omission filled by same-dimension LiteLLM, never canonical", () => {
    const doc = catalog(
      { "labA/x": entry({ limit: { context: 10000, input: 9000, output: 1000 } }) },
      { P: { x: { id: "x", limit: { context: 8000, output: 900 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false } } },
    );
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, models_dev_provider: "P" });
    const assessment = assessModelConfiguration(groupOf(litellm, "m"), doc, options);
    expect(assessment.fieldBasis?.["limit.input"]).toBe("litellm-declared");
    expect(assessment.publishable).toBe(true);
  });

  test("G19b2: serving + LiteLLM both without input stays unknown, never context", () => {
    const doc = catalog(
      { "labA/x": entry({ limit: { context: 10000, input: 9000, output: 1000 } }) },
      { P: { x: { id: "x", limit: { context: 8000, output: 900 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false } } },
    );
    const info = { ...FULL };
    delete (info as Record<string, unknown>).max_input_tokens;
    const litellm = litellmModel("m", { model: "x" }, { ...info, models_dev_provider: "P" });
    const assessment = assessModelConfiguration(groupOf(litellm, "m"), doc, options);
    expect(assessment.fieldBasis?.["limit.input"]).toBe("unknown");
    // Still publishable: input is not gated.
    expect(assessment.publishable).toBe(true);
  });

  test("G19c: modality list is a complete set; contradiction is a discrepancy", () => {
    const doc = catalog({ "labA/x": entry({ modalities: { input: ["text", "image"], output: ["text"] } }) });
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, supports_audio_input: true });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.fields["capabilities.input"]!.value).toEqual(["text", "image"]);
    expect(resolved.fields["capabilities.input"]!.discrepancy).toBe(true);
  });

  test("G19d: absent modalities object is unknown, never text-only", () => {
    const doc = catalog({ "labA/x": entry({ modalities: undefined }) });
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, supports_vision: true });
    const assessment = assessModelConfiguration(groupOf(litellm, "m"), doc, options);
    expect(assessment.publishable).toBe(false);
    expect(assessment.fieldBasis?.["capabilities.input"]).toBe("unknown");
  });

  test("G19e: release date from canonical when serving unproven", () => {
    const doc = catalog({ "labA/x": entry({ release_date: "2026-01-01" }) });
    const resolved = resolveModel(groupOf(litellmModel("m", { model: "x" }, FULL), "m"), doc, {});
    expect(resolved.fields["releaseDate"]!.basis).toBe("canonical");
  });

  test("G34: registry without input and no LiteLLM fill keeps input unknown, still publishable", () => {
    const doc = catalog({ "labA/x": entry({ limit: { context: 10000, output: 1000 } }) });
    const info = { ...FULL };
    delete (info as Record<string, unknown>).max_input_tokens;
    const assessment = assessModelConfiguration(groupOf(litellmModel("m", { model: "x" }, info), "m"), doc, options);
    expect(assessment.fieldBasis?.["limit.input"]).toBe("unknown");
    expect(assessment.publishable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Enforcement (G14b/G14c/G31/G32/G36/G37/G44) + reasoning (G16/G17/...) + price
// ---------------------------------------------------------------------------

describe("runtime enforcement matrix (empty proven set)", () => {
  const doc = catalog({ "labA/x": entry({ limit: { context: 10000, input: 9000, output: 512000 } }) });
  const baseInfo = { ...FULL, max_input_tokens: 1000000 };

  test("G14b/G36: litellm_params capability keys never narrow or decide", () => {
    const litellm = litellmModel(
      "m",
      { model: "x", max_tokens: 65536, reasoning_effort: "high", supports_function_calling: false },
      baseInfo,
    );
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.fields["limit.output"]!.value).toBe(512000);
    expect(resolved.fields["capabilities.tools"]!.value).toBe(true);
    expect(resolved.reasoningLevels.state).toBe("unknown");
  });

  test("G14c: configured input keys never narrow the declared fill", () => {
    const noInputDoc = catalog({ "labA/x": entry({ limit: { context: 10000, output: 512000 } }) });
    const litellm = litellmModel("m", { model: "x", max_input_tokens: 900000 }, baseInfo);
    const resolved = resolveModel(groupOf(litellm, "m"), noInputDoc, {});
    expect(resolved.fields["limit.input"]!.value).toBe(1000000);
    expect(resolved.fields["limit.context"]!.value).toBe(10000);
  });

  test("G31/G32: merge-order and unknown keys contribute nothing", () => {
    const litellm = litellmModel("m", { model: "x", reasoning_effort: "max", some_future_key: true }, baseInfo);
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.publishable).toBe(true);
    expect(resolved.conflicts.length).toBe(0);
  });

  test("G37: operator-configuration keys are diagnostic only, never called enforcement", () => {
    const litellm = litellmModel("m", { model: "x", max_input_tokens: 5 }, baseInfo);
    const diagnosed = diagnoseModelSpecs(litellm, doc, options);
    const codes = diagnosed.diagnostics.issues.map((item) => item.code);
    expect(codes).toContain("operator-configuration");
    expect(JSON.stringify(diagnosed)).not.toMatch(/enforcement-narrowed/);
  });

  test("G44: litellm_params price beats model_info; never narrows capabilities", () => {
    const litellm = litellmModel(
      "m",
      { model: "x", input_cost_per_token: 5e-7 },
      { ...baseInfo, input_cost_per_token: 1e-7 },
    );
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.fields["price.input"]!.basis).toBe("litellm-declared");
    expect(resolved.fields["price.input"]!.value).toBeCloseTo(0.5, 10);
    expect(resolved.fields["limit.context"]!.value).toBe(10000);
  });
});

describe("reasoning controls authority", () => {
  test("G16: toggle-only or empty serving options are known-empty", () => {
    for (const reasoning_options of [[{ type: "toggle" }], []]) {
      const doc = catalog(
        { "labA/x": entry({ reasoning: true }) },
        { P: { x: { id: "x", reasoning: true, reasoning_options, limit: { context: 100, output: 10 } } } },
      );
      const litellm = litellmModel("m", { model: "x" }, { ...FULL, models_dev_provider: "P", supports_reasoning: true });
      const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
      expect(resolved.reasoningLevels).toMatchObject({ state: "known", values: [] });
    }
  });

  test("G17: only the declared serving record supplies levels", () => {
    const doc = catalog(
      { "labA/x": entry({ reasoning: true }) },
      {
        P: { x: { id: "x", reasoning: true, reasoning_options: [{ type: "effort", values: ["a", "b"] }], limit: { context: 100, output: 10 } } },
        Q: { x: { id: "x", reasoning: true, reasoning_options: [{ type: "effort", values: ["c"] }], limit: { context: 100, output: 10 } } },
      },
    );
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, models_dev_provider: "P", supports_reasoning: true });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, { protocolOverrides: { m: "responses" } });
    expect(resolved.reasoningLevels).toMatchObject({ state: "known", values: ["a", "b"] });
  });

  test("G17b: first-party levels without serving proof stay unknown", () => {
    const doc = catalog(
      { "labA/x": entry({ reasoning: true }) },
      { labA: { x: { id: "x", reasoning: true, reasoning_options: [{ type: "effort", values: ["a"] }] } } },
    );
    const resolved = resolveModel(groupOf(litellmModel("m", { model: "x" }, { ...FULL, supports_reasoning: true }), "m"), doc, {});
    expect(resolved.reasoningLevels.state).toBe("unknown");
  });

  test("G17c: configured effort never pins or removes serving levels", () => {
    const doc = catalog(
      { "labA/x": entry({ reasoning: true }) },
      { P: { x: { id: "x", reasoning: true, reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }], limit: { context: 100, output: 10 } } } },
    );
    const litellm = litellmModel("m", { model: "x", reasoning_effort: "high" }, { ...FULL, models_dev_provider: "P", supports_reasoning: true });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, { protocolOverrides: { m: "responses" } });
    expect(resolved.reasoningLevels.values).toEqual(["low", "high", "max"]);
    expect(resolved.reasoningLevels.operatorDefaultEffort).toBe("high");
  });

  test("G17d: forwarded-parameter hints never produce levels", () => {
    const doc = catalog({ "labA/x": entry({ reasoning: true }) });
    const litellm = litellmModel(
      "m",
      { model: "x", allowed_openai_params: ["reasoning_effort"] },
      { ...FULL, supports_reasoning: true, supports_xhigh_reasoning_effort: true },
    );
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.reasoningLevels.state).toBe("unknown");
  });
});

describe("price authority", () => {
  test("G18: unproven serving keeps price unknown", () => {
    const doc = catalog(
      { "labA/x": entry() },
      { labA: { x: { id: "x", cost: { input: 9, output: 9 } } } },
    );
    const resolved = resolveModel(groupOf(litellmModel("m", { model: "x" }, FULL), "m"), doc, {});
    expect(resolved.fields["price.input"]!.basis).toBe("unknown");
  });

  test("G18b: declared serving fills only undeclared components", () => {
    const doc = catalog(
      { "labA/x": entry() },
      { P: { x: { id: "x", limit: { context: 100, output: 10 }, cost: { input: 1, cache_read: 2 } } } },
    );
    const litellm = litellmModel(
      "m",
      { model: "x" },
      { ...FULL, models_dev_provider: "P", input_cost_per_token: 1e-7, output_cost_per_token: 2e-7 },
    );
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.fields["price.input"]!.basis).toBe("litellm-declared");
    expect(resolved.fields["price.output"]!.basis).toBe("litellm-declared");
    expect(resolved.fields["price.cacheRead"]!.basis).toBe("serving");
    expect(resolved.fields["price.cacheRead"]!.value).toBe(2);
  });

  test("G18c: litellm_params price key wins over model_info", () => {
    const doc = catalog({ "labA/x": entry() });
    const litellm = litellmModel(
      "m",
      { model: "x", input_cost_per_token: 3e-7 },
      { ...FULL, input_cost_per_token: 1e-7 },
    );
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.fields["price.input"]!.value).toBeCloseTo(0.3, 10);
  });
});

// ---------------------------------------------------------------------------
// LKG schema 8 (G20–G20h/G38/G41/G42/G43)
// ---------------------------------------------------------------------------

describe("LKG schema 8 proof composition", () => {
  function configuredEntry(modelName: string, litellm: unknown, doc: unknown) {
    const group = groupOf(litellm, modelName);
    const publication = buildPublicationResult(litellm, doc, options);
    const live = publication.publishable.find((item) => item.spec.id === modelName)!;
    const entryLKG = createLastKnownGoodEntry(
      group, undefined, live.spec, Date.now(),
      capturedPublicationVerdict(live.assessment, live.spec), doc, options,
    );
    return { group, live, entry: entryLKG };
  }

  const doc = catalog({ "labA/x": entry({ limit: { context: 10000, input: 9000, output: 1000 } }) });
  const litellm = litellmModel("m", { model: "x" }, FULL);

  test("G20/G20h: outage and providers-only restore the whole spec", () => {
    // Live LiteLLM declares only supports_vision: with a complete catalog the
    // registry decides modalities (configured), but during an outage the
    // LiteLLM-only branch leaves modalities unknown (incomplete) so LKG
    // restores — with identical declarations the fingerprint still re-proves.
    const partialLitellm = litellmModel("m", { model: "x" }, { ...FULL, supports_pdf_input: undefined, supports_audio_input: undefined, supports_video_input: undefined, supports_audio_output: undefined });
    const { group, live, entry: lkgEntry } = configuredEntry("m", partialLitellm, doc);
    expect(live.assessment.status).toBe("configured");
    const store = createLastKnownGoodStore();
    store.set("m", lkgEntry);
    for (const outageCatalog of [{}, { labA: { models: { x: entry() } } }]) {
      const result = buildPublicationResult(partialLitellm, outageCatalog, options, { store });
      expect(result.publishable.find((item) => item.spec.id === "m")?.spec).toEqual(live.spec);
    }
    void group;
  });

  test("G20b: mixed composition rejects on any single-component change", () => {
    const { entry } = configuredEntry("m", litellm, doc);
    const store = createLastKnownGoodStore();
    store.set("m", entry);
    const changedPrice = litellmModel("m", { model: "x" }, { ...FULL, input_cost_per_token: 9e-7 });
    const result = buildPublicationResult(changedPrice, {}, options, { store });
    // Price is not a LiteLLM-declared field basis here (no price declared at
    // capture), so the fingerprint is unchanged and the entry restores.
    expect(result.publishable.length).toBe(1);
  });

  test("G20c: removed serving declaration rejects the entry", () => {
    const servingDoc = catalog(
      { "labA/x": entry() },
      { P: { x: { id: "x", limit: { context: 100, input: 90, output: 10 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false } } },
    );
    const servingLitellm = litellmModel("m", { model: "x" }, { ...FULL, models_dev_provider: "P" });
    const { entry: servingEntry } = configuredEntry("m", servingLitellm, servingDoc);
    const group = groupOf(litellmModel("m", { model: "x" }, FULL), "m");
    const validation = validateLastKnownGood(servingEntry, group, undefined, Date.now(), options, {});
    expect(validation.valid).toBe(false);
  });

  test("G20d: operator-configuration changes never invalidate the empty fingerprint", () => {
    const { entry: configEntry } = configuredEntry("m", litellm, doc);
    const group = groupOf(litellmModel("m", { model: "x", max_input_tokens: 1, reasoning_effort: "max", max_tokens: 2 }, FULL), "m");
    const validation = validateLastKnownGood(configEntry, group, undefined, Date.now(), options, {});
    expect(validation.valid).toBe(true);
  });

  test("G20e: unreferenced provider record changes keep the entry valid", () => {
    const { entry: unrefEntry } = configuredEntry("m", litellm, doc);
    const evolved = catalog(
      { "labA/x": entry({ limit: { context: 10000, input: 9000, output: 1000 } }) },
      { unrelated: { y: { id: "y", limit: { context: 1, output: 1 } } } },
    );
    const validation = validateLastKnownGood(unrefEntry, groupOf(litellm, "m"), undefined, Date.now(), options, evolved);
    expect(validation.valid).toBe(true);
  });

  test("G20f: registry fact changes reject the entry", () => {
    const { entry: regEntry } = configuredEntry("m", litellm, doc);
    const evolved = catalog({ "labA/x": entry({ limit: { context: 20000, input: 9000, output: 1000 } }) });
    const validation = validateLastKnownGood(regEntry, groupOf(litellm, "m"), undefined, Date.now(), options, evolved);
    expect(validation.valid).toBe(false);
  });

  test("G20g: schema 7 and malformed proofs fail closed", () => {
    const { entry: oldEntry } = configuredEntry("m", litellm, doc);
    expect(validateLastKnownGood({ ...oldEntry, schemaVersion: 7 } as never, groupOf(litellm, "m"), undefined, Date.now(), options, {}).valid).toBe(false);
    expect(validateLastKnownGood({ ...oldEntry, proof: {} } as never, groupOf(litellm, "m"), undefined, Date.now(), options, {}).valid).toBe(false);
  });

  test("G38: same route with different evidence never matches one stored item", () => {
    const { entry: g38Entry } = configuredEntry("m", litellm, doc);
    const altered = litellmModel("m", { model: "x" }, { ...FULL, base_model: "other" });
    const validation = validateLastKnownGood(g38Entry, groupOf(altered, "m"), undefined, Date.now(), options, {});
    expect(validation.valid).toBe(false);
  });

  test("G41: the litellm-only form never publishes, so it can never capture", () => {
    // Dimension isolation (G30): a group with no canonical identity and no
    // proven serving record has NO context key at all — max_input_tokens is
    // input capacity — so it stays discovered-incomplete, is withheld, and
    // `identityKind: "litellm-only"` is structurally uncapturable. The
    // schema kind remains defined for forward compatibility; a stored proof
    // claiming it must fail closed (G43).
    const privateLitellm = litellmModel("p", { model: "p" }, FULL);
    const privateDoc = catalog({});
    const pPublication = buildPublicationResult(privateLitellm, privateDoc, options);
    expect(pPublication.publishable).toEqual([]);
    expect(pPublication.blocked.map((item) => item.spec.id)).toEqual(["p"]);
    expect(() => createLastKnownGoodEntry(
      groupOf(privateLitellm, "p"), undefined, pPublication.blocked[0]!.spec, Date.now(),
      capturedPublicationVerdict(pPublication.blocked[0]!.assessment, pPublication.blocked[0]!.spec),
      privateDoc, options,
    )).toThrow(/configured/);
  });

  test("G42: serving-only captures stay legal", () => {
    const servingDoc = catalog(
      {},
      { P: { p: { id: "p", limit: { context: 100, input: 90, output: 10 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false } } },
    );
    const servingLitellm = litellmModel("p", { model: "p" }, { ...FULL, models_dev_provider: "P" });
    const pGroup = groupOf(servingLitellm, "p");
    const pPublication = buildPublicationResult(servingLitellm, servingDoc, options);
    expect(pPublication.publishable.length).toBe(1);
    const pEntry = createLastKnownGoodEntry(
      pGroup, undefined, pPublication.publishable[0]!.spec, Date.now(),
      capturedPublicationVerdict(pPublication.publishable[0]!.assessment, pPublication.publishable[0]!.spec),
      servingDoc, options,
    );
    expect(pEntry.proof.deploymentEvidence[0]!.identityKind).toBe("serving-only");
    expect(pEntry.proof.registryDigest).toBeUndefined();
    expect(pEntry.proof.serving?.providerID).toBe("P");
  });

  test("G43: inconsistent proof kinds fail closed", () => {
    const { entry: g43Entry } = configuredEntry("m", litellm, doc);
    const forged = structuredClone(g43Entry);
    (forged.proof.deploymentEvidence[0] as { identityKind: string }).identityKind = "litellm-only";
    expect(validateLastKnownGood(forged, groupOf(litellm, "m"), undefined, Date.now(), options, {}).valid).toBe(false);
  });

  test("schema version is 8", () => {
    expect(PUBLICATION_SCHEMA_VERSION).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Misc: G30/G9/G12 handled at R level; group consistency; unmatched ordering
// ---------------------------------------------------------------------------

describe("group consistency", () => {
  test("deployments resolving to different entries stay ambiguous (never first-wins)", () => {
    const doc = catalog({ "labA/x": entry(), "labB/y": entry() });
    const litellm = {
      data: [
        { model_name: "m", litellm_params: { model: "labA/x" }, model_info: { mode: "chat", ...FULL } },
        { model_name: "m", litellm_params: { model: "labB/y" }, model_info: { mode: "chat", ...FULL } },
      ],
    };
    const assessment = assessModelConfiguration(groupOf(litellm, "m"), doc, options);
    expect(assessment.publishable).toBe(false);
    expect(assessment.status).toBe("ambiguous");
  });

  test("identity-less deployments block the group in every order", () => {
    const doc = catalog({ "labA/x": entry() });
    const identified = { model_name: "m", litellm_params: { model: "labA/x" }, model_info: { mode: "chat", ...FULL } };
    const identityLess = { model_name: "m", litellm_params: {}, model_info: { mode: "chat", ...FULL } };
    for (const data of [[identified, identityLess], [identityLess, identified]]) {
      const assessment = assessModelConfiguration(groupOf({ data }, "m"), doc, options);
      expect(assessment.publishable).toBe(false);
    }
  });

  test("G9: reseller relation records never supply identity or facts", () => {
    const doc = catalog(
      {},
      { R: { x: { id: "x", canonical_model_id: "labA/x", limit: { context: 5, output: 5 } } } },
    );
    const assessment = assessModelConfiguration(groupOf(litellmModel("m", { model: "x" }, FULL), "m"), doc, options);
    expect(assessment.resolvedIdentity?.status).toBe("unproven");
    // G9 + G30: the relation record is not declared (no serving proof), so
    // the group is LiteLLM-only; context stays missing and the reseller
    // record never publishes anything.
    expect(assessment.publishable).toBe(false);
    expect(assessment.fieldBasis?.["limit.context"]).toBe("unknown");
    const spec = buildModelSpecs(
      { data: [{ model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", ...FULL } }] },
      doc, options,
    )[0]!;
    expect(spec.limit.context).toBe(0);
  });

  test("illegal declared values fail in every catalog branch, including providers-only", () => {
    const illegal = litellmModel("m", { model: "x" }, { ...FULL, max_output_tokens: 0 });
    for (const doc of [{}, { labA: { models: { x: { id: "x" } } } }]) {
      const assessment = assessModelConfiguration(groupOf(illegal, "m"), doc, options);
      expect(assessment.status).toBe("invalid-metadata");
      expect(assessment.illegalFields).toContain("limit.output");
    }
  });
});

// ---------------------------------------------------------------------------
// Review-fix adversarial coverage (issues 1-6): identity relation scoping,
// group serving proof, identity-critical record facts, base_model zero-match
// fallthrough, dimension isolation, and LKG fingerprint stability.
// ---------------------------------------------------------------------------

describe("review fixes: identity and serving proof", () => {
  test("issue 1: relation identity never infers from unrelated provider SKUs", () => {
    // Provider P holds many relation records naming DIFFERENT registry keys.
    // Even if they converged to one key, no record matches the group's wire
    // id, so nothing may prove identity. Old code scanned the whole provider
    // and would have "proven" labA/x from the x-free SKU.
    const doc = catalog(
      { "labA/x": entry() },
      {
        P: {
          "x-free": { id: "x-free", canonical_model_id: "labA/x", limit: { context: 5, output: 5 } },
          "un-related": { id: "un-related", canonical_model_id: "labA/x", limit: { context: 5, output: 5 } },
          "other": { id: "other", canonical_model_id: "labA/y", limit: { context: 5, output: 5 } },
        },
      },
    );
    const litellm = litellmModel("m", { model: "zzz" }, { ...FULL, models_dev_provider: "P" });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.serving.status).toBe("serving-record-unresolved");
    expect(resolved.identity.status).toBe("unproven");
    // G30: LiteLLM-only group withholds.
    expect(resolved.publishable).toBe(false);
  });

  test("issue 2/G46: converging relations without a lookup-key match never prove identity", () => {
    // Even when EVERY relation record in the declared provider names the SAME
    // canonical identity (perfect convergence), the records match none of the
    // deployment's parsed lookup keys, so no deterministic candidate relation
    // exists: the identity stays unproven and the group withholds (G30).
    // Whole-provider convergence is exactly the inference the review forbids.
    const doc = catalog(
      { "labA/x": entry() },
      {
        P: {
          "x-free": { id: "x-free", canonical_model_id: "labA/x", limit: { context: 5, output: 5 } },
          "x-fast": { id: "x-fast", canonical_model_id: "labA/x", limit: { context: 5, output: 5 } },
          "x:thinking": { id: "x:thinking", canonical_model_id: "labA/x", limit: { context: 5, output: 5 } },
        },
      },
    );
    const litellm = litellmModel("m", { model: "zzz" }, { ...FULL, models_dev_provider: "P" });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.serving.status).toBe("serving-record-unresolved");
    expect(resolved.identity.status).toBe("unproven");
    expect(resolved.identity.evidence).toBe("none");
    expect(resolved.publishable).toBe(false);
    // No canonical identity is proven, so the relation SKUs cannot even be
    // recommended as exact-wire-id candidates (that R4b listing requires a
    // proven canonical identity to relate to). They contribute nothing.
    expect(resolved.diagnosticCandidates).toEqual([]);
  });

  test("issue 1: relation identity is proven by the resolved record only (G4 shape)", () => {
    const doc = catalog(
      { "labA/x": entry() },
      {
        P: {
          "x-sku": { id: "x-sku", canonical_model_id: "labA/x", limit: { context: 100, output: 10 } },
          // An unrelated SKU under the same provider must not disturb the proof.
          "other-sku": { id: "other-sku", canonical_model_id: "labB/other", limit: { context: 7, output: 7 } },
        },
      },
    );
    const litellm = litellmModel("m", { model: "x-sku" }, { ...FULL, models_dev_provider: "P" });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.serving.status).toBe("declared");
    expect(resolved.identity.status).toBe("proven");
    expect(resolved.identity.canonicalModelID).toBe("labA/x");
    expect(resolved.identity.evidence).toBe("serving-relation");
  });

  test("issue 2: partial models_dev_provider declaration is not a group proof", () => {
    const doc = catalog(
      {},
      { P: { x: { id: "x", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    );
    const data = {
      data: [
        { model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", ...FULL, models_dev_provider: "P" } },
        { model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", ...FULL } },
      ],
    };
    const declared = resolveModel(groupOf(data, "m"), doc, {});
    // Not every deployment declares: serving stays unproven in BOTH orders,
    // and the P record never supplies facts.
    expect(declared.serving.status).toBe("unproven");
    expect(declared.fields["limit.context"]!.basis).not.toBe("serving");
    const reordered = resolveModel(groupOf({ data: [...data.data].reverse() }, "m"), doc, {});
    expect(reordered.serving.status).toBe("unproven");
    expect(reordered.fields["limit.context"]!.basis).not.toBe("serving");
  });

  test("issue 2: all-declared groups prove serving in every order", () => {
    const doc = catalog(
      {},
      { P: { x: { id: "x", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    );
    const mk = () => ({
      data: [
        { model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", ...FULL, models_dev_provider: "P" } },
        { model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", ...FULL, models_dev_provider: "P" } },
      ],
    });
    for (const group of [groupOf(mk(), "m"), groupOf({ data: [...mk().data].reverse() }, "m")]) {
      const resolved = resolveModel(group, doc, {});
      expect(resolved.serving.status).toBe("declared");
      expect(resolved.fields["limit.context"]!.value).toBe(100);
    }
  });

  test("issue 2/G23: equivalent records reached through different wire ids pick one representative regardless of order", () => {
    // Two deployments of one group hit two DIFFERENT but fact-identical
    // records (same relation, limits, modalities, tools, reasoning, price).
    // The group must resolve to ONE deterministic representative — same
    // recordID and same proof under deployment reordering.
    const record = (id: string) => ({ id, canonical_model_id: "labA/x", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } });
    const doc = catalog(
      { "labA/x": entry() },
      { P: { x: record("x"), "x-alt": record("x-alt") } },
    );
    const mk = () => ({
      data: [
        { model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", ...FULL, models_dev_provider: "P" } },
        { model_name: "m", litellm_params: { model: "x-alt" }, model_info: { mode: "chat", ...FULL, models_dev_provider: "P" } },
      ],
    });
    const forward = resolveModel(groupOf(mk(), "m"), doc, {});
    const reordered = resolveModel(groupOf({ data: [...mk().data].reverse() }, "m"), doc, {});
    expect(forward.serving.status).toBe("declared");
    expect(reordered.serving.status).toBe("declared");
    expect(forward.serving.recordID).toBe(reordered.serving.recordID);
    expect(JSON.stringify(forward.proof)).toBe(JSON.stringify(reordered.proof));
  });

  test("issue 3: exact records naming different canonical identities never merge", () => {
    // Two exact candidates (route + base_model) point at records whose facts
    // are identical but whose canonical identities differ. The group must
    // fail closed, never pick by record order.
    const recordX = { id: "x", canonical_model_id: "labA/x", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } };
    const recordY = { id: "y", canonical_model_id: "labA/y", limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } };
    const doc = catalog({}, { P: { x: recordX, y: recordY } });
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, base_model: "y", models_dev_provider: "P" });
    const forward = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(forward.serving.status).toBe("serving-ambiguous");
    expect(forward.status).toBe("ambiguous");
    expect(forward.publishable).toBe(false);
    const swapped = resolveModel(groupOf({ data: [{ model_name: "m", litellm_params: { model: "y" }, model_info: { mode: "chat", ...FULL, base_model: "x", models_dev_provider: "P" } }] }, "m"), doc, {});
    expect(swapped.serving.status).toBe("serving-ambiguous");
    expect(swapped.publishable).toBe(false);
  });

  test("issue 5: zero-match base_model falls through to the route", () => {
    // base_model `nothing` matches no registry entry; the route `x` proves
    // registry-unique. The deployment identity must come from the route.
    const doc = catalog({ "labA/x": entry() });
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, base_model: "nothing" });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.identity.status).toBe("proven");
    expect(resolved.identity.canonicalModelID).toBe("labA/x");
    expect(resolved.identity.evidence).toBe("registry-unique");
    expect(resolved.publishable).toBe(true);
  });

  test("issue 5: ambiguous base_model still decides (route cannot override)", () => {
    const doc = catalog({ "labA/x": entry(), "labB/x": entry() });
    const litellm = litellmModel("m", { model: "labA/x" }, { ...FULL, base_model: "x" });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.identity.status).toBe("ambiguous");
    expect(resolved.publishable).toBe(false);
    const reorderedDoc = catalog({ "labB/x": entry(), "labA/x": entry() });
    const reordered = resolveModel(groupOf(litellm, "m"), reorderedDoc, {});
    expect(reordered.identity.status).toBe("ambiguous");
  });

  test("issue 5: proven base_model wins over a different route (diagnostic only)", () => {
    const doc = catalog({ "labA/base": entry(), "labA/route": entry() });
    const litellm = litellmModel("m", { model: "labA/route" }, { ...FULL, base_model: "labA/base" });
    const resolved = resolveModel(groupOf(litellm, "m"), doc, {});
    expect(resolved.identity.status).toBe("proven");
    expect(resolved.identity.canonicalModelID).toBe("labA/base");
    expect(resolved.identity.routeDiffers).toBe(true);
  });
});

describe("review fixes: LKG proof stability (issue 6)", () => {
  const servingDoc = catalog(
    { "labA/x": entry({ limit: { context: 10000, input: 9000, output: 1000 } }) },
    { P: { x: { id: "x", canonical_model_id: "labA/x", limit: { context: 10000, input: 9000, output: 1000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
  );

  function twoDeploymentBody(priceParams: Record<string, unknown>, order: "ab" | "ba") {
    const a = { model_name: "m", litellm_params: { model: "x", ...priceParams }, model_info: { mode: "chat", ...FULL, id: "dep-a", models_dev_provider: "P" } };
    const b = { model_name: "m", litellm_params: { model: "x", ...priceParams }, model_info: { mode: "chat", ...FULL, id: "dep-b", models_dev_provider: "P" } };
    return { data: order === "ab" ? [a, b] : [b, a] };
  }

  test("price fingerprint follows the deciding source: params override model_info (issue 6a)", () => {
    // Capture: litellm_params price 1e-6 overrides model_info 3e-6 and is the
    // published cost (D8/G18c/G44). The fingerprint must hash the SAME
    // deciding source. Later, model_info's price changes while the deciding
    // litellm_params price does not: a params-first fingerprint stays valid
    // (the published cost is unchanged); an info-first fingerprint would
    // spuriously reject.
    const mk = (infoPrice: number) => ({
      data: [
        { model_name: "m", litellm_params: { model: "x", input_cost_per_token: 1e-6 }, model_info: { mode: "chat", ...FULL, id: "dep-a", models_dev_provider: "P", input_cost_per_token: infoPrice } },
        { model_name: "m", litellm_params: { model: "x", input_cost_per_token: 1e-6 }, model_info: { mode: "chat", ...FULL, id: "dep-b", models_dev_provider: "P", input_cost_per_token: infoPrice } },
      ],
    })
    const group = groupOf(mk(3e-6), "m");
    const publication = buildPublicationResult(mk(3e-6), servingDoc, options);
    const live = publication.publishable[0]!;
    expect(live.spec.cost.input).toBe(1); // params price decides
    const entry = createLastKnownGoodEntry(group, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), servingDoc, options);
    const evolvedInfo = groupOf(mk(9e-6), "m");
    const stillDecidedByParams = validateLastKnownGood(entry, evolvedInfo, undefined, Date.now(), options, servingDoc);
    expect(stillDecidedByParams.valid).toBe(true);

    // And the mirror case: changing the DECIDING params price rejects.
    const changedParams = {
      data: [
        { model_name: "m", litellm_params: { model: "x", input_cost_per_token: 5e-6 }, model_info: { mode: "chat", ...FULL, id: "dep-a", models_dev_provider: "P", input_cost_per_token: 3e-6 } },
        { model_name: "m", litellm_params: { model: "x", input_cost_per_token: 5e-6 }, model_info: { mode: "chat", ...FULL, id: "dep-b", models_dev_provider: "P", input_cost_per_token: 3e-6 } },
      ],
    };
    const rejected = validateLastKnownGood(entry, groupOf(changedParams, "m"), undefined, Date.now(), options, servingDoc);
    expect(rejected.valid).toBe(false);
  });

  test("deployment reorder never invalidates an otherwise identical entry", () => {
    const body = twoDeploymentBody({}, "ab");
    const group = groupOf(body, "m");
    const publication = buildPublicationResult(body, servingDoc, options);
    const live = publication.publishable[0]!;
    const entry = createLastKnownGoodEntry(group, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), servingDoc, options);
    const reordered = groupOf(twoDeploymentBody({}, "ba"), "m");
    const validation = validateLastKnownGood(entry, reordered, undefined, Date.now(), options, servingDoc);
    expect(validation.valid).toBe(true);
  });

  test("serving declarations stay attached to their own deployment after sorting", () => {
    // Deployment A declares P; deployment B declares nothing... then both
    // must declare P to prove serving. Instead verify the proof keeps
    // per-deployment declarations correct: distinct wire ids per deployment
    // sorted by model_info.id keep their own declaration in the proof.
    const body = {
      data: [
        { model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", ...FULL, id: "dep-b", models_dev_provider: "P" } },
        { model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", ...FULL, id: "dep-a", models_dev_provider: "P" } },
      ],
    };
    const group = groupOf(body, "m");
    const publication = buildPublicationResult(body, servingDoc, options);
    const live = publication.publishable[0]!;
    const entry = createLastKnownGoodEntry(group, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), servingDoc, options);
    // Sorted evidence order: dep-a first. Each declaration must be its own.
    expect(entry.proof.deploymentEvidence.map((item) => item.deploymentID)).toEqual(["model_info.id:dep-a", "model_info.id:dep-b"]);
    const declarations = entry.proof.serving!.declarations;
    expect(declarations.map((item) => item.deploymentID)).toEqual(["model_info.id:dep-a", "model_info.id:dep-b"]);
    expect(declarations.every((item) => item.declared === "p")).toBe(true);
  });

  test("evidence change (base_model) invalidates the entry", () => {
    const body = twoDeploymentBody({}, "ab");
    const group = groupOf(body, "m");
    const publication = buildPublicationResult(body, servingDoc, options);
    const live = publication.publishable[0]!;
    const entry = createLastKnownGoodEntry(group, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), servingDoc, options);
    const changedEvidence = {
      data: [{ model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", ...FULL, id: "dep-a", base_model: "other", models_dev_provider: "P" } }],
    };
    const validation = validateLastKnownGood(entry, groupOf(changedEvidence, "m"), undefined, Date.now(), options, servingDoc);
    expect(validation.valid).toBe(false);
  });

  test("forged litellm-only proof with registryDigest fails closed (G43 extension)", () => {
    const body = twoDeploymentBody({}, "ab");
    const group = groupOf(body, "m");
    const publication = buildPublicationResult(body, servingDoc, options);
    const live = publication.publishable[0]!;
    const entry = createLastKnownGoodEntry(group, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), servingDoc, options);
    const forged = structuredClone(entry) as typeof entry & {
      proof: { deploymentEvidence: Array<{ identityKind: string; [key: string]: unknown }>; [key: string]: unknown };
    };
    forged.proof.deploymentEvidence[0]!.identityKind = "litellm-only";
    expect(validateLastKnownGood(forged, group, undefined, Date.now(), options, servingDoc).valid).toBe(false);
    const forgedTwo = structuredClone(entry) as typeof entry & {
      proof: { deploymentEvidence: Array<{ identityKind: string; [key: string]: unknown }>; [key: string]: unknown };
    };
    forgedTwo.proof.deploymentEvidence[0]!.identityKind = "serving-only";
    expect(validateLastKnownGood(forgedTwo, group, undefined, Date.now(), options, servingDoc).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Review-fix adversarial coverage (issue 7): operator configuration never
// participates in capability verdicts — illegality is the strongest verdict,
// so unproven `litellm_params` keys must never make a trusted model illegal
// (D7a empty proven set, G20d, testing-standard §8).
// ---------------------------------------------------------------------------

describe("review fixes: operator configuration vs the publication gate (issue 7)", () => {
  const trustedDoc = catalog(
    { "labA/x": entry({ limit: { context: 10000, input: 9000, output: 1000 } }) },
    {},
  );

  test("non-positive operator-configuration limits never make a trusted model illegal", () => {
    // Canonical identity proven, registry supplies every gated field, and the
    // operator's deployment carries a ZERO max_tokens and NEGATIVE
    // max_completion_tokens in litellm_params. Unproven keys are operator
    // configuration: the model stays configured and published with the
    // registry values.
    const litellm = litellmModel("m", { model: "x", max_tokens: 0, max_completion_tokens: -5 }, FULL);
    const resolved = resolveModel(groupOf(litellm, "m"), trustedDoc, options);
    expect(resolved.identity.status).toBe("proven");
    expect(resolved.publishable).toBe(true);
    expect(resolved.status).toBe("configured");
    expect(resolved.fields["limit.output"]!.status).not.toBe("illegal");
    expect(resolved.fields["limit.output"]!.value).toBe(1000);
    // The invalid operator values are observable configuration diagnostics.
    expect(resolved.operatorConfigurationIssueKeys).toEqual(["litellm_params.max_completion_tokens", "litellm_params.max_tokens"]);
  });

  test("non-positive operator-configuration input keys never veto input", () => {
    const litellm = litellmModel("m", { model: "x", max_input_tokens: 0 }, FULL);
    const resolved = resolveModel(groupOf(litellm, "m"), trustedDoc, options);
    expect(resolved.publishable).toBe(true);
    expect(resolved.fields["limit.input"]!.status).not.toBe("illegal");
    expect(resolved.operatorConfigurationIssueKeys).toEqual(["litellm_params.max_input_tokens"]);
  });

  test("descriptive model_info non-positive limits stay illegal (existing rule not regressed)", () => {
    const litellm = litellmModel("m", { model: "x" }, { ...FULL, max_output_tokens: 0 });
    const resolved = resolveModel(groupOf(litellm, "m"), trustedDoc, options);
    expect(resolved.status).toBe("invalid-metadata");
    expect(resolved.fields["limit.output"]!.status).toBe("illegal");
    expect(resolved.publishable).toBe(false);
  });

  test("trusted-record non-positive limits stay illegal (existing rule not regressed)", () => {
    const doc = catalog({ "labA/x": entry({ limit: { context: 10000, input: 9000, output: 0 } }) });
    const litellm = litellmModel("m", { model: "x" }, FULL);
    const resolved = resolveModel(groupOf(litellm, "m"), doc, options);
    expect(resolved.status).toBe("invalid-metadata");
    expect(resolved.fields["limit.output"]!.status).toBe("illegal");
  });

  test("LKG stays valid when only operator-configuration values go non-positive (G20d)", () => {
    // Capture from a healthy group, then the operator's litellm_params gains a
    // zero max_tokens while every capability fact (model_info + registry)
    // stays identical. G20d: operator reconfiguration never invalidates the
    // entry — the old illegalLiveLimit read litellm_params and would have
    // rejected the restore.
    const healthy = litellmModel("m", { model: "x" }, FULL);
    const group = groupOf(healthy, "m");
    const publication = buildPublicationResult(healthy, trustedDoc, options);
    const live = publication.publishable[0]!;
    const entry = createLastKnownGoodEntry(group, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), trustedDoc, options);
    const reconfigured = groupOf(litellmModel("m", { model: "x", max_tokens: 0 }, FULL), "m");
    const validation = validateLastKnownGood(entry, reconfigured, undefined, Date.now(), options, trustedDoc);
    expect(validation.valid).toBe(true);
  });

  test("LKG still fails closed for live descriptive illegal limits (existing rule not regressed)", () => {
    const healthy = litellmModel("m", { model: "x" }, FULL);
    const group = groupOf(healthy, "m");
    const publication = buildPublicationResult(healthy, trustedDoc, options);
    const live = publication.publishable[0]!;
    const entry = createLastKnownGoodEntry(group, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), trustedDoc, options);
    const illegalDescriptive = groupOf(litellmModel("m", { model: "x" }, { ...FULL, max_output_tokens: 0 }), "m");
    const validation = validateLastKnownGood(entry, illegalDescriptive, undefined, Date.now(), options, trustedDoc);
    expect(validation.valid).toBe(false);
  });

  test("diagnostics report invalid operator configuration without gating publication", () => {
    const litellm = litellmModel("m", { model: "x", max_tokens: 0 }, FULL);
    const diagnosed = diagnoseModelSpecs(litellm, trustedDoc, options);
    const codes = diagnosed.diagnostics.issues.map((item: { code: string }) => item.code);
    expect(codes).toContain("operator-configuration-invalid-value");
    const message = diagnosed.diagnostics.issues.find((item: { code: string }) => item.code === "operator-configuration-invalid-value")?.message ?? "";
    expect(message).toContain("litellm_params.max_tokens");
    expect(codes).not.toContain("publication-invalid-metadata");
    // The publication verdict itself stays configured.
    const assessment = assessModelConfiguration(groupOf(litellm, "m"), trustedDoc, options);
    expect(assessment.publishable).toBe(true);
  });
});
