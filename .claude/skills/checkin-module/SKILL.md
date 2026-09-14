---
name: checkin-module
description: 维护 Discuz 自动签到模块。当调整签到按钮候选、签到轮询策略、登录检测顺序、或修签到流程 bug 时使用。
when_to_use: 调整 CHECKIN_BTN_IDS 候选顺序；改 8s/300ms 轮询策略；改 chrome.storage.local 的签到写入逻辑；修签到失败 / 重复弹签到 bug
when_not_to_use: 改消息协议（→ message-protocol）；改白名单（→ whitelist-sync）；改 UI 视觉（→ ui-style）
---

# checkin-module — Discuz 自动签到

## 按钮候选顺序

`CHECKIN_BTN_IDS`（`src/content/main.ts`）覆盖 Discuz 不同模板，按数组顺序轮询：

- `#fx_checkin_topb` / `#fx_checkin` / `#signin` / `#checkin` / `#hd_sign`

新增候选时按出现频次插队（高频在前），不要简单 append。

## 轮询策略

- 总超时 **8s**
- 重试间隔 **300ms**
- 找不到按钮时进入同源 iframe 继续找（Discuz 模板偶有把按钮塞 iframe）

## 「今日已签到」记录在 `chrome.storage.local`

- key 形态：`(host, YYYY-MM-DD)`
- 写入位置：`src/utils/checkin.ts`
- 作用：**避免重复弹签到**——一旦写入当天不再触发

## 登录检测顺序

`src/utils/auth.ts` 内的判定优先级（先匹配先返回）：

1. 「退出登录」按钮存在 → 已登录
2. 用户元素存在（昵称 / 头像）→ 已登录
3. 兜底 cookie（`UCHOME_auth` / Discuz formhash cookie）→ 已登录
4. 都不命中 → 未登录（触发 `NOT_LOGGED_IN` 消息通知 popup）

## popup 端约束

- 站点不在白名单时不会注入 content script，popup 应在「非可用网站」分支展示提示（不要直接调 `chrome.tabs.sendMessage`，会抛"Receiving end does not exist"）
- popup 主动签到的 `CHECKIN` 消息是 fire-and-forget，content 端会用 `chrome.runtime.sendMessage` 回 `NOT_LOGGED_IN` 或本地写入 `lastCheckin`

## 修签到流程 bug 的检查清单

- [ ] 按钮候选是否覆盖目标模板
- [ ] iframe 轮询路径是否被 CSP 拦了（Discuz 部分模板 `frame-ancestors` 会拦）
- [ ] `chrome.storage.local` 写入失败时（quota / 私密模式）是否兜底
- [ ] popup 端是否处理了「当前 tab 不在白名单」分支