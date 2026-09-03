# fuliba — 福利吧论坛助手

Chrome MV3 扩展，针对两个 Discuz! 论坛站提供自动化与辅助功能：

- `https://fuliba2025.net/`（WordPress 文章站）
- `https://www.wnflb2023.com/`（Discuz! 论坛）

## 功能

| 模块                       | 位置                                                 | 作用                                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自动签到                   | content script                                       | 检测 Discuz 签到按钮并模拟点击；用 `chrome.storage.local` 记录当日已签到，避免重复弹签到                                                                                                      |
| 浮动按钮                   | content script（仅 `wnflb2023.com`）                 | 右下角挂一个可拖拽按钮，点击打开 Side Panel；位置持久化到 `chrome.storage.local`                                                                                                              |
| 外站链接面板               | content script（viewthread 详情页）                  | 扫描帖子正文的 `<a href>`，过滤论坛内部跳转后以外站链接面板形式插入到楼主正文段之后；面板含域名 / URL / 复制按钮，所有样式走 Shadow DOM 隔离论坛 CSS                                          |
| 百家姓 / 油管转换          | content script（详情页 + WordPress 文章页 + 评论区） | 自动识别帖子正文 / 评论里的百家姓代码（连续字典字符）→ 转 `magnet:?xt=urn:btih:...` 链接；`watch?v=XXX` → YouTube 链接；`油管/channelXXX` h4 → 频道链接；白字隐藏 `<a>` → "好孩子看不见" 提示 |
| 我的（帖子 / 收藏 / 好友） | Side Panel                                           | 通过 `home.php?mod=space` 抓取并复用登录 cookie，展示我的帖子 / 收藏 / 好友列表 + 分页 + 数量 badge                                                                                           |
| 搜索                       | Side Panel                                           | Discuz `search.php?mod=forum` 关键词搜索；首响提取动态 `searchid`，后续分页复用                                                                                                               |
| 图床                       | Side Panel                                           | 多图批量上传到 `tu.wnflb2023.com/application/upload.php`，并发 3，4 种链接格式（URL / Markdown / HTML / BBCode），最近 50 张历史                                                              |
| 浮动按钮消息桥             | background service worker                            | 接收 content → background 的 `OPEN_SIDE_PANEL` 消息并打开当前 tab 的 Side Panel                                                                                                               |

数据出口统一由 content script 提供：UI 不直接 `fetch` 论坛（避免 CORS + 缺 cookie），通过 `chrome.tabs.sendMessage` → content → 页面内 `fetch`（自带 cookie）。

## 技术栈

- **Vue 3** (`<script setup lang="ts">`)
- **TypeScript** 严格模式（`strict` + `strictNullChecks` + `noUnusedLocals`）
- **Vite 8** + **`@crxjs/vite-plugin`** + **`vite-plugin-zip-pack`**
- **Chrome MV3**：content scripts + service worker + Side Panel

## 目录结构

```
fuliba/
├── manifest.config.ts          # MV3 manifest 单一真源（defineManifest）
├── vite.config.ts              # Vite + crx + zip-pack 插件，端口 5300
├── tsconfig.json
├── package.json
├── public/                     # 静态资源（logo.png）
├── release/                    # 构建产物 zip
└── src/
    ├── background.ts           # service worker：OPEN_SIDE_PANEL 路由
    ├── global.ts               # 跨模块运行时常量（白名单 / 消息类型 / 上传通道等）
    ├── type.ts                 # 跨模块 TypeScript 类型
    ├── popup/                  # 工具栏弹窗（点击扩展图标打开）
    │   ├── App.vue
    │   ├── main.ts
    │   └── index.html
    ├── sidepanel/              # Side Panel（独立 Vue 应用）
    │   ├── App.vue             # 选项栏 + 我的 / 搜索 / 图床 三个视图
    │   ├── main.ts
    │   └── components/
    │       ├── ForumList.vue   # 通用列表（帖子 / 收藏 / 好友 / 搜索结果）
    │       ├── SearchView.vue  # 搜索视图（自管搜索缓存 + 状态机）
    │       └── ImageHostView.vue
    ├── content/                # 注入到白名单域名的 content script
    │   ├── main.ts             # 入口：消息路由 + 4 个模块触发
    │   ├── checkin.ts          # 自动签到 + popup 即时签到
    │   ├── float-button.ts     # 浮动按钮（拖拽 + 持久化位置）
    │   ├── external-links.ts   # 外站链接面板
    │   └── bjx.ts              # 百家姓 / 油管 / 白字转换
    └── utils/                  # 纯函数 / 工具模块（低副作用）
        ├── auth.ts             # 登录态检测（DOM + cookie）
        ├── checkin.ts          # 签到状态读取 / 写入
        ├── sites.ts            # 白名单判断
        ├── forum-api.ts        # Discuz 数据抓取（fetch + DOMParser）
        ├── hidden-links.ts     # 外站链接 / 隐藏链接提取
        ├── bjx.ts              # 百家姓字典 + 转换
        ├── image-host.ts       # 图床 dataURL ↔ Blob ↔ FormData 转换
        ├── pagination.ts       # 通用分页缓存 / 数量工具
        └── extension.ts        # getActiveTab / fetchViaContent 等 UI ↔ content 通用桥
```

