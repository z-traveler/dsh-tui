# 自定义卡片：生产者与展示消费者开发规范

本规范面向本私有下游的插件作者。新增或修改卡片生产者、TUI 展示适配器、卡片更新逻辑或历史恢复时，请先阅读本页。

职责上，TUI 负责阅读展示与交互，业务包负责提供业务数据以及对应的展示适配。需要明确的是：卡片的外观不决定内容是否会进入模型上下文，也不代表业务任务执行成功。

## 支持边界

这不是官方 DSH 的通用插件协议。独立卡片依赖本下游自带的卡片消费者：持久化调用的是正式导出的 `appendPluginRecord()`，但官方 rc.5 的 `dsh-session` README 明确禁止仓库外插件调用该 API。本项目的维护者已接受这里的私有下游例外；这不代表上游官方支持，也不会修改或绕过宿主实现。

- 在没有插件记录 API 的宿主（包括已核实的 `0.1.5-alpha.2`）上，不支持写入独立卡片：`appendTuiCard()` 会明确报错不支持，而不会用 `session.append()` 伪造记录。
- 读取端只调用宿主提供的 `pluginRecordOf()`。在没有该 API 的宿主上，TUI 不会自行解析私有载体，普通消息回放和 TUI 模块加载依然保持可用。
- 在支持的宿主上，提交、恢复、分叉与校验规则均保持不变。
- 正常恢复与分叉是必须验证通过的路径；跨未来会话格式的迁移只有尽力保留的保证。插件作者不能向普通官方 DSH 环境承诺能自动显示这些卡片，也不能承诺迁移永不丢失。
- Web 端仍需要实现自己的浏览器消费者，TUI 展示适配器不能直接用作 Web 组件。

## 生产者、适配器与宿主的分工

- **core 生产者**：作为内容、计数、角色和来源的权威来源，决定业务事实何时成立。不要让 TUI 从文本字样里反推这些事实。
- **分端展示适配器**：将已记录的业务数据同步转换成标题、摘要和有序内容块。它是一个纯数据转换函数，不能查询最新请求、读取当前技能文件、执行工具或请求模型。
- **TUI 卡片宿主**：统一处理主题、卡面外观、折叠展开、选中高亮、滚动、长正文处理、内容更新与历史恢复。展示适配器不得返回 React/HTML 组件、回调函数、按钮、自定义按键或终端控制序列。

展示适配器仍然是进程内的受信任插件代码，必须遵守宿主原有的准入规则；纯数据接口并不是 JavaScript 沙箱，不提供针对不可信插件代码的隔离保证。

同一个业务包可以同时提供 core、Web 与 TUI 三个入口，通过标准的包导出和 profile 插件行来组合，不要发明 `dsh.tui` 这类非标准清单字段。Web 端通过 `dsh.client` 和官方 slots 加载，TUI 消费者则通过注入宿主提供的注册接口接入。如果用户只安装了 core 或 Web，不应被强制加载 TUI 组件或引入第二份 React。

## 选择内容来源

### 已有正式事实

如果会话日志里已经记录了正式的业务事实，直接为它适配卡片展示即可，不要为了换个外观再重复记一条数据：

- 技能加载复用 `skill-invocation` 指令记录，保留其原有的模型可见性。
- 命令结果复用 `command/run` 与 `command/done` 的配对记录，不要伪造工具调用或人工消息。
- 技能卡片表达的是“已加载指令”，正文直接取自当时实际注入的快照；`/model-context` 的报告属于仅记日志（log-only）的命令结果，不会进入模型上下文。展开、恢复或重放卡片，都不能重新执行生产者或发起模型请求。

### 新增独立卡片

只有在确实没有现成记录时，才使用专用的独立卡片载体，不要借用模型消息、伪命令或其他插件的内部记录。

- 卡片类型（`type`）必须带命名空间，每张卡片都有稳定的业务身份（`id`）。同一会话内，相同 `type` 和相同 `id` 的后续记录会更新同一张卡片；不同 `type` 即使 `id` 相同也不会互相覆盖。
- 每次更新都需要提交完整的最新数据快照，由持久化的提交顺序决定新旧，不需要生产者维护额外版本号。首版不提供增量 patch、删除协议或通用的任务终态状态机，这些逻辑也不能偷偷放进渲染器的副作用里。

## 内容规范与安全

