/**
 * 文章媒体点击放大 + 轮播（Lightbox）
 *
 * 需求背景：Discuz / WordPress 正文里点 <img> 默认跳新标签页打开原图。
 * 用户实际意图只是「看大图」，跳走打断阅读；多张图没有前后翻页入口。
 * 同时帖子也会内嵌 <video>，应当一并能在 lightbox 里播放。
 * iframe / embed（b站 / youtube / flash）不再纳入轮播：高度按 150px 很难看，且 Discuz
 * `[media]` 标签把 iframe 包在 <a target="_blank"> 里，劫持与跳新标签页会冲突。
 *
 * 实现：
 * - 用 document 级事件代理捕获点击事件，找到 article.article-content / td.t_f / .pattl / .pcb / .message
 *   内的 <img> / <video> 就劫持
 * - 鼠标中键 / Ctrl|Cmd|Shift+Click 放行，保留「中键开新标签」习惯
 * - 弹一个 ShadowRoot 模态层挂在 body 末尾（不在正文容器内，避免论坛 SPA 重写时一起被删）
 * - 模态里：遮罩 + 媒体容器 + 工具栏（prev / zoom- / rotate-ccw / reset / rotate-cw / zoom+ / next）
 *           + 计数器 + 关闭按钮
 * - 键盘：← → Esc Home End；Space 在 video 上切换暂停/播放
 * - 鼠标：图片支持拖拽平移 + 滚轮缩放 + 双击「适应屏 ↔ 100% 原图」，点击遮罩关闭，点击媒体本身不关闭
 * - 视频：保留原生 controls；缩放/旋转/重置按钮 disable（缩放视频控件会破坏布局）
 * - SVG（<img src=*.svg> 或内嵌 <svg>）跳过 —— 不劫持不进轮播
 * - 切换图片时立刻 `new Image().src = nextSrc` 预加载，complete 后切 src，避免空白闪烁
 * - scale / rotation / offset 在切换图片时保留；「重置」按钮一键归零
 *
 * 主题跟随：复用 src/utils/panel-theme.ts 的 buildThemedStyle + applyPanelTheme，
 * 新模块无需自己管 light/dark 切换。
 *
 * 缓存：WeakMap<HTMLElement, LightboxImage[]> 存「正文 root → src 列表」，正文 DOM 被论坛脚本重写时该 WeakMap
 * 自动失效；下次打开时按需重扫。
 *
 * 入口：enableLightbox() —— 在 isLightboxSite() && isViewthreadPage() 命中时调用。
 */

// applyPanelTheme / buildThemedStyle / markThemedHost 都在下方主体使用
import { applyPanelTheme, buildThemedStyle, markThemedHost } from '@/utils/panel-theme'

/** 模态 host 在 DOM 上挂的标记 —— 用来去重（同一个 content script 实例只挂一份） */
const LIGHTBOX_HOST_ATTR = 'data-crxjs-lightbox'

/** 白名单：只劫持这些正文根容器内的媒体，论坛侧栏头像 / 表情 / 签名图不会被误伤。
 *  - article.article-content / .article-content：WordPress 文章站正文
 *  - td.t_f[id^="postmessage_"]：Discuz 帖子楼层正文
 *  - .pattl：Discuz 帖子正文底部的「附件列表」容器，内嵌 ignore_js_op/dl.tattl 附件图
 *  - .pcb / .message：Discuz 楼中层 / 回复内容容器 */
const ARTICLE_ROOT_SELECTOR = 'article.article-content, .article-content, td.t_f[id^="postmessage_"], .pattl, .pcb, .message'

/** Discuz 帖子楼层右半容器（包裹 td.t_f + .pattl + .pcb 等）。
 * 当点视频（root=td.t_f）或点附件图（root=.pattl）时，把 root 提升到 td.plc，
 * 让正文 + 附件里的所有图视频合并到同一个轮播列表。Discuz 一楼一层共用一个 td.plc，
 * 跨楼层不会串扰。 */
const DISCUZ_POST_CELL_SELECTOR = 'td.plc'

/** 拖拽判定阈值：mousedown 到 mouseup 之间移动 < 5px 才视为 click（点击遮罩/图片用） */
const CLICK_DRAG_THRESHOLD_PX = 5

/** 缩放范围（state.scale 自身 clamp） */
const SCALE_MIN = 0.1
const SCALE_MAX = 8

/** 工具栏 +/- 按钮的固定步长（乘以系数） */
const ZOOM_STEP_FACTOR = 1.25

/** 旋转角度（90° 步进） */
type Rotation = 0 | 90 | 180 | 270

/** 一条媒体记录（判别联合） */
type LightboxImage =
  | { kind: 'image'; src: string }
  | { kind: 'video'; src: string; poster?: string }

/** 当前打开的模态实例（只允许同时一个） */
interface OpenState {
  host: HTMLElement
  shadow: ShadowRoot
  /** 当前媒体容器（图片 <img> / 视频 <video>），每次 goTo 替换 */
  media: HTMLElement
  counter: HTMLElement
  prevBtn: HTMLButtonElement
  nextBtn: HTMLButtonElement
  closeBtn: HTMLButtonElement
  zoomOutBtn: HTMLButtonElement
  zoomInBtn: HTMLButtonElement
  rotateCcwBtn: HTMLButtonElement
  rotateCwBtn: HTMLButtonElement
  resetBtn: HTMLButtonElement
  /** 底部工具栏容器：视频时整组淡出 + 下沉，避免遮挡视频控制区 */
  toolbar: HTMLElement
  mask: HTMLElement
  wrap: HTMLElement
  images: LightboxImage[]
  index: number
  /** 当前媒体的 transform 引用：仅 image 有意义，其它 kind 永远 1 / 0 / 0,0 */
  currentTransformEl: HTMLElement | null
  /** 关闭回调（用于解绑全局事件） */
  cleanup: () => void
}

let openState: OpenState | null = null

/** root → 已扫描的媒体列表缓存。WeakMap 在 root 被 DOM 替换后自动 GC */
const rootImagesCache = new WeakMap<HTMLElement, LightboxImage[]>()
/** root → 观察 root 内媒体节点变化的 MutationObserver。
 * 用于论坛 lazy-load：图片/视频节点刚插入或 src 替换占位 → 等真实图加载完后追加进轮播列表 */
const rootObservers = new WeakMap<HTMLElement, MutationObserver>()
/** root → 已观察过的 media 元素集合（避免 observer 重复处理同一节点） */
const rootSeenMedia = new WeakMap<HTMLElement, WeakSet<Element>>()

/** 检查元素是否对用户可见（祖先链全部 display≠none 且 visibility≠hidden）。
 * 论坛模板常用 `<div style="display:none">` 放隐藏占位 / 回复后才能看到的图 / 折叠区，
 * 这些都不应进入 lightbox。 */
function isElementVisible(el: Element): boolean {
  let cur: Element | null = el
  while (cur && cur !== document.documentElement) {
    if (cur instanceof HTMLElement) {
      // offsetParent 为 null 通常意味着 display:none（<details> 闭合除外，但它本身 display 不会是 none）
      // 用 computed style 更稳，避免依赖 offsetParent 的边角
      const cs = window.getComputedStyle(cur)
      if (cs.display === 'none') return false
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false
      // opacity:0 仍可见，保留；不参与过滤
    }
    cur = cur.parentElement
  }
  return true
}

