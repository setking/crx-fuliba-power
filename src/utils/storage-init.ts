/**
 * storage 配置初始化
 *
 * 设计意图：
 * - 长期不变的数据（用户偏好、配置、缓存） → chrome.storage.local
 * - 经常变化的 runtime 状态 → chrome.storage.session
 * - 第一次加载插件 / 每次进入论坛 / 打开 popup / sidepanel
 *   → 消费端 await ensureStorageReady()，保证后续读取拿到完整默认值后再提供服务
 *
 * 幂等：仅补缺失键，已存在的值不被覆盖（用户在使用过程中产生的真实状态保留）。
 * 抛错冒泡给调用方：调用方按需 try/catch 兜底（init 失败不应阻塞整个 UI 启动）。
 *
 * 为什么 defaults 表在本文件而非 global.ts：
 * global.ts 会被 manifest.config.ts 直接 import，而 manifest 在 vite.config 自身被打包时
 * 也会被 esbuild 拉进来。esbuild 解析 vite.config 时还看不到 resolve.alias，
 * 所以 global.ts 不能再去 import '@/utils/*' —— 否则 vite config 打包阶段直接报 UNRESOLVED_IMPORT。
 * defaults 表只和 ensureStorageReady() 配对使用，搬到本文件后所有依赖单向收敛到这里，
 * global.ts 也不再持有模块私有的 key 引用，符合 §3 "模块私有 key 留在本模块"。
 */

import { BJX_AUTO_PREVIEW_KEY, IMAGE_HISTORY_KEY, IMAGE_SESSION_UUID_KEY, FLOAT_BTN_HIDDEN_KEY } from '@/global'
import { AUTO_CHECKIN_ENABLED_KEY, LAST_CHECKIN_KEY } from '@/utils/checkin'
import { WHATSLINK_CACHE_KEY } from '@/utils/whatslink'

/** local 级 storage key 的默认值表 —— 长期不变的用户偏好 / 配置 / 缓存。
 * 消费端 await ensureStorageReady() 后，缺失键必有定义。
 * 注意：不用 `as const` —— 下方 ensureStorageReady() 仅消费 key 列表，不读字面量类型，
 * `as const` 会把 boolean 收窄成 `true`、反而让下游类型对不上 chrome.storage 的 `T | undefined`。 */
export const LOCAL_STORAGE_DEFAULTS = {
  [AUTO_CHECKIN_ENABLED_KEY]: true,
  [LAST_CHECKIN_KEY]: null,
  [WHATSLINK_CACHE_KEY]: {} as Record<string, unknown>,
  [IMAGE_HISTORY_KEY]: [] as unknown[],
  [BJX_AUTO_PREVIEW_KEY]: true,
} satisfies Record<string, unknown>

/** session 级 storage key 的默认值表 —— 经常变化的 runtime 状态。
 * 浏览器关掉自动清空、不跨会话持久化。 */
export const SESSION_STORAGE_DEFAULTS = {
  /** side panel 在开 = true；mount 路径写 true / 关闭路径写 false。
   * 默认 false：冷启浏览器时浮动按钮应显示。 */
  [FLOAT_BTN_HIDDEN_KEY]: false,
  /** 图床会话 uuid —— 浏览器会话级，每个会话重新分配，避免崩溃后 stale uuid。
   * 默认 ''：消费端 (loadSessionUuid) 已有 `typeof existing === 'string' && existing` 判断，
   * 空字符串走 createSessionUuid() 路径。 */
  [IMAGE_SESSION_UUID_KEY]: '',
} satisfies Record<string, unknown>

/** 幂等补齐 local + session 两套默认值表中缺失的键。
 * 同时跑一次 local→session 迁移：旧版本把 IMAGE_SESSION_UUID_KEY 写在 local，
 * 新版本迁到 session；如果 local 还有值而 session 没有，把它搬到 session 并清掉 local，
 * 避免旧用户首次升级后图床会话 uuid 静默重置。
 *
 * 自吞错：chrome.storage 在 content script 上下文偶发 "Access to storage is not allowed
 * from this context"（Chrome 内部状态未就绪，典型场景：扩展刚被唤醒的同一 task 里首次
 * 调 storage）。这是瞬时错误，下一次进入论坛自动恢复 —— 不应让它变成 Unhandled rejection
 * 飘到用户 console。消费端可以 await 本函数，但失败不阻塞后续读 storage（读不到默认值
 * 走 fallback 即可）。 */
