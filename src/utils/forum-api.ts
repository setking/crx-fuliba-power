import { DEFAULT_PAGE_SIZE } from '../global.ts'
import type { Favorite, ForumCounts, ForumSearchPage, Friend, SearchResult, Thread } from '@/type'

/**
 * Discuz! 论坛数据抓取工具
 * 全部基于 Discuz 自家的 home.php 页面（登录态下 cookie 自动带入）
 */

function toCount(raw: string): number | null {
  const count = Number(raw.replace(/,/g, ''))
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}

function toPageSize(raw: string): number | null {
  const count = toCount(raw)
  return count && count > 0 ? count : null
}

const CURRENT_USER_LINK_SELECTORS = [
  '#um a[href*="home.php?mod=space&uid="]',
  '#um a[href*="space-uid-"]',
  '#mn_userinfo a[href*="home.php?mod=space&uid="]',
  '#mn_userinfo a[href*="space-uid-"]',
  '#umenu a[href*="home.php?mod=space&uid="]',
  '#umenu a[href*="space-uid-"]',
  '.user-info a[href*="home.php?mod=space&uid="]',
  '.user-info a[href*="space-uid-"]',
  '#user-info a[href*="home.php?mod=space&uid="]',
  '#user-info a[href*="space-uid-"]',
  '.userbox a[href*="home.php?mod=space&uid="]',
  '.userbox a[href*="space-uid-"]',
]

function uidFromHref(href: string): string | null {
  const standard = href.match(/[?&]uid=(\d+)/)
  if (standard) return standard[1]

  const short = href.match(/space-uid-(\d+)/)
  return short?.[1] ?? null
}

export function parsePageSizeFromHref(href: string): number | null {
  try {
    const url = new URL(href, 'https://fuliba.invalid')
    for (const key of ['perpage', 'pagesize', 'pageSize', 'tpp', 'ppp']) {
      const value = url.searchParams.get(key)
      if (value) {
        const pageSize = toPageSize(value)
        if (pageSize !== null) return pageSize
      }
    }
  }
  catch {
    return null
  }
  return null
}

export function parsePageSizeFromText(text: string): number | null {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const match = normalized.match(/(?:每页(?:显示|展示|包含)?|per\s*page|pagesize|page\s*size|perpage|tpp|ppp)\s*(?:[=:：]\s*)?([\d,]+)/i)
  return match ? toPageSize(match[1]) : null
}

/** 从 Discuz 常见的统计文本中提取数量。 */
export function parseForumCount(text: string): number | null {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return null

  const direct = normalized.match(/^([\d,]+)$/)
  if (direct) return toCount(direct[1])

  const suffix = normalized.match(/([\d,]+)\s*(?:个|条|篇|位)?\s*(?:主题|帖子|收藏|好友|记录|项目|结果)/i)
  if (suffix) return toCount(suffix[1])

  const foundResult = normalized.match(/(?:找到|搜索到)[^\d]{0,80}([\d,]+)\s*(?:个|条|篇|位|项)?/i)
  if (foundResult) return toCount(foundResult[1])

  const prefix = normalized.match(/(?:共有|共|总计|数量|主题|帖子|收藏|好友|记录|项目|搜索结果|搜索到|结果)[^\d]{0,12}([\d,]+)/i)
  if (prefix) return toCount(prefix[1])

  const parenthesized = normalized.match(/[（(]\s*([\d,]+)\s*[）)]/)
  return parenthesized ? toCount(parenthesized[1]) : null
}

/**
 * 从 Discuz 分页条提取总页数。
 * 典型 HTML：`<span title="共 2 页"> / 2 页</span>` 或纯文本 `共 2 页`。
 * 论坛三个列表页（帖子 / 收藏 / 好友）的 `.pg` 都会带这个文本，是 Discuz 模板通用约定。
 *
 * 注意：不能复用 `parseForumCount` —— "共 2 页" 也会被其"共 X"前缀规则命中并返回 2（页数），
 * 但调用方把它当总数 total 用 → total=2, pageSize=20, pageCount=1 → 分页条不显示。
 * 显式把语义拆开："共 X 页" → X 是页数，不是总数。
 */
