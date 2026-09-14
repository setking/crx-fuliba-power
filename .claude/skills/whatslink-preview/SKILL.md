---
name: whatslink-preview
description: 维护 whatslink.info 磁链元数据预览模块。当调整 magnet 预览 API、缓存策略、自动预热开关、预览按钮挂载逻辑时使用。
when_to_use: 改 fetchWhatslinkInfo API 调用；调 whatslinkCache 缓存 TTL / LRU；改自动预览开关（bjxAutoPreview）；调整预览按钮挂载点
when_not_to_use: 改百家姓 / 油管识别转换（→ foolproof-format-recognizer）；改白名单（→ whitelist-sync）
---

# whatslink-preview — 磁链元数据预览

## 入口与 API

- 入口：`src/utils/whatslink.ts`，导出 `fetchWhatslinkInfo / formatSize`
- API：`https://www.whatslink.info/api/v1/link?url=<magnet>`（**必须用 www 子域**，裸域 500）
- 调用方：content script 内直接 fetch（`Access-Control-Allow-Origin: *`，Cloudflare 缓存 4h）
- 超时：**8s**（`AbortController`）
- 异常：网络 / HTTP / 解析统一抛 `Error`，由 content 层做状态机渲染

## 缓存策略

- 位置：`chrome.storage.local[whatslinkCache]`
- 类型：`Record<hash, WhatslinkInfo>`
- TTL：**24h**
- LRU：**100 条**
- key 形态：**只取 magnet 的 hash 部分**（忽略 tracker），避免同样资源因 tracker 不同重复缓存

## 挂载规则

- 仅完整 magnet 命中（hex / 百家姓转出来的非完整 magnet）**不**挂预览按钮，避免查询失败噪音
- 结果行二级面板在 **Shadow DOM 内**渲染（按钮 / 摘要 / 截图缩略图）
- 点击缩略图：在新窗口打开大图（不要走 `window.open` 之外的弹窗路径，会被浏览器拦）

## 完整 magnet 拼接

`buildFullMagnet(magnet, name, size)` 拼 `&dn=<encoded name>&xl=<size>`（**不拼 tracker**；tracker 由用户自行选择）。

预览面板里的「📋 复制完整 magnet」按钮**永远挂上**（包括 `!info.found` 分支）—— 用户是傻瓜，复制需求与是否查到元数据无关。

## 自动预览开关（key: `bjxAutoPreview`，默认开启）

- 开启时：
  - 每个 magnet 预览按钮挂上后用**共享一个全局 `IntersectionObserver`** 进入视口时（`rootMargin: '200px 0px'`）后台 `fetchWhatslinkInfo` 预热缓存，**不自动展开 UI**
  - 预热完成后 `unobserve(btn)` 防止重复；同 magnet 只预热一次（`WeakSet` 跟踪按钮实例）
  - 后台 fetch 失败静默吞掉（用户没主动点就不打扰）
- 关闭时：退化为「点击即 fetch」原行为
- popup 里提供开关 UI（`src/popup/App.vue` `toggleAutoPreview`），开关状态 24h 缓存期内立即生效：用户重开页面后第一次 `transformAllPosts` 读到的就是新值

## 整容器兜底去重

评论 lazy load 后整容器兜底扫描会与之前 p 命中挂的 result 重复挂同一条 magnet——通过 `host.dataset.bjxRaw` 记录每次挂的原始 raw，`transformGenericContainer` 兜底时按 raw 跳过已挂过的。

## 修改预览挂载逻辑前的检查清单

- [ ] 新增的 magnet 形态是否走了 hex 校验（避免查询失败噪音）
- [ ] Shadow DOM 边界是否影响按钮点击（不要把 click 监听挂到 host）
- [ ] 自动预览开关下，新挂的按钮是否会被 `IntersectionObserver` 看到
- [ ] 缓存 key 是否还是只用 hash（不要把 tracker 拼进去）