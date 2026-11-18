# 命令结果写稿（command draft）

`ctx.tuiInput.registerCommandDraft(name, mapper)` 是提供给业务插件的通用扩展接口，用来把**本机刚刚实时执行完的一条命令结果**填入用户的输入框草稿。业务插件只负责提供纯转换函数；实际的写入、防覆盖判断、输入历史与图片绑定，仍由输入框组件（`PromptInput`）统一管理。TUI 本身不会对任何业务命令名做特殊判断，也不解析业务私有协议。

## 注册

[`src/dsh-adapter/extensions.ts`](../../src/dsh-adapter/extensions.ts) 中的 `dsh-tui-extensions` 行会挂载 `ctx.tuiInput`。在插件的 `apply` 中这样注册：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { TuiCommandDraftPacket } from '@deepseek-harness-tui/dsh-tui/tui-input'

export const inject = ['tuiInput']

export function apply(ctx: Context) {
  ctx.tuiInput.registerCommandDraft('prompt', (packet: TuiCommandDraftPacket) => {
    if (packet.outcome !== 'success') return undefined
    // packet.args 是命令名之后的原始后缀，例如 `/prompt copy` 会得到 ' copy'，
    // 判断语义前需要先自行 trim()。
    if (packet.args?.trim() !== 'copy') return undefined
    return readPayload(packet.text) // 业务协议校验在插件内完成，返回草稿全文或 undefined
  })
}
```

注册与生命周期规则如下：

- `registerCommandDraft()` 绑定调用方的 Cordis activation。插件被禁用或卸载时，映射会自动注销，之后到达的命令结果不会再写入草稿。
- 对同一个命令名重复注册会直接抛出异常。
- 你也可以把它放进 `ctx.effect(() => ctx.tuiInput.registerCommandDraft(...))` 中，返回值就是对应的注销函数。
- 使用该接口不需要新增授权文件或 grant 配置。

## 契约

- **同步纯函数**：映射器必须是同步纯函数，入参为 `{ name, args?, outcome, text }`，分别对应本进程刚执行的命令名、命令名之后的原始参数后缀（无参数时该字段省略）、结果状态和结果正文。返回草稿字符串表示要写入，返回 `undefined` 表示不写入。映射器拿不到输入框实例、发送或排队能力，也拿不到会话对象。
- **仅限本地实时命令**：只在本地实时命令的执行完成链路（`createExternalCommandInvoker.invoke`）中触发。可重放的命令卡片、恢复出来的历史会话记录，以及其他客户端执行的同名命令，都不会触发写稿。
- **仅限成功结果**：只有 `outcome` 为 `success` 的结果才能生成草稿。映射器抛出异常或返回空字符串时，效果等同于不写稿，命令本身的执行结果、卡片展示和提示通知都不受影响。
- **写入前的同步校验**：草稿会在输入框异步完成校验块中的同一次同步步骤里写入。写入前会核对会话绑定（session binding）、图片租约（image lease）、草稿修订序号，以及原命令行文本和图片是否仍与提交命令时一致。确认无误后，用返回的新草稿全文整体替换原命令行；只要其中任何一项对不上（比如用户在等待期间又编辑了内容、切换了会话，或者插件已卸载），就会放弃写入，绝不覆盖用户的新输入。
- **无副作用**：写入草稿不会自动提交或排队发送消息，不会修改系统剪贴板，不会发起模型请求，也不会为填入的文本额外记一条输入历史（历史里记的仍然是刚刚执行的命令）。大段文本会自动复用输入框的 `isBigInput()` 折叠展示，提交时仍发送完整全文，光标停在正文末尾。
- **未注册命令保持不变**：没有注册写稿映射器的命令沿用原有行为——执行成功就清空命令行，失败时按既有的 `consumeDraft` 语义决定保留还是消费。

## 验证

运行以下命令执行测试：

```sh
node --import tsx/esm scripts/downstream/verify-command-drafts.tsx
```

该脚本基于真实的 Cordis activation、真实的 `createExternalCommandInvoker.invoke` 以及挂载好的 `PromptInput`，覆盖以下场景：扩展行挂载、拒绝 root 上下文调用、activation 注销、重复注册报错、映射器异常与未注册命令隔离、真实命令结果映射、普通命令不回归、整稿替换不自动提交、大文本折叠后仍提交全文、等待期间编辑或切换会话时不覆盖输入，以及源码级断言验证重放路径和可重放卡片不会触发写稿。
