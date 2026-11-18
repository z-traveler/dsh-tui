# 插件输入补全

`@deepseek-harness-tui/dsh-tui/input-completions` 是提供给普通 Cordis 插件使用的通用输入补全扩展接口。插件只需要声明触发规则、查询逻辑和有序的候选项列表；至于草稿分词、光标位置、菜单渲染、选择高亮和文本替换，则全部由 TUI 宿主统一管理。例如技能发现、排序、用户权限过滤以及 `#skill:name` 的插入文本格式，都属于技能插件自己的职责，不在 TUI 内实现。

## 注册

[`src/dsh-adapter/extensions.ts`](../../src/dsh-adapter/extensions.ts) 中的 `dsh-tui-extensions` 行会挂载 `ctx.tuiInputCompletions`。在插件的 `apply` 中按如下方式注册：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { TuiInputCompletionProvider } from '@deepseek-harness-tui/dsh-tui/input-completions'

const skills: TuiInputCompletionProvider = {
  id: 'skill-mention',
  label: '技能',
  priority: 10,
  trigger(token) {
    if (!token.text.startsWith('#')) return undefined
    return { query: token.text.slice(1, token.cursor) }
  },
  async query({ query, context }, signal) {
    // context = { backendId, sessionId, cwd }，只读。
    // signal 会在草稿、光标、会话、来源变化或插件卸载时触发 abort。
    const candidates = await searchSkills(query, context, signal)
    return candidates.map(skill => ({
      id: skill.name,
      name: skill.name,
      description: skill.description,
      replacement: `#skill:${skill.name}`,
    }))
  },
}

export const inject = ['tuiInputCompletions']

export function apply(ctx: Context) {
  ctx.tuiInputCompletions.register(skills)
}
```

注册与生命周期规则如下：

- `register()` 绑定调用方的 Cordis activation。插件被禁用或卸载时，补全来源会自动注销，菜单随即关闭，正在进行的查询会被宿主 abort，不会残留监听。
- 也可以配合 `ctx.effect(() => ctx.tuiInputCompletions.register(provider))` 使用，返回值就是对应的注销函数。
- 使用该接口不需要新增授权文件或 grant 配置。

## 契约

- **触发判断（`trigger`）**：`trigger(token)` 只会收到宿主切分出来的**当前空白分隔 token**以及光标在该 token 内的偏移（`{ text, cursor }`），拿不到整段输入草稿。任何覆盖 `[Image #N]` 格式文字的 token（包括用户手打的占位文本）都不会触发任何补全来源。provider 在 token 内部自行判断触发前缀，并返回 `{ query }`（从触发符到光标之间的片段）。
- **查询执行（`query`）**：`query({ query, context }, signal)` 可以同步或异步返回候选项。`context` 是只读冻结对象 `{ backendId, sessionId, cwd }`，`signal` 会在请求过期时触发 abort。provider 拿不到写草稿、提交、排队或其他 provider 的接口。
- **候选项结构**：每项包含 `{ id, name, description?, replacement }`。`id` 在同一个来源内必须稳定，`name` 用于菜单展示，`replacement` 是最终插入的**精确替换文本**，宿主不会再改写它。
- **并发与等待**：同一次查询会等待所有匹配的来源都返回后一起展示，因此较慢的来源会拖慢菜单出现，目前不设查询超时。如果发生取消、来源变更或插件卸载，宿主会立即停止等待并触发 `signal` 的 abort；但对于忽略 `signal` 的不配合代码，宿主无法强行终止它的执行。
- **排序与展示**：所有匹配来源的候选会合并呈现，按 `priority` 数值降序排列；同优先级按注册顺序，同一来源内部保持它自己的返回顺序。当多于一个来源返回了候选时，每一行都会显示对应来源的 `label`；不同来源之间即使文案同名也不会合并去重。
- **替换与优先级**：选中候选后，宿主只会替换从 token 起点到当前光标之间的查询片段，光标后面的剩余文字（即使还在同一个单词内）不会被删掉。接受候选项本身不会触发发送消息、排队或立即加载技能。此外，内建的 `/` 和 `@` 补全菜单优先级高于插件补全菜单。
- **防过期与选中保持**：只要草稿、光标位置、会话或绑定代次（generation）以及可用来源集合发生变化，即便 `query` 字符串碰巧相同，旧的异步查询结果也会被丢弃。新结果到达时，会按稳定的 `source + id` 保持用户当前选中的项目，避免迟到的高优先级来源把用户的 Enter 按键意外变成另一个选项。
- **键盘与鼠标交互**：菜单打开时，`Enter` 和 `Tab` 只用来确认选中候选项（即使在模型忙碌时也不会触发 steer 或排队发送）；`Esc` 只关闭菜单并保留当前草稿。点击、上下键、滚轮以及列表滚动交互均沿用内建补全菜单的规则。

## 验证

运行以下命令执行验证：

```sh
node --import tsx/esm scripts/verify-input-completions.tsx
```

该脚本使用真实的 Cordis activation 和挂载好的 `PromptInput`，覆盖注册与注销、多来源优先级与来源标签展示、query 上下文与 abort、单个来源报错隔离、草稿/光标/会话/来源变更导致的过期结果丢弃、后缀保留与 `@path#L12`/`[Image #1]` 保护、忙碌时 Enter/Tab 拦截、Esc 关闭、内建 `/`/`@` 优先级、鼠标点击以及插件卸载场景。另外，可运行 `scripts/verify-adapter-shadow.ts` 校验宿主能力矩阵。