/** 检查媒体是否被 `<a>` 包裹指向外站（伪装外链）。
 * 论坛场景：`<a href="https://外站.com/xxx"><img src="..."></a>` —— 图片被外链包裹，
 * 用户点图本意是开新标签去外站，应放行浏览器原生行为；不应当成 lightbox 入口劫持。
 *
 * 判定规则：
 * - 祖先链没有 `<a>` → false（正常处理）
 * - `<a>` 是 HTMLAnchorElement 但 `href` 为空 / `#` / `javascript:` → false
 *   （论坛脚本劫持的图片预览链接，例如 attach://、onclick 弹层图，依然应当进 lightbox）
 * - `<a>.href` 是 `attachment:` / `data:` / 相对路径 / 同 host → false（内站附件 / 内站图，正常处理）
 * - `<a>.href` 是 http(s) 且 host ≠ location.host → true（外站伪装链接，跳过 lightbox） */
function isWrappedInExternalLink(el: Element): boolean {
  const a = el.closest('a')
  if (!a || !(a instanceof HTMLAnchorElement)) return false
  const raw = a.getAttribute('href')?.trim() ?? ''
  // 空 / 锚点 / 脚本伪协议 → 论坛脚本劫持的图片预览链接，正常进 lightbox
  if (!raw || raw === '#' || /^javascript:/i.test(raw)) return false
  // data: / mailto: / tel: 等其它非 http 协议 → 不属于「外站伪装」范畴，正常进 lightbox
  let url: URL
  try {
    url = new URL(raw, location.href)
  }
  catch {
    // href 解析失败（格式异常）→ 保守当作外链？不，按论坛常见坏写法不当外链，跳过 lightbox
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.host !== location.host
}

/** 检查元素是否在白名单正文容器内（避免劫持论坛头像 / 表情 / 侧栏图） */
function isInsideArticleRoot(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(ARTICLE_ROOT_SELECTOR)
}

/** 帖子正文相关白名单（root 提升到 td.plc 后用来过滤 td.plc 内的装饰图）：
 *  - td.t_f[id^="postmessage_"]：楼层正文
 *  - .pattl：附件列表
 *  - .pcb：正文容器（含回复区的 .message 也走这条 root 分支不参与提升）
 * 头像（.avtm / uc_server/avatar.php）、在线图标（static/image/common）、签名（.sign）
 * 等 td.plc 内的装饰元素无任何上述祖先，会被 collectImagesFromRoot 跳过。 */
const POST_BODY_ANCESTOR_SELECTOR = 'td.t_f[id^="postmessage_"], .pattl, .pcb'

/** 检查 media 是否落在「帖子正文相关容器」内，用于 root 提升到 td.plc 后过滤装饰图。 */
function isInsideDiscuzPostBody(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(POST_BODY_ANCESTOR_SELECTOR)
}

/** 判断 src 是否为 SVG —— 不劫持 SVG 图 */
function isSvgUrl(src: string): boolean {
  if (!src) return false
  const noFrag = src.split('#')[0]?.split('?')[0] ?? src
  return /\.svg(\.|$)/i.test(noFrag) || /^data:image\/svg\+xml/i.test(noFrag.trim())
}

/** 判断 src 是否为 Discuz 论坛自带的 UI 元素（不是用户内容图片）。
 * Discuz 自 7.x 起将论坛内置 UI 图标统一放在 `static/image/` 下，常见子目录：
 *  - static/image/smiley    表情包
 *  - static/image/common    公共图标（在线 / 离线 / 等级 / 勋章 / 版块图标等）
 *  - static/image/filetype  附件类型图标（zip / rar / pdf 等 16×16）
 *  - static/image/magic     道具图标
 *  - static/image/admincp   后台管理图标（前台一般不会显示，兜底）
 * 这些都属于论坛模板自带 UI 元素，不是用户上传的内容图片，正文里夹杂它们对 lightbox 无意义。
 *
 * 匹配 `currentSrc` / `data-original` / `data-zoomfile` / `data-src` /
 * `data-lazy-src` / `file` / `src` 任一字段里出现上述子串即视为论坛 UI 图。
 * 大小写不敏感，避免不同论坛镜像站点路径差异。
 *
 * 用户上传的附件路径（`data/attachment/...` / `forum.php?mod=attachment` /
 * 图床 CDN 等）完全不命中，不会被误伤。 */
function isForumStaticIcon(src: string): boolean {
  if (!src) return false
  return /static\/image\/(smiley|common|filetype|magic|admincp)/i.test(src)
}

/** 从 img 元素抽 src，按优先级尝试多个属性；同时把任意候选项里包含 `smiley` 路径的表情包过滤掉 */
function readImageSrc(img: HTMLImageElement): string {
  // 1. currentSrc —— 论坛 lazy-load 后真实加载的 src（Discuz 附件链走这里）
  if (img.currentSrc && !isForumStaticIcon(img.currentSrc)) return img.currentSrc
  // 2. data-* 常见的 lazy-load 提示属性
  const dataAttrs = ['data-original', 'data-zoomfile', 'data-src', 'data-lazy-src', 'file']
  for (const attr of dataAttrs) {
    const v = img.getAttribute(attr)
    if (v && v.trim() && !isForumStaticIcon(v)) return v
  }
  // 3. fallback 到原生 src —— 表情包场景论坛常用 `<img src="static/image/smiley/...">`
  const fallback = img.getAttribute('src') ?? ''
  return isForumStaticIcon(fallback) ? '' : fallback
}

/** 从 <video> 抽 src + poster。优先取 source 元素 */
function readVideoMedia(video: HTMLVideoElement): { src: string; poster: string } {
  const sources = video.querySelectorAll('source')
  let src = ''
  for (const s of Array.from(sources)) {
    const v = s.getAttribute('src')
    if (v && v.trim()) { src = v; break }
  }
  if (!src) src = video.getAttribute('src') ?? video.currentSrc ?? ''
  const poster = video.getAttribute('poster') ?? video.poster ?? ''
  return { src, poster }
}

/** 把 root 内的 <img>/<video> 收集成 LightboxImage[]。
 * 跳过 SVG、跳过无 src、跳过纯装饰（width<40 & height<40 视情况保留，让用户自己滚轮播）。
 * 列表顺序按 DOM 顺序，便于左右翻页保持「阅读方向」。 */
function collectImagesFromRoot(root: HTMLElement): LightboxImage[] {
  const cached = rootImagesCache.get(root)
  if (cached) {
    // 已缓存：再做一次「当前可见但首次扫时不可见」的增量扫描。
    // 场景：用户先点了上半部分图（折叠区 / 回复可见图当时 display:none 被跳过），
    // 展开折叠后再次开 lightbox → 把新可见的图补进 list。
    syncNewlyVisible(root, cached)
    return cached
  }

  // 是否降级路径（root=td.plc 而非精确的 .t_fsz）：需要额外装饰过滤防御头像/签名
  const isPlcFallback = root.tagName.toLowerCase() === 'td' && root.classList.contains('plc')

  const seen = new Set<string>()
  const result: LightboxImage[] = []

  // 合并两类媒体为单个 DOM 顺序遍历（而不是按类型分组），保证轮播列表与「阅读方向」一致：
  // <td.t_f>video → <pattl>img×N> 应为 [video, img×N]，而不是 [img×N, video]。
  // 单一 querySelectorAll('img, video') 按文档顺序产出节点；
  // 按节点类型分发到对应 src 提取器，统一去重入 list。
  // iframe / embed 不再收：b 站 / youtube 等外站 iframe 在 lightbox 内高度按 150px，
  // 且 Discuz `[media]` 标签把 iframe 包在 <a target="_blank"> 里，点不到 lightbox 还会跳走。
  for (const node of Array.from(root.querySelectorAll('img, video'))) {
    if (!isElementVisible(node)) continue
    if (isWrappedInExternalLink(node)) continue
    if (isPlcFallback && !isInsideDiscuzPostBody(node)) continue
    let item: LightboxImage | null = null
    if (node instanceof HTMLImageElement) {
      const raw = readImageSrc(node)
      if (!raw || isSvgUrl(raw) || isForumStaticIcon(raw)) continue
      const normalized = raw.split('#')[0] ?? raw
      if (!normalized) continue
      item = { kind: 'image', src: normalized }
    }
    else if (node instanceof HTMLVideoElement) {
      const { src, poster } = readVideoMedia(node)
      if (!src) continue
      const key = src.split('#')[0] ?? src
      item = { kind: 'video', src: key, poster: poster || undefined }
    }
    if (!item || seen.has(item.src)) continue
    seen.add(item.src)
    result.push(item)
  }

  rootImagesCache.set(root, result)
  // 首次扫完后挂 MutationObserver —— 跟进论坛懒加载 / 翻页追加的新媒体
  ensureRootObserver(root)
  return result
}

/** 把单个 media 元素转成 LightboxImage；返回 null 表示忽略（SVG / 无 src / 已存在 / 祖先链不可见 / 被外站 <a> 包裹）。
 * root 可选：传入时若 root 是降级路径（td.plc）会同步检查装饰过滤。 */
function mediaToLightboxImage(el: Element, root?: HTMLElement): LightboxImage | null {
  if (!isElementVisible(el)) return null
  // 被外站 <a> 包裹的图片：浏览器原生「点图开新标签去外站」应保留，不劫持
  if (isWrappedInExternalLink(el)) return null
  // root 降级到 td.plc 时同步应用装饰过滤（与 collectImagesFromRoot 一致）
  if (root && root.tagName.toLowerCase() === 'td' && root.classList.contains('plc') && !isInsideDiscuzPostBody(el)) return null
  if (el instanceof HTMLImageElement) {
    const src = readImageSrc(el)
    if (!src) return null
    if (isSvgUrl(src)) return null
    if (isForumStaticIcon(src)) return null
    return { kind: 'image', src: src.split('#')[0] ?? src }
  }
  if (el instanceof HTMLVideoElement) {
    const { src } = readVideoMedia(el)
    if (!src) return null
    return { kind: 'video', src: src.split('#')[0] ?? src }
  }
  return null
}

/** 检查某 media 节点是否已经在缓存里（按 normalized src 去重） */
function hasInList(list: LightboxImage[], item: LightboxImage): boolean {
  return list.some(i => i.kind === item.kind && i.src === item.src)
}

/** 向 rootImagesCache + 当前打开的 lightbox 追加一条 LightboxImage（如果不在）。 */
function appendIfNew(root: HTMLElement, item: LightboxImage): boolean {
  const list = rootImagesCache.get(root)
  if (!list) return false
  if (hasInList(list, item)) return false
  list.push(item)
  // lightbox 已开 → 实时更新轮播；用户停留当前图，不强制跳转
  if (openState && openState.images === list) {
    updateOpenCounter()
  }
  return true
}

/** 对已缓存的 root 做一次「当前可见但首次扫时被过滤」的增量扫描并 append。
 * 复用四类 querySelectorAll 路径 + 可见性过滤。 */
function syncNewlyVisible(root: HTMLElement, list: LightboxImage[]): void {
  const isPlcFallback = root.tagName.toLowerCase() === 'td' && root.classList.contains('plc')
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img'))) {
    if (!isElementVisible(img)) continue
    if (isWrappedInExternalLink(img)) continue
    if (isPlcFallback && !isInsideDiscuzPostBody(img)) continue
    const raw = readImageSrc(img)
    if (!raw) continue
    if (isSvgUrl(raw)) continue
    if (isForumStaticIcon(raw)) continue
    const normalized = raw.split('#')[0] ?? raw
    if (!normalized) continue
    const item: LightboxImage = { kind: 'image', src: normalized }
    if (!hasInList(list, item)) {
      list.push(item)
      if (openState && openState.images === list) updateOpenCounter()
    }
  }
  for (const v of Array.from(root.querySelectorAll<HTMLVideoElement>('video'))) {
    if (!isElementVisible(v)) continue
    if (isWrappedInExternalLink(v)) continue
    if (isPlcFallback && !isInsideDiscuzPostBody(v)) continue
    const { src, poster } = readVideoMedia(v)
    if (!src) continue
    const key = src.split('#')[0] ?? src
    if (!key) continue
    const item: LightboxImage = { kind: 'video', src: key, poster: poster || undefined }
    if (!hasInList(list, item)) {
      list.push(item)
      if (openState && openState.images === list) updateOpenCounter()
    }
  }
}

