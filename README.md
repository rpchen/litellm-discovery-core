# litellm-discovery-core

`litellm-discovery-core` 是 LiteLLM 模型发现与元数据处理的宿主无关 TypeScript core。它把 LiteLLM `/v1/model/info` 响应和脱敏的 models.dev catalog 归一化为可供宿主适配层消费的 `ModelSpec[]`。

本仓库不是可直接安装的 Pi 或 OpenCode 插件。`rpchen/pi-litellm-provider` 与 `rpchen/opencode-litellm-provider` 已在构建阶段消费本仓库：更新构建解析 core `main` 的实际 commit SHA，把同一份 Core 编译进各自提交的 `dist/` 并记录 provenance。插件安装和运行时不下载本仓库，也不依赖平级源码目录。

## 公共 API

Core 从 src/index.ts 导出发现入口、协议选择、models.dev 选择、ModelSpec、发布判定、LKG、refresh coordinator、endpoint snapshot 和 diagnostics。Core 不引用宿主 SDK，也不管理凭据或持久化。

## 模型元数据

LiteLLM model_name 原样作为模型 ID、显示名和请求名。完整 canonical 名称、唯一裸名称及明确 canonical_model_id 关系用于查找；保留版本、日期和 SKU，不用内部 route、base_model 或 models_dev_provider 证明模型身份。

按 **官方服务商 → OpenCode → OpenRouter** 选择一条明确对应的完整记录。官方服务商由 canonical owner 和已核实的组织别名识别（tencent → tencent-tokenhub、zhipuai → zai）。官方 API 名称可以不同，但必须有明确 canonical 关系。不同日期或 free/pro SKU 不替代原型号。

没有精确 API 名称匹配、需要通过官方 canonical 关系找别名时，排除 `status=deprecated` 的记录；精确指定 deprecated API 名称仍可匹配。例如 `deepseek-v4.1-flash` 使用官方 `deepseek-flash`，精确指定 `deepseek-v4-flash` 仍使用该旧 API 的记录。

选中记录独立提供 tools、reasoning、modalities、limit、reasoning_options、release_date 和参考价格；缺字段不从 canonical、其他服务商或 LiteLLM 回填。false 是明确不支持，缺失为未知。发布仍要求有限正 context/output、明确 tools/reasoning 及非空已知输入/输出模态；可选 input/release/price 不阻止发布。input capacity 不充当 context。

推理支持和档位分开：reasoning=false 不支持；true 且没有 effort 选项表示支持但无可选档位；true 且有 effort 则只使用该记录的 values。没有统一 GPT 档位模板。既有协议选择、mixed fallback、override 和 Messages 映射保持不变。

价格只是选中记录的参考值：每项有限非负 cost 可显示，其余为 0（表示无有效价格，不能据此认定免费）。价格不影响发布、LKG、能力通知或模型限制。**contextTierCap 已废弃，暂接受但忽略**；价格阶梯不再截断 context/output。

## 发布与恢复

仅 configured / configured-lkg 发布；一个模型缺少关键能力不影响其他模型。Partial catalog、regression/recovery、重试、取消、认证失败、成功空清单和 acknowledgement 的既有行为保留，acknowledgement 仅影响提醒。

LKG 继续使用 endpoint/凭据 scope、model_name、有效关键配置、schema 和内容校验。内部路由、deployment ID、serving 声明和价格不参与恢复有效性；价格损坏归零。恢复整份关键配置和宿主使用的 reasoning/tools 判定，不复活已删除模型；年龄仅展示。

**升级需要一次成功刷新**：publication schema 8→9、discovery snapshot 1→2。旧策略已保存空档位和截断上限，旧缓存不能作为新配置离线恢复；刷新成功后自动重建。插件适配需先合入 Core，再用同一完整 SHA 构建 dist。

默认 diagnostics 提供配置状态、所选公开来源、推理支持/档位和实际错误。主动审计可查看公开 canonical/record 引用及最终配置；输出不包含原始凭据、内部地址、候选服务商证明或 models_dev_provider 修复提示。

公开字段解析 helper 保留兼容入口并委托同一 resolver；裸名称和带命名空间名称（如 lab/model）均保留显式传入的 intrinsic 限制、布尔能力与模态。LegacyFamilyCompatibilityProvider、deploymentConstraintValue 和 runtime constraint 常量只用于旧 API 兼容，不参与选择、发布或 LKG。已删除的 serving/proof 字段需要 adapter 按各自批准的 change 更新。

本轮规格以 [restore-model-metadata-priority](openspec/changes/restore-model-metadata-priority/design.md) 增量覆盖 canonical 基线；跨仓库收尾后按既有流程归档，历史 archive 不修改。

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
