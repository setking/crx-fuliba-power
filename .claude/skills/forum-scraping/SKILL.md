---
name: forum-scraping
description: 维护 Discuz 数据抓取模块。当调整 home.php?mod=space 抓取、搜索 searchid 提取、修抓取失败 / 模板变更 bug 时使用。
when_to_use: 改 forum-api.ts 的选择器；调整搜索 searchid 提取逻辑；修模板改版导致的抓取失败；新增抓取接口
when_not_to_use: 改消息协议 schema（→ message-protocol）；改签到（→ checkin-module）
---

# forum-scraping — Discuz 数据抓取

## 入口

`src/utils/forum-api.ts`，导出 `getCurrentUid / fetchMyCounts / fetchMyThreads / fetchMyFavorites / fetchMyFriends / fetchForumSearch`。

所有抓取都在 **content script 的页面 context** 中执行，自带 cookie；URL 用相对路径或基于 `location.host` 拼接。

## 核心技术约束

- 用 `fetch + DOMParser` 而非直接访问远端 DOM，规避跨域
- 不要把 `fetch` 放到 popup / sidepanel，会撞 CORS + 缺 cookie
- 选择器按 Discuz 主流模板写；如果目标站模板不同，**多选择器兜底**而不是硬编码（参考 `fetchMyFavorites` 的 `.bmw li, ul.bml li` 退化）

## 搜索 searchid 提取

- 论坛搜索走 `search.php?mod=forum`
- 首次请求按站点表单流程 POST 到 `search.php?mod=forum`（携带当前页 `formhash`、`srchtxt`、`searchsubmit=yes`）
- 跟随 302 后从**最终 URL** 提取动态 `searchid`
- 后续分页用带 `searchid` 的 GET 请求
- **不得硬编码任何示例 searchid**

## 返回类型

集中在 `src/type.ts` 的 `Thread / Favorite / Friend / SearchResult / ForumCounts / ForumSearchPage` interface。新增字段请同步更新。

## 修抓取失败的定位路径

1. 在目标页面开 DevTools，跑 `fetchMyXxx()` 单独函数
2. 检查返回 HTML 结构是否变了（Discuz 模板改版最常见原因）
3. 检查选择器兜底是否覆盖新结构
5. 检查 `formhash` 是否过期（搜索首次请求需要）

## 新增抓取接口的检查清单

- [ ] `src/type.ts` 已有入参 / 返回值类型
- [ ] content 端 `src/content/main.ts` 的 onMessage 路由已加
- [ ] `MESSAGE_TYPES` 已声明新消息名
- [ ] UI 端（popup / sidepanel）已加 sendMessage + 处理
- [ ] UI 端考虑「当前 tab 不在白名单」分支
- [ ] 同步更新 `message-protocol` skill 的协议表