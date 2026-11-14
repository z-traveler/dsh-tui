# 自定义卡片：生产者与展示消费者开发规范

本规范面向本私有下游的插件作者：新增或修改卡片生产者、TUI 展示适配、卡片更新或历史恢复时先读此页。TUI 负责阅读与交互，业务包负责领域事实及其展示适配；一张卡片的外观不决定内容是否进入模型上下文，也不是工作成功的证明。

## 支持边界

这不是官方 DSH 的通用插件协议。独立卡片依赖本下游的卡片消费者；其持久化调用正式导出的 `appendPluginRecord()`，但官方 rc.5 的 `dsh-session` README 明确禁止仓库外插件调用。维护者已明确接受本项目的私有下游例外，不代表上游支持，也不修改或绕过宿主实现。

没有插件记录 API 的宿主（包括已核实的 0.1.5-alpha.2）不支持独立卡片写入；`appendTuiCard()` 在这种宿主上明确报不支持，不改用 `session.append()` 仿造记录。读取端只调用宿主提供的 `pluginRecordOf()`，没有该 API 时不自行解释私有载体；普通消息回放和 TUI 模块加载保持可用。支持宿主上的提交、恢复、分叉与验证规则不变。

普通恢复与分叉属于必须验证的路径；跨未来会话格式迁移只有尽力保留保证。插件作者不能向普通官方 DSH 安装承诺自动显示这些卡片，亦不能承诺迁移永不丢失。Web 仍需要自身的浏览器消费者；TUI 展示适配不能作为 Web 组件使用。

## 事实、展示适配与宿主

- **core 生产者**：拥有内容、计数、角色和来源的真源，决定业务事实何时成立。不要让 TUI 从文本猜测这些事实。
- **分端展示适配**：将已经记录的领域数据转换为标题、摘要与有序内容。它是同步的纯数据转换，不查询最新请求、不读取当前技能文件、不执行工具或请求模型。
- **TUI 卡片宿主**：统一处理主题、卡面、折叠、选中、滚动、长正文、内容更新与恢复。展示适配不得返回 React/HTML 组件、回调、按钮、自定义按键或终端控制序列。

展示适配仍是进程内的受信任插件代码，遵守宿主原有准入规则；纯数据接口不是 JavaScript 沙箱，不提供不可信插件代码的隔离保证。

同一个业务包可以提供 core、Web 与 TUI 三个入口。使用普通包导出与 profile 插件行组合，不发明 `dsh.tui` 清单字段。Web 使用其 `dsh.client` 加载及官方 slots；TUI 消费者通过注入宿主注册端口接入。仅安装 core 或 Web 时，不应被强制加载 TUI 组件或第二份 React。

## 选择内容来源

### 已有正式事实

已有日志中已经存在事实时，直接适配它，不为了换卡片外观再追加一份。技能加载复用 `skill-invocation` 指令记录，保留模型可见性；命令结果复用 `command/run` 与 `command/done` 的配对，不伪造工具调用或人工消息。

技能卡表示“已加载指令”，正文来自当时实际注入的快照。`/model-context` 的报告属于 log-only 命令结果，不进入模型上下文。展开、恢复与重放都不能重新执行生产者或发起模型请求。

### 新增独立卡片

使用专用卡片载体，不借用模型消息、伪命令或其他插件内部记录。领域类型带命名空间，卡片具有稳定身份；同一会话内同类型、同身份的后续记录更新同一张卡片。

每次更新提交完整数据快照，由持久提交顺序决定新旧，不要求生产者维护额外版本计数器。首版不提供增量 patch、删除协议或通用任务终态状态机；这些不能藏进 renderer 的副作用。不同类型即使业务 id 相同也不能互相覆盖。

## 内容与安全

标题与摘要面向折叠阅读，完整正文必须保留。文本、Markdown 与表格是展示内容，不是可执行代码；不要用 ANSI 或 HTML 绕过主题与宽度处理。宿主负责显示单元宽度、安全清理与实际布局，生产者不能按 JS 字符串长度裁剪出“终端列”。

不要从正文、来源名或错误字样推断领域状态。错误、进度、估算与未知值必须来自生产者的事实；未知窗口不能当作零，估算不能标为实测，已加载指令不能标为执行成功。

