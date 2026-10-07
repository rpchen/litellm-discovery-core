# Adopt the models.dev Canonical Catalog

## Why

全面审计（见 `audit.md`）证明：当前 Core 的 models.dev 消费模型与 models.dev 的真实数据模型不一致，这是一个**结构性**问题，而不是 `mimo-v2.6-pro` / `mimo-v2.6-flash` / `minimax-m3` 的个例。

models.dev 当前（repo `sst/models.dev@450aa1d`，2026-10-07）显式分成三层：

- `models.json`：445 个 provider-agnostic canonical 模型（`<lab>/<model>`），只含内禀事实（limit、modalities、tool_call、reasoning、attachment、日期、open_weights…），**不含** `cost`、`reasoning_options`、`provider`、`status`。
- `api.json`：226 个 provider、8418 条 provider-specific serving 记录；只有使用 `base_model` 的记录（63.3%）带 `canonical_model_id`，**first-party lab 记录通常是 inline、无 relation**。
- `catalog.json`：`{ providers, models }` 同一 snapshot；同一时刻抓取时 `catalog.providers` 与 `api.json`、`catalog.models` 与 `models.json` 数据等价（三个响应形状不同，并非字节相同）。

而两个 adapter 生产只拉 `api.json`，Core 从未拿到 canonical registry，只能靠「provider 记录选择」间接推出 identity 与内禀事实。后果（真实 catalog 量化，详见 `audit.md`）：

- 运维者按 canonical 真值声明 limits、使用裸路由时，**52.6%** 的 canonical 模型被 withheld（S2）；即使使用 `lab/model` 限定路由也有 **32.6%**（S4）。
- reseller / free / fast / thinking 变体经 relation fan-out 被选中（230 条变体记录 relation 指向非变体 canonical，其中 126 条 limits 与 canonical 不同）；live 中 `mimo-v2.6-flash` 选中 `opencode/mimo-v2.6-flash-free`（200000/32000）。
- first-party serving override 被当作内禀事实发布（live `kimi-k3` 发布 output 1048576，canonical 为 131072；`deepseek-v4.1-flash` 发布 393216，canonical 为 384000）。
- serving provider 从未被证明时，reseller 的 `reasoning_options` 与 first-party 价格仍进入 `ModelSpec`；运维者已在 `litellm_params` 固定 effort 的模型仍发布 5–6 个可选档位。
- LiteLLM `max_input_tokens`（input capacity）被拿去和 total context 比较，制造伪 discrepancy / 伪 conflict。
- LiteLLM 适配器前缀（`openai/`、`custom_llm_provider`）被当作 lab namespace 证明。
- `buildModelSpecs` 与 `assessModelConfiguration` 是两条独立流水线，gate 与最终配置存在结构性漂移风险。

## What Changes

