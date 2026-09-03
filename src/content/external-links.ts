/**
 * 外站链接面板模块
 *
 * viewthread 详情页加载完成后，把帖子正文中所有 <a href>（非论坛内部跳转）收集起来，
 * 在楼主正文段之后以 <details> 折叠面板的形式插入。每条卡片含域名 + URL + 复制按钮。
 *
 * 入口：enableExternalLinksPanel() —— 在 isViewthreadPage() 命中时调用
 */

import { EXTERNAL_LINKS_PANEL_ID } from '@/global'
import { extractPostExternalLinks, isViewthreadPage, type ExternalLink } from '@/utils/hidden-links'

const EXTERNAL_LINKS_BASE_CSS = [
  'padding: 12px 16px',
  'border: 1px solid #e5e7eb',
  'border-radius: 8px',
  'background: #f9fafb',
  'font-family: ui-sans-serif, system-ui, sans-serif',
  'font-size: 13px',
  'color: #1f2937',
  'box-sizing: border-box',
  'max-width: 100%',
].join('!important; ') + '!important'

const EXTERNAL_LINKS_HEADER_CSS = [
  'cursor: pointer',
  'font-weight: 600',
  'font-size: 14px',
  'color: #1f2937',
  'list-style: none',
  'padding: 6px 8px',
  'border-radius: 4px',
  'user-select: none',
].join('!important; ') + '!important'

const EXTERNAL_LINKS_HEADER_INNER_CSS = [
  'display: inline-flex',
  'align-items: center',
  'gap: 8px',
].join('!important; ') + '!important'

const EXTERNAL_LINKS_ARROW_CSS = [
  'display: inline-block',
  'transition: transform 150ms ease',
  'font-size: 12px',
  'color: #6b7280',
].join('!important; ') + '!important'

const EXTERNAL_LINKS_LIST_CSS = [
  'margin: 8px 0 0',
  'padding: 0',
  'list-style: none',
  'display: flex',
  'flex-direction: column',
  'gap: 8px',
].join('!important; ') + '!important'

const EXTERNAL_LINKS_ITEM_CSS = [
  'display: flex',
  'align-items: center',
  'gap: 10px',
  'padding: 8px 10px',
  'border: 1px solid #e5e7eb',
  'border-radius: 6px',
  'background: white',
].join('!important; ') + '!important'

const EXTERNAL_LINKS_HOST_CSS = [
  'flex: 0 0 auto',
  'font-weight: 500',
  'color: #2563eb',
].join('!important; ') + '!important'

const EXTERNAL_LINKS_URL_CSS = [
  'flex: 1',
  'min-width: 0',
  'overflow: hidden',
  'text-overflow: ellipsis',
  'white-space: nowrap',
  'color: #4b5563',
  'text-decoration: none',
].join('!important; ') + '!important'

const EXTERNAL_LINKS_COPY_CSS = [
  'flex: 0 0 auto',
  'padding: 4px 10px',
  'border: 1px solid #d1d5db',
  'border-radius: 4px',
  'background: white',
  'color: #374151',
  'font-size: 12px',
  'cursor: pointer',
].join('!important; ') + '!important'

function buildExternalLinksPanel(links: ExternalLink[]): HTMLElement {
  const details = document.createElement('details')
  details.style.cssText = EXTERNAL_LINKS_BASE_CSS

  const summary = document.createElement('summary')
  summary.style.cssText = EXTERNAL_LINKS_HEADER_CSS
  summary.style.setProperty('list-style', 'none', 'important')

  // 内层 span 装箭头 + 标题 + 数量，避免 summary 直接被论坛 CSS 覆盖
  const inner = document.createElement('span')
  inner.style.cssText = EXTERNAL_LINKS_HEADER_INNER_CSS

  const arrow = document.createElement('span')
  arrow.textContent = '▶'
  arrow.style.cssText = EXTERNAL_LINKS_ARROW_CSS

  const title = document.createElement('span')
  title.textContent = '外站链接'

  const count = document.createElement('span')
  count.textContent = `(${links.length})`
  count.style.cssText = 'color: #6b7280 !important; font-weight: 400 !important;'

  const hint = document.createElement('span')
  hint.textContent = '点击展开'
  hint.style.cssText = 'color: #9ca3af !important; font-size: 12px !important; font-weight: 400 !important; margin-left: auto !important;'

  inner.append(arrow, title, count, hint)
  summary.appendChild(inner)
  details.appendChild(summary)

  // 展开时箭头旋转
  details.addEventListener('toggle', () => {
    arrow.textContent = details.open ? '▼' : '▶'
  })

  const list = document.createElement('ul')
  list.style.cssText = EXTERNAL_LINKS_LIST_CSS

  for (const link of links) {
    const li = document.createElement('li')
    li.style.cssText = EXTERNAL_LINKS_ITEM_CSS

    const host = document.createElement('span')
    host.textContent = link.host || '(未知主机)'
    host.style.cssText = EXTERNAL_LINKS_HOST_CSS
    li.appendChild(host)

    const a = document.createElement('a')
    a.href = link.url
    a.textContent = link.text ? `${link.text} — ${link.url}` : link.url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.style.cssText = EXTERNAL_LINKS_URL_CSS
    li.appendChild(a)

    const copy = document.createElement('button')
    copy.type = 'button'
    copy.textContent = '复制'
    copy.style.cssText = EXTERNAL_LINKS_COPY_CSS
    copy.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const done = () => {
        const prev = copy.textContent
        copy.textContent = '已复制'
        setTimeout(() => { copy.textContent = prev ?? '复制' }, 1200)
      }
      const fail = () => {
        copy.textContent = '复制失败'
        setTimeout(() => { copy.textContent = '复制' }, 1200)
      }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(link.url).then(done, () => {
          // 兜底用 textarea + execCommand
          const ta = document.createElement('textarea')
          ta.value = link.url
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          try { document.execCommand('copy') ? done() : fail() }
          catch { fail() }
          finally { ta.remove() }
        })
      }
      else {
        fail()
      }
    })
    li.appendChild(copy)

    list.appendChild(li)
  }

  details.appendChild(list)
  return details
}

