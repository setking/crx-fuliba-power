<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { DEFAULT_PAGE_SIZE, MESSAGE_TYPES } from '@/global'
import type { Favorite, ForumCount, ForumCounts, ForumTab, Friend, LoginStatus, Thread } from '@/type'
import ForumList from '@/sidepanel/components/ForumList.vue'
import ImageHostView from '@/sidepanel/components/ImageHostView.vue'
import SearchView from '@/sidepanel/components/SearchView.vue'
import { fetchViaContent, getActiveTab } from '@/utils/extension'
import { createRequestCache, getPageCount, getRequestPageCount, itemsForDisplayPage, normalizePage, type RequestCache } from '@/utils/pagination'
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
  const normalizedPage = Math.max(1, page)
  return Math.min(totalFor(count) ?? normalizedPage * DEFAULT_PAGE_SIZE, normalizedPage * DEFAULT_PAGE_SIZE)
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
  return getPageCount(totalFor(count), DEFAULT_PAGE_SIZE)
}

function displayCount(count: ForumCount | null): number | string {
  return totalFor(count) ?? '—'
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
      const items = await fetchViaContent<T[]>(activeTabId.value, messageType, { page })
      cache.nextRequestPage = page + 1
      requestedPages += 1

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

async function loadThreads(page = threadsPage.value) {
  if (!activeTabId.value) activeTabId.value = await getActiveTab().then(t => t?.id ?? null)
  if (!activeTabId.value) {
    errorMsg.value = '找不到当前标签页'
    threadsState.value = 'error'
    return
  }
  const nextPage = normalizePage(page, pageCountFor(threadsCount.value))
  threadsPage.value = nextPage
  threadsState.value = 'loading'
  errorMsg.value = ''
  try {
    await ensureCached(
      threadsCache.value,
      targetItemsForPage(nextPage, threadsCount.value),
      MESSAGE_TYPES.FETCH_THREADS,
    )
    if (threadsCount.value?.total === null) {
      threadsCount.value = { ...threadsCount.value, total: threadsCache.value.items.length }
    }
    else if (threadsCount.value === null) {
      threadsCount.value = { total: threadsCache.value.items.length, pageSize: threadsCache.value.firstBatchSize }
    }
    threadsState.value = 'idle'
  }
  catch (e) {
    errorMsg.value = `加载帖子失败：${(e as Error).message}`
    threadsState.value = 'error'
  }
}

async function loadFavorites(page = favoritesPage.value) {
  if (!activeTabId.value) activeTabId.value = await getActiveTab().then(t => t?.id ?? null)
  if (!activeTabId.value) {
    errorMsg.value = '找不到当前标签页'
    favoritesState.value = 'error'
    return
  }
  const nextPage = normalizePage(page, pageCountFor(favoritesCount.value))
  favoritesPage.value = nextPage
  favoritesState.value = 'loading'
  errorMsg.value = ''
  try {
    await ensureCached(
      favoritesCache.value,
      targetItemsForPage(nextPage, favoritesCount.value),
      MESSAGE_TYPES.FETCH_FAVORITES,
    )
    if (favoritesCount.value?.total === null) {
      favoritesCount.value = { ...favoritesCount.value, total: favoritesCache.value.items.length }
    }
    else if (favoritesCount.value === null) {
      favoritesCount.value = { total: favoritesCache.value.items.length, pageSize: favoritesCache.value.firstBatchSize }
    }
    favoritesState.value = 'idle'
  }
  catch (e) {
    errorMsg.value = `加载收藏失败：${(e as Error).message}`
    favoritesState.value = 'error'
  }
}

async function loadFriends(page = friendsPage.value) {
  if (!activeTabId.value) activeTabId.value = await getActiveTab().then(t => t?.id ?? null)
  if (!activeTabId.value) {
    errorMsg.value = '找不到当前标签页'
    friendsState.value = 'error'
    return
  }
  const nextPage = normalizePage(page, pageCountFor(friendsCount.value))
  friendsPage.value = nextPage
  friendsState.value = 'loading'
  errorMsg.value = ''
  try {
    await ensureCached(
      friendsCache.value,
      targetItemsForPage(nextPage, friendsCount.value),
      MESSAGE_TYPES.FETCH_FRIENDS,
    )
    if (friendsCount.value?.total === null) {
      friendsCount.value = { ...friendsCount.value, total: friendsCache.value.items.length }
    }
    else if (friendsCount.value === null) {
      friendsCount.value = { total: friendsCache.value.items.length, pageSize: friendsCache.value.firstBatchSize }
    }
    friendsState.value = 'idle'
  }
  catch (e) {
    errorMsg.value = `加载好友失败：${(e as Error).message}`
    friendsState.value = 'error'
  }
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

onMounted(async () => {
  await probe()

  if (loginStatus.value === 'logged-in') {
    await loadCounts()
    await loadThreads()
  }
})
</script>

<template>
  <main class="panel">
    <section v-if="activeOption === 'profile'" class="panel-content">
      <header class="header">
        <h1 class="title">
          🔖 论坛助手
        </h1>
        <button class="refresh" :disabled="loginStatus !== 'logged-in'" @click="refresh">
          ⟳ 刷新
        </button>
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
          📝 帖子 ({{ countsState === 'loading' ? '…' : displayCount(threadsCount) }})
        </button>
        <button class="tab" :class="{ active: activeTab === 'favorites' }" @click="switchTab('favorites')">
          ⭐ 收藏 ({{ countsState === 'loading' ? '…' : displayCount(favoritesCount) }})
        </button>
        <button class="tab" :class="{ active: activeTab === 'friends' }" @click="switchTab('friends')">
          👥 好友 ({{ countsState === 'loading' ? '…' : displayCount(friendsCount) }})
        </button>
      </nav>

      <div v-if="countErrorMsg" class="error">
        {{ countErrorMsg }}
      </div>

      <div v-if="errorMsg" class="error">
        {{ errorMsg }}
      </div>

      <ForumList v-if="activeTab === 'threads'" kind="threads" :items="threads" :loading="threadsState === 'loading'"
        :page="threadsPage" :total="threadsCount?.total ?? null" :page-size="DEFAULT_PAGE_SIZE" empty-text="暂无帖子"
        @open="openInTab" @page-change="changeThreadsPage" />

      <ForumList v-else-if="activeTab === 'favorites'" kind="favorites" :items="favorites"
        :loading="favoritesState === 'loading'" :page="favoritesPage" :total="favoritesCount?.total ?? null"
        :page-size="DEFAULT_PAGE_SIZE" empty-text="暂无收藏" @open="openInTab" @page-change="changeFavoritesPage" />

      <ForumList v-else kind="friends" :items="friends" :loading="friendsState === 'loading'" :page="friendsPage"
        :total="friendsCount?.total ?? null" :page-size="DEFAULT_PAGE_SIZE" empty-text="暂无好友" @open="openInTab"
        @page-change="changeFriendsPage" />
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
  color: #1f2937;
  background: #f9fafb;
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
  background: white;
  border-bottom: 1px solid #e5e7eb;
}

.title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.refresh {
  padding: 0.4rem 0.85rem;
  font-size: 0.85rem;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.refresh:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.refresh:not(:disabled):hover {
  background: #2563eb;
}

.status-bar {
  padding: 0.5rem 1rem;
  font-size: 0.8rem;
  border-bottom: 1px solid #e5e7eb;
}

.status-bar.logged-in {
  background: #d1fae5;
  color: #065f46;
}

.status-bar.logged-out {
  background: #fee2e2;
  color: #991b1b;
}

.status-bar.unknown {
  background: #f3f4f6;
  color: #6b7280;
}

.tabs {
  display: flex;
  background: white;
  border-bottom: 1px solid #e5e7eb;
}

.tab {
  flex: 1;
  padding: 0.75rem 0.5rem;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: 0.85rem;
  color: #6b7280;
  cursor: pointer;
  transition: all 150ms;
}

.tab:hover {
  color: #1f2937;
  background: #f3f4f6;
}

.tab.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
  font-weight: 600;
}

.error {
  padding: 0.5rem 1rem;
  background: #fef3c7;
  color: #92400e;
  font-size: 0.85rem;
  border-bottom: 1px solid #fde68a;
}

.image-host-view {
  min-width: 0;
  flex: 1;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f9fafb;
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
  background: white;
  border-left: 1px solid #e5e7eb;
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
  color: #6b7280;
  cursor: pointer;
  transition: background 150ms, color 150ms, border-color 150ms;
}

.option-button:hover {
  background: #f3f4f6;
  color: #1f2937;
}

.option-button.active {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #2563eb;
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
