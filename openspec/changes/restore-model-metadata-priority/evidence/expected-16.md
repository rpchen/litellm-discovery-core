# 真实名称对应的设计验收表

这是公开目录冻结样本上的预期，不是已修复结果。模型名称已从实际 Pi 注册核对，部署身份采用合成 canonical 输入。

| 模型 | 来源/record | 档位（Core） | context / output | Pi 可选档位 |
|---|---|---|---|---|
| deepseek-v4-pro | opencode/deepseek-v4-pro | high / max | 1000000 / 384000 | high / max |
| deepseek-v4.1-flash | deepseek/deepseek-flash | low / high / max | 1000000 / 393216 | low / high / max |
| glm-5.3 | zhipuai/glm-5.3 | low / high / max | 1000000 / 131072 | low / high / max |
| glm-5.3-flash | zhipuai/glm-5.3-flash | low / high / max | 1000000 / 131072 | low / high / max |
| gpt-5.6-luna | openai/gpt-5.6-luna | none / low / medium / high / xhigh / max | 1050000 / 128000 | off / low / medium / high / xhigh / max |
| gpt-5.6-sol | openai/gpt-5.6-sol | none / low / medium / high / xhigh / max | 1050000 / 128000 | off / low / medium / high / xhigh / max |
| gpt-5.6-terra | openai/gpt-5.6-terra | none / low / medium / high / xhigh / max | 1050000 / 128000 | off / low / medium / high / xhigh / max |
| gpt-6-astra | openai/gpt-6-astra | low / medium / high / xhigh / max | 1050000 / 128000 | low / medium / high / xhigh / max |
| gpt-6-luna | openai/gpt-6-luna | none / low / medium / high / xhigh / max | 1050000 / 128000 | off / low / medium / high / xhigh / max |
| gpt-6-sol | openai/gpt-6-sol | none / low / medium / high / xhigh / max | 1050000 / 128000 | off / low / medium / high / xhigh / max |
| gpt-6.1-sol | openai/gpt-6.1-sol | low / medium / high / xhigh / max | 1050000 / 128000 | low / medium / high / xhigh / max |
| hy4-preview | tencent-tokenhub/hy4-preview | none / high | 1024000 / 64000 | off / high |
| kimi-k2.7-code | moonshotai/kimi-k2.7-code | 支持，无可选 effort | 262144 / 262144 | 无；显式屏蔽默认档位 |
| kimi-k3 | moonshotai/kimi-k3 | low / high / max | 1048576 / 1048576 | low / high / max |
| mimo-v2.6-flash | xiaomi/mimo-v2.6-flash | 支持，无可选 effort | 1048576 / 131072 | 无；显式屏蔽默认档位 |
| mimo-v2.6-pro | xiaomi/mimo-v2.6-pro | 支持，无可选 effort | 1048576 / 131072 | 无；显式屏蔽默认档位 |