/** lightbox 已开时刷新计数器 / 变换工具组显隐。封装以便 observer 多次触发 */
function updateOpenCounter(): void {
  if (!openState) return
  const item = openState.images[openState.index]
  if (!openState) return
  openState.counter.textContent = item
    ? `${openState.index + 1} / ${openState.images.length}${item.kind !== 'image' ? ' · 视频' : ''}`
    : `${openState.index + 1} / ${openState.images.length}`
  // 单张时直接隐藏翻页按钮（按钮灰显会让用户以为是 bug），多张时始终启用，边界交给 goTo 范围检查
  const hasMany = openState.images.length > 1
  openState.prevBtn.hidden = !hasMany
  openState.nextBtn.hidden = !hasMany
  // toolbar 整组淡入 / 淡出（与 mountLightbox 内部 updateCounter 同步），视频 / 嵌入时不遮挡
  openState.toolbar.classList.toggle('is-empty', !openState.currentTransformEl)
}

/** 给一个 root 挂 MutationObserver + 已见集合；同一 root 重复调用幂等 */
function ensureRootObserver(root: HTMLElement): void {
  if (rootObservers.has(root)) return
  const seen = new WeakSet<Element>()
  rootSeenMedia.set(root, seen)

  const observer = new MutationObserver((mutations) => {
    const list = rootImagesCache.get(root)
    if (!list) return

    for (const m of mutations) {
      // 1. 新增节点：可能是懒加载后续追加的 <img>
      for (const node of Array.from(m.addedNodes)) {
        if (!(node instanceof Element)) continue
        // 节点自身
        if (/^(img|video)$/i.test(node.tagName) && !seen.has(node)) {
          const item = mediaToLightboxImage(node, root)
          // mediaToLightboxImage 内部已做可见性检查；可见性失败时 item=null 且不应进 seen
          // —— 否则后续 display 切换后 observer 不会再检查它（display 变化不会触发 mutation）
          if (item) {
            seen.add(node)
            // 图片如果还没加载完（naturalWidth=0），等 onload 再正式入库
            if (node instanceof HTMLImageElement && !node.complete) {
              node.addEventListener('load', () => {
                const realSrc = readImageSrc(node)
                if (!realSrc || isSvgUrl(realSrc) || isForumStaticIcon(realSrc)) return
                const realItem: LightboxImage = { kind: 'image', src: realSrc.split('#')[0] ?? realSrc }
                if (!hasInList(list, realItem)) {
                  list.push(realItem)
                  if (openState && openState.images === list) updateOpenCounter()
                }
              }, { once: true })
            }
            else {
              appendIfNew(root, item)
            }
          }
          // item 为 null 时不标 seen —— display:none 节点后续若变可见，会在下一次
          // 用户开 lightbox 时通过 collectImagesFromRoot → syncNewlyVisible 补回
        }
        // 子树里新增的 media
        for (const child of Array.from(node.querySelectorAll('img, video'))) {
          if (seen.has(child)) continue
          const item = mediaToLightboxImage(child, root)
          // 同上：可见性失败时不标 seen，等下次 syncNewlyVisible 补
          if (!item) continue
          seen.add(child)
          if (child instanceof HTMLImageElement && !child.complete) {
            child.addEventListener('load', () => {
              const realSrc = readImageSrc(child)
              if (!realSrc || isSvgUrl(realSrc) || isForumStaticIcon(realSrc)) return
              const realItem: LightboxImage = { kind: 'image', src: realSrc.split('#')[0] ?? realSrc }
              if (!hasInList(list, realItem)) {
                list.push(realItem)
                if (openState && openState.images === list) updateOpenCounter()
              }
            }, { once: true })
          }
          else {
            appendIfNew(root, item)
          }
        }
      }

      // 2. attribute 变化：forum 懒加载用 data-original / file / data-zoomfile 替换占位 src
      if (m.type === 'attributes' && m.target instanceof HTMLImageElement) {
        const img = m.target
        // 仍标 seen —— 已尝试过；后续若 src 再变也只是重新走同一逻辑，setAttribute 不会触发新 mutation
        // 但 src 变了意味着可能是另一张图，去重靠 hasInList
        seen.add(img)
        const realSrc = readImageSrc(img)
        if (realSrc && !isSvgUrl(realSrc) && !isForumStaticIcon(realSrc)) {
          const realItem: LightboxImage = { kind: 'image', src: realSrc.split('#')[0] ?? realSrc }
          // 若原占位未入库、现在解析到真实 src → 入库
          if (!hasInList(list, realItem)) {
            list.push(realItem)
            if (openState && openState.images === list) updateOpenCounter()
          }
        }
      }
    }
  })

  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-original', 'data-zoomfile', 'data-src', 'data-lazy-src', 'file'],
  })
  rootObservers.set(root, observer)
}

