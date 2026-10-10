# 公开来源与本地只读探针

公开目录：[models.dev catalog.json](https://models.dev/catalog.json)，2026-10-10 获取，475 canonical / 226 provider。完整响应的 SHA-256 和子集校验值在 source-manifest.json。只提交59条与验收有关的能力记录，不提交原始本地store或真实LiteLLM响应。

源码观察点：[models.dev 5dd0d3e446b66ceb8edd98e366ee700702377833](https://github.com/anomalyco/models.dev/tree/5dd0d3e446b66ceb8edd98e366ee700702377833)。这是独立观察的源代码SHA，不声称线上catalog由它精确构建。

| 事实 | 公开源文件 |
|---|---|
| 官方API alias deepseek-flash关联V4.1Flash | [deepseek-flash.toml](https://github.com/anomalyco/models.dev/blob/5dd0d3e446b66ceb8edd98e366ee700702377833/providers/deepseek/models/deepseek-flash.toml) |
| 同名V4Pro的relation指向不同日期版本，须排除 | [deepseek-v4-pro.toml](https://github.com/anomalyco/models.dev/blob/5dd0d3e446b66ceb8edd98e366ee700702377833/providers/deepseek/models/deepseek-v4-pro.toml) |
| canonical owner tencent 与官方provider不同名 | [Tencent lab](https://github.com/anomalyco/models.dev/blob/5dd0d3e446b66ceb8edd98e366ee700702377833/labs/tencent/lab.toml)、[Tencent TokenHub provider](https://github.com/anomalyco/models.dev/blob/5dd0d3e446b66ceb8edd98e366ee700702377833/providers/tencent-tokenhub/provider.toml) |
| provider文件指向Tencent官方产品文档 | [Tencent TokenHub文档](https://cloud.tencent.com/document/product/1823/130050) |
| GLM owner zhipuai；主provider同名，zai作为组织别名候选 | [ZhipuAI lab](https://github.com/anomalyco/models.dev/blob/5dd0d3e446b66ceb8edd98e366ee700702377833/labs/zhipuai/lab.toml)、[ZhipuAI provider目录](https://github.com/anomalyco/models.dev/tree/5dd0d3e446b66ceb8edd98e366ee700702377833/providers/zhipuai) |

公开lab文件并未统一声明owner→provider机器可读关系，所以设计明确把少数组织别名作为小型数据维护，不伪称catalog已经提供自动映射，也不为实际LiteLLM转发做任何证明。

## Pi SDK只读探针

读取已安装peer `@earendil-works/pi-ai` 的 `getSupportedThinkingLevels`，调用三组内存对象（没有网络、凭据或用户配置写入）得到：

| 模型输入 | 实际返回 |
|---|---|
| reasoning=true，未提供thinkingLevelMap | off / minimal / low / medium / high |
| reasoning=true，七个level全部为null | [] |
| reasoning=false | off（宿主关闭思考状态，不是effort能力） |

对应源码为Pi仓库node_modules的pi-ai/dist/models.js约553行，目标门禁版本0.87.1。此结果证明省略map会扩大档位；它**不证明**真实picker、clamp、API调用已无默认参数，T29仍未执行。

## 设计材料验证

在Core仓库执行：

```text
node openspec/changes/restore-model-metadata-priority/evidence/verify-design.mjs
```

验证16名称与观察清单相等、不依赖内部身份线索、每个oracle能力与价格字段均与选定公开整record相等、每个GPT选项独立、日期版本反例、59记录subset digest，以及main/index基线校验。它没有实现或运行新resolver；不能当业务修复、价格不变性测试或真实宿主E2E证据。