export function parseForumPageCount(doc: Document, selectors: string[] = ['.pg']): number | null {
  for (const selector of selectors) {
    for (const el of Array.from(doc.querySelectorAll(selector))) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      // 1. 优先看 title 属性："共 2 页"
      const titleAttr = el.querySelector('[title*="共"]')?.getAttribute('title')
        ?? el.querySelector('[title*="页"]')?.getAttribute('title')
      if (titleAttr) {
        const m = titleAttr.match(/共\s*([\d,]+)\s*页/i)
        if (m) return toCount(m[1])
      }
      // 2. fallback：正文里的 "共 X 页" 或 "/ X 页"
      const m = text.match(/共\s*([\d,]+)\s*页/) ?? text.match(/\/\s*([\d,]+)\s*页/)
      if (m) return toCount(m[1])
    }
  }
  return null
}

function parseDocumentCount(doc: Document, selectors: string[]): number | null {
  for (const selector of selectors) {
    for (const element of Array.from(doc.querySelectorAll(selector))) {
      const count = parseForumCount(element.textContent ?? '')
      if (count !== null) return count
    }
  }
  return null
}

function countDocumentItems(doc: Document, selectors: string[]): number {
  for (const selector of selectors) {
    const count = doc.querySelectorAll(selector).length
    if (count > 0) return count
  }
  return 0
}

function parseDocumentPageSize(doc: Document, itemSelectors: string[]): number | null {
  // 用户在个人设置里改过每页数（论坛默认 tpp=20 改为 10）时，从 controls / href / 文本里
  // 解析到的 tpp 仍可能返回默认值 20，按它算 target 会让 ensureCached 多拉一页、
  // 而下一页其实已被首页塞完，于是触发「第 N 页返回 0 条」误报。
  // 但又不能用「实际 item 数」当 pageSize —— 末页不完整时 item 数 < 真实 pageSize，
  // 把它当 pageSize 会让后续 target 计算过小。
  // 策略：先尝试 controls（用户配置语义）→ href（链接里的 pageSize 参数）→ 文本里的「每页 N」
  // → 最后才 fallback 到 itemCount；itemCount 必须 ≥ 真实 pageSize 的"明显完整"启发式
  // （这里用 ≥ 10，因为论坛最小有效 pageSize 一般就是 10）才采用，否则视为末页不完整。
  const fromControls = readPageSizeFromControls(doc)
  if (fromControls !== null) return fromControls

  const fromHref = readPageSizeFromHrefs(doc)
  if (fromHref !== null) return fromHref

  const fromText = readPageSizeFromPageBar(doc)
  if (fromText !== null) return fromText

  const itemCount = countDocumentItems(doc, itemSelectors)
  if (itemCount >= 10) return itemCount

  return null
}

/** 从 perpage / pagesize / tpp / ppp 控件读出用户配置的每页条数 */
function readPageSizeFromControls(doc: Document): number | null {
  const controls = Array.from(doc.querySelectorAll(
    'input[name="perpage"], input[name="pagesize"], input[name="tpp"], input[name="ppp"], select[name="perpage"] option:checked, select[name="pagesize"] option:checked, select[name="tpp"] option:checked, select[name="ppp"] option:checked',
  ))
  for (const control of controls) {
    const value = control.getAttribute('value') ?? control.textContent ?? ''
    const pageSize = toPageSize(value)
    if (pageSize !== null) return pageSize
  }
  return null
}

/** 从分页链接的 href 里提取 pageSize 参数（perpage=20 / tpp=20 / pageSize=20 等） */
function readPageSizeFromHrefs(doc: Document): number | null {
  for (const link of Array.from(doc.querySelectorAll('a[href]'))) {
    const pageSize = parsePageSizeFromHref((link as HTMLAnchorElement).href)
    if (pageSize !== null) return pageSize
  }
  return null
}

