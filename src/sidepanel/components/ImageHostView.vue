<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IMAGE_HISTORY_KEY,
  IMAGE_HISTORY_LIMIT,
  IMAGE_SESSION_UUID_KEY,
  IMAGE_UPLOAD_CONCURRENCY,
  IMAGE_UPLOAD_URL,
  MESSAGE_TYPES,
} from '@/global'
import type { ImageStatus, ImageTask, LinkFormat, UploadedImage } from '@/type'
import { buildLink, createSessionUuid, toDataUrl } from '@/utils/image-host'

const tasks = ref<ImageTask[]>([])
const history = ref<UploadedImage[]>([])
const isDragOver = ref(false)
const lastCopiedFormat = ref<LinkFormat | ''>('')
const fileInput = ref<HTMLInputElement | null>(null)

const sessionUuid = ref('')

// 4 种复制格式 —— 严格按用户给的产品名
const LINK_FORMAT_OPTIONS: Array<{ id: LinkFormat; label: string }> = [
  { id: 'url', label: '直链' },
  { id: 'bbcode', label: '论坛代码' },
  { id: 'markdown', label: 'MarkDown' },
  { id: 'html', label: 'HTML' },
]

const isImageMime = (type: string): boolean => type.startsWith('image/')

const statusLabel: Record<ImageStatus, string> = {
  queued: '排队中',
  uploading: '上传中',
  done: '已上传',
  error: '失败',
}

async function loadSessionUuid() {
  const stored = await chrome.storage.local.get(IMAGE_SESSION_UUID_KEY)
  const existing = stored[IMAGE_SESSION_UUID_KEY]
  if (typeof existing === 'string' && existing) {
    sessionUuid.value = existing
  } else {
    sessionUuid.value = createSessionUuid()
    await chrome.storage.local.set({ [IMAGE_SESSION_UUID_KEY]: sessionUuid.value })
  }
}

async function loadHistory() {
  const stored = await chrome.storage.local.get(IMAGE_HISTORY_KEY)
  const raw = stored[IMAGE_HISTORY_KEY]
  // 兼容两种形态：标准数组 `[{...}]` / 被错误序列化成的"数字键对象" `{"0": {...}}`。
  // chrome.storage.local 内部 JSON 序列化偶发会让 array 变 object —— 用 Object.values 平摊回去。
  const isArray = Array.isArray(raw)
  const list: unknown[] = isArray
    ? raw
    : (raw && typeof raw === 'object' ? Object.values(raw as Record<string, unknown>) : [])
  const cleaned = list.filter(isUploadedImage)
  history.value = cleaned

  // 矫正脏数据：检测到对象形态就写回真数组，下次启动走正常路径
  if (!isArray && cleaned.length > 0) {
    await chrome.storage.local.set({ [IMAGE_HISTORY_KEY]: Array.from(cleaned) })
  }
}

async function saveHistory(next: UploadedImage[]) {
  const dedup: UploadedImage[] = []
  const seen = new Set<string>()
  for (const item of next) {
    if (!item.url || seen.has(item.url)) continue
    seen.add(item.url)
    dedup.push(item)
  }
  const trimmed = dedup.slice(0, IMAGE_HISTORY_LIMIT)
  // 显式包一层 Array.from —— chrome.storage.local 在某些边界会把数组序列化成
  // 数字键对象 `{"0": {...}}`，Array.from 强制走 Array 构造路径
  const normalized = Array.from(trimmed)
  history.value = normalized
  await chrome.storage.local.set({ [IMAGE_HISTORY_KEY]: normalized })
}

function isUploadedImage(value: unknown): value is UploadedImage {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.url === 'string'
    && typeof v.thumb === 'string'
    && typeof v.srcName === 'string'
    && typeof v.fileName === 'string'
}

async function clearHistory() {
  if (history.value.length === 0) return
  await chrome.storage.local.set({ [IMAGE_HISTORY_KEY]: [] })
  history.value = []
}

async function refreshSession() {
  sessionUuid.value = createSessionUuid()
  await chrome.storage.local.set({ [IMAGE_SESSION_UUID_KEY]: sessionUuid.value })
}

function buildTask(file: File): ImageTask {
  return {
    id: createSessionUuid(),
    fileName: file.name || 'upload',
    contentType: file.type || 'application/octet-stream',
    size: file.size,
    previewUrl: URL.createObjectURL(file),
    status: 'queued',
  }
}

function addFiles(files: FileList | File[]) {
  const next: ImageTask[] = []
  for (const file of Array.from(files)) {
    if (!isImageMime(file.type)) continue
    next.push(buildTask(file))
  }
  if (next.length === 0) return
  tasks.value = [...tasks.value, ...next]
}

