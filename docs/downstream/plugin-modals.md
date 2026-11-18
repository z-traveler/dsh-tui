# 通用插件模态浮窗（下游）

这项能力通过已有的 `tuiScenes` 服务来承载插件的 React 浮窗内容，不会改动旧全屏场景 `register/open/close` 的语义，也不包含模型测速之类的具体业务。类型入口为 `@deepseek-harness-tui/dsh-tui/scenes`。写浮窗组件时，必须使用宿主注入的 `React` 和 `ui`（组件与 hooks），不能再创建第二个终端渲染器，也不能调用插件自己私有的 React hooks。

## 能力检测与接入

插件需要在自己的 live Cordis activation 中完成注册，并在 Chat 宿主已经就绪的交互命令里打开浮窗。遇到不支持模态浮窗的旧宿主时必须明确报错拒绝，不能偷偷调用 `open()` 降级成全屏场景：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { TuiModalProps } from '@deepseek-harness-tui/dsh-tui/scenes'

function Report({ React, ui, close, focused, contentSize, signal }: TuiModalProps) {
  const [refresh, setRefresh] = React.useState(0)
  ui.useInput((input) => {
    if (input === 'r') setRefresh(value => value + 1)
    if (input === 'q') close()
  })
  return React.createElement(ui.Text, null,
    `${focused ? 'Active' : 'Background'} ${contentSize.columns}x${contentSize.rows} refresh=${refresh} closed=${signal.aborted}`)
}

