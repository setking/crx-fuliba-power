export type ForumTab = 'threads' | 'favorites' | 'friends'

export type ForumListKind = ForumTab | 'search'

export type LoginStatus = 'unknown' | 'logged-in' | 'logged-out'

export interface Thread {
  id: string
  title: string
  url: string
  author: string
  replies: string
  views?: string
  postTime?: string
}

export interface SearchResult {
  id: string
  title: string
  url: string
  author: string
  replies: string
  views?: string
  postTime?: string
  category?: string
}

export interface ForumSearchPage {
  items: SearchResult[]
  total: number | null
  pageSize: number | null
  /** Discuz .pg 解析的"共 X 页"页数；total 拿不到时用于反推 total。 */
  pages: number | null
  searchId: string | null
}

export interface Favorite {
  title: string
  url: string
  date?: string
}

export interface Friend {
  uid: string
  name: string
  avatar: string
  profileUrl: string
}

export interface ForumCount {
  total: number | null
  pageSize: number | null
  /** Discuz .pg 分页条的"共 X 页"解析出的总页数；firstBatchSize/total 不可靠时优先用它。 */
  pages: number | null
}

export interface ForumCounts {
  threads: ForumCount
  favorites: ForumCount
  friends: ForumCount
}

export interface UploadedImage {
  url: string
  thumb: string
  srcName: string
  fileName: string
  contentType: string
  size: number
  uploadedAt: number
}

export interface UploadResponse {
  result: string
  code: number
  url: string
  srcName: string
  thumb: string
  del?: string
}

export type ImageStatus = 'queued' | 'uploading' | 'done' | 'error'

export interface ImageTask {
  id: string
  fileName: string
  contentType: string
  size: number
  previewUrl: string
  status: ImageStatus
  result?: UploadedImage
  error?: string
}

export type LinkFormat = 'url' | 'markdown' | 'html' | 'bbcode'

/** whatslink.info 查询返回的磁链元数据 */
export interface WhatslinkInfo {
  found: boolean
  name: string
  size: number
  fileType: string
  count: number
  screenshots: string[]
  cachedAt: number
}

/** 结果行二级"预览"面板状态 */
export type PreviewState = 'idle' | 'loading' | 'done' | 'error'

/** 论坛页当前生效主题。'auto' 由 content script 在论坛页 context 内解析成 'dark' / 'light'，
 * sidepanel 只看终值。'unknown' 表示论坛未连接 / 未探测到（落回 light）。 */
export type ForumTheme = 'dark' | 'light' | 'unknown'

/** sidepanel 最终生效主题。 */
export type EffectiveTheme = 'dark' | 'light'
