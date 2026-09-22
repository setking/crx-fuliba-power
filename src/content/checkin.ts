/**
 * 自动签到模块
 *
 * 入口：autoCheckin() —— 页面加载完成后调用
 * 出口：findCheckinBtn() —— 给 popup 触发即时签到复用
 *
 * 不依赖 Vue / DOM 副作用之外的全局状态（除 chrome.storage / console）
 */

// AUTO_CHECKIN_ENABLED_KEY / MESSAGE_TYPES / getLoginHint / isLoggedIn / hasCheckedInToday / isCheckinCompletedLabel / markCheckedInToday / shouldSkipAutoCheckin / ensureStorageReady / safeLocalGet 都在下方主体使用
import { MESSAGE_TYPES } from '@/global'
import { getLoginHint, isLoggedIn } from '@/utils/auth'
import { AUTO_CHECKIN_ENABLED_KEY, hasCheckedInToday, isCheckinCompletedLabel, markCheckedInToday, shouldSkipAutoCheckin } from '@/utils/checkin'
import { ensureStorageReady, safeLocalGet } from '@/utils/storage-init'

// 备选 ID（Discuz 不同版本/插件 ID 不一样，按顺序尝试）
const CHECKIN_BTN_IDS = ['fx_checkin_topb', 'fx_checkin', 'signin', 'checkin', 'hd_sign']

/**
 * 直接模拟点击签到按钮
 * 注意：fx_checkin 插件的 onclick 通常在签到成功后跳转到 fx_checkin:list 排行榜页，
 * 我们点击后 1s 内检测 location 变化，变了就 history.back() 回退。
 */
export function clickBtn(btn: HTMLElement): boolean {
  try {
    const urlBefore = location.href
    btn.click()

    // 异步检测跳转，1s 后若 URL 变化则回退
    setTimeout(() => {
      if (location.href !== urlBefore) {
        history.back()
      }
    }, 1000)

    return true
  }
  catch (e) {
    console.error('[checkin] click 失败:', e)
    return false
  }
}

/**
 * 在主文档 + 所有同源 iframe 里找签到按钮
 */
export function findCheckinBtn(): HTMLElement | null {
  // 1. 主文档
  for (const id of CHECKIN_BTN_IDS) {
    const el = document.getElementById(id)
    if (el) return el
  }

  // 2. 同源 iframe
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    try {
      const doc = frame.contentDocument
      if (!doc) continue
      for (const id of CHECKIN_BTN_IDS) {
        const el = doc.getElementById(id)
        if (el) return el as HTMLElement
      }
    }
    catch {
      // 跨域 iframe 访问会抛错，跳过
    }
  }

  return null
}

/** 检测签到按钮是否处于"已完成"状态 */
export function isAlreadyCheckedIn(btn: HTMLElement | null): boolean {
  if (!btn) return false
  return isCheckinCompletedLabel(getCheckinButtonLabel(btn))
}

function getCheckinButtonLabel(btn: HTMLElement): string {
  return `${btn.textContent ?? ''} ${btn.querySelector('img')?.getAttribute('alt') ?? ''}`
}

/** 轮询等待签到按钮出现 */
export async function waitForCheckinButton(timeout = 8000): Promise<HTMLElement | null> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const btn = findCheckinBtn()
    if (btn) return btn
    await new Promise(r => setTimeout(r, 300))
  }
  return null
}

/** popup 触发的即时签到 —— 不走 storage 标记，直接点击 */
export function triggerCheckin(): { ok: boolean, msg: string } {
  if (!isLoggedIn()) {
    return { ok: false, msg: getLoginHint() }
  }
  const btn = findCheckinBtn()
  if (!btn) {
    return { ok: false, msg: '未找到签到按钮' }
  }
  if (isAlreadyCheckedIn(btn)) {
    return { ok: false, msg: '今日已签到' }
  }
  const ok = clickBtn(btn)
  return { ok, msg: ok ? '签到已触发' : '点击失败' }
}

/** 自动签到主流程 */
export async function autoCheckin(): Promise<void> {
  // 等 storage 默认值补齐后再读取 autoCheckinEnabled —— 避免首次安装时读到 undefined 误判
  await ensureStorageReady()

  // safeLocalGet：content script 上下文偶发 "Access to storage is not allowed from this context"，
  // 失败返回 { autoCheckinEnabled: undefined } —— 不阻断后续读不到时的回退逻辑（默认 true）。
  const { [AUTO_CHECKIN_ENABLED_KEY]: autoCheckinEnabled } = await safeLocalGet(
    AUTO_CHECKIN_ENABLED_KEY,
    { [AUTO_CHECKIN_ENABLED_KEY]: true },
  )
  if (autoCheckinEnabled === false) return

  const host = location.hostname
  let btn = findCheckinBtn()
  const storedCheckin = await hasCheckedInToday(host)
  if (shouldSkipAutoCheckin(storedCheckin, btn ? getCheckinButtonLabel(btn) : null)) {
    if (btn && !storedCheckin) await markCheckedInToday(host)
    return
  }

  let loggedIn = isLoggedIn() || Boolean(btn)
  if (!loggedIn && !btn) {
    btn = await waitForCheckinButton(8000)
    loggedIn = isLoggedIn() || Boolean(btn)
  }
  if (!loggedIn && !btn) {
    console.warn('[checkin] 未登录，跳过签到')
    // 通知 popup（如果开着）
    try {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.NOT_LOGGED_IN, host, hint: getLoginHint() })
    }
    catch {}
    return
  }

  btn ??= await waitForCheckinButton(8000)
  if (!btn) {
    console.warn('[checkin] 等待签到按钮超时（8s），未自动签到')
    return
  }

  if (shouldSkipAutoCheckin(storedCheckin, getCheckinButtonLabel(btn))) {
    if (!storedCheckin) await markCheckedInToday(host)
    return
  }

  clickBtn(btn)
  await markCheckedInToday(host)
}