/** 从分页条的文本里提取「每页 N 条」之类提示 —— 论坛模板偶尔会把 pageSize 直接渲染出来 */
function readPageSizeFromPageBar(doc: Document): number | null {
  for (const element of Array.from(doc.querySelectorAll('.pg, .bm_h, .tbmu'))) {
    const pageSize = parsePageSizeFromText(element.textContent ?? '')
    if (pageSize !== null) return pageSize
  }
  return null
}

/**
 * 从当前页面提取登录用户的 UID
 * 依据：Discuz 顶部导航会有"我的空间"链接
 */
export function getCurrentUid(): string | null {
  // 只从顶部用户菜单读取，避免帖子正文里的作者链接被误认为当前用户。
  for (const selector of CURRENT_USER_LINK_SELECTORS) {
    const link = document.querySelector(selector) as HTMLAnchorElement | null
    if (!link) continue
    const uid = uidFromHref(link.href || link.getAttribute('href') || '')
    if (uid) return uid
  }

  // 备选：从全局变量拿（少数模板注入）
  const w = window as unknown as { _discuz_uid?: string; discuz_uid?: string }
  if (w._discuz_uid) return w._discuz_uid
  if (w.discuz_uid) return w.discuz_uid

  // 兜底提示：UID 解析失败通常是 cookie 失效 / 论坛模板改了导航结构，
  // 保留一条简短 warn 方便排查（不打印候选链接列表以免污染 DevTools）。
  console.warn('[forum-api] 未找到 UID，可能未登录或论坛导航结构变了')
  return null
}

/**
 * 用 fetch + DOMParser 抓取页面 HTML
 */
async function fetchHtml(url: string): Promise<Document> {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
  const html = await res.text()
  return new DOMParser().parseFromString(html, 'text/html')
}

interface FetchedDocument {
  document: Document
  url: string
}

async function fetchDocument(url: string, init: RequestInit = {}): Promise<FetchedDocument> {
  const res = await fetch(url, { ...init, credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
  const html = await res.text()
  return {
    document: new DOMParser().parseFromString(html, 'text/html'),
    url: res.url || url,
  }
}

function textFromFirst(element: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const child = element.querySelector(selector)
    const text = child?.textContent?.trim() ?? ''
    if (text) return text
  }
  return ''
}

function elementFromFirst(element: Element, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const child = element.querySelector(selector)
    if (child) return child
  }
  return null
}

function hrefFromElement(element: Element): string {
  return (element as HTMLAnchorElement).href || element.getAttribute('href') || ''
}

function idFromThreadHref(href: string): string {
  try {
    const url = new URL(href, 'https://fuliba.invalid')
    const tid = url.searchParams.get('tid')
    if (tid) return tid
  }
  catch {
    // 继续尝试 Discuz SEO 链接格式。
  }
  return href.match(/thread-(\d+)(?:-|\/|$)/)?.[1] ?? ''
}

function dateFromText(text: string): string | undefined {
  const match = text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?/) 
  return match?.[0]
}

function labeledMetric(text: string, labels: string[]): string {
  if (!text) return ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  const labelPattern = labels.join('|')
  const beforeLabel = normalized.match(new RegExp(`([\\d,]+)\\s*(?:个|条|次|篇|位)?\\s*(?:${labelPattern})`, 'i'))
  if (beforeLabel) return beforeLabel[1]
  const afterLabel = normalized.match(new RegExp(`(?:${labelPattern})\\s*[:：]?\\s*((?![\\d,]+[-/]\\d)[\\d,]+)`, 'i'))
  return afterLabel?.[1] ?? ''
}

function searchIdFromHref(href: string): string | null {
  try {
    return new URL(href, 'https://fuliba.invalid').searchParams.get('searchid') || null
  }
  catch {
    return null
  }
}