## 开发

```bash
pnpm install
pnpm dev              # vite 开发服务（http://127.0.0.1:5300）
pnpm build            # vue-tsc -b && vite build，产物 dist/ + release/*.zip
```

加载到 Chrome：

1. 启动 `pnpm dev` 或 `pnpm build`
2. 打开 `chrome://extensions/`，开启「开发者模式」
3. 点击「加载已解压的扩展程序」选 `dist/`
4. 修改 `.ts` / `.vue` 后完整刷新扩展 + 帖子页（content script 不支持 HMR）

## 消息协议（UI ↔ content）

所有跨上下文通信通过 `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`。详见 [CLAUDE.md §4](./CLAUDE.md#4-消息协议popupsidepanel--content)。

| 类型                                                                   | 方向                              | 用途                                                   |
| ---------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------ |
| `PROBE_LOGIN`                                                          | UI → content                      | 检查当前页是否登录                                     |
| `GET_UID`                                                              | UI → content                      | 取当前登录用户 UID                                     |
| `FETCH_COUNTS` / `FETCH_THREADS` / `FETCH_FAVORITES` / `FETCH_FRIENDS` | UI → content                      | 抓我的帖子 / 收藏 / 好友                               |
| `FETCH_SEARCH`                                                         | UI → content                      | 论坛搜索（动态 searchId 复用）                         |
| `CHECKIN`                                                              | popup → content                   | 立即签到                                               |
| `NOT_LOGGED_IN`                                                        | content → popup                   | 自动签到发现未登录时通知                               |
| `UPLOAD_IMAGE`                                                         | side panel → content              | 转发到 `tu.wnflb2023.com` 的 content 发 multipart 上传 |
| `OPEN_SIDE_PANEL`                                                      | content → background → side panel | 浮动按钮点击时打开 Side Panel                          |

## 协作约定

项目内有完整的 AI 协作约定文件 [CLAUDE.md](./CLAUDE.md)，涵盖：

- 白名单单一真源（`ENABLED_SITES` 必须与 `manifest.config.ts` 同步）
- 公共常量 / 类型集中（`src/global.ts` / `src/type.ts`）
- TS 严格模式 + 不留未使用代码
- Vue / TS 风格 + 颜色语义
- 签到 / 数据抓取 / 权限 等具体约定

修改架构 / 加 permission / 加新消息类型时，请同步更新 CLAUDE.md 对应小节。

## 端口与权限

- 端口 5300（避开 WSL / Hyper-V 保留段 5041–5240）
- CORS 仅放行 `chrome-extension://` origin
- `permissions: ['sidePanel', 'contentSettings', 'tabs', 'storage']`
- `host_permissions: ['<all_urls>']`（仅 content script 内部跨域请求使用）
- `chrome.storage.local` 仅写：`autoCheckinEnabled` / `lastCheckin` / `imageHostHistory` / `imageHostSessionUuid` / `floatBtnPosition` —— **不存放 token / cookie / 密码**

## 兼容性

### 浏览器

仅支持 Chrome / Chromium 系 MV3 浏览器：

- Chrome ≥ 116（Manifest V3 完整支持 + Side Panel API）
- Edge ≥ 116（同 Chromium 内核）
- 不支持 Firefox（Firefox MV3 实现差异较大，Side Panel 行为不同）
- 不支持 Safari（Chrome 扩展 API 子集）
- 需要安装 Chrome 扩展开发者模式才能加载未打包扩展（`chrome://extensions/` → 开发者模式）

### 论坛模板

针对 Discuz! X3 / X3.5 默认模板编写，对部分老模板 / 魔改模板可能不生效：

| 功能                     | 依赖的选择器 / 接口                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 自动签到                 | `#fx_checkin_topb` / `#fx_checkin` / `#signin` / `#checkin` / `#hd_sign`（顺序尝试）                         |
| 浮动按钮                 | 全站通用，不依赖模板                                                                                         |
| 外站链接 / 百家姓 / 油管 | 楼层节点 `td.t_f[id^="postmessage_"]` + `id^="postmessage_"` 数字 ID（Discuz 标准约定）                      |
| 我的 / 收藏 / 好友       | `home.php?mod=space&uid=XXX&do=favorite                                                                      | friend`（Discuz 标准接口） |
| 搜索                     | `search.php?mod=forum` + 动态 `searchid`（Discuz 标准接口）                                                  |
| 图床                     | `https://tu.wnflb2023.com/application/upload.php`，multipart 字段 `name` / `uuid` / `file`（外部站独立协议） |

模板改版或站点更换 CDN / 静态资源路径时，仅影响对应功能；不会导致其它模块崩溃。

### 论坛改版 / 接口变更

- 数据抓取依赖论坛返回的 HTML 结构；论坛改版后**首次抓取会失败**，需更新 `src/utils/forum-api.ts` 里的选择器
- 自动签到依赖 `fx_checkin` 插件的按钮 ID；论坛未装该插件时自动签到退化为「未找到按钮」，对其它功能无影响
- 图床上传协议由 `tu.wnflb2023.com` 独立维护，不与论坛同步；接口变更会同步在 `src/utils/image-host.ts` 更新

### Shadow DOM 隔离

所有由本扩展注入到论坛页面的 DOM 节点都用 Shadow DOM 隔离。这意味着：

- DevTools 里需要展开 `#shadow-root` 才能看到扩展注入的元素
- 论坛的 CSS / JS 修改不到我们的样式 / 事件
- 但反过来也意味着**论坛样式不会渗透到我们的面板**——面板的视觉样式由扩展自身控制（基于 `ui-sans-serif` 字体栈 + 浅色主题）

### Node / pnpm

- Node ≥ 20（Vite 8 / vue-tsc 3 要求）
- pnpm ≥ 9（或 npm ≥ 10），按 `package.json` 字段锁定版本安装即可

## 侵入性与安全性

### 对论坛的侵入

本扩展会修改所访问论坛页面的 DOM（在用户可见区域内插入新元素），并调用论坛的内部接口发起 fetch 请求。具体行为：

| 行为                                      | 范围                                                                                                             | 必要性                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 模拟点击 `fx_checkin` 等签到按钮          | 自动签到 / popup 触发                                                                                            | 等同用户主动点击                              |
| 在页面内 `fetch` Discuz 接口（带 cookie） | sidepanel / popup 通过 `chrome.tabs.sendMessage` 转发                                                            | 避免 CORS；与登录态下手动访问论坛页面行为一致 |
| 注入新的 DOM 节点                         | viewthread 详情页：楼主正文段后追加「外站链接」折叠面板 + 百家姓 / 油管 / 白字链接结果行；wnflb2023.com 浮动按钮 | 辅助功能；不影响论坛原有结构                  |
| Shadow DOM 包裹                           | 注入的 DOM 都用 Shadow DOM 隔离                                                                                  | 防止论坛脚本误清理我们的样式                  |

未做任何以下操作：自动发帖 / 自动回帖 / 自动私信、批量操作、绕过登录验证、抓取他人隐私数据、跨域跟踪用户行为。

### 权限与数据

- 权限范围（`manifest.permissions`）：`sidePanel`、`contentSettings`、`tabs`、`storage` —— **无任何写入型权限**
- 主机权限（`manifest.host_permissions`）：`<all_urls>` —— 仅供 content script 在白名单站点内部发起 `fetch` 时使用，不会向其它域发起主动请求
- `chrome.storage.local` 仅写以下字段，全部为本机开关 / 缓存 / 位置：
  - `autoCheckinEnabled`（boolean）：自动签到开关
  - `lastCheckin`（`{ host, date }`）：今日已签到标记
  - `floatBtnPosition`（`{ right, bottom }`）：浮动按钮位置
  - `imageHostHistory`（UploadedImage[]）：图床最近 50 张历史
  - `imageHostSessionUuid`（string）：当前图床批次 UUID
- **不存放任何** token / cookie / 密码 / 论坛账号凭证 / 浏览器外传数据
- 没有任何远程上报 / 统计 / 第三方分析 SDK；扩展不连接任何外部服务器，所有网络请求都发给 Discuz 论坛 / WordPress / `tu.wnflb2023.com` 三个原始站点

### 风险与免责

- 自动签到是模拟用户点击行为，论坛侧若判定为异常操作可能封号 —— 使用者自负风险
- 浮动按钮可被任意拖拽到屏幕任意位置，遮挡页面内容时由用户自行调整
- 数据抓取（帖子 / 收藏 / 好友 / 搜索 / 百家姓）依赖论坛当前的页面结构与接口形态；论坛改版后功能可能失效，需等待扩展更新
- 本扩展为个人 / 社区工具，非论坛官方出品，与 `fuliba2025.net` / `www.wnflb2023.com` 站点运营方无关

## License

MIT
