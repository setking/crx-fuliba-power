# CLAUDE.md — 项目约定（fuliba）

本文件是本仓库的 **Claude 协作约定**，约束 AI 在本项目内的行为、代码风格、文件组织、命令与禁忌。
新增成员（人或 AI）开工前请通读一遍；改架构时请同步修改本文档。

---

## 1. 项目性质

Chrome 扩展（**Manifest V3**），目标站点为两个 Discuz! 论坛：

- `https://fuliba2025.net/*`
- `https://www.wnflb2023.com/*`

核心能力：

1. **自动签到** —— content script 检测登录态 → 找签到按钮（轮询 8s，含同源 iframe） → 点击 → 写入 `chrome.storage.local`，避免重复。
2. **论坛数据看板** —— 在 Side Panel 中查看「我的帖子 / 收藏 / 好友」，通过 `home.php?mod=space` 抓取并复用登录 cookie。
3. **状态联动** —— popup 与 sidepanel 都通过 `chrome.runtime.sendMessage` 询问 content script 当前登录态与 UID。

技术栈：

- Vue 3（`<script setup lang="ts">`）
- TypeScript（`strict` + `strictNullChecks` + `noUnusedLocals`）
- Vite + `@crxjs/vite-plugin`
- `vite-plugin-zip-pack`（产物额外打成 zip 到 `release/`）

---

## 2. 目录与文件组织

```
fuliba/
├── manifest.config.ts        # Chrome MV3 manifest 单一真源（用 defineManifest）
├── vite.config.ts            # Vite + crx + zip 插件，端口 5300
├── tsconfig.json             # @/* → src/*，严格模式
├── package.json
├── public/                   # 静态资源（如 logo.png）
└── src/
    ├── global.ts             # 跨模块复用的运行时常量
    ├── type.ts               # 跨模块复用的 TypeScript 类型
    ├── assets/               # SVG 等前端静态资源
    ├── components/           # 通用 Vue 组件（popup/sidepanel 复用）
    ├── popup/                # 工具栏弹窗（点击工具栏图标打开，~320px）
    │   ├── App.vue
    │   ├── main.ts
    │   ├── index.html
    │   └── style.css
    ├── sidepanel/            # Side Panel（独立的 Vue 应用）
    │   ├── App.vue
    │   ├── main.ts
    │   ├── index.html
    │   └── style.css
    ├── content/              # 注入到白名单域名的 content script
    │   ├── main.ts           # 自动签到 + 消息路由 + 挂载 Vue
    │   └── views/App.vue     # 注入到页面内的浮动 UI（当前为占位）
    └── utils/                # 纯函数 / 工具模块（无 DOM 副作用尽量归这里）
        ├── auth.ts           # 登录态检测（DOM 选择器 + cookie）
        ├── checkin.ts        # 今日已签到判断与写入
        ├── forum-api.ts      # Discuz 数据抓取（fetch + DOMParser）
        └── sites.ts          # 白名单站点单一真源
```

约定：

- **popup / sidepanel / content 是三个独立的 Vue 应用入口**，各自有 `index.html` + `main.ts` + `App.vue`。
- `src/content/` 内仍允许挂载 Vue（`views/App.vue`），但功能上**主流程不依赖它**，主流程是裸 TS 函数（签到 / 抓数据 / 消息路由）。
- `src/utils/` 内的模块尽量保持纯函数 / 低副作用；需要 DOM 时显式声明接收者。
- `src/components/` 放跨 popup / sidepanel 复用的纯展示组件。

### 公共变量与类型硬约束

- 跨两个及以上模块使用的运行时变量、常量和消息标识必须统一定义在 `src/global.ts`，禁止在业务模块中重复声明。
- 跨两个及以上模块使用的 TypeScript `type`、`interface` 和联合类型必须统一定义在 `src/type.ts`，禁止在业务模块中重复声明。
- 仅被单个模块使用的私有变量或类型应保留在该模块，不要为了集中管理而搬移。
- 新增可复用变量或类型时，必须先检查 `src/global.ts` / `src/type.ts` 是否已有定义，并同步更新所有引用。

---

