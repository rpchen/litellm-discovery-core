# litellm-discovery-core

`litellm-discovery-core` 是 LiteLLM 模型发现与元数据处理的宿主无关 TypeScript core。它把 LiteLLM `/v1/model/info` 响应和脱敏的 models.dev catalog 归一化为可供宿主适配层消费的 `ModelSpec[]`。

本仓库不是可直接安装的 Pi 或 OpenCode 插件。`rpchen/pi-litellm-provider` 与 `rpchen/opencode-litellm-provider` 已在构建阶段消费本仓库：更新构建解析 core `main` 的实际 commit SHA，把同一份 Core 编译进各自提交的 `dist/` 并记录 provenance。插件安装和运行时不下载本仓库，也不依赖平级源码目录。

## 公共 API

从 `src/index.ts` 导出：

- LiteLLM 地址、部署归一化和 deployment 分组
- `chat` / `responses` / `messages` 协议判定
- models.dev canonical registry identity 与 serving provider/record 解析、字段级
  resolution matrix（serving → canonical → litellm-declared → unknown）、推理档位
  与 Operator-Declared Pricing、证据 provenance
- reasoning 支持三态解析，以及 Chat Completions / Responses / both / unknown 协议能力判定
- `ModelSpec` 构建（唯一构造器 `toModelSpec`）与稳定模型指纹
- trusted Last Known Good 的捕获/校验/失效判定，以及 partial catalog、regression、recovery 与 acknowledgement 领域事实（`src/core/catalog.ts`）
- refresh coordinator：singleflight、短时缓存、退避与 last-known-good
- endpoint-bound discovery snapshot、兼容性检查与 drift comparison；显式多 endpoint 可用稳定 endpoint ID 隔离同 URL/同凭据实例
- structured diagnostics：models.dev 命中、协议判定原因、字段 provenance 与 cache source

core 零运行时依赖，不导入 Pi、OpenCode 或其他宿主 SDK；`ModelSpec` 只携带中立的 `protocol`，不携带宿主 package 名称。

## Discovery quality

Core 消费 models.dev `catalog.json`（`{ providers, models }` 同一 snapshot）：
`models` 是唯一的 canonical registry（内禀事实），`providers` 是 serving
记录来源。适配器只 fetch/cache 原始 JSON，形状校验、identity、authority、
merge 全在 Core。

- **Canonical identity 只来自 registry 精确证明**：deployment 限定值精确命中
  registry key（`qualified-deployment`）、adapter 解析余串精确命中、裸值唯一命中
  （`registry-unique`），或已证明 serving 记录的 `canonical_model_id`
  （`serving-relation`，只证明 identity、不解析 SKU）。`0 → 无证明`、
  `1 → proven`、`>1 → ambiguous`。family/前缀/子串、relation fan-out、
  `model_name`、`custom_llm_provider`、`api_base` 都不是证据。
- **Serving provider 只由运维者显式声明证明**：组内所有 deployment 声明同一
  `model_info.models_dev_provider` 且该 provider 存在于 catalog。LiteLLM 适配器
  前缀（`openai/` 等）不再证明 namespace 或 serving。
- **Serving record 需精确 SKU 命中**：只当 provider 内某条记录的 key/id 精确等于
  解析后的 wire id 才 resolve。仅 relation 指向 canonical 的记录（`-free` /
  `-fast` / `:thinking` / tier 变体）永不提供 serving facts；此时整组按
  serving-unproven 解析并诊断 `serving-record-unresolved`。声明的 provider
  不存在或无记录时为 `declared-unmatched`（warning + 按未证明解析）。
- **未证明记录零供给**：无论 canonical 是否存在，未证明的 provider 记录
  （OpenCode、OpenRouter、unique、first-party、同名精确匹配、变体）都不提供
  任何发布事实（limits、modalities、tools、reasoning、档位、价格、release）。
  未登记模型只能经已声明 serving 记录发布；仅靠 LiteLLM 声明时 context 无法
  声明（G30）→ withheld。同名记录只作为诊断候选
  （OpenCode → OpenRouter → 其余排序）列出可用的声明。serving provider 证明
  是**组级**证明：组内所有 deployment 必须声明同一 `models_dev_provider`，
  部分声明按未证明处理。