/** 判定一个 click 事件是否应该被放行（保留原生行为：鼠标中键 / 右键 / 修饰键 / 非左键）。 */
function shouldBypassClick(e: MouseEvent): boolean {
  // button: 0=左, 1=中, 2=右。中键常用「在新标签页打开」；右键触发浏览器右键菜单
  if (e.button !== 0) return true
  // Ctrl / Cmd / Shift + 左键：浏览器默认「新标签页打开」行为 —— 严格放行
  if (e.ctrlKey || e.metaKey || e.shiftKey) return true
  return false
}

/** Discuz 楼层 root 提升：点视频 / 点附件图分别落在 td.t_f 与 .pattl 兄弟容器，
 * 把 root 抬升到 `.t_fsz`（Discuz 帖子的正文 + 附件大容器，天然不含头像 / 签名等装饰元素）。
 * 命中 .pcb（楼中楼）时通常找不到 .t_fsz，降级到 td.plc；后者由 collectImagesFromRoot
 * 的双层防御（isInsideDiscuzPostBody + isForumStaticIcon）兜底过滤装饰图。 */
function expandDiscuzPostRoot(root: HTMLElement): HTMLElement {
  // 仅 Discuz 楼层相关 root 提升；WordPress / 回复区 root 保持原样
  const tag = root.tagName.toLowerCase()
  const isDiscuzFloorRoot = (tag === 'td' && root.classList.contains('t_f'))
    || root.classList.contains('pattl')
    || root.classList.contains('pcb')
  if (!isDiscuzFloorRoot) return root
  // 优先 .t_fsz（精确路径）：只含 td.t_f + .pattl 等真实正文+附件，无装饰元素
  const tfsz = root.closest<HTMLElement>('.t_fsz')
  if (tfsz) return tfsz
  // 降级 td.plc：覆盖 .pcb（楼中楼）等非常规结构，靠 collectImagesFromRoot 装饰过滤兜底
  const plc = root.closest<HTMLElement>(DISCUZ_POST_CELL_SELECTOR)
  return plc ?? root
}

/** 点击元素是 <img> / <video>，并匹配 LightboxImage */
function findClickableMedia(target: Element): { root: HTMLElement; item: LightboxImage; index: number; images: LightboxImage[] } | null {
  const media = target.closest('img, video')
  if (!media) return null
  // 被外站 <a> 包裹的媒体：用户点图本意是开新标签去外站，不劫持，原生 <a> 自然触发跳转
  if (isWrappedInExternalLink(media)) return null
  const baseRoot = isInsideArticleRoot(media)
  if (!baseRoot) return null
  // Discuz 楼层把 root 提升到 td.plc，让正文视频 + 附件图合并到同一轮播
  const root = expandDiscuzPostRoot(baseRoot)
  const images = collectImagesFromRoot(root)
  if (images.length === 0) return null

  // 找到当前点击节点对应的 LightboxImage
  let item: LightboxImage | undefined
  let index = -1
  if (media instanceof HTMLImageElement) {
    const clickedSrc = readImageSrc(media).split('#')[0] ?? ''
    // 表情包防御：readImageSrc 已过滤，此处二次确认（防 observer/sync 阶段 list 包含表情包）
    if (isForumStaticIcon(clickedSrc)) return null
    index = images.findIndex(i => i.kind === 'image' && i.src === clickedSrc)
    item = images[index]
  }
  else if (media instanceof HTMLVideoElement) {
    const { src } = readVideoMedia(media)
    const key = src.split('#')[0] ?? ''
    index = images.findIndex(i => i.kind === 'video' && i.src === key)
    item = images[index]
  }
  if (!item || index < 0) return null
  return { root, item, index, images }
}

/** 点击正文内的 <img> / <video> 时打开 lightbox（iframe / embed 不再劫持，避免和外站跳转行为冲突） */
function openLightboxFromMedia(target: Element): void {
  const hit = findClickableMedia(target)
  if (!hit) return
  mountLightbox(hit.images, hit.index)
}

// ============ 模态挂载 + 渲染 ============

