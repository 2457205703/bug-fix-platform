<template>
  <div style="display:flex; height:100%; width:100%;">
    <div class="sidebar">
      <div class="sidebar-header">
        <n-radio-group v-model:value="filterStatus" size="small" @update:value="loadList">
          <n-radio-button value="all">全部</n-radio-button>
          <n-radio-button value="pending">待审批</n-radio-button>
          <n-radio-button value="fixed">已修复</n-radio-button>
        </n-radio-group>
      </div>
      <n-spin :show="listLoading" class="feedback-spin" content-class="feedback-spin-content">
        <div class="feedback-list">
          <div v-for="fb in filteredFeedbacks" :key="fb.id" class="fb-item" :class="{ active: selectedId === fb.id }" @click="selectFeedback(fb.id)" style="position:relative;">
            <div class="fb-title">
              <n-tag :type="statusTagType(fb.status)" :bordered="false" size="tiny">{{ statusLabel(fb.status) }}</n-tag>
              <span class="fb-desc" style="padding-right:24px;">{{ fb.description.slice(0, 20) }}</span>
            </div>
            <div class="fb-meta">
              <span>{{ fb.reporter }} · {{ fb.projectName || '默认项目' }}</span>
              <span>{{ timeAgo(fb.createdAt) }}</span>
            </div>
            <!-- 删除按钮 -->
            <div class="fb-item-delete" @click.stop style="position:absolute; right:12px; top:12px;">
              <n-popconfirm @positive-click="doDeleteFeedback(fb.id)">
                <template #trigger>
                  <n-button text type="error" size="tiny" class="delete-btn">
                    <template #icon><n-icon><TrashIcon /></n-icon></template>
                  </n-button>
                </template>
                确定要删除此条反馈吗？
              </n-popconfirm>
            </div>
          </div>
          <n-empty v-if="filteredFeedbacks.length === 0" description="暂无反馈" />
        </div>
      </n-spin>
    </div>

    <div class="detail">
      <n-spin :show="detailLoading" class="detail-spin" content-class="detail-spin-content">
        <div v-if="selectedFeedback" class="detail-content">
          <n-card size="small">
            <n-collapse :default-expanded-names="['detail', 'visual', 'steps_and_results']">
              <!-- 反馈详情 -->
              <n-collapse-item title="反馈详情" name="detail">
                <n-grid :cols="2" :x-gap="16" :y-gap="8" style="margin-top: 8px;">
                  <n-grid-item><span class="label">上报人</span>: {{ selectedFeedback.reporter }}</n-grid-item>
                  <n-grid-item><span class="label">关联项目</span>: <n-tag :bordered="false" type="warning" size="small">{{ selectedFeedback.projectName || '默认项目' }}</n-tag></n-grid-item>
                  <n-grid-item><span class="label">分类</span>: <n-tag :type="selectedFeedback.category === 'Bug' ? 'error' : 'info'" :bordered="false" size="small">{{ selectedFeedback.category }}</n-tag></n-grid-item>
                  <n-grid-item><span class="label">状态</span>: <n-tag :type="statusTagType(selectedFeedback.status)" size="small">{{ statusLabel(selectedFeedback.status) }}</n-tag></n-grid-item>
                  <n-grid-item><span class="label">时间</span>: {{ formatTime(selectedFeedback.createdAt) }}</n-grid-item>
                </n-grid>
                <n-divider style="margin: 12px 0;" />
                <p class="label">
                  问题描述
                  <n-button text size="tiny" type="primary" style="margin-left:8px;" @click="startEditDesc">编辑</n-button>
                </p>
                <div v-if="!editingDesc" class="markdown-body desc-text" v-html="renderMarkdown(selectedFeedback.description)"></div>
                <div v-else style="margin-top:4px;">
                  <n-input v-model:value="editDescText" type="textarea" :rows="5" :autosize="{ minRows: 5, maxRows: 15 }" />
                  <div style="display:flex;gap:8px;margin-top:8px;">
                    <n-button size="tiny" type="primary" @click="saveEditDesc">保存</n-button>
                    <n-button size="tiny" @click="editingDesc = false">取消</n-button>
                  </div>
                </div>
                <div v-if="selectedFeedback.originalDescription && selectedFeedback.description !== selectedFeedback.originalDescription" style="margin-top:6px; padding:8px; background:rgba(253, 246, 236, 0.05); border: 1px solid rgba(253, 246, 236, 0.1); border-radius:6px; font-size:12px; color:#e6a23c;">
                  <strong>原始描述：</strong>
                  <n-button text size="tiny" type="warning" style="margin-left:8px;" @click="startEditOriginalDesc">编辑</n-button>
                  <div v-if="!editingOriginalDesc" class="markdown-body" style="display:inline-block;" v-html="renderMarkdown(selectedFeedback.originalDescription)"></div>
                  <div v-else style="margin-top:4px;">
                    <n-input v-model:value="editOriginalDescText" type="textarea" :rows="5" :autosize="{ minRows: 5, maxRows: 15 }" />
                    <div style="display:flex;gap:8px;margin-top:8px;">
                      <n-button size="tiny" type="warning" @click="saveEditOriginalDesc">保存</n-button>
                      <n-button size="tiny" @click="editingOriginalDesc = false">取消</n-button>
                    </div>
                  </div>
                  <span v-if="selectedFeedback.editedBy && !editingOriginalDesc" style="color:#aaa;margin-left:8px;">修改人: {{ selectedFeedback.editedBy }}</span>
                </div>
                <div v-if="selectedFeedback.detail || editingDetail" style="margin-top:4px;">
                  <span class="label" style="color:#999;">
                    补充详情
                    <n-button text size="tiny" type="info" style="margin-left:8px;" @click="startEditDetail">编辑</n-button>
                  </span>
                  <div v-if="!editingDetail" class="markdown-body desc-text" style="color:#999;margin-top:2px;" v-html="renderMarkdown(selectedFeedback.detail)"></div>
                  <div v-else>
                    <n-input v-model:value="editDetailText" type="textarea" :rows="5" :autosize="{ minRows: 5, maxRows: 15 }" placeholder="输入补充详情..." />
                    <div style="display:flex;gap:8px;margin-top:8px;">
                      <n-button size="tiny" type="info" @click="saveEditDetail">保存</n-button>
                      <n-button size="tiny" @click="editingDetail = false">取消</n-button>
                    </div>
                  </div>
                </div>
              </n-collapse-item>

              <!-- 视觉回归对比 -->
              <n-collapse-item v-if="selectedFeedback.screenshotPath" title="视觉回归对比" name="visual" style="margin-top: 12px;">
                <template #header-extra>
                  <n-radio-group v-if="selectedFeedback.fixedScreenshotPath || selectedFeedback.diffScreenshotPath" v-model:value="visualTab" size="tiny" @click.stop>
                    <n-radio-button value="compare">滑动对比 (Before/After)</n-radio-button>
                    <n-radio-button value="diff">差异像素 (Pixel Diff)</n-radio-button>
                    <n-radio-button value="before">仅看 Bug 前</n-radio-button>
                    <n-radio-button value="after">仅看修复后</n-radio-button>
                  </n-radio-group>
                </template>

                <div style="margin-top: 8px;">
                  <!-- 滑动对比模式 -->
                  <div v-if="selectedFeedback.fixedScreenshotPath && visualTab === 'compare'" class="slider-container-box">
                    <div class="image-slider" ref="sliderContainer"
                         @mousemove="handleSliderMove" @touchmove="handleSliderMove"
                         @mousedown="startSliderDrag" @touchstart="startSliderDrag">
                      <!-- 修复前 (Before) -->
                      <img :src="selectedFeedback.screenshotPath" class="slider-img img-before" />

                      <!-- 修复后 (After) -->
                      <div class="slider-after-wrapper" :style="{ width: sliderPosition + '%' }">
                        <img :src="selectedFeedback.fixedScreenshotPath" class="slider-img img-after" />
                      </div>

                      <!-- 拖拽线手柄 -->
                      <div class="slider-handle" :style="{ left: sliderPosition + '%' }">
                        <div class="slider-button">
                          <n-icon size="14"><SwapIcon /></n-icon>
                        </div>
                      </div>

                      <!-- 左右标签 -->
                      <div class="slider-label label-before">Bug 现场 (Before)</div>
                      <div class="slider-label label-after">修复后 (After)</div>
                    </div>
                  </div>

                  <!-- 像素差异图模式 -->
                  <div v-else-if="visualTab === 'diff' && selectedFeedback.diffScreenshotPath" style="display:flex;flex-direction:column;align-items:center;gap:8px;">
                    <img :src="selectedFeedback.diffScreenshotPath" class="screenshot-preview" />
                    <span style="font-size:11px;color:#888;">红色区域表示修改前后的像素差异</span>
                  </div>

                  <!-- 单图常规模式 -->
                  <div v-else style="display:flex;justify-content:center;">
                    <img v-if="visualTab === 'before' || !selectedFeedback.fixedScreenshotPath" :src="selectedFeedback.screenshotPath" class="screenshot-preview" />
                    <img v-else-if="visualTab === 'after'" :src="selectedFeedback.fixedScreenshotPath" class="screenshot-preview" />
                  </div>
                </div>
              </n-collapse-item>

              <!-- 修复进度 -->
              <n-card v-if="selectedFeedback.status !== 'pending' && selectedFeedback.status !== 'rejected'" size="small" style="margin-top:12px;">
                <!-- 进度步骤条 -->
                <n-steps :current="currentStep" :status="stepsStatus" size="small">
                  <n-step title="待审批" description="等待审批" />
                  <n-step title="分析源码" description="AI 定位代码" />
                  <n-step title="编写修复" description="AI 编写代码" />
                  <n-step title="完成" description="修复通过" />
                </n-steps>

                <n-divider style="margin: 12px 0;" />

                <!-- Claude Code 执行终端 -->
                <LogTerminal
                  v-if="terminalVisible"
                  :feedback-id="selectedFeedback.id"
                  :status="selectedFeedback.status"
                  :log="selectedFeedback.fixResult?.log || ''"
                  :fix-result="selectedFeedback.fixResult"
                  @close="terminalVisible = false"
                  @status-updated="loadList"
                  @progress-updated="handleProgressUpdate"
                />

                <!-- 查看执行日志按钮 -->
                <div v-if="selectedFeedback.fixResult && !terminalVisible">
                  <n-button text type="primary" size="small" @click="showLogTerminal">查看执行日志</n-button>
                  <div style="display:flex; gap:12px; font-size:11px; color:#aaa; margin-top:8px;">
                    <span>输入: <code style="color:#a78bfa;font-family:monospace;">{{ selectedFeedback.fixResult.inputTokens || 0 }}</code></span>
                    <span>输出: <code style="color:#a78bfa;font-family:monospace;">{{ selectedFeedback.fixResult.outputTokens || 0 }}</code></span>
                    <span>总消耗: <code style="color:#c084fc;font-family:monospace;font-weight:bold;">{{ (selectedFeedback.fixResult.inputTokens || 0) + (selectedFeedback.fixResult.outputTokens || 0) }}</code></span>
                    <span v-if="selectedFeedback.fixResult.costUsd">估算费用: <code style="color:#2dd4bf;font-family:monospace;">${{ selectedFeedback.fixResult.costUsd.toFixed(4) }}</code></span>
                  </div>
                </div>
              </n-card>
            </n-collapse>
          </n-card>

          <!-- 审批控制按钮 -->
          <n-card v-if="['pending', 'queued', 'failed', 'stopped', 'rejected'].includes(selectedFeedback.status)" size="small" style="margin-top:12px;">
            <n-space justify="center" size="large" align="center">
              <n-button v-if="selectedFeedback.status === 'pending'" type="error" @click="doReject"><template #icon><n-icon><CloseIcon /></n-icon></template>拒绝</n-button>
              <n-checkbox v-model:checked="skipReview" size="small" style="margin-right:8px;">
                跳过 AI 评审
              </n-checkbox>
              <n-button type="success" :loading="approving" @click="doApprove">
                <template #icon><n-icon><CheckmarkIcon /></n-icon></template>
                {{ ['pending', 'queued'].includes(selectedFeedback.status) ? '审批通过，AI 修复' : '重新开始 AI 修复' }}
              </n-button>
            </n-space>
          </n-card>
        </div>
        <n-empty v-else description="选择左侧反馈查看详情" style="margin-top:120px;" />
      </n-spin>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { marked } from 'marked'