function removeTask(id: string) {
  const idx = tasks.value.findIndex(t => t.id === id)
  if (idx === -1) return
  const removed = tasks.value[idx]
  if (removed) URL.revokeObjectURL(removed.previewUrl)
  tasks.value = tasks.value.filter(t => t.id !== id)
}

// 「清空」按钮：移除所有已完成任务
function clearDone() {
  const doneIds = new Set(tasks.value.filter(t => t.status === 'done').map(t => t.id))
  if (doneIds.size === 0) return
  for (const t of tasks.value) {
    if (doneIds.has(t.id)) URL.revokeObjectURL(t.previewUrl)
  }
  tasks.value = tasks.value.filter(t => !doneIds.has(t.id))
}

async function uploadOne(task: ImageTask): Promise<void> {
  const idx = tasks.value.findIndex(t => t.id === task.id)
  if (idx === -1) return
  const current = tasks.value[idx]
  if (!current) return
  const local = current.previewUrl
  try {
    const fileBlob = await fetch(local).then(r => r.blob())
    const file = new File([fileBlob], current.fileName, { type: current.contentType })
    const dataUrl = await toDataUrl(file)

    tasks.value[idx] = { ...current, status: 'uploading' }
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.UPLOAD_IMAGE,
      payload: {
        dataUrl,
        fileName: current.fileName,
        contentType: current.contentType,
        uuid: sessionUuid.value,
      },
    })
    if (!response || typeof response !== 'object' || !('ok' in response)) {
      throw new Error('未收到 content 响应')
    }
    if (!response.ok) {
      throw new Error(typeof response.error === 'string' ? response.error : '上传失败')
    }
    const data = response.data as UploadedImage
    tasks.value[idx] = { ...current, status: 'done', result: data }
    await saveHistory([data, ...history.value])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const cur = tasks.value[idx] ?? task
    tasks.value[idx] = { ...cur, status: 'error', error: message }
  }
}

let running = 0
const waiting: string[] = []

function schedule() {
  while (running < IMAGE_UPLOAD_CONCURRENCY && waiting.length > 0) {
    const id = waiting.shift()
    if (!id) break
    const task = tasks.value.find(t => t.id === id)
    if (!task || task.status !== 'queued') continue
    running++
    void uploadOne(task).finally(() => {
      running--
      schedule()
    })
  }
}

function enqueue(task: ImageTask) {
  waiting.push(task.id)
  schedule()
}

function startAll() {
  if (!sessionUuid.value) return
  let queuedCount = 0
  for (const t of tasks.value) {
    if (t.status === 'queued') {
      waiting.push(t.id)
      queuedCount++
    }
  }
  if (queuedCount === 0) return
  schedule()
}

function retry(task: ImageTask) {
  const idx = tasks.value.findIndex(t => t.id === task.id)
  if (idx === -1) return
  tasks.value[idx] = { ...task, status: 'queued', error: undefined }
  enqueue(task)
}

const doneTasks = computed(() => tasks.value.filter(t => t.status === 'done' && t.result))

// 当前点击选中的图片（任务卡 / 历史均可点）。设置后，tabs 预览与复制都按它来
const selectedImage = ref<UploadedImage | null>(null)

// 拼接一组图片某种格式的链接文本（每行一条）
function buildBatchLinks(format: LinkFormat, source: UploadedImage[]): string {
  return source.map(img => buildLink(format, img)).join('\n')
}

const previewSource = computed<UploadedImage[]>(() => {
  if (selectedImage.value) return [selectedImage.value]
  return doneTasks.value.map(t => t.result).filter((x): x is UploadedImage => Boolean(x))
})

const previewByFormat = computed<Record<LinkFormat, string>>(() => {
  const items = previewSource.value
  return {
    url: buildBatchLinks('url', items),
    bbcode: buildBatchLinks('bbcode', items),
    markdown: buildBatchLinks('markdown', items),
    html: buildBatchLinks('html', items),
  }
})

function selectImage(img: UploadedImage) {
  selectedImage.value = selectedImage.value?.url === img.url ? null : img
}

function clearSelection() {
  selectedImage.value = null
}

async function copyBatch(format: LinkFormat) {
  const text = previewByFormat.value[format]
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    lastCopiedFormat.value = format
    setTimeout(() => {
      if (lastCopiedFormat.value === format) lastCopiedFormat.value = ''
    }, 1500)
  } catch {
    lastCopiedFormat.value = ''
  }
}

function onPickFiles() {
  fileInput.value?.click()
}

