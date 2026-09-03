import { FLOAT_BUTTON_HOSTS, MESSAGE_TYPES, UPLOAD_HOST } from './global'

const ENABLED_HOSTS = new Set<string>(FLOAT_BUTTON_HOSTS)

function isEnabledSite(url?: string) {
  if (!url) {
    return false
  }

  try {
    const { protocol, hostname } = new URL(url)

    return protocol === 'https:' && ENABLED_HOSTS.has(hostname)
  } catch {
    return false
  }
}

async function updateSidePanel(tabId: number, url?: string) {
  const enabled = isEnabledSite(url)

  await chrome.sidePanel.setOptions({
    tabId,
    path: 'src/sidepanel/index.html',
    enabled,
  })

  console.log('[background] sidePanel:', tabId, url, enabled)
}

// Tab 切换
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId)
    await updateSidePanel(tabId, tab.url)
  } catch (err) {
    console.error('[background] Tab 切换处理失败:', err)
  }
})

// URL 变化
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) {
    return
  }

  try {
    await updateSidePanel(tabId, changeInfo.url)
  } catch (err) {
    console.error('[background] URL 更新处理失败:', err)
  }
})

// 在所有 tab 里找一个当前在图床域的 tab（任意子路径都行 —— content script 的 matches 是 https://tu.wnflb2023.com/*）
async function findUploadTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ url: `https://${UPLOAD_HOST}/*` })
  return tabs[0]?.id ?? null
}

// Float Button → Background → Side Panel
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

    chrome.sidePanel.open({ tabId }).catch(err => {
      console.error('[background] 打开侧边栏失败:', err)
    })
    return
  }

  if (message?.type === MESSAGE_TYPES.UPLOAD_IMAGE) {
    // 必须 return true 才能异步 sendResponse；chrome.tabs.sendMessage 在 MV3 service worker 里也是异步的
    void forwardUploadImage(message.payload, sendResponse)
    return true
  }
})

async function forwardUploadImage(
  payload: unknown,
  sendResponse: (response?: unknown) => void,
) {
  let createdTabId: number | null = null
  try {
    let tabId = await findUploadTabId()
    if (tabId == null) {
      // 没有现成 tab —— 在后台开一个新标签页（active:false 不抢焦点），上传完成后关闭
      const created = await chrome.tabs.create({ url: `https://${UPLOAD_HOST}/`, active: false })
      if (created.id == null) {
        sendResponse({ ok: false, error: '未能创建图床标签页' })
        return
      }
      tabId = created.id
      createdTabId = tabId
      // 等 content script 注入完成（最多 5s）
      await waitForTabComplete(tabId, 5000)
    }

    const response = await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.UPLOAD_IMAGE,
      payload,
    })
    if (!response || typeof response !== 'object') {
      sendResponse({ ok: false, error: '图床 content 未返回有效响应' })
      return
    }
    sendResponse(response)
  } catch (err) {
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
  } finally {
    // 后台开的 tab 用完即关；用户已有的 tab 不动
    if (createdTabId != null) {
      chrome.tabs.remove(createdTabId).catch(() => {
        // tab 可能已被用户手动关，忽略
      })
    }
  }
}

function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now()
    const check = async () => {
      try {
        const tab = await chrome.tabs.get(tabId)
        if (tab.status === 'complete') {
          resolve()
          return
        }
      } catch {
        // tab 已关闭或不存在
        resolve()
        return
      }
      if (Date.now() - start >= timeoutMs) {
        resolve()
        return
      }
      setTimeout(check, 100)
    }
    void check()
  })
}