- **字段级 resolution matrix**：每字段独立按分支解析——serving 已证明且记录有值
  → serving；否则 canonical 有值 → canonical；否则 LiteLLM 全员一致声明 →
  `litellm-declared`；否则 unknown。serving 记录是最终 serving 视图（models.dev
  已完成 base merge 与 `base_model_omit` 删除）：缺字段**永不回填 canonical**，
  只允许**同维度** LiteLLM 声明补缺（serving 无 `limit.input` 而 LiteLLM 有
  `max_input_tokens` → input 为 `litellm-declared`），否则 unknown。
  与 serving/canonical base 不同的 LiteLLM 声明记为 resolved discrepancy；
  跨 deployment 显式不一致记为 unresolved conflict。
- **无跨维度替代**：`model_info.max_input_tokens` 是 input capacity，**任何分支**
  （含 LiteLLM-only）都永不当作 `limit.context`：无 context 证据即 missing →
  withheld（G30）。`limit.input` 缺失即 unknown，
  绝不等于 context（非 gated，不 withheld）。
- **Proven Runtime Enforcement（空证明集）**：全部非价格 `litellm_params` 键
  （含 `max_input_tokens`、`max_tokens` 系、`reasoning_effort`、modality flags、
  `supports_*`）当前均为 **operator configuration**：不收窄、不产生事实、不进
  LKG 指纹，只进诊断。晋升需 OpenSpec delta（含 LiteLLM 源码 exact source path
  + 负向突破测试）。7 个 `MirroredPricingParams` 价格键是独立的
  **Operator-Declared Pricing**：`litellm_params` 先于 `model_info`、多 deployment
  取最高，其次已证明 serving 记录 `cost`，否则 unknown（0）；价格键永不收窄能力字段。
- **推理档位只来自已证明 serving 记录的 `reasoning_options`**（`unknown` /
  `known` 可为空两态，非 gated）。canonical `reasoning: true` 只证明支持推理；
  `litellm_params.reasoning_effort` 是 operator configuration（请求可覆盖），永不
  pin/产生档位/收窄；`supports_*_reasoning_effort` / `reasoning_effort_levels` /
  `supported_openai_params` / `allowed_openai_params` 只诊断。
- **Single resolver**：每组一次 `resolveModel()` 得到 `ResolvedModel`
  （identity + parse metadata、serving、逐字段 basis/evidence、档位状态、诊断候选、
  publication verdict、LKG proof）；`ModelSpec`（唯一构造器 `toModelSpec`）、
  publication gate、diagnostics、LKG capture/validation 全由此派生，不再漂移。
- **LKG schema 8 proof composition（group-wide）**：逐 deployment 证据项
  （`model_info.id` 或证据 multiset 派生键、归一化输入 multiset、identityKind
  `canonical` / `litellm-only` / `serving-only`）、registry 摘要（仅 canonical
  basis 参与时）、serving 声明 + 记录摘要、逐字段 basis、空 enforcement 指纹、
  LiteLLM 指纹（仅 litellm-declared 参与时）。恢复逐组件重证明、整份恢复或整体
  fail closed，绝不按字段拼接；v7 及更早版本 fail closed 后由 live 自动重捕获。
  显式声明为非正数的 model-level context/output 是非法元数据（`invalid-metadata`），
  不会被当成 missing。
- 可信 group identity 保留 provider namespace：`openai/foo`、`anthropic/foo` 与
  无前缀 `foo` 是不同身份；每 deployment 都必须有正面身份证据（`model_name`
  永不替代），reconciliation 与 deployment 顺序无关。
- 只有在本轮完整通过 publication gate 的 `ModelSpec` 才能成为 Last Known Good；
  恢复时逐字段证明 captured facts 与存储的 `ModelSpec` 一致，并按同维度比较新
  live facts。live 冲突只看 authoritative intrinsic 事实：低权威描述性差异不再
  使快照失效；identity/provider/schema 变化、任何 live illegal limit 整份 fail
  closed，不复活 LiteLLM 已不再提供的模型。
- models.dev 未命中的私有/未知模型仍会保留在 Core 的 neutral discovery/diagnostics
  中；LiteLLM 声明完整即按 `litellm-declared` 发布，若无法得到正数 context/output，
  Core 会标记为缺少 operational limits，Pi/OpenCode 适配器不得把 `0` 上限直接发布
  成可用宿主模型。

### 行为变化（迁移说明）

- **DeepSeek 输出 393216 → 384000**（R4/R4b/R4c，design Risks 显式确认）：
  仅当同时声明 `models_dev_provider: deepseek` **且** wire id 精确命中某条 SKU
  record（如 route `deepseek/deepseek-flash` + `custom_llm_provider: deepseek`）
  才恢复 serving 值 393216；仅声明 provider 而无 exact SKU 仍是 canonical 384000。