import {
  NCard, NCollapse, NCollapseItem, NGrid, NGridItem, NTag, NDivider, NEmpty, NSpin, NRadioGroup, NRadioButton,
  NSpace, NSteps, NStep, NPopconfirm, NButton, NIcon, NInput, NAlert, NCheckbox
} from 'naive-ui'
import { html } from 'diff2html'
import 'diff2html/bundles/css/diff2html.min.css'
import {
  CloseOutline as CloseIcon, CheckmarkOutline as CheckmarkIcon,
  SwapHorizontalOutline as SwapIcon, TrashOutline as TrashIcon
} from '@vicons/ionicons5'
import * as api from '../../../api' // 注意引用深度：原来是 ../../../api，升级为页面目录后变为 ../../../api
import LogTerminal from '../components/LogTerminal.vue' // 原来是 ./LogTerminal.vue，升级为页面目录后变为 ../components/LogTerminal.vue

function renderMarkdown(text) {
  if (!text) return ''
  try {
    if (typeof marked === 'function') {
      return marked(text)
    } else if (marked && typeof marked.parse === 'function') {
      return marked.parse(text)
    }
    return text
  } catch (e) {
    console.error('Markdown parse error:', e)
    return text
  }
}

// Feedback state
const filterStatus = ref('all')
const listLoading = ref(false)
const detailLoading = ref(false)
const selectedId = ref(null)
const approving = ref(false)
const skipReview = ref(true)
const terminalVisible = ref(false)
const visualTab = ref('compare')
const diffOutputFormat = ref('side-by-side')
const feedbacks = ref([])

