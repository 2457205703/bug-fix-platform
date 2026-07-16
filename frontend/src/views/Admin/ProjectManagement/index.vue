<template>
  <div class="project-mgmt">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 style="margin:0;font-size:16px;">项目管理</h3>
      <n-button type="primary" size="small" @click="showProjectModal = true; editingProject = null; projectForm = { name: '', path: '', url: '', verificationCommand: '', autoCommit: false, autoRollback: false, gitPaths: '' }">
        <template #icon><n-icon><AddIcon /></n-icon></template>
        添加项目
      </n-button>
    </div>

    <n-spin :show="projectLoading">
      <n-table :single-line="false" size="small">
        <thead>
          <tr>
            <th>项目名称</th>
            <th>物理路径 (CWD)</th>
            <th>Git 仓库路径</th>
            <th>页面 URL</th>
            <th>编译验证命令</th>
            <th>失败回滚</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in projects" :key="p.id">
            <td>{{ p.name }}</td>
            <td><code style="font-size:11px;">{{ p.path }}</code></td>
            <td><code style="font-size:11px;color:#a78bfa;">{{ p.gitPaths || '自动检测' }}</code></td>
            <td>{{ p.url || '-' }}</td>
            <td><code style="font-size:11px;">{{ p.verificationCommand || '-' }}</code></td>
            <td><n-tag :type="p.autoRollback ? 'success' : 'default'" size="small">{{ p.autoRollback ? '启用' : '禁用' }}</n-tag></td>
            <td>
              <n-button text size="tiny" type="primary" @click="editProject(p)">编辑</n-button>
              <n-popconfirm v-if="p.id !== 'default'" @positive-click="deleteProject(p.id)">
                <template #trigger>
                  <n-button text size="tiny" type="error" style="margin-left:8px;">删除</n-button>
                </template>
                确定要删除该项目配置吗？
              </n-popconfirm>
            </td>
          </tr>
        </tbody>
      </n-table>
    </n-spin>

    <!-- 创建/编辑项目弹窗 -->
    <n-modal v-model:show="showProjectModal" preset="card" title="项目配置信息" style="width:500px;">
      <n-form label-placement="top">
        <n-form-item label="项目名称" required>
          <n-input v-model:value="projectForm.name" placeholder="如：大屏项目" />
        </n-form-item>
        <n-form-item label="项目根目录绝对路径 (CWD)" required>
          <n-input v-model:value="projectForm.path" placeholder="如：/Users/xumeiqiang/Desktop/OfficeProject/CIM_NEW" />
        </n-form-item>
        <n-form-item label="Git 仓库路径（多个用换行分隔）">
          <n-input v-model:value="projectForm.gitPaths" type="textarea" :rows="3" placeholder="如：/path/to/frontend\n/path/to/backend\n留空则自动检测子目录中的 .git" />
        </n-form-item>
        <n-form-item label="本地运行 URL（视觉测试对比使用）">
          <n-input v-model:value="projectForm.url" placeholder="如：http://localhost:5173" />
        </n-form-item>
        <n-form-item label="编译/验证命令">
          <n-input v-model:value="projectForm.verificationCommand" placeholder="如：npm run build" />
        </n-form-item>
        <n-grid :cols="2" :x-gap="12">
          <n-grid-item>
            <n-form-item label="失败自动回滚">
              <n-select v-model:value="projectForm.autoRollback" :options="[ {label: '启用', value: true}, {label: '禁用', value: false} ]" />
            </n-form-item>
          </n-grid-item>
        </n-grid>
      </n-form>
      <template #footer>
        <n-button @click="showProjectModal = false">取消</n-button>
        <n-button type="primary" :loading="projectSaving" @click="saveProject">{{ editingProject ? '保存' : '添加' }}</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import {
  NButton, NIcon, NSpin, NTable, NModal, NForm, NFormItem, NInput, NSelect, NTag, NPopconfirm, NGrid, NGridItem
} from 'naive-ui'
import { AddOutline as AddIcon } from '@vicons/ionicons5'
import * as api from '../../../api'

// Project management state
const projects = ref([])
const projectLoading = ref(false)
const projectSaving = ref(false)
const showProjectModal = ref(false)
const editingProject = ref(null)
const projectForm = ref({ name: '', path: '', url: '', verificationCommand: '', autoCommit: false, autoRollback: false, gitPaths: '' })

async function loadProjects() {
  projectLoading.value = true
  try {
    const res = await api.getProjects()
    projects.value = res.projects || []
  } catch (e) {
    console.error(e)
  } finally {
    projectLoading.value = false
  }
}

function editProject(p) {
  editingProject.value = p
  projectForm.value = {
    name: p.name,
    path: p.path,
    url: p.url || '',
    verificationCommand: p.verificationCommand || '',
    autoCommit: p.autoCommit,
    autoRollback: p.autoRollback,
    gitPaths: p.gitPaths || ''
  }
  showProjectModal.value = true
}

async function saveProject() {
  if (!projectForm.value.name?.trim() || !projectForm.value.path?.trim()) return
  projectSaving.value = true
  try {
    const payload = {
      name: projectForm.value.name.trim(),
      path: projectForm.value.path.trim(),
      url: (projectForm.value.url || '').trim(),
      verificationCommand: (projectForm.value.verificationCommand || '').trim(),
      autoCommit: !!projectForm.value.autoCommit,
      autoRollback: !!projectForm.value.autoRollback,
      gitPaths: (projectForm.value.gitPaths || '').trim()
    }

    if (editingProject.value) {
      await api.updateProject(editingProject.value.id, payload)
    } else {
      await api.createProject(payload)
    }
    showProjectModal.value = false
    await loadProjects()
  } catch (e) {
    console.error(e)
  } finally {
    projectSaving.value = false
  }
}

async function deleteProject(id) {
  try {
    await api.deleteProject(id)
    await loadProjects()
  } catch (e) {
    console.error(e)
  }
}

onMounted(() => {
  loadProjects()
})
</script>

<style scoped>
.project-mgmt {
  padding: 24px;
  width: 100%;
}
</style>
