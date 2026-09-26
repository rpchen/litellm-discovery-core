## Why

Pi 和 OpenCode 插件包含重复的 LiteLLM 模型发现与元数据处理逻辑。已确定将宿主无关部分抽取为公开仓库 `rpchen/litellm-discovery-core`，供后续插件在构建阶段获取并编译进产物。

## What Changes

- 新增独立 TypeScript ESM core 和 `src/index.ts` 公共入口。
- 抽取 LiteLLM 归一化、deployment 分组、协议判定、models.dev 匹配、能力／价格／限制映射、推理变体、ModelSpec 构建和指纹。
- 迁移脱敏 fixtures 与 core 回归测试，加入类型检查、构建、声明文件、隔离消费者导入和 GitHub Actions CI。
- 记录来源仓库 commit、架构边界和后续迁移说明。

## Non-Goals

- 不修改 `rpchen/pi-litellm-provider` 或 `rpchen/opencode-litellm-provider`。
- 不新增网络请求、轮询、凭据管理、持久化、provider 注册或宿主配置。
- 不发布 npm、不创建 tag/release、不使用 git submodule。
