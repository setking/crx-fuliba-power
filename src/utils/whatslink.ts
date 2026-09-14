/**
 * whatslink.info 磁链元数据查询 + chrome.storage.local 缓存
 *
 * API: https://www.whatslink.info/api/v1/link?url=<magnet>
 *  - 必须用 www 子域；裸 whatslink.info 返回 500
 *  - Access-Control-Allow-Origin: *，Chrome 扩展可直接 fetch
 *  - Cloudflare 缓存 4h（max-age=14400）
 *  - 响应字段: { type, file_type, name, size, count, screenshots[], error }
 *  - 无效 hash → type: "UNKNOWN", screenshots: null（仍是 HTTP 200）
 */

import type { WhatslinkInfo } from '@/type'

const API = 'https://www.whatslink.info/api/v1/link?url='
const CACHE_KEY = 'whatslinkCache'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX = 100
const TIMEOUT_MS = 8000

/** 缓存条目：hash → info */
type CacheMap = Record<string, WhatslinkInfo>

/** 从 magnet 抽 32–40 字符 hex 作为缓存 key（同一资源不同 tracker 共享缓存） */
function magnetKey(magnet: string): string {
  const m = magnet.match(/xt=urn:btih:([a-fA-F0-9]+)/)
  return m ? m[1].toLowerCase() : magnet
}

/** LRU 修剪：超过 CACHE_MAX 按 cachedAt 升序淘汰最早的 */
function pruneCache(cache: CacheMap): CacheMap {
  const keys = Object.keys(cache)
  if (keys.length <= CACHE_MAX) return cache
  keys.sort((a, b) => cache[a].cachedAt - cache[b].cachedAt)
  const drop = keys.slice(0, keys.length - CACHE_MAX)
  for (const k of drop) delete cache[k]
  return cache
}

async function readCache(): Promise<CacheMap> {
  const result = await chrome.storage.local.get([CACHE_KEY])
  return (result[CACHE_KEY] as CacheMap | undefined) ?? {}
}

async function writeCache(cache: CacheMap): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: pruneCache(cache) })
}

/** 把 whatslink 原始 JSON 归一化为 WhatslinkInfo */
function parseResponse(data: unknown): WhatslinkInfo {
  const obj = (typeof data === 'object' && data !== null) ? data as Record<string, unknown> : {}
  const type = typeof obj.type === 'string' ? obj.type : 'UNKNOWN'
  const screenshots = Array.isArray(obj.screenshots)
    ? (obj.screenshots.filter((s): s is string => typeof s === 'string'))
    : []
  return {
    found: type !== 'UNKNOWN',
    name: typeof obj.name === 'string' ? obj.name : '',
    size: typeof obj.size === 'number' ? obj.size : 0,
    fileType: typeof obj.file_type === 'string' ? obj.file_type : '',
    count: typeof obj.count === 'number' ? obj.count : 0,
    screenshots,
    cachedAt: Date.now(),
  }
}

/**
 * 查询磁链元数据。先查本地缓存（24h 有效），未命中走 fetch。
 * 任何网络 / 解析错误统一抛 Error，由调用方处理状态机。
 */
export async function fetchWhatslinkInfo(magnet: string): Promise<WhatslinkInfo> {
  const key = magnetKey(magnet)
  const cache = await readCache()
  const hit = cache[key]
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) {
    return hit
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(API + encodeURIComponent(magnet), { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: unknown = await res.json()
    const info = parseResponse(data)
    cache[key] = info
    await writeCache(cache)
    return info
  }
  finally {
    clearTimeout(timer)
  }
}

/** 字节数 → 可读字符串（B/KB/MB/GB/TB） */
export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '未知'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(2)} ${units[i]}`
}

/**
 * 把 hash + name + size 拼成 magnet 链接，便于用户复制到 qBittorrent 时
 * 自动带 dn（标题预填）和 xl（大小提示）。不拼 tracker —— tracker 由用户
 * 自行选择（不同站点 / 不同网络环境合适的不一样）。
 *
 * 拼接前对 name 做 percent-encoding；size > 0 才追加 xl。
 * 找不到 hash 时原样返回 magnet（或空串）。
 */
export function buildFullMagnet(magnet: string, name: string, size: number): string {
  const hashMatch = magnet.match(/xt=urn:btih:([a-fA-F0-9]+)/i)
  if (!hashMatch) return magnet
  const hash = hashMatch[1].toLowerCase()
  const params: string[] = []
  if (name) params.push(`dn=${encodeURIComponent(name)}`)
  if (size > 0) params.push(`xl=${size}`)
  const suffix = params.length > 0 ? `&${params.join('&')}` : ''
  return `magnet:?xt=urn:btih:${hash}${suffix}`
}
