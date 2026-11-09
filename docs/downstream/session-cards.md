# 会话事实卡片 / Session fact cards

## 中文

`sessionCards` 是一个**默认开启**的展示开关，把三类**持久会话事实**做成转录卡片：
DSH 注册表命令的结算结果、显式技能加载注入的正文，以及生产者声明为
`source.form: 'notice'` 的通用上下文通知。三者的模型面各自不变——
命令的 `command/run` / `command/done` 是 log-only 记录（从不进入模型消息），技能正文
与通知消息则**继续供模型使用**，卡片只是给同一份已保存的正文补一个可见投影；因此开关
不新增命令、不请求模型、不改写持久化事件，也不改变模型看到的 surface。

### 命令结果卡片

DSH 的 `dsh-commands` 在执行人类输入的命令时记两条 log-only 事件：`command/run`
（`commandId`、命令名、可选原始输入）与其结算的 `command/done`（同一
`commandId`、success/error、可选完整正文 `text`、可选 `sourceEventSeq`）。它们不是
模型消息。开启开关后，TUI 按 `commandId` 把两者配成一个命令结果事实，投影成一张
卡片：

- 默认折叠：一行标题（`⏵ /命令名 原始输入`）加一行摘要（正文首个非空行，最多
  240 个显示单元），不自动铺开正文。
- `Ctrl+O`（全局）或点击该行 / 消息选择里按 Enter（逐行走廊展开）显示完整正文：
  没有旧的 200 行 / 65536 UTF-16 码元 / 每行 4000 显示单元的截断，展开后随转录
  滚动读到正文最后一行。
- 错误命令用 `✗` 与错误色标题呈现，正文照旧是命令自己的失败文本；错误 toast 保留。
- **不重复**：开关打开后，注册表命令的结果不再经 dispatcher 的本地报告（`local` +
  `local-output` 行）铺一遍，也不再用成功 toast 复述——同一结果只呈现一次。错误
  toast 保留：它与错误卡同屏，提供颜色与时限的即时提示。
- **不出多余卡片**：成功但没有任何正文的命令不出卡（例如技能 `/name` 这类只表达
  “已执行”的命令）；`command/done` 带 `sourceEventSeq` 表示更早的权威记录已经拥有
  更完整的呈现（例如 `/compact` 的压缩检查点），此时既不出卡也不再加 toast。

与既有交互一致：折叠/展开只是 UI 状态，不重新执行命令、不请求模型；草稿消费、
取消、入 executor 前被拒（未知命令仍是 `command-not-found` 提示）等原有语义不变。

### 已知取舍

- 裸 `/goal`（DSH 注册表行的状态查询）不再适合单行 toast，因此上游会打印一块
  `/plugins` 式的转录报告；开关打开后它和其它注册表命令一样成为默认折叠的卡片，目标
  与轮次需要 `Ctrl+O` 展开才可见。这是通用命令卡片的默认折叠契约，不是 `/goal`
  专属行为；goal 面板的状态投影不受影响，开关关闭时仍打印整块报告。

### 显式技能卡片

用户显式加载技能（`/name` 与 `#skill:name` 是同一条 core 事实）时，core 会在用户的
普通消息之后追加一条 `skill-invocation` 来源的注入消息，正文是它当时交给模型的
canonical 文本。开启开关后，这条记录投影成一张独立技能卡：

- 默认一行：`[技能] 名字 · 已加载指令`，标签跟随界面语言与主题。
- 展开（同上交互）显示 core 当时保存的完整正文：不重读技能文件、不从包装标签里
  猜名字、也不请求模型。它证明的是**指令已加载**，不代表任务执行成功。
- 用户自己那一行（含 `/name` 或 `#skill:` 原文）仍单独保留为普通用户提示；技能卡
  不改变 `lastUserText`、回退锚点、持久化事件或模型消息。
- 其他注入内容（插件上下文等）保持上游“不渲染人工气泡”的行为。
- 只有 append 的注入才是转录材料：`surfaceOp` 为 `replace` 的替换副本只对模型可见，
  不额外生成卡片；旧版日志缺少 `surfaceOp` 时按 append 处理。

### 通用上下文通知卡

任何生产者只要在持久 `user/message` 上声明通用的 `source.form: 'notice'` 与
`summary`，就投影成一张独立通知卡；不要求插件名、`name` 或插件的 `message` 字段，
换任意 `source.kind` 都走同一路径。折叠摘要取 `source.summary`，完整正文取消息
`content`：

- 默认一行：`[通知] 摘要`，中性标签不推断严重级别；不新增 toast、系统通知或响铃。
- 展开（同上交互）显示持久消息的完整正文，长 CJK/emoji/ANSI 内容按渲染安全规则
  清理后完整呈现，不分页、不静默截断。
- 卡片保留原消息 `id`、事件 `seq` 与 `time`；它不是用户气泡，也不改变
  `lastUserText`、回退锚点或模型消息。
- 只有 append（或旧日志缺少 `surfaceOp` 标记）的消息才是转录材料：`replace`
  替换副本只对模型可见，不重复生成卡片。
- 既有专属分支（如 `model-selection`）优先于通用通知卡，保留原有提示口径。

### 恢复、分页与内存

三类卡片都来自持久化记录，因此实时、`/resume` 重放和“加载更早”分页得到同一行；
卡片正文保持会话窗口的内存约束——行超出转录窗口时正文降为预览，`loadOlder` 按
`commandId`（命令）或该记录的 `seq`（技能与通知）从日志恢复完整正文。

