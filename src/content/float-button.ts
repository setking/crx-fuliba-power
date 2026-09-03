/**
 * 浮动按钮模块
 *
 * 在 `isFloatButtonSite()` 返回 true 的页面右下角挂一个可拖拽按钮：
 * - 点击 → 通知 background 打开 Side Panel
 * - 拖拽 → 持久化位置到 chrome.storage.local
 *
 * 入口：mountFloatButton() —— 在白名单站点页面加载完成后调用
 */

import { MESSAGE_TYPES } from '@/global'

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