const selectedFeedback = computed(() => feedbacks.value.find(f => f.id === selectedId.value) || null)
const filteredFeedbacks = computed(() => {
  if (filterStatus.value === 'all') return feedbacks.value
  return feedbacks.value.filter(f => f.status === filterStatus.value)
})

const sliderPosition = ref(50)
const sliderContainer = ref(null)
let isDraggingSlider = false

const isValidDiff = computed(() => {
  const diff = selectedFeedback.value?.fixResult?.diff
  if (!diff) return false
  return diff.includes('diff --git') || diff.includes('--- ') || diff.includes('+++ ')
})

const diffHtml = computed(() => {
  const diff = selectedFeedback.value?.fixResult?.diff
  if (!diff || diff === '未见明显代码修改' || diff.includes('Warning: no stdin data')) return ''
  try {
    return html(diff, {
      drawFileList: true,
      matching: 'lines',
      outputFormat: diffOutputFormat.value,
    })
  } catch (e) {
    console.error(e)
    return `<pre style="color: #abb2bf; background: #1e1e1e; padding: 12px; border-radius: 4px;">${diff}</pre>`
  }
})

// Description editing
const editingDesc = ref(false)
const editDescText = ref('')
const editingOriginalDesc = ref(false)
const editOriginalDescText = ref('')
const editingDetail = ref(false)
const editDetailText = ref('')

