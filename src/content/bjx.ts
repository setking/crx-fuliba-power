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

// BJX_AUTO_PREVIEW_KEY / BJX_PROCESSED_ATTR / BJX_RESULT_CLASS / type PreviewState / WhatslinkInfo / bjxToMagnet / findBjxInText / findHexHashInText / findMagnetInText / hexToMagnet / isWhiteStyleLink / parseBjxYoutubeChannel / parseYoutubeWatchId / isArticlePage / applyPanelTheme / buildThemedStyle / markThemedHost / ensureStorageReady / safeLocalGet / buildFullMagnet / fetchWhatslinkInfo / formatSize 都在下方主体使用
import { BJX_AUTO_PREVIEW_KEY, BJX_PROCESSED_ATTR, BJX_RESULT_CLASS } from '@/global'
import type { PreviewState, WhatslinkInfo } from '@/type'
import {
  bjxToMagnet,
  findBjxInText,
  findHexHashInText,
  findMagnetInText,
  hexToMagnet,
  isWhiteStyleLink,
  parseBjxYoutubeChannel,
  parseYoutubeWatchId,
} from '@/utils/bjx'
import { isArticlePage } from '@/utils/hidden-links'
import { applyPanelTheme, buildThemedStyle, markThemedHost } from '@/utils/panel-theme'
import { ensureStorageReady, safeLocalGet } from '@/utils/storage-init'
import { buildFullMagnet, fetchWhatslinkInfo, formatSize } from '@/utils/whatslink'

const BJX_RESULT_BASE_CSS = [
  'display: block',
  'margin: 4px 0',
  'padding: 4px 8px',
  'border-left: 3px solid var(--panel-accent)',
  'background: var(--panel-accent-bg)',
  'color: var(--panel-text)',
  'font-size: 12px',
  'word-break: break-all',
  'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
].join('!important; ') + '!important'

const BJX_RESULT_LABEL_CSS = [
  'display: inline-block',
  'margin-right: 6px',
  'padding: 1px 6px',
  'border-radius: 3px',
  'background: var(--panel-accent)',
  'color: white',
  'font-size: 11px',
  'font-family: ui-sans-serif, system-ui, sans-serif',
].join('!important; ') + '!important'

const BJX_RESULT_LINK_CSS = [
  'color: var(--panel-link)',
  'text-decoration: underline',
].join('!important; ') + '!important'

/** 预览按钮 + 二级面板共用样式 */
const PREVIEW_BUTTON_CSS = [
  'display: inline-block',
  'margin-left: 8px',
  'padding: 1px 8px',
  'border-radius: 3px',
  'border: 1px solid var(--panel-accent)',
  'background: var(--panel-surface)',
  'color: #2563eb',
  'font-size: 11px',
  'cursor: pointer',
  'font-family: ui-sans-serif, system-ui, sans-serif',
].join('!important; ') + '!important'

const PREVIEW_PANEL_CSS = [
  'display: block',
  'margin-top: 6px',
  'padding: 6px 8px',
  'background: var(--panel-bg)',
  'border-left: 2px solid var(--panel-success-border)',
  'border-radius: 3px',
  'font-size: 11px',
  'color: var(--panel-text)',
  'font-family: ui-sans-serif, system-ui, sans-serif',
  'line-height: 1.5',
].join('!important; ') + '!important'

const PREVIEW_SCREENSHOT_CSS = [
  'display: inline-block',
  'max-width: 200px',
  'max-height: 150px',
  'margin: 4px 4px 0 0',
  'border-radius: 4px',
  'border: 1px solid var(--panel-border)',
  'cursor: pointer',
  'vertical-align: top',
].join('!important; ') + '!important'

/** 收集到的命中条目：原文片段、跳转 href、显示标签 */
interface BjxHit {
  index: number
  raw: string
  href: string
  label: string
}

/** 判定 href 是否是合法 magnet 链接（用于挂"🔍 预览"按钮） */
function isMagnetish(href: string): boolean {
  return /^magnet:\?xt=urn:btih:[a-fA-F0-9]{32,40}/.test(href)
}

