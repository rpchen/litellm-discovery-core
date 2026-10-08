/**
 * Acceptance: R1–R11 real regressions + G-matrix (adopt-modelsdev-canonical-catalog).
 *
 * Every row maps to at least one automated test (testing-standard §1).
 * `R*` use trimmed real-schema fixtures mirroring the live catalog rows
 * named in `acceptance.md`; `G*` use synthetic real-schema catalogs.
 * No model allow-lists: `R*` are instances of the `G*` rules.
 *
 * Behavior-change tests (design Risks; must not be reverted without a
 * delta): R4/R4b/R4c (DeepSeek 384000/393216 serving-SKU proof), R6
 * (kimi-k3 131072), R9b (operator-configured effort yields no levels).
 */
import { describe, expect, test } from "bun:test";
import { groupLiteLLMDeployments } from "../src/core/litellm.ts";
import { resolveModel } from "../src/core/resolve.ts";
import {
  assessModelConfiguration,
  buildPublicationResult,
  capturedPublicationVerdict,
  createLastKnownGoodEntry,
  createLastKnownGoodStore,
  resolveConfigurationWithLKG,
  validateLastKnownGood,
  PUBLICATION_SCHEMA_VERSION,
} from "../src/core/publication.ts";
import { buildModelSpecs } from "../src/core/build.ts";
import { diagnoseModelSpecs } from "../src/core/diagnostics.ts";
import {
  HY3_CATALOG,
  HY3_LITELLM,
  R1_CATALOG,
  R1_LITELLM,
  R10_CATALOG,
  R10_LITELLM_BARE,
  R10_LITELLM_COMPLETE,
  R11_CATALOG,
  R11_LITELLM,
  R2_CATALOG,
  R2_LITELLM,
  R3_CATALOG,
  R3_LITELLM,
  R4_CATALOG,
  R4_LITELLM,
  R5_CATALOG,
  R5_LITELLM,
  R6_CATALOG,
  R6_LITELLM,
  R7_CATALOG,
  R7_LITELLM,
  R8_CATALOG,
  R8_LITELLM,
  R9_CATALOG,
  R9_LITELLM,
  R9B_CATALOG,
  R9B_LITELLM,
} from "./fixtures/canonical-catalog-fixtures.ts";

const options = { contextTierCap: false, protocolOverrides: {} };

function groupOf(litellm: unknown, modelName: string) {
  const group = groupLiteLLMDeployments(litellm).find((item) => item.modelName === modelName);
  if (!group) throw new Error(`no group ${modelName}`);
  return group;
}

function assessed(litellm: unknown, catalog: unknown, modelName: string) {
  const group = groupOf(litellm, modelName);
  return { group, assessment: assessModelConfiguration(group, catalog, options) };
}

// ---------------------------------------------------------------------------
// R — real regressions
// ---------------------------------------------------------------------------

describe("R1 mimo-v2.6-pro", () => {
  test("canonical identity, LiteLLM input fill, OpenRouter ignored, price from LiteLLM", () => {
    const { assessment } = assessed(R1_LITELLM(), R1_CATALOG, "mimo-v2.6-pro");
    expect(assessment.publishable).toBe(true);
    expect(assessment.status).toBe("configured");
    expect(assessment.resolvedIdentity?.canonicalModelID).toBe("xiaomi/mimo-v2.6-pro");
    expect(assessment.resolvedServing?.status).toBe("unproven");
    expect(assessment.context.value).toBe(1048576);
    expect(assessment.fieldBasis?.["limit.context"]).toBe("canonical");
    expect(assessment.fieldBasis?.["limit.input"]).toBe("litellm-declared");
    const spec = buildModelSpecs(R1_LITELLM(), R1_CATALOG, options)[0]!;
    expect(spec.limit).toEqual({ context: 1048576, input: 1048576, output: 131072 });
    expect(spec.cost.input).toBeCloseTo(0.2, 10);
    // The unproven OpenRouter 1050000 never appears.
    expect(spec.limit.context).not.toBe(1050000);
    expect(assessment.discrepancies.length).toBe(0);
  });
});