/** 找 postmessage_* ID 数字最小的那条楼层（楼主） */
function findOpPost(): HTMLElement | null {
  const posts = document.querySelectorAll<HTMLElement>('td.t_f[id^="postmessage_"]')
  if (posts.length === 0) return null
  let op = posts[0] as HTMLElement
  let minId = Number(op.id.replace('postmessage_', ''))
  for (const el of Array.from(posts)) {
    const id = Number(el.id.replace('postmessage_', ''))
    if (id < minId) {
      minId = id
      op = el
    }
  }
  return op
}

/** 把面板以"新行"的形式插入到楼主正文段之后 */
function mountExternalLinksPanel(opPost: HTMLElement): void {
  // 先把上一次插入的整行（含宿主 <div>）一起清掉，避免 MutationObserver 反复触发死循环
  document.querySelectorAll('tr[data-external-links-row="1"]').forEach(r => r.remove())
  document.getElementById(EXTERNAL_LINKS_PANEL_ID)?.remove()

  const links = extractPostExternalLinks(document)
  if (links.length === 0) return

  // 找楼主正文的 table —— <div class="t_fsz"><table><tr><td class="t_f">...</td></tr></table>
  const opTable = opPost.closest('table')
  if (!opTable || !opTable.isConnected) return

  const tr = document.createElement('tr')
  const td = document.createElement('td')
  td.className = 't_f'
  td.style.cssText = 'padding: 12px 0 !important; border: 0 !important;'

  const host = document.createElement('div')
  host.id = EXTERNAL_LINKS_PANEL_ID
  host.style.cssText = 'display: block; max-width: 100% !important;'

  const shadow = host.attachShadow({ mode: 'open' })
  shadow.appendChild(buildExternalLinksPanel(links))

  td.appendChild(host)
  tr.appendChild(td)
  tr.dataset.externalLinksRow = '1'
  opTable.appendChild(tr)
}

/** debounce 工具 */
function debounced(fn: () => void, waitMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; fn() }, waitMs)
  }
}

/** 在 viewthread 详情页启用外站链接面板 */
export async function enableExternalLinksPanel(): Promise<void> {
  // 论坛脚本异步插入楼层，初次挂载不一定有；改为：检测到楼主楼层出现后立即挂载
  const tryMount = () => {
    const opPost = findOpPost()
    if (!opPost) return false
    mountExternalLinksPanel(opPost)
    return true
  }

  if (!tryMount()) {
    // 等待楼主楼层出现（最长 15s，因为 Discuz 异步加载 + 翻页加载可能较慢）
    const start = Date.now()
    while (Date.now() - start < 15000) {
      await new Promise(r => setTimeout(r, 300))
      if (tryMount()) break
    }
  }

  // 已挂载后：用 MutationObserver 监听后续楼层加入。
  // 注意：之前用"楼层 ID 集合变化"判断太严，Discuz 图片懒加载会重写正文 DOM 把我们的 <tr> 一起删掉，
  // 此时楼层 ID 没变但面板已丢。改为：每次 debounce 后检查宿主 <div> 是否还在，不在就重 mount。
  const scheduleRemount = debounced(() => {
    if (!isViewthreadPage()) return
    const opPost = findOpPost()
    if (!opPost) return
    const hostStillThere = document.getElementById(EXTERNAL_LINKS_PANEL_ID)
    if (hostStillThere) return
    mountExternalLinksPanel(opPost)
  }, 800)

  const observer = new MutationObserver((records) => {
    if (records.some(r => (r.target as HTMLElement | null)?.closest?.('tr[data-external-links-row="1"]'))) return
    scheduleRemount()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  window.addEventListener('popstate', scheduleRemount)
  const origPush = history.pushState
  history.pushState = function (...args) {
    const ret = origPush.apply(this, args)
    scheduleRemount()
    return ret
  }
}
