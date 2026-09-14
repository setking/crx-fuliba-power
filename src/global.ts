/** 跨模块共享的运行时常量。模块私有常量应保留在使用它的文件中。 */
export const ENABLED_SITES = ['fuliba2025.net', 'www.wnflb2023.com'] as const

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

export const DEFAULT_PAGE_SIZE = 20

export const IMAGE_UPLOAD_URL = 'https://tu.wnflb2023.com/application/upload.php'
export const IMAGE_UPLOAD_FIELD = 'file'
export const IMAGE_UPLOAD_CONCURRENCY = 3
export const IMAGE_HISTORY_LIMIT = 50
export const IMAGE_HISTORY_KEY = 'imageHostHistory'
export const IMAGE_SESSION_UUID_KEY = 'imageHostSessionUuid'

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