/** 模态样式（ShadowRoot 内） */
const LIGHTBOX_CSS = `
:host {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: block;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.lb-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
}
:host([data-theme="light"]) .lb-mask {
  background: rgba(249, 250, 251, 0.92);
}
.lb-img-wrap {
  /* overflow: visible —— 放大后图片可溢出 wrap 边缘，显示完整细节（el-image 风格）
   * wrap 本身不限制宽高，靠 .lb-img 的 max-w/h 限制「初始适应屏」尺寸；放大后视觉边界由遮罩裁掉 */
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  -webkit-user-drag: none;
  overflow: visible;
}
.lb-img {
  display: block;
  max-width: 95vw;
  max-height: 95vh;
  width: auto;
  height: auto;
  object-fit: contain;
  cursor: grab;
  transition: transform 120ms ease;
  transform-origin: center center;
}
.lb-img.is-dragging {
  cursor: grabbing;
  transition: none;
}
/* 视频：固定 max-w/h，无 transform；iframe / embed 已不再纳入 lightbox */
.lb-video {
  display: block;
  max-width: 95vw;
  max-height: 95vh;
  width: 90vw;
  height: 90vh;     /* video 默认 150px 高会给「宽 90vw × 高 1/10」效果，显式给 90vh 让控件可视 */
  background: #000;
  outline: none;
}
/* 工具栏按钮统一样式 */
.lb-btn {
  border-radius: 50%;
  border: 1px solid var(--panel-border);
  background: var(--panel-surface);
  color: var(--panel-text);
  font-size: 20px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transition: background-color 120ms ease, transform 80ms ease;
  font-family: inherit;
}
.lb-btn:hover { background: var(--panel-accent-bg); }
.lb-btn:active { transform: scale(0.95); }
.lb-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.lb-btn[aria-disabled="true"]:not(:disabled) {
  opacity: 0.3;
  cursor: not-allowed;
  pointer-events: none;
}

/* 左右切换 / 关闭按钮：贴边 */
.lb-side-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  font-size: 22px;
}
.lb-side-btn:active { transform: translateY(-50%) scale(0.95); }
.lb-prev { left: 16px; }
.lb-next { right: 16px; }
.lb-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  font-size: 18px;
}
.lb-close:hover { background: var(--panel-danger-bg); color: var(--panel-danger); }

/* 底部工具栏：缩放 / 旋转 / 重置 */
.lb-toolbar {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 22px;
  background: var(--panel-surface);
  border: 1px solid var(--panel-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
/* 视频 / 嵌入 时 toolbar 视觉隐藏 + 沉底，但不脱离布局（不触发重绘 / 抖动）。
 * 策略：背景 / 边框 / 阴影全透明 + z-index 降到 wrap 之下 + 不可点击。
 * DOM / 物理位置完全保留。 */
.lb-toolbar.is-empty {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  pointer-events: none;
  /* toolbar 默认 DOM 顺序在 wrap 之后 → 同 stacking context 中层级更高。
 * z-index:-1 让它沉到 video 之下，video controls 不再被 toolbar 边框 / 阴影遮挡。 */
  z-index: -1;
}
.lb-toolbar .lb-btn {
  width: 36px;
  height: 36px;
  font-size: 16px;
}
.lb-toolbar .lb-btn:active { transform: scale(0.95); }
.lb-toolbar .lb-reset {
  width: auto;
  padding: 0 12px;
  border-radius: 18px;
  font-size: 13px;
}
/* 变换工具组（缩放 / 旋转 / 重置）：保持 flex 容器，方便内部按钮水平排列。
 * 显隐由外层 .lb-toolbar.is-empty 整组控制。 */
.lb-transform-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* SVG 图标按钮：统一 18px，颜色走 currentColor（按钮 color） */
.lb-icon {
  width: 18px;
  height: 18px;
  fill: currentColor;
  pointer-events: none;
}
.lb-toolbar .lb-icon {
  width: 20px;
  height: 20px;
}
.lb-counter {
  position: absolute;
  bottom: 20px;
  right: 16px;
  padding: 4px 12px;
  border-radius: 12px;
  background: var(--panel-surface);
  color: var(--panel-text);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  border: 1px solid var(--panel-border);
  pointer-events: none;
}
.lb-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--panel-text-muted);
  font-size: 14px;
  pointer-events: none;
}
`

/** 创建一个工具栏/侧栏/顶栏按钮的辅助 */
function makeBtn(className: string, label: string, text: string, ariaLabel: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = className
  b.type = 'button'
  b.textContent = text
  b.setAttribute('aria-label', ariaLabel)
  b.dataset.lbLabel = label
  return b
}

/** 创建一个带 SVG 图标的按钮：innerHTML 直接注入 path。
 * 图标统一按 1em × 1em 渲染（外层 CSS .lb-btn 控制容器大小） */
function makeIconBtn(className: string, label: string, svgInner: string, ariaLabel: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = className
  b.type = 'button'
  b.setAttribute('aria-label', ariaLabel)
  b.dataset.lbLabel = label
  // SVG viewBox 固定 0 0 1024 1024，宽度 / 高度由 CSS 控 .lb-icon 类
  b.innerHTML = `<svg class="lb-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${svgInner}</svg>`
  return b
}

