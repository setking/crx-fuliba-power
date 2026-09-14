---
name: message-protocol
description: 维护 popup / sidepanel / content 之间的 chrome.runtime.sendMessage 协议。当新增消息类型、调整入参/返回值、修改消息路由时使用。
when_to_use: 新增消息类型；调整消息入参 / 返回值 schema；改 content 路由；改 UI 端 sendMessage 调用
when_not_to_use: 改论坛抓取逻辑（→ forum-scraping）；改 UI 视觉（→ ui-style）
---

# message-protocol — UI ↔ content 消息协议

所有跨上下文通信统一通过 `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` / `chrome.runtime.onMessage`。**content script 是数据出口**：UI 不直接 fetch 论坛（避免 CORS + 缺 cookie），统一走 content 在页面 context 里 fetch，自带 cookie。

## 类型常量

所有消息类型字符串统一在 `src/global.ts` 的 `MESSAGE_TYPES` 里声明，禁止在业务模块里写裸字符串。

```ts
export const MESSAGE_TYPES = {
  PROBE_LOGIN, GET_UID, FETCH_COUNTS, FETCH_THREADS, FETCH_FAVORITES,
  FETCH_FRIENDS, FETCH_SEARCH, CHECKIN, NOT_LOGGED_IN, OPEN_SIDE_PANEL,
  UPLOAD_IMAGE,
} as const
```

## 完整协议表

| 类型 | 方向 | 入参 | 返回值 | 说明 |
| --- | --- | --- | --- | --- |
| `PROBE_LOGIN` | UI → content | — | `{ loggedIn: boolean }` | 检查当前页是否登录 |
| `GET_UID` | UI → content | — | `{ uid: string \| null }` | 取当前登录用户 UID |
| `FETCH_COUNTS` | UI → content | — | `{ ok, data: { threads, favorites, friends } } \| { ok: false, error }`；每个列表字段为 `{ total: number \| null, pageSize: number \| null }` | 抓取数量 + 论坛实际分页 |
| `FETCH_THREADS` | UI → content | `{ page?: number }` | `{ ok, data: Thread[] } \| { ok: false, error }` | 我的帖子 |
| `FETCH_FAVORITES` | UI → content | `{ page?: number }` | `{ ok, data: Favorite[] } \| { ok: false, error }` | 我的收藏 |
| `FETCH_FRIENDS` | UI → content | `{ page?: number }` | `{ ok, data: Friend[] } \| { ok: false, error }` | 我的好友 |
| `FETCH_SEARCH` | UI → content | `{ keyword, page?, searchId? }` | `{ ok, data: ForumSearchPage } \| { ok: false, error }` | 论坛搜索 |
| `CHECKIN` | popup → content | — | `{ ok, msg: string }` | 立即签到 |
| `NOT_LOGGED_IN` | content → popup（best-effort） | `{ host, hint }` | — | 自动签到发现未登录 |
| `UPLOAD_IMAGE` | side panel → **background** → content | `{ dataUrl, fileName, contentType, uuid }` | `{ ok, data: UploadedImage } \| { ok: false, error }` | background 转发到图床域 content；不存在图床 tab 时后台开一个用完即关 |
| `OPEN_SIDE_PANEL` | content → background → side panel | — | — | 浮动按钮点击时打开 Side Panel |
| `PING` | background → content（探测用） | — | `{ pong: true }` | background 用 `pingUntilReady` 探测 content script 是否注入就绪；content 不需要专门处理，content 的 listener 对未知 type 保持通道但无响应，超时会抛错即视为"未就绪" |

## 异步响应约定**

异步消息处理必须 `return true` 并在内部 `sendResponse(...)`，否则端口关闭会丢响应。**写错就丢响应**，所有 fetch / await 路径都要遵守。

## 新增消息类型的检查清单

- [ ] `src/global.ts` 的 `MESSAGE_TYPES` 已声明
- [ ] `src/type.ts` 已有入参 / 返回值类型
- [ ] `src/content/main.ts` 的 `onMessage` 路由已加
- [ ] UI 端调用方（popup / sidepanel）已加 sendMessage + 处理
- [ ] 本表已同步更新（更新本文件 `message-protocol` skill）