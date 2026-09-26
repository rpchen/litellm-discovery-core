# 架构决策

## ADR-001：独立宿主无关 core

- **状态**：已接受（PR1）
- **决定**：LiteLLM 地址与响应归一化、deployment 分组、协议判定、models.dev 匹配、能力／价格／限制映射、推理变体、ModelSpec 构建和指纹维护在独立仓库中。
- **边界**：core 只接收响应对象、catalog 对象和显式选项，输出中立类型；不注册 provider，不管理凭据，不持久化，不发网络请求，不引用宿主 SDK。
- **理由**：Pi 与 OpenCode 需要相同业务语义，而宿主 API、协议 package 和发行流程不同。独立仓库使后续两个插件可在构建阶段获取 `main` 的实际 SHA 并编译进各自产物，终端用户无需运行时下载 core。

## ADR-002：中立协议和模型类型

`Protocol` 只允许 `chat`、`responses`、`messages`。`ModelSpec` 不包含 `package` 等宿主字段；每个插件在自己的适配层把协议映射到宿主 API。`ModelVariant.settings` 保留中立键值，避免 core 反向依赖插件配置。

## ADR-003：保持既有行为

基线来自 Pi `a3d7487`，并与 OpenCode `96b00f5` 对照。PR1 保留既有模型过滤、保守合并、models.dev 选择优先级、协议冲突回退、价格换算和阶梯上下文截断规则。发现与抽取无关的问题留在来源仓库的后续变更中。