## 3. 白名单单一真源（强约定）

`src/global.ts` 里的 `ENABLED_SITES` 是「插件可用站点」的唯一真源，`src/utils/sites.ts` 只负责提供判断函数。

**任何新增 / 删除站点都必须同时改三处**：

1. `src/global.ts` —— `ENABLED_SITES` 数组
2. `manifest.config.ts` —— `content_scripts[].matches`
3. （如有第三方平台白名单）相关说明文档

> 文件注释已明示这一同步要求：`// content_scripts 注入的域名白名单 —— 必须与 src/global.ts 的 ENABLED_SITES 保持一致`

判断函数 `isEnabledSite(hostname)` 同时匹配**精确域名**和**子域名**（如 `x.fuliba2025.net`）。

---

## 4. 消息协议（popup/sidepanel ↔ content）

所有跨上下文通信统一通过 `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` / `chrome.runtime.onMessage`。

| 类型 | 方向 | 入参 | 返回值 | 说明 |
| --- | --- | --- | --- | --- |
| `PROBE_LOGIN` | UI → content | — | `{ loggedIn: boolean }` | 检查当前页是否登录 |
| `GET_UID` | UI → content | — | `{ uid: string \| null }` | 取当前登录用户 UID |
| `FETCH_COUNTS` | UI → content | — | `{ ok, data: { threads, favorites, friends } } \| { ok: false, error }`；其中每个列表字段均为 `{ total: number \| null, pageSize: number \| null }` | 抓取我的帖子、收藏、好友数量及论坛实际分页大小 |
| `FETCH_THREADS` | UI → content | `{ page?: number }` | `{ ok, data: Thread[] } \| { ok: false, error }` | 抓指定页的我的帖子 |
| `FETCH_FAVORITES` | UI → content | `{ page?: number }` | `{ ok, data: Favorite[] } \| { ok: false, error }` | 抓指定页的我的收藏 |
| `FETCH_FRIENDS` | UI → content | `{ page?: number }` | `{ ok, data: Friend[] } \| { ok: false, error }` | 抓指定页的我的好友 |
| `FETCH_SEARCH` | UI → content | `{ keyword: string, page?: number, searchId?: string \| null }` | `{ ok, data: ForumSearchPage } \| { ok: false, error }` | 按关键词抓论坛搜索结果 |
| `CHECKIN` | popup → content | — | `{ ok, msg: string }` | 立即签到 |
| `NOT_LOGGED_IN` | content → popup（best-effort） | `{ host, hint }` | — | 自动签到发现未登录时通知 |
| `UPLOAD_IMAGE` | side panel → content | `{ dataUrl: string, fileName: string, contentType: string, uuid: string }` | `{ ok, data: UploadedImage } \| { ok: false, error }` | 转发到 `tu.wnflb2023.com` 的 content，**仅在 `location.hostname === UPLOAD_HOST` 时接受**；multipart 字段为 `name` / `uuid` / `file` |

约定：

- **content script 是数据出口**。UI 不直接 fetch 论坛（避免 CORS）；由 content 在页面 context 里 fetch，自动带 cookie。
- 异步消息处理必须 `return true` 并在内部 `sendResponse(...)`，否则端口关闭会丢响应（参见 `src/content/main.ts`）。
- 新增消息类型时，请在 `src/content/main.ts` 的 `onMessage` 路由与本表**同时维护**。

---

## 5. 代码风格

### Vue / TS

- 全部使用 `<script setup lang="ts">`；不使用 Options API。
- 组件命名 PascalCase（如 `HelloWorld.vue`）。
- 模板中变量名保持简短；列表渲染统一 `:key`（优先用稳定 ID，没有时退化到 index 并写注释）。
- `ref<T>(...)` / `ref<T>('idle')` 显式标注类型；少用 `any`，必要时 `as Error` / `as HTMLAnchorElement` 显式断言。
- `noUnusedLocals` 开启 —— 写代码时主动清理无用 import / 变量。
- 路径统一 `@/...`（指向 `src/`）；不要写相对路径回溯 `../../`。

### 样式