export async function ensureStorageReady(): Promise<void> {
  const localKeys = Object.keys(LOCAL_STORAGE_DEFAULTS)
  const sessionKeys = Object.keys(SESSION_STORAGE_DEFAULTS)

  let localStored: Record<string, unknown> = {}
  let sessionStored: Record<string, unknown> = {}
  try {
    [localStored, sessionStored] = await Promise.all([
      chrome.storage.local.get(localKeys),
      chrome.storage.session.get(sessionKeys),
    ])
  }
  catch (err) {
    console.warn('[storage-init] 读取 storage 失败，跳过默认值补齐:', err)
    return
  }

  const localMissing: Record<string, unknown> = {}
  for (const key of localKeys) {
    if (!(key in localStored)) {
      localMissing[key] = LOCAL_STORAGE_DEFAULTS[key as keyof typeof LOCAL_STORAGE_DEFAULTS]
    }
  }
  const sessionMissing: Record<string, unknown> = {}
  for (const key of sessionKeys) {
    if (!(key in sessionStored)) {
      sessionMissing[key] = SESSION_STORAGE_DEFAULTS[key as keyof typeof SESSION_STORAGE_DEFAULTS]
    }
  }

  // local→session 迁移：imageHostSessionUuid 从 local 改到 session 后，
  // 老用户 local 里还有值但 session 是空的 —— 用 local 的值补 session，再清 local。
  const { [IMAGE_SESSION_UUID_KEY]: legacyUuid } = localStored
  if (typeof legacyUuid === 'string' && legacyUuid
    && !(IMAGE_SESSION_UUID_KEY in sessionStored)) {
    sessionMissing[IMAGE_SESSION_UUID_KEY] = legacyUuid
  }

  try {
    await Promise.all([
      Object.keys(localMissing).length > 0 ? chrome.storage.local.set(localMissing) : Promise.resolve(),
      Object.keys(sessionMissing).length > 0 ? chrome.storage.session.set(sessionMissing) : Promise.resolve(),
    ])
  }
  catch (err) {
    console.warn('[storage-init] 写入默认值失败（key 已存在或 storage 未就绪），下次进入论坛重试:', err)
    return
  }

  // 迁移完成后再清 local 里的旧 key —— 单独 remove 即可，不需要再读 storage
  if (typeof legacyUuid === 'string' && legacyUuid) {
    try {
      await chrome.storage.local.remove(IMAGE_SESSION_UUID_KEY)
    }
    catch (err) {
      console.warn('[storage-init] 清理旧 uuid 失败，下次进入论坛重试:', err)
    }
  }
}

/** chrome.storage 的"自吞错"封装。
 *
 * 为什么需要：chrome.storage 在 content script 上下文偶发 "Access to storage is not
 * allowed from this context"（Chrome 内部状态未就绪）。init 路径已有 try/catch；
 * 但模块入口里后续的直接 get/set 没有兜底 —— 抛出的 unhandled promise rejection
 * 会飘到 console。把这层 try/catch 收进 helper，调用方一行替换即可。
 *
 * 行为约定：
 * - safeLocalGet 返回空对象 / safeSessionGet 返回空对象 / safeSet / safeRemove 静默返回，
 *   调用方对 undefined 字段走 fallback 即可（与"读到默认值"语义对齐）。
 * - 失败仅 console.warn，不抛、不冒。
 */

/** 带默认值的 get —— keys 缺失或读取失败时返回 fallback。 */
async function safeGet<T extends Record<string, unknown>>(
  area: 'local' | 'session',
  keys: string | string[],
  fallback: T,
): Promise<T> {
  try {
    const got = await chrome.storage[area].get(keys)
    return { ...fallback, ...(got as Record<string, unknown>) }
  }
  catch (err) {
    console.warn(`[storage-init] chrome.storage.${area}.get 失败，返回 fallback:`, err)
    return fallback
  }
}

export async function safeLocalGet<T extends Record<string, unknown>>(
  keys: string | string[],
  fallback: T,
): Promise<T> {
  return safeGet('local', keys, fallback)
}

export async function safeSessionGet<T extends Record<string, unknown>>(
  keys: string | string[],
  fallback: T,
): Promise<T> {
  return safeGet('session', keys, fallback)
}

export async function safeLocalSet(items: Record<string, unknown>): Promise<void> {
  try {
    await chrome.storage.local.set(items)
  }
  catch (err) {
    console.warn('[storage-init] chrome.storage.local.set 失败:', err)
  }
}

export async function safeSessionSet(items: Record<string, unknown>): Promise<void> {
  try {
    await chrome.storage.session.set(items)
  }
  catch (err) {
    console.warn('[storage-init] chrome.storage.session.set 失败:', err)
  }
}

export async function safeLocalRemove(key: string): Promise<void> {
  try {
    await chrome.storage.local.remove(key)
  }
  catch (err) {
    console.warn(`[storage-init] chrome.storage.local.remove(${key}) 失败:`, err)
  }
}