# Core 实施记录（2026-10-10）

状态：Core 代码、完整本地门禁及实现提交 CI 全部通过，提交代码 Review。Pi/OpenCode 仍待 Core Review 和授权合入；本轮不合并或发布。

## 基线与范围

- 当前续做分支 codex/restore-model-metadata-priority；实施前 HEAD 80dac9d74a16285b7d8d073031d2b6befd0dfda4，main/origin/main a13f16fd983478572502f3896fd5509978027261（0/0），工作区干净。
- 本次最小修复续做 HEAD e8fb92814ae3eda541eba3ec788898f4192d501a，工作区干净；CLI prepare(mode=resume) 返回 working / existing work preserved，未切换或覆盖任务分支。
- Pi / OpenCode 分支、dist/provenance 和代码保持原状，当前编入同一 Core main a13f16fd983478572502f3896fd5509978027261。宿主 T28–T34 未实施、未验收。
- prepare(mode=resume) MCP 未正常解析选择，图查询报 project identity cannot be resolved；官方 CLI 后备返回 working / existing work preserved。原生 marker 为 Core project，commit 80dac9d74a16285b7d8d073031d2b6befd0dfda4；本轮基于实时 Git/源码，未把该基线索引称为已覆盖实施改动。
- 未修改历史 archive、版本、用户配置、三个子仓库 AGENTS.md 或 Workspace 内容；未合并、打 tag、发版或执行 finish。

## 实施结果

resolveModel 用 model_name / canonical 目录关系和 owner 组织别名选择一条记录。selected record 独立提供能力、限制、reasoning/options、可选参考价；不使用内部 route/base_model/provider 声明，不跨 provider/canonical/LL 补字段。protocol 原算法与已有 Messages 映射保持不变。

价格逐项有限非负则取值，否则 0；tier cap 删除，contextTierCap 忽略并移出 builder scope。publication schema9 / snapshot2 的关键完整性不含价格和 release；LKG 不比较 deployment multiset、内部 route 或 serving proof，恢复配置及宿主使用的 reasoning/tools 判定。

diagnostics 保留公开来源、最终能力和实际缺失/非法字段。README、共享测试标准 §8、ADR-005、OpenSpec context 和四个 Purpose 已同步；canonical Requirement 仍是基线，受批准的 active delta 覆盖，跨仓库收尾时再 CLI archive/sync。历史 archive 字节未修改。

## 公开 API 清点与测试替换

src/index.ts 为 wildcard 公共入口。保留 selectModelsDevRecord[Detailed]、mapCapabilities、buildVariants、resolveReasoningState/Levels/Support、numeric/boolean/modality helpers、发布/LKG/snapshot/refresh API；兼容包装委托同一 resolver。旧约束参数、family helper 和 inheritance API 不参与主选择或发布，不保留旧补字段算法。

删除 MIRRORED_PRICING_KEYS 以及 ServingStatus/IdentityKind/ResolvedServing/DiagnosticCandidate/LKGProof 的旧 proof 类型和 ResolvedModel.serving/proof/operatorConfiguration/diagnosticCandidates、assessment fieldBasis 等字段。两个 adapter 目前只在旧 diagnostics 包装中读取 serving/candidate 字段，其各自 approved change 将在后续阶段替换；本轮不提前修改宿主。

旧 canonical-catalog-acceptance、resolve-matrix 和大 ModelSpec snapshot 固定了 serving proof / 字段补齐 / 价格截断预期，已由真实 16 名称逐模型 oracle、整记录优先级、价格独立、缓存完整性及公开消费者测试替换。保留 protocol、LiteLLM 入口、refresh、partial catalog、acknowledgement、snapshot scope、索引与 closure 测试。scripts/audit-modelsdev-catalog.ts 不再证明 serving，只比较实际最终配置/发布结果。

冻结的 discovery/catalog/oracle 复制到 test/fixtures/metadata-priority/，与本 change evidence 字节一致；测试不会因未来归档而断路径。不提交真实 API Key、内部地址或原始用户模型存储。

## 验证