- 每个页面（popup / sidepanel）有自己的 `style.css`；组件内部用 `<style scoped>`。
- 字体栈默认 `ui-sans-serif, system-ui, sans-serif`。
- 颜色语义（当前约定，可在 UI 层适度替换）：
  - 成功/已登录：`#d1fae5` 背景 + `#065f46` 文字
  - 警示/未登录：`#fee2e2` 背景 + `#991b1b` 文字
  - 错误条：`#fef3c7` 背景 + `#92400e` 文字
  - 主色：`#3b82f6` / `#2563eb`
  - 签到按钮：`#10b981` / `#059669`

### 注释

- 中文注释为主，关键函数加 JSDoc；英文标识符 / 文档字符串 OK。
- 「为什么」必须注释，「做什么」靠代码自解释即可。

---

## 6. 签到相关约定

- 按钮 ID 候选顺序存放在 `CHECKIN_BTN_IDS`（`src/content/main.ts`），覆盖 Discuz 不同模板。
- 找不到按钮时**轮询 8s**，每 300ms 重试，且会进入同源 iframe。
- 「今日已签到」用 `(host, YYYY-MM-DD)` 作为 key 存 `chrome.storage.local`，**避免重复弹签到**。
- 站点不在白名单时不会注入 content script，popup 应在「非可用网站」分支展示提示。
- 登录检测先看「退出登录」按钮，再看用户元素，最后兜底 cookie（详见 `src/utils/auth.ts`）。

---

## 7. 数据抓取约定（Discuz）

- 入口：`src/utils/forum-api.ts`，导出 `getCurrentUid / fetchMyCounts / fetchMyThreads / fetchMyFavorites / fetchMyFriends / fetchForumSearch`。
- 论坛搜索使用 `search.php?mod=forum`，首次响应提取动态 `searchid`，后续请求复用该标识；不得硬编码某个示例 `searchid`。
- 论坛搜索首次请求按站点表单流程 POST 到 `search.php?mod=forum`（携带当前页 `formhash`、`srchtxt`、`searchsubmit=yes`），跟随 302 后从最终 URL 提取动态 `searchid`；后续分页使用带 `searchid` 的 GET 请求。
- 所有抓取都在 content script 的页面 context 中执行，**自带 cookie**，因此 URL 用相对路径或基于 `location.host` 拼接。
- 用 `fetch + DOMParser` 而非直接访问远端 DOM，规避跨域。
- 选择器按 Discuz 主流模板写；如果目标站模板不同，应**多选择器兜底**而不是硬编码（参考 `fetchMyFavorites` 的 `.bmw li, ul.bml li` 退化逻辑）。
- 返回类型集中在 `src/type.ts` 的 `Thread / Favorite / Friend / SearchResult / ForumCounts / ForumSearchPage` interface，新增字段请同步更新。

---

## 8. 命令与构建

```bash
pnpm install            # 或 npm install
pnpm dev                # vite，开发服务 http://127.0.0.1:5300
pnpm build              # vue-tsc -b && vite build，产物 dist/ + release/*.zip
```

- 端口固定 5300（避开 WSL/Hyper-V 保留段 5041–5240），可在 `vite.config.ts` 改。
- CORS 仅放行 `chrome-extension://` origin。
- 构建会同时输出 zip 到 `release/crx-<name>-<version>.zip`，便于分发。
- **构建执行约束：每次代码修改完成后不要自动执行 `pnpm run build`（或简写 `pnpm build`）。日常验证只运行 `pnpm exec vue-tsc -b`；只有用户明确要求完整构建、发布产物或验证打包流程时才运行构建命令。**

加载到 Chrome：

1. `pnpm dev` 或 `pnpm build`
2. 打开 `chrome://extensions/` → 开启「开发者模式」→ 「加载已解压的扩展程序」选 `dist/`

---

## 9. 权限与安全

- `permissions: ['sidePanel', 'contentSettings', 'tabs', 'storage']`
- `host_permissions: ['<all_urls>']` —— 仅在 content script 内部发起跨域请求使用。
- 写入 `chrome.storage.local` 的字段目前：`autoCheckinEnabled`（boolean）、`lastCheckin`（`{ host, date }`）。
- 不要在 `chrome.storage` 里存放 token / cookie / 密码。
- 不要新增未声明的 permission —— 加新能力时同步更新 `manifest.config.ts`。

