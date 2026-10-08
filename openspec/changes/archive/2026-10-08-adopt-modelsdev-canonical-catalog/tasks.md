# Tasks

> 本轮（设计）只完成 §0。§1–§8 为实施阶段任务，须在最终设计评审通过（DESIGN_APPROVED_FOR_IMPLEMENTATION）后开始；adapter 任务在各自仓库另立 change，并在 Core 合入 main、得到稳定 SHA 后进行。
>
> **Revision 4 对齐说明**：本文件已全文重写以匹配 Revision 4 的 design/spec。旧版（rev 2/3）中与本版冲突的条目——`full/afterAdapter/tail` 三键解析、G5a/G5b 等价例外、serving 缺字段回落 canonical、`reasoning_effort` pin + fixedEffort、单一 `deploymentInput`、constraint fingerprint、`litellm_params.max_input_tokens` 收窄——**一律作废**，不得按旧文实施。

## 0. 审计与设计冻结（本轮）

- [x] 0.1 重新读取 models.dev README / AGENTS.md / `schema.ts` / `generate.ts` / SDK / worker，核实 models.json / api.json / catalog.json 分层
  - 证据：`audit.md` §1（repo `450aa1d5`，live 抓取 2026-10-07 13:11 UTC）
- [x] 0.2 Catalogue-wide 量化与 445 canonical × 6 形态模拟、live 17 模型回归
  - 证据：`audit.md` §2–§4
- [x] 0.3 Findings P0/P1/P2、frozen architecture、MiniMax A/B/C/D、acceptance matrix、delta specs
  - 证据：`audit.md` §6、`design.md`、`acceptance.md`、`specs/*`
- [x] 0.4 `openspec validate adopt-modelsdev-canonical-catalog --strict` 与 `--all --strict` 通过
- [x] 0.5 Revision 2：按第一轮评审修订
- [x] 0.7 Revision 3：LiteLLM 源码核实与六项修订
- [x] 0.8 Revision 4：撤销 D7a 全部 hard-enforced 归类（`get_router_model_info` 不合并 `litellm_params` 能力键、`MirroredPricingParams` 仅 7 个价格键、`supports_factory` 读 cost-map）；enforcement 证明集从空开始 + 晋升门槛；删除 `limit.input = context` 推导；catalog 穷举三态；LKG evidence multiset；DeepSeek R4/R4b；tasks 全文重写清除旧设计
  - 证据：`design.md` Revision 4 / D7a / D2 / D6 / D10、`audit.md` §7（Revision 4）、`acceptance.md` G34–G39、`specs/*`、本文件
- [x] 0.9 最终设计评审通过（DESIGN_APPROVED_FOR_IMPLEMENTATION）：代码 Review 通过（八项 review 修复落地：候选关系限定、组级 serving 证明、identity-critical facts、维度隔离 strict、base_model 零匹配、LKG 指纹稳定性/重排无关、operator configuration 不参与非法裁决、relation-only 措辞统一），实施、双轮对抗测试与全部门禁完成（2026-10-08）

## 1. Catalog 输入（Core）

- [x] 1.1 `src/core/catalog-input.ts`：`normalizeModelsDevCatalog()` 穷举三态——`providers`+`models` 皆有效对象 → `complete`；遗留 provider map → `providers-only`；其余一切（空、非对象、**models-only**、子对象非对象）→ `unavailable`；`complete` 时未知顶层 key 忽略
  - 证据：`test/resolve-matrix.test.ts`「catalog input contract」（G21/G33/G39 + providers-only 零供给）
- [x] 1.2 真实 schema fixture：从 live catalog 裁剪 R1–R11 涉及的 canonical 与 provider 记录，记录抓取时间与 models.dev commit；fixtures 覆盖 `base_model_omit`（`requesty/hy3`：无 `limit.input`）、registry 缺 `limit.output`、`reasoning_options [toggle]`/`[]`/effort 三型；删除 fixtures 中对 `aliases`/`inherits`/`equivalent_to`/`equivalents` 的依赖（保留惰性负向测试）
  - 证据：`test/fixtures/canonical-catalog-fixtures.ts`（live 2026-10-07 13:11 UTC，`sst/models.dev@450aa1d5`）；删除 `test/fixtures/models-dev-catalog-fixtures.ts`（虚构字段）；`resolve-matrix` G17d/`quality` 别名惰性测试

