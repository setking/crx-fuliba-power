<script setup lang="ts">
/**
 * 搜索 tab：自管搜索缓存 + 状态机，props 仅接收 activeTabId，open 通过 emit 上抛
 *
 * 数据流：
 *   side panel submit → chrome.tabs.sendMessage(FETCH_SEARCH, { keyword, page, searchId })
 *   → content 在页面 context fetch search.php?mod=forum（带 cookie，无 CORS）
 *   → 首响解析 searchId → 后续分页复用
 */
import { computed, ref } from 'vue'
import { DEFAULT_PAGE_SIZE, MESSAGE_TYPES } from '@/global'
import type { ForumCount, ForumSearchPage } from '@/type'
import { fetchViaContent } from '@/utils/extension'
import {
  createSearchRequestCache,
  getPageCountFromCount,
  itemsForDisplayPage,
  normalizePage,
  targetItemsForPage,
  type SearchRequestCache,
} from '@/utils/pagination'
import ForumList from './ForumList.vue'

const props = defineProps<{ activeTabId: number | null }>()
const emit = defineEmits<{ open: [url: string] }>()

const searchCache = ref<SearchRequestCache>(createSearchRequestCache())
const searchPage = ref(1)
const searchInput = ref('')
const searchKeyword = ref('')
const searchCount = ref<ForumCount | null>(null)
const searchState = ref<'idle' | 'loading' | 'error'>('idle')
const searchErrorMsg = ref('')

const searchResults = computed(() => itemsForDisplayPage(searchCache.value.items, searchPage.value))
const searchPageCount = computed(() => {
  if (searchCount.value?.total != null) return getPageCountFromCount(searchCount.value)
  const loadedPages = Math.ceil(searchCache.value.items.length / DEFAULT_PAGE_SIZE)
  return Math.max(1, loadedPages + (searchCache.value.reachedEnd ? 0 : 1))
})

function resetSearchCache(keyword: string) {
  searchKeyword.value = keyword
  searchCache.value = createSearchRequestCache(keyword)
  searchPage.value = 1
  searchCount.value = null
}

/** 拉够 targetCount 条；首次响应里提取动态 searchId 写入 cache 供后续分页 */
async function ensureSearchCached(targetCount: number): Promise<void> {
  if (!searchKeyword.value) throw new Error('搜索关键词不能为空')

  const cache = searchCache.value
  while (!cache.reachedEnd && cache.items.length < targetCount) {
    const data = await fetchViaContent<ForumSearchPage>(props.activeTabId as number, MESSAGE_TYPES.FETCH_SEARCH, {
      keyword: cache.keyword,
      page: cache.nextRequestPage,
      searchId: cache.searchId,
    })
    cache.nextRequestPage += 1

    if (data.searchId) cache.searchId = data.searchId

    const items = data.items ?? []
    if (items.length === 0) {
      cache.reachedEnd = true
      break
    }

    if (searchCount.value === null) {
      searchCount.value = { total: data.total, pageSize: data.pageSize }
    }
    else if (searchCount.value.total === null && data.pageSize !== null) {
      searchCount.value = { ...searchCount.value, pageSize: data.pageSize }
    }

    cache.items.push(...items)
    if (items.length < DEFAULT_PAGE_SIZE) {
      cache.reachedEnd = true
      break
    }
  }
}

async function loadSearch(page = searchPage.value) {
  if (!searchKeyword.value) return
  if (!props.activeTabId) {
    searchErrorMsg.value = '找不到当前标签页'
    searchState.value = 'error'
    return
  }

  const nextPage = normalizePage(page, searchPageCount.value)
  searchPage.value = nextPage
  searchState.value = 'loading'
  searchErrorMsg.value = ''
  try {
    await ensureSearchCached(targetItemsForPage(nextPage, searchCount.value))
    if (searchCount.value?.total === null && searchCache.value.reachedEnd) {
      searchCount.value = { ...searchCount.value, total: searchCache.value.items.length }
    }
    else if (searchCount.value === null && searchCache.value.reachedEnd) {
      searchCount.value = { total: searchCache.value.items.length, pageSize: searchCache.value.firstBatchSize }
    }
    searchPage.value = normalizePage(nextPage, searchPageCount.value)
    searchState.value = 'idle'
  }
  catch (e) {
    searchErrorMsg.value = `搜索失败：${(e as Error).message}`
    searchState.value = 'error'
  }
}

async function submitSearch() {
  const keyword = searchInput.value.trim()
  if (!keyword) {
    searchErrorMsg.value = '请输入搜索关键词'
    return
  }
  resetSearchCache(keyword)
  await loadSearch()
}

function openInTab(url: string) {
  emit('open', url)
}
</script>

<template>
  <section class="search-view">
    <header class="search-header">
      <h2 class="search-title">
        搜索帖子
      </h2>
      <form class="search-form" @submit.prevent="submitSearch">
        <input
          v-model="searchInput"
          class="search-input"
          type="search"
          placeholder="输入关键词"
          aria-label="搜索帖子关键词"
        >
        <button class="search-submit" type="submit" :disabled="searchState === 'loading'">
          {{ searchState === 'loading' ? '搜索中…' : '搜索' }}
        </button>
      </form>
    </header>
    <div v-if="searchErrorMsg" class="error">
      {{ searchErrorMsg }}
    </div>
    <ForumList
      kind="search"
      :items="searchResults"
      :loading="searchState === 'loading'"
      :page="searchPage"
      :total="searchCount?.total ?? null"
      :page-count="searchPageCount"
      :page-size="DEFAULT_PAGE_SIZE"
      empty-text="暂无搜索结果"
      @open="openInTab"
      @page-change="loadSearch"
    />
  </section>
</template>

<style scoped>
.search-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
  flex: 1;
  min-height: 0;
}

.search-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.search-form {
  display: flex;
  gap: 8px;
}

.search-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--crx-border-strong);
  border-radius: 6px;
  font-size: 13px;
  color: var(--crx-text);
  background: var(--crx-input-bg);
}

.search-input:focus {
  outline: none;
  border-color: var(--crx-primary);
  box-shadow: 0 0 0 2px var(--crx-focus-ring);
}

.search-submit {
  padding: 6px 14px;
  background: var(--crx-primary);
  color: var(--crx-on-primary);
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.search-submit:hover:not(:disabled) {
  background: var(--crx-primary-hover);
}

.search-submit:disabled {
  background: var(--crx-disabled-fg);
  cursor: not-allowed;
}
</style>
