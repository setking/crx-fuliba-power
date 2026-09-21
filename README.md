# fuliba — 福利吧论坛助手

Chrome MV3 扩展，针对两个 Discuz! 论坛站提供自动化与辅助功能：

- `https://fuliba2025.net/`（WordPress 文章站）
- `https://www.wnflb2023.com/`（Discuz! 论坛）

## 功能

| 模块                       | 位置                                                 | 作用                                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自动签到                   | content script                                       | 检测 Discuz 签到按钮并模拟点击；用 `chrome.storage.local` 记录当日已签到，避免重复弹签到                                                                                                      |
| 浮动按钮                   | content script（仅 `wnflb2023.com`）                 | 右下角挂一个可拖拽按钮，点击打开 Side Panel；位置持久化到 `chrome.storage.local`                                                                                                              |
| 外站链接面板               | content script（viewthread 详情页）                  | 扫描帖子正文的 `<a href>`，过滤论坛内部跳转后以外站链接面板形式插入到楼主正文段之后；面板含域名 / URL / 复制按钮（高对比主色 + hover/active 反馈）；所有样式走 Shadow DOM 隔离论坛 CSS，并跟随论坛 light/dark 主题（panel-theme.ts 色板）                                          |
| 百家姓 / 油管转换          | content script（详情页 + WordPress 文章页 + 评论区） | 自动识别帖子正文 / 评论里的百家姓代码（连续字典字符）→ 转 `magnet:?xt=urn:btih:...` 链接（自动预览 whatslink 磁链元数据：标题 / 大小 / 文件列表）；`watch?v=XXX` → YouTube 链接；`油管/channelXXX` h4 → 频道链接；白字隐藏 `<a>` → "好孩子看不见" 提示 |
| 图片灯箱（Lightbox）       | content script（详情页 / 文章页正文）                | 点击正文 `<img>` / `<video>` / `<iframe>` / `<embed>` 弹出 ShadowRoot 模态大图；滚轮缩放 + 工具栏 ±/↺/⟲/↻ + 双击 100% 切换 + 拖拽 + 键盘翻页；懒加载新图实时追加进轮播；过滤隐藏 DOM + 外站 `<a>` 包裹 + Discuz 静态 UI 图标（`static/image/smiley\|common\|filetype\|magic\|admincp`）；SVG 不劫持；视频时底部工具栏 z-index 下沉 + 背景透明，不遮挡播放控件 |
| 我的（帖子 / 收藏 / 好友） | Side Panel                                           | 通过 `home.php?mod=space` 抓取并复用登录 cookie，展示我的帖子 / 收藏 / 好友列表 + 分页 + 数量 badge；总数从 `.pg` 分页条的"共 X 页"反推（收藏页 `.tbmu` 没有总数文本）                                                                                           |
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
    │   ├── bjx.ts              # 百家姓 / 油管 / 白字转换
    │   ├── lightbox.ts         # 图片灯箱：缩放 / 旋转 / 重置 / 视频 / 懒加载追加 / 隐藏 DOM 过滤 / 外站 <a> 包裹过滤 / Discuz 静态 UI 图标过滤
    │   └── theme-watcher.ts     # 论坛主题（深 / 浅）跟随
    └── assets/                 # 内联 SVG 图标（lightbox 工具栏 / Side Panel）
        ├── magnify.svg         # 放大
        ├── shrink.svg          # 缩小
        ├── reset.svg           # 重置
        ├── rotate-left.svg     # 逆时针旋转
        ├── rotate-right.svg    # 顺时针旋转
        ├── crx.svg / imgs.svg / search.svg / user.svg  # Side Panel 用
    └── utils/                  # 纯函数 / 工具模块（低副作用）
        ├── auth.ts             # 登录态检测（DOM + cookie）
        ├── checkin.ts          # 签到状态读取 / 写入
        ├── sites.ts            # 白名单判断
        ├── forum-api.ts        # Discuz 数据抓取（fetch + DOMParser）
        ├── hidden-links.ts     # 外站链接 / 隐藏链接提取
        ├── bjx.ts              # 百家姓字典 + 转换
        ├── image-host.ts       # 图床 dataURL ↔ Blob ↔ FormData 转换
        ├── pagination.ts       # 通用分页缓存 / 数量工具
        ├── panel-theme.ts      # Shadow DOM 面板主题色板（light/dark CSS 变量，跨面板共享）
        ├── theme.ts            # 论坛页面主题（深/浅）探测 + MutationObserver 跟随
        ├── whatslink.ts        # 磁链元数据预览 API（whatslink.com 拉取 + chrome.storage 缓存）
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