折叠不是删除数据。不要为显示预览而永久截断正文或工具 schema。业务本身已有明确超限规则时要保留，例如 dsh-context 的超大 prompt 只记录尺寸及保存指引；消费者不能把缺失正文伪装成完整正文。历史恢复只读取该次持久内容，不能用当前数据替换它。

所有结果可能随会话日志落盘。`data` 必须是允许展示的数据，不能把 renderer 当成隐私过滤边界：没有适配时它可能被按 JSON 展示。避免把密钥、认证头或非必要私密数据放进卡片；显示折叠不会降低已持久化数据的敏感性，fallback 也不提供日志保密。外部链接不能在展示或恢复时自动触发网络请求。

## 生命周期与降级

展示适配按活跃插件实例注册，卸载时撤销；不能保留失效闭包或以 root 身份绕过注册所有权。一个类型只由一个适配负责，重复注册要被拒绝，不通过加载顺序悄悄覆盖。

无适配或适配失败时，使用该条记录自己的可读降级内容；没有专用降级内容则显示其自身领域数据的可读 JSON，而不是查询生产者。只对专用卡片记录做这种降级，不把其他插件的内部缓存或记录自动暴露为卡片。

同一逻辑卡片保持原始锚点和阅读身份，进度更新不生成一串独立消息。正常恢复显示最新状态。精确时间点回退只在既有回放机制自然支持时提供，不是无条件保证；具体实现行为以验证记录为准。

## 公开入口与数据契约

- `@deepseek-harness-tui/dsh-tui/cards`：无厂商运行时依赖的数据类型与校验，包括 `TuiCardRecord`、`TuiCardView`、`TuiCardDensity`、`TuiCardPresenter`、`asTuiCardRecord()`、`asTuiCardView()`、`fallbackCardView()`、`cardPlainText()` 和载体名 `TUI_CARD_RECORD_TYPE`。
- `@deepseek-harness-tui/dsh-tui/cards/dsh`：DSH 专属生产入口 `appendTuiCard(session, record)`。只有此入口需要 DSH session 运行时，不能把它重新导出进跨后端的展示契约。
- 消费者在活跃插件中调用 `ctx.tuiRenderers.registerCard(type, presenter)`。TypeScript 消费者可通过 `import type {} from '@deepseek-harness-tui/dsh-tui/extensions'` 获取 Context 声明合并；不要为获取类型而在 core 中运行时加载全部扩展服务。

本接口要求包含本规范实现的私有下游构建。仅凭 npm 包版本 `0.18.0` 无法证明 `registerCard` 已存在；没有该方法的旧宿主不支持本规范。加载日志和实际注册行为必须一并确认。

手工重写 TUI 行配置时，保留随包 `cordis.patch.yml` 的启动参数桥，尤其是 `sessionId` 对 `DSH_TUI_RESUME_SESSION` 的映射；launcher 会消费 `--resume`，不能假设行插件还能从 argv 读到它。优先复用包级覆盖层，不复制完整启动组合。

链接开发必须与实际宿主共享框架包的**同一模块实例**，不只是相同版本。DSH 的 writer 访问 Session 私有字段，跨副本调用会报 `Receiver must be an instance of class Session`。按宿主 realpath 解析并共享框架依赖，不复制 Session、不改运行时方法，也不在正式安装中保留工作区链接；本功能的隔离验收脚本只调整任务工作树的开发依赖。

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

`JsonValue` 在这里表示可无损序列化的 JSON 数据，不是回调、类实例、循环引用、稀疏数组、undefined 或非有限数字。`type` 是小写命名空间路径，例如 `acme/report`；各段允许字母、数字、点、下划线与短横线，并以字母或数字开始。`id` 是非空稳定字符串。同一会话内的 `(type, id)` 是更新身份，不使用行号、标题或摘要代替身份。独立生产者使用自己的命名空间，不冒用宿主的 `command/` 类型。

不支持的记录版本和坏载荷不作为可信卡片呈现，不能猜测其语义；原始记录仍由会话日志拥有。只有通过版本1结构校验的记录才进入下面的展示与降级路径。

