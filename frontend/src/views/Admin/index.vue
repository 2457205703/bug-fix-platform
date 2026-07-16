<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme="darkTheme">
    <div class="page">
      <n-layout>
        <n-layout-header bordered>
          <div class="header">
            <div class="header-left">
              <n-icon size="22" color="#a78bfa"><ShieldIcon /></n-icon>
              <span class="title" style="margin-left:8px; margin-right:12px;">SYNTH-FIX // 控制台</span>
              <n-tabs v-model:value="activeTab" type="bar" size="small" style="margin-left:16px; flex-shrink:0;">
                <n-tab name="feedbacks">反馈审批</n-tab>
                <n-tab name="users" v-if="auth.isAdmin">用户管理</n-tab>
                <n-tab name="projects" v-if="auth.isAdmin">项目管理</n-tab>
              </n-tabs>
            </div>
            <div class="header-right">
              <n-button quaternary size="small" @click="$router.push('/report')" style="margin-right:8px;">
                <template #icon><n-icon><BugIcon /></n-icon></template>
                提交反馈
              </n-button>
              <n-dropdown :options="userMenuOptions" @select="handleUserMenu">
                <n-button quaternary size="small">
                  <template #icon><n-icon><PersonIcon /></n-icon></template>
                  {{ auth.displayName }}
                  <n-tag size="tiny" :bordered="false" :type="auth.isAdmin ? 'success' : 'info'" style="margin-left:6px; font-weight:600;">
                    {{ auth.isAdmin ? '系统管理员' : '评审专家' }}
                  </n-tag>
                </n-button>
              </n-dropdown>
            </div>
          </div>
        </n-layout-header>

        <n-layout-content>
          <div style="display:flex; height:calc(100vh - 52px);">
            <!-- ========= 渲染嵌套路由的页面视图 ========= -->
            <router-view />
          </div>
        </n-layout-content>
      </n-layout>
    </div>
  </n-config-provider>
</template>

<script setup>
import { computed, h } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  NConfigProvider, NLayout, NLayoutHeader, NLayoutContent,
  NTabs, NTab, NButton, NIcon, NDropdown, NTag, zhCN, dateZhCN, darkTheme
} from 'naive-ui'
import {
  ShieldCheckmarkOutline as ShieldIcon,
  PersonOutline as PersonIcon, BugOutline as BugIcon, LogOutOutline as LogOutIcon
} from '@vicons/ionicons5'
import { useAuthStore } from '../../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

// 使用双向绑定的计算属性让 Tab 选中状态与子路由同步
const activeTab = computed({
  get() {
    if (route.path.includes('/admin/users')) return 'users'
    if (route.path.includes('/admin/projects')) return 'projects'
    return 'feedbacks'
  },
  set(val) {
    router.push(`/admin/${val}`)
  }
})

const userMenuOptions = [
  { label: '退出登录', key: 'logout', icon: () => h(LogOutIcon) }
]

function handleUserMenu(key) {
  if (key === 'logout') {
    auth.logout()
    router.push('/login')
  }
}
</script>

<style scoped>
.page { 
  min-height: 100vh; 
  background: radial-gradient(circle at 10% 20%, #0d0d15 0%, #120e24 100%);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  color: #e2e8f0;
}
.header { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; height: 52px; }
.header-left, .header-right { display: flex; align-items: center; }
.title { font-size: 17px; font-weight: 600; color: #a78bfa; margin-right: 8px; white-space: nowrap; flex-shrink: 0; text-shadow: 0 0 8px rgba(167, 139, 250, 0.4); }

:deep(.n-layout-header) {
  background: rgba(13, 13, 21, 0.8) !important;
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
}
:deep(.n-layout) { background: transparent !important; }
:deep(.n-layout-scroll-container) { background: transparent !important; }

/* 深度定制 Naive UI 卡片与全局面板实现毛玻璃 */
:deep(.n-card) {
  background: rgba(20, 20, 32, 0.5) !important;
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.06) !important;
  border-radius: 14px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25) !important;
}
</style>
