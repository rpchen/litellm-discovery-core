# litellm-discovery-core

`litellm-discovery-core` 是 LiteLLM 模型发现与元数据处理的宿主无关 TypeScript core。它把 LiteLLM `/v1/model/info` 响应和脱敏的 models.dev catalog 归一化为可供宿主适配层消费的 `ModelSpec[]`。

本仓库不是可直接安装的 Pi 或 OpenCode 插件。`rpchen/pi-litellm-provider` 与 `rpchen/opencode-litellm-provider` 已在构建阶段消费本仓库：更新构建解析 core `main` 的实际 commit SHA，把同一份 Core 编译进各自提交的 `dist/` 并记录 provenance。插件安装和运行时不下载本仓库，也不依赖平级源码目录。

## 公共 API

从 `src/index.ts` 导出：

- LiteLLM 地址、部署归一化和 deployment 分组
- `chat` / `responses` / `messages` 协议判定
- models.dev 记录匹配、保守 canonical/alias 归一化、元数据补缺和推理变体
- reasoning 支持来源解析，以及 Chat Completions / Responses / both / unknown 协议能力判定
- 能力、价格、context / input / output 限制的确定性合并、证据 provenance 与 [source authority](#evidence-source-authority-与本轮语义) 解析
- `ModelSpec` 构建与稳定模型指纹
- trusted Last Known Good 的捕获/校验/失效判定，以及 partial catalog、regression、recovery 与 acknowledgement 领域事实（`src/core/catalog.ts`）
- refresh coordinator：singleflight、短时缓存、退避与 last-known-good
- endpoint-bound discovery snapshot、兼容性检查与 drift comparison；显式多 endpoint 可用稳定 endpoint ID 隔离同 URL/同凭据实例
- structured diagnostics：models.dev 命中、协议判定原因、字段 provenance 与 cache source

core 零运行时依赖，不导入 Pi、OpenCode 或其他宿主 SDK；`ModelSpec` 只携带中立的 `protocol`，不携带宿主 package 名称。

## Discovery quality

PR8 将模型元数据合并规则明确为可预测、可诊断的行为：

- 模型 ID 只归一化路由前缀、大小写、空格/下划线等非语义差异；不会擅自移除 `-free`、日期、规格等后缀。models.dev 记录按“原厂（优先由 `canonical_model_id` 自动识别）→ OpenRouter → OpenCode → 全局唯一匹配”的顺序补充能力；只有剩余记录仍真正歧义时才放弃 enrichment。旧家族规则仅用于缺少 canonical identity 的兼容 catalog。
- **证据权威而不是「谁先声明」**：canonical identity 可靠解析后，模型内禀事实（context/output、modalities、vision/audio/video/pdf、tools、reasoning）以 models.dev 为高权威来源；LiteLLM `model_info` 的同类字段是描述性 secondary evidence；只有运维者部署配置 `litellm_params` 中可证明 endpoint 实际 enforce 的键才是 deployment runtime constraint，并且只能收窄 effective 值。字段名本身不构成 hard cap。
- 可裁决的差异记为 **resolved discrepancy** 并保留证据，模型继续 publication assessment；真正无法按 authority 裁决的冲突记为 **unresolved conflict** 并 withheld。LiteLLM 明确提供的价格始终优先；若记录仅因为 OpenRouter/OpenCode 等能力 fallback 被选中，其 provider 价格不会被当成当前 LiteLLM deployment 的真实价格。
- `limit.context`、`limit.input`、`limit.output` 分开处理；models.dev 的总 context 不会再因为 LiteLLM 提供了较小的 `max_input_tokens` 而被覆盖。显式声明为非正数的 model-level context/output 是非法元数据（`invalid-metadata`），不会被当成 missing。
- 可信 group identity 保留 provider namespace：`openai/foo`、`anthropic/foo` 与无前缀 `foo` 是不同身份，只有确定性 metadata（显式 `models_dev_provider`、canonical/alias/equivalent/inherits 关系）才能消歧，且 reconciliation 与 deployment 顺序、关系声明方向无关。
- 只有在本轮完整通过 publication gate 的 `ModelSpec` 才能成为 Last Known Good；快照保存 tools/reasoning verdict、实际 modality sets 与 context/input/output 数值；恢复时逐字段证明 captured facts 与存储的 `ModelSpec` 一致，并按同维度比较新 live facts（input capacity 不与 total context 错比）。live 冲突只看 authoritative intrinsic 事实与 proven runtime constraint：低权威描述性差异不再使快照失效；proven constraint 与快照不一致时整份 fail closed，不复活 LiteLLM 已不再提供的模型。`PUBLICATION_SCHEMA_VERSION` 随 captured 形状/语义变化递增。LKG restoration uses the same provider-qualified identity rules as live publication and refuses groups with unproven deployment identity — identity validity is decided from the deployments alone, so it holds even when metadata sources are unavailable.
- reasoning 支持与 reasoning variants 分开判断（reasoning capability domain 的进一步重构属于后续独立变更）；`supports_reasoning`、models.dev `reasoning` / `reasoning_options` 的来源和冲突可通过 diagnostics 查看。
- `resolveProtocolSupport()` / `deploymentProtocolSupport()` 用于查看上游协议能力（`chat`、`responses`、`both`、`messages`、`unknown`）；这与实际调用时选择的 `protocol` 是两个概念。
- models.dev 未命中的私有/未知模型仍会保留在 Core 的 neutral discovery/diagnostics 中；若无法得到正数 context/output，Core 会标记为缺少 operational limits，Pi/OpenCode 适配器不得把 `0` 上限直接发布成可用宿主模型。

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

| 字段 | 模型内禀高权威 | LiteLLM 描述性 | deployment constraint（可收窄） |
|---|---|---|---|
| identity | `canonical_model_id` / alias / equivalent / inherits（先于 metadata authority 作为门禁） | `models_dev_provider`、`base_model`、路由前缀 | — |
| context | models.dev `limit.context`（总窗口） | `model_info.max_input_tokens`（仅当无总窗口时作为保守 fallback） | `litellm_params.max_input_tokens`（收窄 input 维度） |
| output | models.dev `limit.output` | `model_info.max_output_tokens` / `max_tokens` | `litellm_params.max_tokens` / `max_output_tokens` / `max_completion_tokens` |
| input capacity | models.dev `limit.input`，否则总 context | `model_info.max_input_tokens` | `litellm_params.max_input_tokens` |
| input modalities (text/image/pdf/audio/video) | models.dev `modalities.input` 完整集合 | `model_info.supports_vision` / `supports_pdf_input` / `supports_audio_input` / `supports_video_input` | `litellm_params` 同名键的显式 `false`（只能移除） |
| output modalities (text/audio) | models.dev `modalities.output` | `model_info.supports_audio_output` | `litellm_params.supports_audio_output=false` |
| tools | models.dev `tool_call` | `model_info.supports_function_calling` | `litellm_params.supports_function_calling=false` |
| reasoning | models.dev `reasoning` / `reasoning_options`（support 与 levels 分离） | `model_info.supports_reasoning` | `litellm_params.supports_reasoning=false` |

规则：跨 deployment 的**显式不一致**始终是 unresolved conflict（模型级记录无法证明宿主请求会落到哪条 route），即使存在 authoritative intrinsic 值；authority 只裁决「deployment 之间一致或沉默」与「模型级记录」之间的差异。

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
