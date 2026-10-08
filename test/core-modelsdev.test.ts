/**
 * `modelsdev.ts` compat-shim contract (adopt-modelsdev-canonical-catalog,
 * task 6.3 rewrite).
 *
 * Removed semantics (reasons):
 * - canonical-original / OpenCode / OpenRouter / unique-match selection
 *   (D5: unproven records never supply facts) → `selectModelsDevRecord`
 *   returns a record ONLY for a proven serving provider with an exactly
 *   resolved record (`explicit-provider`).
 * - rule B adapter-namespace proof, relation fan-out choice, `resolveInheritedRecord`
 *   field inheritance → deleted; canonical identity comes only from the
 *   registry via `resolveModel()`.
 * - `buildVariants` from unproven records → callers pass only proven serving
 *   records; the record-reader itself is unchanged.
 *
 * Kept: candidate ordering, canonicalization, tri-state aggregation,
 * relation-target readers, legacy-family isolation, group identity evidence.
 */
import { describe, expect, test } from "bun:test";
import { groupLiteLLMDeployments } from "../src/core/litellm.ts";
import {
  aggregateTriState,
  buildVariants,
  candidateModelIDs,
  canonicalModelID,
  groupIdentityEvidence,
  legacyFamilyCompatibilityProvider,
  relationTargets,
  releaseTimestamp,
  resolveInheritedRecord,
  resolveReasoningLevels,
  resolveReasoningState,
  selectModelsDevRecord,
  selectModelsDevRecordDetailed,
} from "../src/core/modelsdev.ts";

function one(modelName: string, model: string, info: Record<string, unknown> = {}) {
  return groupLiteLLMDeployments({
    data: [{ model_name: modelName, litellm_params: { model }, model_info: { mode: "chat", ...info } }],
  })[0]!;
}

function catalogDoc(models: Record<string, unknown>, providers: Record<string, unknown>) {
  return {
    models,
    providers: Object.fromEntries(
      Object.entries(providers).map(([provider, records]) => [provider, { models: records }]),
    ),
  };
}

