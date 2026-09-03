/**
 * content script 入口
 *
 * 职责：
 * 1. 注册 chrome.runtime.onMessage 路由，把 UI 消息转发到 content 内的能力模块
 * 2. 按页面类型触发各功能模块的入口
 *
 * 业务逻辑全部下放到 src/content/*.ts 模块（checkin / float-button / external-links / bjx）。
 */

import { MESSAGE_TYPES } from '@/global'
import { isLoggedIn } from '@/utils/auth'
import { fetchForumSearch, fetchMyCounts, fetchMyFavorites, fetchMyFriends, fetchMyThreads, getCurrentUid } from '@/utils/forum-api'
import { dataUrlToBlob, uploadImage } from '@/utils/image-host'
import { isArticlePage, isViewthreadPage } from '@/utils/hidden-links'
import { UPLOAD_HOST, isFloatButtonSite } from '@/utils/sites'
import { enableBjxTransform } from '@/content/bjx'
import { autoCheckin, triggerCheckin } from '@/content/checkin'
import { enableExternalLinksPanel } from '@/content/external-links'
import { mountFloatButton } from '@/content/float-button'

console.log('[CRXJS] content script loaded')

// ============ popup / sidepanel → content 消息 ============
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === MESSAGE_TYPES.CHECKIN) {
    sendResponse(triggerCheckin())
  } else if (msg?.type === MESSAGE_TYPES.PROBE_LOGIN) {
    sendResponse({ loggedIn: isLoggedIn() })
  } else if (msg?.type === MESSAGE_TYPES.GET_UID) {
    sendResponse({ uid: getCurrentUid() })
  } else if (msg?.type === MESSAGE_TYPES.FETCH_COUNTS) {
    const uid = getCurrentUid()
    if (!uid) {
      sendResponse({ ok: false, error: '未拿到 UID' })
      return true
    }
    fetchMyCounts(uid)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: (err as Error).message }))
    return true
  } else if (msg?.type === MESSAGE_TYPES.FETCH_THREADS) {
    const uid = getCurrentUid()
    if (!uid) {
      sendResponse({ ok: false, error: '未拿到 UID' })
      return true
    }
    const page = Number.isInteger(msg.page) && msg.page > 0 ? msg.page : 1
    fetchMyThreads(uid, page)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: (err as Error).message }))
    return true
  } else if (msg?.type === MESSAGE_TYPES.FETCH_FAVORITES) {
    const uid = getCurrentUid()
    if (!uid) {
      sendResponse({ ok: false, error: '未拿到 UID' })
      return true
    }
    const page = Number.isInteger(msg.page) && msg.page > 0 ? msg.page : 1
    fetchMyFavorites(uid, page)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: (err as Error).message }))
    return true
  } else if (msg?.type === MESSAGE_TYPES.FETCH_FRIENDS) {
    const uid = getCurrentUid()
    if (!uid) {
      sendResponse({ ok: false, error: '未拿到 UID' })
      return true
    }
    const page = Number.isInteger(msg.page) && msg.page > 0 ? msg.page : 1
    fetchMyFriends(uid, page)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: (err as Error).message }))
    return true
  } else if (msg?.type === MESSAGE_TYPES.FETCH_SEARCH) {
    const keyword = typeof msg.keyword === 'string' ? msg.keyword : ''
    const page = Number.isInteger(msg.page) && msg.page > 0 ? msg.page : 1
    const searchId = typeof msg.searchId === 'string' && msg.searchId ? msg.searchId : null
    fetchForumSearch(keyword, page, searchId)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: (err as Error).message }))
    return true
  } else if (msg?.type === MESSAGE_TYPES.UPLOAD_IMAGE) {
    // 图床上传必须由 tu.wnflb2023.com 上的 content script 转发，避免 CORS 并自动带 cookie
    if (location.hostname !== UPLOAD_HOST) {
      sendResponse({ ok: false, error: '当前页面不是图床域' })
      return true
    }
    const payload = msg.payload ?? {}
    const dataUrl = typeof payload.dataUrl === 'string' ? payload.dataUrl : ''
    const fileName = typeof payload.fileName === 'string' ? payload.fileName : 'upload'
    const contentType = typeof payload.contentType === 'string' ? payload.contentType : ''
    const uuid = typeof payload.uuid === 'string' ? payload.uuid : ''
    if (!dataUrl || !uuid) {
      sendResponse({ ok: false, error: '缺少文件或会话 UUID' })
      return true
    }
    try {
      const { blob } = dataUrlToBlob(dataUrl)
      const file = new File([blob], fileName || 'upload', { type: contentType || blob.type })
      uploadImage(file, uuid)
        .then(data => sendResponse({ ok: true, data }))
        .catch(err => sendResponse({ ok: false, error: (err as Error).message }))
    }
    catch (err) {
      sendResponse({ ok: false, error: (err as Error).message })
    }
    return true
  }
  return true
})

// ============ 入口：按页面类型触发各功能模块 ============

/** 浮动按钮：仅 www.wnflb2023.com 显示 */
if (isFloatButtonSite(location.hostname)) {
  void mountFloatButton()
}

/** 自动签到：等 DOM 完整后再启动 */
if (document.readyState === 'complete') {
  void autoCheckin()
} else {
  window.addEventListener('load', () => { void autoCheckin() })
}

/** 外站链接面板：仅 viewthread 详情页 */
if (isViewthreadPage()) {
  if (document.readyState === 'complete') {
    void enableExternalLinksPanel()
  } else {
    window.addEventListener('load', () => { void enableExternalLinksPanel() })
  }
}

/** 百家姓 / 油管 转换：viewthread 详情页 + WordPress 文章页 */
if (isArticlePage()) {
  if (document.readyState === 'complete') {
    void enableBjxTransform()
  } else {
    window.addEventListener('load', () => { void enableBjxTransform() })
  }
}