- **标题与摘要**：面向折叠态阅读，完整正文必须留在数据里。文本、Markdown 和表格都只是展示数据，不是可执行代码；不要用 ANSI 转义符或 HTML 绕过主题和宽度处理。显示列宽计算、安全清理与布局由宿主统一负责，生产者不要按 JS 字符串长度去截断出所谓的“终端列宽”。
- **如实表达状态**：不要从正文内容、来源名称或报错字样里猜测业务状态。错误、进度、估算值和未知值必须明确来自生产者的数据——未知窗口不能写成 0，估算值不能标成实测值，已加载指令不能写成执行成功。
- **折叠不等于删数据**：不要为了做预览而永久截断正文或工具 schema。如果业务自身有明确的超限规则（例如 dsh-context 对超大 prompt 只记录尺寸和保存路径），应予保留；消费者不能把残缺正文伪装成完整内容。历史恢复时只读取当时持久化保存的内容，不能用当前的新数据去替换历史记录。
- **隐私与持久化安全**：所有卡片记录都会随会话日志写入磁盘。`data` 必须是允许公开展示的数据，不能把展示适配器当作隐私过滤边界——一旦缺少适配器，宿主可能会直接把 `data` 当 JSON 展示出来。请避免将密钥、认证头或非必要的私密数据写入卡片；显示上的折叠不会降低已存储数据的敏感性，降级视图也不提供日志保密。此外，外部链接不能在展示或恢复时自动发起网络请求。

## 生命周期与降级

展示适配器按当前活跃插件实例绑定注册，插件卸载时自动撤销。请不要保留失效闭包，也不要用 root 上下文绕过注册归属权。同一卡片类型只能有一个适配器，重复注册会被拒绝，不会按加载顺序悄悄覆盖。

当缺少适配器或适配器执行失败时，宿主会使用该条记录自带的降级内容（`fallback`）；如果记录没有提供 `fallback`，则把记录自身的 `data` 格式化为可读的 JSON 展示，而不会去反向查询生产者。这种降级展示仅限专用卡片记录，不会把其他插件的内部缓存或私有记录自动暴露成卡片。

同一逻辑卡片在会话流中始终停留在它最初出现的位置，进度更新时直接原地刷新，不会生成一串重复的新消息。正常恢复会话时显示最新状态；精确到某个历史时间点的回退只在既有回放机制自然支持时才提供，并非无条件保证，具体行为以验证记录为准。

## 公开入口与数据契约

- `@deepseek-harness-tui/dsh-tui/cards`：不依赖特定后端的数据类型与校验工具，包含 `TuiCardRecord`、`TuiCardView`、`TuiCardDensity`、`TuiCardPresenter`、`asTuiCardRecord()`、`asTuiCardView()`、`fallbackCardView()`、`cardPlainText()` 以及载体名常量 `TUI_CARD_RECORD_TYPE`。
- `@deepseek-harness-tui/dsh-tui/cards/dsh`：DSH 专属的写入入口 `appendTuiCard(session, record)`。只有这个入口依赖 DSH Session 运行时，不能把它重新导出到跨后端的展示契约里。
- 消费者入口：在活跃插件中调用 `ctx.tuiRenderers.registerCard(type, presenter)`。TypeScript 插件可通过 `import type {} from '@deepseek-harness-tui/dsh-tui/extensions'` 获得 Context 类型声明合并；不要为了拿类型而在 core 包里在运行时加载所有扩展服务。

注意事项：

- **构建要求**：本接口要求包含本规范实现的私有下游构建。仅看到 npm 包版本号为 `0.18.0` 并不能说明 `registerCard` 一定存在，没有该方法的旧宿主不支持本规范，必须同时核对加载日志和实际注册结果。
- **启动参数桥**：如果你手工重写了 TUI 插件行配置，请务必保留随包 `cordis.patch.yml` 中的启动参数桥接逻辑（特别是 `sessionId` 对 `DSH_TUI_RESUME_SESSION` 的映射）。因为 launcher 会先消费掉 `--resume`，行插件不能假定还能从 `argv` 里直接读到它。建议优先复用包级覆盖层，不要整套复制启动组合。
- **链接开发依赖共享**：做本地链接开发时，必须与实际宿主共享框架包的**同一个模块实例**（而不只是相同版本号）。因为 DSH 的写入器会访问 Session 类的私有字段，跨模块副本调用会抛出 `Receiver must be an instance of class Session`。请按宿主 realpath 解析并共享框架依赖，不要复制 Session 或修改运行时方法，也不要在正式安装中保留工作区链接；隔离验收脚本只会临时调整任务工作树中的开发依赖。

