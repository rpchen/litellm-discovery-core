## Context

抽取基线为 Pi 仓库 `a3d74873e13739e9d6fe096900cda33dc2e8886f` 的 `src/core/` 和 core 测试，并以 OpenCode 仓库 `96b00f5e291bb6b0e407f8bc9fa81de890cb7e79` 同路径实现与测试交叉核对。

## Design

`src/core/` 只依赖自定义 TypeScript 类型和标准运行时 API。`Protocol` 是 `chat | responses | messages`，`ModelSpec` 不带宿主 package 字段，`ModelVariant.settings` 保留协议中立的设置。公共入口 `src/index.ts` 只做 re-export。构建输出 `dist/index.js` 和 `.d.ts`，运行时依赖为空。

后续插件在构建阶段显式读取 core `main` 并记录实际 SHA；插件运行时不解析或下载 core。该迁移、重复代码删除和宿主 API 映射不属于本 PR。

## Compatibility

保留既有协议选择顺序、同名多部署的保守合并、models.dev 原厂／OpenCode Zen／唯一 provider 选择、模态信任家族、价格阶梯截断、推理变体和模型指纹语义。OpenCode 侧 `ModelSpec.package` 与 `PROTOCOL_PACKAGES` 被移除，因为它们绑定宿主 SDK；插件适配层负责映射。
