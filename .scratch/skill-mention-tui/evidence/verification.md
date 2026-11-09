# 整合验证记录

实现基线 `8c6a8ad2`；整合代码 `7ccd7345`。全部在独立任务工作树执行，未推进 z、未发布、未切换稳定安装。

## 真实结果

| 检查 | 观察 |
| --- | --- |
| `node --import tsx/esm scripts/verify-input-completions.tsx` | 53/53；真实 Cordis activation + PromptInput + Launchpad，含 busy、跨会话、取消、不配合 abort、光标后同词后缀、多来源、卸载 |
| `node --import tsx/esm scripts/downstream/verify-session-cards.tsx` | 79 PASS，最终 OK；新增真实 working=true 的 channel，一条输入一次 backend.submit、两个独立技能事实各一张卡；翻译器→channel→Chat，100/40 列、live/replay、id/seq/time/source、首尾空白、正文、折叠恢复 |
| `node --import tsx/esm scripts/verify-launchpad-onboarding-chat.tsx` | 279 checks, all passed；保留原引导/命令/图片/换屏行为 |
| `node --import tsx/esm scripts/verify-dsh-translate.ts` | OK (168 live / 162 replay events) |
| `node --import tsx/esm scripts/verify-agent-event-invariants.ts` | OK (86 streams, 2276 events; mutation probes passed) |
| `node --import tsx/esm scripts/verify-plugin-lifecycle.ts` | 90 checks OK |
| `verify-file-suggestions.ts` / `verify-mention-lines.ts` | all assertions passed |
| `verify-agent-teams.ts` | PASS；通知不生成人工气泡 |
| `repro-askpanel.tsx` / `verify-askpanel-layout.tsx` / `repro-toolcards.tsx` | ALL PASS |
| `verify-composer-image-tokens.tsx` / `verify-input-selection.tsx` | all checks passed |
| `pnpm … run verify:projection-golden` | 5 goldens / 83 replay rows / 29 documented live differences OK |
| `pnpm … run verify:agent-domain` | 24 checks OK |
| `verify-adapter-boundary.ts` | OK；既有 41 allowlisted UI value imports 警告，未增加例外 |
| `verify-adapter-shadow.ts` | OK；139 methods / 88 effect classes |
| `verify-adapter-slices.ts` | 57 checks / 13 slices OK |
| `verify-i18n.ts` | 2157 entries (+ backend395) OK |
| TypeScript `--noEmit` + 干净 `compile:src` | 通过，生成 2 backend entries / 83 settings |
| `pnpm … run verify:package` | 3442 files / 37 entry targets OK，含新公开 subpath；编译入口可 import |
| `verify-extension-ui.tsx` | extension UI seams verified，无 host accessor 泄漏 |
| `verify-adapter-ports.ts` | 19 port files +24 kernel files AST checked OK |
| `verify-channel-ui.ts` | real Channel/root，effects/handles/shadow/replacement/emitter OK |
| `verify-agent-team-channel.ts` | 59 checks ALL PASS |
| `git diff --check` | 通过；借用的 vendor/dsh-std 软链已安全 unlink 并恢复空 gitlink目录，未改目标或提交vendor |

`pnpm …` 的实际前缀为 `pnpm --config.verify-deps-before-run=false`。开发工作树借用了同锁文件的根 node_modules，pnpm11 默认预运行自动安装被 UNSAFE_MODULES_DIR 正确拒绝；该进程级选项只避免自动安装借用目录，未放宽编译、断言、包检查或边界门禁。第一次直接调用 verify-package.mjs 因缺少其要求的 npm pack JSON stdin 失败，随后改用仓库正式 verify:package 脚本通过。未改依赖/锁文件。任务工作树根的 node_modules 为借用根依赖的开发软链；它因目录型 ignore 规则显示为未跟踪，明确不暂存、不进入提交，保留供隔离体验及复验使用。

共享 UI 回归清除继承的 TMUX/TMUX_PANE，与既有 CI truecolor 条件一致；真实终端另使用独立 tmux socket。

## 修复证据

- 工单01先有 notice 接入 red，再完成独立实现和审查；报告见 child 95459824 artifact。
- 补全 worker 超时，前台保留/检查其文件；恢复时既有 43 checks 通过。新增“不配合 abort 也结束宿主等待”前为45/46，修复后46/46。
- 新增来源与首尾空白断言先 red 两项，再绿；补全的同词光标后文断言先52/53，再绿53/53。
- 真实默认入口揭示只接 PromptInput 不覆盖启动页：新增3项 red，接通 Launchpad 后通过；既有279启动页回归捕获 bare fixture 缺 backendCapabilities 的读取问题，按可选 facade 条件读取修复后279全绿，无删断言。

## 隔离真实入口

官方 rc.5 CLI `dsh plugin --profile skill-mention-tui add <绝对路径>` 已链接任务工作树、skill-mention core0.1.1、可安装合成补全插件；`--dump-config` 确认条目。实际 TTY 确认服务运行，而非只看配置。

- 100列 fullscreen 和40列 inline：启动页显示21项（技能源最多20 + 第二工单来源），每行来源标签，未把 audit 等真实仓库技能纳入最终夹具。为此在生成 workspace 内初始化独立 Git 边界，HOME/DSH_HOME 隔离。
- Tab 接受 alpha 后仍留启动页，Enter后出现一条独立“已加载指令”卡和本地回复；`LOCAL_REQUESTS=1`。
- 一次提交 beta + unreadable：beta 成功卡、skill-mention-error 通用通知、一次本地回复；`LOCAL_REQUESTS=2`。展开证据有 ALPHA_BODY_PRESENT/BETA_BODY_PRESENT/FAILURE_CONTEXT_PRESENT 全 true，未改变模型可见性。
- 独立 acceptance-ledger notice 不含插件 name/message，完整220行末尾 NOTICE_BODY_END 在真实 UI 可见。
- `/demo-completions` 显示 disabled；官方 CLI remove --config.offline=true 移除了真实 profile 的补全 fixture bundle，随后 add --offline 恢复。第一次 remove --offline 不受该子命令支持，失败已修正，不冒称成功。
- 删除当前 alpha/SKILL.md 后，使用 sessionId 配置覆盖恢复 83f8b582-9bcf-4205-8a73-9f38d5de5a36，旧技能/通知卡仍在；展开滚动实际读到 ALPHA_INSTRUCTIONS_END，恢复进程另行执行的当前请求计数 LOCAL_REQUESTS=0（见 pty-restored-no-model-request.txt；滚动上方1/2是历史结果）。原进程通过正常双 Ctrl+C 退出，pane_dead_status=0。

最终代码40列inline启动页接受beta后提交，实际出现beta独立技能卡及本地回复，记录 pty-inline-40-skill.txt。未安装补全fixture的新进程仍可启动，#保留在草稿但无插件菜单，见pty-uninstalled-no-menu.txt；之后已恢复安装和合成文件。

记录见本目录 pty-*.txt。这里只是代理已验证，不是用户亲自验收。

## 未运行 / 边界

未运行发布前全量 build门禁及全部CI分组、Windows ConPTY、真实 Claude/Codex 或付费模型；本轮只做所改接缝相关门禁与共享UI必要回归。没有网络/真实凭据依赖。技能插件正式 ./tui 入口由其项目实现，本任务交付宿主API并以真实安装的夹具证明接入，不把旧硬编码探索分支当作插件。

慢来源在未取消时会延迟整批菜单；不增加超时配置。旧正文超600条转录记录窗口先降预览，点击“加载更早”后从持久事件恢复，不读取技能当前文件。
