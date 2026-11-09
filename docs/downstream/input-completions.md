# 插件输入补全 / Plugin input completions

## 中文

`@deepseek-harness-tui/dsh-tui/input-completions` 是正常可安装 Cordis 插件使用的
通用输入补全接缝。插件只声明触发规则、查询和有序候选；草稿 token、光标、菜单、
选择与替换仍由 TUI 宿主拥有。技能发现、排序、用户权限过滤和 `#skill:name` 的
插入值属于技能插件，不在 TUI 内实现。

### 注册

[`src/dsh-adapter/extensions.ts`](../../src/dsh-adapter/extensions.ts) 的
`dsh-tui-extensions` 行挂载 `ctx.tuiInputCompletions`。在插件的 `apply` 中注册：

```ts
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
    // signal 在草稿/光标/会话/来源变化或卸载时 abort。
    const candidates = await searchSkills(query, context, signal)
    return candidates.map(skill => ({
      id: skill.name,
      name: skill.name,
      description: skill.description,
      replacement: `#skill:${skill.name}`,
    }))
  },
}

export function apply(ctx) {
  ctx.tuiInputCompletions.register(skills)
}
```

`register()` 绑定调用方的 Cordis activation：插件禁用/卸载时来源自动注销，菜单
关闭，宿主侧查询被 abort，不残留监听。也接受
`ctx.effect(() => ctx.tuiInputCompletions.register(provider))`；返回值是同一注销函数。
不需要新增授权文件或 grant 配置。

### 契约

- `trigger(token)` 只收到宿主算出的**当前空白分隔 token**和其内的光标
  (`{ text, cursor }`)，拿不到完整草稿；`[Image #N]` 原子占位覆盖的 token 不会
  触发任何来源。provider 在 token 内决定自己的触发前缀并返回
  `{ query }`（触发符到光标之间的片段）。
- `query({ query, context }, signal)` 可同步或异步返回候选。`context` 是冻结的
  `{ backendId, sessionId, cwd }`；`signal` 在请求失效时 abort。provider 不获得
  写草稿、提交、排队或其他 provider 的接口。
- 候选：`{ id, name, description?, replacement }`。`id` 在同一来源内稳定；`name`
  是显示名；`replacement` 是**精确替换文本**，宿主不会改写。
- 同一次查询等待所有匹配来源返回后共同呈现，因此慢来源会延迟菜单；目前不设查询超时。取消、来源变化或卸载会立即结束宿主等待并发出 abort，即使某来源忽略 signal；宿主不能强制停止不配合的插件代码。
- 所有匹配来源共同呈现：优先级数值降序，同级按注册顺序，同一来源保持返回顺序。
  多于一个来源有候选时，每一行显示来源 `label`；不同来源的同名文案不合并。
- 宿主只替换 `start`/`end` 覆盖的 token。接受候选不会发送、排队或加载技能；
  `/`、`@` 内建菜单优先于插件菜单。
- 草稿、光标、会话/绑定 generation 或来源集合变化时，即使 query 字符串相同，
  旧异步结果也被拒绝；新结果按稳定 `source + id` 保持选中项身份，迟到的更高优先级
  来源不会把 Enter 变成另一个候选。
- Enter/Tab 在菜单打开时只接受候选（忙碌时也不会进入 steer/queue）；Esc 只关闭
  菜单并保留草稿。点击、上下键、滚轮和窗口滚动沿用内建补全菜单。

### 验证

`node --import tsx/esm scripts/verify-input-completions.tsx` 使用真实 Cordis
activation 和挂载的 `PromptInput`，覆盖注册/注销、多来源优先级与来源标签、query
上下文与 abort、来源报错隔离、陈旧草稿/光标/会话/来源结果、后缀与
`@path#L12`/`[Image #1]` 保护、忙碌时 Enter/Tab、Esc、内建 `/`/`@` 优先级、
点击以及卸载。`scripts/verify-adapter-shadow.ts` 校验宿主能力矩阵。

## English

`@deepseek-harness-tui/dsh-tui/input-completions` is the normal-install plugin seam
for generic composer completions. A plugin declares a trigger, an async query and
ordered candidates; the TUI host keeps the draft token, caret, menu, selection and
replacement. Skill discovery, ranking, user-permission filtering and the actual
`#skill:name` insertion belong to the skill plugin.

The `dsh-tui-extensions` row mounts `ctx.tuiInputCompletions`. Register from
`apply()` exactly as in the TypeScript example above; the registration is bound to
the calling Cordis activation, so disabling/unloading the plugin unregisters the
source, closes its menu and aborts host-side queries. No grant file is involved.

`trigger(token)` sees only the host-computed whitespace token and token-local caret
(`{ text, cursor }`); a token intersecting an atomic `[Image #N]` span never
triggers. It returns `{ query }`, the fragment between its trigger and the caret.
`query({ query, context }, signal)` receives a frozen `{ backendId, sessionId, cwd }`
and an abort signal, and returns `{ id, name, description?, replacement }[]` or a
promise of it. The provider gets no draft writer, submit/queue API or other source's
surface.

Each query waits for all matching sources before displaying its menu, so a slow
source delays it; there is no query timeout. Cancellation, source changes and
unloading immediately release the host wait and abort the signal, even if a
provider ignores it. The host cannot forcibly stop non-cooperative plugin code.

All matching sources contribute, ordered by numeric priority descending (default 0),
ties in registration order, candidate order preserved per source. Every row carries
its source `label` once more than one source contributes; equal text from different
sources is never merged. Only the token bounds are replaced — surrounding text,
`@path#L12` and `[Image #1]` survive. `/` and `@` menus keep priority. Enter/Tab
accept without submit/steer/queue (even while busy); Escape only closes the menu;
click, arrow keys, wheel and the window follow the built-in menus. Draft, caret,
session/binding generation and source-generation changes reject stale results even
for an identical query, and selection survives by the stable source-qualified item
key.

Verification: `node --import tsx/esm scripts/verify-input-completions.tsx` (real
Cordis activation + mounted `PromptInput`); `scripts/verify-adapter-shadow.ts`
checks the host capability matrix.
