import type { ForumCount, SearchResult } from '@/type'
import { DEFAULT_PAGE_SIZE } from '../global.ts'

/**
 * 通用列表缓存：按页拉取，按需补齐，已知「实际分页大小」时合并计算总页数
 *
 * - `items` 已加载的项目（顺序追加）
 * - `nextRequestPage` 下一轮要请求的页码（服务端 1-based）
 * - `firstBatchSize` 第一次返回的条数（用于推断 pageSize，可能为 null）
 * - `reachedEnd` 服务端已无更多数据
 */
export interface RequestCache<T> {
  items: T[]
  nextRequestPage: number
  firstBatchSize: number | null
  reachedEnd: boolean
}

export function createRequestCache<T>(): RequestCache<T> {
  return {
    items: [],
    nextRequestPage: 1,
    firstBatchSize: null,
    reachedEnd: false,
  }
}

/**
 * 搜索专用缓存：在通用缓存基础上多带 keyword / searchId
 * searchId 由首响返回；后续分页带回去，服务器才能延续上下文
 */
export interface SearchRequestCache extends RequestCache<SearchResult> {
  keyword: string
  searchId: string | null
}

export function createSearchRequestCache(keyword = ''): SearchRequestCache {
  return {
    ...createRequestCache<SearchResult>(),
    keyword,
    searchId: null,
  }
}

/** 给定 items + 当前页，返回本页展示的内容（已切片） */
export function itemsForDisplayPage<T>(items: T[], page: number): T[] {
  const start = (Math.max(1, page) - 1) * DEFAULT_PAGE_SIZE
  return items.slice(start, start + DEFAULT_PAGE_SIZE)
}

/**
 * 目标页需要的累计 items 数：
 * - 有 total：取 total / page*pageSize 较小者（已到底）
 * - 无 total：page * pageSize（按默认分页大小估）
 *
 * 注：v1.0.10 起回归 on-demand —— 只确保「目标页」所需条数到齐，不再无脑把所有页
 * 一次性拉完。原因：pre-pull 策略假设每页都稳定返回 ~pageSize 条，但 Discuz 列表页
 * 偶发会出现 page=2 返回 0 条的情况（cookies / 缓存 / URL 参数顺序等不明原因），
 * pre-pull 会把 reachedEnd=true 永久写下，导致后续翻页再也拉不到数据。
 * on-demand 每次只取当前页 + 已缓存的前序页，失败就报错让用户刷新，单页失败不污染
 * 整条 cache。
 */
export function targetItemsForPage(page: number, count: ForumCount | null): number {
  const normalizedPage = Math.max(1, page)
  // 仅按已知页数 *pageSize 推 target，避免无 total 时拉过头。
  // 之前是 pages*pageSize 兜底 → pre-pull 全部页；现在回归 page*pageSize。
  const total = count?.total ?? null
  const requiredForPage = normalizedPage * DEFAULT_PAGE_SIZE
  if (total === null) return requiredForPage
  return Math.min(total, requiredForPage)
}

export function getPageCount(total: number | null, pageSize = DEFAULT_PAGE_SIZE): number {
  if (total == null || total <= 0 || pageSize <= 0) return 1
  return Math.max(1, Math.ceil(total / pageSize))
}

/** ForumCount 便捷重载：count.total 可能为 null（未拉到 total 时） */
export function getPageCountFromCount(count: ForumCount | null, pageSize = DEFAULT_PAGE_SIZE): number {
  return getPageCount(count?.total ?? null, pageSize)
}

export function getRequestPageCount(itemsNeeded: number, batchSize: number): number {
  if (itemsNeeded <= 0) return 0
  if (batchSize <= 0) return 1
  return Math.ceil(itemsNeeded / batchSize)
}

export function normalizePage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, page), Math.max(1, pageCount))
}