- **推理档位消失**：serving 未证明时一律 levels unknown、无 variants（此前
  13 个模型发布 reseller/first-party 档位）。恢复方式：声明 `models_dev_provider`。
- **kimi-k3 输出 1048576 → 131072**：first-party serving override 不再当内禀发布。
- **无 proven enforcement**：`litellm_params` 非价格键不再收窄任何字段（含
  `max_input_tokens`）；运维者若依赖旧收窄行为，需改用 LiteLLM 描述性声明或
  等待晋升 delta。
- **LiteLLM-only 更严格**：canonical 未证明、无 serving 的私有模型，`max_input_tokens`
  只是 input capacity，**绝不充当 `limit.context`**（维度隔离无 LiteLLM-only 例外，
  G30/design Risks）：无 context 语义声明即 context missing → withheld；此前 main
  「拿 `max_input_tokens` 当 context」的发布路径（旧 R11 lenient 语义）已按冻结设计
  撤销，outage/providers-only 期间同样只有有效 LKG 可恢复。
- **serving 缺字段不回填**：resolved serving 缺字段（如 `base_model_omit` 删除的
  `limit.input`）不再用 canonical 回填；有同维度 LiteLLM 声明则补缺，否则 unknown。
- **LKG 一次性 fail closed**：升级后首轮 outage 期间旧 v7 条目不恢复，下一轮 live
  自动重捕获为 v8。
- **`catalog.json` 迁移**：adapter 默认 URL 改为 `https://models.dev/catalog.json`；
  自建 provider-only（`api.json` 形状）镜像按 D2 fail closed（不做 canonical 解析，
  无 canonical identity 即 context missing → 全部 withheld，有效 LKG 可恢复），仅作诊断提示。

### Evidence source authority 与本轮语义

```
evidence collection
  → canonical identity resolution
  → field semantics
  → source authority
  → selected | resolved-discrepancy | unresolved-conflict | unknown | missing | illegal
```

- **Publication gate 绝不降低**：模型只有 `configured` / `configured-lkg` 才能进入宿主；没有 user confirmation、override 或 model-level degraded publication 路径。一个模型 withheld 不影响同一 endpoint 的其他模型。
- **Partial catalog 是正常结果**：`17 publishable / 3 withheld` 立即发布 17 个，3 个在 diagnostics 中连同原因可见；`discovered > 0 && publishable = 0` 表达为 `unusable` catalog。
- **Regression / recovery**：previously published 模型变 withheld 记为 regression；withheld 模型重新满足 gate 后自动发布，无需用户批准。
- **Acknowledgement 只影响提醒**：fingerprint 由 withheld 模型身份与实质原因组成（排除时间戳/计数/错误文本细节），完全恢复即清除；它从不参与 `publishable(model)`。

### 证据来源审计（发布相关字段）

| 字段 | canonical/serving 高权威 | LiteLLM 描述性（declared-observable） | operator configuration（只诊断） |
|---|---|---|---|
| identity | registry 精确命中（qualified-deployment / registry-unique / serving-relation） | —（`model_name`、family、前缀永不作证据） | route adapter 段、`custom_llm_provider`（仅 parse metadata） |
| serving provider | `models_dev_provider` 全员一致声明 + provider 存在 | — | route 段、`custom_llm_provider`、`api_base` 永不证明 |
| serving record | provider 内 key/id 精确命中 wire id | — | relation-only 记录（变体）永不解析 SKU |
| context | serving `limit.context` → registry `limit.context` | —（无 LiteLLM context 键；`max_input_tokens` 在任何分支都不充当 context） | `litellm_params.max_input_tokens`（不收窄、不比较） |
| output | serving → registry `limit.output` | `model_info.max_output_tokens` / `max_tokens` | `litellm_params.max_tokens` 系（不收窄） |
| input capacity | serving → registry `limit.input`，否则同维度 LiteLLM 补缺 | `model_info.max_input_tokens` | `litellm_params.max_input_tokens`（不收窄） |
| input/output modalities | serving → registry 完整集合 | 每维度 flag 全员显式声明才 known | `litellm_params` 同名键（不增删） |
| tools | serving → registry `tool_call` | `model_info.supports_function_calling` | `litellm_params.supports_function_calling`（不决定） |
| reasoning | serving → registry `reasoning` | `model_info.supports_reasoning` | `litellm_params.supports_reasoning`（不决定） |
| reasoning levels | 仅已证明 serving `reasoning_options` | —（`supports_*_reasoning_effort` 等只诊断） | `litellm_params.reasoning_effort`（不产生档位） |
| price（逐组件） | 已证明 serving `cost`（仅 LiteLLM 未声明的组件） | `model_info` 价格键 | `litellm_params` 7 个 `MirroredPricingParams` 价格键（最高优先，独立事实） |
| release date | resolved serving → registry `release_date`（缺失不回填） | — | — |

