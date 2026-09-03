/**
 * 外站链接提取工具
 *
 * 用途：扫描帖子详情页（viewthread）正文里的 a[href]，过滤掉论坛内部跳转，
 *      把外站链接收集起来供 content script 拼接到帖子底部面板。
 *
 * 设计：
 * - 纯函数，不碰 DOM 副作用（除了读取参数 doc）
 * - 跨同源 iframe 递归扫描（Discuz 楼中楼常放在 iframe 里）
 * - 返回带稳定 key 的 ExternalLink[]，方便 Vue 渲染 :key
 */

export interface ExternalLink {
  /** 归一化后的 href（用于 :key 与复制） */
  url: string
  /** 链接的可视文本（trim 后），可能为空（图片代替文字的情况） */
  text: string
  /** 链接主机的字符串表示，方便 UI 展示 */
  host: string
}

const EMPTY_HREF_PREFIXES = ['javascript:', 'mailto:', 'tel:']

const FORUM_INTERNAL_PATH_FRAGMENTS = [
  'forum.php?mod=viewthread',
  'home.php?mod=space',
]

/** 把 href 归一为可解析的绝对 URL（处理 //host、/path、空格等） */
function normalizeHref(href: string): string {
  const trimmed = href.trim()
  if (!trimmed) return ''
  try {
    return new URL(trimmed, location.href).href
  }
  catch {
    return ''
  }
}

/** 从 URL 字符串里提取主机名；非法 URL 返回空字符串 */
function safeHostname(href: string): string {
  try {
    return new URL(href, location.href).hostname
  }
  catch {
    return ''
  }
}

/** 当前论坛主机名（用于过滤论坛内部跳转） */
function currentHost(): string {
  return location.hostname
}

/** href 是否属于论坛内部跳转 / 无意义 */
function shouldSkip(href: string): boolean {
  const trimmed = href.trim()
  if (!trimmed) return true
  const lower = trimmed.toLowerCase()
  if (EMPTY_HREF_PREFIXES.some(p => lower.startsWith(p))) return true
  if (trimmed.startsWith('#')) return true

  const host = safeHostname(trimmed)
  if (!host) return true
  if (host === currentHost()) return true

  // 内部跳转即便跨子域也要拦（部分 Discuz 把多个域都视为内部）
  if (FORUM_INTERNAL_PATH_FRAGMENTS.some(frag => trimmed.includes(frag))) return true

  return false
}

/** 从 anchor 元素读取可视文本（trim 后）；图片代替文字返回空字符串 */
function readAnchorText(a: HTMLAnchorElement): string {
  // 如果包含 <img>，认为图片代替文字，文本留空（避免误把 alt 当成"隐藏"判据）
  if (a.querySelector('img')) return ''
  return (a.textContent ?? '').trim()
}

/** 跨主文档 + 同源 iframe 递归收集所有 a[href] */
function* iterateAnchors(root: Document | Element): Generator<HTMLAnchorElement> {
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    yield a
  }
  const doc = root instanceof Document ? root : root.ownerDocument
  if (!doc) return
  for (const frame of Array.from(doc.querySelectorAll<HTMLIFrameElement>('iframe'))) {
    try {
      const innerDoc = frame.contentDocument
      if (innerDoc) yield* iterateAnchors(innerDoc)
    }
    catch {
      // 跨域 iframe 读不到 contentDocument，跳过
    }
  }
}

/** 从一个文档根（包括同源 iframe）里提取所有外站链接，按出现顺序去重 */
export function extractExternalLinks(root: Document | Element = document): ExternalLink[] {
  const seen = new Set<string>()
  const out: ExternalLink[] = []

  for (const a of iterateAnchors(root)) {
    const rawHref = a.getAttribute('href') ?? ''
    const absolute = normalizeHref(rawHref)
    if (!absolute) continue
    if (shouldSkip(absolute)) continue

    if (seen.has(absolute)) continue
    seen.add(absolute)

    out.push({
      url: absolute,
      text: readAnchorText(a),
      host: safeHostname(absolute),
    })
  }

  return out
}

/** 拿到帖子里所有楼层正文节点（主帖 + 全部回帖 + 同源 iframe 楼中楼） */
function collectPostRoots(doc: Document = document): Element[] {
  const roots: Element[] = []
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('td.t_f[id^="postmessage_"], .t_f[id^="postmessage_"]'))) {
    roots.push(el)
  }
  for (const frame of Array.from(doc.querySelectorAll<HTMLIFrameElement>('iframe'))) {
    try {
      const inner = frame.contentDocument
      if (inner) roots.push(...collectPostRoots(inner))
    }
    catch { /* 跨域跳过 */ }
  }
  return roots
}

/** 提取帖子正文（所有楼层）里的外站链接；只扫正文范围，不扫页头/页脚/导航 */
export function extractPostExternalLinks(doc: Document = document): ExternalLink[] {
  const roots = collectPostRoots(doc)
  if (roots.length === 0) return []

  const seen = new Set<string>()
  const out: ExternalLink[] = []

  // 1) 先收集所有 a[href] 的外站链接（保留原顺序）
  for (const root of roots) {
    for (const a of iterateAnchors(root)) {
      const rawHref = a.getAttribute('href') ?? ''
      const absolute = normalizeHref(rawHref)
      if (!absolute) continue
      if (shouldSkip(absolute)) continue
      if (seen.has(absolute)) continue
      seen.add(absolute)
      out.push({
        url: absolute,
        text: readAnchorText(a),
        host: safeHostname(absolute),
      })
    }
  }

  // 2) 再扫"视觉隐藏的纯文本 URL"（白字 / 0 字号 / 透明度 0 / display:none 等）——
  // Discuz 楼主常把链接藏在白色 <font> 或超小字号里，DOM 里只有文本没有 <a>。
  for (const root of roots) {
    for (const url of iterateHiddenTextUrls(root)) {
      if (seen.has(url)) continue
      seen.add(url)
      out.push({
        url,
        text: url,
        host: safeHostname(url),
      })
    }
  }

  return out
}