function parseSearchResultRow(row: Element, responseUrl: string): SearchResult | null {
  const titleElement = elementFromFirst(row, ['h3.xs3 a', 'h3 a', 'a.xst', 'a[href*="forum.php?mod=viewthread"]'])
  const titleHref = titleElement ? hrefFromElement(titleElement) : hrefFromElement(row)
  if (!titleHref || !titleHref.includes('viewthread') && !titleHref.match(/thread-\d+/)) return null

  const url = new URL(titleHref, responseUrl).href
  const metadata = textFromFirst(row, ['.xg1', '.meta', '.search-meta'])
  const rowText = row.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const title = titleElement?.textContent?.trim() || row.textContent?.trim().split('\n')[0]?.trim() || ''
  const author = textFromFirst(row, [
    '.author a',
    '.by a',
    '.xg1 a',
    '[class*="author"] a',
    'a[href*="space-uid-"], a[href*="home.php?mod=space&uid="]',
  ])
    || labeledMetric(rowText, ['作者', 'author'])
  const replies = textFromFirst(row, ['.num a em, .num em', '.replies', '[class*="reply"]'])
    || labeledMetric(metadata, ['回复', 'replies'])
    || labeledMetric(rowText, ['回复', 'replies'])
  const views = textFromFirst(row, ['.views', '.view', '[class*="view"]'])
    || labeledMetric(metadata, ['查看', '浏览', 'views'])
    || labeledMetric(rowText, ['查看', '浏览', 'views'])
  const postTime = textFromFirst(row, ['.post-time', '.xg1 .time', 'time'])
    || dateFromText(metadata)
    || dateFromText(rowText)
  const category = textFromFirst(row, ['.category a', 'a[href*="forum-"]'])

  return {
    id: idFromThreadHref(url),
    title,
    url,
    author,
    replies,
    ...(views ? { views } : {}),
    ...(postTime ? { postTime } : {}),
    ...(category ? { category } : {}),
  }
}

export function parseForumSearchPage(doc: Document, responseUrl: string): ForumSearchPage {
  const rowSelector = 'li.pbw, .pbw li, div.pbw, .search-result'
  const titleSelector = '.slst li.pbw h3.xs3 a, .slst li.pbw a.xst, #threadlist h3.xs3 a, #threadlist a.xst'
  const itemSelectors = ['li.pbw', '.pbw li', 'div.pbw', '.search-result > li', '.search-result article']
  const rows = Array.from(doc.querySelectorAll(rowSelector))
  const items = rows
    .map(row => parseSearchResultRow(row, responseUrl))
    .filter((item): item is SearchResult => item !== null)

  if (items.length === 0) {
    for (const anchor of Array.from(doc.querySelectorAll(titleSelector))) {
      const item = parseSearchResultRow(anchor, responseUrl)
      if (item) items.push(item)
    }
  }

  const uniqueItems = Array.from(new Map(items.map(item => [item.url, item])).values())
  // .pg 不放进来：会误把"共 X 页"里的 X 当 total，导致 total=页数、pageCount=1、分页条不显示。
  // 页数单独走 parseForumPageCount 写到 pages 字段。
  const count = parseDocumentCount(doc, ['.sttl h2', '.search-info', '.bm_h h2', '.bm_h', '.tbmu'])
  const pages = parseForumPageCount(doc)
  const pageSize = parseDocumentPageSize(doc, itemSelectors) ?? (uniqueItems.length > 0 ? uniqueItems.length : null)
  const documentSearchId = doc.querySelector?.('input[name="searchid"]')?.getAttribute('value')
    || doc.querySelector?.('[data-searchid]')?.getAttribute('data-searchid')
  const searchId = searchIdFromHref(responseUrl)
    ?? Array.from(doc.querySelectorAll('a[href]'))
      .map(anchor => searchIdFromHref(hrefFromElement(anchor)))
      .find((value): value is string => value !== null)
    ?? documentSearchId
    ?? null

  return {
    items: uniqueItems,
    total: count,
    pageSize,
    pages,
    searchId,
  }
}

export function buildForumSearchUrl(host: string, keyword: string, page = 1, searchId: string | null = null): string {
  const origin = host.startsWith('http://') || host.startsWith('https://') ? host : `https://${host}`
  const url = new URL('/search.php', origin)
  url.searchParams.set('mod', 'forum')
  url.searchParams.set('orderby', 'lastpost')
  url.searchParams.set('ascdesc', 'desc')
  url.searchParams.set('searchsubmit', 'yes')
  url.searchParams.set('kw', keyword)
  if (page > 1) url.searchParams.set('page', String(page))
  if (searchId) url.searchParams.set('searchid', searchId)
  return url.href
}

