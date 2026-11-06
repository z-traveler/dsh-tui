# 命令结果与显式技能卡片

## 交付内容

本指南记录专用 `feature/session-cards` 工作树的开发验收；交付当时没有合入 z、推送、发布或切换稳定安装。后续发布身份以私有 Release 的 `RELEASE.json` 为准。

开启 `sessionCards: true` 后：

- core 命令的 `command/run`、`command/done` 按 `commandId` 配对成结果卡。默认标题及首行摘要，展开显示保存的完整正文；不再重复追加本地文本或成功通知，错误通知保留。
- 显式技能注入 `user/message`（`source.kind: skill-invocation`）显示独立的“已加载指令”卡片。用户输入仍是单独的用户消息；展开的是当时实际注入的正文，不重新读 SKILL.md，不声称技能任务执行成功。
- 命令结果仍是 log-only，技能指令仍是 model-facing；新增的是显示投影，不改变两者的模型可见性。折叠/展开不执行命令、不调用模型、不写 Session。
- 恢复、窗口折叠及加载更早正文使用持久记录；`sourceEventSeq` 已有专属呈现和成功无正文命令不增加通用卡片。模型自己调用的工具仍使用原工具卡。

这是下游 opt-in：**默认关闭**。长期配置及中英行为说明见 [session-cards.md](../../docs/downstream/session-cards.md)。裸 `/goal` 的状态结果也遵循默认折叠规则，goal 面板不受影响。

## 实际行为证据

以下是 **agent 验证**，不代表用户已经亲自验收。

| 行为 | 实际结果 |
| --- | --- |
| 旧行为判别 | 新卡片回归在原始基线上先出现 21 个失败；实现后 41 项通过。选择 Enter 的 3 个断言在单独撤去其接缝修复时失败。 |
| 分发去重修复 | 成功结果原先又进入 toast；新增真实 `session/event → channel → Chat` 用例分别复现普通短结果、permission 的重复通知，修复后通过；关闭开关的正向对照仍产生原通知。 |
| 命令真实入口 | rc.5 全屏：无请求提示 → hello 假回复 → `/model-context` 和 raw 折叠/展开 → 完整保存 → 错误卡 → 正常退出。查看、展开、保存前后计数保持 1。 |
| 超旧限制正文 | 合成普通命令 `/demo-long-report` 返回 **323 行、87784 个 UTF-16 码元**，含中文、emoji、10000 显示单元长行。40 列下仍默认折叠，展开可见 `LONG_LINE_END` 和 `DEMO_LONG_REPORT_END`；全屏及真正 inline 均验证。 |
| 技能真实入口 | 原生技能发现 + TUI 无 skill 工具时的既有 fallback 注入；`/card-demo` 有独立用户消息和“已加载指令”卡片，展开可读 canonical 包装及正文末尾。普通消息和主动技能各增加一次正常假模型请求，纯查看不增加。 |
| 完整保存 | 全屏首轮文件 28985 bytes；最终代码真正 inline 的文件 **36083 bytes、0600、可解析 JSON**，包含技能正文。文件位于隔离 `exports/`。 |
| 恢复与快照 | 最终代码重启恢复旧会话，命令长正文仍可读尾；曾把磁盘技能末尾改为新标记，恢复的旧技能卡仍显示原 `SKILL_CARD_BODY_END`，而不是新文件内容。实验后已还原合成技能文件。 |
| 恢复不额外请求 | 隔离 profile 关闭既有 `recapOnOpen` 后，最终代码恢复、全局展开/折叠前后 `/demo-request-count` 均为 **0**。 |

完整运行证据保留在：

`/home/liyihang/projects/dsh-src/dsh-context/.acceptance/session-cards/evidence/`

