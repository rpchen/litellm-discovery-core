# litellm-discovery-core

`litellm-discovery-core` 是 LiteLLM 模型发现与元数据处理的宿主无关 TypeScript core。它把 LiteLLM `/v1/model/info` 响应和脱敏的 models.dev catalog 归一化为可供宿主适配层消费的 `ModelSpec[]`。

本仓库不是可直接安装的 Pi 或 OpenCode 插件。`rpchen/pi-litellm-provider` 与 `rpchen/opencode-litellm-provider` 目前尚未迁移到这里；本 PR 只建立 core。后续迁移会在插件的开发／构建阶段获取 `main`，记录实际取得的 commit SHA，再将 core 编译进插件产物。插件运行时不下载本仓库。

## 公共 API

从 `src/index.ts` 导出：

- LiteLLM 地址、部署归一化和 deployment 分组
- `chat` / `responses` / `messages` 协议判定
- models.dev 记录匹配、元数据补缺和推理变体
- 能力、价格、上下文和输出限制映射
- `ModelSpec` 构建与稳定模型指纹

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

本次 PR 保留来源项目已验证的协议选择、能力映射、价格阶梯截断、models.dev 家族匹配、推理变体和指纹语义；没有新增网络请求、轮询、凭据管理、持久化、provider 注册或宿主配置逻辑。插件侧删除重复 core、构建时固定 SHA、发行流程调整属于后续 PR。


## Testing and contribution standard

Behavior changes are complete only when every OpenSpec Scenario has traceable automated evidence. Security/failure boundaries require negative tests, and each new user-visible capability requires at least one vertical automated path. See [docs/testing-standard.md](docs/testing-standard.md) for the shared Core/Pi/OpenCode standard.
