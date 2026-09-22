<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue'
// DEFAULT_PAGE_SIZE / FLOAT_BTN_HIDDEN_KEY / MESSAGE_TYPES / SIDEPANEL_ALIVE_PORT 都在下方主体中使用
import { DEFAULT_PAGE_SIZE, FLOAT_BTN_HIDDEN_KEY, MESSAGE_TYPES, SIDEPANEL_ALIVE_PORT } from '@/global'
import type { Favorite, ForumCount, ForumCounts, ForumTab, Friend, LoginStatus, Thread } from '@/type'
import ForumList from '@/sidepanel/components/ForumList.vue'
import ImageHostView from '@/sidepanel/components/ImageHostView.vue'
import SearchView from '@/sidepanel/components/SearchView.vue'
// fetchViaContent / getActiveTab / createRequestCache / getPageCount / getRequestPageCount / itemsForDisplayPage / normalizePage / type RequestCache / ensureStorageReady / FORUM_THEME_KEY / effectiveTheme 都在下方主体使用
import { fetchViaContent, getActiveTab } from '@/utils/extension'
import { createRequestCache, getPageCount, getRequestPageCount, itemsForDisplayPage, normalizePage, type RequestCache } from '@/utils/pagination'
import { ensureStorageReady } from '@/utils/storage-init'
import { FORUM_THEME_KEY, effectiveTheme } from '@/utils/theme'
import type { ForumTheme } from '@/type'
import userIcon from '@/assets/user.svg'
import searchIcon from '@/assets/search.svg'
import imageHostIcon from '@/assets/imgs.svg'

type LoadingState = 'idle' | 'loading' | 'error'
type PanelOption = 'profile' | 'search' | 'image-host'

const activeTab = ref<ForumTab>('threads')
const activeOption = ref<PanelOption>('profile')
const panelOptions = [
  { id: 'profile', label: '我的', icon: userIcon },
  { id: 'search', label: '搜索', icon: searchIcon },
  { id: 'image-host', label: '图床', icon: imageHostIcon },
] as const
const loginStatus = ref<LoginStatus>('unknown')
const currentUid = ref<string | null>(null)
const currentHost = ref<string>('')
const activeTabId = ref<number | null>(null)

const threadsCache = ref<RequestCache<Thread>>(createRequestCache())
const favoritesCache = ref<RequestCache<Favorite>>(createRequestCache())
const friendsCache = ref<RequestCache<Friend>>(createRequestCache())

const threadsCount = ref<ForumCount | null>(null)
const favoritesCount = ref<ForumCount | null>(null)
const friendsCount = ref<ForumCount | null>(null)

const threadsPage = ref(1)
const favoritesPage = ref(1)
const friendsPage = ref(1)

function targetItemsForPage(page: number, count: ForumCount | null): number {
  // 目标：保证「第 page 页」所需的累计条数到齐。
  // - 有真实 pages: 取 min(pages*pageSize, page*pageSize) —— 不会拉超出页数的条目
  // - 没 pages: 用 page * count.pageSize（已 parseDocumentPageSize 修过、能拿真实 pageSize），
  //   没 pageSize 时 fallback DEFAULT_PAGE_SIZE
  //
  // 关键：用 count.pageSize 而不是 DEFAULT_PAGE_SIZE —— 用户改过每页数时，
  // count.pageSize 反映「这一页实际展示数」，用它算 target 不会拉多余的 page=2。
  // 数据少到不渲染 .pg（pages=null）但 pageSize 从 items 数拿到时也走这条路径。
  //
  // 不能用 count.total 截断：loadList 末尾会把 cache.items.length 写进
  // count.total 兜底，但 cache.items.length 实际只是「已加载」不是「真实总数」。
  // 当真实总数解析不到（收藏页 .tbmu 没有），total = cache.items.length = 20，
  // page=2 时 Math.min(20, 40) = 20 → ensureCached 不进 while → 翻页列表变空。
  const normalizedPage = Math.max(1, page)
  const effectivePageSize = count?.pageSize ?? DEFAULT_PAGE_SIZE
  if (count?.pages != null && count.pages > 0) {
    return Math.min(count.pages * effectivePageSize, normalizedPage * effectivePageSize)
  }
  return normalizedPage * effectivePageSize
}

