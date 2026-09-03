import { ENABLED_SITES, FLOAT_BUTTON_HOSTS, UPLOAD_HOST } from '../global.ts'

export { UPLOAD_HOST }

/**
 * 插件启用站点判断。
 * 用处：
 *  - popup 打开时检测当前 tab 是否在全局站点列表，是 → 显示插件功能；否 → 提示非可用网站。
 *  - manifest.content_scripts.matches 直接从 src/global.ts 的 ENABLED_SITES 生成。
 */
/** 判断 hostname 是否在白名单 */
export function isEnabledSite(hostname: string): boolean {
  return ENABLED_SITES.some(
    (site) => hostname === site || hostname.endsWith(`.${site}`),
  )
}

/** 判断浮动按钮是否应在当前页面显示 */
export function isFloatButtonSite(hostname: string): boolean {
  return FLOAT_BUTTON_HOSTS.some(site => hostname === site)
}

/** 判断是否为图床上传通道 */
export function isUploadHost(hostname: string): boolean {
  return hostname === UPLOAD_HOST
}