/**
 * 同一段文本里三种格式可能互相重叠（magnet 内部含 hex，hex 也可能被 magnet 命中）：
 * 先按 index 合并排序，再丢弃被后续命中完全覆盖的片段，确保不重复输出。
 */
function collectHits(text: string): BjxHit[] {
  const hits: BjxHit[] = []

  for (const m of findMagnetInText(text)) {
    const idx = text.indexOf(m, hits[hits.length - 1]?.index ?? 0)
    if (idx < 0) continue
    hits.push({ index: idx, raw: m, href: m, label: 'magnet' })
  }

  for (const h of findHexHashInText(text)) {
    const start = Math.max(0, hits[hits.length - 1]?.index ?? 0)
    const idx = text.indexOf(h, start)
    if (idx < 0) continue
    const href = hexToMagnet(h)
    // toMagnet 弱校验（32–40 hex）失败时原样返回非 magnet 串 —— 跳过不入 hits
    if (!href.startsWith('magnet:')) continue
    hits.push({ index: idx, raw: h, href, label: 'hex' })
  }

  for (const seg of findBjxInText(text)) {
    const start = Math.max(0, hits[hits.length - 1]?.index ?? 0)
    const idx = text.indexOf(seg, start)
    if (idx < 0) continue
    const href = bjxToMagnet(seg)
    // bjxToMagnet 会直通 magnet / http(s) URL / ed2k；其余视为无效（截断后空串或非 hex 残留）
    if (!/^(magnet:|https?:\/\/|ed2k:\/\/)/.test(href)) continue
    hits.push({ index: idx, raw: seg, href, label: '百家姓' })
  }

  // 按 index 升序；同起点保留先到的（magnet > hex > 百家姓）
  hits.sort((a, b) => a.index - b.index)

  // 丢弃被前一个命中完全覆盖的（magnet 内部包含 hex 时只保留 magnet）
  const deduped: BjxHit[] = []
  let cursor = -1
  for (const hit of hits) {
    if (hit.index < cursor) continue
    deduped.push(hit)
    cursor = hit.index + hit.raw.length
  }
  return deduped
}

/** 给"预览"二级面板的内容（状态化渲染） */
function renderPreviewPanel(state: PreviewState, info: WhatslinkInfo | null, errorMsg: string | null, onScreenshots: () => void, magnet: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  const panel = document.createElement('div')
  panel.style.cssText = PREVIEW_PANEL_CSS

  if (state === 'loading') {
    panel.textContent = '⏳ 查询中...'
  }
  else if (state === 'error') {
    panel.textContent = `❌ 查询失败：${errorMsg ?? '未知错误'}`
  }
  else if (state === 'done' && info) {
    if (!info.found) {
      panel.textContent = '未找到元数据（资源可能已失效或未收录）'
    }
    else {
      const lines: string[] = []
      if (info.name) lines.push(`名称：${info.name}`)
      lines.push(`大小：${formatSize(info.size)}`)
      if (info.fileType) lines.push(`类型：${info.fileType}`)
      if (info.count > 0) lines.push(`文件数：${info.count}`)
      panel.textContent = lines.join('    ')
    }

    // 复制完整 magnet 按钮（始终挂上：用户是傻瓜，复制需求与是否查到元数据无关）
    const fullMagnet = buildFullMagnet(magnet, info.name, info.size)
    const copyBtn = document.createElement('button')
    copyBtn.textContent = '📋 复制完整 magnet'
    copyBtn.title = fullMagnet
    copyBtn.style.cssText = PREVIEW_BUTTON_CSS
    copyBtn.type = 'button'
    copyBtn.addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      const restore = () => {
        copyBtn.textContent = '📋 复制完整 magnet'
      }
      const done = () => {
        copyBtn.textContent = '✓ 已复制'
        setTimeout(restore, 1200)
      }
      const fail = () => {
        copyBtn.textContent = '❌ 复制失败'
        setTimeout(restore, 1200)
      }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(fullMagnet).then(done, () => {
          // 兜底用 textarea + execCommand（whatslink.info 需要 https 才能 clipboard API，
          // 但本插件在 forum 上跑可能是 http，要兜底）
          const ta = document.createElement('textarea')
          ta.value = fullMagnet
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          try {
            document.execCommand('copy') ? done() : fail()
          }
          catch {
            fail()
          }
          finally {
            ta.remove()
          }
        })
      }
      else {
        fail()
      }
    })
    panel.appendChild(document.createTextNode(' '))
    panel.appendChild(copyBtn)

    // 截图按钮（仅在 done 且有截图时）
    if (info.found && info.screenshots.length > 0) {
      const btn = document.createElement('button')
      btn.textContent = `📷 查看截图 (${info.screenshots.length})`
      btn.style.cssText = PREVIEW_BUTTON_CSS
      btn.type = 'button'
      // 标记按钮角色：onScreenshots 回调要移除的就是这一颗，不是面板里的复制按钮。
      btn.dataset.bjxRole = 'screenshots'
      btn.addEventListener('click', onScreenshots)
      panel.appendChild(document.createTextNode(' '))
      panel.appendChild(btn)
    }
  }

  frag.appendChild(panel)
  return frag
}

