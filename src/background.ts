import { FLOAT_BUTTON_HOSTS, MESSAGE_TYPES, UPLOAD_HOST } from './global'

const ENABLED_HOSTS = new Set<string>(FLOAT_BUTTON_HOSTS)

/** Service worker 可能在异步等待期间被回收 —— 用 chrome.alarms 周期性唤醒保证 forwardUploadImage 不被中断。
 * 必须声明 'alarms' 权限（已在 manifest.config.ts）。 */
const UPLOAD_KEEPALIVE_ALARM = 'upload-keepalive'
const KEEPALIVE_PERIOD_MIN = 0.2 // ~12s

function isEnabledSite(url?: string) {
  if (!url) return false
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && ENABLED_HOSTS.has(hostname)
  }
  catch {
    return false
  }
}

async function updateSidePanel(tabId: number, url?: string) {
  const enabled = isEnabledSite(url)
  await chrome.sidePanel.setOptions({ tabId, path: 'src/sidepanel/index.html', enabled })
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId)
    await updateSidePanel(tabId, tab.url)
  }
  catch (err) {
    console.error('[background] tab 切换处理失败:', err)
  }
})

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return
  try {
    await updateSidePanel(tabId, changeInfo.url)
  }
  catch (err) {
    console.error('[background] URL 更新处理失败:', err)
  }
})

// ============ 上传转发 ============

/** 在所有 tab 里找一个当前在图床域的 tab */
async function findUploadTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ url: `https://${UPLOAD_HOST}/*` })
  return tabs[0]?.id ?? null
}

/** 等 tab 页面完成加载（一次性 onUpdated 事件，避免 setTimeout 轮询）。
 * 已有现成 tab 时：可能早就是 complete，立即 resolve。 */
function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs)
    const onUpdated = (changedTabId: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (changedTabId === tabId && info.status === 'complete') {
        clearTimeout(t)
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    // 双重保险：tab 可能已经 complete —— 再 query 一次
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        clearTimeout(t)
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    }).catch(() => {})
  })
}

/** 轮询式给 tab 发 ping —— content script 注入完成就能回 PONG。
 * 用 alarms 心跳防止 service worker 被回收（MV3 30s idle 即回收）。
 * 总超时 15s，慢图床站点（tu.wnflb2023.com 偶尔很慢）友好。 */
async function pingUntilReady(tabId: number, timeoutMs: number): Promise<boolean> {
  await chrome.alarms.create(UPLOAD_KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_PERIOD_MIN })
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      try {
        const reply = await chrome.tabs.sendMessage(tabId, { type: 'PING' })
        if (reply?.pong === true) return true
      }
      catch {
        // content script 还没注入好 —— 抛 "Receiving end does not exist" 是预期的，继续重试
      }
      await new Promise(r => setTimeout(r, 200))
    }
    return false
  }
  finally {
    await chrome.alarms.clear(UPLOAD_KEEPALIVE_ALARM).catch(() => {})
  }
}

async function forwardUploadImage(payload: unknown, sendResponse: (response?: unknown) => void) {
  let createdTabId: number | null = null
  try {
    let tabId = await findUploadTabId()
    if (tabId == null) {
      const created = await chrome.tabs.create({ url: `https://${UPLOAD_HOST}/`, active: false })
      if (created.id == null) {
        sendResponse({ ok: false, error: '未能创建图床标签页' })
        return
      }
      tabId = created.id
      createdTabId = tabId
    }

    // 先等页面 complete（图床站点偶发慢），再 ping 确认 content script 注册好
    await waitForTabComplete(tabId, 10000)
    const ready = await pingUntilReady(tabId, 5000)
    if (!ready) {
      sendResponse({ ok: false, error: '图床 content 注入超时（15s）' })
      return
    }

    const response = await chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.UPLOAD_IMAGE, payload })
    if (!response || typeof response !== 'object') {
      sendResponse({ ok: false, error: '图床 content 未返回有效响应' })
      return
    }
    sendResponse(response)
  }
  catch (err) {
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
  finally {
    if (createdTabId != null) {
      chrome.tabs.remove(createdTabId).catch(() => {})
    }
  }
}

// ============ 消息路由 ============

chrome.runtime.onMessage.addListener((
  message: { type?: string, payload?: unknown },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => {
  if (message?.type === MESSAGE_TYPES.OPEN_SIDE_PANEL) {
    const tabId = _sender.tab?.id
    if (tabId == null) {
      console.warn('[background] 无法获取当前 tabId')
      return
    }
    chrome.sidePanel.open({ tabId }).catch(err => console.error('[background] 打开侧边栏失败:', err))
    return
  }

  if (message?.type === MESSAGE_TYPES.UPLOAD_IMAGE) {
    void forwardUploadImage(message.payload, sendResponse)
    return true
  }

  // PING —— pingUntilReady 用，用来探测 content script 是否就绪
  if (message?.type === 'PING') {
    sendResponse({ pong: true })
    return
  }
})
