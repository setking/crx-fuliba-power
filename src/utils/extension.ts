/**
 * 扩展运行时工具 —— 跨 side panel / popup / content 复用的 Chrome API 封装
 *
 * 内容：
 * - getActiveTab: 查询当前激活 tab
 * - fetchViaContent: 通过 chrome.tabs.sendMessage 让 content 在页面 context 抓数据（自动带 cookie，规避 CORS）
 */

/** 当前窗口里激活的 tab（chrome.tabs.query active:true currentWindow:true），没有时返回 undefined */
export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

/**
 * 通用：通过消息让 content 抓数据。
 *
 * content 在页面 context 里 fetch，自动带 cookie，无 CORS 问题。
 * 服务器返回 { ok:false, error } 时直接抛错；否则返回 res.data。
 */
export async function fetchViaContent<T>(
  tabId: number,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const res = await chrome.tabs.sendMessage(tabId, { type, ...payload })
  if (!res?.ok) throw new Error(res?.error ?? '请求失败')
  return res.data as T
}
