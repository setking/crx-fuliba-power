/**
 * 福利吧百家姓 / 油管识别转换
 *
 * 来源：原 silvio / silviode 用户脚本（GPLv3）。
 * 转换思路不变（百家姓字典 + 字符映射），但执行方式从"改 innerText"改为"追加新节点"，
 * 避免破坏帖子正文原有的 DOM 结构（图片、加粗、链接嵌套等）。
 */

export const BJX_TABLE: Record<string, string> = {
  '赵': '0', '钱': '1', '孙': '2', '李': '3', '周': '4', '吴': '5', '郑': '6', '王': '7', '冯': '8', '陈': '9',
  '褚': 'a', '卫': 'b', '蒋': 'c', '沈': 'd', '韩': 'e', '杨': 'f', '朱': 'g', '秦': 'h', '尤': 'i', '许': 'j',
  '何': 'k', '吕': 'l', '施': 'm', '张': 'n', '孔': 'o', '曹': 'p', '严': 'q', '华': 'r', '金': 's', '魏': 't',
  '陶': 'u', '姜': 'v', '戚': 'w', '谢': 'x', '邹': 'y', '喻': 'z', '福': 'A', '水': 'B', '窦': 'C', '章': 'D',
  '云': 'E', '苏': 'F', '潘': 'G', '葛': 'H', '奚': 'I', '范': 'J', '彭': 'K', '郎': 'L', '鲁': 'M', '韦': 'N',
  '昌': 'O', '马': 'P', '苗': 'Q', '凤': 'R', '花': 'S', '方': 'T', '俞': 'U', '任': 'V', '袁': 'W', '柳': 'X',
  '唐': 'Y', '罗': 'Z', '薛': '.', '伍': '-', '余': '_', '米': '+', '贝': '=', '姚': '/', '孟': '?', '顾': '#',
  '尹': '%', '江': '&', '钟': '*', '竺': ':', '赖': '|',
}

const BJX_KEYS = Object.keys(BJX_TABLE)

/** 匹配一段连续的百家姓字符，10 个及以上 */
const BJX_PATTERN = new RegExp(`[${BJX_KEYS.join('')}]{10,}`, 'gm')

/**
 * 从一段文本里找出所有 ≥10 字的百家姓片段。
 * 同时做合法性校验：每个字符必须在字典里，否则整段丢弃。
 */
export function findBjxInText(text: string): string[] {
  const result: string[] = []
  for (const match of text.matchAll(BJX_PATTERN)) {
    const segment = match[0]
    if (Array.from(segment).every(ch => BJX_TABLE[ch] !== undefined)) {
      result.push(segment)
    }
  }
  return result
}

/**
 * 百家姓片段 → magnet 链接。
 * 只要能映射成 40 字符 hex 串就带 magnet:?xt=urn:btih: 前缀；
 * 短串也照样映射输出（可能是被换行/空格分隔的磁链代码片段，磁链客户端容错拼起来）。
 */
export function bjxToMagnet(bjx: string): string {
  const trimmed = bjx.trim()
  const mapped = Array.from(trimmed).map(ch => BJX_TABLE[ch] ?? '').join('')
  // 只对完整 40 字符 hash 加 magnet 前缀；短串只返回 hex
  return mapped.length === 40 ? `magnet:?xt=urn:btih:${mapped}` : mapped
}

/** 从文本里抽 youtube watch?v=XXXX 中的 videoId；找不到返回 null */
export function parseYoutubeWatchId(text: string): string | null {
  const m = text.match(/watch\?v=([\w-]+)/)
  return m?.[1] ?? null
}

/** 从 "油管/channelXXX" 这种 h4 标题里抽 channel id；找不到返回 null */
export function parseBjxYoutubeChannel(text: string): string | null {
  const idx = text.indexOf('油管/channel')
  if (idx < 0) return null
  const rest = text.slice(idx + '油管/channel'.length).trim()
  return rest || null
}

/** 检测一个 <a> 的 inline style 是否把 color 设成了白色（白字隐藏链接） */
export function isWhiteStyleLink(a: HTMLAnchorElement): boolean {
  const inlineColor = a.style.color
  if (!inlineColor) return false
  const v = inlineColor.trim().toLowerCase()
  return v === 'white' || v === '#fff' || v === '#ffffff' || /rgb\(\s*255\s*,\s*255\s*,\s*255/.test(v)
}