describe("R2 mimo-v2.6-flash", () => {
  test("free variant never selected nor listed (wire id differs)", () => {
    const litellm = R2_LITELLM();
    const { group, assessment } = assessed(litellm, R2_CATALOG, "mimo-v2.6-flash");
    expect(assessment.publishable).toBe(true);
    const resolved = resolveModel(group, R2_CATALOG, {});
    expect(resolved.diagnosticCandidates.some((item) => item.recordID.includes("free"))).toBe(false);
    const spec = buildModelSpecs(litellm, R2_CATALOG, options)[0]!;
    expect(spec.limit.context).toBe(1048576);
    expect(spec.variants).toEqual([]);
  });
});

describe("R3 MiniMax-M3", () => {
  test("A: serving unproven — canonical limits, LiteLLM input fill, reseller diagnostic only", () => {
    const litellm = R3_LITELLM();
    const { group, assessment } = assessed(litellm, R3_CATALOG, "minimax-m3");
    expect(assessment.publishable).toBe(true);
    expect(assessment.resolvedIdentity?.canonicalModelID).toBe("minimax/MiniMax-M3");
    const spec = buildModelSpecs(litellm, R3_CATALOG, options)[0]!;
    expect(spec.limit).toEqual({ context: 1048576, input: 1000000, output: 512000 });
    expect(assessment.fieldBasis?.["limit.input"]).toBe("litellm-declared");
    expect(assessment.discrepancies.some((item) => item.field === "limit.output")).toBe(true);
    const resolved = resolveModel(group, R3_CATALOG, {});
    expect(resolved.reasoningLevels).toMatchObject({ state: "unknown", values: [] });
    expect(resolved.diagnosticCandidates.some((item) => item.providerID === "opencode")).toBe(true);
  });

  test("B: models_dev_provider minimax — serving override, toggle levels", () => {
    const litellm = R3_LITELLM({ models_dev_provider: "minimax" });
    const { assessment } = assessed(litellm, R3_CATALOG, "minimax-m3");
    expect(assessment.publishable).toBe(true);
    expect(assessment.resolvedServing?.status).toBe("declared");
    expect(assessment.fieldBasis?.["limit.context"]).toBe("serving");
    const spec = buildModelSpecs(litellm, R3_CATALOG, options)[0]!;
    expect(spec.limit).toEqual({ context: 1000000, input: 1000000, output: 512000 });
    expect(assessment.reasoning.levelsKnown).toBe(true);
    expect(assessment.reasoning.levels).toEqual([]);
    expect(spec.cost.cacheRead).toBe(0.06);
  });

  test("C: models_dev_provider opencode — third-party serving, input absence filled by LiteLLM", () => {
    const litellm = R3_LITELLM({ models_dev_provider: "opencode" });
    const { assessment } = assessed(litellm, R3_CATALOG, "minimax-m3");
    expect(assessment.publishable).toBe(true);
    const spec = buildModelSpecs(litellm, R3_CATALOG, options)[0]!;
    expect(spec.limit).toEqual({ context: 512000, input: 1000000, output: 128000 });
    // Serving omits limit.input: same-dimension LiteLLM fill, never canonical refill.
    expect(assessment.fieldBasis?.["limit.input"]).toBe("litellm-declared");
  });

  test("D: litellm_params max_input_tokens/max_tokens are operator configuration — no narrowing", () => {
    const litellm = R3_LITELLM(
      {},
      { max_input_tokens: 900000, max_tokens: 65536 },
    );
    const { group, assessment } = assessed(litellm, R3_CATALOG, "minimax-m3");
    expect(assessment.publishable).toBe(true);
    const spec = buildModelSpecs(litellm, R3_CATALOG, options)[0]!;
    expect(spec.limit).toEqual({ context: 1048576, input: 1000000, output: 512000 });
    const resolved = resolveModel(group, R3_CATALOG, {});
    expect(resolved.operatorConfigurationKeys).toContain("litellm_params.max_input_tokens");
    expect(resolved.operatorConfigurationKeys).toContain("litellm_params.max_tokens");
    expect(assessment.discrepancies.length).toBe(1);
    expect(assessment.discrepancies[0]!.field).toBe("limit.output");
  });
});