### 独立卡片记录（version 1）

```ts
interface TuiCardRecord {
  readonly version: 1
  readonly type: string
  readonly id: string
  readonly data: JsonValue
  readonly fallback?: {
    readonly title: string
    readonly body: string
    readonly summary?: string
  }
}
```

字段约束：

- `JsonValue`：必须是可无损序列化的 JSON 数据，不能包含回调、类实例、循环引用、稀疏数组、`undefined` 或非有限数字（`NaN`/`Infinity`）。
- `type`：小写的命名空间路径（例如 `acme/report`），各段允许字母、数字、点、下划线和短横线，且必须以字母或数字开头。独立生产者必须使用自己的命名空间，不能冒用宿主的 `command/` 类型。
- `id`：非空且稳定的字符串。同一会话内的 `(type, id)` 共同决定卡片的更新身份，不要拿行号、标题或摘要当作身份。
- **校验与提交**：不支持的记录版本或损坏的数据结构不会作为可信卡片渲染，宿主也不会猜测其含义（原始记录仍归会话日志所有），只有通过 version 1 结构校验的记录才会进入展示和降级流程。记录通过 `plugin:dsh-tui/card` 载体提交，写入后 `appendTuiCard` 返回已被接收的 `seq`（这不代表磁盘已经完成刷写；需要持久屏障的业务请按目标 DSH 契约调用 sessions 的 flush）。此外，不要在展示适配器或 `session/event` 发布栈里追加卡片，生产者应在自己的业务边界写记录并遵守宿主的重入限制。

### 展示输出

```ts
type TuiCardBlock =
  | { readonly kind: 'text'; readonly text: string; readonly label?: string; readonly truncate?: 'end' }
  | { readonly kind: 'markdown'; readonly text: string }
  | {
      readonly kind: 'table'
      readonly columns: readonly string[]
      readonly rows: readonly (readonly string[])[]
      readonly layout?: 'compact'
    }
  | {
      readonly kind: 'distribution'
      readonly total: number
      readonly segments: readonly { readonly value: number; readonly kind: 'filled' | 'reserved' | 'empty' }[]
    }

interface TuiCardView {
  readonly title: string
  readonly label?: string
  readonly summary?: string
  readonly blocks: readonly TuiCardBlock[]
  readonly preview?: readonly TuiCardBlock[]
  /** 可选：这一张卡的密度；`compact` = 不画配置出来的卡面。 */
  readonly density?: 'compact'
}
```

各块与字段的规则如下：

- **表格（`table`）**：每行的单元格数量必须与 `columns` 列数严格一致，每个单元格都是字面文本（即使包含竖线或换行也属于同一个单元格，不要拼成 Markdown 让宿主去猜列）。设置 `layout: 'compact'` 时不画表格外框和列标题，首列左对齐、其余列右对齐；窄屏时单元格会自动换行而不删内容，连数值列都放不下时退回逐行文本（不再保证列对齐）。计量单位请在单元格里或紧邻表格的标题中说明。
- **Markdown 与文本块（`markdown` / `text`）**：需要按 Markdown 格式阅读的正文用 `markdown`；原始内容、schema 或需要按字面原样查看的内容用 `text`。完整内容保留在记录中，终端安全清理不会修改日志。`text.label` 会作为宿主按标签主题色渲染的纯文本前缀；`truncate: 'end'` 会让该文本占一行并在末尾按显示宽度加 `...`（不改原数据），省略 `truncate` 则正常换行。如果 `title` 和 `label` 都为空，宿主不会绘制额外的卡片头，适合自身已经带有标签的内容块。
- **折叠预览（`preview`）**：提供 `preview` 时折叠态显示它，展开后由完整的 `blocks` 替换（两者不会拼接）；不提供时维持标准的标题/摘要折叠方式。请确保把全部阅读内容放进 `blocks`，因为 `cardPlainText()` 只读取完整内容。展开提示和快捷键由宿主统一管理；当预览与完整内容相同时不会提示无效展开，也不要在预览文本里硬编码快捷键。
- **单卡紧凑密度（`density: 'compact'`）**：只作用于声明它的那一张卡片。
  - 宿主依然按当前方案解析样式，但会把这张卡的背景、边框、内边距和类型间距全部归零，同时保留标签与正文主题色、选中高亮、折叠、`Ctrl+O` 以及展开后的完整正文和表格。
  - 紧凑折叠行沿用不同的标签与正文主题色：短内容占一行，完整的标题和摘要在可用宽度内自动续行，不截断路径，放不下展开提示时也不占用内容空间。
  - 省略 `density` 时沿用该类型的常规卡面（在默认 `legacy` 下与引入该字段前逐格一致），同类型的其他卡片、技能卡和命令卡不受影响。不要为了单卡紧凑去改 `cardStyles.kinds.custom`，也不要为此新增卡片类型。
  - 当窗口把这一行折成有界预览（完整内容靠日志恢复）时，`density` 会跟着行保留，恢复前后不会变色或整体缩高。
  - `density` 目前只支持 `'compact'`，其他值均视为无效并走降级路径。注意它和 `table.layout: 'compact'` 是两回事，后者只改变表格画法，任何卡片都能用。
