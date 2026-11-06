# 02 集成审查、隔离验收与交付

Type: acceptance
Status: resolved
Blocked by: 01

权威：../spec.md。前台负责集成版定向验证、独立只读审查及实质问题修复、准备安全假模型真实 TUI 入口（inline/fullscreen、窄窗口）、记录实际证据和验证缺口，写 ../delivery.md。不允许把缺失强制验收说成 delivered。

环境：可用 `/home/liyihang/projects/dsh-src/dsh-context/.acceptance/tui.sh` 及 host 假模型 profile，部署候选只能隔离，不改稳定安装。HMR 继续关闭。

## 进展与实际证据

基线实现 `bc7dae8f`：前台重跑卡片41检查、翻译168live/162replay与boundary通过。独立审查结论 pass with notes，发现成功toast与卡片同时呈现；已派回工单01做有界修复和真实dispatch回归，不通过删除断言降低验收。

新隔离环境 `/home/liyihang/projects/dsh-src/dsh-context/.acceptance/session-cards/`：原生 dsh plugin add 链接候选及dsh-context，独立HOME/DSH_HOME/workspace，env-i清空真实凭据，loopback假模型，HMR关闭。`sessionCards:true`，明确cwd避免向上选到真实仓库。初次技能fixture因默认provider禁用不可用，已在该profile显式启用skill-filesystem，仅允许合成customSkillDirs并关闭默认根与watch，不改产品代码。

真实 tmux rc.5 全屏100/40列：无请求提示→hello→count1→context与raw折叠展开→save0600/28985bytes→demo-long-report(323行、>65536码元、含中文emoji和10000cells长行)展开看见LONG_LINE_END及DEMO_LONG_REPORT_END→count仍1→错误卡→exit0。

早期误标的 inline100/40列轮次：无请求提示→hello→/card-demo，用户消息独立且一张[技能]card-demo·已加载指令卡，展开看见canonical SKILL_CARD_BODY_START/END→count2（hello+主动技能这两次正常请求）→context/raw折叠展开→save0600/30727bytes→相同超长命令读尾→count仍2→exit0。该轮 `inline.ansi`、随后初次 `inline-final.ansi` 均后来确认含 `?1049h`，实际为 fullscreen，不作为 inline 证据；真正 inline 见下文 `inline-actual-*` 补验。更改磁盘技能末尾后，保存的本次请求仍含原始BODY_END、不含DISK_EDITED，当时持久日志只有一条实际skill-invocation(seq28)。

证据目录：隔离环境下 evidence/，含dump-config、终端ANSI/屏幕文本、定向脚本日志与inline-durable-summary.json。无外部/付费模型请求。

既有 `repro-toolcards.tsx` 七项颜色/选择背景断言失败：worker在未改z复现，前台在原始z和候选各自全新HOME再次实跑，精确同样七项失败；没有删改这些断言。不声称此脚本或全量门禁通过。

### 最终代码补验（33fff750）

- 成功通知去重的两行行为修复及8组真实session/event分发回归已完成。前台重跑真实dispatch回归、卡片41检查、translate、boundary、golden5/83、domain24、i18n、patch-surface、两askpanel、diffcheck全通过；npm compile最终17:13:42后无源码变化。
- 模式纠正：发现初轮“inline”被已导入的fullscreen偏好覆盖，不能作为inline证据。现入口分离ui-fullscreen/ui-inline HOME，准备的inline偏好固定false，实际最终tmux alternate_on=0；全屏alternate_on=1。已在真正inline上重跑技能卡实际正文、raw展开与save0600/36083bytes、40列87784码元323行长文/10000cells单行末尾、普通消息与查看计数、exit0；证据为inline-actual-final.ansi及inline-actual-*。
- 旧恢复轮次触发上游recapOnOpen自动假模型请求（并非展开引起）；现隔离profile显式关闭它，最终全屏恢复旧会话和全局展开/折叠前后新provider计数均0。另在最终代码的40列全屏用滚轮读到旧技能的原始BODY_END，磁盘更改不影响旧记录；合成文件已还原。最终两种模式都正常exit0，专用tmux仅保留死窗格，模型服务已退出。
- 交付指南已写入 ../delivery.md。最终独立只读复审为 pass with notes、无阻塞项；未宣称全量门禁通过。复审证据精度意见已收口：三份导出文件实际stat/JSON.parse输出写入 `evidence/save-stat-json.txt`；误标两轮已在本票和指南原段落明确；最终 inline dump 重新生成，确认 recapOnOpen:false/fullscreen:false；Chat修复的实际git diff保留在 evidence/repair-chat-diff.txt（仅两条行为guard和注释，提交还含其测试与文档）。8组去重未逐模式重复及取消无新增显式断言的限制已列指南。
- 初审 artifact：`/home/liyihang/.pi/agent/sessions/--home-liyihang-projects-dsh-src-dsh-tui--/subagent-artifacts/026b6ca6-8c5c-40e2-92f9-2c893cb4b04f_reviewer_output.md`；最终复审 artifact 同目录 `b9be3a36-a281-4dd5-b9e8-9f52dad1f901_reviewer_output.md`。