注意：最初命名为 `inline.ansi`、`inline-final.ansi` 的两轮运行被继承的 fullscreen 偏好覆盖，**均不能作为 inline 证据**。已拆分模式 HOME、固定隔离偏好后重跑；最终 `inline-actual-final.ansi` 与 `inline-actual-*` 才是真正 inline，并用 tmux `alternate_on=0` 确认。全屏为 `alternate_on=1`。导出物另有命名：`fullscreen-body.json`（28985 bytes）来自首轮全屏；`inline-body.json`（30727 bytes）来自误标轮次；`inline-final-body.json`（36083 bytes）则是在真正 `inline-actual-final.ansi` 轮次执行 save 得到，不属于同前缀的错误 ANSI 轮次。三份文件的权限、大小、时间及 JSON.parse 输出已保存为 `evidence/save-stat-json.txt`。旧恢复轮次曾触发上游默认自动 recap；最终准备的 profile 已关闭它，不把该请求归因于卡片。

## 影响、风险与回退

- 影响限于开启开关的两类记录及呈现。没有会话格式迁移、core 补丁或新增第三方卡片协议；关闭开关即可恢复原本的命令本地回显及技能隐藏策略。已写入的命令日志仍按 core 日志策略保留，不会因关闭开关删除。
- 必要关联修复：`enterSelection` 改为进入选择模式时读取当前可选行，修复原基线的空选择闭包；对普通用户行、命令和技能行有回归。没有重写按键系统。
- 开发验收时 `repro-toolcards.tsx` 曾有 7 项颜色/选择背景断言在原基线和候选相同失败。发布复检已定位：继承的 `TMUX` 触发 `src/ink/colorize.ts` 有意的 256 色降级，而该无头脚本断言 RGB。用与 CI 一致的 `env -u TMUX -u TMUX_PANE` 环境重跑后 **ALL PASS**；没有改渲染器或放宽断言。保留旧失败日志及 `repro-toolcards-no-tmux.log`，不是未修复的卡片颜色缺陷。
- 未跑发布全量门禁、真实付费模型、Windows/ConPTY；没有安装为稳定版本。已验证约 88K 码元正文，**未验证数十 MB raw 的展开延迟和长期压力**。展开使用既有转录绘制/滚动，不是新增流式文件阅读器；inline 依赖终端自己的 scrollback 容量。
- 新增 8 组去重分发断言在 inline harness 运行；全屏由卡片回归及真实入口补证，未逐个重复这 8 组。取消路径未改，保留原行为，但没有新增专门的取消交互断言；会话替换时丢弃迟到结果有既有回归。
- 无成对 `command/run` 的孤立 done 不猜命令名，不显示卡片；崩溃时尚未完成的命令没有结果卡。此实现展示结算结果，不提供运行中命令卡。
- 技能失败协议、第三方插件注册任意卡片、`#` 输入补全不在本次范围；本地另一个 skill-mention 分支没有被整体合入。

## 阅读代码路线

1. `src/dsh-adapter/backend/translate.ts`：DSH 命令配对，技能来源及 append/replace 判定；模型/厂商知识留在适配层。
2. `src/agent/events.ts` → `src/channel/projection.ts`：中立事实到独立 command/skill 行；开关、空正文及专属呈现去重。
3. `src/dsh-adapter/channel/transcript.ts`：超窗口正文降为预览，按 commandId/seq 从权威日志恢复。
4. `src/components/messages/{CommandCardRow,SkillCardRow}.tsx`、`src/channel/sanitize.ts`：安全过滤而不永久截断，折叠摘要及展开正文；`MessageList.tsx` 接入既有呈现与展开状态。
5. `src/screens/Chat.tsx`：取消重复回显/成功 toast，保留错误与草稿结果；选择 Enter 的局部修复。
6. `scripts/downstream/verify-session-cards.tsx`、`scripts/verify-plugin-command-output.mjs`：分别检查展示/恢复，以及从真实生命周期到命令分发的去重。

## 已准备的体验环境

候选代码：

`/home/liyihang/projects/dsh-src/.worktree/dsh-tui/session-cards`

隔离入口、数据、profile：

`/home/liyihang/projects/dsh-src/dsh-context/.acceptance/session-cards`