const threads = computed(() => itemsForDisplayPage(threadsCache.value.items, threadsPage.value))
const favorites = computed(() => itemsForDisplayPage(favoritesCache.value.items, favoritesPage.value))
const friends = computed(() => itemsForDisplayPage(friendsCache.value.items, friendsPage.value))

const threadsState = ref<LoadingState>('idle')
const favoritesState = ref<LoadingState>('idle')
const friendsState = ref<LoadingState>('idle')
const countsState = ref<LoadingState>('idle')

const errorMsg = ref('')
const countErrorMsg = ref('')

async function probe(tab?: chrome.tabs.Tab) {
  tab ??= await getActiveTab()

  if (!tab?.id || !tab.url) {
    loginStatus.value = 'unknown'
    currentUid.value = null
    activeTabId.value = null
    currentHost.value = ''
    return
  }

  activeTabId.value = tab.id

  try {
    currentHost.value = new URL(tab.url).hostname
  }
  catch {
    currentHost.value = ''
  }

  try {
    const [probeRes, uidRes] = await Promise.all([
      chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.PROBE_LOGIN }),
      chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.GET_UID }),
    ])

    loginStatus.value = probeRes?.loggedIn ? 'logged-in' : 'logged-out'
    currentUid.value = uidRes?.uid ?? null
  }
  catch (err) {
    loginStatus.value = 'unknown'
    currentUid.value = null
    console.warn('[side panel] probe failed:', err)
  }

  return tab.id
}

async function loadCounts(): Promise<boolean> {
  if (!activeTabId.value) activeTabId.value = await getActiveTab().then(t => t?.id ?? null)
  if (!activeTabId.value) {
    countErrorMsg.value = '找不到当前标签页'
    countsState.value = 'error'
    return false
  }

  countsState.value = 'loading'
  countErrorMsg.value = ''
  try {
    const counts = await fetchViaContent<ForumCounts>(activeTabId.value, MESSAGE_TYPES.FETCH_COUNTS)
    threadsCount.value = counts.threads
    favoritesCount.value = counts.favorites
    friendsCount.value = counts.friends
    threadsPage.value = normalizePage(threadsPage.value, pageCountFor(threadsCount.value))
    favoritesPage.value = normalizePage(favoritesPage.value, pageCountFor(favoritesCount.value))
    friendsPage.value = normalizePage(friendsPage.value, pageCountFor(friendsCount.value))
    countsState.value = 'idle'
    return true
  }
  catch (e) {
    countErrorMsg.value = `加载数量失败：${(e as Error).message}`
    countsState.value = 'error'
    return false
  }
}

function totalFor(count: ForumCount | null): number | null {
  return count?.total ?? null
}

function pageCountFor(count: ForumCount | null): number {
  // 优先用 .pg 解析出的"共 X 页"——帖子/收藏/好友的 total 经常解析不到，但页数总能拿到。
  // pages×pageSize 作 total 用做兜底，避免 total=null 导致 getPageCount=null=1 分页条不显示。
  if (count?.pages != null && count.pages > 0) return count.pages
  return getPageCount(totalFor(count), DEFAULT_PAGE_SIZE)
}


/** 拉一页数据。
 *
 * 约定：返回 0 条 = 「这一页就是没有数据」 = `reachedEnd=true`。
 * 不抛错、不重试、不区分 page=1 还是 page>1 —— 调用方拿 0 条一律视为末尾。
 * 只有 fetchViaContent 自身抛错（HTTP 错误 / content script 未注入等真异常）
 * 才会向上冒泡到 loadList → UI 显示「加载{label}失败：…」。 */
async function fetchPage<T>(page: number, messageType: string): Promise<T[]> {
  return fetchViaContent<T[]>(activeTabId.value!, messageType, { page })
}

