/**
 * 注入到论坛页的 Shadow DOM 面板（百家姓结果 / 外站链接）的主题色板。
 *
 * 为什么需要独立色板：
 *   Shadow DOM 默认隔绝外部 CSS 变量，<html data-theme="dark"> 在 light DOM 上设的变量
 *   穿透不到 ShadowRoot。所以面板要在自己的 ShadowRoot 里挂一份两套 CSS 变量
 *   （light / dark），用 [data-theme="dark"] 切换，再由 enableXxx() 入口监听论坛主题变化
 *   把 <html> 的当前主题写到 host.dataset.theme。
 *
 * 用法：
 *   const host = document.createElement('div')
 *   const shadow = host.attachShadow({ mode: 'open' })
 *   shadow.appendChild(buildThemedStyle())
 *   markThemedHost(host)            // 给 host 加 data-panel-themed，syncAllHosts 用它找到所有面板
 *   await applyPanelTheme(host)      // 同步当前主题 + 启动全局监听（首次调用才安装 listener）
 *   host.appendChild(...)            // 最后插入 DOM
 */

import { FORUM_THEME_KEY, readForumTheme } from '@/utils/theme'

/** light / dark 两套变量。ShadowRoot 内用 `--panel-*` 前缀避免与论坛页面变量冲突。 */
const LIGHT_VARS: Record<string, string> = {
  '--panel-bg': '#f9fafb',
  '--panel-surface': '#ffffff',
  '--panel-border': '#e5e7eb',
  '--panel-text': '#1f2937',
  '--panel-text-muted': '#6b7280',
  '--panel-link': '#2563eb',
  '--panel-accent': '#3b82f6',
  '--panel-accent-hover': '#2563eb',
  '--panel-accent-bg': '#eff6ff',
  '--panel-on-accent': '#ffffff',
  '--panel-success': '#059669',
  '--panel-success-bg': '#d1fae5',
  '--panel-danger': '#dc2626',
  '--panel-danger-bg': '#fee2e2',
  '--panel-success-border': '#10b981',
}

const DARK_VARS: Record<string, string> = {
  '--panel-bg': '#1f2937',
  '--panel-surface': '#111827',
  '--panel-border': '#374151',
  '--panel-text': '#e5e7eb',
  '--panel-text-muted': '#9ca3af',
  '--panel-link': '#60a5fa',
  '--panel-accent': '#60a5fa',
  '--panel-accent-hover': '#93c5fd',
  '--panel-accent-bg': '#1e3a8a',
  '--panel-on-accent': '#0b1220',
  '--panel-success': '#34d399',
  '--panel-success-bg': '#064e3b',
  '--panel-danger': '#f87171',
  '--panel-danger-bg': '#7f1d1d',
  '--panel-success-border': '#34d399',
}

/** 给 ShadowRoot 用的基础样式 —— 把变量写到 :host，外层用 [data-theme] 切换 */
export function buildThemedStyle(): HTMLStyleElement {
  const style = document.createElement('style')
  const lightDecl = Object.entries(LIGHT_VARS).map(([k, v]) => `  ${k}: ${v};`).join('\n')
  const darkDecl = Object.entries(DARK_VARS).map(([k, v]) => `  ${k}: ${v};`).join('\n')
  style.textContent = `
:host { ${lightDecl} }
:host([data-theme="dark"]) { ${darkDecl} }
`
  return style
}

/** 给 host 加标记。applyPanelTheme 启动后，全局监听会扫 [data-panel-themed] 同步所有面板。 */
export function markThemedHost(host: HTMLElement): void {
  host.dataset.panelThemed = '1'
}

/** 读 chrome.storage.local[FORUM_THEME_KEY]，fallback 到 readForumTheme()（论坛页直接探测） */
async function resolveForumTheme(): Promise<'dark' | 'light'> {
  try {
    const stored = await chrome.storage.local.get(FORUM_THEME_KEY)
    const v = stored[FORUM_THEME_KEY]
    if (v === 'dark' || v === 'light') return v
  }
  catch {
    /* storage 不可用 */
  }
  const raw = readForumTheme()
  if (raw === 'dark' || raw === 'light') return raw
  return 'light' // 兜底，避免首次黑屏
}

/** 把当前主题写到指定 host；首次调用时安装全局监听（论坛主题变化 → 所有 host.dataset.theme 跟着改）。
 *
 * 不重建 DOM —— 只是改 host 上的 data-theme 属性，CSS 变量自动切换。 */
let listenerInstalled = false

export async function applyPanelTheme(host: HTMLElement): Promise<void> {
  host.dataset.theme = await resolveForumTheme()
  if (listenerInstalled) return

  // 监听论坛页 <html> 主题属性变化 —— 立即同步到所有 host
  new MutationObserver(() => { void syncAllHosts() }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-dztheme', 'class'],
  })

  // 兜底：sidepanel 或其他 tab 写入 forumTheme 时也同步
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[FORUM_THEME_KEY]) return
    void syncAllHosts()
  })

  listenerInstalled = true
}

async function syncAllHosts(): Promise<void> {
  const theme = await resolveForumTheme()
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-panel-themed]'))) {
    if (el.dataset.theme !== theme) el.dataset.theme = theme
  }
}