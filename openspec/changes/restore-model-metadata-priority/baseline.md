# 基线

| 仓库 | 基线分支 | Code / index SHA | 准备状态 | 远端核验 UTC |
|---|---|---|---|---|
| rpchen/litellm-provider-workspace | main | 7c90538cd1da2cefd2e65ac9dcd5d1bcad446e9b | ready；clean；ahead/behind 0/0 | 2026-10-10T09:40:58.243Z |
| rpchen/litellm-discovery-core | main | a13f16fd983478572502f3896fd5509978027261 | ready；clean；ahead/behind 0/0 | 2026-10-10T09:34:55.855Z |
| rpchen/pi-litellm-provider | main | c98e57b877081fc4a9471ce772eeb6c130674dde | ready；clean；ahead/behind 0/0 | 2026-10-10T09:45:23.004Z |
| rpchen/opencode-litellm-provider | main | f3447a3c2187e3cc3c90d1d76b0b28a7c5d79e03 | ready；clean；ahead/behind 0/0 | 2026-10-10T09:35:29.834Z |

三子仓库基线无active change、无open PR。Pi/OpenCode最新tag和Release均v0.10.0，README与main一致；Core无产品Release。两插件core-provenance均指向上表Core SHA。当前设计分支三仓库均codex/restore-model-metadata-priority；workspace仍main且无修改。

完整immutable snapshot校验和见evidence/baseline.json。准备途中Git/TLS多次超时；项目支持的CLI后备入口最终ready，未reset/clean/stash。MCP structural/coverage仍被缓存超时拦截，list_projects/index_status虽ready不能替代逐文件coverage，本审计据当前源码回读，不声称图谱验证成功。提交后设计分支的文档SHA自然不同于main索引基线；本轮不发布新main索引、不调用finish（未合并）。
