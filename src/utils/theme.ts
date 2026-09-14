/**
 * Side Panel 主题适配的工具模块。
 *
 * 数据流：
 *   论坛页 (content script) ─探测 <html data-dztheme> + <html class="darking"> + localStorage['dzt-theme']─▶ chrome.storage.local[forumTheme]
 *                                                                              │
 *   sidepanel ◀──────── chrome.storage.onChanged ──────────────────────────────┘
 *
 * 侧边栏不再暴露手动开关 —— 完全跟随论坛主题。
 *
 * 详见 CLAUDE.md §6.7。
 */

import type { ForumTheme } from '@/type'

/** content 写入；sidepanel / popup 读。值为 `'dark' | 'light'`（已解析 auto）。 */
export const FORUM_THEME_KEY = 'forumTheme'

/** 从论坛页探测当前主题。'auto' / 无属性 / 隐私模式 都归为 'unknown'，由调用方决定如何落回。
 *
 * - 优先读 `<html data-dztheme>`：dux 主题把当前生效模式写到这（dark / light）；'auto' 状态
 *   不写或写 'auto'。
 * - 兜底读 `<html class>`：论坛（非 dux 主题）用 'darking' className 表示暗色模式
 *   （验证：切主题时 console.log(document.documentElement.className) 在 dark 下是 'darking'）。
 * - 最后读 `localStorage['dzt-theme']`：dux 主题持久化的偏好（含 'auto'），但我们只接受
 *   解析后的 'dark' / 'light'。 */
export function readForumTheme(): ForumTheme {
  // 源 1：dux 主题的 <html data-dztheme> 属性
  const attr = document.documentElement.getAttribute('data-dztheme')
  if (attr === 'dark' || attr === 'light') return attr

  // 源 2：<html class> —— 论坛用的是 'darking' className 表示暗色模式
  if (document.documentElement.classList.contains('darking')) return 'dark'

  // 源 3：dux 主题持久化的 localStorage['dzt-theme']
  try {
    const stored = localStorage.getItem('dzt-theme')
    if (stored === 'dark' || stored === 'light') return stored
  }
  catch {
    /* 隐私模式 localStorage 不可用 —— 返回 unknown */
  }

  return 'unknown'
}

/** 把 forumTheme + 系统主题合并成终值 dark / light。
 *
 * content script 在论坛页 context 调用此函数，把 auto 解析成 dark / light 写入 storage，
 * 这样 sidepanel 不需要再次访问 matchMedia（避免 sidepanel 与论坛 OS 主题不同步的歧义）。 */
export function resolveAutoTheme(): 'dark' | 'light' {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** forumTheme → 最终生效主题。unknown 落回 light（保证 sidepanel 首次打开不黑屏）。 */
export function effectiveTheme(forumTheme: ForumTheme): 'dark' | 'light' {
  return forumTheme === 'dark' ? 'dark' : 'light'
}