- Node `v24.16.0`，宿主 DSH `0.2.1-rc.5`，TUI 包版本 `0.18.0`（功能由任务分支区分，未改版本）。
- 已通过原生 `dsh plugin --profile session-cards add <绝对路径>` 链接候选 TUI 及 dsh-context；编译完成，HMR 关闭。没有手改安装包产物。
- `sessionCards: true`，`recapOnOpen: false`；合成技能 provider 只发现准备好的目录。模式 UI HOME 分别为 `ui-fullscreen/`、`ui-inline/`，共享隔离 `home/dsh` 的 profile 与测试会话。inline overlay 会替换整份 dsh-tui config，今后新增验收配置键须与 profile 同步；最终 `dump-config-inline-final.yml` 已重新生成并确认含 `recapOnOpen: false` 与 `fullscreen: false`。
- `env -i` 清空继承凭据，网络 fetch 限为 loopback，响应是固定合成 SSE；不需要任何真实 API key。无供浏览器访问的 Web 服务。
- 当前 agent 的两种模式均已正常退出，环境文件仍保留。可在自己的真实终端直接启动，不必 attach agent 的 tmux。

```sh
bash /home/liyihang/projects/dsh-src/dsh-context/.acceptance/session-cards/tui.sh fullscreen
# 或
bash /home/liyihang/projects/dsh-src/dsh-context/.acceptance/session-cards/tui.sh inline
```

首次凭据引导按 Esc 跳过；不要配置真实账号。启动页的命令若只是补全而未执行，再按一次 Enter，等结果出现后再做下一步。

## 用户亲自体验

### 1. 命令卡片与请求计数

**前提**：上述入口启动一个新会话。

**操作**：先 `/model-context`，应提示尚无主请求；发送 `hello`，等固定假回复。执行 `/demo-request-count` 记下计数，再 `/model-context`，点击卡片或 Ctrl+O 展开、再折叠，之后再次查计数。

**预期**：一条命令结果一张紧凑卡片；展开有完整正文，查看不增加计数，也没有重复本地文本块或成功 toast。重复主动执行同名命令会产生新的结果卡，这是预期，不是重复消费事件。

**失败信号**：查看时出现新助手回复、计数增加、同次结果出现两份。

### 2. 长正文、错误和窄终端

**操作**：把终端缩至约 40 列，执行 `/demo-long-report`。默认只见标题/摘要；点击或 Ctrl+O 展开，阅读至 `LONG_LINE_END`、`DEMO_LONG_REPORT_END`。全屏用滚轮/PgUp/PgDn 浏览；inline 用终端原生 scrollback。也可在该卡为最后一行时 Shift+↑ → Enter 展开，Esc 返回输入。折叠后执行 `/demo-error-report`。

**预期**：中文、🧪及长行正确换行，末尾可达；错误卡有错误标记，错误通知仍保留。整个过程不增加模型计数。

**失败信号**：仍有旧 200 行/65536 码元截断、读不到末尾、展开重跑命令、错误无反馈。

### 3. 技能是“已加载指令”，不是执行结果

**操作**：执行 `/card-demo`，等待假回复。查看用户消息和技能卡，展开看到 `SKILL_CARD_BODY_START` 至 `SKILL_CARD_BODY_END`，再折叠并核对计数。

**预期**：用户输入独立保留；每条显式注入一张“已加载指令”卡片。主动调用技能是正常模型输入，因此这次调用会增加一次请求；随后纯折叠/展开不会再增加。

**失败信号**：技能正文变成人工气泡、卡片声称任务成功、展开重读/重新执行技能，或一次注入被画两张。

### 4. raw 与完整保存

**操作**：有普通消息之后，执行 `/model-context raw` 并展开/折叠。再执行以下命令（文件名必须未存在；重试换新名字）：

```text
/model-context save /home/liyihang/projects/dsh-src/dsh-context/.acceptance/session-cards/exports/manual-body-1.json
```

**预期**：结果仍是通用卡片；文件保存完整 raw，权限 0600，计数不增加。可在另一个 shell 用 `stat` 与 `JSON.parse` 检查。已有文件或链接应拒绝覆盖。

**失败信号**：文件被覆盖、正文截断、保存触发模型请求。

### 5. 会话恢复

