<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme="darkTheme">
    <div class="page">
      <n-layout>
        <n-layout-header bordered>
          <div class="header">
            <div class="header-left">
              <n-icon size="22" color="#a78bfa"><BugIcon /></n-icon>
              <span class="title" style="margin-left:8px; text-shadow:0 0 8px rgba(167, 139, 250, 0.4);">SYNTH-FIX // 反馈记录</span>
            </div>
            <div class="header-right">
              <n-button quaternary size="small" @click="$router.push('/report')" style="margin-right:8px;">
                <template #icon><n-icon><AddIcon /></n-icon></template>
                提交反馈
              </n-button>
              <n-dropdown :options="userMenu" @select="handleUserMenu">
                <n-button quaternary size="small">
                  <template #icon><n-icon><PersonIcon /></n-icon></template>
                  {{ auth.displayName }}
                  <n-tag size="tiny" :bordered="false" :type="auth.isAdmin ? 'success' : (auth.isDeveloper ? 'info' : 'default')" style="margin-left:6px; font-weight:600;">
                    {{ auth.isAdmin ? '系统管理员' : (auth.isDeveloper ? '评审专家' : '测试人员') }}
                  </n-tag>
                </n-button>
              </n-dropdown>
            </div>
          </div>
        </n-layout-header>

        <n-layout-content>
          <div class="content">
            <n-spin :show="loading">
              <div v-if="feedbacks.length === 0" style="text-align:center;margin-top:80px;">
                <n-empty description="还没有提交过反馈">
                  <template #extra>
                    <n-button type="primary" @click="$router.push('/report')">去提交</n-button>
                  </template>
                </n-empty>
              </div>

              <n-list v-else>
                <n-list-item v-for="fb in feedbacks" :key="fb.id">
                  <n-card size="small" :title="fb.description">
                    <template #header-extra>
                      <n-tag :type="statusTag(fb.status)" size="small">{{ statusLabel(fb.status) }}</n-tag>
                    </template>
                    <n-grid :cols="3" :x-gap="8">
                      <n-grid-item><span class="label">分类</span>: {{ fb.category }}</n-grid-item>
                      <n-grid-item><span class="label">时间</span>: {{ formatTime(fb.createdAt) }}</n-grid-item>
                      <n-grid-item><span class="label">上报人</span>: {{ fb.reporter }}</n-grid-item>
                    </n-grid>
                    <p v-if="fb.detail" class="detail-text">{{ fb.detail }}</p>
                    <n-divider v-if="fb.fixResult" style="margin:8px 0;" />
                    <div v-if="fb.fixResult">
                      <p v-if="fb.fixResult.error" class="error-text">{{ fb.fixResult.error }}</p>
                      <div v-if="fb.fixResult.diff && fb.fixResult.diff !== '未见明显代码修改'" class="diff-box">
                        <pre>{{ fb.fixResult.diff }}</pre>
                      </div>
                      <p v-if="fb.fixResult.fixedAt" style="color:#999;font-size:12px;">修复时间: {{ formatTime(fb.fixResult.fixedAt) }}</p>
                    </div>
                  </n-card>
                </n-list-item>
              </n-list>
            </n-spin>
          </div>
        </n-layout-content>
      </n-layout>
    </div>
  </n-config-provider>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  NConfigProvider, NLayout, NLayoutHeader, NLayoutContent, NCard,
  NGrid, NGridItem, NList, NListItem, NButton, NIcon, NTag, NDivider,
  NEmpty, NSpin, NDropdown, zhCN, dateZhCN, darkTheme
} from 'naive-ui'
import { BugOutline as BugIcon, AddOutline as AddIcon, PersonOutline as PersonIcon, LogOutOutline as LogOutIcon, SettingsOutline as SettingsIcon } from '@vicons/ionicons5'
import { useAuthStore } from '../../stores/auth'
import * as api from '../../api'
import { h } from 'vue'

const router = useRouter()
const auth = useAuthStore()

const loading = ref(false)
const feedbacks = ref([])

const userMenu = [
  { label: '提交反馈', key: 'report', icon: () => h(AddIcon) },
  { label: '审批后台', key: 'admin', icon: () => h(SettingsIcon), show: auth.hasConsoleAccess },
  { label: '退出登录', key: 'logout', icon: () => h(LogOutIcon) }
].filter(item => item.show !== false)

function handleUserMenu(key) {
  if (key === 'logout') { auth.logout(); router.push('/login') }
  if (key === 'report') router.push('/report')
  if (key === 'admin') router.push('/admin')
}

async function loadList() {
  loading.value = true
  const data = await api.getMyFeedbacks()
  feedbacks.value = data.feedbacks || []
  loading.value = false
}

function statusTag(s) {
  const m = { pending: 'warning', approved: 'info', rejected: 'default', fixed: 'success', failed: 'error' }
  return m[s] || 'default'
}

function statusLabel(s) {
  const m = { pending: '待审批', approved: '修复中', rejected: '已拒绝', fixed: '已修复', failed: '修复失败' }
  return m[s] || s
}

function formatTime(s) { return new Date(s).toLocaleString('zh-CN') }

onMounted(loadList)
</script>

<style scoped>
.page { min-height: 100vh; background: radial-gradient(circle at 10% 20%, #0d0d15 0%, #120e24 100%); font-family: 'Inter', sans-serif; color: #e2e8f0; }
.header { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; height: 52px; }
.header-left, .header-right { display: flex; align-items: center; gap: 10px; }
.title { font-size: 17px; font-weight: 600; color: #a78bfa; }
.content { max-width: 800px; margin: 16px auto; padding: 0 16px; }
.label { font-weight: 500; color: #94a3b8; font-size: 13px; }
.detail-text { color: #cbd5e1; font-size: 13px; margin-top: 4px; }
.error-text { color: #f87171; font-size: 13px; }
.diff-box { background: #0c0a15; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 12px; overflow-x: auto; max-height: 200px; overflow-y: auto; margin-top: 4px; }
.diff-box pre { color: #e2e8f0; font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.5; margin: 0; white-space: pre-wrap; }

:deep(.n-card) {
  background: rgba(20, 20, 32, 0.5) !important;
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.06) !important;
  border-radius: 14px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25) !important;
}
:deep(.n-layout-header) {
  background: rgba(13, 13, 21, 0.8) !important;
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
}
:deep(.n-layout) { background: transparent !important; }
:deep(.n-layout-scroll-container) { background: transparent !important; }
:deep(.n-list) { background: transparent !important; }
:deep(.n-list-item) { background: transparent !important; border-bottom: 1px solid rgba(255,255,255,0.06) !important; }
</style>