async function ensureCached<T>(cache: RequestCache<T>, targetCount: number, messageType: string): Promise<void> {
  if (!activeTabId.value) throw new Error('找不到当前标签页')

  while (!cache.reachedEnd && cache.items.length < targetCount) {
    const remaining = targetCount - cache.items.length
    const batchSize = cache.firstBatchSize ?? DEFAULT_PAGE_SIZE
    const pagesToRequest = getRequestPageCount(remaining, batchSize)
    let requestedPages = 0

    while (
      requestedPages < pagesToRequest
      && !cache.reachedEnd
      && cache.items.length < targetCount
    ) {
      const page = cache.nextRequestPage
      const items = await fetchPage<T>(page, messageType)
      cache.nextRequestPage = page + 1
      requestedPages += 1

      // 0 条 = 末尾：不论 page=1 还是 page>1。
      // 早前 v1.0.10/v1.0.15 试图对 page>1 抛错或重试，但用户体验不好：
      // - 重试让正常翻页也要等 ~1.5s 才渲染
      // - 抛错让用户以为扩展坏了，实际论坛 page>1 偶发 0 条是已知常态
      // 现在统一按「服务端返回啥就信啥」处理 —— 0 条直接结束，后续翻页由
      // reachedEnd 自然兜住，UI 永远显示「已加载 N 条」而不闪错误。
      if (items.length === 0) {
        cache.reachedEnd = true
        break
      }

      const previousBatchSize = cache.firstBatchSize
      if (cache.firstBatchSize === null) cache.firstBatchSize = items.length
      cache.items.push(...items)
      if (previousBatchSize !== null && items.length < batchSize) {
        cache.reachedEnd = true
        break
      }
    }
  }
}

function resetRequestCaches() {
  threadsCache.value = createRequestCache<Thread>()
  favoritesCache.value = createRequestCache<Favorite>()
  friendsCache.value = createRequestCache<Friend>()
  threadsPage.value = 1
  favoritesPage.value = 1
  friendsPage.value = 1
}

// loadList<T>：帖子/收藏/好友三个 tab 共用的「加载指定页」流程。
// 三个 loadX 函数只是配置不同的 cache/count/page/state/messageType/label。
// 错误信息「加载{label}失败」由 label 决定，所以「帖子/收藏/好友」区分保留。
async function loadList<T>(
  opts: {
    cache: Ref<RequestCache<T>>
    count: Ref<ForumCount | null>
    page: Ref<number>
    state: Ref<LoadingState>
    messageType: string
    label: string
  },
  page?: number,
): Promise<void> {
  if (!activeTabId.value) activeTabId.value = await getActiveTab().then(t => t?.id ?? null)
  if (!activeTabId.value) {
    errorMsg.value = '找不到当前标签页'
    opts.state.value = 'error'
    return
  }
  const nextPage = normalizePage(page ?? opts.page.value, pageCountFor(opts.count.value))
  opts.page.value = nextPage
  opts.state.value = 'loading'
  errorMsg.value = ''
  try {
    await ensureCached(
      opts.cache.value,
      targetItemsForPage(nextPage, opts.count.value),
      opts.messageType,
    )
    // dead code (v1.0.13 已让 displayCount 不读 total)，保留作为防御。
    // 后续单独 PR 清。
    if (opts.count.value?.total === null) {
      opts.count.value = { ...opts.count.value, total: opts.cache.value.items.length }
    }
    else if (opts.count.value === null) {
      opts.count.value = { total: opts.cache.value.items.length, pageSize: opts.cache.value.firstBatchSize, pages: null }
    }
    opts.state.value = 'idle'
  }
  catch (e) {
    errorMsg.value = `加载${opts.label}失败：${(e as Error).message}`
    opts.state.value = 'error'
  }
}

async function loadThreads(page = threadsPage.value) {
  return loadList({
    cache: threadsCache,
    count: threadsCount,
    page: threadsPage,
    state: threadsState,
    messageType: MESSAGE_TYPES.FETCH_THREADS,
    label: '帖子',
  }, page)
}

async function loadFavorites(page = favoritesPage.value) {
  return loadList({
    cache: favoritesCache,
    count: favoritesCount,
    page: favoritesPage,
    state: favoritesState,
    messageType: MESSAGE_TYPES.FETCH_FAVORITES,
    label: '收藏',
  }, page)
}