**操作**：`/exit` 正常退出。体验准备好的历史可运行：

```sh
bash /home/liyihang/projects/dsh-src/dsh-context/.acceptance/session-cards/tui.sh fullscreen --resume d253a3f7-39e5-46b4-83bb-c84145f355ec
```

**预期**：旧命令/技能卡仍在，展开仍读保存的正文，不执行原命令。该历史包含 agent 多轮验收的若干主动命令，不是只有一张演示卡。重启后假 provider 计数从 0 开始；旧计数卡中的数字是历史结果，不是当前实时计数。`/demo-request-count` 才返回当前值。dsh-context 的最近请求观察缓存本来不跨进程保存，旧结果卡的恢复不等于恢复该缓存。

**失败信号**：恢复旧卡就重新执行命令或请求模型、正文随磁盘技能变化、旧结果消失。

**清理**：上述流程均在隔离目录中；退出用 `/exit`。只删除自己新导出的 `manual-body-*.json` 即可重试保存；不必清理真实 HOME、真实 profile 或稳定安装。若不再需要 agent 的死 tmux 窗格，可执行 `tmux -L session-cards kill-server`（这是专用 socket）。整个隔离目录暂保留供复验。

## 证据与版本

- 规格：[spec.md](spec.md)，完整命令交接 `/home/liyihang/projects/dsh-src/dsh-tui-command-cards-handoff.md`；票集 [01](issues/01-implementation.md)、[02](issues/02-acceptance.md)，模式 ticket-driven。
- 基线 `ad19d0960e7dfbf181ad5171348762cc63270fe8`；实现 `bc7dae8f`；**开发体验验收代码 `33fff7509ac4fbb2df795668c7c503b2b823681e`**。发布前的下游维护性复查随后把命令读取接回官方 `SessionEvent` 判别联合、技能来源字段接回官方 `SkillInvocationSource`，以便协议漂移被编译发现；不改变运行时行为。最终发布源码以不可变标签及 CI `RELEASE.json` 为准。
- 开发体验验收的 `npm run compile` 完成于 `2026-11-06T17:13:42+08:00`；发布前类型接缝修复后已重新编译，并重跑 41 项卡片、真实分发去重及翻译回归。另在本地 rc.5 observer 源码工作树上运行 `verify-alpha-source` 通过（504 个 path mappings）；该树含观察接缝补丁，不把它称为干净官方源码。旧 baseline-validation 工作树的 Git 指针和 TypeScript 依赖已失效，没有修改或修复那个工作树。`pnpm compile` 因开发依赖软链接报 `ERR_PNPM_UNSAFE_MODULES_DIR`，改用相同 package script 的 npm 执行，未改 pnpm 配置或主检出产物。
- 前台在最终代码实跑：`verify-session-cards` 41 项、`verify-plugin-command-output`（含 8 组新分发场景）、`verify-dsh-translate`（168 live/162 replay）、boundary、golden（5 goldens/83 replay rows）、agent-domain（24 checks）、i18n、patch-surface、两个 askpanel 脚本、`git diff --check` 均通过。命令均为仓库现有 `node --import tsx/esm scripts/...` 入口；没有声称根级 test/lint 存在。
- worker 另跑 smoke、goal-todo、fixed-window、lite-profile 等通过；详见 01。开发时未跑发布全门禁；发布复检在修正开发依赖路径后已跑通本地 101/101 构建门禁、package、Bun package。installer 本机缺 zip，使用隔离 archiver 替代验证，真正 zip 及四组完整回归仍由私有发布 CI 把关。跨平台/超大正文压力仍见前述风险。
- 独立初审和最终复审均为 **pass with notes，无阻塞项**；成功 toast 问题已修复且前台复跑真实分发回归。最终复审要求的保存属性证据、误标模式说明和最新 inline dump 已补齐；其余测试面限制列于风险。最终复审记录见 02。
- 源码接缝/数据模型变动后优先复验场景 1/3/5；渲染、宽度、滚动或按键变化后复验场景 2 的两种模式；命令路由变化后复验场景 1/4 和 `sourceEventSeq` 的自动回归。
