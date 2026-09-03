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
 */
export function targetItemsForPage(page: number, count: ForumCount | null): number {
  const normalizedPage = Math.max(1, page)
  return Math.min(count?.total ?? normalizedPage * DEFAULT_PAGE_SIZE, normalizedPage * DEFAULT_PAGE_SIZE)
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
