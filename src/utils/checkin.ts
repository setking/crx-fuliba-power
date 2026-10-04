/**
 * 自动签到相关的小工具
 */

/** chrome.storage.local key：自动签到开关。true = 进论坛自动尝试签到；false = 只在 popup 手动触发。
 * 属于本模块（utils/checkin）的私有 key，与 popup 共享 —— popup 与 content/checkin.ts 都从这里 import。
 * utils/storage-init.ts 也 import 以补齐默认值表。 */
export const AUTO_CHECKIN_ENABLED_KEY = 'autoCheckinEnabled'

/** chrome.storage.local key：上次签到记录。值是 LastCheckin | null。
 * popup 用它显示"上次签到日期"；本模块的 hasCheckedInToday / markCheckedInToday 用它判断今日是否签过。 */
export const LAST_CHECKIN_KEY = 'lastCheckin'

interface LastCheckin {
  host: string
  date: string // YYYY-MM-DD
}

/** 使用浏览器本地日期，避免 UTC 日期在东八区凌晨仍停留在前一天。 */
export function getLocalDateKey(
  date: Pick<Date, 'getFullYear' | 'getMonth' | 'getDate'> = new Date(),
): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isCheckinCompletedLabel(value: string): boolean {
  const normalized = value.replace(/\s+/g, '')
  if (!normalized || normalized.includes('签到领奖')) return false
  return /已签到|签到成功|签到完成|已领取|已完成|alreadycheckedin|claimed|completed/i.test(normalized)
}

export function shouldSkipAutoCheckin(hasStoredCheckin: boolean, buttonLabel: string | null): boolean {
  if (buttonLabel !== null) return isCheckinCompletedLabel(buttonLabel)
  return hasStoredCheckin
}

/**
 * 判断今天是否已经签过到（用站点 hostname 作为 key）。
 * 跨日期则视为没签。
 */
export async function hasCheckedInToday(host: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(LAST_CHECKIN_KEY)
  const lastCheckin = stored[LAST_CHECKIN_KEY] as LastCheckin | undefined
  const today = getLocalDateKey()
  return lastCheckin?.host === host && lastCheckin?.date === today
}

/**
 * 记录今天已签到。
 */
export async function markCheckedInToday(host: string): Promise<void> {
  await chrome.storage.local.set({
    [LAST_CHECKIN_KEY]: {
      host,
      date: getLocalDateKey(),
    } satisfies LastCheckin,
  })
}
