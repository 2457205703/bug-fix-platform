<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme="darkTheme">
    <div class="page">
      <n-layout>
        <n-layout-header bordered>
          <div class="header">
            <div class="header-left">
              <n-icon size="22" color="#a78bfa"><BugIcon /></n-icon>
              <span class="title" style="margin-left:8px; text-shadow:0 0 8px rgba(167, 139, 250, 0.4);">SYNTH-FIX // 反馈中心</span>
            </div>
            <div class="header-right">
              <n-button quaternary size="small" @click="$router.push('/my')" style="margin-right:8px;">
                <template #icon><n-icon><ListIcon /></n-icon></template>
                我的反馈
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
            <n-card title="提交问题反馈" size="large">
              <n-form ref="formRef" :model="form" :rules="rules" label-placement="top">
                <n-grid :cols="2" :x-gap="24">
                  <n-grid-item>
                    <n-form-item label="问题截图">
                      <div
                        class="screenshot-area"
                        :class="{ 'has-image': screenshotPreview }"
                        @click="triggerFileInput"
                        @paste="handlePaste"
                        tabindex="0"
                      >
                        <img v-if="screenshotPreview" :src="screenshotPreview" />
                        <div v-else class="placeholder">
                          <n-icon size="40" color="#ccc"><CameraIcon /></n-icon>
                          <p>点击选择截图或 Ctrl+V 粘贴</p>
                          <p class="hint">支持 PNG、JPG、GIF</p>
                        </div>
                      </div>
                      <input ref="fileInput" type="file" accept="image/*" style="display:none" @change="handleFileChange" />
                    </n-form-item>
                  </n-grid-item>

                  <n-grid-item>
                    <n-form-item label="关联项目" path="projectId">
                      <n-select v-model:value="form.projectId" :options="projectOptions" placeholder="选择归属的项目" />
                    </n-form-item>

                    <n-form-item label="问题分类" path="category">
                      <n-select v-model:value="form.category" :options="categoryOptions" placeholder="选择分类" />
                    </n-form-item>

                    <n-form-item label="页面路由 URL（可选）">
                      <n-input v-model:value="form.urlPath" placeholder="如: /model/environment（供 AI 自动截图与视觉对比）" />
                    </n-form-item>

                    <n-form-item label="问题描述" path="description">
                      <n-input v-model:value="form.description" type="textarea" :rows="3" placeholder="简单描述你遇到的问题..." />
                    </n-form-item>
                  </n-grid-item>
                </n-grid>

                <n-form-item label="补充说明（可选）">
                  <n-input v-model:value="form.detail" type="textarea" :rows="2" placeholder="复现步骤、期望结果、影响范围等..." />
                </n-form-item>
              </n-form>

              <n-button type="primary" size="large" block :loading="submitting" @click="handleSubmit">
                {{ submitting ? '提交中...' : '提交反馈' }}
              </n-button>

              <n-alert v-if="submitResult" :type="submitResult.type" :title="submitResult.title" class="result-alert">
                {{ submitResult.message }}
              </n-alert>
            </n-card>
          </div>
        </n-layout-content>
      </n-layout>
    </div>

    <!-- 截图标注 Modal -->
    <n-modal v-model:show="showAnnotateModal" preset="card" title="🎨 标注 Bug 区域（画框或自由画笔）" style="width: 800px; max-width:95vw;" :mask-closable="false">
      <div style="display:flex; flex-direction:column; gap:12px; align-items:center;">
        <!-- 工具栏 -->
        <n-space justify="space-between" style="width:100%;">
          <n-space>
            <n-button :type="drawMode === 'rect' ? 'primary' : 'default'" size="small" @click="drawMode = 'rect'">
              🔴 红色画框
            </n-button>
            <n-button :type="drawMode === 'draw' ? 'primary' : 'default'" size="small" @click="drawMode = 'draw'">
              ✏️ 自由画笔
            </n-button>
            <n-button size="small" @click="undoDraw">
              ↩️ 撤销
            </n-button>
            <n-button size="small" @click="clearDraw">
              🗑️ 重置
            </n-button>
          </n-space>
          <n-button type="success" size="small" @click="saveAnnotation">
            ✔️ 保存并上传
          </n-button>
        </n-space>

        <!-- 画布容器 -->
        <div class="canvas-wrapper">
          <canvas ref="annotateCanvas" style="display:block; max-width:100%; border:1px solid rgba(255,255,255,0.12); cursor:crosshair; background:#000;"
                  @mousedown="onCanvasMouseDown" @mousemove="onCanvasMouseMove" @mouseup="onCanvasMouseUp"
                  @touchstart="onCanvasTouchStart" @touchmove="onCanvasTouchMove" @touchend="onCanvasTouchEnd"></canvas>
        </div>
      </div>
    </n-modal>
  </n-config-provider>
