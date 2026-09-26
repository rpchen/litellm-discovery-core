# AGENTS.md

本仓库维护宿主无关的 LiteLLM discovery core。变更流程由 `openspec/config.yaml` 管理。

## 目录

- `src/core/`：LiteLLM 归一化、协议判定、models.dev 匹配、能力映射与 ModelSpec 构建。
- `src/index.ts`：唯一公共入口，导出 core 的函数与类型。
- `test/`：Bun 离线单元测试和脱敏 fixtures。
- `docs/`：源码溯源与架构决策。
- `openspec/`：在途变更和规格。

## 规则

1. 不得导入 Pi、OpenCode 或其他宿主 SDK；core 必须保持零运行时依赖。
2. 测试 fixtures、文档和日志不得写入密钥或真实内网地址。
3. 临时文件放 `.tmp/`；需要保留的脚本放 `scripts/`，正式文档放 `docs/`。
4. 使用 `npm run typecheck`、`bun test`、`npm run build:dist` 和 `npm run test:package` 验证变更。
5. 使用 conventional commits。不要在本仓库修改两个插件仓库。