规则：跨 deployment 的**显式不一致**始终是 unresolved conflict（模型级记录无法证明宿主请求会落到哪条 route），即使存在高权威内禀值；authority 只裁决「deployment 之间一致」与「模型级记录」之间的差异。Proven Runtime Enforcement 证明集当前为空：晋升单个键需 OpenSpec delta（含 exact source path + 负向突破测试）。

## 开发

```sh
npm install
npm run typecheck
bun test
npm run build:dist
npm run test:package
npm run validate:spec
```

测试完全离线，使用 `test/fixtures/` 中的脱敏 LiteLLM 和 models.dev 样本，不读取 LiteLLM 凭据或插件配置。

## 范围

Core 只负责宿主无关的发现语义和纯数据结构：协议选择、能力/价格/限制映射、models.dev 匹配、推理变体、refresh coordination、snapshot/drift 和 diagnostics。多 endpoint 场景下，Core 只定义稳定的 endpoint ID 语法（`[a-z0-9][a-z0-9-_]*`）以及把可选 `endpointID` 纳入 snapshot fingerprint 的隔离语义；endpoint ID 是适配器传入的稳定身份，Core 不会规范化或重写它；HTTP 请求、endpoint 配置来源、activation、轮询定时器、凭据、宿主持久化、provider 注册、命令和 UI 仍由 Pi / OpenCode 适配层负责。省略 `endpointID` 时 fingerprint 材料保持旧版单 endpoint 语义，因此已有 snapshot 不需要迁移。


## Testing and contribution standard

Behavior changes are complete only when every OpenSpec Scenario has traceable automated evidence. Security/failure boundaries require negative tests, and each new user-visible capability requires at least one vertical automated path. See [docs/testing-standard.md](docs/testing-standard.md) for the shared Core/Pi/OpenCode standard.

## 开发代码索引

已入库的代码图谱使用与跨客户端配置、Release 附件及本地同步方式见 [docs/codebase-memory.md](docs/codebase-memory.md)。索引工具不属于插件运行时依赖。发布索引必须明确成功，降级结果会阻止导出；本地工作索引按当前 Git 根目录识别，并由客户端持久 MCP 会话跟踪修改。

## Claude Code OpenSpec

在本仓库启动 `claude`，可发现 `.claude/skills/` 中的 6 个 OpenSpec skills：propose、explore、apply-change、update-change、sync-specs、archive-change（命令名均以 `openspec-` 开头）。例如 `/openspec-propose "变更目标"` 创建提案；审阅后再用 `/openspec-apply-change <change-name>` 实施。描述供 Claude 按任务匹配，实际是否自动调用以工具记录为准。

入口由 OpenSpec CLI 1.13.2 生成并入库；新 clone 无需重复初始化。新增 Claude 入口用 `openspec init --tools claude --no-animation`；升级用 `openspec update --force` 刷新已配置目标并审阅差异。`CLAUDE.md` 导入 [AGENTS.md](AGENTS.md)，不复制项目规则。

## 每次 PR 后的代码索引

已显式选择的仓库在每个 main 提交通过完整 CI 后，将准确 SHA 的索引发布到 `codebase-memory-index` 分支。新任务先用 `prepare_codebase_task` 同步最新 main 和对应索引；授权合并后用 `finish_codebase_task` 验证本地与远端一致。四客户端共用这两个 MCP 工具，原生工作缓存不会进入源码 PR。详见 [代码索引流程](docs/codebase-memory.md)。

### main 索引同步的安全检查

新任务/合并收尾会在索引下载后及返回 ready 前重新核验远端 main，记录最终核验时刻；分支或源码并发变化会保留工作并失败。发布任务按完整 SHA 隔离排队，快照从固定干净检出生成。已选择子仓的损坏 metadata 会阻止整体 ready；缺失工作 artifact 必须成功恢复。共享缓存竞争只复用完整且身份/校验一致的赢家。四客户端共用 MCP 失败门禁；每次新任务调用 prepare 仍需代理遵循 AGENTS，不能把安装配置当作宿主级强制任务拦截。详见 [索引说明](docs/codebase-memory.md#本轮审核后的同步安全边界)。