</template>

<script setup>
import { ref, reactive, h, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import {
  NConfigProvider, NLayout, NLayoutHeader, NLayoutContent,
  NCard, NForm, NFormItem, NGrid, NGridItem, NInput, NSelect,
  NButton, NIcon, NAlert, NTag, NDropdown, NModal, NSpace, zhCN, dateZhCN, darkTheme
} from 'naive-ui'
import {
  BugOutline as BugIcon, CameraOutline as CameraIcon, PersonOutline as PersonIcon,
  ListOutline as ListIcon, LogOutOutline as LogOutIcon, SettingsOutline as SettingsIcon
} from '@vicons/ionicons5'
import { useAuthStore } from '../../stores/auth'
import * as api from '../../api'

const router = useRouter()
const auth = useAuthStore()

const userMenu = [
  { label: '我的反馈', key: 'my', icon: () => h(ListIcon) },
  { label: '审批后台', key: 'admin', icon: () => h(SettingsIcon), show: auth.hasConsoleAccess },
  { label: '退出登录', key: 'logout', icon: () => h(LogOutIcon) }
].filter(item => item.show !== false)

function handleUserMenu(key) {
  if (key === 'logout') { auth.logout(); router.push('/login') }
  if (key === 'my') router.push('/my')
  if (key === 'admin') router.push('/admin')
}

const formRef = ref(null)
const fileInput = ref(null)
const submitting = ref(false)
const submitResult = ref(null)
const screenshotPreview = ref(null)
const screenshotFile = ref(null)

// 截图标注响应式变量
const showAnnotateModal = ref(false)
const drawMode = ref('rect')
const annotateCanvas = ref(null)

let canvasCtx = null
let isDrawing = false
let startX = 0
let startY = 0
let drawHistory = []
let baseImage = null

const form = reactive({ category: 'Bug', description: '', detail: '', urlPath: '', projectId: null })
const rules = { 
  description: [{ required: true, message: '请输入问题描述', trigger: 'blur' }],
  projectId: [{ required: true, message: '请选择关联项目', trigger: 'change' }]
}
const categoryOptions = [
  { label: 'Bug', value: 'Bug' },
  { label: '功能建议', value: '功能建议' },
  { label: '体验问题', value: '体验问题' },
  { label: '性能问题', value: '性能问题' },
  { label: '其他', value: '其他' }
]

function triggerFileInput() { fileInput.value?.click() }

function handleFileChange(e) {
  const file = e.target.files[0]
  if (file) {
    openAnnotate(file)
  }
  if (e.target) e.target.value = ''
}

function handlePaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile()
      const file = new File([blob], 'paste.png', { type: blob.type })
      openAnnotate(file)
      e.preventDefault()
      return
    }
  }
}

import { onMounted, onUnmounted } from 'vue'

const projectOptions = ref([])

async function loadProjects() {
  try {
    const res = await api.getProjects()
    projectOptions.value = (res.projects || []).map(p => ({
      label: p.name,
      value: p.id
    }))
    if (projectOptions.value.length > 0) {
      form.projectId = projectOptions.value[0].value
    }
  } catch (e) {
    console.error(e)
  }
}