/** 在预览按钮点击后渲染截图缩略图 */
function renderScreenshots(panel: HTMLElement, urls: string[]): void {
  for (const url of urls) {
    const img = document.createElement('img')
    img.src = url
    img.alt = 'screenshot'
    img.style.cssText = PREVIEW_SCREENSHOT_CSS
    img.addEventListener('click', () => window.open(url, '_blank', 'noopener,noreferrer'))
    panel.appendChild(img)
  }
}

/** 处理"🔍 预览"按钮的点击：状态机驱动 fetch + 渲染 */
async function handlePreviewClick(
  magnet: string,
  shadow: ShadowRoot,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true
  button.textContent = '⏳ 查询中...'

  // 重试幂等：若按钮后已挂过面板（data-bjx-panel-host 是上一轮插入的标记），
  // 直接复用，不重复 append —— 否则多次重试会堆出一排 ❌ 失败提示。
  let panelHost = button.nextElementSibling as HTMLElement | null
  if (!panelHost || panelHost.dataset.bjxPanelHost !== magnet) {
    panelHost = document.createElement('span')
    panelHost.dataset.bjxPanelHost = magnet
    panelHost.style.cssText = 'display: block !important;'
    button.insertAdjacentElement('afterend', panelHost)
  }
  panelHost.replaceChildren(renderPreviewPanel('loading', null, null, () => { /* no-op until done */ }, magnet))

  try {
    const info = await fetchWhatslinkInfo(magnet)
    const onScreenshots = () => {
      // 把"查看截图"按钮替换成缩略图（不能 querySelector('button') —— 那会拿到上面的"复制"按钮）。
      const panelEl = panelHost.querySelector('div')
      if (!panelEl) return
      const btnInPanel = panelEl.querySelector('button[data-bjx-role="screenshots"]')
      if (btnInPanel) btnInPanel.remove()
      renderScreenshots(panelEl, info.screenshots)
    }
    panelHost.replaceChildren(renderPreviewPanel('done', info, null, onScreenshots, magnet))
    button.textContent = '✓ 已预览'
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    panelHost.replaceChildren(renderPreviewPanel('error', null, msg, () => { /* no-op */ }, magnet))
    button.textContent = '🔄 重试'
    button.disabled = false
  }
}

/** 在给定的 ShadowRoot 里建一个结果行（magnet 链接 / 油管链接 / 白字提示） */
function buildBjxResult(shadow: ShadowRoot, label: string, link: { href: string, text: string } | null, hit?: BjxHit) {
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

  // 最终 href 是合法 magnet 时挂预览按钮（覆盖三种来源：magnet 原串 / hex / 百家姓）
  if (hit?.href && isMagnetish(hit.href)) {
    const magnet = hit.href
    const btn = document.createElement('button')
    btn.textContent = '🔍 预览'
    btn.type = 'button'
    btn.style.cssText = PREVIEW_BUTTON_CSS
    btn.dataset.bjxMagnet = magnet
    btn.addEventListener('click', () => {
      void handlePreviewClick(magnet, shadow, btn)
    })
    wrapper.appendChild(btn)

    // 自动预览开关开启时：用 IntersectionObserver 在按钮进入视口时后台预热 whatslink 缓存。
    // 注意：这里不展开 UI，只是 fetch + 写入 chrome.storage.local，用户实际点预览时秒出。
    if (bjxAutoPreview) {
      ensurePreviewObserver().observe(btn)
    }
  }

  shadow.appendChild(wrapper)
}