function startEditDesc() {
  editDescText.value = selectedFeedback.value?.description || ''
  editingDesc.value = true
}

async function saveEditDesc() {
  if (!selectedFeedback.value || !editDescText.value.trim()) return
  try {
    await api.updateFeedbackDesc(selectedFeedback.value.id, { description: editDescText.value.trim() })
    const data = await api.getFeedback(selectedFeedback.value.id)
    if (data.feedback) {
      const fb = feedbacks.value.find(f => f.id === selectedFeedback.value.id)
      if (fb) Object.assign(fb, data.feedback)
    }
    editingDesc.value = false
  } catch (e) {
    console.error(e)
  }
}

function startEditOriginalDesc() {
  editOriginalDescText.value = selectedFeedback.value?.originalDescription || ''
  editingOriginalDesc.value = true
}

async function saveEditOriginalDesc() {
  if (!selectedFeedback.value) return
  try {
    await api.updateFeedbackDesc(selectedFeedback.value.id, { originalDescription: editOriginalDescText.value.trim() })
    const data = await api.getFeedback(selectedFeedback.value.id)
    if (data.feedback) {
      const fb = feedbacks.value.find(f => f.id === selectedFeedback.value.id)
      if (fb) Object.assign(fb, data.feedback)
    }
    editingOriginalDesc.value = false
  } catch (e) {
    console.error(e)
  }
}

