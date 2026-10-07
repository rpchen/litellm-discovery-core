# Design: Refine Provider Selection Review Findings

## 来源

PR #29 review（head `f1e411b`）六项 finding；本补全 change 修复其全部实现偏差并冻结原先含糊的语义。基线 Core main `6f7eb3d` + fix branch `f1e411b`。

## 1. 单一 authority gate（findings 1/2）

`isAuthoritativeIntrinsic(selected)`（`publication.ts`）是唯一切换点，四处（publication assessment / pricing `canUseSelectedModelsDevPrice` / LKG restore policy / diagnostics origin）全部由它或同一形状的判定驱动：

```
authoritative-intrinsic:
  canonical-original
  ∨ explicit-provider ∧ record.recordCanonicalID ≠ undefined
  ∨ selectionSource = undefined（legacy 手工 record 兼容，不出现在 selector 输出）
fallback-serving:
  opencode-fallback ∨ openrouter-fallback ∨ unique-match ∨ legacy-family-compatibility
  ∨ explicit-provider ∧ recordCanonicalID = undefined
```

LKG：`isFallbackSelectionSource` 与上面 fallback-serving 全集一致；fallback-sourced 快照在 metadata outage（`selected = undefined`）或 selection source 漂移时 fail closed，必须由当轮 live 选择重新证明。`PUBLICATION_SCHEMA_VERSION` 保持 6。

## 2. Descriptive vs runtime constraint 分离（finding 3）

`resolveNumericField`/`resolveBooleanField`/`resolveModalityField` 三处的 same-level conflict 判定只比较 **descriptive**（`model_info`）声明；`litellm_params` 里可证明 enforce 的键一律作为 `deployment-constraint` 证据后置收窄 effective 值（对 authoritative 与 fallback-serving intrinsic 一致）。constraint 由此不再制造 same-level conflict——包括与 fallback-serving 的差异。两个 deployment 之间的真实约束/描述冲突仍按既有规则 unresolved。

## 3. Record-level order independence（finding 4）

`findMatchesByRelation` 收集 provider.models 内**全部**匹配记录（direct key/id/alias + canonical relation），`findMatch` 保留为单结果兼容包装。`resolveSingleProviderMatches`：

- 全部记录 publication-critical facts（limit / modalities / tool_call / reasoning / reasoning_options / canonical relation target）可证明等价 → 确定性 tie（deprecated 计数 → modelID 长度 → localeCompare → 稳定索引）；
- 存在实质差异且无规则裁决 → 该 provider match 集 fail closed（`undefined` → outcome ambiguous/withheld）。
- 显式 provider 的 record 集冲突同样 fail closed：explicit 证明只选 provider，不裁决 record。

## 4. Canonical-original proof 冻结（finding 6）

两条可证明路径：

- **A：relation 证明**——record 自带 deterministic canonical relation（`canonical_model_id` / `base_model`）指向候选 identity，且 provider id == canonical namespace；
- **B：deployment 证明**——record 无 relation，但 deployment 自身 qualified identity（`namespace/model` 路由，或显式 `models_dev_provider`）证明同一 namespace，且 provider id == 该 namespace。

不可借用：其它 reseller record 的 relation 只描述 reseller 自己服务哪个 canonical model，永远不能为第三个 record 提供 original 资格，也不能单独确立 canonical namespace 供 relation-less record 冒充 original（adversarial fixture 固定：ambigous，非 first-match）。

canonical namespace 的确立仍以 deployment 证据优先（routed `namespace/model`），其次 relation 声明集合唯一一致时才采纳（用于 relation-matched official record 的 DeepSeek 形态）。

## 5. Diagnostics/文案（finding 5）

`intrinsicOrigin` 忠实写入 evidence item origin；fallback-serving 路径的 resolution 消息明确命名 fallback serving（含被 constraint 收窄的组合），不出现 "authoritative intrinsic metadata decides"。不新增用户可见通知。

## 6. 不变量确认

precedence 顺序、DeepSeek regression（393216）、无模型/数字特判、无 inference probe、publication gate 不降低——全部保持；revert-验证要求每个 finding 的关键测试在回退对应修复后稳定失败。
