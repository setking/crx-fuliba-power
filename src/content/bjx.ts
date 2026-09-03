/**
 * 百家姓 / 油管 / 白字链接 转换模块
 *
 * 在 Discuz 帖子楼层 / WordPress 文章页 / 评论区扫描：
 * - 连续百家姓字符 → 转 magnet:?xt=urn:btih: 链接（40 字符 hex 时自动加前缀）
 * - watch?v=XXXX 文本 → 转 YouTube 链接
 * - 油管/channelXXX h4 → 转频道链接
 * - 白字 inline style 的 <a> → "好孩子看不见" 提示
 * 结果作为新 <div> 行插入到原节点后面，原文不动。
 *
 * 入口：enableBjxTransform() —— 在 isArticlePage() 命中时调用
 */

import { BJX_PROCESSED_ATTR, BJX_RESULT_CLASS } from '@/global'
import { bjxToMagnet, findBjxInText, isWhiteStyleLink, parseBjxYoutubeChannel, parseYoutubeWatchId } from '@/utils/bjx'
import { isArticlePage } from '@/utils/hidden-links'

const BJX_RESULT_BASE_CSS = [
  'display: block',
  'margin: 4px 0',
  'padding: 4px 8px',
  'border-left: 3px solid #3b82f6',
  'background: #eff6ff',
  'color: #1f2937',
  'font-size: 12px',
  'word-break: break-all',
  'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
].join('!important; ') + '!important'

const BJX_RESULT_LABEL_CSS = [
  'display: inline-block',
  'margin-right: 6px',
  'padding: 1px 6px',
  'border-radius: 3px',
  'background: #3b82f6',
  'color: white',
  'font-size: 11px',
  'font-family: ui-sans-serif, system-ui, sans-serif',
].join('!important; ') + '!important'

const BJX_RESULT_LINK_CSS = [
  'color: #2563eb',
  'text-decoration: underline',
].join('!important; ') + '!important'

/** 在给定的 ShadowRoot 里建一个结果行（magnet 链接 / 油管链接 / 白字提示） */
function buildBjxResult(shadow: ShadowRoot, label: string, link: { href: string, text: string } | null) {
  const wrapper = document.createElement('div')
  wrapper.style.cssText = BJX_RESULT_BASE_CSS

  const tag = document.createElement('span')
  tag.textContent = label
  tag.style.cssText = BJX_RESULT_LABEL_CSS
  wrapper.appendChild(tag)

  if (link) {
    const a = document.createElement('a')
    a.href = link.href
    a.textContent = link.text || link.href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.style.cssText = BJX_RESULT_LINK_CSS
    wrapper.appendChild(a)
  }
  else {
    const span = document.createElement('span')
    span.textContent = '(无匹配)'
    wrapper.appendChild(span)
  }

  shadow.appendChild(wrapper)
}

/** 给原元素追加一个结果行；用 Shadow DOM 宿主 <div> 包裹（必须是 div 才能强制 block 换行） */
function appendResultAfter(el: Element, buildInner: (shadow: ShadowRoot) => void) {
  const host = document.createElement('div')
  host.className = BJX_RESULT_CLASS
  host.style.cssText = 'display: block !important; margin: 4px 0 !important; clear: both !important;'
  const shadow = host.attachShadow({ mode: 'open' })
  buildInner(shadow)
  el.insertAdjacentElement('afterend', host)
}

/** 扫一个 <p> 节点：百家姓 → magnet；youtube watch 链接 → 油管跳转 */
function transformParagraph(p: HTMLParagraphElement): void {
  const text = (p.textContent ?? '').trim()
  if (!text) return

  const segments = findBjxInText(text)
  for (const seg of segments) {
    const magnet = bjxToMagnet(seg)
    const label = seg.length === 40 ? 'magnet' : '百家姓'
    appendResultAfter(p, (shadow) => buildBjxResult(shadow, label, { href: magnet, text: magnet }))
  }

  const videoId = parseYoutubeWatchId(text)
  if (videoId) {
    const href = `https://www.youtube.com/watch?v=${videoId}`
    appendResultAfter(p, (shadow) => buildBjxResult(shadow, 'YouTube', { href, text: href }))
  }
}

/** 扫一个非 <p> 容器（比如裸 <td>）：把它整个 textContent 当一段扫描。
 * 直接 appendResultAfter(<td>) 会让 <div> 落到 </td> 之外、表格布局里行为怪异。
 * 这里改用 td 的最后一个子元素做锚点，结果行会插入到 td 内部末尾（仍在 td 内，正常换行）。 */
function transformGenericContainer(el: HTMLElement): void {
  const text = (el.textContent ?? '').trim()
  if (!text) return

  const segments = findBjxInText(text)

  // 锚点：优先 td 最后一个有意义的子元素（避免落到 </td> 外）
  const anchor = (el.lastElementChild as HTMLElement | null) ?? el

  for (const seg of segments) {
    const magnet = bjxToMagnet(seg)
    const label = seg.length === 40 ? 'magnet' : '百家姓'
    appendResultAfter(anchor, (shadow) => buildBjxResult(shadow, label, { href: magnet, text: magnet }))
  }
}