| 门禁 | 实际结果 |
|---|---|
| npm run typecheck | PASS |
| DeepSeek 修复前回归 | 新测试先复现：18 PASS / 2 FAIL；原冻结用例及新 canonical 别名用例失败，两个精确旧 API 用例通过 |
| 元数据定向回归 | 50/50 PASS；16条冻结配置全部通过，包括官方 DeepSeek Flash 输出393216、low/high/max；两个 deprecated 精确 API 仍匹配 |
| bun test（本次完整） | PASS：198/198，0 FAIL，636 assertions，19 files；Windows运行373.47秒 |
| npm run build:dist | PASS |
| npm run test:package | PASS：外部 JS/TS consumer、元数据/公共 helpers/LKG/diagnostics、缺失 entry 负向 |
| npm run validate:spec | PASS：13/13 strict all |
| npm run test:openspec-closure | PASS：32/32，0 closure mismatches；active tasks 保留真实未完成项，不提前 archive |
| npm run test:codebase-memory | PASS：42/42（Node），另有完整 Bun suite 同步执行 |

实现提交 1f1ee6e27a637849c4c75cdf6795ef3b1ba959de 的 [完整 CI run38057696387](https://github.com/rpchen/litellm-discovery-core/actions/runs/38057696387) 为 SUCCESS：Node索引测试、typecheck、完整Bun、build、外部消费者、strict规格、closure和准确源码SHA的原生索引生成全部通过。PR条件下consumer dispatch按既有规则SKIPPED，不运行宿主适配。后续仅回填本证据的提交仍须通过 [PR #34 最新 HEAD checks](https://github.com/rpchen/litellm-discovery-core/pull/34/checks)，本轮交付报告记录其最终SHA和CI。

Scenario 逐项测试名见 scenario-evidence.md，40/40映射到实际测试及上述实现CI；之前设计HEAD的绿灯不作为实施证据。未运行live全目录网络audit或真实宿主E2E，不能据此宣称两宿主已修复。

## 已批准的最小修复：DeepSeek 官方别名

公开冻结目录的 deepseek/deepseek-v4.1-flash 对应三条官方记录：deepseek-flash；deepseek-v4-flash（status=deprecated）；deepseek-v4-flash-vision-exp（status=deprecated）。原实现转到 OpenCode，导致官方来源/输出上限不符合 expected-16（393216）。此前失败 CI e8fb928 / run38054861236 保留为问题证据，不作为通过证据。

用户于2026-10-10批准：只在没有精确 API 名称匹配、通过官方 canonical relation 查找别名时排除 deprecated。src/core/resolve.ts 只增加一个 aliases 过滤条件；exactRecords 分支不变。同步 D2、原 T02 Scenario/矩阵和 README，新增真实冻结目录回归；不增加排序、关键字段比较、证明、冲突机制或状态，不修改正确 oracle。T05/T06 仍撤回。

## Retrospective

算法没有按16模型硬编码；此次条件适用于官方relation别名查找，两个精确旧API负向回归保护兼容行为。既有协议/refresh/通知保留，冻结数据和历史archive不改。临时日志在忽略的.tmp，构建dist未入库。跨仓库5.2/5.3仍待办；完整Core门禁与CI通过后提交代码Review，不合并、不发布、不提前实施宿主。

## PR #34 Review 修复：公共 helper 命名空间

Review 基于 bb07ca3953e931a6247ac3805579ad2bbe4dddcb，复现 projection 固定 metadata provider 导致 lab/model 的显式 intrinsic 丢失。只在 src/core/evidence.ts 用既有 canonicalModelID 取得临时记录的命名空间，继续委托同一 resolveSelectedModel；不改 resolver、匹配优先级或其他业务规则。

T24新增6个直接helper回归（数值、true/false/unknown、模态声明/空数组/unknown；lab/model和既有大小写归一化），修复前19 PASS / 6 FAIL，修复后25/25 PASS。独立npm包消费者同样先复现context为undefined，再验证三个helper保持传入值。README与Scenario证据同步；完整该修复HEAD的门禁、CI与提交SHA见[PR #34最新checks](https://github.com/rpchen/litellm-discovery-core/pull/34/checks)和本次复核报告。上表198/198及1f1ee6e CI保留为之前实施提交的历史结果；不据其宣称此次修复CI通过。