describe("R4 DeepSeek v4.1-flash (behavior change: design Risks)", () => {
  test("A: serving unproven — canonical 384000, levels unknown", () => {
    // Behavior change (design Risks): the previously frozen 393216 is a
    // serving-SKU value, available only with serving proof. Do not revert
    // without an OpenSpec delta.
    const litellm = R4_LITELLM();
    const { group, assessment } = assessed(litellm, R4_CATALOG, "deepseek-v4.1-flash");
    expect(assessment.publishable).toBe(true);
    const spec = buildModelSpecs(litellm, R4_CATALOG, options)[0]!;
    expect(spec.limit.output).toBe(384000);
    const resolved = resolveModel(group, R4_CATALOG, {});
    expect(resolved.reasoningLevels.state).toBe("unknown");
    expect(spec.variants).toEqual([]);
  });

  test("B: provider proven but SKU unresolved — still canonical 384000", () => {
    const litellm = R4_LITELLM({ models_dev_provider: "deepseek" });
    const { group, assessment } = assessed(litellm, R4_CATALOG, "deepseek-v4.1-flash");
    expect(assessment.publishable).toBe(true);
    expect(assessment.resolvedServing?.status).toBe("serving-record-unresolved");
    const spec = buildModelSpecs(litellm, R4_CATALOG, options)[0]!;
    expect(spec.limit.output).toBe(384000);
    const resolved = resolveModel(group, R4_CATALOG, {});
    expect(resolved.reasoningLevels.state).toBe("unknown");
    expect(resolved.diagnosticCandidates.length).toBe(3);
  });

  test("C: provider + exact SKU proven — serving 393216", () => {
    // A/B/C differ ONLY in serving-SKU proof. Do not revert without a delta.
    const litellm = R4_LITELLM(
      { models_dev_provider: "deepseek" },
      { model: "deepseek/deepseek-flash", custom_llm_provider: "deepseek" },
    );
    const { assessment } = assessed(litellm, R4_CATALOG, "deepseek-v4.1-flash");
    expect(assessment.publishable).toBe(true);
    expect(assessment.resolvedServing?.status).toBe("declared");
    expect(assessment.resolvedServing?.recordID).toBe("deepseek-flash");
    const spec = buildModelSpecs(litellm, R4_CATALOG, options)[0]!;
    expect(spec.limit.output).toBe(393216);
    expect(spec.limit.input).toBe(1000000);
    expect(assessment.fieldBasis?.["limit.input"]).toBe("litellm-declared");
    expect(assessment.reasoning.levels).toEqual(["low", "high", "max"]);
  });
});

describe("R5 glm-5.3-flash", () => {
  test("serving unproven — modalities from registry, levels unknown", () => {
    const litellm = R5_LITELLM();
    const { assessment } = assessed(litellm, R5_CATALOG, "glm-5.3-flash");
    expect(assessment.publishable).toBe(true);
    const spec = buildModelSpecs(litellm, R5_CATALOG, options)[0]!;
    expect(spec.capabilities.input).toEqual(["text", "image"]);
    expect(spec.variants).toEqual([]);
    expect(assessment.reasoning.levelsKnown).toBe(false);
  });
});

describe("R6 kimi-k3 (behavior change: design Risks)", () => {
  test("serving unproven — canonical output 131072, not the first-party serving 1048576", () => {
    const litellm = R6_LITELLM();
    const { assessment } = assessed(litellm, R6_CATALOG, "kimi-k3");
    expect(assessment.publishable).toBe(true);
    const spec = buildModelSpecs(litellm, R6_CATALOG, options)[0]!;
    expect(spec.limit.output).toBe(131072);
    expect(assessment.discrepancies.some((item) => item.field === "limit.output")).toBe(true);
  });

  test("models_dev_provider moonshotai — serving 1048576 with levels", () => {
    const litellm = R6_LITELLM({ models_dev_provider: "moonshotai" });
    const { assessment } = assessed(litellm, R6_CATALOG, "kimi-k3");
    expect(assessment.publishable).toBe(true);
    const spec = buildModelSpecs(litellm, R6_CATALOG, options)[0]!;
    expect(spec.limit).toEqual({ context: 1048576, input: 1048576, output: 1048576 });
    expect(assessment.reasoning.levels).toEqual(["low", "high", "max"]);
  });
});

