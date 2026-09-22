/**
 * 浮动按钮模块
 *
 * 在 `isFloatButtonSite()` 返回 true 的页面右下角挂一个可拖拽按钮：
 * - 点击 → 通知 background 打开 Side Panel
 * - 拖拽 → 持久化位置到 chrome.storage.local
 *
 * 入口：mountFloatButton() —— 在白名单站点页面加载完成后调用
 */

// FLOAT_BTN_HIDDEN_KEY / MESSAGE_TYPES / ensureStorageReady / safeSessionGet 都在下方主体使用
import { FLOAT_BTN_HIDDEN_KEY, MESSAGE_TYPES } from '@/global'
import { ensureStorageReady, safeSessionGet } from '@/utils/storage-init'

const FLOAT_BTN_POSITION_KEY = 'floatBtnPosition'
const DRAG_THRESHOLD = 5 // 移动超过 5px 才算拖拽

interface BtnPosition {
  right: number
  bottom: number
}

async function loadBtnPosition(): Promise<BtnPosition | null> {
  const stored = await chrome.storage.local.get(FLOAT_BTN_POSITION_KEY)
  return (stored[FLOAT_BTN_POSITION_KEY] as BtnPosition | undefined) ?? null
}

async function saveBtnPosition(pos: BtnPosition): Promise<void> {
  await chrome.storage.local.set({ [FLOAT_BTN_POSITION_KEY]: pos })
}

function applyPosition(btn: HTMLElement, pos: BtnPosition | null): void {
  btn.style.right = `${pos?.right ?? 16}px`
  btn.style.bottom = `${pos?.bottom ?? 16}px`
}

/** 通知 background 打开 Side Panel（best-effort，失败不抛错） */
export async function openSidePanel(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.OPEN_SIDE_PANEL })
  }
  catch (err) {
    console.warn('[float-btn] 转发打开侧边栏失败:', err)
  }
}

/**
 * 按钮样式直接写到元素的 inline style 上（不进 <style> 元素）。
 * 原因：Discuz 论坛的脚本会清理/重写 <head> 里的 <style>，但不会剥元素的 inline style。
 */
const FLOAT_BTN_BASE_CSS = [
  'position: fixed',
  'right: 16px',
  'bottom: 16px',
  'width: 48px',
  'height: 48px',
  'border-radius: 50%',
  'background: #3b82f6',
  'color: white',
  'font-size: 22px',
  'border: none',
  'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2)',
  'cursor: grab',
  'z-index: 2147483647',
  'transition: transform 150ms, background 150ms',
  'user-select: none',
  '-webkit-user-select: none',
  'touch-action: none',
  'padding: 0',
  'line-height: 48px',
  'text-align: center',
].join('; ')