function startEditDetail() {
  editDetailText.value = selectedFeedback.value?.detail || ''
  editingDetail.value = true
}

async function saveEditDetail() {
  if (!selectedFeedback.value) return
  try {
    await api.updateFeedbackDesc(selectedFeedback.value.id, { detail: editDetailText.value.trim() })
    const data = await api.getFeedback(selectedFeedback.value.id)
    if (data.feedback) {
      const fb = feedbacks.value.find(f => f.id === selectedFeedback.value.id)
      if (fb) Object.assign(fb, data.feedback)
    }
    editingDetail.value = false
  } catch (e) {
    console.error(e)
  }
}

async function loadList() {
  listLoading.value = true
  try {
    const status = filterStatus.value === 'all' ? null : filterStatus.value
    const data = await api.getFeedbacks(status)
    feedbacks.value = data.feedbacks || []
  } catch (e) {
    console.error(e)
  } finally {
    listLoading.value = false
  }
}

async function selectFeedback(id) {
  selectedId.value = id
  visualTab.value = 'compare'
  detailLoading.value = true
  try {
    const data = await api.getFeedback(id)
    const fb = data.feedback
    if (!fb) return

    const idx = feedbacks.value.findIndex(f => f.id === id)
    if (idx >= 0) {
      feedbacks.value[idx] = fb
    } else {
      feedbacks.value.push(fb)
    }

    if (fb.status === 'approved' && !fb.fixResult) {
      terminalVisible.value = true
    } else if (fb.fixResult?.log) {
      terminalVisible.value = false
    } else {
      terminalVisible.value = false
    }
  } catch (e) {
    console.error(e)
  } finally {
    detailLoading.value = false
  }
}

function showLogTerminal() {
  terminalVisible.value = true
}

async function doApprove() {
  if (!selectedFeedback.value) return
  approving.value = true
  try {
    const res = await api.approveFeedback(selectedFeedback.value.id, skipReview.value)
    if (res.success) {
      terminalVisible.value = true
      await loadList()
      skipReview.value = true  // 重置为默认勾选
    }
  } catch (e) {
    console.error(e)
  } finally {
    approving.value = false
  }
}

async function doReject() {
  if (!selectedFeedback.value) return
  try {
    await api.rejectFeedback(selectedFeedback.value.id)
    await loadList()
  } catch (e) {
    console.error(e)
  }
}

async function doDeleteFeedback(id) {
  try {
    const res = await api.deleteFeedback(id)
    if (res.success) {
      if (selectedId.value === id) {
        selectedId.value = null
      }
      await loadList()
    }
  } catch (e) {
    console.error(e)
  }
}

// Steps state machine helper
const liveStep = ref(0) // 实时进度步骤
const currentStep = computed(() => {
  if (liveStep.value > 0) return liveStep.value
  if (!selectedFeedback.value) return 0
  const status = selectedFeedback.value.status
  if (status === 'pending') return 0
  if (status === 'rejected') return 0
  if (status === 'fixed') return 6
  return 1
})