/** 从 src/assets/*.svg 提取出来的 path 内容（手填以避免运行时 fetch） */
const ICONS = {
  zoomIn: '<path d="M919.264 905.984l-138.912-138.912C851.808 692.32 896 591.328 896 480c0-229.376-186.624-416-416-416S64 250.624 64 480s186.624 416 416 416c95.008 0 182.432-32.384 252.544-86.208l141.44 141.44a31.904 31.904 0 0 0 45.248 0 32 32 0 0 0 0.032-45.248zM128 480C128 285.92 285.92 128 480 128s352 157.92 352 352-157.92 352-352 352S128 674.08 128 480z"></path><path d="M625.792 448H512v-112a32 32 0 0 0-64 0V448h-112a32 32 0 0 0 0 64H448v112a32 32 0 1 0 64 0V512h113.792a32 32 0 1 0 0-64z"></path>',
  shrink: '<path d="M919.264 905.984l-138.912-138.912C851.808 692.32 896 591.328 896 480c0-229.376-186.624-416-416-416S64 250.624 64 480s186.624 416 416 416c95.008 0 182.432-32.384 252.544-86.208l141.44 141.44a31.904 31.904 0 0 0 45.248 0 32 32 0 0 0 0.032-45.248zM128 480C128 285.92 285.92 128 480 128s352 157.92 352 352-157.92 352-352 352S128 674.08 128 480z"></path><path d="M625.792 448H336a32 32 0 0 0 0 64h289.792a32 32 0 1 0 0-64z"></path>',
  reset: '<path d="M502.714987 58.258904l-126.531056-54.617723a52.797131 52.797131 0 0 0-41.873587 96.855428A447.865322 447.865322 0 0 0 392.02307 946.707184a61.535967 61.535967 0 0 0 13.83649 1.820591 52.797131 52.797131 0 0 0 13.65443-103.773672 342.453118 342.453118 0 0 1-31.678278-651.771485l-8.374718 19.480321a52.615072 52.615072 0 0 0 27.855039 69.182448 51.522718 51.522718 0 0 0 20.572675 4.369418A52.797131 52.797131 0 0 0 476.498481 254.882703L530.205907 127.441352a52.979191 52.979191 0 0 0-27.49092-69.182448zM962.960326 509.765407A448.775617 448.775617 0 0 0 643.992829 68.090094a52.797131 52.797131 0 1 0-30.403866 101.042786A342.635177 342.635177 0 0 1 674.578753 801.059925a52.615072 52.615072 0 0 0-92.30395-50.612422l-71.913335 117.246043a52.433013 52.433013 0 0 0 17.295612 72.82363l117.063985 72.823629a52.797131 52.797131 0 1 0 54.617722-89.755123l-16.021198-10.013249A448.593558 448.593558 0 0 0 962.960326 509.765407z"></path>',
  rotateLeft: '<path d="M512 136.533333c-98.133333 0-187.733333 34.133333-260.266667 93.866667V98.133333c0-8.533333-4.266667-12.8-12.8-12.8h-38.4c-4.266667 0-12.8 4.266667-12.8 12.8v221.866667h226.133334c8.533333 0 12.8-4.266667 12.8-12.8v-34.133333c0-8.533333-4.266667-12.8-12.8-12.8H315.733333c55.466667-38.4 123.733333-59.733333 196.266667-59.733334 187.733333 0 341.333333 153.6 341.333333 341.333334s-153.6 341.333333-341.333333 341.333333c-183.466667 0-337.066667-145.066667-341.333333-328.533333 0-8.533333-4.266667-12.8-12.8-12.8h-38.4c-8.533333 0-12.8 4.266667-12.8 12.8 8.533333 213.333333 187.733333 384 405.333333 384 221.866667 0 405.333333-179.2 405.333333-401.066667S733.866667 136.533333 512 136.533333z"></path>',
  rotateRight: '<path d="M904.533333 537.6h-38.4c-8.533333 0-12.8 4.266667-12.8 12.8-8.533333 183.466667-157.866667 328.533333-341.333333 328.533333-187.733333 0-341.333333-153.6-341.333333-341.333333s153.6-341.333333 341.333333-341.333333c72.533333 0 140.8 21.333333 196.266667 59.733333h-102.4c-8.533333 0-12.8 4.266667-12.8 12.8v34.133333c0 8.533333 4.266667 12.8 12.8 12.8h226.133333V98.133333c0-8.533333-4.266667-12.8-12.8-12.8h-38.4c-8.533333 0-12.8 4.266667-12.8 12.8v132.266667c-68.266667-59.733333-157.866667-93.866667-256-93.866667-221.866667 0-405.333333 179.2-405.333333 401.066667S290.133333 938.666667 512 938.666667c217.6 0 396.8-170.666667 405.333333-388.266667 0-8.533333-4.266667-12.8-12.8-12.8z"></path>',
}

/** 根据 LightboxImage 创建一个媒体元素（图片用 <img>，视频用 <video controls>）。
 *  返回的元素不带任何 transform —— goTo 时再设 src 触发加载。 */
function createMediaEl(item: LightboxImage): HTMLElement {
  if (item.kind === 'image') {
    const img = document.createElement('img')
    img.className = 'lb-img'
    img.alt = ''
    return img
  }
  // video（iframe/embed 已不再收，类型层无 'embed'）
  const v = document.createElement('video')
  v.className = 'lb-video'
  v.controls = true
  v.preload = 'metadata'
  v.playsInline = true
  if (item.poster) v.poster = item.poster
  v.src = item.src
  return v
}