- **分布条（`distribution`）**：按当前可用宽度绘制八行栅格。`total` 必须是有限正数，各段 `value` 必须是非负有限数。超出的部分会在总量处截断渲染（不改写原数值），未分配的格子留空（不自动标为空闲）。宿主只管几何绘制和主题，不推导业务分类、预留或空闲量；未知指标由业务适配器自行注明，并省略对应的栅格或分段。
- **只读与可序列化**：整个 `TuiCardView` 必须能无损序列化为 JSON，不要填入显式 `undefined`、回调函数或运行时对象。校验器会过滤掉未定义的字段，并拷贝 `preview`、`blocks`、`segments` 和表格数组，防止调用方在返回后修改数组影响到已接收的视图。
- **纯函数执行**：Presenter 只接收记录里的 `data`，同步返回 `TuiCardView` 或 `undefined`。返回 `undefined`、抛出异常或返回格式不合法的视图时，都会自动转入降级展示。`cardPlainText()` 提供不依赖终端的纯文本表达，其中 `markdown` 块会保留原始 Markdown 文本。

## 生产者与消费者示例

### core：记录独立报告或完整进度快照

```ts
import type { Session } from '@deepseek-ai/dsh-session'
import { appendTuiCard } from '@deepseek-harness-tui/dsh-tui/cards/dsh'

export function recordReport(session: Session, runId: string, message: string) {
  return appendTuiCard(session, {
    version: 1,
    type: 'acme/report',
    id: runId,
    data: { message },
    fallback: { title: '检查报告', body: message },
  })
}
```

用同一个 `runId` 再次调用会更新同一张卡片；要创建新的独立报告时请换一个新的业务 `id`。这个函数既不会向模型发消息，也不会触发实际工作。如果业务接口已经拥有正式的会话日志事实，请优先复用对应的适配接口，不要套用这个例子重复记一条记录。

### tui：声明纯数据展示

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-harness-tui/dsh-tui/extensions'

export const name = 'acme-cards-tui'
export const inject = ['tuiRenderers']

export function apply(ctx: Context) {
  ctx.tuiRenderers.registerCard('acme/report', data => {
    if (data === null || typeof data !== 'object'
      || !('message' in data) || typeof data.message !== 'string') return undefined
    return {
      title: '检查报告',
      blocks: [{ kind: 'text', text: data.message }],
    }
  })
}
```

注册行为会自动绑定调用插件的生命周期，如果需要提前取消可以保存并调用返回的 disposer 函数。注意：如果注册被拒绝（例如重复注册），宿主会打警告并返回一个空操作 disposer，因此不能仅凭“拿到了返回值”就以为注册成功。重复注册不会覆盖原有适配器，插件卸载后，后续的卡片展示会自动使用记录的降级视图，不会保留已卸载插件的闭包。

### 已有命令结果：不增加卡片记录

注册 `command/<name>` 可以直接适配已有的命令完成结果（例如 `command/model-context`）。宿主会向适配器传入：

```ts
{ commandId, name, args?, outcome: 'success' | 'error', text }
```

这些字段直接取自配对的命令事件，`args` 保留原始空白字符，命令语法由适配器自行解析。没有注册适配器时显示宿主通用的命令卡片；适配器返回 `undefined` 或无法解析时，保留原结果的可读降级展示（其中可能包含生产者原有的私有文本协议，通用宿主不会猜测如何剥离它）。如果命令记录带有 `sourceEventSeq`，对应权威记录的专属展示依然优先，不会产生重复卡片。

本轮真实的消费者插件是 `@z-traveler/dsh-context/tui`。在同时安装了该业务包和本下游 TUI 的开发 profile 中，可通过覆盖层加载它：

```yaml
- insert:
    - id: dsh-context-tui
      name: '@z-traveler/dsh-context/tui'
