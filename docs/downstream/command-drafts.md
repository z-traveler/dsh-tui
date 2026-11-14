# 命令结果写稿（command draft）

`ctx.tuiInput.registerCommandDraft(name, mapper)` 是业务插件把**本机实时执行的
一条命令结果**映射成用户输入框草稿的通用接缝。业务插件只提供纯映射；写稿、
覆盖判定、历史与图片绑定仍由输入框所有者（`PromptInput`）负责。TUI 不特判任何
业务命令名，也不解析业务协议。

## 注册

[`src/dsh-adapter/extensions.ts`](../../src/dsh-adapter/extensions.ts) 的
`dsh-tui-extensions` 行挂载 `ctx.tuiInput`。在插件的 `apply` 中注册：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { TuiCommandDraftPacket } from '@deepseek-harness-tui/dsh-tui/tui-input'

export const inject = ['tuiInput']

export function apply(ctx: Context) {
  ctx.tuiInput.registerCommandDraft('prompt', (packet: TuiCommandDraftPacket) => {
    if (packet.outcome !== 'success') return undefined
    // packet.args 是命令名之后的原始后缀：`/prompt copy` → ' copy'，
    // 需要自行 trim() 后再比较语义。
    if (packet.args?.trim() !== 'copy') return undefined
    return readPayload(packet.text)   // 业务协议校验在插件内，返回草稿全文或 undefined
  })
}
```

`registerCommandDraft()` 绑定调用方的 Cordis activation：插件禁用/卸载时映射
自动注销，之后到达的命令回执不再写稿。同一命令名重复注册会抛错。
也接受 `ctx.effect(() => ctx.tuiInput.registerCommandDraft(...))`；返回值是同一注销
函数。不需要新增授权文件或 grant 配置。

## 契约

- 映射器是**同步纯函数**，只收到 `{ name, args?, outcome, text }`：本进程刚执行
  的那条命令的名称、命令名之后的原始参数后缀（无参数时字段缺省）、结果种类和
  结果正文。返回草稿字符串，或 `undefined` 表示不写稿。它拿不到输入框句柄、
  提交/排队能力或会话对象。
- 只在本地实时命令完成链（`createExternalCommandInvoker.invoke`）调用：可重放的
  命令卡片、恢复的会话记录、其他客户端执行的同名命令都不会触发映射。
- 只有 success 结果能带草稿。映射器抛异常或返回空串等同于不写稿，命令自身的
  结果、卡片与通知都不受影响。
- 草稿在输入框既有的异步完成校验块里**同一次同步步骤**内写入：先判定会话
  binding／图片 lease／草稿修订序号／原命令文本与图片仍与提交时一致，再用返回
  全文整体替换原命令行。任何一项不成立（用户已编辑、已切换会话、插件已卸载）
  都不写稿，也不覆盖用户新输入。
- 写稿本身不提交、不排队、不改系统剪贴板、不发起模型请求，也不为填入的文本
  追加历史（历史记的仍是那条命令）。大文本复用输入框的 `isBigInput()` 折叠块，
  全文保留，光标落在正文末尾。
- 未注册映射器的命令行为完全不变：成功即清空命令行，失败按既有 consumeDraft
  语义保留或消费。

## 验证

`node --import tsx/esm scripts/downstream/verify-command-drafts.tsx` 使用真实
Cordis activation、真实 `createExternalCommandInvoker.invoke` 与挂载的
`PromptInput`，覆盖：扩展行挂载、root 上下文拒绝、activation 注销、重复注册、
映射器异常与未注册命令隔离、真实命令结果映射、普通命令不回归、整稿替换不提交、
大文本折叠后仍提交全文、等待期间编辑与切换会话不覆盖，以及可重放卡片/重放路径
不写稿（源码级断言）。