/** 挂模态到 body 末尾 */
function mountLightbox(images: LightboxImage[], startIndex: number): void {
  // 单例：已打开则先关闭
  if (openState) closeLightbox()

  const host = document.createElement('div')
  host.setAttribute(LIGHTBOX_HOST_ATTR, '')
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.appendChild(buildThemedStyle())

  const style = document.createElement('style')
  style.textContent = LIGHTBOX_CSS
  shadow.appendChild(style)

  const mask = document.createElement('div')
  mask.className = 'lb-mask'

  const wrap = document.createElement('div')
  wrap.className = 'lb-img-wrap'

  const initial = images[startIndex]
  if (!initial) return
  const media = createMediaEl(initial)
  wrap.appendChild(media)

  const prevBtn = makeBtn('lb-btn lb-side-btn lb-prev', 'prev', '‹', '上一张')
  const nextBtn = makeBtn('lb-btn lb-side-btn lb-next', 'next', '›', '下一张')
  const closeBtn = makeBtn('lb-btn lb-close', 'close', '✕', '关闭')

  // 工具栏（底部居中）：从左到右 缩小 / 放大 / 重置 / 左旋转 / 右旋转
  const toolbar = document.createElement('div')
  toolbar.className = 'lb-toolbar'
  // 仅对图片生效的变换工具（缩放 / 旋转 / 重置）：视频 / 嵌入 时整组淡出隐藏
  const transformTools = document.createElement('div')
  transformTools.className = 'lb-transform-tools'
  const zoomOutBtn = makeIconBtn('lb-btn', 'zoom-out', ICONS.shrink, '缩小')
  const zoomInBtn = makeIconBtn('lb-btn', 'zoom-in', ICONS.zoomIn, '放大')
  const resetBtn = makeIconBtn('lb-btn lb-reset', 'reset', ICONS.reset, '恢复原始尺寸')
  const rotateCcwBtn = makeIconBtn('lb-btn', 'rotate-ccw', ICONS.rotateLeft, '逆时针旋转 90°')
  const rotateCwBtn = makeIconBtn('lb-btn', 'rotate-cw', ICONS.rotateRight, '顺时针旋转 90°')
  transformTools.append(zoomOutBtn, zoomInBtn, resetBtn, rotateCcwBtn, rotateCwBtn)
  toolbar.append(transformTools)

  const counter = document.createElement('div')
  counter.className = 'lb-counter'

  mask.append(wrap, prevBtn, nextBtn, closeBtn, toolbar, counter)
  shadow.appendChild(mask)
  document.body.appendChild(host)

  // 主题跟随：复用 applyPanelTheme
  markThemedHost(host)
  void applyPanelTheme(host)

  const state: OpenState = {
    host,
    shadow,
    media,
    counter,
    prevBtn,
    nextBtn,
    closeBtn,
    zoomOutBtn,
    zoomInBtn,
    rotateCcwBtn,
    rotateCwBtn,
    resetBtn,
    toolbar,
    mask,
    wrap,
    images,
    index: startIndex,
    currentTransformEl: initial.kind === 'image' ? media : null,
    cleanup: () => {},
  }
  openState = state

  // ============ 交互绑定 ============

  // 变换状态：scale=1 是「适应屏基线」；fitScale100 反推「100% 原图」对应的缩放乘子
  let scale = 1
  let rotation: Rotation = 0
  let fitScale100 = 1
  let offsetX = 0
  let offsetY = 0

  function getTargetEl(): HTMLElement {
    // 非图片时（video）getTargetEl 返回 wrap 容器，但 transform 不应用
    return state.currentTransformEl ?? state.wrap
  }

  function applyTransform(): void {
    const el = getTargetEl()
    if (state.currentTransformEl) {
      const real = scale * fitScale100
      el.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${real}) rotate(${rotation}deg)`
    }
    else {
      el.style.transform = ''
    }
  }

  function clampScale(v: number): number {
    if (v < SCALE_MIN) return SCALE_MIN
    if (v > SCALE_MAX) return SCALE_MAX
    return v
  }
  function setScale(v: number): void {
    if (!state.currentTransformEl) return
    scale = clampScale(v)
    applyTransform()
  }
  function setRotation(r: Rotation): void {
    if (!state.currentTransformEl) return
    rotation = r
    applyTransform()
  }
  function resetTransform(): void {
    scale = 1
    rotation = 0
    offsetX = 0
    offsetY = 0
    applyTransform()
  }

  /** 根据当前图片自然尺寸 + 容器上限反推 fitScale100。
   * 调用时机：图片 onload 后调用一次；切图后新图 onload 时再更新。
   * wrap 已改为 overflow: visible，初始 base 渲染尺寸来自 img 自身 max-w/h (95vw/95vh) + object-fit: contain，
   * 直接读 clientWidth / clientHeight 即「初始适应屏」大小。 */
  function recomputeFitScale(): void {
    if (!state.currentTransformEl) return
    const target = state.media
    if (!(target instanceof HTMLImageElement)) return
    const nW = target.naturalWidth
    const nH = target.naturalHeight
    if (!nW || !nH) {
      fitScale100 = 1
      applyTransform()
      return
    }
    const baseW = target.clientWidth
    const baseH = target.clientHeight
    if (!baseW || !baseH) {
      fitScale100 = 1
      applyTransform()
      return
    }
    // fitScale100 = 把当前 base 放大到 100% 自然像素所需的乘子；base 已被 max-w/h 限到 95vw/95vh
    fitScale100 = nW / baseW
    applyTransform()
  }

  // 计数器更新 + 整组工具栏显隐（缩放旋转仅对 image 有效，视频时 toolbar 整体淡出 + 下沉）
  function updateCounter(): void {
    const item = state.images[state.index]
    counter.textContent = item
      ? `${state.index + 1} / ${state.images.length}${item.kind !== 'image' ? ' · 视频' : ''}`
      : `${state.index + 1} / ${state.images.length}`
    // 单张时直接隐藏翻页（按钮灰显会让用户以为是 bug）；多张时始终启用，
    // 边界处理交给 goTo 内的 index 范围检查即可，next/prev 在头尾禁用 = 仅末尾提示
    const hasMany = state.images.length > 1
    prevBtn.hidden = !hasMany
    nextBtn.hidden = !hasMany
    // toolbar 整组淡入 / 淡出 + 微下沉（CSS 过渡），避免视频底部被工具栏遮挡
    toolbar.classList.toggle('is-empty', !state.currentTransformEl)
  }

  /** 切到指定 index，替换媒体元素。图片用预加载避免闪烁；视频直接挂 src。 */
  function goTo(nextIndex: number): void {
    if (nextIndex < 0 || nextIndex >= state.images.length) return
    const item = state.images[nextIndex]
    if (!item) return

    state.index = nextIndex

    // 移除旧媒体（释放图片解码内存 / 暂停视频）
    if (state.media instanceof HTMLVideoElement) state.media.pause()
    state.media.remove()

    // 创建新媒体
    const newMedia = createMediaEl(item)
    wrap.appendChild(newMedia)

    // 替换 state 引用 + 复位 transform
    state.media = newMedia
    state.currentTransformEl = item.kind === 'image' ? newMedia : null
    scale = 1
    rotation = 0
    offsetX = 0
    offsetY = 0

    // 图片走预加载（避免 src 替换空白闪烁）；视频不用
    if (item.kind === 'image') {
      const src = item.src
      const preloader = new Image()
      preloader.onload = () => {
        if (openState !== state || state.index !== nextIndex) return
        ;(newMedia as HTMLImageElement).src = src
        recomputeFitScale()
        updateCounter()
      }
      preloader.onerror = () => {
        if (openState !== state || state.index !== nextIndex) return
        updateCounter()
      }
      preloader.src = src
    }
    else {
      // 视频 createMediaEl 时已经设了 src —— 不需要再动
      // 对视频，再调一次 onloadedmetadata 之后重置 fitScale100（仅视频可视，无意义，跳过）
      updateCounter()
    }

    // 图片：默认 100% 自然尺寸 或 适应屏？这里保持「适应屏」（scale=1），即不做额外操作
    applyTransform()
    updateCounter()
  }

  function prev(): void {
    if (state.images.length <= 1) return
    goTo((state.index - 1 + state.images.length) % state.images.length)
  }
  function next(): void {
    if (state.images.length <= 1) return
    goTo((state.index + 1) % state.images.length)
  }

  function close(): void {
    closeLightbox()
  }

  // 滚轮缩放（挂在 wrap，避免冒泡导致页面滚动）
  wrap.addEventListener('wheel', (e) => {
    if (!state.currentTransformEl) return
    e.preventDefault()
    const step = scale > 2 ? 0.2 : scale > 0.5 ? 0.1 : 0.05
    const factor = e.deltaY < 0 ? 1 + step : 1 / (1 + step)
    setScale(scale * factor)
  }, { passive: false })

  // 双击切换「适应屏 ↔ 100% 原图」（仅图片）
  wrap.addEventListener('dblclick', (e) => {
    if (!state.currentTransformEl) return
    e.preventDefault()
    e.stopPropagation()
    const atFit = Math.abs(scale - 1) < 0.01
    if (atFit) {
      setScale(fitScale100)
      offsetX = 0
      offsetY = 0
      applyTransform()
    }
    else {
      resetTransform()
    }
  })

  // 拖拽平移（仅图片）
  let dragging = false
  let dragStartX = 0
  let dragStartY = 0
  let movedPx = 0
  /** mousedown 时锁定的「当前 offset 基线」 —— 后续 onMouseMove 在基线之上累加。
   * 这样第二次拖放时新拖动 = `oldOffset + delta`，图片不会因为 mousedown 落在新点而跳回起点附近。 */
  let dragBaseX = 0
  let dragBaseY = 0
  /** 拖拽刚结束 —— 阻止紧随其后的 click 事件，避免浏览器把它计成「dblclick 的第一次」触发 100% 切换复位 offset。
   * 实现：mouseup 时挂一个 once click 监听器，stopPropagation + preventDefault 吞掉那个 click。 */
  function swallowClickAfterDrag(): void {
    const swallow = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
    }
    document.addEventListener('click', swallow, true)
    setTimeout(() => document.removeEventListener('click', swallow, true), 50)
  }

  wrap.addEventListener('mousedown', (e) => {
    // 视频上点击视频控件区域不应该触发拖拽
    if (!state.currentTransformEl) return
    // 只响应左键；Ctrl/Cmd 放行浏览器原生行为
    if (e.button !== 0) return
    if (e.ctrlKey || e.metaKey) return
    dragging = true
    movedPx = 0
    dragStartX = e.clientX
    dragStartY = e.clientY
    // 锁定当前 offset 作为基线 —— 二次拖放从此处继续偏移，不会跳回 (0,0) 附近
    dragBaseX = offsetX
    dragBaseY = offsetY
    state.media.classList.add('is-dragging')
    e.preventDefault()
  })

  function onMouseMove(e: MouseEvent): void {
    if (!dragging || !openState || !state.currentTransformEl) return
    const dx = e.clientX - dragStartX
    const dy = e.clientY - dragStartY
    movedPx = Math.max(movedPx, Math.hypot(dx, dy))
    // 新 offset = 基线 + 本次位移 —— 支持连续多次拖拽
    offsetX = dragBaseX + dx
    offsetY = dragBaseY + dy
    applyTransform()
  }
  function onMouseUp(): void {
    if (!dragging || !openState) return
    dragging = false
    if (state.media) state.media.classList.remove('is-dragging')
    // 移动距离达阈值 —— 本次是「拖拽」而非「点击」，吞掉紧随其后的 click（避免浏览器把它计入 dblclick）
    if (movedPx >= CLICK_DRAG_THRESHOLD_PX) {
      swallowClickAfterDrag()
    }
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)

  // 触摸：单指拖拽 + 双指捏合缩放（仅图片）
  let touchStartX = 0
  let touchStartY = 0
  /** 单指 touchstart 时的 offset 基线 —— 与鼠标拖拽一致，支持连续多次拖拽 */
  let touchBaseX = 0
  let touchBaseY = 0
  let pinchStartDist = 0
  let pinchStartScale = 1
  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0]
      if (!t) return
      touchStartX = t.clientX
      touchStartY = t.clientY
      // 锁定当前 offset 作为基线 —— 二次拖放从此处继续偏移
      touchBaseX = offsetX
      touchBaseY = offsetY
      pinchStartDist = 0
    }
    else if (e.touches.length === 2 && state.currentTransformEl) {
      const [t1, t2] = [e.touches[0], e.touches[1]]
      if (!t1 || !t2) return
      pinchStartDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
      pinchStartScale = scale
    }
  }, { passive: true })
  wrap.addEventListener('touchmove', (e) => {
    if (!openState) return
    if (e.touches.length === 1 && state.currentTransformEl) {
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - touchStartX
      const dy = t.clientY - touchStartY
      // 新 offset = 基线 + 本次位移 —— 支持连续多次拖拽
      offsetX = touchBaseX + dx
      offsetY = touchBaseY + dy
      applyTransform()
    }
    else if (e.touches.length === 2 && pinchStartDist > 0 && state.currentTransformEl) {
      const [t1, t2] = [e.touches[0], e.touches[1]]
      if (!t1 || !t2) return
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
      const ratio = dist / pinchStartDist
      setScale(pinchStartScale * ratio)
      e.preventDefault()
    }
  }, { passive: false })
  wrap.addEventListener('touchend', () => {
    pinchStartDist = 0
  })

  // 点击遮罩关闭（点击媒体本身不关闭）
  function onMaskMouseDown(e: MouseEvent): void {
    if (e.target !== mask) return
    const startX = e.clientX
    const startY = e.clientY
    const onUp = (upE: MouseEvent) => {
      document.removeEventListener('mouseup', onUp)
      const moved = Math.hypot(upE.clientX - startX, upE.clientY - startY)
      if (moved < CLICK_DRAG_THRESHOLD_PX && openState) close()
    }
    document.addEventListener('mouseup', onUp)
  }
  mask.addEventListener('mousedown', onMaskMouseDown)

  // 按钮
  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); prev() })
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); next() })
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close() })
  zoomOutBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    setScale(scale / ZOOM_STEP_FACTOR)
  })
  zoomInBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    setScale(scale * ZOOM_STEP_FACTOR)
  })
  rotateCcwBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    setRotation(((rotation + 270) % 360) as Rotation)
  })
  rotateCwBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    setRotation(((rotation + 90) % 360) as Rotation)
  })
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    resetTransform()
  })

  // 键盘
  function onKeydown(e: KeyboardEvent): void {
    if (!openState) return
    if (e.key === 'Escape') { close(); e.preventDefault() }
    else if (e.key === 'ArrowLeft') { prev(); e.preventDefault() }
    else if (e.key === 'ArrowRight') { next(); e.preventDefault() }
    else if (e.key === 'Home') { goTo(0); e.preventDefault() }
    else if (e.key === 'End') { goTo(state.images.length - 1); e.preventDefault() }
    else if (e.key === ' ' && state.media instanceof HTMLVideoElement) {
      // Space 切换视频播放 / 暂停（HTML5 video 默认控件就有 Space 行为，这里显式补一层）
      if (state.media.paused) void state.media.play()
      else state.media.pause()
      e.preventDefault()
    }
  }
  document.addEventListener('keydown', onKeydown, true)

  state.cleanup = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.removeEventListener('keydown', onKeydown, true)
    mask.removeEventListener('mousedown', onMaskMouseDown)
  }

  // 初始：图片走预加载拿 onload 再算 fitScale100；视频已经挂 src
  const first = state.images[startIndex]
  if (first && first.kind === 'image') {
    const preloader = new Image()
    preloader.onload = () => {
      if (openState !== state || state.index !== startIndex) return
      ;(state.media as HTMLImageElement).src = first.src
      recomputeFitScale()
      updateCounter()
    }
    preloader.onerror = () => {
      if (openState !== state || state.index !== startIndex) return
      updateCounter()
    }
    preloader.src = first.src
  }
  updateCounter()
}

/** 关闭并清理 */
function closeLightbox(): void {
  if (!openState) return
  const state = openState
  openState = null
  state.cleanup()
  // 暂停视频，释放解码内存
  if (state.media instanceof HTMLVideoElement) {
    state.media.pause()
  }
  state.media.remove()
  state.host.remove()
}

/** document 级 click 事件代理 —— 找到正文内 <img>/<video> 就劫持（iframe / embed 不再劫持） */
function onDocClick(e: MouseEvent): void {
  // 已打开时不再处理外部 click（避免误触第二次打开）
  if (openState) return
  if (shouldBypassClick(e)) return
  const target = e.target
  if (!(target instanceof Element)) return
  // 找最近的 media 节点
  let media = target.closest('img, video')
  if (!media) {
    // 点击点在媒体容器空白处（如 <pattl> 包 <ignore_js_op> 包 <img>）时，
    // target 落到容器上而不是 img —— closest 向上找祖先也找不到。
    // 主动 querySelector 子树里的第一张候选。
    media = target.querySelector('img, video')
  }
  if (!media) return
  if (!isInsideArticleRoot(media)) return
  // SVG / 表情包 / 外站 <a> 包裹：不能进 lightbox，也不能吞事件 —— 让浏览器原生行为照旧
  if (media instanceof HTMLImageElement) {
    const src = readImageSrc(media)
    if (isSvgUrl(src) || isForumStaticIcon(src)) return
  }
  if (isWrappedInExternalLink(media)) return
  // 是正文里的可劫持媒体：阻止冒泡到外层 <a> 触发跳转
  e.preventDefault()
  e.stopPropagation()
  openLightboxFromMedia(media)
}

/** 入口：注册全局 click 代理。重复调用幂等
 * 同步实现 —— 内部不读 storage，无需 await ensureStorageReady()；
 * 改为 async 反而引入竞态：两次连续调用之间第一次的 await 还没 resolve，attribute
 * 还没设上，第二次会重复挂载 click 监听器。保持同步签名最稳。 */
export function enableLightbox(): void {
  if (document.documentElement.hasAttribute('data-crxjs-lightbox-installed')) return
  document.documentElement.setAttribute('data-crxjs-lightbox-installed', '')
  // 捕获阶段优先拦截 —— 在论坛 onclick 之前拦下
  document.addEventListener('click', onDocClick, true)
}