describe("R7 hy4-preview", () => {
  test("lab without provider — canonical limits, LiteLLM price, no reseller facts", () => {
    const litellm = R7_LITELLM();
    const { assessment } = assessed(litellm, R7_CATALOG, "hy4-preview");
    expect(assessment.publishable).toBe(true);
    const spec = buildModelSpecs(litellm, R7_CATALOG, options)[0]!;
    expect(spec.limit).toEqual({ context: 1024000, input: 1024000, output: 64000 });
    expect(spec.cost.input).toBeCloseTo(0.1, 10);
    expect(spec.variants).toEqual([]);
  });
});

describe("R8 kimi-k2.7-code", () => {
  test("base_model wins; route difference is diagnostic only", () => {
    const litellm = R8_LITELLM();
    const { group, assessment } = assessed(litellm, R8_CATALOG, "kimi-k2.7-code");
    expect(assessment.publishable).toBe(true);
    expect(assessment.resolvedIdentity?.canonicalModelID).toBe("minimax/MiniMax-M2.7");
    const resolved = resolveModel(group, R8_CATALOG, {});
    expect(resolved.identity.routeDiffers).toBe(true);
    const spec = buildModelSpecs(litellm, R8_CATALOG, options)[0]!;
    expect(spec.limit).toEqual({ context: 204800, input: 204800, output: 131072 });
  });
});

describe("R9 gpt-5.6-sol", () => {
  test("exact qualified identity; no cross-dimension discrepancy", () => {
    const litellm = R9_LITELLM();
    const { assessment } = assessed(litellm, R9_CATALOG, "gpt-5.6-sol");
    expect(assessment.publishable).toBe(true);
    expect(assessment.resolvedIdentity?.canonicalModelID).toBe("openai/gpt-5.6-sol");
    const spec = buildModelSpecs(litellm, R9_CATALOG, options)[0]!;
    expect(spec.limit).toEqual({ context: 1050000, input: 922000, output: 128000 });
    expect(assessment.discrepancies.length).toBe(0);
  });
});

describe("R9b gpt-6-luna (behavior change: design Risks)", () => {
  test("operator-configured reasoning_effort yields no levels and pins nothing", () => {
    // Behavior change: the previously published 6 levels (including the
    // request-overridable default) are gone while serving is unproven.
    const litellm = R9B_LITELLM();
    const { group, assessment } = assessed(litellm, R9B_CATALOG, "gpt-6-luna");
    expect(assessment.publishable).toBe(true);
    const resolved = resolveModel(group, R9B_CATALOG, {});
    expect(resolved.reasoningLevels.state).toBe("unknown");
    expect(resolved.reasoningLevels.operatorDefaultEffort).toBe("max");
    const spec = buildModelSpecs(litellm, R9B_CATALOG, options)[0]!;
    expect(spec.variants).toEqual([]);
  });
});

describe("R10 unregistered private model", () => {
  test("same-name reseller records withheld as diagnostic candidates only", () => {
    const litellm = R10_LITELLM_BARE();
    const { group, assessment } = assessed(litellm, R10_CATALOG, "acme-private-1");
    expect(assessment.publishable).toBe(false);
    const resolved = resolveModel(group, R10_CATALOG, {});
    expect(resolved.diagnosticCandidates.map((item) => item.providerID)).toEqual(["opencode", "openrouter"]);
  });

  test("complete LiteLLM declarations publish as litellm-declared", () => {
    const litellm = R10_LITELLM_COMPLETE();
    const { assessment } = assessed(litellm, R10_CATALOG, "acme-private-1");
    expect(assessment.publishable).toBe(true);
    expect(assessment.fieldBasis?.["limit.context"]).toBe("litellm-declared");
    const spec = buildModelSpecs(litellm, R10_CATALOG, options)[0]!;
    expect(spec.limit.context).toBe(50000);
    // Reseller values never appear.
    expect(spec.limit.context).not.toBe(100000);
    expect(spec.limit.context).not.toBe(200000);
  });

  test("declared serving record publishes as serving", () => {
    const litellm = R10_LITELLM_COMPLETE({ models_dev_provider: "opencode" });
    const { assessment } = assessed(litellm, R10_CATALOG, "acme-private-1");
    expect(assessment.publishable).toBe(true);
    expect(assessment.resolvedServing?.status).toBe("declared");
    expect(assessment.fieldBasis?.["limit.context"]).toBe("serving");
    const spec = buildModelSpecs(litellm, R10_CATALOG, options)[0]!;
    expect(spec.limit.context).toBe(100000);
  });
});