- **数据获取**：adapter 生产从 `api.json` 迁到 `catalog.json`（单请求、同 snapshot、同 cache epoch / failure domain）；adapter 只 fetch/cache，Core 负责校验 catalog 形状并做全部 identity / authority / merge。
- **四类事实严格分层**：Canonical Model Identity、Intrinsic Model Facts（只来自 `models.json`）、Serving Provider Facts（只在 serving provider 被证明后使用）、Deployment Runtime Constraints（`litellm_params`），外加 LiteLLM descriptive secondary evidence。
- **Canonical identity**：只接受确定性证据——限定 deployment identity 精确命中 registry、registry 裸 ID 唯一精确命中、已证明 serving 记录的 `canonical_model_id`；`0 → no proof`、`1 → proven`、`>1 → ambiguous`。禁止 family/name heuristic，禁止 relation fan-out 选 serving 记录。
- **Serving provider**：只由运维者显式声明（`models_dev_provider`）证明；canonical identity known ≠ serving provider known；LiteLLM 适配器前缀不再证明 namespace。
- **取消未证明记录的供给资格**：无论 canonical 是否存在，未证明的 provider 记录（OpenCode、OpenRouter、unique、first-party、同名精确匹配、变体）都不能提供任何发布事实；未登记模型只能经已声明 serving 记录或完整 LiteLLM 声明发布，否则 withheld；同名记录只作为诊断候选。
- **Wire-ID 解析与证据分离**：route adapter 段与 `custom_llm_provider` 只是解析 wire id 的 parse metadata，永不证明 lab、canonical identity 或 serving provider；证明只来自 registry 精确命中与运维者声明。
- **字段级 resolution matrix**：limit.context/input/output、tools、reasoning support、input/output modalities、reasoning levels、price、release date 逐字段冻结 base 顺序（serving → canonical → litellm-declared → unknown）、缺字段回落、modalities 完整集合语义与 gate 归属。
- **Reasoning controls**：canonical `reasoning=true` 只证明支持推理；可选档位只来自已证明 serving 记录的 `reasoning_options`；`litellm_params.reasoning_effort` 是 operator default（请求可覆盖），永不产生档位或 pin。
- **Runtime Enforcement Matrix**：`litellm_params` 不整体等于 hard constraint；逐键冻结为 hard-enforced / operator default / declared-observable / unknown，只有 hard-enforced 键收窄。
- **无跨维度替代**：`max_input_tokens` 是 input capacity，永不当作 context；LiteLLM-only 无 context 事实即 withheld。
- **Serving view 最终性**：已证明 serving 记录是 models.dev 生成完成的最终视图（含 `base_model_omit` 删除），Core 不重做继承、缺字段不回填 canonical。
- **Identity 矛盾 fail closed**：deployment 证据与已证明 serving 记录的 `canonical_model_id` 指向不同 registry key 时一律 identity conflict，事实相等不构成等价。
- **Single resolver**：新增唯一 `resolveModel()`，`ModelSpec`、publication gate、diagnostics、LKG capture/validation 消费同一份 `ResolvedModel`。
- **LKG schema 8 proof composition（group-wide）**：持久化产生 spec 的证明组合（逐 deployment canonical 证据与 registry 摘要、逐 deployment serving 声明与记录摘要、逐字段 basis、enforcement/LiteLLM 指纹）；整体逐组件重证明，绝不按字段拼接；v≤7 fail closed 后重新捕获。
- **删除**：`resolveInheritedRecord` 的跨 provider 字段继承、rule B（适配器前缀当 namespace）、`canonical-original` 作为 serving 证明、基于 relation fan-out 的选择、OpenCode/OpenRouter/unique 的发布供给、`max_input_tokens → context` 的 LiteLLM-only 替代、`reasoning_effort` 当 pin 的语义。

**BREAKING**（Core 公共 API 与语义）：`SelectedModelRecord.selectionSource` 语义拆分为 identity evidence 与 serving proof；`PUBLICATION_SCHEMA_VERSION = 8`；`buildModelSpecs` 改由 resolver 派生；models.dev 输入从 provider map 变为 catalog。adapter 需随新 Core SHA 迁移（见 design「Downstream impact」）。

## Impact

- Affected specs：新增 `modelsdev-catalog`；修改 `discovery-quality`、`publication`、`discovery-resilience`、`discovery-diagnostics`。
- Affected code（实施阶段，本 change 不实施）：`src/core/modelsdev.ts`、`evidence.ts`、`capabilities.ts`、`build.ts`、`publication.ts`、`diagnostics.ts`、`src/index.ts`；新增 `src/core/catalog-input.ts`、`src/core/resolve.ts`。
- Downstream：Pi / OpenCode 的 `src/net/fetch.ts`（URL 与 catalog 形状）、LKG 持久化迁移、diagnostics 文案；各自独立 OpenSpec change 与 PR，按 Core → adapters 顺序。
- 共享权威：实施时同步修订 `docs/testing-standard.md` §8 的 identity precedence 与价格规则。
- Core 与插件宿主边界不变：Core 不发网络请求，adapter 不复制 identity/authority/merge 逻辑。
