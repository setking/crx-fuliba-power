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
  // 兼容旧版：早期油猴脚本用"卜"编码竖线，老帖子里仍有残留
  '卜': '|',
}

const BJX_KEYS = Object.keys(BJX_TABLE)

/** 匹配一段连续的百家姓字符，10 个及以上 */
const BJX_PATTERN = new RegExp(`[${BJX_KEYS.join('')}]{10,}`, 'gm')

/** 匹配已成型 magnet 链接：magnet:?xt=urn:btih:<hex>{32,40} 后可选地吞掉 tracker 等查询参数。
 * value 用 [^\s"<>`]+ 防止吃掉 HTML 标签属性里的引号或 DOM 结构边界；
 * 不做严格 URI 解析——磁链客户端拿到不认识的参数会忽略，宽松匹配更不容易漏。 */
const MAGNET_PATTERN = /magnet:\?xt=urn:btih:[a-fA-F0-9]{32,40}(?:&[a-zA-Z0-9_.%-]+=[^\s"<>`]*)*/g

/** 匹配裸 hex hash。词边界避免误抓英文长词；32–40 字符符合 btih 规范 */
const HEX_HASH_PATTERN = /\b[a-fA-F0-9]{32,40}\b/g

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
 * 翻译结果截到第一个非 hex 字符之前：百家姓里夹了 `竺: / 贝= / 孟? / 江&` 等特殊字符时，
 * 翻译后可能出现 "magnet:?xt=urn:btih:..." 这种伪头，截断避免误拼成「hex + magnet:头 + 同 hash」的可疑链接。
 * 后续交给 toMagnet 做 32–40 hex 长度校验，真实性由 whatslink 预览按钮兜底。
 */
export function bjxToMagnet(bjx: string): string {
  const trimmed = bjx.trim()
  const mapped = Array.from(trimmed).map(ch => BJX_TABLE[ch] ?? '').join('')
  // 翻译结果整体恰好是合法 magnet（如 60 字百家姓巧合拼出完整 magnet）→ 原样返回
  // 这一关保护"真 magnet 被前面的截断逻辑误伤"的 case
  if (/^magnet:\?xt=urn:btih:[a-fA-F0-9]{32,40}$/i.test(mapped)) {
    return mapped
  }
  // 翻译结果恰好是 http/https URL（30 字百家姓巧合拼出可访问链接）→ 原样返回，让用户自判安全性
  // 真伪混在字典映射的物理巧合里，我们无法判断安全与否，但不应直接吞掉
  if (/^https?:\/\/[^\s"<>`]+/i.test(mapped)) {
    return mapped
  }
  // 翻译结果恰好是 ed2k URL → 原样返回（对齐油猴原作语义，现代论坛几乎用不到）
  if (/^ed2k:\/\/[^\s"<>`]+/i.test(mapped)) {
    return mapped
  }
  // 否则截到第一个非 hex，挡住"hex + 伪 magnet 头"这类怪翻译
  const firstNonHex = mapped.search(/[^a-fA-F0-9]/)
  const cleaned = firstNonHex < 0 ? mapped : mapped.slice(0, firstNonHex)
  return toMagnet(cleaned)
}

/** 裸 hex → magnet：非空就补前缀，含 `&x._t-v1=` 等扩展参数也一并保留 */
export function hexToMagnet(hex: string): string {
  return toMagnet(hex)
}

/** 非空且不带 magnet: 前缀就补 magnet 前缀。
 * 最弱校验：必须是 32–40 字符 hex（[a-fA-F0-9]），否则原样返回。
 * 这一关是为了挡住明显的非 magnet 噪声（如 https URL），让结果行不至于挂出"假 magnet"。
 * 长度和字符集合规的串一律放行（不区分 v1/v2/32 截断），真实性由 whatslink 预览按钮兜底。 */
function toMagnet(raw: string): string {
  if (raw.length === 0 || raw.startsWith('magnet:')) return raw
  if (!/^[a-fA-F0-9]{32,40}$/.test(raw)) return raw
  return `magnet:?xt=urn:btih:${raw}`
}

/**
 * 从一段文本里找出所有已成型 magnet 链接。
 * 不做去重，按出现顺序返回；去重由调用方按 index 处理。
 */
export function findMagnetInText(text: string): string[] {
  const result: string[] = []
  for (const match of text.matchAll(MAGNET_PATTERN)) {
    result.push(match[0])
  }
  return result
}

/**
 * 从一段文本里找出所有裸 hex hash。
 * 词边界要求避免误抓长 URL / 英文长词；btih 规范是 32–40 字符。
 * 注意：会和 magnet 命中重叠（magnet 内部含 hex），合并时由调用方按 index 去重。
 */
export function findHexHashInText(text: string): string[] {
  const result: string[] = []
  for (const match of text.matchAll(HEX_HASH_PATTERN)) {
    result.push(match[0])
  }
  return result
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
