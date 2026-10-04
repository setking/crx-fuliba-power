/** 跨模块共享的运行时常量。模块私有常量应保留在使用它的文件中。 */
export const ENABLED_SITES = ['fuliba2025.net', 'fuliba2023.net', 'www.wnflb2023.com'] as const

export const FLOAT_BUTTON_HOSTS = ['www.wnflb2023.com'] as const

/** 图床上传通道（与论坛站点分离）。content_scripts 与 side panel 都会引用。 */
export const UPLOAD_HOST = 'tu.wnflb2023.com'

/** 外站链接面板注入到论坛详情页时使用的 DOM id（避免与论坛脚本冲突） */
export const EXTERNAL_LINKS_PANEL_ID = 'crxjs-external-links'

/** 百家姓 / 油管识别转换后插入到原元素之后的 DOM 标记类名 */
export const BJX_RESULT_CLASS = 'crxjs-bjx-result'

/** 已被转换过的元素标记，避免 MutationObserver 重入 */
export const BJX_PROCESSED_ATTR = 'data-crxjs-bjx-done'

/** 百家姓 / magnet 结果行的"自动预览"开关 key。
 * 开启后：magnet 结果行进入视口即后台预热 whatslink 缓存（不自动展开 UI），用户点预览按钮时秒出。
 * 关闭后：保持原行为，必须点击才 fetch。 */
export const BJX_AUTO_PREVIEW_KEY = 'bjxAutoPreview'

/** side panel 开关状态：side panel mount 时写 true，关闭路径（onUnmounted / pagehide / background onDisconnect）写 false。
 * content 端 chrome.storage.onChanged 监听此 key 决定浮动按钮显隐。
 * content 启动时也读一次同步初始状态。
 * 用 chrome.storage.session 而非 local —— 浏览器关掉 / 扩展崩了 → 自动清空，
 * 避免崩溃 / 强杀进程后 stale=true 跨会话残留导致冷启按钮被错误隐藏。 */
export const FLOAT_BTN_HIDDEN_KEY = 'floatBtnHidden'

/** side panel 用来向 background 证明"我还活着"的长连接名称。
 * context 销毁 / 卸载 / 用户点 ✕ 关 side panel 时 background 端
 * port.onDisconnect 必触发 —— 这是感知 side panel 关闭的最可靠手段
 * （在 MV3 SW 还没被回收时）。关 side panel 时 onUnmounted / pagehide / port.onDisconnect
 * 都会触发写 false，但 background 在 SW 回收期间不会跑 onDisconnect 回调，
 * 所以 side panel 端 pagehide / onUnmounted 的兜底写仍有意义 —— 都是幂等的。 */
export const SIDEPANEL_ALIVE_PORT = 'sidepanel-alive'

export const DEFAULT_PAGE_SIZE = 20

export const IMAGE_UPLOAD_URL = 'https://tu.wnflb2023.com/application/upload.php'
export const IMAGE_UPLOAD_FIELD = 'file'
export const IMAGE_UPLOAD_CONCURRENCY = 3
export const IMAGE_HISTORY_LIMIT = 50
export const IMAGE_HISTORY_KEY = 'imageHostHistory'
export const IMAGE_SESSION_UUID_KEY = 'imageHostSessionUuid'

// ============ storage 默认值表 ============
// 注意：LOCAL_STORAGE_DEFAULTS / SESSION_STORAGE_DEFAULTS 已迁出到 utils/storage-init.ts。
// 因为 manifest.config.ts 会直接 import global.ts（vite.config 构建阶段 esbuild 看不到
// resolve.alias），而默认值表需要引用 utils/ 各模块的私有 key —— 那种 import 会让
// vite config 打包阶段报 UNRESOLVED_IMPORT。把 defaults 留在 storage-init.ts 里，
// 既打破这条传递链，又让"defaults 只和 ensureStorageReady() 配对"的设计意图更明确。

export const MESSAGE_TYPES = {
  PROBE_LOGIN: 'PROBE_LOGIN',
  GET_UID: 'GET_UID',
  FETCH_COUNTS: 'FETCH_COUNTS',
  FETCH_THREADS: 'FETCH_THREADS',
  FETCH_FAVORITES: 'FETCH_FAVORITES',
  FETCH_FRIENDS: 'FETCH_FRIENDS',
  FETCH_SEARCH: 'FETCH_SEARCH',
  CHECKIN: 'CHECKIN',
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  OPEN_SIDE_PANEL: 'OPEN_SIDE_PANEL',
  UPLOAD_IMAGE: 'UPLOAD_IMAGE',
} as const
