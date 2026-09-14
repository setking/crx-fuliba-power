---
name: whitelist-sync
description: 维护「插件可用站点」白名单单一真源。当新增/修改/删除白名单站点（如 fuliba2025.net、wnflb2023.com）时使用。
when_to_use: 新增论坛站点；从白名单移除站点；调整 FLOAT_BUTTON_HOSTS / UPLOAD_HOST；验证 ENABLED_SITES 与 manifest 是否同步
when_not_to_use: 调整论坛抓取逻辑（→ forum-scraping）；调整消息协议（→ message-protocol）；UI 样式（→ ui-style）
---

# whitelist-sync — 白名单单一真源

**强约定**：`ENABLED_SITES` 是插件可用站点的唯一真源。任何变更必须**同步三处**。

## 三处同步点

| # | 位置 | 内容 |
|---|---|---|
| 1 | `src/global.ts` 的 `ENABLED_SITES` | 数组本体 |
| 2 | `manifest.config.ts` 的 `content_scripts[].matches` | 必须从 `ENABLED_SITES.map(site => 'https://${site}/*')` 派生 |
| 3 | `README.md` 的「功能 / 端口与权限」段（如有提及） | 用户可见白名单说明 |

## 当前真源（参考，修改以代码为准）

```ts
// src/global.ts
export const ENABLED_SITES = ['fuliba2025.net', 'www.wnflb2023.com'] as const
export const FLOAT_BUTTON_HOSTS = ['www.wnflb2023.com'] as const
export const UPLOAD_HOST = 'tu.wnflb2023.com'
```

## 判断函数

`src/utils/sites.ts` 的 `isEnabledSite(hostname)` 同时匹配精确域名和子域名（如 `x.fuliba2025.net`）。

## 操作清单

- 新增站点：
  1. 在 `src/global.ts` 数组里追加
  2. 跑 `pnpm build` 验证 `manifest.config.ts` 自动派生 matches
  3. 同步 README.md
- 删除站点：反过来
- 改 `UPLOAD_HOST`：同上 + 检查 `src/utils/image-host.ts` 是否还有硬编码 URL

## 验证

```bash
# 跑 grep 确认 ENABLED_SITES 与 manifest 一致
grep -E "ENABLED_SITES" src/global.ts
grep -E "matches" manifest.config.ts
```