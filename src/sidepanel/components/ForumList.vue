<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DEFAULT_PAGE_SIZE } from '@/global'
import type { Favorite, ForumListKind, Friend, SearchResult, Thread } from '@/type'
import { getPageCount, normalizePage } from '@/utils/pagination'

type ListItems = Thread[] | Favorite[] | Friend[] | SearchResult[]

const props = withDefaults(defineProps<{
  kind: ForumListKind
  items: ListItems
  loading: boolean
  page: number
  total: number | null
  pageCount?: number
  emptyText: string
  pageSize?: number
}>(), {
  pageSize: DEFAULT_PAGE_SIZE,
})

const emit = defineEmits<{
  open: [url: string]
  pageChange: [page: number]
}>()

const pageCount = computed(() => props.pageCount ?? getPageCount(props.total, props.pageSize))
const currentPage = computed(() => normalizePage(props.page, pageCount.value))
const jumpPage = ref(String(currentPage.value))
const threads = computed(() => props.kind === 'threads' ? props.items as Thread[] : [])
const favorites = computed(() => props.kind === 'favorites' ? props.items as Favorite[] : [])
const friends = computed(() => props.kind === 'friends' ? props.items as Friend[] : [])
const searchResults = computed(() => props.kind === 'search' ? props.items as SearchResult[] : [])

watch(currentPage, (page) => {
  jumpPage.value = String(page)
})

function requestPage(page: number) {
  const nextPage = normalizePage(page, pageCount.value)
  if (nextPage !== currentPage.value) emit('pageChange', nextPage)
}

function jumpToPage() {
  const requestedPage = Number.parseInt(jumpPage.value, 10)
  if (!Number.isInteger(requestedPage)) {
    jumpPage.value = String(currentPage.value)
    return
  }

  const nextPage = normalizePage(requestedPage, pageCount.value)
  jumpPage.value = String(nextPage)
  if (nextPage !== currentPage.value) emit('pageChange', nextPage)
}
</script>

<template>
  <section class="content">
    <div v-if="loading" class="loading">
      加载中…
    </div>
    <div v-else-if="items.length === 0" class="empty">
      {{ emptyText }}
    </div>

    <ul v-else-if="kind === 'threads'" class="list">
      <li v-for="thread in threads" :key="thread.id || thread.url" class="item thread-item" @click="emit('open', thread.url)">
        <div class="thread-title">
          {{ thread.title }}
        </div>
        <div class="thread-meta">
          <span class="author">{{ thread.author }}</span>
          <span class="replies">💬 {{ thread.replies }}</span>
        </div>
      </li>
    </ul>

    <ul v-else-if="kind === 'favorites'" class="list">
      <!-- 收藏项没有稳定 ID，使用当前页内索引作为退化 key。 -->
      <li v-for="(favorite, index) in favorites" :key="index" class="item fav-item" @click="emit('open', favorite.url)">
        <div class="fav-title">
          ⭐ {{ favorite.title }}
        </div>
        <div v-if="favorite.date" class="fav-date">
          {{ favorite.date }}
        </div>
      </li>
    </ul>

    <ul v-else-if="kind === 'search'" class="list">
      <li v-for="result in searchResults" :key="result.id || result.url" class="item search-item" @click="emit('open', result.url)">
        <div class="search-result-title">
          {{ result.title }}
        </div>
        <div class="search-result-meta">
          <span v-if="result.author">{{ result.author }}</span>
          <span v-if="result.views">浏览 {{ result.views }}</span>
          <span v-if="result.replies">回复 {{ result.replies }}</span>
          <span v-if="result.postTime">{{ result.postTime }}</span>
          <span v-if="result.category">{{ result.category }}</span>
        </div>
      </li>
    </ul>

    <ul v-else class="list friend-list">
      <li v-for="friend in friends" :key="friend.uid || friend.profileUrl" class="item friend-item" @click="emit('open', friend.profileUrl)">
        <img v-if="friend.avatar" :src="friend.avatar" :alt="friend.name" class="avatar">
        <div class="friend-name">
          {{ friend.name }}
        </div>
      </li>
    </ul>

    <nav v-if="!loading && pageCount > 1" class="pagination" aria-label="列表分页">
      <button
        type="button"
        class="page-button"
        :disabled="currentPage === 1"
        aria-label="上一页"
        @click="requestPage(currentPage - 1)"
      >
        ‹
      </button>
      <span class="page-indicator">第 {{ currentPage }} / {{ pageCount }} 页</span>
      <button
        type="button"
        class="page-button"
        :disabled="currentPage === pageCount"
        aria-label="下一页"
        @click="requestPage(currentPage + 1)"
      >
        ›
      </button>
      <form class="jump-form" @submit.prevent="jumpToPage">
        <input
          v-model="jumpPage"
          type="number"
          class="jump-input"
          min="1"
          :max="pageCount"
          step="1"
          inputmode="numeric"
          aria-label="跳转到页码"
        >
        <button type="submit" class="jump-button">
          跳转
        </button>
      </form>
    </nav>
  </section>
