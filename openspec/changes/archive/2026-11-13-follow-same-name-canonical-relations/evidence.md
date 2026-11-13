# 验证证据

## 失败与修复结果

旧实现运行 `bun test test/canonical-name-redirect.test.ts`：3 pass / 1 fail。CANONICAL-REDIRECT 期望 acme/flash-revision，实际 acme/flash。修复后定向36例通过；Core test/目录143例通过；全量 bun test 217 pass / 0 fail（303.90秒）。类型检查、build:dist、隔离消费者 import/typecheck 与负向 broken-package 检查、strict validation 均通过。全量已覆盖closure脚本测试，归档后另运行实际closure检查。

2026-11-13 在线 `catalog.json` + 构建后的 Core `buildPublicationResult` + 当前 Pi `toProviderModelsWithPublication`（仅纯映射，无宿主）结果：id=deepseek-v4.1-flash、contextWindow=1048576、maxTokens=393216。原最小复现输出943718。没有发送上游推理请求或执行原会话任务。

## Scenario 对应

| Scenario | 自动化证据 |
|---|---|
| T01 | test/metadata-priority.test.ts：16模型逐条与更新后独立冻结oracle一致 |
| T02 | test/metadata-priority.test.ts：官方别名与deprecated精确名称 |
| T03/T04/T08 | test/metadata-selection.test.ts：三级选择、组织别名、内部路由不改变元数据 |
| T09 | test/metadata-selection.test.ts：官方精确同名relation指向日期版本；metadata-priority的pro整记录预期 |
| CANONICAL-REDIRECT | test/canonical-name-redirect.test.ts：通用名称搭桥，publication context>output，LiteLLM声明不裁剪官方额度 |
| CANONICAL-OFFICIAL-FIRST | 同文件：官方与OpenCode关系不同，官方优先 |
| CANONICAL-EXPLICIT | 同文件：qualified canonical保持绑定 |
| CANONICAL-NO-GUESS | 同文件：相似free SKU不搭桥；metadata-selection保留free/pro与ambiguous反例 |
| 快照重建边界 | 同文件CANONICAL-REFRESH：真实公开目录/脱敏model-info固定样本→publication→新snapshot→inspect回读393216 |

## 验收限制

快照用例证明Core重新发现产物可被正确回读，不代表真实Pi刷新/生命周期已验收。Core PR合入后仍需Pi/OpenCode消费稳定SHA；真实Pi安装、刷新持久化、新实例以及原会话继续必须在adapter阶段验证。用户缓存未修改，错误会话未重试。

## Retrospective

- 选择规则无具体模型、日期、限额常量；通用acme名称用例和真实公开形态共同覆盖，官方/显式canonical/SKU边界保留。
- README、ADR-006、canonical规格和冻结oracle已同步；归档通过OpenSpec CLI执行，strict validation归档后12/12通过。
- Core不单独发布产品tag/Release；此次仍为未合入任务分支，不宣称main/索引收尾完成。
- Pi/OpenCode provenance仍为1ff0979c8f22ec06479331d94ced2cf466f1fd42；本次Core修复尚未进入任何安装产物。后续按Core合入→插件构建和真实宿主验收推进。
- 没有创建临时workflow、修改宿主配置或缓存。工作区.tmp中的最小复现与图解保留用于本任务复核。
