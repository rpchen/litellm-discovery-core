/**
 * Legacy `mapCapabilities` projection contract (adopt-modelsdev-canonical-catalog,
 * task 6.3 rewrite). The publication path derives every value from the single
 * resolver; this module is a thin projection for direct callers:
 * - context comes only from the record (never from max_input_tokens);
 * - no `litellm_params` key narrows anything (D7a empty proven set);
 * - operator-declared pricing reads `litellm_params` before `model_info`;
 * - unproven records are never passed in by the resolver path.
 *
 * Rewritten cases (old → new, with reasons):
 * - 多部署最小上限 → input/output 取最小声明值；context 仅记录值（维度隔离，
 *   旧测试把 max_input_tokens 当 context 已删除）。
 * - 272k/512k 阶梯 → 仍截断记录 context（BuildOption 行为保留）；无记录时为 0
 *  （旧测试用 LiteLLM 值当 context 已删除）。
 * - 显式 false 覆盖模态 → 改为 litellm_params false 不再移除（operator
 *   configuration，无 enforcement 证明）。
 * - 工具默认支持 → 改为无声明时 false（unknown 永不默认 true）。
 */
import { describe, expect, test } from "bun:test";
import { mapCapabilities } from "../src/core/capabilities.ts";
import { groupLiteLLMDeployments } from "../src/core/litellm.ts";
import type { SelectedModelRecord } from "../src/core/modelsdev.ts";

function record(overrides: Record<string, unknown> = {}): SelectedModelRecord {
  return {
    providerID: "P",
    modelID: "x",
    record: {
      limit: { context: 200000, input: 150000, output: 32000 },
      modalities: { input: ["text", "image"], output: ["text"] },
      tool_call: true,
      cost: { input: 2, output: 10 },
      ...overrides,
    },
    selectionSource: "explicit-provider",
  };
}

function group(modelName: string, deployments: Array<{ params?: Record<string, unknown>; info?: Record<string, unknown> }>) {
  return groupLiteLLMDeployments({
    data: deployments.map((item) => ({
      model_name: modelName,
      litellm_params: { model: modelName, ...(item.params ?? {}) },
      model_info: { mode: "chat", ...(item.info ?? {}) },
    })),
  })[0]!;
}

describe("能力映射（legacy projection）", () => {
  test("多部署 input/output 取最小声明值，context 仅记录值", () => {
    const g = group("m", [
      { info: { max_input_tokens: 200000, max_output_tokens: 32000 } },
      { info: { max_input_tokens: 400000, max_output_tokens: 128000 } },
    ]);
    const result = mapCapabilities(g, undefined, false);
    expect(result.limit.input).toBe(200000);
    expect(result.limit.output).toBe(32000);
    // Dimension isolation: no record, no context — never from max_input_tokens.
    expect(result.limit.context).toBe(0);
  });

  test("记录 context 优先；价格换算为每百万 token 且 litellm_params 优先", () => {
    const g = group("m", [
      { params: { input_cost_per_token: 5e-7 }, info: { max_input_tokens: 200000, max_output_tokens: 32000, input_cost_per_token: 2e-7, output_cost_per_token: 10e-7 } },
    ]);
    const result = mapCapabilities(g, record(), false);
    expect(result.limit.context).toBe(200000);
    expect(result.cost.input).toBeCloseTo(0.5, 10);
    expect(result.cost.output).toBe(1);
  });

  test("contextTierCap 截断记录 context，可关闭", () => {
    const g = group("m", [
      { info: { max_input_tokens: 922000, max_output_tokens: 128000, input_cost_per_token_above_272k_tokens: 1 } },
    ]);
    expect(mapCapabilities(g, record({ limit: { context: 1000000, output: 128000 } }), true).limit.context).toBe(272000);
    expect(mapCapabilities(g, record({ limit: { context: 1000000, output: 128000 } }), false).limit.context).toBe(1000000);
  });

  test("记录模态集合决定 direction；litellm_params false 不再移除", () => {
    const g = group("m", [{ params: { supports_vision: false }, info: {} }]);
    const result = mapCapabilities(g, record(), false);
    // D7a: operator-configuration keys narrow nothing.
    expect(result.capabilities.input).toEqual(["text", "image"]);
  });

  test("无记录且 LiteLLM 未声明模态时仅 text", () => {
    const g = group("m", [{ info: {} }]);
    expect(mapCapabilities(g, undefined, false).capabilities.input).toEqual(["text"]);
  });

  test("无声明时工具为 false（unknown 永不默认 true）", () => {
    const g = group("m", [{ info: {} }]);
    expect(mapCapabilities(g, undefined, false).capabilities.tools).toBe(false);
  });

  test("异常字段按缺失处理", () => {
    const g = group("m", [{ info: { max_input_tokens: "abc", max_output_tokens: -5 } }]);
    const result = mapCapabilities(g, undefined, false);
    expect(result.limit).toEqual({ context: 0, input: 0, output: 0 });
    expect(result.capabilities.tools).toBe(false);
  });
});