function onFileInputChange(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    addFiles(target.files)
    target.value = ''
  }
}

function onDragEnter(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = true
}

function onDragLeave(e: DragEvent) {
  if (e.target === e.currentTarget) isDragOver.value = false
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  const dt = e.dataTransfer
  if (!dt || !dt.files || dt.files.length === 0) return
  addFiles(dt.files)
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items || items.length === 0) return
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length > 0) addFiles(files)
}

const runningCount = computed(() => tasks.value.filter(t => t.status === 'uploading').length)
const queuedCount = computed(() => tasks.value.filter(t => t.status === 'queued').length)
const errorCount = computed(() => tasks.value.filter(t => t.status === 'error').length)
const doneCount = computed(() => doneTasks.value.length)
const canStart = computed(() => Boolean(sessionUuid.value) && tasks.value.some(t => t.status === 'queued'))
const canClear = computed(() => doneCount.value > 0)

onMounted(() => {
  void loadSessionUuid()
  void loadHistory()
  document.addEventListener('paste', onPaste)
})

onBeforeUnmount(() => {
  document.removeEventListener('paste', onPaste)
  for (const t of tasks.value) URL.revokeObjectURL(t.previewUrl)
})
</script>

<template>
  <section class="image-host" aria-label="图床">
    <header class="ih-header">
      <h2 class="ih-title">
        图床：福吧图床
      </h2>
      <button type="button" class="ih-btn-ghost" title="新批次 UUID" @click="refreshSession">
        新批次
      </button>
    </header>

    <div class="ih-banner">
      <span class="ih-uuid">目标：<a :href="IMAGE_UPLOAD_URL" target="_blank"
          rel="noopener noreferrer">{{ IMAGE_UPLOAD_URL }}</a></span>
      <span class="ih-uuid">批次 UUID：<code>{{ sessionUuid || '加载中…' }}</code></span>
    </div>

    <div class="ih-drop" :class="{ active: isDragOver }" role="button" tabindex="0" aria-label="点击或拖拽图片到此处上传"
      @click="onPickFiles" @keydown.enter="onPickFiles" @keydown.space.prevent="onPickFiles" @dragenter="onDragEnter"
      @dragleave="onDragLeave" @dragover="onDragOver" @drop="onDrop">
      <p class="ih-drop-primary">
        点击、拖拽图片到此处，或直接粘贴（Ctrl/⌘+V）
      </p>
      <p class="ih-drop-sub">
        仅接受图片，失败可单条重试；同一批次共享 UUID
      </p>
      <input ref="fileInput" type="file" accept="image/*" multiple class="ih-file-input" @change="onFileInputChange">
    </div>

    <!-- 顶部控件：左侧任务状态摘要，右侧开始上传 -->
    <div class="ih-controls">
      <span class="ih-stat">
        队列 {{ queuedCount }} · 上传中 {{ runningCount }} · 成功 {{ doneCount }} · 失败 {{ errorCount }}
      </span>
      <button type="button" class="ih-btn-primary" :disabled="!canStart" @click="startAll">
        开始上传
      </button>
    </div>

    <!-- 4 个格式预览 + 各自复制按钮 —— tabs 形式 -->
    <section class="ih-formats" aria-label="复制链接格式">
      <div v-if="selectedImage" class="ih-selection-bar">
        <span class="ih-selection-text">
          已选中：<code>{{ selectedImage.fileName }}</code>
        </span>
        <button type="button" class="ih-btn-mini" @click="clearSelection">
          取消选中
        </button>
      </div>
      <div v-for="opt in LINK_FORMAT_OPTIONS" :key="opt.id" class="ih-format-tab">
        <header class="ih-format-tab-head">
          <span class="ih-format-tab-label">{{ opt.label }}</span>
          <button type="button" class="ih-btn-mini" :disabled="previewSource.length === 0" @click="copyBatch(opt.id)">
            {{ lastCopiedFormat === opt.id ? '已复制' : '复制' }}
          </button>
        </header>
        <pre class="ih-format-tab-body">{{ previewByFormat[opt.id] || '（无）' }}</pre>
      </div>
    </section>

    <div v-if="tasks.length === 0" class="ih-empty">
      暂无任务
    </div>

    <ul v-else class="ih-grid" aria-label="上传任务">
      <li v-for="task in tasks" :key="task.id" class="ih-card" :data-status="task.status"
        :class="{ selectable: task.status === 'done' && task.result, selected: task.result && selectedImage?.url === task.result.url }"
        :tabindex="task.status === 'done' && task.result ? 0 : -1"
        :aria-pressed="task.result && selectedImage?.url === task.result.url" role="button"
        @click="task.result && selectImage(task.result)"
        @keydown.enter.prevent="task.result && selectImage(task.result)"
        @keydown.space.prevent="task.result && selectImage(task.result)">
        <div class="ih-thumb">
          <img :src="task.status === 'done' && task.result ? task.result.thumb : task.previewUrl" :alt="task.fileName">
          <span v-if="task.status === 'uploading'" class="ih-progress" aria-label="上传中">
            <span class="ih-progress-bar" />
          </span>
        </div>
        <div class="ih-meta">
          <div class="ih-name" :title="task.fileName">
            {{ task.fileName }}
          </div>
          <div class="ih-sub">
            <span :class="['ih-status', `is-${task.status}`]">{{ statusLabel[task.status] }}</span>
            <span class="ih-size">{{ (task.size / 1024).toFixed(1) }} KB</span>
          </div>
          <div v-if="task.error" class="ih-error">
            {{ task.error }}
          </div>
          <div class="ih-actions">
            <button v-if="task.status === 'error'" type="button" class="ih-btn-mini" @click="retry(task)">
              重试
            </button>
            <button type="button" class="ih-btn-mini is-danger" @click="removeTask(task.id)">
              移除
            </button>
          </div>
        </div>
      </li>
    </ul>

    <!-- 清空：与开始上传按钮对齐到右侧 —— 在任务列表下方独立行 -->
    <div v-if="canClear" class="ih-clear-row">
      <button type="button" class="ih-btn-ghost" @click="clearDone">
        清空
      </button>
    </div>

    <section v-if="history.length > 0" class="ih-history" aria-label="历史图片">
      <header class="ih-history-head">
        <h3 class="ih-history-title">
          历史（最多 {{ IMAGE_HISTORY_LIMIT }} 张）
        </h3>
        <button type="button" class="ih-btn-ghost" title="清空历史" @click="clearHistory">
          清空历史
        </button>
      </header>
      <ul class="ih-history-grid">
        <li v-for="img in history" :key="img.url" class="ih-history-item"
          :class="{ selected: selectedImage?.url === img.url }" tabindex="0" role="button"
          :aria-pressed="selectedImage?.url === img.url" @click="selectImage(img)"
          @keydown.enter.prevent="selectImage(img)" @keydown.space.prevent="selectImage(img)">
          <img :src="img.thumb" :alt="img.fileName">
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.image-host {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem 1rem 1rem;
  color: var(--crx-text);
}

