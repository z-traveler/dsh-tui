/**
 * 取证 harness 的「现代终端」宽度 provider（issue #574 取证沉淀）。
 *
 * xterm-headless 默认 Unicode provider 是旧表：Emoji_Presentation 字符
 * （⚓ U+2693 等）量 1 格；现代真实终端（Windows Terminal / kitty /
 * ghostty / iTerm2 按 EastAsianWidth W）画 2 格，src/ink/stringWidth.ts
 * 也量 2（#101 的 Doctrine：量宽跟随真实终端）。两侧不一致时，就地重绘
 * 含这类字符的行必然错位——app 以为是宽字符第二格而不重写的格子，在
 * 终端里是独立一格：旧帧残影滞留、后续宽字被半个覆盖丢弃（#574 现场
 * 思考行的「⚓⠧ 思  ·」残状）。断言这类行的回归脚本必须先让 harness
 * 与真实终端同宽，否则红的是 xterm.js 旧表，不是产品代码。
 *
 * 宽度口径直接委托 app 的 stringWidth：provider 逐码点查表（与 wcwidth 语义
 * 一致），唯一例外是「文本默认 emoji 基字符 + VS16」——单个码点看不出这个
 * 组合的宽度，必须按序列加宽，见 charProperties。
 *
 * provider 按终端创建：VS16 判定要记住前一个码点本身，两个终端共用一个实例
 * 会在交替写入时互相污染。
 *
 * 本模块顶层 import TypeScript 源——只可被 `node --import tsx/esm`
 * 运行的脚本引入；纯 node 脚本请勿引入（它们也不需要：
 * 断言不含 Emoji_Presentation 字符的行）。
 */
const { stringWidth } = await import('../../src/ink/stringWidth.js')

/** 单码点宽度（wcwidth 语义：0/1/2），带缓存——xterm 逐码点查询。 */
const table = new Map()
const wcwidth = cp => {
  let w = table.get(cp)
  if (w === undefined) {
    w = stringWidth(String.fromCodePoint(cp))
    if (w !== 0 && w !== 1 && w !== 2) w = 1
    table.set(cp, w)
  }
  return w
}

const VERSION = 'dsh-modern-eaw'
const VS16 = 0xfe0f
const EMOJI_CAPABLE = /\p{Emoji}/u
const DEFAULT_EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u

/** keycap ASCII [0-9#*] 不是 emoji 基字符：`1` + VS16（无 U+20E3）量 1 格。 */
const isKeycapBase = cp => (cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a

/** 文本默认的 emoji 基字符才需要 VS16 加宽；keycap ASCII 与默认 emoji 排除。 */
const requestsEmojiPresentation = cp => !isKeycapBase(cp)
  && EMOJI_CAPABLE.test(String.fromCodePoint(cp))
  && !DEFAULT_EMOJI_PRESENTATION.test(String.fromCodePoint(cp))

/** 建一个绑定该终端写入流的 provider（保留 charProperties 的逐码点契约）。 */
function createModernWidthsProvider() {
  // charProperties 只拿到前一个码点的属性位（宽度/charKind），还原不出码点，
  // 所以这里记住上一次查询的码点。它与 parser 的 precedingJoinState 同步推进，
  // 因为 xterm 逐码点按写入顺序查询。
  let lastCodepoint = 0
  // charProperties 位布局照抄 @xterm/headless 6.0.0 内建 provider：
  //   property = (charKind << 3) | (width << 1) | (shouldJoin ? 1 : 0)
  // 组合符（width 0）并入前格宽度（shouldJoin），与内建语义一致。
  // 若升级 xterm 后布局变化，这里要与内建实现同步（typings 不导出这些
  // 静态方法，只能对照打包源码核对）。
  const charProperties = (cp, preceding) => {
    const base = lastCodepoint
    lastCodepoint = cp
    let w = wcwidth(cp)
    let join = w === 0 && preceding !== 0
    if (join) {
      const precedingWidth = (preceding >> 1) & 3
      if (precedingWidth === 0) join = false
      else if (precedingWidth > w) w = precedingWidth
    }
    // VS16（U+FE0F）跟在文本默认 emoji 基字符后时强制 emoji 表现：真实终端和
    // src/ink/stringWidth.ts 都把「基字符 + VS16」量 2 格，而逐码点表只按基字符
    // 本身量 1 格。缺这段时含 ✳️ 的行在 harness 里比 app 的布局少一格，"重绘
    // 错位"是模拟器旧表造成的，不是产品代码。
    if (cp === VS16 && join && requestsEmojiPresentation(base)) w = 2
    return (0 << 3) | ((w & 3) << 1) | (join ? 1 : 0)
  }
  return { version: VERSION, wcwidth, charProperties }
}

/**
 * 注册并启用现代宽度 provider（幂等：重复注册同名版本会抛错，故先查）。
 * @param {import('@xterm/headless').Terminal} term
 */
export function activateModernEmojiWidths(term) {
  if (!term.unicode.versions.includes(VERSION)) {
    term.unicode.register(createModernWidthsProvider())
  }
  term.unicode.activeVersion = VERSION
}
