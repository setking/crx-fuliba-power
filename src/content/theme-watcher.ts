/**
 * 论坛页主题探测 + 广播
 *
 * 职责：把论坛当前主题写入 `chrome.storage.local[forumTheme]`。
 *
 * 探测源：
 *   1. `<html data-dztheme>` 属性（dux 主题切换时直接更新）
 *   2. `localStorage['dzt-theme']` 兜底（属性缺失 / 隐私模式）
 *
 * 广播触发：
 *   - MutationObserver 监听 `<html>` 的 `data-dztheme` 变化（同 tab 内切换）
 *   - `window.addEventListener('storage', ...)` 监听其他 tab 切换（同一浏览器内多 tab 同步）
 *   - `matchMedia('(prefers-color-scheme: dark)')` change 监听（auto 模式时 OS 主题变了也算）
 *
 * `auto` 模式由本模块在 content context 内通过 `matchMedia` 解析成 `'dark' | 'light'`，
 * 这样 sidepanel 永远只读已落地的终值，避免 sidepanel 与论坛 tab OS 主题不同步的歧义。
 * 详见 CLAUDE.md §6.7。
 */

import { FORUM_THEME_KEY, readForumTheme, resolveAutoTheme } from '@/utils/theme'

/** 把当前主题写入 chrome.storage.local。'unknown' 不写（让 sidepanel 保持上次值）。 */
async function broadcast(): Promise<void> {
  const raw = readForumTheme()
  const resolved: 'dark' | 'light' = (raw === 'dark' || raw === 'light') ? raw : resolveAutoTheme()
  await chrome.storage.local.set({ [FORUM_THEME_KEY]: resolved })
}

/** 启动主题监听器；启动时立即广播一次。 */
export async function enableForumThemeWatcher(): Promise<void> {
  await broadcast()

  // 1. 同 tab 切换：dux 主题切完后会改 `<html data-dztheme>`，MutationObserver 抓住
  const attrObserver = new MutationObserver(() => { void broadcast() })
  attrObserver.observe(document.documentElement, {
    attributes: true,
    // 论坛用的是切 <html class> 里的 'darking'，dux 才用 data-dztheme；都监听
    attributeFilter: ['data-dztheme', 'class'],
  })

  // 2. 跨 tab 同步：用户在另一个 tab 切换主题时，localStorage 会派 storage 事件
  window.addEventListener('storage', (e) => {
    if (e.key === 'dzt-theme') void broadcast()
  })

  // 3. 系统主题变化：auto 模式下依赖 OS 主题，必须监听
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    void broadcast()
  })
}