## 图片灯箱（Lightbox）

`src/content/lightbox.ts`（v1.0.4）。在详情页 / 文章页正文里点击媒体元素弹出 ShadowRoot 模态大图，所有样式走 Shadow DOM 隔离论坛 CSS。

### 触发与白名单

- **劫持元素**：`<img>` / `<video>` / `<iframe>` / `<embed>` 四类媒体；SVG（`*.svg` / `data:image/svg+xml`）直接跳过
- **正文根节点**：`article.article-content` / `.article-content`（WordPress）+ `td.t_f[id^="postline_"]` / `.pattl` / `.pcb` / `.message`（Discuz 楼层 + `<ignore_js_op>` 附件容器）
- **劫持手势**：默认左键单击；`Ctrl` / `Cmd` / `Shift` + 左键、中键、右键放行（用户期望的「新标签页打开图片」原生行为）
- **关闭**：点击遮罩 / 右上角 × / `Esc` 键；关闭后销毁 modal 节点与所有监听器

### 缩放 / 旋转 / 重置

- **缩放**：滚轮（自适应步长 0.05~0.2）+ 工具栏缩小 / 放大按钮（×0.8 / ×1.25）；范围 `[0.1, 8]`
- **旋转**：左右旋转按钮，每次 ±90°（0/90/180/270 步进）
- **重置**：恢复原始尺寸按钮一次性归零 scale / rotation / offset
- **双击**：在「适应屏」与「100% 自然尺寸」之间切换（el-image 风格，图片可溢出 wrap 边界）
- **拖拽**：mousedown 锁定当前 offset 基线后累加偏移，避免连续拖放 / 双击导致的偏移复位
- **键盘**：`←` / `→` / `Home` / `End` 翻页；切图保留 scale / rotation

### 视频 / 嵌入

- `<video>` 用原生 `<video controls>` 播放；`<iframe>` / `<embed>`（B 站 / YouTube / Discuz 视频插件）保留原 src
- **视频 / 嵌入时底部变换工具栏自动隐藏**：不是 `display: none`，而是把 toolbar 的 `background` / `border` / `box-shadow` 透明 + `z-index: -1` 沉到 wrap 之下 + `pointer-events: none` —— DOM 完全保留，切换图片时无重排 / 抖动

### 懒加载跟进

- 第一次开 lightbox 时对文章根挂一个 `MutationObserver`，监听 `childList + subtree + attributes(src / data-original / data-zoomfile / data-src / data-lazy-src / file)`
- 论坛懒加载追加 `<img>` / 替换占位 src → 等 `onload` 拿到真实 src 后 append 到轮播；lightbox 已开时实时刷新计数器，用户停留当前图不强制跳转
- 关闭 lightbox **不**解绑 observer（WeakMap 让 observer 与根 DOM 同寿命，跨次打开累积 list）

### 隐藏 DOM 过滤

- 三条入库路径都过滤：祖先链存在 `display: none` / `visibility: hidden|collapse` 的元素不进轮播
- 论坛折叠区 / 回复可见图 / 付费隐藏占位等场景：首次扫时被过滤；用户展开后再次开 lightbox 会触发 `syncNewlyVisible` 增量补扫，把新可见图补进 list
- observer 里的 `seen` 集合不被可见性失败污染 —— 后续 display 切换时还能被重新检查

### 外站 `<a>` 包裹过滤

- 论坛常见 `<a href="https://外站.com/..."><img src="..."></a>` 模式：图片被外链包裹，用户点图本意是开新标签去外站
- `isWrappedInExternalLink(el)` 判定规则：
  - 父链无 `<a>` → 正常处理
  - `<a>.href` 为空 / `#` / `javascript:` → 论坛脚本劫持的图预览链，正常进 lightbox
  - `<a>.href` 是 `attachment:` / `data:` / 相对路径 / 同 host → 内站附件 / 内站图，正常进 lightbox
  - `<a>.href` 是 http(s) 且 host ≠ location.host → 外站伪装链接，跳过 lightbox + 不劫持点击