## 2. Identity 与 serving（Core）

- [x] 2.0 `src/core/wire-id.ts`：裸值 → `bare`；qualified 值 → `full`，且仅当 `custom_llm_provider` 等于第一段（adapter parse 证据）才取余串（余串再按裸/qualified 规则递归一次）；**禁止对任意 qualified 值取尾段**；adapter 段与 `custom_llm_provider` 只作 parse metadata
  - 证据：`resolve-matrix`「wire-ID parsing」（G3/G3b/G3c/G3d/G26/G27）
- [x] 2.1 `resolveCanonicalIdentity()`：registry 精确证明（full → adapter-evidenced remainder → bare）、`0/1/>1`、base_model 优先、组级一致
  - 证据：`resolve-matrix`「canonical identity resolution」（G1/G2/G2b/G24/G25/G29）+ R1–R9；组证据 rank 确定性（G23）
- [x] 2.2 `resolveServing()`：`models_dev_provider` 证明 provider；record 只由 exact parsed-key 命中 resolve（命中即 resolved，resolved 记录的 `canonical_model_id` 可按 D3.3 额外证明 identity，不存在「已命中但 SKU unresolved」）；provider 存在但无 exact 命中 → `serving-record-unresolved`（relation-only 记录只进诊断，不提供 identity/serving facts；整组按 serving-unproven 解析）；多条 exact 候选事实实质不同 → serving-ambiguous；声明的 provider 不存在于 catalog → `declared-unmatched`；多 deployment 一致
  - 证据：`resolve-matrix`「serving provider proof」（G4/G6/G6b/G7/G8/G10/G10b/G11/G12b/G12c/G40）+ R3b/R3c/R4b/R4c/R6b/R10c
- [x] 2.3 canonical/provider 矛盾：两边都是确定性 identity 证据而指向不同 registry key → identity conflict、fail closed；事实相等不构成等价（无 G5a 例外）
  - 证据：`resolve-matrix` G29
- [x] 2.4 删除 rule B、`canonical-original` 作为 serving/authority、relation fan-out 选择、OpenCode/OpenRouter/unique 发布供给、`resolveInheritedRecord` 字段继承；未证明同名记录只进 `diagnosticCandidates`；`legacyFamilyCompatibilityProvider` 保持隔离
  - 证据：`src/core/modelsdev.ts` 重写（shim 仅返回 proven serving；inheritance stub 恒 undefined）；`core-modelsdev`/`core-quality` 重写测试

## 3. Effective values（Core）

- [x] 3.1 字段级 resolution matrix（design D6 分支算法）：serving proven + record resolved 时 per-field serving-absence policy（缺字段不回填 canonical，允许同维度 LiteLLM 补缺，否则 unknown）；record unresolved 时按 serving-unproven 分支；canonical 缺 `limit.input` → 同维度 LiteLLM 补缺 → unknown（无 input=context 推导）；modalities 完整集合/对象缺失语义；维度 like-for-like；LiteLLM-only 无 context 即 withheld
  - 证据：`resolve-matrix`「field resolution matrix」（G13/G13b/G13c/G15/G19/G19b/G19b2/G19c/G19d/G19e/G34/G35）+ R1/R3/HY3
- [x] 3.2 Proven Runtime Enforcement（design D7a）：冻结常量表 = **空证明集** + 晋升门槛（exact source path + 负向突破测试，经 delta 晋升）；**非价格** `litellm_params` 键归 `operator configuration`，只进诊断；`max_tokens`/`max_output_tokens`/`max_completion_tokens`/`reasoning_effort` 均不收窄、不产生档位；价格键由 §3.5 单独处理
  - 证据：`src/core/evidence.ts`（`RUNTIME_CONSTRAINT_KEYS` 全空、context 无 descriptiveKeys）；`resolve-matrix`「runtime enforcement matrix」（G14b/G14c/G31/G32/G36/G37/G44）+ R3d