export async function fetchForumSearch(keyword: string, page = 1, searchId: string | null = null): Promise<ForumSearchPage> {
  const normalizedKeyword = keyword.trim()
  if (!normalizedKeyword) throw new Error('搜索关键词不能为空')
  const isInitialSearch = page === 1 && !searchId
  const searchUrl = isInitialSearch
    ? `https://${location.host}/search.php?mod=forum`
    : buildForumSearchUrl(location.host, normalizedKeyword, page, searchId)
  let init: RequestInit | undefined
  if (isInitialSearch) {
    const formhashInput = document.querySelector('input[name="formhash"]') as HTMLInputElement | null
    const formData = new URLSearchParams()
    const formhash = formhashInput?.value.trim()
    if (formhash) formData.set('formhash', formhash)
    formData.set('srchtxt', normalizedKeyword)
    formData.set('searchsubmit', 'yes')
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    }
  }
  const result = await fetchDocument(searchUrl, init)
  return parseForumSearchPage(result.document, result.url)
}

/** 并行抓取三个统计页，只解析页面中的总数，不返回列表内容。
 * 帖子页 URL 在 detectThreadsPageShape 里决定（guide / space 任一能拿到 item 即可）。 */
export async function fetchMyCounts(uid: string): Promise<ForumCounts> {
  const [guideThreadsDoc, favoritesDoc, friendsDoc] = await Promise.all([
    fetchHtml(`https://${location.host}/forum.php?mod=guide&view=my&type=thread&page=1`),
    fetchHtml(`https://${location.host}/home.php?mod=space&uid=${uid}&do=favorite&type=all&page=1`),
    fetchHtml(`https://${location.host}/home.php?mod=space&uid=${uid}&do=friend`),
  ])

  // 把已经 fetch 的 guide 文档复用 —— 若 guide 解析为空，再 fetch space 文档。
  // 这样最多两次请求（与原版本一致），不引入额外 latency。
  const threadsShape = await resolveThreadsPageShape(uid, guideThreadsDoc)

  return {
    threads: {
      // 帖子页通常在 .tbmu 给出"X 个主题"等明确总数；.pg 只给页数（见 parseForumPageCount）
      total: parseDocumentCount(threadsShape.doc, threadsShape.totalSelectors),
      pageSize: parseDocumentPageSize(threadsShape.doc, threadsShape.itemSelectors) ?? DEFAULT_PAGE_SIZE,
      pages: parseForumPageCount(threadsShape.doc),
    },
    favorites: {
      // 收藏页 .tbmu 没有总数文本，只能从 .pg 的"共 X 页"反推
      total: parseDocumentCount(favoritesDoc, ['.bm_h h2', '.bm_h', '.tbmu']),
      pageSize: parseDocumentPageSize(favoritesDoc, ['#favorite_ul > li[id^="fav_"]']) ?? DEFAULT_PAGE_SIZE,
      pages: parseForumPageCount(favoritesDoc),
    },
    friends: {
      total: parseDocumentCount(friendsDoc, ['.tbmu p.y .xw1', '.tbmu', '.bm_h h2', '.bm_h']),
      pageSize: parseDocumentPageSize(friendsDoc, ['ul.buddy > li', 'ul.bml li', '.bm .mlist li', 'a[href*="home.php?mod=space&uid="]']) ?? DEFAULT_PAGE_SIZE,
      pages: parseForumPageCount(friendsDoc),
    },
  }
}

/** "我的帖子"页的 URL + DOM 选择器组合。
 * 返回 doc 是 fetchHtml 的结果；解析器用它直接拿 items / counts / pages。
 * 选了哪条 URL 由哪套模板先返回非空列表决定 —— 同一份数据两套 URL 任一能工作即可。 */
interface ThreadsPageShape {
  doc: Document
  itemSelectors: string[]
  totalSelectors: string[]
}