- 应用于 4 个入口：`collectImagesFromRoot` 4 个 querySelectorAll 循环 / `mediaToLightboxImage` / `syncNewlyVisible` / `findClickableMedia`
- **点击行为**：外站 `<a>` 包裹的图片点不到 lightbox，也**不劫持点击**（`onDocClick` 在 preventDefault 前先走 `isWrappedInExternalLink`；不命中即 return，浏览器原生 `<a>.href` 跳转照旧）

### Discuz 静态 UI 图标过滤

Discuz 自 7.x 起将论坛内置 UI 图标统一放在 `static/image/` 下，统一剔除（都是论坛模板自带 UI，不是用户上传内容）：
- `static/image/smiley` 表情包
- `static/image/common` 公共图标（在线 / 离线 / 等级 / 勋章 / 版块图标等）
- `static/image/filetype` 附件类型图标（zip / rar / pdf 等 16×16）
- `static/image/magic` 道具图标
- `static/image/admincp` 后台管理图标（前台一般不会显示，兜底）

- `isForumStaticIcon(src)` 检测 src / currentSrc / `data-original` / `data-zoomfile` / `data-src` / `data-lazy-src` / `file` 任一字段命中上述子目录
- `readImageSrc` 在 attribute 读取阶段就把候选项过滤掉 —— 不再返回命中 `static/image/<ui-dir>/` 的 src（返回空串）
- `mediaToLightboxImage` / `collectImagesFromRoot` / `syncNewlyVisible` / observer 的 `load` 回调 / `attributes` 回调 / `findClickableMedia` 均二次校验，避免 lazy-load 后续把占位换成 UI 图时漏过
- 只对 `<img>` 生效；`<video>` / `<iframe>` / `<embed>` 不会出现这类图标
- **点击行为**：UI 图标图片不进 lightbox，但**也不会被劫持**（`onDocClick` 在 preventDefault 前先检查；不命中即 return，让浏览器原生行为照旧 —— 论坛脚本弹层 / 复制 / 其它预览仍有效）
- 用户上传的附件路径（`data/attachment/...` / `forum.php?mod=attachment` / 图床 CDN 等）完全不命中 `static/image/<ui-dir>/`，不会被误伤

### 性能 / 视觉细节

- toolbar / counter / mask 全走 Shadow DOM + `panel-theme.ts` 颜色变量，跟随论坛深浅主题
- toolbar 圆角 22px 胶囊形，`var(--panel-surface)` 背景 + `var(--panel-border)` 边框 + 阴影 `0 2px 8px rgba(0,0,0,.2)`
- 图标按钮内联 SVG 注入（`fill: currentColor`，跟随按钮 color），尺寸 18×18
- 拖拽后 50ms 内的 click 用 capture-phase `stopPropagation + preventDefault` 吞掉，避免被浏览器当成双击第一下触发 100% 切换

## Side Panel：帖子 / 收藏 / 好友 / 搜索 分页

四个列表（我的帖子、收藏、好友、搜索结果）共用 `RequestCache<T>` + `ForumCount.pages` / `ForumSearchPage.pages` 数据模型，靠 `.pg` 分页条解析页数。

### 总数来源

- Discuz 各列表页的 `.tbmu` 一般会写"X 个主题 / X 个好友"等明确总数文本，走 `parseForumCount` 提取
- **收藏页** `.tbmu` 不给总数文本，只在 `.pg` 上挂 `<span title="共 X 页">` —— 必须从 `.pg` 解析"共 X 页"
- 搜索结果页同理，标题文本里"找到 X 条"可能存在但格式多变

### `.pg` 解析

- `parseForumPageCount(doc, ['.pg'])`：优先读 `.pg` 内 `[title*="共"]` / `[title*="页"]` 的 title 属性（"共 2 页"），fallback 到正文 `/ X 页` / `共 X 页` 文本
- 显式与 `parseForumCount` 拆开：**"共 X 页"里的 X 是页数不是总数**，不能塞进 total 字段
- `parseDocumentCount` 在以下页面**不能**把 `.pg` 加进 selectors：
  - `fetchMyCounts`（帖子 / 收藏 / 好友）
  - `parseForumSearchPage`
  否则 `parseForumCount` 的"共 X"前缀规则会把 X 当 total 返回 → `getPageCount(2, 20)=1` → 分页条不显示

### 数据流

