<template>
  <div class="user-mgmt">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 style="margin:0;font-size:16px;">用户管理</h3>
      <n-button type="primary" size="small" @click="showUserModal = true; editingUser = null; userForm = { username: '', password: '', displayName: '', role: 'user' }">
        <template #icon><n-icon><AddIcon /></n-icon></template>
        创建用户
      </n-button>
    </div>

    <n-spin :show="userLoading">
      <n-table :single-line="false" size="small">
        <thead>
          <tr>
            <th>用户名</th>
            <th>显示名</th>
            <th>角色</th>
            <th>状态</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.username }}</td>
            <td>{{ u.displayName }}</td>
            <td><n-tag :type="u.role === 'admin' ? 'success' : 'default'" size="small">{{ u.role === 'admin' ? '管理员' : '用户' }}</n-tag></td>
            <td><n-tag :type="u.status === 'active' ? 'success' : 'error'" size="small">{{ u.status === 'active' ? '正常' : '已禁用' }}</n-tag></td>
            <td>{{ formatTime(u.createdAt) }}</td>
            <td>
              <n-button text size="tiny" type="primary" @click="editUser(u)">编辑</n-button>
              <n-button text size="tiny" type="warning" @click="showResetPwd(u)" style="margin-left:8px;">重置密码</n-button>
              <n-button v-if="u.status === 'active'" text size="tiny" type="error" @click="toggleUser(u, 'disable')" style="margin-left:8px;">禁用</n-button>
              <n-button v-else text size="tiny" type="success" @click="toggleUser(u, 'enable')" style="margin-left:8px;">启用</n-button>
            </td>
          </tr>
        </tbody>
      </n-table>
    </n-spin>

    <!-- 创建/编辑用户弹窗 -->
    <n-modal v-model:show="showUserModal" preset="card" title="用户信息" style="width:400px;">
      <n-form label-placement="top">
        <n-form-item label="用户名" required>
          <n-input v-model:value="userForm.username" :disabled="!!editingUser" placeholder="登录用户名" />
        </n-form-item>
        <n-form-item :label="editingUser ? '新密码（留空不修改）' : '密码'" :required="!editingUser">
          <n-input v-model:value="userForm.password" type="password" placeholder="密码" />
        </n-form-item>
        <n-form-item label="显示名称" required>
          <n-input v-model:value="userForm.displayName" placeholder="如：张三" />
        </n-form-item>
        <n-form-item label="角色">
          <n-select v-model:value="userForm.role" :options="roleOptions" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-button @click="showUserModal = false">取消</n-button>
        <n-button type="primary" :loading="userSaving" @click="saveUser">{{ editingUser ? '保存' : '创建' }}</n-button>
      </template>
    </n-modal>

    <!-- 重置密码弹窗 -->
    <n-modal v-model:show="showResetModal" preset="card" title="重置密码" style="width:360px;">
      <n-form-item label="新密码">
        <n-input v-model:value="resetPwd" type="password" placeholder="至少4位" />
      </n-form-item>
      <template #footer>
        <n-button @click="showResetModal = false">取消</n-button>
        <n-button type="primary" :loading="resetSaving" @click="doResetPwd">确定重置</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import {
  NButton, NIcon, NSpin, NTable, NModal, NForm, NFormItem, NInput, NSelect, NTag
} from 'naive-ui'
import { AddOutline as AddIcon } from '@vicons/ionicons5'
import * as api from '../../../api'

// User management state
const users = ref([])
const userLoading = ref(false)
const userSaving = ref(false)
const showUserModal = ref(false)
const editingUser = ref(null)
const userForm = ref({ username: '', password: '', displayName: '', role: 'user' })
const roleOptions = [{ label: '普通用户', value: 'user' }, { label: '管理员', value: 'admin' }]

// 重置密码
const showResetModal = ref(false)
const resetPwd = ref('')
const resetSaving = ref(false)
const resetUserId = ref('')

async function loadUsers() {
  userLoading.value = true
  try {
    const data = await api.getUsers()
    users.value = data.users || []
  } catch (e) {
    console.error(e)
  } finally {
    userLoading.value = false
  }
}

function editUser(u) {
  editingUser.value = u
  userForm.value = { username: u.username, password: '', displayName: u.displayName, role: u.role }
  showUserModal.value = true
}

async function saveUser() {
  if (!userForm.value.displayName || (!editingUser.value && !userForm.value.password)) return
  userSaving.value = true
  try {
    if (editingUser.value) {
      const body = { displayName: userForm.value.displayName, role: userForm.value.role }
      if (userForm.value.password) body.password = userForm.value.password
      await api.updateUser(editingUser.value.id, body)
    } else {
      await api.createUser(userForm.value)
    }
    showUserModal.value = false
    await loadUsers()
  } catch (e) {
    console.error(e)
  } finally {
    userSaving.value = false
  }
}

async function toggleUser(u, action) {
  try {
    if (action === 'disable') await api.disableUser(u.id)
    else await api.enableUser(u.id)
    await loadUsers()
  } catch (e) {
    console.error(e)
  }
}

function showResetPwd(u) {
  resetUserId.value = u.id
  resetPwd.value = ''
  showResetModal.value = true
}

async function doResetPwd() {
  if (!resetPwd.value || resetPwd.value.length < 4) return
  resetSaving.value = true
  try {
    await api.resetPassword(resetUserId.value, resetPwd.value)
    showResetModal.value = false
  } catch (e) {
    console.error(e)
  } finally {
    resetSaving.value = false
  }
}

function formatTime(s) { return new Date(s).toLocaleString('zh-CN') }

onMounted(() => {
  loadUsers()
})
</script>

<style scoped>
.user-mgmt {
  padding: 24px;
  width: 100%;
}
</style>