function handleProgressUpdate(progress) {
  liveStep.value = progress.step
}

// 切换反馈时重置进度
watch(selectedId, () => {
  liveStep.value = 0
})

const stepsStatus = computed(() => {
  if (!selectedFeedback.value) return 'process'
  const status = selectedFeedback.value.status
  if (status === 'failed' || status === 'stopped') return 'error'
  if (status === 'rejected') return 'error'
  if (status === 'fixed') return 'finish'
  return 'process'
})

// Image comparison slider
function startSliderDrag(e) {
  isDraggingSlider = true
  e.preventDefault()
}

function handleSliderMove(e) {
  if (!isDraggingSlider && e.type !== 'mousemove') return
  if (isDraggingSlider) {
    updateSlider(e)
  }
}

function updateSlider(e) {
  if (!sliderContainer.value) return
  const rect = sliderContainer.value.getBoundingClientRect()
  const clientX = e.touches ? e.touches[0].clientX : e.clientX
  const x = clientX - rect.left
  let percentage = (x / rect.width) * 100
  if (percentage < 0) percentage = 0
  if (percentage > 100) percentage = 100
  sliderPosition.value = Math.round(percentage)
}

function statusTagType(s) { const m = { pending: 'warning', approved: 'info', queued: 'info', rejected: 'default', fixed: 'success', failed: 'error', stopped: 'default' }; return m[s] || 'default' }
function statusLabel(s) { const m = { pending: '待审批', approved: '修复中', queued: '排队中', rejected: '已拒绝', fixed: '已修复', failed: '修复失败', stopped: '已停止' }; return m[s] || s }
function timeAgo(s) { const d = Date.now() - new Date(s).getTime(); const m = Math.floor(d / 60000); if (m < 1) return '刚刚'; if (m < 60) return `${m}分钟前`; const h = Math.floor(m / 60); if (h < 24) return `${h}小时前`; return `${Math.floor(h / 24)}天前` }
function formatTime(s) { return new Date(s).toLocaleString('zh-CN') }

onMounted(() => {
  loadList()
  window.addEventListener('mouseup', () => { isDraggingSlider = false })
  window.addEventListener('touchend', () => { isDraggingSlider = false })
})
</script>