export const inject = ['tuiScenes']
export function apply(ctx: Context) {
  if (typeof ctx.tuiScenes?.registerModal !== 'function' || typeof ctx.tuiScenes?.openModal !== 'function') {
    throw new Error('This plugin requires a dsh-tui downstream with plugin modal support')
  }
  if (ctx.tuiScenes.modalOptionsVersion !== 1) {
    throw new Error('This plugin requires modal options v1; old hosts silently ignore openModal options')
  }
  ctx.tuiScenes.registerModal({ id: 'my-report', title: 'Report', component: Report,
    options: { width: '70%', height: '60%', anchor: 'center', margin: 1,
      style: { borderStyle: 'double', backgroundColor: '#172a3a', paddingX: 2 } },
  })
  // In the plugin's existing command handler, after the chat host is ready:
  // const result = await ctx.tuiScenes.openModal('my-report')
  // Report success only when result.status === 'opened'.
}
```

同一个已注册类型可以同时打开多个独立实例。如果业务只希望保留一个报告窗口，请由业务自己保存打开结果里的句柄并复用；宿主不会按注册 `id` 自动去重。完整示例代码见 `scripts/downstream/plugin-modal-example.ts`，运行方法见下文「隔离演示」。

## 打开结果与实例生命周期

`openModal(id, options?)` 返回一个按 `status` 区分的结果对象；不传 `options` 时沿用原有的居中卡片默认值：

| `status` | 含义 |
| --- | --- |
| `opened` | 宿主已确认实例挂载成功。可通过 `instance.close()` 单独关闭该实例，`instance.signal` 反映它的关闭生命周期。注意：这不保证终端硬件已经完成这一帧的绘制 |
| `rejected` | 未创建窗口。`code` 为 `not-registered`、`foreign-owner`、`host-unavailable` 或 `admission-denied`，`message` 说明原因 |
| `failed` | 已受理请求，但未成功确认挂载。`code` 为 `closed-before-ack` 或 `render-failed` |

核心边界与生命周期规则：

- **惰性加载与 Suspense**：当使用 Suspense 或惰性加载的内容尚未就绪时，宿主会先显示一个可用 `Esc`/`Ctrl+C` 关闭的加载窗口，此时 `openModal` 返回的 Promise 保持待定，不会把加载占位状态提前算作 `opened`。直到内容真正挂载后才返回 `opened`；如果加载失败或在加载中途关闭窗口，Promise 会以 `failed` 结束，迟到的加载结果不会让窗口复活。空间极小时优先显示紧凑的关闭提示，不保证同时显示加载文案。
- **同步错误与命名空间**：在已失效的 activation 或非法调用上下文中调用时，仍按既有服务规则同步抛出异常，而不是返回 `rejected`。重复注册同一个模态 `id` 会直接抛错；全屏场景和模态浮窗的 `id` 命名空间相互独立。服务尚未挂载或 Chat 宿主尚未就绪时，打开操作必须视为不可用，不能报告打开成功。
- **自动绑定生命周期**：注册会自动绑定调用方的激活作用域，保存返回的 disposer 可以提前撤销注册。一旦撤销注册、插件卸载/HMR 或所属作用域销毁，宿主会自动关闭该插件打开的全部实例，其他插件的窗口不受影响。
- **实例级信号与异常处理**：每次打开都会创建独立的 `AbortSignal`，调用 `close()`、发生渲染失败或切换会话时都会触发 abort。成功挂载之后再发生的错误，不会反过来改写已经返回 `opened` 的 Promise，而是通过实例 `signal` 和宿主错误通知体现。组件 render 或生命周期抛出的异常由宿主错误边界捕获、报错并关闭该实例；异步业务回调里的错误和取消仍由插件自己负责，请监听 `signal.aborted` 或把 `signal` 传给业务请求，避免窗口关闭后继续更新状态。迟到的宿主挂载回执不会重新打开已经关闭的实例。

## 堆栈、输入与优先级

- **后台保持运行**：开窗时，底层的聊天树仍在后台保持挂载并正常接收会话更新，打开浮窗不会暂停或取消正在进行的模型任务。
- **焦点获取与归还**：普通浮窗打开即接管键盘输入；配置了 `nonCapturing: true` 的被动浮窗默认不抢焦点，也不会触发组件内的 `autoFocus` 或 `Tab` 导航。通过 `focus()` 或在 fullscreen 模式下点击窗口，可以显式聚焦被动窗口；调用 `unfocus()` 则把焦点交还给其他仍可交互的窗口或聊天区。当前正在接收输入的窗口总是最后绘制，新打开的被动窗口不会遮住它。宿主会为每个实例隔离输入——处于隐藏或未聚焦状态的组件，即使无条件调用了注入的 `ui.useInput`，也不会收到任何按键。
- **关闭快捷键与输入隔离**：存在聚焦的浮窗时，`Esc` 和 `Ctrl+C` 由宿主优先拦截，用来只关闭当前聚焦的这个浮窗；如果场上只有被动且未聚焦的浮窗，这两个按键仍归聊天区处理。`q`、刷新、选择、文字编辑等操作都归插件处理。用于关闭浮窗的按键及同一批次里余下的输入，不会漏到底层变成聊天提交。
- **独立关闭**：窗口按实例独立关闭，关闭下层窗口不会连带关闭上层窗口。关闭后焦点回到栈顶仍有效的窗口，没有窗口时回到聊天区。
- **宿主交互层优先**：审批、问卷、托管对话框以及宿主原有的交互层拥有更高优先级。它们出现时，整个浮窗栈会暂时隐藏并保留组件状态，期间拒绝新开窗；交互结束后再恢复仍有效的实例。这些关键交互中按 `Esc`/`Ctrl+C` 不会误操作被隐藏的浮窗。
- **页面切换与会话切换**：临时切换到设置页或旧全屏页面时，同样会隐藏整个浮窗栈，回到原聊天页后再恢复；在非聊天页面期间拒绝新开窗。一旦切换了会话，则直接关闭整个浮窗栈，防止把旧会话的 channel 状态带到新会话。
- **鼠标行为差异**：在 fullscreen 模式下，只要存在接收输入的浮窗，点击或滚轮落在卡片外部会被吞掉，不会触发背景或下层窗口；如果只有被动浮窗，则不封锁背景鼠标操作。卡片内部的 `ScrollBox` 可正常滚动，暂不提供点击外部关闭。在 inline 模式下，不启用应用级鼠标路由，终端保留原生的滚动和文本选区功能，因此插件必须提供完整的键盘导航，也不能把终端自身的 scrollback 操作当成插件鼠标事件。

## 尺寸与内容

`descriptor.options` 作为该浮窗类型的默认值，`openModal(id, options)` 会在此基础上叠加单次实例的覆盖。之后可以通过 `instance.updateOptions(patch)` 原地调整位置、尺寸或样式，不会重新挂载组件，也不会更换 `signal`：

- 普通字段直接替换；`style` 对象按字段合并。
- 将某个补丁字段设为 `undefined`，会删除对应的实例覆盖，使之回落到 descriptor 的默认值；传入 `style: undefined` 会删除整个实例级样式覆盖。
- 传入未知字段、非法值或带有 Alpha 通道的颜色时，会同步抛出 `TypeError`，且整次无效更新不会部分生效。

支持的 `options` 参数如下：

| 参数 | 含义 |
| --- | --- |
| `width`、`height`、`maxHeight` | 正整数格数或 `(0,100]%`（支持小数百分比）；均指包含边框、标题和页脚在内的外框尺寸 |
| `minWidth` | 正整数最小宽度；实际可用屏幕宽度与 `margin` 边界优先 |
| `anchor` | 对齐基准点：`top-left` / `top-center` / `top-right` / `left-center` / `center` / `right-center` / `bottom-left` / `bottom-center` / `bottom-right` |
| `row`、`col` | 非负整数起始坐标或 `[0,100]%`；百分比按扣除 `margin` 和窗口大小后的可移动范围定位，与 Pi 一致 |
| `offsetX`、`offsetY` | 可正可负的整数偏移量，最终会限制在可见帧范围内 |
| `margin` | 非负整数，或 `{top,right,bottom,left}` 各边非负整数（未声明的边为 `0`） |
| `visible(columns, rows)` | 同步返回 boolean 的纯函数，依据当前可见聊天帧大小求值。新开窗时返回 `false` 会被明确拒绝；已有窗口变为 `false` 时会保留挂载但释放键盘输入和鼠标拦截，终端 resize 后会重新计算 |
| `nonCapturing` | 默认 `false`；设为 `true` 表示仅展示，不自动接管键盘 |
| `style.backgroundColor` | 主题颜色 token 或现有渲染器支持的具体颜色；`null` 表示使用终端默认背景（但仍会覆盖底层文字） |
| `style.borderStyle` | 现有边框样式（如 `round`/`single`/`double`/`bold`）或 `none` |
| `style.borderColor` / `titleColor` | 主题 token、具体颜色或 `null`（终端默认前景色） |
| `style.paddingX` / `paddingY` | 非负整数内边距，空间不足时会自动缩减 |
| `style.backdrop` | `'dim'`（默认）或 `false`；只由当前接收输入的窗口决定是否遮暗背景 |
| `style.chrome` | 默认 `true`；设为 `false` 会去掉宿主标题和关闭提示，把全部内容行交给插件 |

实例控制方法与尺寸约束：

- **状态读写与手动控制**：
  - `instance.options()` 返回当前生效配置的冻结快照。
  - `setHidden(boolean)` / `isHidden()` 用于手动隐藏或恢复显示，与 `visible` 回调相互独立。
  - `focus()` / `unfocus()` / `isFocused()` 用于控制键盘输入归属。
  - `getBounds()` 返回只读的 `{left,top,columns,rows}`，坐标相对于当前可见聊天帧（不是 inline 终端的绝对坐标）；窗口尚未渲染、处于隐藏状态或已关闭时返回 `undefined`。
  - 实例关闭后，迟到的更新、聚焦或隐藏调用一概无效，不会让实例复活。
- **实际内容区尺寸**：宿主会把扣除边框、内边距以及已启用的标题/页脚后的实际内容区大小，同时通过 `contentSize` 和 `ui.useTerminalSize()` 传给组件。窗口大小变化时尺寸会自动更新，请不要自己去读取 `stdout.columns/rows`。内容超出时请使用注入的 `ui.ScrollBox` 并提供键盘滚动。在 inline 模式下，浮窗只使用真实聊天帧的可见部分，不会为了撑开浮窗而强行把屏幕扩成整屏。
- **极小空间与单行提示**：空间不足时，宿主会自动退化显示紧凑的关闭提示（哪怕显式关掉了 `chrome`），等终端变大后自动恢复原有内容和状态。如果需要精简的单行提示条，可使用 `{height:1, style:{chrome:false,borderStyle:'none',paddingX:0,paddingY:0}}`，插件内容需确保能在单行内放得下。
- **其他边界**：如果 `visible` 回调抛出异常，新开窗时会被明确拒绝，已有窗口则会关闭该出错实例并给出通知（不波及其他窗口）。本接口不支持 opacity/alpha 透明度、鼠标拖拽调大小或布局持久化；设置终端默认背景色并不代表能透出底层 TUI 文字，Pi 的 `OverlayOptions` 同样没有透明度参数。

## 验证

运行以下命令执行回归验证：

```sh
node --import tsx/esm scripts/verify-plugin-modal-runtime.ts
node --import tsx/esm scripts/downstream/verify-plugin-modals.tsx
node --import tsx/esm scripts/downstream/verify-plugin-modal-options.tsx
node --import tsx/esm scripts/downstream/verify-modal-layout.ts
node scripts/downstream/verify-plugin-modal-package.mjs <npm 包的绝对路径>
```

最后一项测试直接消费打包后的真实 npm 包而不是源码别名。打验证包时必须通过 `node scripts/with-publish-manifest.mjs npm pack` 生成，直接运行 `npm pack` 会残留 workspace 依赖而被测试拒绝。

## 隔离演示

在仓库根目录运行以下命令启动交互演示：

```sh
node --import tsx/esm scripts/downstream/plugin-modal-demo.tsx
node --import tsx/esm scripts/downstream/plugin-modal-demo.tsx --inline
node --import tsx/esm scripts/downstream/plugin-modal-demo.tsx --custom # 可加 --inline
```

演示脚本只创建临时的 `HOME`/`DSH_HOME`、内存后端和通用示例报告，不读取真实凭据，也不会发起模型请求。

- **浮窗操作**：`Alt+O` 打开多个报告浮窗；浮窗内按 `↑`/`↓`/`PgUp`/`PgDn` 滚动，`r` 刷新，`q`/`Esc`/`Ctrl+C` 关闭。
- **场景模拟**：`Alt+A` 触发审批框，`Alt+Q` 触发问卷，`Alt+G` 切到临时全屏页面，`Alt+N` 切换会话，`Alt+U` 卸载或重新注册示例插件，`Alt+X` 打开一个故意抛错的组件。
- **定制外观模式（`--custom`）**：使用已验收的同底色单线外观并关闭背景遮暗；连按 `Alt+O` 会按右侧抽屉式逐层收窄叠放，露出下层边缘，`Esc` 逐层关闭（无滑入动画）。`Alt+C` 原地切换尺寸、对齐位置及标题/边框色，`Alt+P` 新开被动报告，`Alt+H` 隐藏或恢复最后一个报告，`Alt+J` 聚焦或释放它。该模式下的示例预设会在终端宽度低于 45 列时自动隐藏。
- **退出与后台消息**：示例每隔一段时间会自动追加一条后台消息。退出前请先关闭浮窗；在浮窗外按 `Ctrl+C`，回合进行中会先中断当前回合，空闲且草稿为空时在 3 秒内连按两次退出（有文本选区时 `Ctrl+C` 只复制并保留选区，需先按 `Esc` 清除选区；无选区但草稿非空时先清空草稿）。也可以直接发送 `SIGTERM`，临时目录会由脚本自动清理。

请注意：这只是源码级隔离演示，不代表稳定安装版或上游公开版本已经支持该接口。