describe("models.dev 记录选择（compat shim）", () => {
  test("候选顺序为 base_model、去路由前缀、model_name", () => {
    expect(candidateModelIDs(one("route-name", "openai/upstream", { base_model: "base" }))).toEqual([
      "base",
      "upstream",
      "route-name",
    ]);
  });

  test("显式 models_dev_provider + 精确记录返回 explicit-provider", () => {
    const doc = catalogDoc(
      { "labA/x": { limit: { context: 100, output: 10 } } },
      { labA: { x: { id: "x", limit: { context: 80, output: 10 } } } }
    );
    const selected = selectModelsDevRecord(one("m", "x", { models_dev_provider: "labA" }), doc);
    expect(selected).toMatchObject({ providerID: "labA", modelID: "x", selectionSource: "explicit-provider" });
    expect(selectModelsDevRecordDetailed(one("m", "x", { models_dev_provider: "labA" }), doc).outcome).toBe("matched");
  });

  test("未声明 provider 时不选择任何记录（canonical-only 无 record）", () => {
    const doc = catalogDoc(
      { "labA/x": { limit: { context: 100, output: 10 } } },
      { labA: { x: { id: "x", limit: { context: 80, output: 10 } } } },
    );
    expect(selectModelsDevRecord(one("m", "x"), doc)).toBeUndefined();
    expect(selectModelsDevRecordDetailed(one("m", "x"), doc).outcome).toBe("unmatched");
  });

  test("reseller 同名记录在未声明时不选择（旧 fallback 已删除）", () => {
    const doc = catalogDoc(
      {},
      {
        opencode: { x: { id: "x", limit: { context: 1, output: 1 } } },
        openrouter: { x: { id: "x", limit: { context: 2, output: 2 } } },
      },
    );
    expect(selectModelsDevRecord(one("m", "x"), doc)).toBeUndefined();
    expect(selectModelsDevRecordDetailed(one("m", "x"), doc).outcome).toBe("unmatched");
  });

  test("声明 provider 但无精确记录时不选择（relation-only 不算 SKU）", () => {
    const doc = catalogDoc(
      { "labA/x": { limit: { context: 100, output: 10 } } },
      { labA: { "x-free": { id: "x-free", canonical_model_id: "labA/x", limit: { context: 1, output: 1 } } } },
    );
    const group = one("m", "x", { models_dev_provider: "labA" });
    expect(selectModelsDevRecord(group, doc)).toBeUndefined();
    // Serving-record-unresolved is not a group-identity ambiguity: the shim
    // reports unmatched (no record), the resolver reports the SKU state.
    expect(selectModelsDevRecordDetailed(group, doc).outcome).toBe("unmatched");
  });

  test("实质不同的精确记录在同一 provider 下保持歧义", () => {
    const doc = catalogDoc(
      {},
      { P: { x: { id: "x", limit: { context: 1, output: 1 } }, "X": { id: "X", limit: { context: 2, output: 2 } } } },
    );
    // Keys "x" and "X" both match wire id "x" case-insensitively with
    // different facts → serving-ambiguous.
    const group = groupLiteLLMDeployments({
      data: [{ model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", models_dev_provider: "P" } }],
    })[0]!;
    expect(selectModelsDevRecordDetailed(group, doc).outcome).toBe("ambiguous");
  });
});

describe("纯 helper", () => {
  test("canonicalModelID 归一化不剥离语义后缀", () => {
    expect(canonicalModelID("OpenAI/GPT-5.6_sol ")).toBe("gpt-5.6-sol");
    expect(canonicalModelID("x-free")).toBe("x-free");
  });

  test("relationTargets 只读取 canonical_model_id/base_model", () => {
    expect(relationTargets({ canonical_model_id: "labA/x", inherits: "labB/y" })).toEqual({
      canonical: "labA/x",
      other: [],
    });
  });

  test("legacyFamilyCompatibilityProvider 与可信选择隔离", () => {
    expect(legacyFamilyCompatibilityProvider(one("m", "openai/gpt-x"))).toBe("openai");
  });

  test("aggregateTriState 缺失永不提升", () => {
    expect(aggregateTriState([true, undefined]).state).toBe("unknown");
    expect(aggregateTriState([true, false]).conflict).toBe(true);
  });

  test("resolveInheritedRecord 已删除：恒返回 undefined", () => {
    expect(resolveInheritedRecord({ providerID: "P", modelID: "x", record: {} }, {})).toBeUndefined();
  });

  test("groupIdentityEvidence 要求每 deployment 证据", () => {
    const group = groupLiteLLMDeployments({
      data: [
        { model_name: "m", litellm_params: { model: "labA/x" }, model_info: { mode: "chat" } },
        { model_name: "m", litellm_params: {}, model_info: { mode: "chat" } },
      ],
    })[0]!;
    expect(groupIdentityEvidence(group, {}).status).toBe("unknown");
  });
});

describe("推理档位（仅 proven serving 记录）", () => {
  test("effort 档位保留全部取值", () => {
    const selected = {
      providerID: "P",
      modelID: "x",
      record: { reasoning_options: [{ type: "effort", values: ["none", "low", "medium", "high", "xhigh"] }] },
      selectionSource: "explicit-provider" as const,
    };
    expect(buildVariants(selected, "responses").map((variant) => variant.id)).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  test("无 reasoning_options 时无档位", () => {
    expect(buildVariants(undefined, "responses")).toEqual([]);
    expect(resolveReasoningLevels(undefined, "responses")).toEqual({ known: false, values: [] });
  });

  test("reasoning 状态三态独立于档位", () => {
    const g = one("m", "x", { supports_reasoning: true });
    expect(resolveReasoningState(g, undefined).state).toBe("supported");
  });
});

describe("release_date", () => {
  test("字符串日期解析为 Unix 毫秒", () => {
    const selected = {
      providerID: "P",
      modelID: "x",
      record: { release_date: "2026-03-01" },
      selectionSource: "explicit-provider" as const,
    };
    expect(releaseTimestamp(selected)).toBe(Date.parse("2026-03-01"));
  });
});
