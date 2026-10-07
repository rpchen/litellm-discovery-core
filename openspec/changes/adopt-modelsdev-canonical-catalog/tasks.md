# Tasks

> 本轮（设计）只完成 §0。§1–§8 为实施阶段任务，须在设计评审通过后开始（Q1 已在 Revision 2 关闭；Q2 为低优先级兼容问题，不阻塞）；adapter 任务在各自仓库另立 change，并在 Core 合入 main、得到稳定 SHA 后进行。

## 0. 审计与设计冻结（本轮）

- [x] 0.1 重新读取 models.dev README / AGENTS.md / `schema.ts` / `generate.ts` / SDK / worker，核实 models.json / api.json / catalog.json 分层
  - 证据：`audit.md` §1（repo `450aa1d5`，live 抓取 2026-10-07 13:11 UTC）
- [x] 0.2 Catalogue-wide 量化与 445 canonical × 6 形态模拟、live 17 模型回归
  - 证据：`audit.md` §2–§4
- [x] 0.3 Findings P0/P1/P2、frozen architecture、MiniMax A/B/C/D、acceptance matrix、delta specs
  - 证据：`audit.md` §6、`design.md`、`acceptance.md`、`specs/*`
- [x] 0.4 `openspec validate adopt-modelsdev-canonical-catalog --strict` 与 `--all --strict` 通过
- [x] 0.5 Revision 2：按第三方评审修订（取消未证明记录供给、字段级 matrix、关闭 Q1、LKG proof composition、wire-id 解析与证据分离、catalog 等价措辞、pinned effort 发现）
  - 证据：`design.md` D3/D5/D6/D7/D10、`audit.md` §7、`acceptance.md`、`specs/*`
- [ ] 0.6 第二轮设计评审通过（逐行 review 已推送分支）

## 1. Catalog 输入（Core）

- [ ] 1.1 `src/core/catalog-input.ts`：`normalizeModelsDevCatalog()`（complete / providers-only / unavailable）；所有公共入口内部归一化
  - 验收：acceptance G21、`Catalog input contract`
- [ ] 1.2 真实 schema fixture：从 live catalog 裁剪 R1–R11 涉及的 canonical 与 provider 记录，记录抓取时间与 models.dev commit；删除 fixtures 中对 `aliases`/`inherits`/`equivalent_to`/`equivalents` 的依赖（保留惰性负向测试）

## 2. Identity 与 serving（Core）

- [ ] 2.0 `src/core/wire-id.ts`：候选值解析为 full / afterAdapter / tail 查找键；adapter 段与 `custom_llm_provider` 只作 parse metadata
  - 验收：G3、G3b、G3c、G3d、`Wire-ID parsing carries no authority`
- [ ] 2.1 `resolveCanonicalIdentity()`：registry 精确证明、`0/1/>1`、base_model 优先、组级一致性
  - 验收：G1、G2、G2b、G24、G25、R8
- [ ] 2.2 `resolveServing()`：`models_dev_provider` 证明、精确 wire id、relation 唯一/等价、serving-ambiguous、declared-unmatched、多 deployment 一致
  - 验收：G4、G8、G11、G12b、G12c、R3b、R3c、R6b、R10c
- [ ] 2.3 canonical/provider 矛盾规则（实质等价判定）
  - 验收：G5a、G5b
- [ ] 2.4 删除 rule B、`canonical-original` 作为 serving/authority、relation fan-out 选择、OpenCode/OpenRouter/unique 发布供给、`resolveInheritedRecord` 字段继承；未证明同名记录只进 `diagnosticCandidates`；`legacyFamilyCompatibilityProvider` 保持隔离
  - 验收：G6、G7、G9、G10、G10b、G12、G13b、R2、R4、R7、R9、R10

## 3. Effective values（Core）

- [ ] 3.1 字段级 resolution matrix（design D6）：每字段 base 顺序、serving 缺字段回落 canonical、canonical 缺字段回落 litellm-declared、modalities 完整集合/对象缺失语义、维度 like-for-like
  - 验收：G15、G19、G19b、G19c、G19d、G19e、R9、`Field resolution matrix`、`token-limit semantics`
- [ ] 3.2 runtime constraint 只收窄；discrepancy / conflict 判定
  - 验收：G13、G13c、G14、G14b、G14c、R3、R3d、R6
- [ ] 3.3 未登记模型：declared serving → serving；LiteLLM 完整 → litellm-declared；否则 withheld；诊断候选排序 OpenCode → OpenRouter → 其余
  - 验收：G10b、G13b、R10、R10b、R10c、R11、`Unproven provider records never supply publication facts`