/** 懒初始化全局 IntersectionObserver（共享一个 observer 实例） */
function ensurePreviewObserver(): IntersectionObserver {
  if (previewObserver) return previewObserver
  previewObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const btn = entry.target as HTMLButtonElement
      const magnet = btn.dataset.bjxMagnet
      if (!magnet || warmedMagnetSet.has(btn)) continue
      warmedMagnetSet.add(btn)
      warmMagnetCache(magnet)
      // 已预热后从 observer 摘除（同一 magnet 不重复触发）
      previewObserver?.unobserve(btn)
    }
  }, { rootMargin: '200px 0px' /* 提前 200px 触发：滚到按钮前缓存已就绪 */ })
  return previewObserver
}

/** 给原元素追加一个结果行；用 Shadow DOM 宿主 <div> 包裹（必须是 div 才能强制 block 换行）。
 * raw 记到 host.dataset.bjxRaw，整容器兜底时用它做去重，避免重复挂同一条命中。 */
function appendResultAfter(el: Element, raw: string, buildInner: (shadow: ShadowRoot) => void) {
  const host = document.createElement('div')
  host.className = BJX_RESULT_CLASS
  host.dataset.bjxRaw = raw
  host.style.cssText = 'display: block !important; margin: 4px 0 !important; clear: both !important;'
  const shadow = host.attachShadow({ mode: 'open' })
  // 主题：themed style 写在最前面，让用户内容继承变量
  shadow.appendChild(buildThemedStyle())
  buildInner(shadow)
  markThemedHost(host)
  void applyPanelTheme(host)
  el.insertAdjacentElement('afterend', host)
}

/** 扫一个 <p> 节点：百家姓 / magnet / hex → 各自结果行；youtube watch → 油管跳转 */
function transformParagraph(p: HTMLParagraphElement): boolean {
  const text = (p.textContent ?? '').trim()
  if (!text) return false

  let hit = false

  for (const h of collectHits(text)) {
    appendResultAfter(p, h.raw, (shadow) => buildBjxResult(shadow, h.label, { href: h.href, text: h.href }, h))
    hit = true
  }

  const videoId = parseYoutubeWatchId(text)
  if (videoId) {
    const href = `https://www.youtube.com/watch?v=${videoId}`
    appendResultAfter(p, `youtube:${videoId}`, (shadow) => buildBjxResult(shadow, 'YouTube', { href, text: href }))
    hit = true
  }

  return hit
}

/** 扫一个非 <p> 容器（比如裸 <td>）：把它整个 textContent 当一段扫描。
 * 直接 appendResultAfter(<td>) 会让 <div> 落到 </td> 之外、表格布局里行为怪异。
 * 这里改用 td 的最后一个子元素做锚点，结果行会插入到 td 内部末尾（仍在 td 内，正常换行）。
 *
 * 兜底场景去重：post 子树里已经挂过的 raw 不重复挂（典型场景：评论 lazy load
 * 后整容器兜底扫描会与之前 p 命中挂的 result 重复挂同一条 magnet）。 */
function transformGenericContainer(el: HTMLElement): boolean {
  const text = (el.textContent ?? '').trim()
  if (!text) return false

  // 锚点：优先 td 最后一个有意义的子元素（避免落到 </td> 外）
  const anchor = (el.lastElementChild as HTMLElement | null) ?? el

  // 收集子树里已经挂过的 raw 集合（基于 host.dataset.bjxRaw）
  const existingRaws = new Set<string>()
  for (const host of Array.from(el.querySelectorAll<HTMLElement>(`.${BJX_RESULT_CLASS}`))) {
    const raw = host.dataset.bjxRaw
    if (raw) existingRaws.add(raw)
  }

  let hit = false
  for (const h of collectHits(text)) {
    if (existingRaws.has(h.raw)) continue
    appendResultAfter(anchor, h.raw, (shadow) => buildBjxResult(shadow, h.label, { href: h.href, text: h.href }, h))
    hit = true
  }
  return hit
}

