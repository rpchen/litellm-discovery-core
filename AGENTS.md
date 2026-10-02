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
5. **测试、文档与 OpenSpec 完成标准**：必须遵守 `docs/testing-standard.md`。OpenSpec 每个 Scenario 必须有可追踪自动化证据；安全/失败边界必须有负向测试；新增用户可见能力至少有一条纵向链路。凡公共 API、消费方式或其他用户可见行为发生变化，必须在同一 PR 更新 README；无用户影响时 PR 必须明确声明。禁止仅因 CI 全绿就宣称变更已闭环；已完成 change 必须在 task 状态与证据一致后通过 OpenSpec CLI archive，同步 canonical specs 后再次 strict validation。
6. **Discovery 质量原则**：模型能力与可用性优先于价格完整性；models.dev provider fallback、价格安全和 operational-limit 发布边界遵守 `docs/testing-standard.md` 第 8 节，不得靠新增硬编码家族修复新模型，也不得把 0 context/output 直接交给宿主。
7. **会话/发版收尾**：每次完成用户可见改动后按 `docs/testing-standard.md` 第 10 节检查版本、README、tag/Release、附件与临时自动化清理；跨会话开工与会话结束还必须执行第 11 节事实基线/retrospective，并确保一次更新构建只使用一个 Core SHA。使用 conventional commits。不要在本仓库修改两个插件仓库。

## codebase-memory

仅在本 Git 根目录存在 `.codebase-memory/artifact.json` 时使用索引；结构查询先发现图谱工具并确认 project/root/status。新仓库不得自动建索引。Release 必须生成对应不可变 tag SHA 的图谱附件并回读校验；日常客户端启动按当前检出代码刷新工作索引。流程见 `docs/codebase-memory.md`。

## Claude Code OpenSpec

Claude Code 使用已入库的 `.claude/skills/` 发现 OpenSpec skills；这些入口由官方 `openspec init --tools claude` 生成，不手工独立维护流程。升级时用 `openspec update --force` 刷新已配置目标并审阅差异。`CLAUDE.md` 仅导入本文件，项目规则以本文件为真源。