---

## 10. 禁忌 / 不要做

- ❌ 不要把 Vue 组件文件路径写错（如 `src/components/` 而非 `srcs/components/`，后者是 `HelloWorld.vue` 模板注释里的 typo，已被沿用，不要再传染）。
- ❌ 不要在 popup / sidepanel 直接 `fetch` 论坛接口（会撞 CORS + 缺 cookie），统一走 `chrome.tabs.sendMessage` → content。
- ❌ 不要新增站点只改 `manifest.config.ts` 而忘了 `src/utils/sites.ts`，反之亦然。
- ❌ 不要修改 `vite.config.ts` 里的端口到 5041–5240 段。
- ❌ 不要关闭 `strict` / `noUnusedLocals` / `strictNullChecks` 来「修」编译错误。
- ❌ 不要给 `<style scoped>` 之外的全局样式加新规则，必要时改对应 `style.css`。
- ❌ 不要在 content script 里阻塞主线程（fetch 是异步的，没问题；但 `Array.from(document.querySelectorAll(...)).map(...)` 这种大文档 O(n) 不要放在 `onMessage` 热路径上）。
- ❌ **不要留下任何未使用的代码** —— 变量、类型、函数、import 一旦不再被引用就必须删除。包括但不限于：
  - 未被引用的 `import`（即使 TS 当前没报错，提交前清理）
  - 只赋值不读的 `ref` / 局部变量
  - 没有调用者的工具函数 / 私有方法
  - 已经替换掉的旧类型 / interface
  - 调试用的 `console.log`（调试完就删，不要「以防万一」留下）
  - 死代码（不可达分支、`return` 之后的语句等）

  `pnpm build` 会跑 `vue-tsc -b`，开启 `noUnusedLocals`；不要通过注释掉类型断言 / 加 `// @ts-ignore` 来绕过未使用报错，应当**直接删除**。发现残留的未使用代码时，要么用上它，要么删掉它。

---

## 11. 常见任务清单

| 任务 | 涉及文件 |
| --- | --- |
| 新增白名单站点 | `src/global.ts` + `manifest.config.ts` |
| 新增抓取接口 | `src/utils/forum-api.ts` + `src/content/main.ts`（消息路由）+ `src/sidepanel/App.vue` 或 `src/popup/App.vue` |
| 新增 popup UI 状态 | `src/popup/App.vue` + `src/components/HelloWorld.vue`（如复用） |
| 新增 sidepanel 标签页 | `src/sidepanel/App.vue` + 新组件文件 |
| 调整签到按钮候选 | `src/content/main.ts` 的 `CHECKIN_BTN_IDS` |
| 调整登录判定 | `src/utils/auth.ts` |

---

## 12. 沟通与提交

- 改架构 / 加 permission / 加新消息类型 → 在 PR 描述里说明，并同步更新本文档对应小节。
- 不要把临时调试 `console.log` 留在生产路径；调试用 `[xxx]` 前缀（如 `[checkin]`），便于过滤。
- **所有更改的代码都必须经过 TS 检测通过**：
  - 需要验证完整产物时运行 `pnpm run build`（等同 `vue-tsc -b && vite build`），确保 `vue-tsc` 通过、零类型错误；日常代码修改不要自动执行该命令。
  - 改完任何 `.ts` / `.vue` 文件后，**必须**先单独跑 `pnpm exec vue-tsc -b` 验证，不要等所有改完才检查 —— 早发现早修。
  - `strict` / `strictNullChecks` / `noUnusedLocals` 一律开启，**不要**通过 `// @ts-ignore`、类型断言绕开、或关掉开关来"修"报错。
  - 编辑器里出现的红色波浪线（Volar / TS）未消除前不要提交。
  - 如新增依赖会带来新类型（例如 vue-router / pinia），确保 `@types/*` 同步装齐且 tsconfig `types` 配置齐全。

---

最后更新：与当前仓库一致；若你发现某条约定被代码违反，先改代码再回来更新本文档。