```
content.fetchMyCounts(uid)
  → 抓 threads / favorites / friends 三页 HTML
  → 每个 { total: parseDocumentCount(...), pageSize: parseDocumentPageSize(...), pages: parseForumPageCount(...) }
  → 送回 sidepanel

sidepanel.App.vue
  → pageCountFor(count): 优先 count.pages，否则 getPageCount(count.total, DEFAULT_PAGE_SIZE)
  → :page-count prop 传给 ForumList → 渲染分页条（pageCount > 1 时）
  → targetItemsForPage(page, count): 按当前页 * pageSize 推 target，on-demand 取当前页 +
     已缓存前序页；不再 v1.0.9 的 pre-pull（详见下）
```

### 拉取策略：on-demand，不 pre-pull（v1.0.10）

- v1.0.9 试过 pages × pageSize 推 target，让 `ensureCached` 一次性把所有页拉完换翻页即时性
- 实测发现：Discuz 列表页偶发 `page=2` 返回 0 条（cookie / 缓存 / URL 参数顺序等原因不明），pre-pull 把 `cache.reachedEnd=true` 永久写下 → 用户翻页后再也拉不到 page 2
- v1.0.10 回归 on-demand：`targetItemsForPage` 只算 `page * pageSize`，每次翻页请求对应页
- `ensureCached` 增加防御：page>1 返回 0 条视为「分页参数失效」，直接抛错让 UI 显示加载失败 + 不要污染 `reachedEnd`，用户刷新后单页失败不污染整条 cache

### 收藏页 URL：去掉 `view=me`（v1.0.10）

- 旧 URL：`home.php?mod=space&uid={uid}&do=favorite&view=me&type=all[&page=N]`
- 旧 URL 在 `&page=2` 时被 Discuz 路由切到"全部收藏"handler，`#favorite_ul` 拿不到当前用户的收藏项 → fetchMyFavorites(uid, 2) 返回 0 条
- 实测可用 URL（用户提供）：`home.php?mod=space&uid={uid}&do=favorite&type=all&page=2`
- 对当前登录用户，`do=favorite&type=all` 默认就是"我的收藏"，无需显式 `view=me`

### `ForumCount.pages` / `ForumSearchPage.pages`

`type.ts` 里两个接口都声明了 `pages: number | null`，明确语义："Discuz .pg 分页条的'共 X 页'解析出的总页数；firstBatchSize / total 不可靠时优先用它"。侧栏构造 `ForumCount` 字面量时统一带 `pages: null`（fetch 返回后回填真实值）。

### targetItemsForPage：不要用 count.total 截断（v1.0.12）

- 现象：v1.0.11 修了 `view=me` 后，收藏页 page=2 翻页列表还是空的（debug 日志显示 `loadFavorites target=20 cache.items.length=20` → `ensureCached while?=false` → 不发请求）
- 根因：`targetItemsForPage` 用 `Math.min(count.total, page*pageSize)` 截断 target。收藏页 `.tbmu` 解析不到真实总数，`loadFavorites` 末尾会把 `cache.items.length`（已加载条数，不是真实总数）写进 `favoritesCount.total` 兜底 → page=2 时 `Math.min(20, 40) = 20`，target 不够
- 修复：target 只用 `count.pages`（或 page×pageSize）作上限，不读 `count.total` —— 因为 pageCountFor 已经把 page clamp 到 ≤ pages，不可能拉超页
- 副作用：`loadFavorites` 末尾写的 `favoritesCount.total` 不再被 target 计算用到（仍是错的「已加载条数」），后续可以单独清理

### displayCount：tab 数量 badge 用 pages×pageSize 反推（v1.0.13）

- 现象：帖子 / 收藏 / 好友 tab 右上角的数量 badge 一直显示 `—`，必须用户点过该 tab 后才会显示数字
- 根因：`displayCount` 只读 `count.total`。三个 Discuz 页面 `.tbmu` 都没有总数文本，`fetchMyCounts` 返回的 `total=null` → 显示 `—`。`.pg` 的"共 X 页"和 `pageSize` 都能解析到，`pages × pageSize` 就是真实总数 —— 但 `displayCount` 没用到
- 修复：displayCount 优先 `count.pages * count.pageSize`，没 pages 才退到 `total` / `—`
- 副作用：`loadThreads/loadFavorites/loadFriends` 末尾的 `cache.items.length → count.total` fallback 写成 dead code（displayCount 不再读 `total`），但未清理，避免本次改动扩散；可单独 PR 处理

### loadList<T>：合并三个 tab 的 load 函数（v1.0.14）