/** guide 模板（"我的→帖子"）的 item 选择器 + 总数兜底选择器。 */
function guideThreadsSelectors(): { itemSelectors: string[], totalSelectors: string[] } {
  return {
    itemSelectors: ['tbody[id^="normalthread_"]', 'a[href*="forum.php?mod=viewthread"]'],
    totalSelectors: ['.bm_h h2', '.bm_h', '.tbmu'],
  }
}

/** space 模板（"头像→主题"）的 item 选择器 + 总数兜底选择器。
 * DOM 结构：<div class="tl"><table><tr class="th">...</tr><tr>...</tr>...</table></div>
 * item 选择器跳过表头 tr —— 用 tr:not(.th)。 */
function spaceThreadsSelectors(): { itemSelectors: string[], totalSelectors: string[] } {
  return {
    itemSelectors: ['.tl table tr:not(.th)', 'a[href*="thread-"][href$="-1-1.html"]'],
    totalSelectors: ['.tbmu', '.bm_h h2', '.bm_h'],
  }
}

/** 复用传入的 guide 文档：先看 guide 模板能不能拿到 item；
 * 不能就 fetch space URL 重试。两次都失败 fallback 到 guide（保持旧解析路径不回归）。 */
async function resolveThreadsPageShape(
  uid: string,
  guideDoc: Document,
): Promise<ThreadsPageShape> {
  const guideSel = guideThreadsSelectors()
  if (countDocumentItems(guideDoc, guideSel.itemSelectors) > 0) {
    return { doc: guideDoc, ...guideSel }
  }

  const spaceDoc = await fetchHtml(
    `https://${location.host}/home.php?mod=space&uid=${uid}&do=thread&view=me&from=space&page=1`,
  )
  const spaceSel = spaceThreadsSelectors()
  if (countDocumentItems(spaceDoc, spaceSel.itemSelectors) > 0) {
    return { doc: spaceDoc, ...spaceSel }
  }

  return { doc: guideDoc, ...guideSel }
}

/**
 * "我的帖子"分页响应。guide 模板下 hasMore 始终 null（用 items 启发式 + 服务端 0 条断尾）；
 * space 模板下必须看 .pg .nxt 链接是否存在 —— space 模板不渲染页码数字，total / pages 都拿不到。
 */
export interface ThreadPageResult {
  items: Thread[]
  hasMore: boolean | null
}

/**
 * 抓取"我的帖子"
 *
 * 两个入口对应两套模板：
 *   - "我的→帖子" 菜单：guide&view=my&type=thread，DOM 用 tbody[id^="normalthread_"]
 *   - "头像→主题" 菜单：home.php?mod=space&do=thread&view=me，DOM 用 table > tr（非表头）
 *
 * 同一份数据两套 URL —— 双 URL fallback：哪个先拿到非空列表用哪个。
 * list 解析路径与 fetchMyCounts 的 pageSize/pages 路径必须用同一套模板，
 * 否则 pageSize=10 但 fetch 拿到 20 条（跨模板差异），翻页计算会偏。
 *
 * hasMore 语义：
 *   - guide 模板下：true=null（沿用 items 启发式 + 服务端 0 条断尾）
 *   - space 模板下：true=.pg 里存在 .nxt（下一页链接），false=没有
 */
export async function fetchMyThreads(uid: string, page = 1): Promise<ThreadPageResult> {
  // 先试 guide
  const guideDoc = await fetchHtml(
    `https://${location.host}/forum.php?mod=guide&view=my&type=thread&page=${page}`,
  )
  const guideThreads = parseGuideThreadsRows(guideDoc)
  if (guideThreads.length > 0) {
    return { items: guideThreads, hasMore: null }
  }

  // guide 拿不到 → 退回 space 模板
  const spaceDoc = await fetchHtml(
    `https://${location.host}/home.php?mod=space&uid=${uid}&do=thread&view=me&from=space&page=${page}`,
  )
  const spaceThreads = parseSpaceThreadsRows(spaceDoc)
  // space 模板的关键信号：.pg 里有没有 .nxt"下一页"链接。
  // 没有 = 服务器已经到最后一页（返回 200 + 空 .nxt，不报错）。
  const hasNextPage = !!spaceDoc.querySelector('.pg a.nxt')
  return { items: spaceThreads, hasMore: hasNextPage }
}

