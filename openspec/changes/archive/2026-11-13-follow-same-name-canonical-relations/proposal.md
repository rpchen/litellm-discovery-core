## Why

Pi 的 deepseek-v4.1-flash 请求 max_tokens 超过上游 393216。2026-11-13 实时 models.dev 仍保留旧 canonical 条目，而官方 deepseek-flash 与 OpenCode 同名 API 已明确指向 -1017；旧 selector 先锁定顶层旧 canonical，再过滤掉这两条记录，发布 OpenRouter 的 output=943718。实时 LiteLLM 的 max_output_tokens 为384000，但用户明确选择保持目录优先，修正选型，不裁剪或混合字段。

## What Changes

- 裸公开名称存在唯一顶层 canonical 候选时，按官方（含现有组织别名）→ OpenCode → OpenRouter 查找精确同名记录；明确 relation 指向现存 canonical 时用它确定编号，再走原整记录选择。
- 显式带命名空间 canonical、现有 ambiguous/unmatched、SKU和日期精确匹配边界保留；不猜版本、不剥后缀、不加模型特判。
- 新增通用回归和真实公开形态回归，证明 context 大于 output 时仍发布所选官方额度；更新冻结 oracle 中同类官方同名 relation 的预期。

## Impact

Core 仅改变宿主无关 selector；无公共 API、缓存 schema、宿主 SDK 或插件业务逻辑修改。Core 合入 main 后，Pi 与 OpenCode 各自立消费变更并用该稳定 SHA 构建产物；Pi 的真实刷新、实例重建、原会话继续尚待 adapter 阶段验收。本次不自动合并、发版或改用户缓存。
