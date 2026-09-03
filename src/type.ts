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
