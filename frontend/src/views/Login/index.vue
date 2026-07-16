<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN">
    <div class="page">
      <div class="login-box">
        <n-card style="width:360px;" size="large">
          <template #header>
            <div style="text-align:center;">
              <n-icon size="36" color="#534AB7"><BugIcon /></n-icon>
              <h2 style="margin:8px 0 0;font-size:20px;color:#333;">Bug 反馈平台</h2>
              <p style="color:#999;font-size:13px;margin-top:4px;">请登录后提交反馈</p>
            </div>
          </template>

          <n-form ref="formRef" :model="form" :rules="rules" label-placement="top">
            <n-form-item label="用户名" path="username">
              <n-input v-model:value="form.username" placeholder="输入用户名" size="large" />
            </n-form-item>
            <n-form-item label="密码" path="password">
              <n-input v-model:value="form.password" type="password" placeholder="输入密码" size="large" @keyup.enter="handleLogin" />
            </n-form-item>
          </n-form>

          <n-button type="primary" block size="large" :loading="loading" @click="handleLogin">
            登录
          </n-button>

          <n-alert v-if="errorMsg" type="error" style="margin-top:12px;" :title="errorMsg" />
        </n-card>
      </div>
    </div>
  </n-config-provider>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { NConfigProvider, NCard, NForm, NFormItem, NInput, NButton, NIcon, NAlert, zhCN, dateZhCN } from 'naive-ui'
import { BugOutline as BugIcon } from '@vicons/ionicons5'
import { useAuthStore } from '../../stores/auth' // 注意引用深度变了，原为 '../stores/auth'，这里多了一层 views/Login，所以改用 '../../stores/auth'

const router = useRouter()
const auth = useAuthStore()

const loading = ref(false)
const errorMsg = ref('')
const form = reactive({ username: '', password: '' })
const rules = {
  username: [{ required: true, message: '请输入用户名' }],
  password: [{ required: true, message: '请输入密码' }]
}

async function handleLogin() {
  errorMsg.value = ''
  loading.value = true
  const result = await auth.login(form.username, form.password)
  loading.value = false
  if (result.error) {
    errorMsg.value = result.error
  } else {
    const role = auth.user?.role
    router.push(role === 'admin' ? '/admin' : '/report')
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: #f0f2f5; display: flex; align-items: center; justify-content: center; }
.login-box { width: 100%; display: flex; justify-content: center; }
</style>