- [x] 3.3 未登记模型：declared serving → serving；LiteLLM 声明完整（含真实 context 语义）→ litellm-declared；否则 withheld；诊断候选排序 OpenCode → OpenRouter → 其余
  - 证据：R10/R10b/R10c/R11 + `resolve-matrix`「group consistency」G9
- [x] 3.4 推理档位：只有 proven serving `reasoning_options` 产生档位；`litellm_params.reasoning_effort` 是 operator configuration（请求可覆盖），永不 pin/产生档位/收窄；`allowed_openai_params` / `model_info.supports_*_reasoning_effort` / `reasoning_effort_levels` 只诊断
  - 证据：`resolve-matrix`「reasoning controls authority」（G16/G17/G17b/G17c/G17d）+ R4/R9b；budget_tokens 语义保留（`core-build` 档位测试）
- [x] 3.5 价格逐组件：LiteLLM 显式（`litellm_params` 价格键优先于 `model_info`——`MirroredPricingParams` 已镜像，二者语义一致）→ 已证明 serving `cost` → unknown
  - 证据：`resolve-matrix`「price authority」（G18/G18b/G18c）+ R1/R3b/R7；`core-resilience`「price authority」

## 4. Single resolver（Core）

- [x] 4.1 `src/core/resolve.ts`：`resolveModel()` → `ResolvedModel`（含 field basis、reasoning level state、diagnosticCandidates、proof）；`toModelSpec()` 唯一构造器
- [x] 4.2 `buildModelSpecs`、`assessModelConfiguration`、`buildPublicationResult`、`diagnoseModelSpecs` 改为派生；`mapCapabilities` 不再独立解析
  - 证据：`canonical-catalog-acceptance` G22（build == diagnostics models；capture == spec）；`src/core/build|publication|diagnostics.ts` 重写
- [x] 4.3 diagnostics 新字段：canonical identity/evidence、parse metadata（标注非证据）、serving status/provider/record、field basis、档位状态、`litellm_params` 键作 operator-configuration 列出（不称 enforcement）、诊断候选、catalog shape
  - 证据：`ModelQualityDiagnostic` 扩展字段 + `core-diagnostics` 重写测试（含 `operator-configuration` / `serving-record-unresolved` / `models-dev-providers-only` issue codes）

## 5. LKG schema 8（Core）

- [x] 5.1 `PUBLICATION_SCHEMA_VERSION = 8`、group-wide proof composition：`deploymentEvidence`（每 deployment 一项：`deploymentID` = `model_info.id` 或 evidence-multiset 派生键、`normalizedInputs` multiset、`identityKind` = canonical/litellm-only/serving-only、`canonicalModelID` + `canonicalEvidenceKind` 仅 canonical 时）+ `registryDigest`（仅当任一字段 basis = canonical，摘要所用 registry 事实）+ 逐 deployment serving declarations + recordDigest（record resolved 时，所用 serving 事实摘要）+ field basis + enforcementFingerprint（形状冻结、内容空）+ litellmFingerprint
  - 证据：`src/core/resolve.ts` `buildProof` + `src/core/publication.ts` v8 entry；`resolve-matrix` G41/G42/G43
- [x] 5.2 整体判定的逐组件重证明：evidence multiset 逐项相等（outage 与 live 两套条件）；serving declarations 逐 deployment；operator-configuration 键不进 enforcement fingerprint；未引用记录变化不失效；绝不按字段拼接；v≤7 fail closed
  - 证据：`validateLastKnownGood` 双模式（outage/litellm+declarations+指纹；live + kinds/digests）；`resolve-matrix` G20–G20h/G38 + `core-resilience` LKG policy
- [x] 5.3 capture 由同一 resolved 派生（消灭 seeding 静默失败）
  - 证据：`createLastKnownGoodEntry` 要求 catalog+options、校验 captured==spec 一致，否则 throw（adapter try/catch 保持 best-effort）；G22 capture 测试