describe("R11 private LiteLLM-only", () => {
  test("complete LiteLLM declarations publish as litellm-declared", () => {
    const litellm = R11_LITELLM();
    const { assessment } = assessed(litellm, R11_CATALOG, "acme-private-2");
    expect(assessment.publishable).toBe(true);
    const spec = buildModelSpecs(litellm, R11_CATALOG, options)[0]!;
    expect(spec.limit).toEqual({ context: 32000, input: 32000, output: 8000 });
  });
});

describe("hy3 base_model_omit (G28)", () => {
  test("serving omission is never refilled from canonical; LiteLLM fills the gap", () => {
    const litellm = HY3_LITELLM();
    const info = { models_dev_provider: "requesty" };
    const litellmDeclared = HY3_LITELLM({ ...info });
    const { assessment } = assessed(litellmDeclared, HY3_CATALOG, "hy3");
    expect(assessment.publishable).toBe(true);
    expect(assessment.fieldBasis?.["limit.input"]).toBe("litellm-declared");
    const spec = buildModelSpecs(litellmDeclared, HY3_CATALOG, options)[0]!;
    expect(spec.limit.input).toBe(192000);
  });

  test("serving omission without LiteLLM fill stays unknown, never canonical", () => {
    const litellm = {
      data: [
        {
          model_name: "hy3",
          litellm_params: { model: "hy3" },
          model_info: {
            mode: "chat",
            base_model: "tencent/hy3",
            models_dev_provider: "requesty",
            max_output_tokens: 32000,
            supports_function_calling: true,
            supports_reasoning: false,
          },
        },
      ],
    };
    const { assessment } = assessed(litellm, HY3_CATALOG, "hy3");
    expect(assessment.fieldBasis?.["limit.input"]).toBe("unknown");
    const spec = buildModelSpecs(litellm, HY3_CATALOG, options)[0]!;
    // Canonical 192000 is never refilled; the model still publishes (input is not gated).
    expect(spec.limit.input).toBe(0);
    expect(assessment.publishable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// G22 single-resolver invariant + G23 determinism
// ---------------------------------------------------------------------------

describe("G22 single resolution result", () => {
  test("buildModelSpecs equals diagnostics models; capture stores the same facts", () => {
    const litellm = R3_LITELLM();
    const built = buildModelSpecs(litellm, R3_CATALOG, options);
    const diagnosed = diagnoseModelSpecs(litellm, R3_CATALOG, options);
    expect(diagnosed.models).toEqual(built);
    const group = groupOf(litellm, "minimax-m3");
    const store = createLastKnownGoodStore();
    const publication = buildPublicationResult(litellm, R3_CATALOG, options, { store });
    expect(publication.publishable.length).toBe(1);
    const entry = createLastKnownGoodEntry(
      group,
      undefined,
      publication.publishable[0]!.spec,
      Date.now(),
      capturedPublicationVerdict(publication.publishable[0]!.assessment, publication.publishable[0]!.spec),
      R3_CATALOG,
      options,
    );
    expect(entry.spec).toEqual(publication.publishable[0]!.spec);
  });
});

describe("G23 determinism", () => {
  test("catalog key order and deployment order never change the verdict", () => {
    const litellm = {
      data: [
        {
          model_name: "minimax-m3",
          litellm_params: { model: "minimax-m3" },
          model_info: { mode: "chat", base_model: "minimax-m3", max_input_tokens: 1000000, max_output_tokens: 131072, supports_function_calling: true, supports_reasoning: true, supports_vision: true },
        },
        {
          model_name: "minimax-m3",
          litellm_params: { model: "minimax/MiniMax-M3" },
          model_info: { mode: "chat", max_input_tokens: 1000000, max_output_tokens: 131072, supports_function_calling: true, supports_reasoning: true, supports_vision: true },
        },
      ],
    };
    const forward = buildPublicationResult(litellm, R3_CATALOG, options);
    const reversedLitellm = { data: [...litellm.data].reverse() };
    const reversedCatalog = {
      providers: Object.fromEntries(Object.entries(R3_CATALOG.providers).reverse()),
      models: Object.fromEntries(Object.entries(R3_CATALOG.models).reverse()),
    };
    const reversed = buildPublicationResult(reversedLitellm, reversedCatalog, options);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });
});

// ---------------------------------------------------------------------------
// Catalogue-wide offline assertions (C)
// ---------------------------------------------------------------------------

describe("Catalogue-wide regression evidence (offline subset)", () => {
  const subset: Array<{ catalog: unknown; litellm: unknown; modelName: string }> = [
    { catalog: R1_CATALOG, litellm: R1_LITELLM(), modelName: "mimo-v2.6-pro" },
    { catalog: R2_CATALOG, litellm: R2_LITELLM(), modelName: "mimo-v2.6-flash" },
    { catalog: R3_CATALOG, litellm: R3_LITELLM(), modelName: "minimax-m3" },
    { catalog: R5_CATALOG, litellm: R5_LITELLM(), modelName: "glm-5.3-flash" },
    { catalog: R7_CATALOG, litellm: R7_LITELLM(), modelName: "hy4-preview" },
    { catalog: R8_CATALOG, litellm: R8_LITELLM(), modelName: "kimi-k2.7-code" },
    { catalog: R9_CATALOG, litellm: R9_LITELLM(), modelName: "gpt-5.6-sol" },
  ];
  test("S2 shape (bare route + canonical-equal facts): no canonical model withheld", () => {
    for (const item of subset) {
      const { assessment } = assessed(item.litellm, item.catalog, item.modelName);
      expect(`${item.modelName}: ${assessment.status}`).toBe(`${item.modelName}: configured`);
    }
  });

  test("no unproven provider record contributes any value; no variant record selected", () => {
    for (const item of subset) {
      const group = groupOf(item.litellm, item.modelName);
      const resolved = resolveModel(group, item.catalog, {});
      expect(resolved.serving.status).toBe("unproven");
      expect(resolved.reasoningLevels.state).toBe("unknown");
      expect(resolved.spec.variants).toEqual([]);
      const priceBases = [resolved.fields["price.input"]!, resolved.fields["price.output"]!];
      for (const price of priceBases) {
        expect(price.basis === "litellm-declared" || price.basis === "unknown").toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// LKG capture/restore over the real fixtures
// ---------------------------------------------------------------------------

describe("LKG over real fixtures", () => {
  test("canonical entry restores through an outage; whole spec or nothing", () => {
    const litellm = R3_LITELLM();
    const group = groupOf(litellm, "minimax-m3");
    const store = createLastKnownGoodStore();
    const publication = buildPublicationResult(litellm, R3_CATALOG, options, { store });
    const live = publication.publishable[0]!;
    store.set(
      "minimax-m3",
      createLastKnownGoodEntry(group, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), R3_CATALOG, options),
    );
    const outage = buildPublicationResult(litellm, {}, options, { store, failure: { kind: "unreachable", retryable: true } });
    expect(outage.publishable.length).toBe(1);
    expect(outage.publishable[0]!.assessment.status).toBe("configured-lkg");
    expect(outage.publishable[0]!.spec).toEqual(live.spec);
  });

  test("schema 7 entries fail closed", () => {
    const validation = validateLastKnownGood(
      { schemaVersion: 7, modelName: "minimax-m3" } as never,
      groupOf(R3_LITELLM(), "minimax-m3"),
      undefined,
      Date.now(),
      options,
      R3_CATALOG,
    );
    expect(validation.valid).toBe(false);
  });

  test("PUBLICATION_SCHEMA_VERSION is 8", () => {
    expect(PUBLICATION_SCHEMA_VERSION).toBe(8);
  });

  test("resolving with LKG substitution keeps the stored spec intact", () => {
    const litellm = R3_LITELLM();
    const group = groupOf(litellm, "minimax-m3");
    const store = createLastKnownGoodStore();
    const publication = buildPublicationResult(litellm, R3_CATALOG, options, { store });
    const live = publication.publishable[0]!;
    const entry = createLastKnownGoodEntry(group, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), R3_CATALOG, options);
    const check = resolveConfigurationWithLKG(
      { ...live.assessment, publishable: false, status: "metadata-unavailable" },
      group,
      {},
      options,
      (() => { const s = createLastKnownGoodStore(); s.set("minimax-m3", entry); return s; })(),
    );
    expect(check.assessment.status).toBe("configured-lkg");
    expect(check.lkg?.spec).toEqual(live.spec);
  });
});
