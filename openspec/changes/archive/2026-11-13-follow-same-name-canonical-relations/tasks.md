## Core

- [x] 复现实时目录的错误选型，记录旧实现的失败回归。
- [x] 修复唯一裸名称的精确同名关系查找；保持整记录、官方优先和显式 canonical 边界。
- [x] 完成通用、真实 LiteLLM/model-info 固定样本与快照回读回归。
- [x] 更新 README 与同类冻结预期，说明刷新和运行实例重建要求。
- [x] 通过 typecheck、全量测试、build:dist、test:package、strict validation 与 closure 门禁。
- [x] 回填证据并用 CLI archive，重新 strict validation。
交付跟踪：Core PR #41；CI及审核以该PR实时状态为准，不自行合并。

## 后续 adapter 交付边界

Core 合入稳定 main SHA 后才更新 Pi/OpenCode 的 dist/provenance。真实 Pi 刷新、重建实例、请求上限与原会话继续未在本 Core change 声称完成；由各 adapter 消费 change 验收。