## 6. Catalogue-wide 门禁与回归（Core）

- [x] 6.1 `scripts/audit-modelsdev-catalog.ts`（live，非阻断 manual/scheduled）与离线 fixture 版断言
  - 证据：脚本 + 2026-10-08 live 运行（447 canonical、S2 零误杀、零未证明贡献、零变体当选、零值偏离；27 registry-gap 预期 withheld）+ `canonical-catalog-acceptance`「Catalogue-wide regression evidence」
- [x] 6.2 R1–R11 真实回归测试（R4/R4b/R4c 为 DeepSeek 三态行为变化测试）；G1–G44 合成矩阵（含 G19b/G19b2、G40–G44）；每个 delta Scenario → 测试映射表（PR 描述）；R4/R4b/R4c DeepSeek 三场景作为**行为变化**测试固定（注释引用 design Risks，禁止回改）
  - 证据：`test/canonical-catalog-acceptance.test.ts`（30）+ `test/resolve-matrix.test.ts`（60+）
- [x] 6.3 旧测试逐条审查：依赖 rule B / canonical-original-as-authority / relation fan-out / 虚构 relation 字段 / `max_input_tokens` 收窄或作 context / `reasoning_effort` pin / serving 缺字段回填 的用例按新规范改写，并在 PR 列出被改写用例与理由
  - 证据：重写 `core-modelsdev`/`core-capabilities`/`core-build`（含快照刷新）/`core-diagnostics`/`core-quality`/`core-publication`/`core-resilience`；改写清单见 PR 描述

## 7. 文档与治理（Core）

- [x] 7.1 README：catalog 输入、`models_dev_provider` 作为 serving provider 声明（恢复 serving 值还需 exact SKU 命中）、非价格 `litellm_params` 键 = operator configuration（无 proven enforcement，晋升门槛说明；价格键为 Operator-Declared Pricing 独立处理）、行为变化清单（DeepSeek R4/R4b/R4c、档位 unknown、input 同维度补缺规则）、迁移说明
- [x] 7.2 `docs/testing-standard.md` §8：identity precedence 与价格规则改为 canonical registry / serving proof 模型；「runtime constraint」表述改为 Proven Runtime Enforcement（空证明集 + 晋升门槛）；删除 `max_input_tokens` 收窄与 input=context 例外
- [x] 7.3 `docs/decisions.md` 新增 ADR（canonical catalog 采纳、fact classes、未证明记录零供给、Q1 关闭、enforcement 空证明集与晋升门槛、Q2 结论）
- [x] 7.4 交付门禁：`npm run typecheck`、`bun test`、`npm run build:dist`、`npm run test:package`、`npm run validate:spec`、`npm run test:openspec-closure`
- [x] 7.5 PR → main：squash 合并完成（PR #32，merge commit `300c28af7bd5e2d9e7cbc005bb651e3d9760f994`，2026-10-08T14:25:44Z；合并前 CI 绿、MERGEABLE/CLEAN、base `61f4894` 未变、head `2542080`）；合并后 `finish_codebase_task`、archive + canonical sync + strict validation 见后续条目与 main 提交记录

## 8. Downstream（各自仓库另立 change，Core SHA 稳定后）

- [ ] 8.1 Pi：`catalog.json` URL/形状；LKG 存储 v8（v7 忽略并重捕获）；`/litellm-diagnostics` 展示 canonical identity / serving status / 档位 unknown / operator-configuration 键 / 诊断候选；fake catalog fixture；Real Pi 0.87.1 E2E；README（含 DeepSeek/档位/enforcement 行为变化）
- [ ] 8.2 OpenCode：默认 URL 与 `modelsDevUrl` 文档；LKG v8；diagnostics/TUI 字段；fake catalog；Real OpenCode 2.0.16 E2E；README（同上）
- [ ] 8.3 两插件 `build:dist` 使用同一 Core SHA；`dist/core-provenance.json` 一致；跨仓 PR 互链与合入顺序