.ih-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ih-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--crx-text);
}

.ih-btn-ghost {
  padding: 0.3rem 0.7rem;
  font-size: 0.8rem;
  background: var(--crx-surface);
  color: var(--crx-text);
  border: 1px solid var(--crx-border-strong);
  border-radius: 6px;
  cursor: pointer;
}

.ih-btn-ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ih-btn-ghost:not(:disabled):hover {
  background: var(--crx-surface-alt);
}

.ih-banner {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.9rem;
  align-items: center;
  padding: 0.5rem 0.7rem;
  font-size: 0.78rem;
  color: var(--crx-text);
  background: var(--crx-surface-alt);
  border-radius: 6px;
}

.ih-banner a {
  color: var(--crx-primary-hover);
  word-break: break-all;
}

.ih-uuid code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  color: var(--crx-text);
}

.ih-drop {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  align-items: center;
  justify-content: center;
  min-height: 96px;
  padding: 1rem;
  text-align: center;
  background: var(--crx-surface);
  border: 2px dashed var(--crx-dashed);
  border-radius: 8px;
  cursor: pointer;
  transition: background 150ms, border-color 150ms;
}

.ih-drop:hover,
.ih-drop.active {
  background: var(--crx-primary-soft);
  border-color: var(--crx-primary);
}

.ih-drop-primary {
  margin: 0;
  font-size: 0.85rem;
  color: var(--crx-text);
}

.ih-drop-sub {
  margin: 0;
  font-size: 0.72rem;
  color: var(--crx-text-muted);
}

.ih-file-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
}

/* 顶部控件：左统计，右开始上传（space-between） */
.ih-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.ih-stat {
  font-size: 0.72rem;
  color: var(--crx-text-muted);
}

