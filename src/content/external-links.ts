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
import { applyPanelTheme, buildThemedStyle, markThemedHost } from '@/utils/panel-theme'

const EXTERNAL_LINKS_BASE_CSS =
  [
    'padding: 12px 16px',
    'border: 1px solid var(--panel-border)',
    'border-radius: 8px',
    'background: var(--panel-bg)',
    'font-family: ui-sans-serif, system-ui, sans-serif',
    'font-size: 13px',
    'color: var(--panel-text)',
    'box-sizing: border-box',
    'max-width: 100%',
  ].join('!important; ') + '!important'

const EXTERNAL_LINKS_HEADER_CSS =
  [
    'cursor: pointer',
    'font-weight: 600',
    'font-size: 14px',
    'color: var(--panel-text)',
    'list-style: none',
    'padding: 6px 8px',
    'border-radius: 4px',
    'user-select: none',
  ].join('!important; ') + '!important'

const EXTERNAL_LINKS_HEADER_INNER_CSS =
  ['display: inline-flex', 'align-items: center', 'gap: 8px'].join('!important; ') + '!important'

const EXTERNAL_LINKS_ARROW_CSS =
  [
    'display: inline-block',
    'transition: transform 150ms ease',
    'font-size: 12px',
    'color: var(--panel-text-muted)'
  ].join('!important; ') + '!important'

const EXTERNAL_LINKS_LIST_CSS =
  [
    'margin: 8px 0 0',
    'padding: 0',
    'list-style: none',
    'display: flex',
    'flex-direction: column',
    'gap: 8px',
  ].join('!important; ') + '!important'

const EXTERNAL_LINKS_ITEM_CSS =
  [
    'display: flex',
    'align-items: center',
    'gap: 10px',
    'padding: 8px 10px',
    'border: 1px solid #e5e7eb',
    'border-radius: 6px',
    'background: var(--panel-surface)'
  ].join('!important; ') + '!important'

const EXTERNAL_LINKS_HOST_CSS =
  ['flex: 0 0 auto', 'font-weight: 500', 'color: var(--panel-link)'].join('!important; ') + '!important'

const EXTERNAL_LINKS_URL_CSS =
  [
    'flex: 1',
    'min-width: 0',
    'overflow: hidden',
    'text-overflow: ellipsis',
    'white-space: nowrap',
    'color: var(--panel-text-muted)',
    'text-decoration: none',
  ].join('!important; ') + '!important'

/** 默认态：高对比主色按钮（accent 背景 + on-accent 文字），配 hover 加深 + active 内移 + 状态色 */
const EXTERNAL_LINKS_COPY_CSS =
  [
    'flex: 0 0 auto',
    'padding: 5px 12px',
    'border: 1px solid var(--panel-accent)',
    'border-radius: 4px',
    'background: var(--panel-accent)',
    'color: var(--panel-on-accent)',
    'font-size: 12px',
    'font-weight: 600',
    'line-height: 1.2',
    'cursor: pointer',
    'transition: background-color 120ms ease, border-color 120ms ease, transform 80ms ease, box-shadow 120ms ease',
    'box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08)',
    'user-select: none',
  ].join('!important; ') + '!important'

/** 状态色：直接覆盖到 style.cssText 上（inline style 优先级最高，
 * 不能放 ShadowRoot 的 <style> 里 —— 那样会被 inline style 压住）。 */
const EXTERNAL_LINKS_COPY_HOVER_CSS = [
  'background: var(--panel-accent-hover)',
  'border-color: var(--panel-accent-hover)',
  'box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12)',
].join('!important; ') + '!important'

const EXTERNAL_LINKS_COPY_ACTIVE_CSS = [
  'transform: translateY(1px)',
  'box-shadow: 0 0 0 rgba(0, 0, 0, 0)',
].join('!important; ') + '!important'

const EXTERNAL_LINKS_COPY_DONE_CSS = [
  'background: var(--panel-success)',
  'border-color: var(--panel-success)',
  'color: var(--panel-on-accent)',
].join('!important; ') + '!important'

const EXTERNAL_LINKS_COPY_FAIL_CSS = [
  'background: var(--panel-danger)',
  'border-color: var(--panel-danger)',
  'color: var(--panel-on-accent)',
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
  count.style.cssText = 'color: var(--panel-text-muted) !important; font-weight: 400 !important;'

  const hint = document.createElement('span')
  hint.textContent = '点击展开'
  hint.style.cssText =
    'color: var(--panel-text-muted) !important; font-size: 12px !important; font-weight: 400 !important; margin-left: auto !important;'

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
    copy.dataset.copyState = 'default'
    copy.style.cssText = EXTERNAL_LINKS_COPY_CSS

    /** 把当前状态对应的额外样式拼到 baseCss 后面 —— ShadowRoot 的 inline style 优先级胜过 :hover/:active，
     * 所以状态色必须直接落到 style.cssText。 */
    function applyCopyState(state: typeof copy.dataset.copyState): void {
      copy.dataset.copyState = state
      let extra = ''
      if (state === 'hover') extra = EXTERNAL_LINKS_COPY_HOVER_CSS
      else if (state === 'active') extra = EXTERNAL_LINKS_COPY_ACTIVE_CSS
      else if (state === 'done') extra = EXTERNAL_LINKS_COPY_DONE_CSS
      else if (state === 'fail') extra = EXTERNAL_LINKS_COPY_FAIL_CSS
      copy.style.cssText = extra ? `${EXTERNAL_LINKS_COPY_CSS}; ${extra}` : EXTERNAL_LINKS_COPY_CSS
    }

    copy.addEventListener('mouseenter', () => {
      if (copy.dataset.copyState === 'default') applyCopyState('hover')
    })
    copy.addEventListener('mouseleave', () => {
      if (copy.dataset.copyState === 'hover' || copy.dataset.copyState === 'active') {
        applyCopyState('default')
      }
    })
    copy.addEventListener('mousedown', () => {
      if (copy.dataset.copyState === 'hover') applyCopyState('active')
    })
    copy.addEventListener('mouseup', () => {
      if (copy.dataset.copyState === 'active') applyCopyState('hover')
    })

    copy.addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      const done = () => {
        copy.textContent = '✓ 已复制'
        applyCopyState('done')
        setTimeout(() => {
          copy.textContent = '复制'
          applyCopyState('default')
        }, 1200)
      }
      const fail = () => {
        copy.textContent = '✗ 复制失败'
        applyCopyState('fail')
        setTimeout(() => {
          copy.textContent = '复制'
          applyCopyState('default')
        }, 1200)
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
          try {
            document.execCommand('copy') ? done() : fail()
          } catch {
            fail()
          } finally {
            ta.remove()
          }
        })
      } else {
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
  // 主题：themed style 写在最前面，让面板内容继承变量
  shadow.appendChild(buildThemedStyle())
  shadow.appendChild(buildExternalLinksPanel(links))

  markThemedHost(host)
  void applyPanelTheme(host)

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
    timer = setTimeout(() => {
      timer = null
      fn()
    }, waitMs)
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

  const observer = new MutationObserver(records => {
    if (
      records.some(r =>
        (r.target as HTMLElement | null)?.closest?.('tr[data-external-links-row="1"]'),
      )
    )
      return
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
