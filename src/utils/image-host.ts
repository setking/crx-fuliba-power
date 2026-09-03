import {
  IMAGE_UPLOAD_FIELD,
  IMAGE_UPLOAD_URL,
  UPLOAD_HOST,
} from '@/global'
import type { LinkFormat, UploadedImage, UploadResponse } from '@/type'

/**
 * 图床上传工具
 *
 * 数据流：
 *  - side panel 准备 FormData（name / uuid / file 三字段），由 service worker
 *    在后台开 tu.wnflb2023.com 的标签页（active:false），转给该 tab 的 content；
 *  - content 在目标站页面 context 里 POST 到 IMAGE_UPLOAD_URL（带 origin / referer），
 *    该接口不要求 cookie，但页面 context 是必需的（服务端未开 CORS）。
 *  - 返回 JSON 与 UploadResponse 对应。
 */

export function createSessionUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function toDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('FileReader 返回非字符串'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export interface ParsedDataUrl {
  blob: Blob
  contentType: string
}

export function dataUrlToBlob(dataUrl: string): ParsedDataUrl {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
  if (!match) throw new Error('dataURL 格式非法')
  const contentType = match[1] ?? 'application/octet-stream'
  const isBase64 = Boolean(match[2])
  const payload = match[3] ?? ''
  const bytes = isBase64
    ? Uint8Array.from(atob(payload), ch => ch.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload))
  return {
    blob: new Blob([bytes], { type: contentType }),
    contentType,
  }
}

export async function uploadImage(file: File, uuid: string): Promise<UploadedImage> {
  const fd = new FormData()
  fd.append('name', file.name || 'upload')
  fd.append('uuid', uuid)
  fd.append(IMAGE_UPLOAD_FIELD, file, file.name || 'upload')

  // 接口要求 origin / referer 显式指向图床域（与抓包一致），否则服务端可能拒绝
  const headers = new Headers()
  headers.set('origin', `https://${UPLOAD_HOST}`)
  headers.set('referer', `https://${UPLOAD_HOST}/`)

  const res = await fetch(IMAGE_UPLOAD_URL, {
    method: 'POST',
    body: fd,
    headers,
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  // 响应 content-type 是 text/json;charset=UTF-8；走 text + JSON.parse 最稳
  const text = await res.text()
  let json: UploadResponse
  try {
    json = JSON.parse(text) as UploadResponse
  } catch {
    throw new Error(`响应非 JSON：${text.slice(0, 120)}`)
  }
  if (json.result !== 'success' || json.code !== 200 || !json.url) {
    throw new Error(`上传未成功：${json.result ?? 'unknown'} (code=${json.code})`)
  }

  return {
    url: json.url,
    thumb: json.thumb,
    srcName: json.srcName,
    fileName: file.name || 'upload',
    contentType: file.type || 'application/octet-stream',
    size: file.size,
    uploadedAt: Date.now(),
  }
}

export function buildLink(format: LinkFormat, image: UploadedImage): string {
  const alt = image.fileName
  switch (format) {
    case 'markdown':
      return `![${alt}](${image.url})`
    case 'html':
      return `<img src="${image.url}" alt="${alt}">`
    case 'bbcode':
      return `[img]${image.url}[/img]`
    case 'url':
    default:
      return image.url
  }
}