```

这个消费者复用 `dsh-context` 自身的结果解析逻辑，通用 TUI 并不知道 `dsh-context/card@1` 的内部格式。卡片只展示当次记录的报告，不会重新查询最新状态。另外，写草稿与卡片渲染是分离的：支持写草稿的业务入口可以注册[命令结果到草稿映射](command-drafts.md)，只消费当前 TUI 发起的实时命令结果。`prompt copy` 卡片只反映请求状态，不能凭卡片就认为草稿已写入，历史卡片也不会再次触发写稿。

## 卡面与主题

自定义卡片统一使用 `cardStyles.kinds.custom` 的主题样式，业务插件不应自行绘制卡面或硬编码颜色；`other` 类型仍保留给普通通知和本地回显使用，避免它们一起被染成自定义卡面。

如果只需要让单张卡片不画背景和边框，在展示数据里返回 `density: 'compact'` 即可，无需改动全局配置。默认的 `legacy` 方案保持原有无底色外观；如果想启用带紫色底面的 Pi 风格卡面，可以在 `~/.dsh-tui/settings.json` 的 `values` 中合入以下配置（保留其他设置）：

```json
{
  "version": 1,
  "values": {
    "cardStyles": {
      "preset": "pi-like"
    }
  }
}
```

用户配置文件优先于部署配置，修改后重启即可生效。通过官方 DSH CLI 挂载本包时，也可以在插件行的 `config.cardStyles` 中声明同样对象；但当前独立直达入口在 profile 组合前就已启动，所以请以上述用户配置文件为验收标准。

在 `pi-like` 方案下，通用自定义卡片、技能卡和已适配的命令结果卡片都会获得独立的紫色卡面、粗体标签、灰色正文以及上下左右各 1 格的内边距；展开后标签、标题和正文分层排版，不再额外套用 `legacy` 的两列缩进。技能卡片里已保存的指令在该方案下会按 Markdown 渲染并保留字面 XML（`legacy` 下仍按纯文本字面显示）。四个主题颜色角色 `customMessageBackground`、`customMessageLabel`、`customMessageText`、`customMessageHint` 均可随主题覆盖。

需要记住：`custom` 并不是给某个业务类型独占的样式槽。选中高亮始终优先于普通底色，边框和内边距都会计入内容可用宽度。这套配置只影响阅读外观，不改变卡片语义或执行状态。另外，不要为了开启这个样式去额外配置灰色的 `toolCardBackgroundDim` 覆盖，那会把紫色卡面改回工具卡片的外观。

## 验证与发布前检查

生产者和消费者插件应当测试覆盖以下场景：实际记录生成卡片、同身份覆盖更新、不同会话相互隔离、适配器缺失或报错时的降级展示、插件卸载后的清理、长正文与完整 schema 展示、正常恢复与分叉会话，以及确认模型输入没有额外增加。任何终端可见的改动都需要在 inline 和 fullscreen 两种模式及窄终端宽度下实际走查——仅仅编译通过、配置里有条目或程序能启动，都不能证明插件正常工作。

公开契约与 DSH 桥接的定向验证命令如下：

```sh
node --import tsx/esm scripts/downstream/verify-custom-card-api.ts
node --import tsx/esm scripts/downstream/verify-custom-card-density.tsx
node --import tsx/esm scripts/downstream/verify-custom-card-flow.tsx
node --import tsx/esm scripts/downstream/verify-card-reading-rows.tsx
# 先编译，再验证实际 Session 与无可选 peer 的中立入口导入：
node --import tsx/esm scripts/downstream/verify-custom-card-carrier.ts
# 用编译后的公开类型声明检查本页的生产者/消费者示例：
node node_modules/typescript/bin/tsc -p scripts/downstream/fixtures/custom-card-consumer/tsconfig.json
```
