// FLOAT_BTN_HIDDEN_KEY / FLOAT_BUTTON_HOSTS / MESSAGE_TYPES / SIDEPANEL_ALIVE_PORT / UPLOAD_HOST / ensureStorageReady 都在下方主体使用
import { FLOAT_BTN_HIDDEN_KEY, FLOAT_BUTTON_HOSTS, MESSAGE_TYPES, SIDEPANEL_ALIVE_PORT, UPLOAD_HOST } from './global'
import { ensureStorageReady } from './utils/storage-init'

const ENABLED_HOSTS = new Set<string>(FLOAT_BUTTON_HOSTS)

// ============ storage 配置初始化 ============
// 每次 service worker 启动/唤醒都在顶层跑一次 ensureStorageReady() —— 幂等，开销仅为
// 一次 Promise.all(chrome.storage.local/session.get(keys))，不会写重复值。
// 设计意图："第一次加载插件时初始化所有 key" —— service worker 注册即插件加载，SW 是
// 最早醒来的上下文。让 SW 自启 init，能保证用户进任何 UI（content / popup / sidepanel）
// 之前 storage 已经就绪；同时 content / popup / sidepanel 入口的 await ensureStorageReady()
// 仍然是幂等的 "二次保险"。
//
// 注意：监听器注册不会被 init 阻塞 —— MV3 SW 注册监听器是同步路径，监听器注册完后
// init 的 Promise 仍能解析写入。监听器回调内如果读 storage 也会拿到完整默认值（chrome.storage
// 的 get/set 是底层队列，写入立即对后续 get 可见）。
void ensureStorageReady().catch(err => console.error('[background] storage init 失败:', err))

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

// ============ side panel 存活感知 ============
//
// side panel mount 时 chrome.runtime.connect({ name: SIDEPANEL_ALIVE_PORT }) 建立长连接，
// context 销毁 / 卸载 / 用户点 ✕ 关 side panel 时 background 端 port.onDisconnect 必触发
// —— 这是 background 端能感知关闭的最可靠手段（前提是 SW 没被回收）。
//
// 在 background 端写 chrome.storage.session 而不是 side panel 端：service worker 在 onDisconnect
// 回调期间稳定，side panel 端 context 已销毁时 storage.set 不可靠。
// 但 SW 回收期间 port 断开但 background 不会立即跑 onDisconnect 回调，
// 所以 side panel 端的 pagehide / onUnmounted 兜底写 false 仍有意义。
// session 级：浏览器关掉 / 崩溃后自动清空，避免 stale 值跨会话残留。

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== SIDEPANEL_ALIVE_PORT) return

  port.onDisconnect.addListener(() => {
    // side panel context 销毁 / 用户点 ✕ / 扩展重启 / 关浏览器 → 都触发这里
    // 用 session 而非 local：浏览器关掉 / 崩溃后自动清空，避免 stale 值跨会话残留。
    chrome.storage.session.set({ [FLOAT_BTN_HIDDEN_KEY]: false })
  })
})