async function loadFriends(page = friendsPage.value) {
  return loadList({
    cache: friendsCache,
    count: friendsCount,
    page: friendsPage,
    state: friendsState,
    messageType: MESSAGE_TYPES.FETCH_FRIENDS,
    label: '好友',
  }, page)
}

async function refresh() {
  errorMsg.value = ''
  resetRequestCaches()
  await loadCounts()
  if (activeTab.value === 'threads') await loadThreads()
  else if (activeTab.value === 'favorites') await loadFavorites()
  else await loadFriends()
}

function switchTab(tab: ForumTab) {
  activeTab.value = tab
  if (
    tab === 'threads'
    && threadsCache.value.items.length < targetItemsForPage(threadsPage.value, threadsCount.value)
    && threadsState.value !== 'loading'
  ) loadThreads()
  if (
    tab === 'favorites'
    && favoritesCache.value.items.length < targetItemsForPage(favoritesPage.value, favoritesCount.value)
    && favoritesState.value !== 'loading'
  ) loadFavorites()
  if (
    tab === 'friends'
    && friendsCache.value.items.length < targetItemsForPage(friendsPage.value, friendsCount.value)
    && friendsState.value !== 'loading'
  ) loadFriends()
}

function changeThreadsPage(page: number) {
  loadThreads(page)
}

function changeFavoritesPage(page: number) {
  loadFavorites(page)
}

function changeFriendsPage(page: number) {
  loadFriends(page)
}

function openInTab(url: string) {
  chrome.tabs.create({ url })
}

/** 监听 forumTheme 变更（content script 写入时触发）。
 * 抽出命名函数以便 onUnmounted 移除：MV3 Side Panel 每次打开都会
 * 重建 Vue 应用，否则 listener 会越积越多，引用着已卸载的响应式 ref。 */
function handleStorageChange(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area !== 'local') return
  const themeChange = changes[FORUM_THEME_KEY]
  if (!themeChange) return
  const next = themeChange.newValue
  forumTheme.value = (next === 'dark' || next === 'light') ? next : 'unknown'
  applyEffectiveTheme()
}

/** 通知 content 端浮动按钮显隐。
 * 同步触发即可 —— chrome.storage.session.set 的写入动作是即时的，Promise resolve
 * 在 pagehide 期间不保证完成，但写入本身能落盘（直到浏览器关）。
 * session 级存储：浏览器关掉 / 扩展崩了 → 自动清空 → 不会跨会话 stale。
 *
 * 三处写 false 互相冗余但都有意义 —— 关 side panel 时 onUnmounted / pagehide /
 * background port.onDisconnect 都会触发，触发顺序不一定，幂等写 false 都安全：
 * - onUnmounted：Vue 销毁前的 hook，最常用路径
 * - pagehide：w3c 页面销毁事件，Vue 销毁前触发
 * - port.onDisconnect：background 端感知，最可靠但 SW 回收期间不立即跑
 * 三条都保留以覆盖所有关闭场景。 */
function setFloatBtnHidden(hidden: boolean): void {
  chrome.storage.session.set({ [FLOAT_BTN_HIDDEN_KEY]: hidden })
}

/** pagehide 兜底：side panel document 销毁时先 pagehide 再 onUnmounted，
 * 两条路径都写 false 幂等。 */
function handlePageHide(): void {
  setFloatBtnHidden(false)
}

/** side panel → background 长连接引用。background 在 onDisconnect 时写
 * floatBtnHidden=false，是感知 ✕ 关 side panel 的最可靠手段（pagehide /
 * onUnmounted 在 ✕ 关闭时不一定触发）。模块顶层 let 让 HMR / 重 mount 时
 * 旧引用能自然被新 connect 覆盖。 */
let alivePort: chrome.runtime.Port | null = null

