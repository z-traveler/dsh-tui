# 通用插件模态浮窗（下游）

本能力通过已有 `tuiScenes` 服务承载插件 React 内容，不修改旧全屏场景的 `register/open/close` 语义，不包含模型测速等业务。类型入口为 `@deepseek-harness-tui/dsh-tui/scenes`；宿主组件与 hooks 必须使用注入的 `React` 和 `ui`，不能创建第二个终端渲染器或调用插件私有 React 的 hooks。

## 能力检测与接入

在插件的 live Cordis activation 中注册，在已经就绪的交互命令中打开。旧宿主必须明确拒绝，不调用 `open()` 全屏降级：

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

已注册的同一个类型可打开多个独立实例。若业务只想要一个报告窗口，由业务保存打开结果中的句柄自行复用；宿主不按注册 id 去重。真实示例见 `scripts/downstream/plugin-modal-example.ts`，运行入口见下文。

## 打开结果与实例

`openModal(id, options?)` 返回判别联合；不传 options 保留原有居中卡片默认值：

| status | 含义 |
| --- | --- |
| `opened` | 宿主已确认实例挂载；`instance.close()` 仅关闭这个实例，`instance.signal` 表示它的关闭生命周期。不承诺终端硬件已完成绘制 |
| `rejected` | 未创建窗口。`code` 为 `not-registered`、`foreign-owner`、`host-unavailable` 或 `admission-denied`，`message` 给出原因 |
| `failed` | 已受理但未成功确认挂载。`code` 为 `closed-before-ack` 或 `render-failed` |

使用 Suspense 或惰性加载的内容尚未就绪时，宿主显示可用 Esc/Ctrl+C 关闭的加载窗口，打开 Promise 保持待定，不将加载占位视为 `opened`。内容成功挂载后才确认成功；加载失败或加载中关闭会结算失败，迟到结果不会复活窗口。极小空间优先显示紧凑关闭提示，不承诺同时显示加载文案。

失效的 activation 或非法调用上下文仍按既有服务规则同步抛错，不是 `rejected`。重复注册同一个模态 id 抛错；全屏场景与模态 id 空间独立。打开前未挂载服务或尚无 Chat 宿主时必须当作不支持/不可用，不能报告打开成功。

注册自动绑定 caller 生命周期，返回的 disposer 可提前撤销注册。撤销注册、插件卸载/HMR 或所属作用域销毁会关闭它的全部实例；其他插件窗口不受影响。每次打开都创建独立 AbortSignal；close、渲染失败、切换会话都会 abort。成功挂载后的失败不改写已经结算的 open Promise，通过实例 signal 及宿主错误通知体现。

组件 render/lifecycle 抛错由宿主边界报告并关闭失败实例。异步业务回调的错误与取消仍由插件负责；读取 `signal.aborted` 或向业务请求传递 signal，避免关闭后继续写入状态。迟到的宿主挂载回执不会重新打开已关闭实例。

## 堆栈、输入与优先级

- 聊天树在后台持续挂载、接收会话更新；开窗不暂停或取消模型任务。
- 普通窗口打开即接管键盘；`nonCapturing: true` 的被动窗口默认不抢焦点，也不触发组件 `autoFocus` 或 Tab 导航。`focus()` 或 fullscreen 下点击窗口可显式聚焦；`unfocus()` 交还给其他仍可交互的窗口或聊天。当前输入窗口总在最后绘制，新开被动窗口不会盖住它。宿主为每个实例隔离输入，隐藏或未聚焦的组件即便无条件使用注入的 `ui.useInput` 也不会收到按键。
- 存在聚焦浮窗时，Esc/Ctrl+C 由宿主先处理，只关闭它；只有被动、未聚焦窗口时，这些键仍归聊天。`q`、刷新、选择、文字编辑等归插件；关闭键及同批次余下输入不会重新成为聊天提交。
- 窗口按实例独立关闭；删除底层不会连带关闭上层。恢复到仍有效的栈顶，没有窗口时恢复聊天。
- 审批、问卷、托管对话框及既有宿主交互层优先，整栈隐藏且保留组件状态，期间拒绝新开窗；交互结束后恢复仍有效的实例。关键交互的 Esc/Ctrl+C 不操作隐藏窗口。
- 暂时切换设置、旧全屏场景等宿主页面时同样隐藏整栈，返回原聊天后恢复；非聊天页面拒绝新开窗。切换会话则关闭整栈，避免携带旧会话 channel。
- fullscreen 模式存在输入窗口时，卡片外点击/滚轮被吞掉，不触发背景或下层窗口；只有被动窗口时不封锁背景鼠标。卡片内的 ScrollBox 正常滚动。不提供点击外部关闭。
- inline 不启用应用级鼠标路由，终端保留原生滚动/选区；插件必须提供键盘导航。不能把 inline 下终端自身的 scrollback 操作当成插件鼠标事件。

## 尺寸与内容

`descriptor.options` 是类型默认值，`openModal(id, options)` 叠加实例覆盖。`instance.updateOptions(patch)` 原地调整，不重挂载组件、不更换 signal；普通字段替换，`style` 按字段合并。补丁字段设为 `undefined` 删除该实例覆盖，回落到 descriptor 默认值；`style: undefined` 删除整个实例样式覆盖。未知字段、非法值、alpha 颜色同步抛 `TypeError`，一次无效更新不会部分生效。