/** 文本是否"视觉上被隐藏"（白字 / 极小字号 / 透明 / 不渲染） */
function isVisuallyHidden(el: Element): boolean {
  const computed = window.getComputedStyle(el)
  if (computed.display === 'none') return true
  if (computed.visibility === 'hidden') return true
  if (parseFloat(computed.opacity || '1') === 0) return true

  // 字号极小（< 4px）视为隐藏 —— 1px 这种几乎不可见
  const fontSize = parseFloat(computed.fontSize || '16')
  if (!Number.isNaN(fontSize) && fontSize < 4) return true

  // 颜色为白 / 接近白（含 rgba 0 alpha）
  const color = computed.color
  if (color) {
    const rgb = parseRgb(color)
    if (rgb && rgb.r >= 240 && rgb.g >= 240 && rgb.b >= 240) return true
  }
  return false
}

/** 把 'rgb(255, 255, 255)' / 'rgba(255, 255, 255, 0.9)' / '#fff' 解析成 {r,g,b} */
function parseRgb(value: string): { r: number, g: number, b: number } | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (v === 'white' || v === '#fff' || v === '#ffffff') return { r: 255, g: 255, b: 255 }
  const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (m) return { r: +m[1]!, g: +m[2]!, b: +m[3]! }
  const hex = v.match(/^#([0-9a-f]{6})$/)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
  }
  return null
}

const URL_REGEX = /https?:\/\/[^\s<>"']+/g

/** 在 root 子树里扫所有"视觉隐藏文本节点里的 URL" */
function* iterateHiddenTextUrls(root: Element): Generator<string> {
  const walker = (root.ownerDocument || document).createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue ?? '').trim()
    if (!text) continue
    // 排除已经在 a 标签内的文本（前面已经处理过 a[href]）
    let parent: Element | null = (node as Text).parentElement
    if (parent && parent.closest('a')) continue

    URL_REGEX.lastIndex = 0
    const matches = text.match(URL_REGEX)
    if (!matches) continue

    // 找到第一个"祖先链上命中视觉隐藏"的元素
    let hiddenAncestor: Element | null = parent
    while (hiddenAncestor && hiddenAncestor !== root && !isVisuallyHidden(hiddenAncestor)) {
      hiddenAncestor = hiddenAncestor.parentElement
    }
    if (!hiddenAncestor || hiddenAncestor === root) continue

    for (const m of matches) {
      // 去掉尾部的标点
      const url = m.replace(/[.,;:!?)]+$/, '')
      yield url
    }
  }
}

/** 判定当前页面是否是 Discuz 帖子详情页（viewthread 类） */
export function isViewthreadPage(url: string = location.href): boolean {
  try {
    const u = new URL(url)
    if (u.hostname !== currentHost()) return false
    // Discuz 帖子详情常见形态：forum.php?mod=viewthread&tid=...
    // 部分模板可能用 thread-{tid}-{page}.html 这种伪静态
    if (u.pathname.includes('thread-')) return true
    if (u.searchParams.get('mod') === 'viewthread') return true
    return false
  }
  catch {
    return false
  }
}

/** 判定当前页面是否是"长正文详情页"（用于百家姓 / 油管 / 外站链接扫描入口）。
 * - Discuz viewthread 页
 * - WordPress 文章页（/{slug}.html 或 /{slug}/）
 * 排除首页 / tag / author / search / category 列表 / forumdisplay 等聚合页 */
export function isArticlePage(url: string = location.href): boolean {
  if (isViewthreadPage(url)) return true
  try {
    const u = new URL(url)
    if (u.hostname !== currentHost()) return false
    const path = u.pathname
    // 排除聚合 / 检索 / 用户页
    if (
      path === '/' || path === '' // 首页
      || path.startsWith('/tag/') || path === '/tag'
      || path.startsWith('/author/') || path === '/author'
      || path.startsWith('/category/') || path === '/category'
      || path.startsWith('/search') || path.includes('/search/')
      || path.startsWith('/forum') || path.startsWith('/forumdisplay')
      || path.startsWith('/page/')
      || path.startsWith('/wp-')
      || path.startsWith('/feed')
    ) return false
    // WordPress 文章页：/{slug}.html 或 /{slug}/ 或 /{slug}
    if (path.endsWith('.html') || path.endsWith('/')) return true
    return false
  }
  catch {
    return false
  }
}

/** 找到最后一个楼层元素（.t_f / postmessage_*）；没有就返回 null */
export function findLastPostMessage(doc: Document = document): HTMLElement | null {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>('td.t_f[id^="postmessage_"], .t_f[id^="postmessage_"]'))
  if (candidates.length === 0) return null
  return candidates[candidates.length - 1] ?? null
}