onMounted(async () => {
  // 等 storage 默认值补齐后再读取（与 content 模块入口一致的"等服务就绪"约束）
  try {
    await ensureStorageReady()
  }
  catch (err) {
    console.warn('[sidepanel] storage init 失败:', err)
  }

  await loadThemeState()
  await probe()

  if (loginStatus.value === 'logged-in') {
    await loadCounts()
    await loadThreads()
  }

  // 建立长连接 —— background onDisconnect 监听这个 port 来感知 side panel 销毁
  alivePort = chrome.runtime.connect({ name: SIDEPANEL_ALIVE_PORT })

  chrome.storage.onChanged.addListener(handleStorageChange)
  window.addEventListener('pagehide', handlePageHide)
  // mount 完成、port 建好后再写 true —— content 端 listener 用新注册的 listener 接收事件。
  // 写 true 是触发 content 端按钮隐藏的唯一来源；background 不会主动写。
  setFloatBtnHidden(true)
})

onUnmounted(() => {
  // 显式 disconnect 让 background 立刻知道（某些 onUnmounted 触发的场景）——
  // ✕ 关闭 case 会让 port 自然断开，两条路径都覆盖。
  // 不用置 alivePort = null：onUnmounted 一次性执行，整个 side panel context 随即销毁，
  // 模块级 let 变量随 GC。模块顶层 let 的意义只是让 HMR / 重 mount 时旧引用被新 connect 覆盖。
  alivePort?.disconnect()

  chrome.storage.onChanged.removeListener(handleStorageChange)
  window.removeEventListener('pagehide', handlePageHide)
  setFloatBtnHidden(false)
})

// ============ 主题状态 ============
// 论坛当前主题（content script 写入）；sidepanel 完全跟随，不暴露手动开关。
// 详见 CLAUDE.md §6.7。
const forumTheme = ref<ForumTheme>('unknown')

const effectiveThemeValue = computed(() => effectiveTheme(forumTheme.value))

/** 把 effectiveTheme 写到 `<html data-theme>`，CSS 变量在 style.css 里切换 light/dark。 */
function applyEffectiveTheme() {
  document.documentElement.dataset.theme = effectiveThemeValue.value
}

/** 启动时从 storage 读取 forumTheme。 */
async function loadThemeState() {
  const stored = await chrome.storage.local.get([FORUM_THEME_KEY])
  const ft = stored[FORUM_THEME_KEY]
  if (ft === 'dark' || ft === 'light') forumTheme.value = ft
  applyEffectiveTheme()
}
</script>

<template>
  <main class="panel">
    <section v-if="activeOption === 'profile'" class="panel-content">
      <header class="header">
        <h1 class="title">
          🔖 论坛助手
        </h1>
        <div class="header-actions">
          <button class="refresh" :disabled="loginStatus !== 'logged-in'" @click="refresh">
            ⟳ 刷新
          </button>
        </div>
      </header>

      <div class="status-bar" :class="loginStatus">
        <template v-if="loginStatus === 'logged-in' && currentUid">
          ✅ 已登录 · UID: {{ currentUid }} · {{ currentHost }}
        </template>
        <template v-else-if="loginStatus === 'logged-out'">
          ⚠️ 未登录 · 请先在论坛登录
        </template>
        <template v-else>
          检测中…
        </template>
      </div>

      <nav class="tabs">
        <button class="tab" :class="{ active: activeTab === 'threads' }" @click="switchTab('threads')">
          📝 帖子
        </button>
        <button class="tab" :class="{ active: activeTab === 'favorites' }" @click="switchTab('favorites')">
          ⭐ 收藏
        </button>
        <button class="tab" :class="{ active: activeTab === 'friends' }" @click="switchTab('friends')">
          👥 好友
        </button>
      </nav>

      <div v-if="countErrorMsg" class="error">
        {{ countErrorMsg }}
      </div>

      <div v-if="errorMsg" class="error">
        {{ errorMsg }}
      </div>

      <ForumList v-if="activeTab === 'threads'" kind="threads" :items="threads" :loading="threadsState === 'loading'"
        :page="threadsPage" :page-count="pageCountFor(threadsCount)" :total="threadsCount?.total ?? null"
        :page-size="DEFAULT_PAGE_SIZE" empty-text="暂无帖子" @open="openInTab" @page-change="changeThreadsPage" />

      <ForumList v-else-if="activeTab === 'favorites'" kind="favorites" :items="favorites"
        :loading="favoritesState === 'loading'" :page="favoritesPage" :page-count="pageCountFor(favoritesCount)"
        :total="favoritesCount?.total ?? null" :page-size="DEFAULT_PAGE_SIZE" empty-text="暂无收藏" @open="openInTab"
        @page-change="changeFavoritesPage" />

      <ForumList v-else kind="friends" :items="friends" :loading="friendsState === 'loading'" :page="friendsPage"
        :page-count="pageCountFor(friendsCount)" :total="friendsCount?.total ?? null" :page-size="DEFAULT_PAGE_SIZE"
        empty-text="暂无好友" @open="openInTab" @page-change="changeFriendsPage" />
    </section>

    <SearchView v-else-if="activeOption === 'search'" :active-tab-id="activeTabId" @open="openInTab" />

    <section v-else class="image-host-view" aria-live="polite">
      <ImageHostView />
    </section>

    <aside class="option-rail" aria-label="功能选项">
      <button v-for="option in panelOptions" :key="option.id" type="button" class="option-button"
        :class="{ active: activeOption === option.id }" :title="option.label" :aria-label="option.label"
        :aria-pressed="activeOption === option.id" @click="activeOption = option.id">
        <img :src="option.icon" alt="" aria-hidden="true" class="option-icon">
        <span class="option-label">{{ option.label }}</span>
      </button>
    </aside>
  </main>