| 参数 | 含义 |
| --- | --- |
| `width`、`height`、`maxHeight` | 正整数格数或 `(0,100]%`，支持小数百分比；均指包含边框、标题与页脚的外框尺寸 |
| `minWidth` | 正整数最小宽度；实际屏幕与 margin 边界优先 |
| `anchor` | `top-left/top-center/top-right/left-center/center/right-center/bottom-left/bottom-center/bottom-right` |
| `row`、`col` | 非负整数起始坐标或 `[0,100]%`；百分比沿扣除 margin 和窗口大小后的可移动范围定位，与 Pi 一致 |
| `offsetX`、`offsetY` | 有正负的整数偏移，最后钳制到可见帧内 |
| `margin` | 非负整数，或 `{top,right,bottom,left}` 各边非负整数；未声明的边为 0 |
| `visible(columns, rows)` | 纯同步 boolean 谓词；依据当前可见聊天帧大小求值。新开时为 false 明确拒绝，已有窗口为 false 保留挂载但释放输入和鼠标；resize 后重算 |
| `nonCapturing` | 默认 false；true 仅展示、不自动接管键盘 |
| `style.backgroundColor` | 主题颜色 token 或现有渲染器支持的具体颜色；`null` 使用终端默认背景，但仍覆盖底层文字 |
| `style.borderStyle` | 现有边框样式（如 `round/single/double/bold`）或 `none` |
| `style.borderColor/titleColor` | 主题 token、具体颜色或 null（终端默认前景） |
| `style.paddingX/paddingY` | 非负整数内边距，空间不足时缩减 |
| `style.backdrop` | `dim`（默认）或 false；仅当前输入窗口决定是否遮暗背景 |
| `style.chrome` | 默认 true；false 去掉宿主标题和关闭提示，全部内容行交给插件 |

`instance.options()` 返回冻结快照。`setHidden(boolean)/isHidden()` 控制手动隐藏，独立于响应式谓词；`focus()/unfocus()/isFocused()` 控制输入所有权。`getBounds()` 返回只读 `{left,top,columns,rows}`，坐标相对当前可见聊天帧，不是 inline 终端的绝对坐标；尚未投影、隐藏或关闭时为 undefined。关闭后更新、聚焦、隐藏等迟到调用均无效，不会复活实例。

宿主将实际内容区尺寸同时放入 `contentSize` 和 `ui.useTerminalSize()`，扣除边框、内边距和启用的标题/页脚。resize 更新尺寸，不能自行读取 `stdout.columns/rows`。内容超长时使用注入的 `ui.ScrollBox` 和键盘导航。inline 只使用真实聊天帧的可见部分，不为窗口强制扩成整屏。空间不足时显示紧凑关闭提示（即使显式关闭 chrome），恢复尺寸后保留状态。单行提示可用 `{height:1, style:{chrome:false,borderStyle:'none',paddingX:0,paddingY:0}}`，内容必须适配一行。

可见性回调抛错会明确拒绝新开，或关闭出错的已有实例并通知；不连带关闭其他窗口。没有 opacity/alpha、拖拽调尺寸或布局持久化；终端默认背景不等于透出底层 TUI 文字，Pi 的 OverlayOptions 也没有透明度参数。

## 隔离演示

在仓库根目录执行：

```sh
node --import tsx/esm scripts/downstream/plugin-modal-demo.tsx
node --import tsx/esm scripts/downstream/plugin-modal-demo.tsx --inline
node --import tsx/esm scripts/downstream/plugin-modal-demo.tsx --custom # 可加 --inline
```

示例只创建临时 HOME/DSH_HOME、内存后端与通用报告，不读取真实凭据、不产生模型请求。Alt+O 多开报告；报告内 ↑↓/PgUp/PgDn 滚动、r 刷新、q/Esc/Ctrl+C 关闭。Alt+A 触发审批，Alt+Q 触发问卷，Alt+G 临时全屏页面，Alt+N 换会话，Alt+U 卸载/重新注册示例插件，Alt+X 打开故意抛错的组件。`--custom` 使用已验收的同底色、单线外观，关闭背景遮暗；Alt+O 按右侧抽屉式逐层收窄叠放，露出下层边缘，Esc 逐层关闭，不包含滑入动画。Alt+C 原地切换尺寸、锚点及标题/边框色，Alt+P 新开被动报告，Alt+H 隐藏/恢复最后打开的报告，Alt+J 聚焦/释放它。可定制预设在宽度低于 45 时响应式隐藏。示例每隔一段时间追加后台消息。退出前先关闭浮窗；模态外 Ctrl+C 在回合进行中先中断，空闲且草稿为空时在 3 秒内连按两次退出。有选区时 Ctrl+C 只复制并保留选区，需先按 Esc 清除；无选区时非空草稿先被清空。也可发送 SIGTERM，临时目录由示例清理。

这是源码隔离演示，不是稳定安装或公开版本已经支持该接口的承诺。
