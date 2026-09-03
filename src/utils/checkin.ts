/**
 * 自动签到相关的小工具
 */

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
  const { lastCheckin } = await chrome.storage.local.get('lastCheckin')
  const today = getLocalDateKey()
  return (
    (lastCheckin as LastCheckin | undefined)?.host === host
    && (lastCheckin as LastCheckin | undefined)?.date === today
  )
}

/**
 * 记录今天已签到。
 */
export async function markCheckedInToday(host: string): Promise<void> {
  await chrome.storage.local.set({
    lastCheckin: {
      host,
      date: getLocalDateKey(),
    } satisfies LastCheckin,
  })
}