记录通过 `plugin:dsh-tui/card` 载体提交，更新为完整快照；helper 返回已经接受该记录的 seq，不等同于已经完成磁盘刷写。需要立即持久屏障的业务按目标 DSH 契约调用 sessions 的 flush。不要在展示适配或 `session/event` 发布栈中追加卡片；生产者在自己的业务边界记录并遵守宿主的重入限制。

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

每行表格必须与列数相同，单元格是字面文本；包含竖线或换行的值仍属于一个单元格。不要把原始单元格拼接为 Markdown 后交给宿主重新猜列。`markdown` 块用于确实希望按 Markdown 阅读的正文；`text` 块用于 raw、schema、需要字面阅读的内容。完整内容保留在记录中，终端安全清理不改写日志。

`text.label` 是宿主按标签主题角色呈现的纯文本前缀；`truncate: 'end'` 使该文本占一行，按显示单元在末尾加 `...`，不改写原内容。完整块省略 truncate 即正常换行。空 title 与空 label 不绘制额外卡头，适用于已带标签的阅读块。

`preview` 是可选的折叠阅读内容；展开后由完整 `blocks` 替换，不将两者拼接。不提供时保持原有的标题/摘要折叠行为。生产者应把全部阅读事实保留在 `blocks` 中；`cardPlainText()` 只读取完整内容，避免重复预览。展开提示与按键由宿主管理；预览已等于完整内容时不提示无效展开，不在预览中硬编码快捷键。

`density: 'compact'` 是可选的最低阅读密度，只作用声明它的那一张卡片：宿主仍按当前方案解析卡面，但把这张卡的底色、边框、内边距与类型间隔一起归零；主题的标签/正文色、选中高亮、折叠与 `Ctrl+O`、展开后的正文与表格都保留。紧凑折叠行沿用不同的标签/正文主题色，短内容一行，完整标题和摘要在可用显示单元内自动续行，不以预览截断替代完整路径；放不下的展开提示不占用内容空间。省略时沿用该类型的卡面（默认 `legacy` 下与引入这个概念前逐格一致），同类型的其它卡片、技能卡与命令卡都不受影响：它不是全局卡面覆盖，不要为此去改 `cardStyles` 的 `kinds.custom`，也不要新增第二种卡片类型。窗口把一行折成有界预览时（完整展示由日志恢复），密度跟着行保留：预览仍按同一卡面画，恢复前后不会换脸色或整体缩高。值只有 `compact`；其它取值属于不合契约的展示，按既有降级路径处理，由记录自己的可读内容兜底。它与 `table.layout: 'compact'` 是两件事：后者只改表格画法，任何卡片都能用。

`table.layout: 'compact'` 不画表框或列标题，首列左对齐、其余列右对齐；单元格窄屏换行，不删除内容。数值列也放不下时退为逐行文本，不再保证列对齐。单位应通过单元格或紧邻表格的标题说明清楚。`distribution` 按当前可用宽度画八行栅格；`total` 必须是有限正数，分段值必须有限且非负。绘制在总量处截断但不改写数值；未分配的格子留空，不自动解释为空闲。宿主只负责几何与主题，不推导业务分类、预留或空闲量。未知指标由业务适配器注明，并省略对应栅格或分段。

展示整体也必须可无损序列化为 JSON；省略可选字段，不填入显式 undefined、回调或运行时对象。校验器只保留已定义的展示字段，并复制预览、内容块、分段与表格数组，避免调用方随后修改数组改变已接收的视图。

Presenter 只接收该条记录的 `data`，同步返回展示或 undefined；后者、异常或不合契约的输出均走降级。输入及返回的展示都是只读快照，不得在返回后继续修改已交给宿主的 blocks。`cardPlainText()` 提供不依赖终端的可读表达，其中 Markdown 保留源文。

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

同一 runId 的下一次调用更新同一张卡片；创建独立报告时使用新的业务身份。此函数既不提交模型消息，也不执行报告描述的工作。业务接口若已经拥有正式日志事实，应使用其适配接缝，而不是为了这个例子重复记录。

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

注册已绑定调用插件的生命周期；需要提前撤销时可保存并调用返回的 disposer。拒绝注册时返回空操作 disposer 并告警，不能仅凭“取得了函数”判断注册成功。重复注册不覆盖原适配，卸载后后续展示使用记录降级，不保留失效插件闭包。

