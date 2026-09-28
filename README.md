# litellm-discovery-core

`litellm-discovery-core` 是 LiteLLM 模型发现与元数据处理的宿主无关 TypeScript core。它把 LiteLLM `/v1/model/info` 响应和脱敏的 models.dev catalog 归一化为可供宿主适配层消费的 `ModelSpec[]`。

本仓库不是可直接安装的 Pi 或 OpenCode 插件。`rpchen/pi-litellm-provider` 与 `rpchen/opencode-litellm-provider` 已在构建阶段消费本仓库：更新构建解析 core `main` 的实际 commit SHA，把同一份 Core 编译进各自提交的 `dist/` 并记录 provenance。插件安装和运行时不下载本仓库，也不依赖平级源码目录。

## 公共 API

从 `src/index.ts` 导出：

- LiteLLM 地址、部署归一化和 deployment 分组
- `chat` / `responses` / `messages` 协议判定
- models.dev 记录匹配、元数据补缺和推理变体
- 能力、价格、上下文和输出限制映射
- `ModelSpec` 构建与稳定模型指纹
- refresh coordinator：singleflight、短时缓存、退避与 last-known-good
- endpoint-bound discovery snapshot、兼容性检查与 drift comparison
- structured diagnostics：models.dev 命中、协议判定原因、字段 provenance 与 cache source

core 零运行时依赖，不导入 Pi、OpenCode 或其他宿主 SDK；`ModelSpec` 只携带中立的 `protocol`，不携带宿主 package 名称。

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

Core 只负责宿主无关的发现语义和纯数据结构：协议选择、能力/价格/限制映射、models.dev 匹配、推理变体、refresh coordination、snapshot/drift 和 diagnostics。HTTP 请求、轮询定时器、凭据、宿主持久化、provider 注册、命令和 UI 仍由 Pi / OpenCode 适配层负责。


## Testing and contribution standard

Behavior changes are complete only when every OpenSpec Scenario has traceable automated evidence. Security/failure boundaries require negative tests, and each new user-visible capability requires at least one vertical automated path. See [docs/testing-standard.md](docs/testing-standard.md) for the shared Core/Pi/OpenCode standard.