onMounted(() => {
  window.addEventListener('paste', handlePaste)
  loadProjects()
})
onUnmounted(() => {
  window.removeEventListener('paste', handlePaste)
})

// 唤起标注画板
function openAnnotate(file) {
  const reader = new FileReader()
  reader.onload = (e) => {
    baseImage = new Image()
    baseImage.onload = () => {
      showAnnotateModal.value = true
      nextTick(() => {
        initCanvas()
      })
    }
    baseImage.src = e.target.result
  }
  reader.readAsDataURL(file)
}

function initCanvas() {
  const canvas = annotateCanvas.value
  if (!canvas) return
  canvasCtx = canvas.getContext('2d')
  
  canvas.width = baseImage.width
  canvas.height = baseImage.height
  
  canvasCtx.drawImage(baseImage, 0, 0, canvas.width, canvas.height)
  drawHistory = [canvasCtx.getImageData(0, 0, canvas.width, canvas.height)]
}

function getLineWidth(canvas) {
  return Math.max(3, Math.round(canvas.width / 250))
}

function getCanvasCoord(e, canvas) {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  
  let clientX, clientY
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX
    clientY = e.touches[0].clientY
  } else {
    clientX = e.clientX
    clientY = e.clientY
  }
  
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  }
}

function onCanvasMouseDown(e) {
  const canvas = annotateCanvas.value
  if (!canvas) return
  const coord = getCanvasCoord(e, canvas)
  startX = coord.x
  startY = coord.y
  isDrawing = true
  
  if (drawMode.value === 'draw') {
    canvasCtx.beginPath()
    canvasCtx.moveTo(startX, startY)
    canvasCtx.strokeStyle = '#f87171'
    canvasCtx.lineWidth = getLineWidth(canvas)
    canvasCtx.lineCap = 'round'
  }
}

function onCanvasMouseMove(e) {
  if (!isDrawing) return
  const canvas = annotateCanvas.value
  const coord = getCanvasCoord(e, canvas)
  const currentX = coord.x
  const currentY = coord.y
  
  if (drawMode.value === 'draw') {
    canvasCtx.lineTo(currentX, currentY)
    canvasCtx.stroke()
  } else if (drawMode.value === 'rect') {
    if (drawHistory.length > 0) {
      canvasCtx.putImageData(drawHistory[drawHistory.length - 1], 0, 0)
    }
    canvasCtx.strokeStyle = '#f87171'
    canvasCtx.lineWidth = getLineWidth(canvas)
    canvasCtx.strokeRect(startX, startY, currentX - startX, currentY - startY)
  }
}

function onCanvasMouseUp() {
  if (!isDrawing) return
  isDrawing = false
  const canvas = annotateCanvas.value
  if (canvasCtx && canvas) {
    drawHistory.push(canvasCtx.getImageData(0, 0, canvas.width, canvas.height))
  }
}

function onCanvasTouchStart(e) {
  if (e.touches.length !== 1) return
  const canvas = annotateCanvas.value
  if (!canvas) return
  const coord = getCanvasCoord(e, canvas)
  startX = coord.x
  startY = coord.y
  isDrawing = true
  
  if (drawMode.value === 'draw') {
    canvasCtx.beginPath()
    canvasCtx.moveTo(startX, startY)
    canvasCtx.strokeStyle = '#f87171'
    canvasCtx.lineWidth = getLineWidth(canvas)
    canvasCtx.lineCap = 'round'
  }
}

