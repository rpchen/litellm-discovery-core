# 源码溯源

本次 PR1 的抽取基线来自两个只读来源仓库，均在抽取前检查了工作区状态和 commit：

| 来源 | commit | 使用路径 | 作用 |
|---|---|---|---|
| [rpchen/pi-litellm-provider](https://github.com/rpchen/pi-litellm-provider) | `a3d74873e13739e9d6fe096900cda33dc2e8886f` | `src/core/build.ts`, `capabilities.ts`, `litellm.ts`, `modelsdev.ts`, `protocol.ts`；`test/core-*.test.ts`；`test/fixtures/*`；`test/__snapshots__/core-build.test.ts.snap` | 优先抽取的宿主无关实现和较完整回归测试 |
| [rpchen/opencode-litellm-provider](https://github.com/rpchen/opencode-litellm-provider) | `96b00f5e291bb6b0e407f8bc9fa81de890cb7e79` | `src/core/*`；`test/build.test.ts`, `capabilities.test.ts`, `litellm.test.ts`, `modelsdev.test.ts`, `protocol.test.ts` | 对照行为、遗漏和宿主绑定 |

必要抽取改动：

- 将公共入口改为 `src/index.ts` 并导出 core 函数与类型。
- 将源码导入统一为构建后的 `.js` ESM specifier。
- 保留 Pi 侧已经完成的宿主无关 `Protocol`、`ModelSpec` 和 `ModelVariant` 类型。
- 删除 OpenCode 侧 `ModelSpec.package` 与 `PROTOCOL_PACKAGES` 宿主 SDK 绑定；协议只作为中立联合类型输出。
- 未引入来源仓库的网络、轮询、凭据或 provider 注册代码。

两个来源仓库中的文件没有被修改；后续插件迁移另行实施。
