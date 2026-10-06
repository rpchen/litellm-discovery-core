# Tasks

## 1. 统一 relation semantics 与 record matching

- [ ] 新增 `relationTargets(record)`：canonical relation（`canonical_model_id` ?? `base_model`）与次级 relations（`inherits` / `equivalent_to` / `equivalents`）单一出口
  - 证据：`bun test test/core-modelsdev.test.ts`（relation targets 单测）
- [ ] `findMatchesByRelation`：record 可通过 relation 匹配候选（`kind: "relation"`）；`findMatch` 行为对外不变
  - 证据：`test/core-modelsdev.test.ts`（relation matching vs direct matching）
- [ ] `groupIdentityEvidence` catalog 关系与 `resolveInheritedRecord` 目标解析改用同一 relation 语义（语义不变，来源收敛）
  - 证据：`bun test test/core-modelsdev.test.ts`（identity graph 与 inheritance 用例保持通过）

## 2. Provider selection precedence

- [ ] canonical-original 证明 = deterministic relation 指向 canonical identity + provider namespace 等于 canonical namespace；多 official SKU 用确定性 tie-break（status/deprecated 计数 → modelID 长度 → localeCompare），与 catalog 顺序无关
  - 证据：`test/core-modelsdev.test.ts`（DeepSeek 官方 records 命中用例 + order-independence 用例）
- [ ] fallback 顺序改为 OpenCode > OpenRouter；之后 unique-match / ambiguous
  - 证据：`test/core-modelsdev.test.ts`（precedence matrix 7 cases）
- [ ] reseller 的 relation 不得证明 original（openrouter/opencode namespace != canonical namespace）
  - 证据：`test/core-modelsdev.test.ts`（reseller relation 负向用例）

## 3. Relation-aware source authority

- [ ] `evidence.ts` 接受 `intrinsicAuthority`（authoritative / fallback-serving），fallback 证据与 LiteLLM descriptive 同级；冲突 → unresolved-conflict
  - 证据：`test/core-resilience.test.ts`（fallback authority 用例）
- [ ] publication 按selectionSource 传入 authority；fallback `cost` 排除边界扩展
  - 证据：`test/core-publication.test.ts`（fallback conflict withheld + OpenRouter 943718 不得发布为 intrinsic）
- [ ] canonical-original / explicit relation 证明下 authority 不变
  - 证据：`test/core-resilience.test.ts` 既有 live regression 用例保持通过

## 4. DeepSeek 固定 regression + 重点模型

- [ ] 新增 `test/fixtures/models-dev-catalog-fixtures.ts`：deepseek 官方 3 SKU（relation 指向 canonical）、opencode、openrouter（943718）+ `deepseek-v4.1-flash` LiteLLM fixture（含/不含 `litellm_provider: deepseek` 两种形态）
  - 证据：`test/core-resilience.test.ts`（`canonical selection: DeepSeek`）
- [ ] 断言：canonical identity、selected provider = deepseek、selectionSource = canonical-original、spec.limit.output = 393216、强负断言 provider != openrouter 且 output != 943718、spec.id 不被 fallback 改写
  - 证据：同上
- [ ] glm-5.3-flash / minimax-m3 回归保持通过（无模型特判：grep 生产代码无模型名）
  - 证据：`test/core-resilience.test.ts` live regression 组

## 5. LKG / snapshot 防复活与 diagnostics

- [ ] LKG captured `943718` 在新 spec `393216` 下 fail closed，不复活旧错误 metadata
  - 证据：`test/core-publication.test.ts`（LKG 负向用例）
- [ ] diagnostics `modelsDev.selectionSource` + `quality.identity.identityProvenance`；canonical identity 与 metadata provider 分离展示
  - 证据：`test/core-diagnostics.test.ts`
- [ ] `src/index.ts` 导出新增类型
  - 证据：`npm run typecheck`

## 6. 文档与规格同步

- [ ] `docs/testing-standard.md` 第 8 节 precedence 表更新为 OpenCode > OpenRouter 并写明 authority 区分
  - 证据：grep 无旧顺序残留
- [ ] `README.md` 用户可见描述更新
  - 证据：`grep -n "OpenRouter" README.md`
- [ ] OpenSpec scenarios 更新并保持 100% 自动化证据映射
  - 证据：`npm run validate:spec` + 全量测试

## 7. 交付门禁

- [ ] `npm run typecheck`、`bun test`、`npm run build:dist`、`npm run test:package`、OpenSpec validate/closure 全绿
  - 证据：本地命令输出 + PR CI
- [ ] 无用户可见 API 破坏（`selectionSource` 取值集不变；新增字段均为可选/观察性）
  - 证据：typecheck + 既有导出保持