### 已有命令结果：不增加卡片记录

注册 `command/<name>` 可适配已有 settled command，例如 `command/model-context`。宿主传入：

```ts
{ commandId, name, args?, outcome: 'success' | 'error', text }
```

字段来自原始配对命令事实，args 保留原始空白；适配器自行决定该命令的语法。没有已注册适配时保留宿主通用命令卡；适配无法解释输入时保留原结果的可读降级。这里的降级可能包含生产者原有的私有文本协议，通用宿主不猜测如何剥离它。已有 `sourceEventSeq` 所指的专属呈现仍优先，不产生重复卡片。

本轮真实消费者是 `@z-traveler/dsh-context/tui`。在已安装该业务包和本下游 TUI 的开发 profile 中，可以用覆盖层加载：

```yaml
- insert:
    - id: dsh-context-tui
      name: '@z-traveler/dsh-context/tui'
```

该消费者复用 dsh-context 自己的结果解析，通用 TUI 不知道 `dsh-context/card@1`。卡片只展示当次报告，不查询最新观察。写稿与卡片渲染分离：支持输入写稿的业务入口可注册[命令结果到草稿映射](command-drafts.md)，只消费当前 TUI 发起的实时命令回执。`prompt copy` 卡片仅表示请求状态，不能凭它宣称草稿已写入；历史卡片不会再次写稿。

## 卡面与主题

共享宿主使用 `cardStyles.kinds.custom`，不由业务插件绘制卡面或硬编码颜色；`other` 继续属于通知、本地回显等，避免把它们一起染成自定义卡面。展示快照里的 `density: 'compact'`（见上文）只去掉这一张卡的卡面，既不改 `custom` 类型的配置，也不影响同屏其它卡片；需要整类自定义卡片都换卡面时才改 `cardStyles`。默认 `legacy` 保持原有外观；需要有底色的 Pi 风格卡面时，在 `~/.dsh-tui/settings.json` 的现有 `values` 中合入以下字段，保留其他设置：

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

用户文件优先于部署配置，重启是可靠的应用方式。通过官方 DSH CLI 挂载本包时，也可在插件行的 `config.cardStyles` 中声明同样对象；当前独立直达入口在 profile 组合前启动，不以行内卡面配置作为验收依据，应使用上述用户层。

`pi-like` 为通用卡片、技能及已适配命令提供独立紫色卡面、粗体标签、灰色正文、横纵各一格内边距；展开后标签、标题和正文分层，不再额外套 legacy 的两列缩进。技能的已存指令在该方案下按 Markdown 阅读，保留 literal XML；`legacy` 仍按原文字面显示。四个主题角色 `customMessageBackground`、`customMessageLabel`、`customMessageText`、`customMessageHint` 可随主题覆盖。

`custom` 不是每个业务类型独占的样式槽。选中高亮优先于普通底色，边框与内边距参与内容宽度。该配置改变阅读外观，不改变卡片语义或执行状态。不要再为启用此方案额外写入灰色 `toolCardBackgroundDim` 覆盖；那会把紫色自定义卡面改回工具卡外观。

## 验证与发布前检查

生产者与消费者应覆盖实际记录到卡片的入口、同身份更新、不同会话隔离、适配缺失/失败降级、卸载、长正文与完整 schema、正常恢复和分叉，以及模型输入不增加。终端可见行为还需在 inline/fullscreen 和窄终端实际演练；仅编译、配置有条目或启动成功不证明插件工作。

公开契约与 DSH 桥的聚焦验证：

```sh
node --import tsx/esm scripts/downstream/verify-custom-card-api.ts
node --import tsx/esm scripts/downstream/verify-custom-card-density.tsx
node --import tsx/esm scripts/downstream/verify-custom-card-flow.tsx
node --import tsx/esm scripts/downstream/verify-card-reading-rows.tsx
# 先编译，再验证实际 Session 与无可选 peer 的中立入口导入：
node --import tsx/esm scripts/downstream/verify-custom-card-carrier.ts
# 编译后的公开声明检查本页的生产者/消费者示例：
node node_modules/typescript/bin/tsc -p scripts/downstream/fixtures/custom-card-consumer/tsconfig.json
```

