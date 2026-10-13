# Proposal

## Why

Pi 与 OpenCode 的增量发现适配层分别维护了相同的 model-name delta、publication 合并、catalog 命中判断和诊断合并逻辑。重复实现已经造成 Review 指出的漂移风险；同时，同一模型集合在 models.dev 临时不可用后会被永久复用旧的 withheld 结果，无法沿既有恢复/LKG路径恢复。

## What Changes

1. 在 Core 公共入口提供宿主无关的增量发现辅助：model_name 集合差异、响应过滤、publication/diagnostics 合并、catalog 匹配未命中判断。
2. 提供严格限定的临时 metadata failure recovery identity 集合：只返回上轮因 degraded metadata catalog 被 withheld 的模型，不重新处理正常注册模型，也不重试稳定的 identity-unmatched 结果。
3. Pi/OpenCode adapter 改为消费这些 Core helpers；保留各自的 catalog I/O、LKG store、宿主映射、ProviderSnapshot 与注册生命周期。

## Capabilities

### Modified Capabilities

| Capability | 调整 |
|---|---|
| discovery-core | 导出共享增量发现纯函数，保持零宿主依赖 |
| publication | 允许 adapter 复用/合并 Core publication partition，不改变 gate/LKG 规则 |
| discovery-diagnostics | 允许 adapter 合并已处理模型诊断，不重复解析保留模型 |

## Impact

Core 公共 API 增加纯函数；不进行网络、持久化、重试或宿主操作。两个插件的本轮适配必须在该 Core PR 合入稳定 SHA 后更新 dist/provenance；不修改用户命令、UI、配置或 Release。