- [ ] 3.4 推理档位：proven serving `reasoning_options` 或 `litellm_params.reasoning_effort` pin（known-empty + fixedEffort）；其余 unknown；`allowed_openai_params` / `model_info.supports_*_reasoning_effort` 只诊断
  - 验收：G16、G17、G17b、G17c、G17d、R4、R9b、`Reasoning controls authority`
- [ ] 3.5 价格权威
  - 验收：G18、G18b、G18c（逐组件；`litellm_params` 优先于 `model_info`）

## 4. Single resolver（Core）

- [ ] 4.1 `src/core/resolve.ts`：`resolveModel()` → `ResolvedModel`（含 field basis、reasoning level state、diagnosticCandidates、proof）；`toModelSpec()` 唯一构造器
- [ ] 4.2 `buildModelSpecs`、`assessModelConfiguration`、`buildPublicationResult`、`diagnoseModelSpecs` 改为派生；`mapCapabilities` 不再独立解析
  - 验收：G22、G23、`Single resolution result`
- [ ] 4.3 diagnostics 新字段（canonical identity/evidence、parse metadata（标注非证据）、serving status/provider/record、field basis、档位状态/fixedEffort、诊断候选、catalog shape）
  - 验收：`source visibility`、`degraded enrichment` 各 scenario

## 5. LKG schema 8（Core）

- [ ] 5.1 `PUBLICATION_SCHEMA_VERSION = 8`、proof composition 形状（canonical deploymentInput/registryDigest、serving declaration/recordDigest、field basis、constraint/LiteLLM 指纹）、compatibility guard 与防御校验
- [ ] 5.2 整体判定的逐组件重证明（outage 与 live 两套条件；未引用记录变化不失效；绝不按字段拼接；v≤7 fail closed）
  - 验收：G20–G20h、`Last Known Good schema 8 proof composition`、`Last Known Good without TTL`、`Trusted Last Known Good reuse`
- [ ] 5.3 capture 由同一 resolved 派生（消灭 seeding 静默失败）
  - 验收：`Capture cannot fail silently through drift`

## 6. Catalogue-wide 门禁与回归（Core）

- [ ] 6.1 `scripts/audit-modelsdev-catalog.ts`（live，非阻断 manual/scheduled）与离线 fixture 版断言
  - 验收：acceptance §C、`Catalogue-wide regression evidence`
- [ ] 6.2 R1–R11 真实回归测试；G1–G24 合成矩阵；每个 delta Scenario → 测试映射表（PR 描述）
- [ ] 6.3 旧测试逐条审查：依赖 rule B / canonical-original-as-authority / relation fan-out / 虚构 relation 字段的用例按新规范改写，并在 PR 列出被改写用例与理由

## 7. 文档与治理（Core）

- [ ] 7.1 README：catalog 输入、`models_dev_provider` 作为 serving 声明、`litellm_params.reasoning_effort` pin 语义、行为变化（保守 limit、档位未知、未登记模型不再借用 reseller 值、价格规则）、迁移说明
- [ ] 7.2 `docs/testing-standard.md` §8：identity precedence 与价格规则改为 canonical registry / serving proof 模型（跨三仓共享权威，PR 内显式标注）
- [ ] 7.3 `docs/decisions.md` 新增 ADR（canonical catalog 采纳、fact classes、未证明记录零供给、Q1 关闭结论、Q2 结论）
- [ ] 7.4 交付门禁：`npm run typecheck`、`bun test`、`npm run build:dist`、`npm run test:package`、`npm run validate:spec`、`npm run test:openspec-closure`
- [ ] 7.5 PR → main（不自行合并）；合并后 `finish_codebase_task`；archive + canonical sync + strict validation

## 8. Downstream（各自仓库另立 change，Core SHA 稳定后）

- [ ] 8.1 Pi：`catalog.json` URL/形状；LKG v8（v7 忽略并重捕获）；diagnostics 字段；fake catalog fixture；Real Pi 0.87.1 E2E；README
- [ ] 8.2 OpenCode：默认 URL 与 `modelsDevUrl` 文档；LKG v8；diagnostics/TUI；fake catalog；Real OpenCode 2.0.16 E2E；README
- [ ] 8.3 两插件 `build:dist` 使用同一 Core SHA；`dist/core-provenance.json` 一致；跨仓 PR 互链与合入顺序