<style scoped>
.sidebar { 
  width: 290px; 
  background: rgba(15, 15, 25, 0.7); 
  backdrop-filter: blur(12px);
  border-right: 1px solid rgba(255, 255, 255, 0.06); 
  display: flex; 
  flex-direction: column; 
  flex-shrink: 0; 
  overflow: hidden;
}
.sidebar-header { padding: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); flex-shrink: 0; }
.feedback-spin { flex: 1; min-height: 0; display: flex; flex-direction: column; }
:deep(.feedback-spin-content) { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.feedback-list { flex: 1; overflow-y: auto; padding: 8px; }
.fb-item { 
  padding: 14px; 
  border-radius: 12px; 
  cursor: pointer; 
  margin-bottom: 8px; 
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.fb-item:hover { 
  background: rgba(139, 92, 246, 0.08); 
  border-color: rgba(139, 92, 246, 0.3);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.15);
}
.delete-btn {
  opacity: 0;
  transition: opacity 0.2s ease;
}
.fb-item:hover .delete-btn {
  opacity: 0.7;
}
.delete-btn:hover {
  opacity: 1 !important;
}
.fb-item.active { 
  background: rgba(139, 92, 246, 0.16); 
  border-color: rgba(139, 92, 246, 0.6);
  box-shadow: 0 0 16px rgba(139, 92, 246, 0.25);
}
.fb-title { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.fb-desc { font-size: 13px; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; font-weight: 500; }
.fb-meta { display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; }

.detail { 
  flex: 1; 
  display: flex;
  flex-direction: column;
  overflow: hidden; 
}
.detail-spin { flex: 1; min-height: 0; display: flex; flex-direction: column; }
:deep(.detail-spin-content) { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; }
.detail-content { max-width: 850px; }
.label { font-weight: 500; color: #94a3b8; font-size: 13px; }
.desc-text { font-size: 14px; color: #e2e8f0; white-space: pre-wrap; line-height: 1.6; }
.screenshot-preview { max-width: 100%; max-height: 400px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.08); cursor: zoom-in; object-fit: contain; }

.slider-container-box {
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 12px 0;
}
.image-slider {
  position: relative;
  width: 100%;
  max-width: 750px;
  height: 420px;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  user-select: none;
  cursor: ew-resize;
}
.slider-img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.slider-after-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  overflow: hidden;
  border-right: 1px solid rgba(6, 182, 212, 0.8);
  box-shadow: 0 0 10px rgba(6, 182, 212, 0.5);
}
.slider-after-wrapper .slider-img {
  width: 750px;
  max-width: none;
  height: 420px;
}
.slider-handle {
  position: absolute;
  top: 0;
  width: 2px;
  height: 100%;
  background: linear-gradient(to bottom, #8b5cf6, #06b6d4);
  transform: translateX(-50%);
  z-index: 10;
  pointer-events: none;
}
.slider-button {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 28px;
  height: 28px;
  background: #0d0d15;
  border: 2px solid #06b6d4;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 12px rgba(6, 182, 212, 0.8);
  color: #06b6d4;
}
.slider-label {
  position: absolute;
  bottom: 12px;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  z-index: 5;
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  pointer-events: none;
}
.label-before { left: 12px; border-color: rgba(139, 92, 246, 0.4); }
.label-after { right: 12px; border-color: rgba(6, 182, 212, 0.4); }

.diff-html-wrapper { overflow-x: auto; max-height: 600px; background: rgba(15, 15, 25, 0.8); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.08); margin-top: 8px; }
:deep(.d2h-file-wrapper) { border: none !important; margin-bottom: 0 !important; background: transparent !important; }
:deep(.d2h-file-header) { background-color: rgba(255, 255, 255, 0.02) !important; border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important; }
:deep(.d2h-code-line) { font-family: 'JetBrains Mono', monospace !important; font-size: 12px !important; }
.error-text { color: #f87171; font-size: 13px; }

.markdown-body { color: #f1f5f9; line-height: 1.5; font-size: 14px; }
.markdown-body :deep(h1) { font-size: 18px; font-weight: 600; margin-top: 8px; margin-bottom: 4px; color: #a78bfa; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 2px; }
.markdown-body :deep(h2) { font-size: 16px; font-weight: 600; margin-top: 6px; margin-bottom: 4px; color: #c084fc; }
.markdown-body :deep(h3) { font-size: 15px; font-weight: 600; margin-top: 4px; margin-bottom: 2px; color: #cbd5e1; }
.markdown-body :deep(p) { margin-bottom: 6px; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { padding-left: 16px; margin-bottom: 6px; }
.markdown-body :deep(li) { margin-bottom: 2px; list-style-type: disc; }
.markdown-body :deep(ol) li { list-style-type: decimal; }
.markdown-body :deep(code) { background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #2dd4bf; }
.markdown-body :deep(pre) { background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06); overflow-x: auto; margin-bottom: 6px; }
.markdown-body :deep(pre code) { background: transparent; padding: 0; color: #e2e8f0; font-size: 12px; }
.markdown-body :deep(blockquote) { border-left: 3px solid #8b5cf6; padding-left: 8px; color: #94a3b8; margin: 6px 0; background: rgba(139, 92, 246, 0.05); padding-top: 2px; padding-bottom: 2px; border-radius: 0 4px 4px 0; }
.markdown-body :deep(strong) { font-weight: bold; color: #fff; }
.markdown-body :deep(a) { color: #60a5fa; text-decoration: none; }
.markdown-body :deep(a:hover) { text-decoration: underline; }
</style>