/** guide 模板（"我的→帖子"）：tbody[id^="normalthread_"] > a.xst + .author + .num */
function parseGuideThreadsRows(doc: Document): Thread[] {
  const rows = Array.from(doc.querySelectorAll('tbody[id^="normalthread_"]'))
  if (rows.length === 0) return []
  return rows.map((row) => {
    const titleEl = row.querySelector('a.xst') as HTMLAnchorElement | null
    return {
      id: row.id.replace('normalthread_', ''),
      title: titleEl?.textContent?.trim() ?? '',
      url: titleEl?.href ?? '',
      author: row.querySelector('.author cite a')?.textContent?.trim() ?? '',
      replies: row.querySelector('.num a em, .num em')?.textContent?.trim() ?? '',
    }
  })
}

/** space 模板（"头像→主题"）：.tl table tr:not(.th)
 *
 * 结构：
 *   <tr>
 *     <td class="icn"><a href="forum.php?mod=viewthread&tid=...">...</a></td>  // 折叠状态
 *     <th><a href="thread-XXX-1-1.html">标题</a></th>                           // 标题
 *     <td><a class="xg1">版块名</a></td>                                         // 版块
 *     <td class="num"><a class="xi2">19</a><em>1897</em></td>                  // 回复/查看
 *     <td class="by"><cite>作者</cite><em>时间</em></td>                         // 最后发帖
 *   </tr>
 */
function parseSpaceThreadsRows(doc: Document): Thread[] {
  const rows = Array.from(doc.querySelectorAll('.tl table tr:not(.th)'))
  if (rows.length === 0) return []
  return rows.map((row) => {
    // 标题链接：href 含 "thread-XXX-1-1.html"，跳过 .tps 里的分页链接
    const titleCandidates = Array.from(row.querySelectorAll('th a[href*="thread-"]'))
    const titleEl = titleCandidates.find((a) => {
      const href = (a as HTMLAnchorElement).href
      return /thread-\d+-\d+-\d+\.html/.test(href)
    }) as HTMLAnchorElement | undefined
    const href = titleEl?.href ?? ''
    // tid 从 href 提取：thread-XXX-1-1.html → XXX
    const idMatch = href.match(/thread-(\d+)-\d+-\d+\.html/)
    const authorEl = row.querySelector('.by cite a') as HTMLAnchorElement | null
    const repliesEl = row.querySelector('.num a.xi2')
    const viewsEl = row.querySelector('.num em')
    return {
      id: idMatch?.[1] ?? '',
      title: titleEl?.textContent?.trim() ?? '',
      url: href,
      author: authorEl?.textContent?.trim() ?? '',
      replies: repliesEl?.textContent?.trim() ?? '',
      views: viewsEl?.textContent?.trim() ?? '',
    }
  })
}

/**
 * 抓取"我的收藏"
 * URL: home.php?mod=space&uid={uid}&do=favorite&type=all[&page=N]
 *
 * 注意：**不**加 `view=me` —— Discuz 在 `view=me&page=N` 组合下会把路由切到"全部收藏"
 * handler，#favorite_ul 拿不到当前用户的收藏项（返回 0 条）。
 * 实测可用的 page=2 URL：`home.php?mod=space&uid=86019&do=favorite&type=all&page=2`
 * — 不带 view=me。对当前登录用户而言，`do=favorite&type=all` 默认就是"我的收藏"。
 */
export async function fetchMyFavorites(uid: string, page = 1): Promise<Favorite[]> {
  const url = `https://${location.host}/home.php?mod=space&uid=${uid}&do=favorite&type=all&page=${page}`
  const doc = await fetchHtml(url)

  // 收藏项：#favorite_ul > li[id^="fav_"]
  const items = Array.from(doc.querySelectorAll('#favorite_ul > li[id^="fav_"]'))

  return items.map((li) => {
    // 标题是 li 内 target="_blank" 的 a 链接（跳过"删除"按钮）
    const titleEl = Array.from(li.querySelectorAll('a[target="_blank"]'))[0] as HTMLAnchorElement | undefined
    const dateEl = li.querySelector('.xg1')
    return {
      title: titleEl?.textContent?.trim() ?? '',
      url: titleEl?.href ?? '',
      date: dateEl?.textContent?.trim(),
    }
  })
}