/** 扫一个 <h4> 节点：油管/channelXXXX → 油管频道链接 */
function transformH4(h4: HTMLHeadingElement): void {
  const text = (h4.textContent ?? '').trim()
  if (!text.includes('油管/channel')) return
  const channelId = parseBjxYoutubeChannel(text)
  if (!channelId) return
  const href = `https://youtube.com/channel/${channelId}`
  appendResultAfter(h4, (shadow) => buildBjxResult(shadow, 'YouTube 频道', { href, text: href }))
}

/** 扫一个 <a> 节点：白字 inline style → 标红 + 显示文本（不动原文链接 href） */
function transformAnchor(a: HTMLAnchorElement): void {
  if (!isWhiteStyleLink(a)) return
  appendResultAfter(a, (shadow) => buildBjxResult(shadow, '隐藏链接', { href: a.href, text: `好孩子看不见：${a.href}` }))
}

/** 扫一个 td.t_f / article.article-content / li.comment 节点下的所有 <p> / <h4> / <a> + 整容器兜底 */
function transformPost(post: HTMLElement): void {
  let paragraphCount = 0
  for (const p of Array.from(post.querySelectorAll<HTMLParagraphElement>('p'))) {
    if (p.hasAttribute(BJX_PROCESSED_ATTR)) continue
    p.setAttribute(BJX_PROCESSED_ATTR, '1')
    transformParagraph(p)
    paragraphCount += 1
  }

  for (const h4 of Array.from(post.querySelectorAll<HTMLHeadingElement>('h4'))) {
    if (h4.hasAttribute(BJX_PROCESSED_ATTR)) continue
    h4.setAttribute(BJX_PROCESSED_ATTR, '1')
    transformH4(h4)
  }

  for (const a of Array.from(post.querySelectorAll<HTMLAnchorElement>('a'))) {
    if (a.hasAttribute(BJX_PROCESSED_ATTR)) continue
    a.setAttribute(BJX_PROCESSED_ATTR, '1')
    transformAnchor(a)
  }

  // 兜底：把整个容器当一段扫一遍，捕获 blockquote / <br> 旁裸文本 / <font> 嵌套里的百家姓
  // 但如果已经有 <p> 被命中，就不再整容器扫（避免重复在末尾追加）
  if (paragraphCount === 0) {
    transformGenericContainer(post)
  }
}

/** 扫所有帖子正文并转换：Discuz 看 postmessage_* 楼层，WordPress 看 article.article-content，评论区看 li.comment */
function transformAllPosts(): void {
  const roots: HTMLElement[] = []

  // Discuz 帖子页：每个 postmessage_* 楼层是一个独立 td
  for (const post of Array.from(document.querySelectorAll<HTMLElement>('td.t_f[id^="postmessage_"]'))) {
    roots.push(post)
  }

  // 非 Discuz（如 WordPress 主题 fuliba2025.net）：扫描整个页面的正文容器
  if (roots.length === 0) {
    const fallback = document.querySelector<HTMLElement>('article.article-content, .article-content, #postlist')
    if (fallback) roots.push(fallback)
  }

  // 评论区：ol.commentlist 下的每个 li.comment 是一条评论，里面含 <p>
  for (const comment of Array.from(document.querySelectorAll<HTMLElement>('ol.commentlist li.comment'))) {
    roots.push(comment)
  }

  for (const post of roots) {
    if (post.hasAttribute(BJX_PROCESSED_ATTR)) continue
    post.setAttribute(BJX_PROCESSED_ATTR, '1')
    transformPost(post)
  }
}

function waitForArticleRoot(): Promise<void> {
  return new Promise((resolve) => {
    const hasRoot = () => (
      document.querySelector('td.t_f[id^="postmessage_"]')
      || document.querySelector('article.article-content, .article-content, #postlist')
      || document.querySelector('ol.commentlist li.comment')
    )
    if (hasRoot()) {
      resolve()
      return
    }
    const start = Date.now()
    const timer = setInterval(() => {
      if (hasRoot() || Date.now() - start > 15000) {
        clearInterval(timer)
        resolve()
      }
    }, 300)
  })
}

function debounced(fn: () => void, waitMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; fn() }, waitMs)
  }
}

/** 等待帖子楼层 / 文章正文出现后启动转换；后续用 MutationObserver 跟进新增节点 */
export async function enableBjxTransform(): Promise<void> {
  await waitForArticleRoot()
  transformAllPosts()

  // 监听后续新增节点（比如翻页加载 / 评论加载）
  const schedule = debounced(() => {
    if (!isArticlePage()) return
    transformAllPosts()
  }, 600)
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
}