function onCanvasTouchMove(e) {
  if (!isDrawing || e.touches.length !== 1) return
  const canvas = annotateCanvas.value
  const coord = getCanvasCoord(e, canvas)
  const currentX = coord.x
  const currentY = coord.y
  
  if (drawMode.value === 'draw') {
    canvasCtx.lineTo(currentX, currentY)
    canvasCtx.stroke()
  } else if (drawMode.value === 'rect') {
    if (drawHistory.length > 0) {
      canvasCtx.putImageData(drawHistory[drawHistory.length - 1], 0, 0)
    }
    canvasCtx.strokeStyle = '#f87171'
    canvasCtx.lineWidth = getLineWidth(canvas)
    canvasCtx.strokeRect(startX, startY, currentX - startX, currentY - startY)
  }
}

function onCanvasTouchEnd() {
  if (!isDrawing) return
  isDrawing = false
  const canvas = annotateCanvas.value
  if (canvasCtx && canvas) {
    drawHistory.push(canvasCtx.getImageData(0, 0, canvas.width, canvas.height))
  }
}

function undoDraw() {
  if (drawHistory.length > 1) {
    drawHistory.pop()
    const canvas = annotateCanvas.value
    canvasCtx.putImageData(drawHistory[drawHistory.length - 1], 0, 0)
  }
}

function clearDraw() {
  if (baseImage && annotateCanvas.value) {
    const canvas = annotateCanvas.value
    canvasCtx.drawImage(baseImage, 0, 0, canvas.width, canvas.height)
    drawHistory = [canvasCtx.getImageData(0, 0, canvas.width, canvas.height)]
  }
}

function saveAnnotation() {
  const canvas = annotateCanvas.value
  if (!canvas) return
  
  canvas.toBlob((blob) => {
    if (blob) {
      screenshotFile.value = new File([blob], 'annotated.png', { type: 'image/png' })
      screenshotPreview.value = canvas.toDataURL('image/png')
      showAnnotateModal.value = false
    }
  }, 'image/png')
}

async function handleSubmit() {
  formRef.value?.validate(async (errors) => {
    if (errors) return
    submitting.value = true
    submitResult.value = null

    const formData = new FormData()
    formData.append('category', form.category)
    formData.append('description', form.description)
    formData.append('detail', form.detail)
    formData.append('urlPath', form.urlPath)
    formData.append('projectId', form.projectId || '')
    if (screenshotFile.value) formData.append('screenshot', screenshotFile.value)

    try {
      const res = await api.submitFeedback(formData)
      if (res.success) {
        submitResult.value = { type: 'success', title: '提交成功！', message: `反馈已提交，等待管理员审核处理。` }
        form.description = ''
        form.detail = ''
        form.urlPath = ''
        screenshotPreview.value = null
        screenshotFile.value = null
      } else {
        submitResult.value = { type: 'error', title: '提交失败', message: res.error }
      }
    } catch {
      submitResult.value = { type: 'error', title: '网络错误', message: '无法连接到服务器' }
    } finally {
      submitting.value = false
    }
  })
}
</script>

<style scoped>
.page { min-height: 100vh; background: radial-gradient(circle at 10% 20%, #0d0d15 0%, #120e24 100%); font-family: 'Inter', sans-serif; color: #e2e8f0; }
.header { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; height: 52px; }
.header-left, .header-right { display: flex; align-items: center; gap: 10px; }
.title { font-size: 18px; font-weight: 600; color: #a78bfa; }
.content { max-width: 900px; margin: 24px auto; padding: 0 16px; }

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

.screenshot-area {
  width: 100%; height: 220px; border: 2px dashed #ddd;
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; overflow: hidden; transition: border-color .2s;
}
.screenshot-area:hover { border-color: #534AB7; }
.screenshot-area.has-image { border-style: solid; border-color: #e0e0e0; }
.screenshot-area img { max-width: 100%; max-height: 100%; object-fit: contain; }
.placeholder { text-align: center; }
.placeholder p { margin-top: 8px; color: #999; font-size: 13px; }
.hint { font-size: 11px; color: #ccc; }
.result-alert { margin-top: 16px; }
.canvas-wrapper {
  width: 100%;
  max-height: 65vh;
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #050508;
  border-radius: 8px;
  padding: 8px;
}
</style>