export async function mountFloatButton(): Promise<void> {
  // 等 storage 默认值补齐后再读取 session[FLOAT_BTN_HIDDEN_KEY]，避免冷启时读到 undefined 误判为隐藏
  await ensureStorageReady()

  // 清理任何遗留的旧按钮（HMR / 重新注入会再次执行）
  document.querySelectorAll('#crxjs-float-btn').forEach(el => el.remove())

  const btn = document.createElement('button')
  btn.id = 'crxjs-float-btn'
  btn.title = ''
  btn.setAttribute('aria-label', '论坛助手浮动按钮')
  btn.innerHTML = '🔖'
  btn.style.cssText = FLOAT_BTN_BASE_CSS

  const saved = await loadBtnPosition()
  applyPosition(btn, saved)

  // 启动时同步 side panel 状态：side panel 在另一 tab 开着 / 用户刚关扩展重开时
  // storage 里可能已有 true，避免按钮挡住一个看不见的 side panel。
  // 用 chrome.storage.session 而非 local —— 浏览器关掉自动清空，避免崩溃 / 强杀进程后
  // 残留 stale 值导致冷启按钮被错误隐藏。
  //
  // 关键：listener 必须先注册、再读初始值。
  // 否则会有竞态窗口 —— read 拿到 true → 隐藏按钮，紧接着另一侧 panel 关闭写入
  // false（hidden: true→false），onChanged 触发，但 listener 还没注册 → 按钮永久
  // 停留在 display:none，即使 storage 里已经是 false 也无法恢复显示。
  // 先注册 listener 后再 read 即可：若 read 期间值变了，listener 能覆盖初始设置的状态。
  const applyHidden = (hidden: boolean) => {
    btn.style.display = hidden ? 'none' : ''
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !(FLOAT_BTN_HIDDEN_KEY in changes)) return
    // listener 内查询 DOM —— 应对 SPA 导航 / 重新注入的场景：同一会话内可能被
    // 多次 mount，每次都创建新 btn + 新 listener。旧 listener 仍持有旧 btn 引用
    // （旧 btn 已从 DOM 移除，无视觉效果），但用 querySelector 也能稳定拿到当前 btn。
    const cur = document.getElementById('crxjs-float-btn')
    if (!cur) return
    // newValue 可能是 true / false / undefined（key 被删如 session 清空）：
    // 只有严格等于 true 才隐藏，其余（false / undefined）一律显示。
    const hidden = changes[FLOAT_BTN_HIDDEN_KEY].newValue === true
    cur.style.display = hidden ? 'none' : ''
  })

  // safeSessionGet：content script 上下文偶发 "Access to storage is not allowed from this context"，
  // 失败返回 { floatBtnHidden: undefined } —— applyHidden 会按"未隐藏"显示按钮。
  const hiddenInitial = await safeSessionGet(
    FLOAT_BTN_HIDDEN_KEY,
    { [FLOAT_BTN_HIDDEN_KEY]: false },
  )
  applyHidden(hiddenInitial[FLOAT_BTN_HIDDEN_KEY] === true)

  // 拖拽状态
  let dragging = false
  let dragMoved = false
  let startX = 0
  let startY = 0
  let startRight = 0
  let startBottom = 0

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return // 只响应左键
    dragging = true
    dragMoved = false
    startX = e.clientX
    startY = e.clientY
    const rect = btn.getBoundingClientRect()
    startRight = window.innerWidth - rect.right
    startBottom = window.innerHeight - rect.bottom
    btn.style.transition = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    e.preventDefault()
  }

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragMoved = true
    const newRight = Math.max(0, Math.min(window.innerWidth - 48, startRight - dx))
    const newBottom = Math.max(0, Math.min(window.innerHeight - 48, startBottom - dy))
    btn.style.right = `${newRight}px`
    btn.style.bottom = `${newBottom}px`
  }

  const onMouseUp = () => {
    if (!dragging) return
    dragging = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    btn.style.transition = ''

    if (dragMoved) {
      const right = parseInt(btn.style.right, 10) || 16
      const bottom = parseInt(btn.style.bottom, 10) || 16
      void saveBtnPosition({ right, bottom })
    }
    else {
      void openSidePanel()
    }
  }

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    dragging = true
    dragMoved = false
    startX = t.clientX
    startY = t.clientY
    const rect = btn.getBoundingClientRect()
    startRight = window.innerWidth - rect.right
    startBottom = window.innerHeight - rect.bottom
    btn.style.transition = 'none'
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd)
  }

  const onTouchMove = (e: TouchEvent) => {
    if (!dragging) return
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragMoved = true
    const newRight = Math.max(0, Math.min(window.innerWidth - 48, startRight - dx))
    const newBottom = Math.max(0, Math.min(window.innerHeight - 48, startBottom - dy))
    btn.style.right = `${newRight}px`
    btn.style.bottom = `${newBottom}px`
    e.preventDefault()
  }

  const onTouchEnd = () => {
    if (!dragging) return
    dragging = false
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('touchend', onTouchEnd)
    btn.style.transition = ''

    if (dragMoved) {
      const right = parseInt(btn.style.right, 10) || 16
      const bottom = parseInt(btn.style.bottom, 10) || 16
      void saveBtnPosition({ right, bottom })
    }
    else {
      void openSidePanel()
    }
  }

  btn.addEventListener('mousedown', onMouseDown)
  btn.addEventListener('touchstart', onTouchStart, { passive: true })

  document.body.appendChild(btn)
}