/** 扫一个 <h4> 节点：油管/channelXXXX → 油管频道链接 */
function transformH4(h4: HTMLHeadingElement): void {
  const text = (h4.textContent ?? '').trim()
  if (!text.includes('油管/channel')) return
  const channelId = parseBjxYoutubeChannel(text)
  if (!channelId) return
  const href = `https://youtube.com/channel/${channelId}`
  appendResultAfter(h4, `youtube-channel:${channelId}`, (shadow) => buildBjxResult(shadow, 'YouTube 频道', { href, text: href }))
}

/** 扫一个 <a> 节点：白字 inline style → 标红 + 显示文本（不动原文链接 href） */
function transformAnchor(a: HTMLAnchorElement): void {
  if (!isWhiteStyleLink(a)) return
  appendResultAfter(a, `hidden:${a.href}`, (shadow) => buildBjxResult(shadow, '隐藏链接', { href: a.href, text: `好孩子看不见：${a.href}` }))
}

/** 扫一个 td.t_f / article.article-content / li.comment 节点下的所有 <p> / <h4> / <a> + 整容器兜底 */
function transformPost(post: HTMLElement): void {
  let anyParagraphHit = false
  for (const p of Array.from(post.querySelectorAll<HTMLParagraphElement>('p'))) {
    if (p.hasAttribute(BJX_PROCESSED_ATTR)) continue
    p.setAttribute(BJX_PROCESSED_ATTR, '1')
    if (transformParagraph(p)) anyParagraphHit = true
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
  if (!anyParagraphHit) {
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

/** 自动预览开关（模块级）：enableBjxTransform 启动时读一次，buildBjxResult 读它决定挂 IntersectionObserver */
let bjxAutoPreview = false

/** 全局 IntersectionObserver 池：所有 magnet 预览按钮共享一个 observer，避免每条 magnet 各起一个 */
let previewObserver: IntersectionObserver | null = null
/** 已触发过预热的 magnet 集合（同一 magnet 不重复 fetch） */
const warmedMagnetSet = new WeakSet<HTMLButtonElement>()

/** 后台预热 whatslink 缓存：不展开 UI，只把结果写进 chrome.storage.local。
 * 用户实际点预览按钮时命中缓存，秒出。失败静默吞掉（用户没主动点就不打扰）。 */
function warmMagnetCache(magnet: string): void {
  void fetchWhatslinkInfo(magnet).catch(() => {
    /* 用户没主动点，后台预热失败不打扰 */
  })
}

/** 等待帖子楼层 / 文章正文出现后启动转换；后续用 MutationObserver 跟进新增节点 */
export async function enableBjxTransform(): Promise<void> {
  // 等 storage 默认值补齐后再读取 BJX_AUTO_PREVIEW_KEY —— 默认 true 已写入，避免读到 undefined 误判
  await ensureStorageReady()

  await waitForArticleRoot()

  // 读一次"自动预览"开关；后续通过 chrome.storage.onChanged 跟进（用户在 popup 切换时立即生效）。
  // safeLocalGet：content script 上下文偶发 "Access to storage is not allowed from this context"，
  // 失败返回 { bjxAutoPreview: true } —— 与默认开启语义对齐。
  const stored = await safeLocalGet(BJX_AUTO_PREVIEW_KEY, { [BJX_AUTO_PREVIEW_KEY]: true })
  bjxAutoPreview = stored[BJX_AUTO_PREVIEW_KEY] !== false // 默认开启

  // 关掉时顺手 disconnect 已挂的 observer，避免对旧按钮继续预热
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(BJX_AUTO_PREVIEW_KEY in changes)) return
    const next = changes[BJX_AUTO_PREVIEW_KEY].newValue
    bjxAutoPreview = next !== false
    if (!bjxAutoPreview) previewObserver?.disconnect()
  })

  transformAllPosts()

  // 监听后续新增节点（比如翻页加载 / 评论加载）
  const schedule = debounced(() => {
    if (!isArticlePage()) return
    transformAllPosts()
  }, 600)
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
}