</template>

<style scoped>
.panel {
  width: 100%;
  min-height: 100vh;
  display: flex;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: var(--crx-text);
  background: var(--crx-bg);
}

.panel-content {
  min-width: 0;
  flex: 1;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background: var(--crx-surface);
  border-bottom: 1px solid var(--crx-border);
}

.title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.refresh {
  padding: 0.4rem 0.85rem;
  font-size: 0.85rem;
  background: var(--crx-primary);
  color: var(--crx-on-primary);
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.refresh:disabled {
  background: var(--crx-disabled-fg);
  cursor: not-allowed;
}

.refresh:not(:disabled):hover {
  background: var(--crx-primary-hover);
}

.status-bar {
  padding: 0.5rem 1rem;
  font-size: 0.8rem;
  border-bottom: 1px solid var(--crx-border);
}

.status-bar.logged-in {
  background: var(--crx-success-bg);
  color: var(--crx-success-fg);
}

.status-bar.logged-out {
  background: var(--crx-danger-bg);
  color: var(--crx-danger-fg);
}

.status-bar.unknown {
  background: var(--crx-surface-alt);
  color: var(--crx-text-muted);
}

.tabs {
  display: flex;
  background: var(--crx-surface);
  border-bottom: 1px solid var(--crx-border);
}

.tab {
  flex: 1;
  padding: 0.75rem 0.5rem;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: 0.85rem;
  color: var(--crx-text-muted);
  cursor: pointer;
  transition: all 150ms;
}

.tab:hover {
  color: var(--crx-text);
  background: var(--crx-surface-alt);
}

.tab.active {
  color: var(--crx-primary);
  border-bottom-color: var(--crx-primary);
  font-weight: 600;
}

.error {
  padding: 0.5rem 1rem;
  background: var(--crx-warning-bg);
  color: var(--crx-warning-fg);
  font-size: 0.85rem;
  border-bottom: 1px solid var(--crx-warning-border);
}

.image-host-view {
  min-width: 0;
  flex: 1;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--crx-bg);
}

.option-rail {
  flex: 0 0 64px;
  width: 64px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 0.5rem 0.35rem;
  background: var(--crx-surface);
  border-left: 1px solid var(--crx-border);
}

.option-button {
  width: 56px;
  min-height: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  padding: 0.35rem 0.2rem;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--crx-text-muted);
  cursor: pointer;
  transition: background 150ms, color 150ms, border-color 150ms;
}

.option-button:hover {
  background: var(--crx-surface-alt);
  color: var(--crx-text);
}

.option-button.active {
  border-color: var(--crx-primary-soft-border);
  background: var(--crx-primary-soft);
  color: var(--crx-primary-hover);
}

.option-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.option-label {
  max-width: 100%;
  overflow: hidden;
  font-size: 0.68rem;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
