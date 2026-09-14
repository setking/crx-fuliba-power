# CLAUDE.md — 项目骨架（fuliba）

本文件是 AI 协作的**最小骨架**，约束项目性质、文件组织、必读命令、必读禁忌。
按需查阅的**领域知识**已拆到 `.claude/skills/<name>/SKILL.md`，Claude 会按需加载；可机器验证的**质量守卫**已拆到 `.claude/hooks/*.sh`，由 Claude Code 自动执行。

**Skill 索引**（按需加载）：

| Skill | 何时用 |
|---|---|
| `whitelist-sync` | 新增/删除白名单站点 |
| `message-protocol` | 新增/调整消息类型 |
| `checkin-module` | 调整签到按钮候选、登录判定、修签到 bug |
| `whatslink-preview` | 调整 whatslink 磁链预览 API / 缓存 / 自动预热 |
| `foolproof-format-recognizer` | 改任何格式识别（百家姓/magnet/URL/ed2k）前必读 |
| `forum-scraping` | 调整 Discuz 抓取选择器、修抓取失败 |
| `ui-style` | 调整颜色 / 字体栈 / scoped 样式 |

**改架构时同步修改本文档 + 对应 skill。**

---

## 1. 项目性质

Chrome MV3 扩展，针对两个 Discuz! 论坛：

- `https://fuliba2025.net/*`（WordPress 文章站）
- `https://www.wnflb2023.com/*`（Discuz! 论坛）

**核心能力**：自动签到 / 论坛数据看板（Side Panel）/ popup ↔ content 状态联动 / 百家姓 & 油管链接转换 / 外站链接面板 / 图床 / 浮动按钮打开 Side Panel。

**技术栈**：Vue 3（`<script setup lang="ts">`）+ TypeScript（`strict` + `strictNullChecks` + `noUnusedLocals`）+ Vite + `@crxjs/vite-plugin` + `vite-plugin-zip-pack`。

## 2. 目录组织

```
fuliba/
├── manifest.config.ts        # MV3 manifest 单一真源
├── vite.config.ts            # Vite + crx + zip，端口 5300
├── tsconfig.json             # @/* → src/*，严格模式
├── package.json
├── public/                   # 静态资源
├── release/                  # 构建产物 zip
└── src/
    ├── global.ts             # 跨模块运行时常量
    ├── type.ts               # 跨模块 TS 类型
    ├── background.ts         # service worker：OPEN_SIDE_PANEL 路由
    ├── popup/                # 工具栏弹窗（独立 Vue 应用）
    ├── sidepanel/            # Side Panel（独立 Vue 应用）
    ├── content/              # 注入白名单域名的 content script
    │   ├── main.ts           # 入口：消息路由 + 4 个模块触发
    │   ├── checkin.ts        # 自动签到 + popup 即时签到
    │   ├── float-button.ts   # 浮动按钮
    │   ├── external-links.ts # 外站链接面板
    │   └── bjx.ts            # 百家姓 / 油管 / 白字转换
    └── utils/                # 纯函数 / 工具模块
        ├── auth.ts           # 登录态检测（DOM + cookie）
        ├── checkin.ts        # 签到状态读写
        ├── sites.ts          # 白名单判断
        ├── forum-api.ts      # Discuz 数据抓取
        ├── hidden-links.ts   # 外站 / 隐藏链接提取
        ├── bjx.ts            # 百家姓字典 + 转换
        ├── image-host.ts     # 图床 dataURL ↔ Blob ↔ FormData
        ├── pagination.ts     # 通用分页缓存
        ├── extension.ts      # UI ↔ content 通用桥
        ├── theme.ts          # 主题探测
        └── whatslink.ts      # 磁链元数据预览 API
```

**约定**：popup / sidepanel / content 是三个独立 Vue 应用入口；`src/utils/` 尽量保持纯函数；`src/components/`（如需新增）放跨 popup/sidepanel 复用的纯展示组件。

## 3. 公共变量 / 类型单一真源

- 跨模块运行时变量 / 常量 / 消息标识 → `src/global.ts`
- 跨模块 `type` / `interface` / 联合类型 → `src/type.ts`
- 业务模块禁止重复声明；新增前先检查这两个文件
- 仅被单个模块使用的私有变量 / 类型保留在该模块，不要为了集中管理而搬移

## 4. 代码风格

- 全部 `<script setup lang="ts">`，不用 Options API
- 组件命名 PascalCase；列表渲染统一 `:key`（无稳定 ID 时退化到 index 并加注释）
- `ref<T>(...)` 显式标注类型；少用 `any`，必要时 `as Error` / `as HTMLAnchorElement` 显式断言
- 路径统一 `@/...`；不要写相对路径回溯 `../../`
- 中文注释为主；「为什么」必须注释，「做什么」靠代码自解释

> 颜色 / 字体栈见 skill：`ui-style`

## 5. 命令与构建

```bash
pnpm install            # 或 npm install
pnpm dev                # vite 开发服务 http://127.0.0.1:5300
pnpm exec vue-tsc -b    # 日常 TS 检查（改完 .ts / .vue 必跑）
pnpm build              # 仅发布产物 / 用户要求时才跑（vue-tsc -b && vite build）
```

- 端口固定 **5300**（避开 WSL/Hyper-V 保留段 5041–5240，hook 强制）
- CORS 仅放行 `chrome-extension://` origin；构建产物 zip 输出到 `release/`
- **日常验证只跑 `pnpm exec vue-tsc -b`**；不要自动跑 build

## 6. 权限与安全

- `permissions: ['sidePanel', 'contentSettings', 'tabs', 'storage', 'alarms']`
- `host_permissions: ['<all_urls>']` —— 仅 content script 内部跨域请求使用
- `chrome.storage.local` 仅写：`autoCheckinEnabled` / `lastCheckin` / `whatslinkCache` / `imageHostHistory` / `imageHostSessionUuid` / `floatBtnPosition` / `bjxAutoPreview` / `forumTheme`
- **不存放** token / cookie / 密码 / 论坛账号凭证
- 加新 permission 必须同步更新 `manifest.config.ts`

## 7. 禁忌（机器未覆盖的描述性约束）

下列规则**无法**靠 hook 自动拦截，靠自觉：Vue 组件路径不能写错（如 `srcs/components/`）；popup / sidepanel 不能直接 `fetch` 论坛接口（走 `chrome.tabs.sendMessage` → content）；不给 `<style scoped>` 之外的全局样式加规则；content script `onMessage` 热路径不做 O(n) 大文档遍历；不留未使用的代码（`noUnusedLocals` 已开启，hook 轻量拦截，深度依赖 `vue-tsc -b`）；不通过 `// @ts-ignore` / 关闭 strict / 类型断言绕过报错（hook 已强制前两项）。

## 8. 沟通与提交

- 改架构 / 加 permission / 加新消息类型 → PR 描述里说明，并同步更新本文档 + 对应 skill
- 临时调试 `console.log` 用 `[xxx]` 前缀（如 `[checkin]`），便于过滤；调试完必须删除
- 所有更改必须经过 `pnpm exec vue-tsc -b` 通过；不要等所有改完才检查
- 编辑器红色波浪线（Volar / TS）未消除前不要提交
- 新增依赖如带类型，确保 `@types/*` 同步装齐