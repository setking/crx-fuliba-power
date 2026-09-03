<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ENABLED_SITES, MESSAGE_TYPES } from '@/global'
import type { LoginStatus } from '@/type'
import { isEnabledSite } from '@/utils/sites'

type Status = 'loading' | 'enabled' | 'disabled'

const status = ref<Status>('loading')
const currentHost = ref<string>('')
const activeTabId = ref<number | null>(null)
const checkinMsg = ref<string>('')

const autoCheckinEnabled = ref(true)
const lastCheckinDate = ref<string>('')

const loginStatus = ref<LoginStatus>('unknown')

async function probeLoginStatus() {
  if (activeTabId.value == null) {
    loginStatus.value = 'unknown'
    return
  }
  try {
    // 注入一段小脚本到目标页面，检查登录标志
    const res = await chrome.tabs.sendMessage(activeTabId.value, { type: MESSAGE_TYPES.PROBE_LOGIN })
    loginStatus.value = res?.loggedIn ? 'logged-in' : 'logged-out'
  }
  catch {
    loginStatus.value = 'unknown'
  }
}

onMounted(async () => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    activeTabId.value = tab?.id ?? null
    const url = tab?.url ?? ''
    let host = ''
    try {
      host = new URL(url).hostname
    }
    catch {
      host = ''
    }
    currentHost.value = host
    status.value = isEnabledSite(host) ? 'enabled' : 'disabled'

    // 如果是白名单站点，主动询问登录状态
    if (status.value === 'enabled') {
      await probeLoginStatus()
    }
  }
  catch (err) {
    console.error('[popup] query tab failed:', err)
    status.value = 'disabled'
  }

  // 读取自动签到开关 & 上次签到日期
  const stored = await chrome.storage.local.get(['autoCheckinEnabled', 'lastCheckin'])
  if (stored.autoCheckinEnabled === false) autoCheckinEnabled.value = false
  const last = stored.lastCheckin as { host: string; date: string } | undefined
  if (last?.host === currentHost.value) {
    lastCheckinDate.value = last.date
  }
})

async function toggleAutoCheckin() {
  autoCheckinEnabled.value = !autoCheckinEnabled.value
  await chrome.storage.local.set({ autoCheckinEnabled: autoCheckinEnabled.value })
}

async function triggerCheckin() {
  if (activeTabId.value == null) {
    checkinMsg.value = '找不到当前标签页'
    return
  }
  try {
    const res = await chrome.tabs.sendMessage(activeTabId.value, { type: MESSAGE_TYPES.CHECKIN })
    checkinMsg.value = res?.msg ?? '已发送请求'
  }
  catch (err) {
    checkinMsg.value = `发送失败：${(err as Error).message}`
  }
}

// async function openSidePanel() {
//   try {
//     const [tab] = await chrome.tabs.query({
//       active: true,
//       currentWindow: true,
//     })

//     if (tab?.id == null) {
//       throw new Error('无法获取当前 Tab')
//     }

//     await chrome.sidePanel.open({
//       tabId: tab.id,
//     })

//     window.close()
//   } catch (err) {
//     checkinMsg.value = `打开侧边栏失败：${(err as Error).message}`
//   }
// }
</script>

<template>
  <main class="popup">
    <!-- 加载中 -->
    <div v-if="status === 'loading'" class="state loading">
      <span>加载中…</span>
    </div>

    <!-- 在白名单：显示签到功能 -->
    <div v-else-if="status === 'enabled'" class="state enabled">
      <h2 class="title-small">论坛助手</h2>

      <div class="login-badge" :class="loginStatus">
        <template v-if="loginStatus === 'logged-in'">
          ✅ 已登录
        </template>
        <template v-else-if="loginStatus === 'logged-out'">
          ⚠️ 未登录 · 请先登录论坛
        </template>
        <template v-else>
          检测中…
        </template>
      </div>

      <div class="checkin-row">
        <label class="switch">
          <input type="checkbox" :checked="autoCheckinEnabled" @change="toggleAutoCheckin">
          <span>自动签到</span>
        </label>
        <span v-if="lastCheckinDate" class="last-checkin">
          上次：{{ lastCheckinDate }}
        </span>
      </div>

      <button class="checkin-btn" :disabled="!!lastCheckinDate" @click="triggerCheckin">
        🎯 立即签到
      </button>
      <!-- <button class="sidepanel-btn" @click="openSidePanel">
        📂 打开侧边栏
      </button> -->
      <p v-if="checkinMsg" class="checkin-msg">
        {{ checkinMsg }}
      </p>
    </div>

    <!-- 不在白名单 -->
    <div v-else class="state disabled">
      <div class="icon">⚠️</div>
      <h2>非插件可用网站</h2>
      <p class="desc">
        当前站点
        <code v-if="currentHost">{{ currentHost }}</code>
        <code v-else>（无法识别）</code>
        不在插件支持范围内。
      </p>
      <p class="hint">
        本插件仅在以下站点可用：
      </p>
      <ul class="sites">
        <li v-for="site in ENABLED_SITES" :key="site">
          {{ site }}
        </li>
      </ul>
    </div>
  </main>
</template>

<style scoped>
.popup {
  width: 320px;
  min-height: 160px;
  padding: 1rem;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: #1f2937;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
}

.state.loading {
  padding: 2rem 0;
  color: #6b7280;
}

.state.disabled {
  padding: 0.5rem 0;
}

.icon {
  font-size: 2.5rem;
  line-height: 1;
}

.state.disabled h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: #b91c1c;
}

.desc {
  margin: 0;
  font-size: 0.85rem;
  color: #4b5563;
  line-height: 1.5;
}

.desc code {
  background: #f3f4f6;
  padding: 0 0.35rem;
  border-radius: 4px;
  font-size: 0.8rem;
  word-break: break-all;
}

.hint {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: #6b7280;
}

.sites {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  justify-content: center;
}

.sites li {
  background: #eff6ff;
  color: #1d4ed8;
  padding: 0.15rem 0.55rem;
  border-radius: 9999px;
  font-size: 0.75rem;
}

.title-small {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: #1f2937;
}

.login-badge {
  margin-top: 0.5rem;
  padding: 0.3rem 0.75rem;
  font-size: 0.8rem;
  border-radius: 9999px;
}

.login-badge.logged-in {
  background: #d1fae5;
  color: #065f46;
}

.login-badge.logged-out {
  background: #fee2e2;
  color: #991b1b;
}

.login-badge.unknown {
  background: #f3f4f6;
  color: #6b7280;
}

.checkin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-top: 0.5rem;
  font-size: 0.85rem;
}

.switch {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  user-select: none;
}

.switch input {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.last-checkin {
  font-size: 0.75rem;
  color: #6b7280;
}

.checkin-btn {
  margin-top: 0.25rem;
  padding: 0.5rem 1.25rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: white;
  background: #10b981;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 150ms;
}

.checkin-btn:hover:not(:disabled) {
  background: #059669;
}

.checkin-btn:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.sidepanel-btn {
  margin-top: 0.4rem;
  padding: 0.4rem 1rem;
  font-size: 0.85rem;
  color: #1f2937;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  cursor: pointer;
  transition: background 150ms;
}

.sidepanel-btn:hover {
  background: #f3f4f6;
}

.checkin-msg {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #4b5563;
}
</style>