</template>

<style scoped>
.content {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0;
}

.loading,
.empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--crx-text-subtle);
  font-size: 0.9rem;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.item {
  padding: 0.75rem 1rem;
  background: var(--crx-surface);
  border-bottom: 1px solid var(--crx-border);
  cursor: pointer;
  transition: background 100ms;
}

.item:hover {
  background: var(--crx-bg);
}

.thread-title {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--crx-text);
  margin-bottom: 0.25rem;
  line-height: 1.4;
  text-align: left;
  overflow-wrap: anywhere;
}

.thread-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--crx-text-muted);
}

.thread-meta .replies {
  margin-left: auto;
  text-align: right;
}

.author {
  color: var(--crx-text-muted);
}

.fav-title {
  flex: 1;
  min-width: 0;
  font-size: 0.9rem;
  color: var(--crx-text);
  text-align: left;
  overflow-wrap: anywhere;
}

.fav-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  text-align: left;
}

.fav-date {
  flex: 0 1 42%;
  min-width: 0;
  margin-top: 0;
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--crx-text-subtle);
  text-align: right;
  overflow-wrap: anywhere;
}

.search-result-title {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--crx-text);
  line-height: 1.4;
  text-align: left;
  overflow-wrap: anywhere;
}

.search-result-meta {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--crx-text-muted);
  text-align: right;
}

.friend-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 0.5rem;
  padding: 0.5rem;
}

.friend-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--crx-border);
  background: var(--crx-surface);
}

.avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--crx-surface-alt);
}

.friend-name {
  font-size: 0.75rem;
  text-align: center;
  color: var(--crx-text);
  word-break: break-all;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--crx-surface);
  border-top: 1px solid var(--crx-border);
}

.page-button {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--crx-border-strong);
  border-radius: 6px;
  background: var(--crx-surface);
  color: var(--crx-text);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
}

.page-button:hover:not(:disabled) {
  border-color: var(--crx-primary);
  color: var(--crx-primary-hover);
}

.page-button:disabled {
  color: var(--crx-text-subtle);
  background: var(--crx-surface-alt);
  cursor: not-allowed;
}

.page-indicator {
  min-width: 6rem;
  text-align: center;
  color: var(--crx-text-muted);
  font-size: 0.8rem;
}

.jump-form {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
}

.jump-input {
  box-sizing: border-box;
  width: 3.25rem;
  height: 32px;
  padding: 0 0.35rem;
  border: 1px solid var(--crx-border-strong);
  border-radius: 6px;
  color: var(--crx-text);
  background: var(--crx-input-bg);
  text-align: center;
}

.jump-input:focus {
  outline: 2px solid var(--crx-primary-soft-border);
  outline-offset: 1px;
  border-color: var(--crx-primary);
}

.jump-button {
  height: 32px;
  padding: 0 0.65rem;
  border: 1px solid var(--crx-border-strong);
  border-radius: 6px;
  color: var(--crx-text);
  background: var(--crx-surface);
  font-size: 0.8rem;
  cursor: pointer;
}

.jump-button:hover {
  border-color: var(--crx-primary);
  color: var(--crx-primary-hover);
}
</style>
