## Context

Core 基线 `cc3d6fa4cfe62ccd784d1189930385f2b2b633ee`。用户确认 LiteLLM 1.99.0 和 UI Models Disable 操作。官方 tag `v1.99.0` 对应 `fa647f742d7baefe8eb1181899d9c81b41559772`：

- [Router#get_fully_blocked_model_names](https://github.com/BerriAI/litellm/blob/fa647f742d7baefe8eb1181899d9c81b41559772/litellm/router.py#L10129-L10148)：全 blocked 才隐藏组；部分启用则仍可服务。
- [GET /v1/models](https://github.com/BerriAI/litellm/blob/fa647f742d7baefe8eb1181899d9c81b41559772/litellm/proxy/proxy_server.py#L9777-L9791)：排除暂停组。
- [GET /v1/model/info](https://github.com/BerriAI/litellm/blob/fa647f742d7baefe8eb1181899d9c81b41559772/litellm/proxy/proxy_server.py#L14095-L14154)：保留配置部署，并不移除 blocked 行。
- [POST /model/block](https://github.com/BerriAI/litellm/blob/fa647f742d7baefe8eb1181899d9c81b41559772/litellm/proxy/management_endpoints/model_management_endpoints.py#L830-L856)：将 DB deployment 标为 blocked。

官方文档还区分 discoverable 隐藏和 Key/Team 权限限制；本次修复针对已确认的 Disable/blocked，不把其他隐藏原因或版本差异扩充为未经证实的需求。

## Decisions

在 `groupLiteLLMDeployments` 读取 model_info 后跳过 blocked=true，然后沿用既有模式过滤和分组。与 LiteLLM 的布尔判定一致：false、缺失、非布尔值不视为明确暂停。不按 GPT 名称特判；混合组只保留未暂停 deployment，避免暂停 deployment 继续影响协议/元数据。

所有现有 Core entrypoint 均复用该分组入口，所以正常构建、publication、diagnostics、增量 model_name 比较统一移除暂停模型，现有 LKG 只能恢复当前组，不能复活不存在的组。不改变 snapshot/publication schema 或 HTTP 降级策略。

## Delivery

Core 类型、离线 tests、build、隔离 package consumer、OpenSpec 和 CI 必须通过。Core PR 审核合入后，两个 adapter 按同一完整 Core SHA 构建交付物并补真实宿主 E2E；不在 Core PR 内发布或更新插件。