/**
 * 抓取"我的好友"
 * URL: home.php?mod=space&uid={uid}&do=friend
 */
export async function fetchMyFriends(uid: string, page = 1): Promise<Friend[]> {
  const url = `https://${location.host}/home.php?mod=space&uid=${uid}&do=friend&page=${page}`
  const doc = await fetchHtml(url)

  // 检查"当前共有 N 个好友"，N=0 时直接返回空
  const countEl = doc.querySelector('.tbmu p.y .xw1, .tbmu .xw1')
  if (countEl?.textContent?.trim() === '0') {
    return []
  }

  // Discuz 默认模板：<ul class="buddy cl"><li class="bbda cl">
  //   <div class="avt"><a href="space-uid-NNNN.html"><img src="...avatar.php?uid=NNNN..."></a></div>
  //   <h4><a href="space-uid-NNNN.html" title="真实用户名">显示名</a></h4>
  //   <p class="maxh">LV.X称号 &nbsp;积分数: NNN</p>
  // </li></ul>
  // 用户主页链接是相对路径（space-uid-NNNN.html），需要用 origin 拼成绝对 URL。
  const items = Array.from(doc.querySelectorAll('ul.buddy > li'))

  if (items.length > 0) {
    return items.map((li) => {
      // 优先用 avatar img 的 uid 参数 —— 兼容性最稳（即使 h4 链接被改 avatar 仍在）
      const avatar = li.querySelector('.avt img') as HTMLImageElement | null
      const m = avatar?.src?.match(/[?&]uid=(\d+)/)
      const uidStr = m?.[1] ?? ''
      // 名字：取 title 属性优先，避免 h4 内被加额外 span 干扰
      const nameEl = li.querySelector('h4 > a') as HTMLAnchorElement | null
      const name = nameEl?.getAttribute('title')?.trim() || nameEl?.textContent?.trim() || ''
      // profileUrl：avatar 父 <a> 或 h4 <a> 都指向同一页，取绝对 URL
      const profileLink = (li.querySelector('.avt a') as HTMLAnchorElement | null)
        ?? (li.querySelector('h4 > a') as HTMLAnchorElement | null)
      let profileUrl = ''
      if (profileLink?.href) {
        try {
          profileUrl = new URL(profileLink.getAttribute('href') ?? '', url).href
        }
        catch {
          profileUrl = profileLink.href
        }
      }
      return {
        uid: uidStr,
        name,
        avatar: avatar?.src ?? '',
        profileUrl,
      }
    })
  }

  // 退化方案：旧主题模板（ul.bml li / .bm .mlist li），里面套 <a href="home.php?mod=space&uid=xxx"><img>用户名</a>
  const oldItems = Array.from(doc.querySelectorAll('ul.bml li, .bm .mlist li'))
  if (oldItems.length > 0) {
    return oldItems.map((li) => {
      const link = li.querySelector('a[href*="uid="]') as HTMLAnchorElement | null
      const avatar = li.querySelector('img') as HTMLImageElement | null
      const m = link?.href.match(/uid=(\d+)/)
      return {
        uid: m?.[1] ?? '',
        name: link?.textContent?.trim() ?? '',
        avatar: avatar?.src ?? '',
        profileUrl: link?.href ?? '',
      }
    })
  }

  // 最后兜底：抓页面里所有指向 home.php?mod=space&uid= 的链接
  return Array.from(doc.querySelectorAll('a[href*="home.php?mod=space&uid="]'))
    .map((a) => {
      const link = a as HTMLAnchorElement
      const m = link.href.match(/uid=(\d+)/)
      return {
        uid: m?.[1] ?? '',
        name: link.textContent?.trim() ?? '',
        avatar: (link.querySelector('img') as HTMLImageElement | null)?.src ?? '',
        profileUrl: link.href,
      }
    })
}