### 配置

默认开启，无需额外配置。要关闭，在 `cordis.patch.yml` / `cordis.yml` 的 dsh-tui 行显式设置：

```yaml
config:
  sessionCards: false
```

关闭时转录保持上游形态：注册表命令结果走 dispatcher 的本地报告路径，注入的技能
正文与全部合法 notice 消息只对模型可见。

## English

`sessionCards` is an **enabled-by-default** display switch that turns three **durable session
facts** into transcript cards: a DSH registry command's settled result, the body an
explicit skill load injected, and a generic context notice — a message whose producer
declared `source.form: 'notice'`. None of the model surfaces changes — the command's
`command/run` / `command/done` are log-only records (they never become model messages),
while skill bodies and notice messages **stay model-facing**: a card only adds a visible
projection of the same saved text. So the switch adds no command, requests no model turn,
rewrites no durable event and leaves the model surface exactly as it was.

### Command result cards

`dsh-commands` logs two log-only events per human-entered command: `command/run`
(`commandId`, name, optional raw input) and its settled `command/done` (same
`commandId`, success/error, optional complete `text`, optional
`sourceEventSeq`). Neither is a model message. With the switch on, the TUI pairs
them by `commandId` into one settled fact and projects one card:

- Collapsed (the default): a headline (`⏵ /name raw input`) plus one summary row
  (the body's first non-empty line, at most 240 display cells). The body is never
  unfolded automatically.
- `Ctrl+O` (global) or a click / selection-Enter on the row reveals the complete
  text: there is no old 200-line / 65536-code-unit / 4000-cell cut, and the
  expanded card scrolls with the transcript to its last line.
- A failed command gets a `✗` headline in the error colour and keeps its own
  failure text; the error toast stays.
- **No duplicate**: with the switch on, a registry command's result no longer
  goes through the dispatcher's local report (`local` + `local-output` rows) and
  is not repeated as a success toast either — one result is presented once. The
  error toast stays: it shares the screen with the error card and adds the
  colour and the timeout.
- **No empty card**: a successful command with no text adds nothing (a `/name`
  skill command only says it ran), and a `command/done` carrying
  `sourceEventSeq` means an earlier authoritative record already owns a richer
  presentation (`/compact`'s checkpoint), so neither a card nor a toast is added
  there.

Existing behaviour is preserved: folding is UI state that never re-executes the
command or reaches the model, and draft consumption, cancellation and the
pre-executor refusal (`command-not-found`) are unchanged.

### Known trade-off

- A bare `/goal` (the DSH registry row's status query) does not fit one toast
  row, so upstream prints a `/plugins`-style transcript block; with the switch
  on it becomes a collapsed card like every other registry command, and its
  objective and rounds need `Ctrl+O`. That is the generic card's default-fold
  contract rather than `/goal`-specific behaviour: the goal panel's own state
  projection is unaffected, and with the switch off the whole block is still
  printed.

### Explicit skill cards

When the user explicitly loads a skill (`/name` and `#skill:name` are the same
core fact), core appends an injected message with the `skill-invocation` source
after the user's own message; its body is the canonical text the model received.
With the switch on that record becomes one card:

- One line by default: `[skill] name · instructions loaded`, the tag following
  the UI language and theme.
- Expanding (same gestures) reveals the body core saved: it never re-reads the
  skill file, never parses the wrapper for the name, and never requests the
  model. It proves the **instructions were loaded**, not that the work
  succeeded.
- The user's own line (the `/name` or `#skill:` text) stays a normal user
  prompt; the card leaves `lastUserText`, the rewind anchor, durable events and
  model messages untouched.
- Other injected context keeps the upstream "no human bubble" behaviour.
- Only appended injections are transcript material: a `surfaceOp: replace` copy
  is model-only and yields no card, while a legacy record without the marker is
  an append.

### Generic context notice cards

Any producer that declares the shared `source.form: 'notice'` and a `summary` on a
durable `user/message` becomes one notice card. No plugin name, `name` or plugin-private
`message` field is required, and any `source.kind` takes the same path. The folded
summary comes from `source.summary`; the complete body comes from the message `content`:

- One line by default: `[notice] summary`, with a neutral tag that infers no severity;
  no toast, OS notification or bell is added.
- Expanding (same gestures) shows the durable message's complete body. Long
  CJK/emoji/ANSI content is sanitized for rendering and then shown whole, with no
  paging and no silent truncation.
- The card keeps the original message `id`, event `seq` and `time`; it is not a user
  bubble and leaves `lastUserText`, the rewind anchor and model messages untouched.
- Only an appended message (or a legacy record without the `surfaceOp` marker) is
  transcript material: a `replace` copy is model-only and yields no duplicate card.
- Existing specialized branches (for example `model-selection`) take precedence over
  the generic notice card and keep their wording.

### Restore, paging and memory

All three cards come from the durable record, so live, `/resume` replay and "load
earlier" paging produce the same row. Retention follows the existing transcript
window: beyond it the body drops to a preview, and `loadOlder` restores it from
the log by `commandId` (commands) or the record's `seq` (skills and notices).

### Configuration

Enabled by default; no additional configuration is needed. To disable it, set
this explicitly on the dsh-tui row of `cordis.patch.yml` / `cordis.yml`:

```yaml
config:
  sessionCards: false
```

With the switch off the transcript keeps the upstream shape: a registry command's
result goes through the dispatcher's local report, and injected skill bodies and every
valid notice message stay model-facing only.
