# Adopt the models.dev Canonical Catalog

## Why

全面审计（见 `audit.md`）证明：当前 Core 的 models.dev 消费模型与 models.dev 的真实数据模型不一致，这是一个**结构性**问题，而不是 `mimo-v2.6-pro` / `mimo-v2.6-flash` / `minimax-m3` 的个例。

models.dev 当前（repo `sst/models.dev@450aa1d`，2026-10-07）显式分成三层：

- `models.json`：445 个 provider-agnostic canonical 模型（`<lab>/<model>`），只含内禀事实（limit、modalities、tool_call、reasoning、attachment、日期、open_weights…），**不含** `cost`、`reasoning_options`、`provider`、`status`。
- `api.json`：226 个 provider、8418 条 provider-specific serving 记录；只有使用 `base_model` 的记录（63.3%）带 `canonical_model_id`，**first-party lab 记录通常是 inline、无 relation**。
- `catalog.json`：`{ providers, models }`，与 `api.json` / `models.json` 逐字节一致的同一 snapshot。

而两个 adapter 生产只拉 `api.json`，Core 从未拿到 canonical registry，只能靠「provider 记录选择」间接推出 identity 与内禀事实。后果（真实 catalog 量化，详见 `audit.md`）：

- 运维者按 canonical 真值声明 limits、使用裸路由时，**52.6%** 的 canonical 模型被 withheld（S2）；即使使用 `lab/model` 限定路由也有 **32.6%**（S4）。
- reseller / free / fast / thinking 变体经 relation fan-out 被选中（230 条变体记录 relation 指向非变体 canonical，其中 126 条 limits 与 canonical 不同）；live 中 `mimo-v2.6-flash` 选中 `opencode/mimo-v2.6-flash-free`（200000/32000）。
- first-party serving override 被当作内禀事实发布（live `kimi-k3` 发布 output 1048576，canonical 为 131072；`deepseek-v4.1-flash` 发布 393216，canonical 为 384000）。
- serving provider 从未被证明时，reseller 的 `reasoning_options` 与 first-party 价格仍进入 `ModelSpec`。
- LiteLLM `max_input_tokens`（input capacity）被拿去和 total context 比较，制造伪 discrepancy / 伪 conflict。
- LiteLLM 适配器前缀（`openai/`、`custom_llm_provider`）被当作 lab namespace 证明。
- `buildModelSpecs` 与 `assessModelConfiguration` 是两条独立流水线，gate 与最终配置存在结构性漂移风险。

## What Changes

- **数据获取**：adapter 生产从 `api.json` 迁到 `catalog.json`（单请求、同 snapshot、同 cache epoch / failure domain）；adapter 只 fetch/cache，Core 负责校验 catalog 形状并做全部 identity / authority / merge。
- **四类事实严格分层**：Canonical Model Identity、Intrinsic Model Facts（只来自 `models.json`）、Serving Provider Facts（只在 serving provider 被证明后使用）、Deployment Runtime Constraints（`litellm_params`），外加 LiteLLM descriptive secondary evidence。
- **Canonical identity**：只接受确定性证据——限定 deployment identity 精确命中 registry、registry 裸 ID 唯一精确命中、已证明 serving 记录的 `canonical_model_id`；`0 → no proof`、`1 → proven`、`>1 → ambiguous`。禁止 family/name heuristic，禁止 relation fan-out 选 serving 记录。
- **Serving provider**：只由运维者显式声明（`models_dev_provider`）证明；canonical identity known ≠ serving provider known；LiteLLM 适配器前缀不再证明 namespace。
- **Fallback 重定义**：canonical 已存在时，未证明的 reseller 记录**不得**补任何 intrinsic fact 或 operational config；只有 canonical 不存在（私有/未登记模型）时，按精确 wire-id 匹配的 fallback-serving 才可补缺，且永不提供价格与推理档位。
- **Effective limits 代数**：intrinsic → proven serving override → runtime constraint 收窄；descriptive 只在无 intrinsic 时补缺，否则为 resolved discrepancy；维度严格对齐（`max_input_tokens` 只比 input）。
- **Single resolver**：新增唯一 `resolveModel()`，`ModelSpec`、publication gate、diagnostics、LKG capture/validation 消费同一份 `ResolvedModel`。
- **LKG schema 8**：持久化 canonical identity 与 serving proof 分离的形状；v≤7 全部 fail closed 后重新捕获。
- **删除**：`resolveInheritedRecord` 的跨 provider 字段继承、rule B（适配器前缀当 namespace）、`canonical-original` 作为 serving 证明、基于 relation fan-out 的 OpenCode/OpenRouter/unique 选择。

**BREAKING**（Core 公共 API 与语义）：`SelectedModelRecord.selectionSource` 语义拆分为 identity evidence 与 serving proof；`PUBLICATION_SCHEMA_VERSION = 8`；`buildModelSpecs` 改由 resolver 派生；models.dev 输入从 provider map 变为 catalog。adapter 需随新 Core SHA 迁移（见 design「Downstream impact」）。

## Impact

- Affected specs：新增 `modelsdev-catalog`；修改 `discovery-quality`、`publication`、`discovery-resilience`、`discovery-diagnostics`。
- Affected code（实施阶段，本 change 不实施）：`src/core/modelsdev.ts`、`evidence.ts`、`capabilities.ts`、`build.ts`、`publication.ts`、`diagnostics.ts`、`src/index.ts`；新增 `src/core/catalog-input.ts`、`src/core/resolve.ts`。
- Downstream：Pi / OpenCode 的 `src/net/fetch.ts`（URL 与 catalog 形状）、LKG 持久化迁移、diagnostics 文案；各自独立 OpenSpec change 与 PR，按 Core → adapters 顺序。
- 共享权威：实施时同步修订 `docs/testing-standard.md` §8 的 identity precedence 与价格规则。
- Core 与插件宿主边界不变：Core 不发网络请求，adapter 不复制 identity/authority/merge 逻辑。