- 现象：`loadThreads` / `loadFavorites` / `loadFriends` 三个函数几乎一字不差 —— 差异只在 cache/count/page/state ref + messageType + 错误标签（帖子/收藏/好友），逻辑完全一致
- 修复：抽出 `loadList<T>(opts, page?)` 泛型函数，三个 `loadX` 仅作为 thin wrapper 配置不同 opts。错误信息「加载{label}失败」由 label 区分，三个 tab 错误信息保留
- 不动：`changeThreadsPage` / `changeFavoritesPage` / `changeFriendsPage` 一行 wrapper（可读性 > DRY）、`switchTab` 三段 if、`refresh` 三元 —— 都保留。`loadList` 末尾的 `cache.items.length → count.total` dead code 仍未清理

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
- `permissions: ['sidePanel', 'contentSettings', 'tabs', 'storage', 'alarms']`（`alarms` 给 service worker keepalive，避免图床上传转发被回收）
- `host_permissions: ['<all_urls>']`（仅 content script 内部跨域请求使用）
- `chrome.storage.local` 仅写：`autoCheckinEnabled` / `lastCheckin` / `imageHostHistory` / `imageHostSessionUuid` / `floatBtnPosition` / `forumTheme` / `whatslinkCache` / `bjxAutoPreview` —— **不存放 token / cookie / 密码**

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
| **图片灯箱**             | **`article.article-content, .article-content, td.t_f[id^="postline_"], .pattl, .pcb, .message`**（WordPress 文章 + Discuz 楼层 + `<ignore_js_op>` 附件容器）；`<img>` / `<video>` / `<iframe>` / `<embed>` 四类媒体；SVG URL（`*.svg` / `data:image/svg+xml`）跳过 |
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
| 注入新的 DOM 节点                         | viewthread 详情页：楼主正文段后追加「外站链接」折叠面板 + 百家姓 / 油管 / 白字链接结果行；wnflb2023.com 浮动按钮；详情 / 文章页：图片灯箱 modal（仅用户点击媒体时创建，关闭即销毁） | 辅助功能；不影响论坛原有结构                  |
| Shadow DOM 包裹                           | 注入的 DOM 都用 Shadow DOM 隔离                                                                                  | 防止论坛脚本误清理我们的样式                  |

未做任何以下操作：自动发帖 / 自动回帖 / 自动私信、批量操作、绕过登录验证、抓取他人隐私数据、跨域跟踪用户行为。

### 权限与数据

- 权限范围（`manifest.permissions`）：`sidePanel`、`contentSettings`、`tabs`、`storage`、`alarms` —— `alarms` 仅给 service worker keepalive 用，无任何写入型权限
- 主机权限（`manifest.host_permissions`）：`<all_urls>` —— 仅供 content script 在白名单站点内部发起 `fetch` 时使用，不会向其它域发起主动请求
- `chrome.storage.local` 仅写以下字段，全部为本机开关 / 缓存 / 位置 / 主题：
  - `autoCheckinEnabled`（boolean）：自动签到开关
  - `lastCheckin`（`{ host, date }`）：今日已签到标记
  - `floatBtnPosition`（`{ right, bottom }`）：浮动按钮位置
  - `imageHostHistory`（UploadedImage[]）：图床最近 50 张历史
  - `imageHostSessionUuid`（string）：当前图床批次 UUID
  - `forumTheme`（`'light' | 'dark'`）：论坛当前主题（用于面板跟随）
  - `whatslinkCache`（Record<string, WhatslinkPreview>）：磁链元数据预览缓存（按 infohash 维度）
  - `bjxAutoPreview`（boolean）：百家姓自动预览开关
- **不存放任何** token / cookie / 密码 / 论坛账号凭证 / 浏览器外传数据
- 没有任何远程上报 / 统计 / 第三方分析 SDK；扩展不连接任何外部服务器，所有网络请求都发给 Discuz 论坛 / WordPress / `tu.wnflb2023.com` 三个原始站点

### 风险与免责

- 自动签到是模拟用户点击行为，论坛侧若判定为异常操作可能封号 —— 使用者自负风险
- 浮动按钮可被任意拖拽到屏幕任意位置，遮挡页面内容时由用户自行调整
- 数据抓取（帖子 / 收藏 / 好友 / 搜索 / 百家姓）依赖论坛当前的页面结构与接口形态；论坛改版后功能可能失效，需等待扩展更新
- 本扩展为个人 / 社区工具，非论坛官方出品，与 `fuliba2025.net` / `www.wnflb2023.com` 站点运营方无关

## License

MIT
