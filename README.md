# litellm-discovery-core

`litellm-discovery-core` 是 LiteLLM 模型发现与元数据处理的宿主无关 TypeScript core。它把 LiteLLM `/v1/model/info` 响应和脱敏的 models.dev catalog 归一化为可供宿主适配层消费的 `ModelSpec[]`。

本仓库不是可直接安装的 Pi 或 OpenCode 插件。`rpchen/pi-litellm-provider` 与 `rpchen/opencode-litellm-provider` 已在构建阶段消费本仓库：更新构建解析 core `main` 的实际 commit SHA，把同一份 Core 编译进各自提交的 `dist/` 并记录 provenance。插件安装和运行时不下载本仓库，也不依赖平级源码目录。

## 公共 API

从 `src/index.ts` 导出：

- LiteLLM 地址、部署归一化和 deployment 分组
- `chat` / `responses` / `messages` 协议判定
- models.dev 记录匹配、保守 canonical/alias 归一化、元数据补缺和推理变体
- reasoning 支持来源解析，以及 Chat Completions / Responses / both / unknown 协议能力判定
- 能力、价格、context / input / output 限制的确定性合并与冲突说明
- `ModelSpec` 构建与稳定模型指纹
- refresh coordinator：singleflight、短时缓存、退避与 last-known-good
- endpoint-bound discovery snapshot、兼容性检查与 drift comparison；显式多 endpoint 可用稳定 endpoint ID 隔离同 URL/同凭据实例
- structured diagnostics：models.dev 命中、协议判定原因、字段 provenance 与 cache source

core 零运行时依赖，不导入 Pi、OpenCode 或其他宿主 SDK；`ModelSpec` 只携带中立的 `protocol`，不携带宿主 package 名称。

## Discovery quality

PR8 将模型元数据合并规则明确为可预测、可诊断的行为：

- 模型 ID 只归一化路由前缀、大小写、空格/下划线等非语义差异；不会擅自移除 `-free`、日期、规格等后缀。models.dev 记录按“原厂（优先由 `canonical_model_id` 自动识别）→ OpenRouter → OpenCode → 全局唯一匹配”的顺序补充能力；只有剩余记录仍真正歧义时才放弃 enrichment。旧家族规则仅用于缺少 canonical identity 的兼容 catalog。
- LiteLLM 的显式 deployment 元数据优先；models.dev 的主要职责是补充模型能力、限制、模态和 reasoning 信息。多 deployment 的能力按保守交集合并；LiteLLM 明确提供的价格始终优先。若记录仅因为 OpenRouter/OpenCode 等能力 fallback 被选中，其 provider 价格不会被当成当前 LiteLLM deployment 的真实价格。
- `limit.context`、`limit.input`、`limit.output` 分开处理；models.dev 的总 context 不会再因为 LiteLLM 提供了较小的 `max_input_tokens` 而被覆盖。
- reasoning 支持与 reasoning variants 分开判断；`supports_reasoning`、models.dev `reasoning` / `reasoning_options` 的来源和冲突可通过 diagnostics 查看。
- `resolveProtocolSupport()` / `deploymentProtocolSupport()` 用于查看上游协议能力（`chat`、`responses`、`both`、`messages`、`unknown`）；这与实际调用时选择的 `protocol` 是两个概念。
- models.dev 未命中的私有/未知模型仍会保留在 Core 的 neutral discovery/diagnostics 中；若无法得到正数 context/output，Core 会标记为缺少 operational limits，Pi/OpenCode 适配器不得把 `0` 上限直接发布成可用宿主模型。

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

Core 只负责宿主无关的发现语义和纯数据结构：协议选择、能力/价格/限制映射、models.dev 匹配、推理变体、refresh coordination、snapshot/drift 和 diagnostics。多 endpoint 场景下，Core 只定义稳定的 endpoint ID 语法（`[a-z0-9][a-z0-9-_]*`）以及把可选 `endpointID` 纳入 snapshot fingerprint 的隔离语义；HTTP 请求、endpoint 配置来源、activation、轮询定时器、凭据、宿主持久化、provider 注册、命令和 UI 仍由 Pi / OpenCode 适配层负责。省略 `endpointID` 时 fingerprint 材料保持旧版单 endpoint 语义，因此已有 snapshot 不需要迁移。


## Testing and contribution standard

Behavior changes are complete only when every OpenSpec Scenario has traceable automated evidence. Security/failure boundaries require negative tests, and each new user-visible capability requires at least one vertical automated path. See [docs/testing-standard.md](docs/testing-standard.md) for the shared Core/Pi/OpenCode standard.
