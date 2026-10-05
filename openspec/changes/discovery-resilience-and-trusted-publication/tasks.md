# Tasks

## 1. Evidence provenance 与 source authority

- [x] 新增 `src/core/evidence.ts`：`EvidenceOrigin`、`FieldEvidence`、`FieldResolution`、`RUNTIME_CONSTRAINT_KEYS`、`resolveNumericField`、`resolveBooleanField`、`resolveModalityField`、`deploymentConstraintValue`
  - 证据：`bun test test/core-resilience.test.ts`（`resilience: source authority`）
- [x] 明确 `litellm_params` 是唯一可证明 runtime enforce 的来源；`model_info` 只是 descriptive metadata
  - 证据：`test/core-resilience.test.ts`「a proven endpoint runtime constraint narrows the effective configuration」
- [x] 同 authority 等级冲突 → `unresolved-conflict`；可裁决差异 → `resolved-discrepancy`
  - 证据：`test/core-resilience.test.ts`「same-level evidence that no authority can decide stays an unresolved conflict」

## 2. Publication gate 与 authority 集成

- [x] `assessLimit` / `assessModalities` / tools / reasoning 改为 authority-aware，`CompletenessAssessment` 增加 `discrepancies` / `conflicts`
  - 证据：`test/core-publication.test.ts`（tri-state / modality / group limit 用例）与 `test/core-resilience.test.ts`
- [x] `mapCapabilities` 与 `buildModelSpecs` 使用同一套 effective 值（intrinsic + 部署约束收窄）
  - 证据：`test/core-quality.test.ts`「context, input, and output limits keep distinct semantics with deterministic fallback」
- [x] 三个真实回归 fixture（`deepseek-v4.1-flash` / `glm-5.3-flash` / `minimax-m3`）在 Core 层确定性覆盖，且无模型名特判
  - 证据：`test/core-resilience.test.ts`（`resilience: live model regressions`）

## 3. 删除 model-level degraded publication

- [x] 删除 `degraded` 状态与全部 degraded acceptance API / options / 类型
  - 证据：`grep -r "acceptDegraded\|degradationEligible\|isPublishableWithDegradedAcceptance" src` 无结果；`test/core-publication.test.ts`「publication: no user override path」

## 4. Trusted LKG 加固

- [x] `PUBLICATION_SCHEMA_VERSION` 4 → 5；旧 schema 安全失败
  - 证据：`test/core-resilience.test.ts`「an incompatible stored schema fails safe instead of restoring」
- [x] live 冲突只看 authoritative intrinsic 事实与 proven runtime constraint；低权威描述性差异不再使 LKG 失效
  - 证据：`test/core-publication.test.ts`「descriptive-only disagreement is a resolved discrepancy and never invalidates LKG」
- [x] runtime constraint 与快照不一致 → fail closed；约束 `false` 移除模态 → fail closed
  - 证据：`test/core-publication.test.ts`（LKG actual-value conflicts 全部用例）
- [x] LKG 不复活已移除模型；identity / canonical 变化失效；authoritative 新事实不被旧快照掩盖
  - 证据：`test/core-resilience.test.ts`（`resilience: trusted LKG state machine`）

## 5. Partial catalog / regression / recovery / acknowledgement

- [x] 新增 `src/core/catalog.ts` 与 `catalogFromPublication`
  - 证据：`test/core-resilience.test.ts`（`resilience: partial catalog`）
- [x] 17/20 场景：17 立即发布、3 withheld 且原因可见，不是 0 也不是 20
  - 证据：`test/core-resilience.test.ts`「17 of 20 models publish immediately…」
- [x] `discovered > 0 && publishable = 0` 可表达为 unusable catalog
  - 证据：`test/core-resilience.test.ts`「discovered > 0 with zero publishable is reported as an unusable catalog」
- [x] withheld → 证据恢复 → 自动 configured，无需用户批准
  - 证据：`test/core-resilience.test.ts`「a withheld model recovering is published automatically without user approval」
- [x] regression 与 newly-withheld 区分；acknowledgement 只影响提醒
  - 证据：`test/core-resilience.test.ts`（`resilience: acknowledgement`）

## 6. Diagnostics

- [x] `ModelDiagnostic.publication` 暴露 discrepancies / conflicts / deployment constraints / LKG
  - 证据：`test/core-diagnostics.test.ts`、`test/core-resilience.test.ts`

## 7. 文档与治理

- [x] 更新 `docs/testing-standard.md` 第 8 节：改写为 intrinsic authority + 部署约束 + discrepancy/conflict 语义
- [x] 更新 `README.md`（Core 架构 / source authority / LKG 语义）
- [x] `openspec validate --all --strict` 与 closure gate 通过