.ih-btn-primary {
  padding: 0.3rem 0.85rem;
  font-size: 0.8rem;
  color: var(--crx-on-primary);
  background: var(--crx-checkin);
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.ih-btn-primary:not(:disabled):hover {
  background: var(--crx-checkin-hover);
}

.ih-btn-primary:disabled {
  background: var(--crx-disabled-fg);
  cursor: not-allowed;
}

/* 4 个格式 tabs：每个 tab = 一行（label + 复制）+ 预览块 */
.ih-formats {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

/* 选中态提示条 */
.ih-selection-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0.6rem;
  font-size: 0.78rem;
  color: var(--crx-text-on-soft);
  background: var(--crx-primary-soft);
  border: 1px solid var(--crx-primary-soft-border);
  border-radius: 6px;
}

.ih-selection-text code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  color: var(--crx-text-on-soft);
}

.ih-format-tab {
  border: 1px solid var(--crx-border);
  border-radius: 6px;
  background: var(--crx-surface);
  overflow: hidden;
}

.ih-format-tab-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0.6rem;
  background: var(--crx-bg);
  border-bottom: 1px solid var(--crx-border);
}

.ih-format-tab-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--crx-text);
}

.ih-format-tab-body {
  margin: 0;
  padding: 0.5rem 0.6rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--crx-text);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 7.5em;
  overflow: auto;
  background: var(--crx-surface);
}

.ih-empty {
  padding: 1.5rem;
  font-size: 0.85rem;
  color: var(--crx-text-muted);
  text-align: center;
  background: var(--crx-surface);
  border: 1px dashed var(--crx-border);
  border-radius: 8px;
}

.ih-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.6rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.ih-card {
  display: flex;
  flex-direction: column;
  background: var(--crx-surface);
  border: 1px solid var(--crx-border);
  border-radius: 8px;
  overflow: hidden;
}

.ih-card.selectable {
  cursor: pointer;
}

.ih-card.selectable:focus-visible {
  outline: 2px solid var(--crx-primary-hover);
  outline-offset: 2px;
}

.ih-card.selected {
  border-color: var(--crx-primary-hover);
  box-shadow: 0 0 0 2px var(--crx-primary-ring);
}

.ih-card[data-status='error'] {
  border-color: var(--crx-danger-edge);
}

.ih-card[data-status='done'] {
  border-color: var(--crx-success-edge);
}

.ih-card.selected[data-status='done'] {
  border-color: var(--crx-primary-hover);
}

.ih-thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1 / 1;
  background: var(--crx-bg);
}

.ih-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.ih-progress {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  background: var(--crx-overlay);
}

.ih-progress-bar {
  display: block;
  width: 40%;
  height: 4px;
  margin-bottom: 0;
  background: var(--crx-primary-hover);
  border-radius: 2px;
  animation: ih-indeterminate 1.2s ease-in-out infinite;
}

@keyframes ih-indeterminate {
  0% {
    margin-left: -40%;
  }

  100% {
    margin-left: 100%;
  }
}

.ih-meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.45rem 0.55rem 0.55rem;
}

.ih-name {
  font-size: 0.78rem;
  color: var(--crx-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ih-sub {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: var(--crx-text-muted);
}

.ih-status.is-queued {
  color: var(--crx-text-muted);
}

.ih-status.is-uploading {
  color: var(--crx-primary-hover);
}

.ih-status.is-done {
  color: var(--crx-checkin-hover);
}

.ih-status.is-error {
  color: var(--crx-danger-strong);
}

.ih-error {
  font-size: 0.7rem;
  color: var(--crx-danger-strong);
  word-break: break-all;
}

.ih-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.ih-btn-mini {
  padding: 0.2rem 0.5rem;
  font-size: 0.72rem;
  background: var(--crx-surface);
  color: var(--crx-text);
  border: 1px solid var(--crx-border-strong);
  border-radius: 4px;
  cursor: pointer;
}

.ih-btn-mini:hover {
  background: var(--crx-surface-alt);
}

.ih-btn-mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ih-btn-mini.is-danger {
  color: var(--crx-danger-strong);
}

/* 清空行：与顶部 ih-controls 的「开始上传」位置对齐到右边 */
.ih-clear-row {
  display: flex;
  justify-content: flex-end;
}

/* 历史头：标题左、清空历史右（space-between） */
.ih-history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ih-history-title {
  margin: 0;
  font-size: 0.85rem;
  color: var(--crx-text);
}

.ih-history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 0.4rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.ih-history-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1 / 1;
  background: var(--crx-bg);
  border: 2px solid transparent;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 120ms, transform 120ms;
}

.ih-history-item:hover {
  transform: translateY(-1px);
}

.ih-history-item:focus-visible {
  outline: 2px solid var(--crx-primary-hover);
  outline-offset: 2px;
}

.ih-history-item.selected {
  border-color: var(--crx-primary-hover);
  box-shadow: 0 0 0 2px var(--crx-primary-ring);
}

.ih-history-item img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
</style>