/**
 * 论坛登录状态检测
 */

/**
 * Discuz 顶部"欢迎 XXX"区，可能的 ID/class 选择器
 */
const AUTHENTICATED_INDICATORS = [
  '#myprompt',
  '#fx_checkin_topb',
  'a[href*="logging.php?action=logout"]',
  '#mn_userinfo a[href*="logging.php?action=logout"]',
  '#mn_userinfo a[href^="home.php?mod=space&uid="]',
  '#umenu a[href*="logging.php?action=logout"]',
  '#umenu a[href^="home.php?mod=space&uid="]',
  '.user-info a[href*="logging.php?action=logout"]',
  '.user-info a[href^="home.php?mod=space&uid="]',
  '#user-info a[href*="logging.php?action=logout"]',
  '#user-info a[href^="home.php?mod=space&uid="]',
  '.userbox a[href*="logging.php?action=logout"]',
  '.userbox a[href^="home.php?mod=space&uid="]',
]

/** Discuz 未登录时页面会出现"登录/注册"链接的特征。 */
const LOGIN_INDICATORS = [
  'a[href*="logging.php?action=login"]',
  'a[href*="member.php?mod=logging"]',
  '.login-btn',
  '#login-btn',
]

/**
 * 判断当前页面是否处于登录状态
 * 通过检测 Discuz 顶部导航的用户元素来判断
 */
export function isLoggedIn(): boolean {
  // 1. 退出登录、个人空间等标志比通用容器可靠
  for (const sel of AUTHENTICATED_INDICATORS) {
    if (document.querySelector(sel)) {
      return true
    }
  }

  // 2. 登录链接不单独作为登录凭据，避免通用登录容器造成误判
  const hasLoginLink = LOGIN_INDICATORS.some(sel => document.querySelector(sel))
  if (hasLoginLink) return false

  // 3. auth 是 Discuz 登录 Cookie，saltkey 单独存在也可能属于访客
  const authCookie = document.cookie.match(/(?:^|;\s*)auth=([^;]+)/)
  return Boolean(authCookie?.[1]?.trim() && authCookie[1].trim() !== 'deleted')
}

/**
 * 给用户看的提示
 */
export function getLoginHint(): string {
  return '请先登录论坛后再使用签到功能'
}
