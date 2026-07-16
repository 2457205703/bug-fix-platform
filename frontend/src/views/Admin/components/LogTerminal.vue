<template>
  <n-card size="small" style="margin-top:12px;">
    <template #header>
      <div style="display:flex;align-items:center;gap:8px;width:100%;">
        <n-icon size="18" :color="terminalDone ? '#1D9E75' : '#534AB7'"><TerminalIcon /></n-icon>
        <span>Claude Code 执行面板</span>
        <n-tag v-if="!terminalDone" type="info" size="tiny" :bordered="false"><n-spin size="14" /><span style="margin-left:4px;">执行中</span></n-tag>
        <n-tag v-else-if="terminalResult?.success" type="success" size="tiny" :bordered="false">成功</n-tag>
        <n-tag v-else type="error" size="tiny" :bordered="false">失败</n-tag>
        
        <!-- Tab 切换 -->
        <n-radio-group v-model:value="panelTab" size="tiny" style="margin-left:16px;">
          <n-radio-button value="terminal">终端日志</n-radio-button>
          <n-radio-button value="report">AI 分析报告 (MD)</n-radio-button>
        </n-radio-group>
      </div>
    </template>
    <template #header-extra><n-button text size="tiny" @click="$emit('close')">关闭</n-button></template>
    
    <!-- Xterm Container -->
    <div v-show="panelTab === 'terminal'" class="terminal-glow-wrapper">
      <div id="xterm-container" class="terminal-xterm"></div>
    </div>
    
    <!-- Markdown Report -->
    <div v-show="panelTab === 'report'" class="terminal-glow-wrapper">
      <div class="markdown-report-wrapper">
        <div class="markdown-body" v-html="markdownHtml"></div>
      </div>
    </div>
    
    <!-- 交互区 -->
    <div class="terminal-footer">
      <n-input
        v-model:value="continueInstruction"
        type="textarea"
        :rows="2"
        placeholder="输入补充指令指导 Claude 修复（执行中输入会排队等待）"
        :disabled="continuing || queuing"
      />
      <div class="terminal-actions">
        <n-button v-if="!terminalDone" type="error" size="small" :loading="stopping" @click="doStopFix">停止</n-button>
        <n-button v-if="!terminalDone" type="warning" size="small" :loading="queuing" :disabled="!continueInstruction.trim()" @click="doQueueFix">排队执行</n-button>
        <n-button v-if="terminalDone" type="primary" size="small" :loading="continuing" :disabled="!continueInstruction.trim()" @click="doContinueFix">继续修复</n-button>
      </div>
    </div>
  </n-card>
</template>

<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import {
  NCard, NButton, NIcon, NTag, NRadioGroup, NRadioButton, NSpin, NInput
} from 'naive-ui'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { TerminalOutline as TerminalIcon } from '@vicons/ionicons5'
import { useAuthStore } from '../../../stores/auth'
import * as api from '../../../api'
import { marked } from 'marked'

const props = defineProps({
  feedbackId: { type: String, required: true },
  status: { type: String, required: true },
  log: { type: String, default: '' },
  fixResult: { type: Object, default: null }
})

const emit = defineEmits(['close', 'status-updated', 'progress-updated'])

const auth = useAuthStore()

const terminalLines = ref([])
const terminalDone = ref(false)
const terminalResult = ref(null)
const continueInstruction = ref('')
const continuing = ref(false)
const queuing = ref(false)
const stopping = ref(false)
const panelTab = ref('terminal')
const currentProgress = ref({ step: 1, stepName: '待审批' })

let currentEventSource = null
let term = null
let fitAddon = null

const markdownText = computed(() => {
  return terminalLines.value
    .filter(line => {
      if (line.type !== 'output') return false
      const trimmed = line.text.trim()
      if (
        trimmed.startsWith('[系统]') || 
        trimmed.startsWith('[模型]') || 
        trimmed.startsWith('[排队]') || 
        trimmed.startsWith('[AI 评审专家] 开始阅读') ||
        trimmed.startsWith('>>>')
      ) {
        return false
      }
      return true
    })
    .map(line => line.text)
    .join('')
})

const markdownHtml = computed(() => {
  const text = markdownText.value || '暂无分析报告'
  const cleanText = text.replace(/[\u001b\u009b][[()#;?]*(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d,#;?]*)?)?[a-zA-Z/]/g, '')
  
  try {
    if (typeof marked === 'function') {
      return marked(cleanText)
    } else if (marked && typeof marked.parse === 'function') {
      return marked.parse(cleanText)
    }
    return `<pre style="white-space: pre-wrap; font-family: inherit;">${cleanText}</pre>`
  } catch (e) {
    console.error('Markdown parse error:', e)
    return `<pre style="white-space: pre-wrap; font-family: inherit;">${cleanText}</pre>`
  }
})

function initTerminal() {
  nextTick(() => {
    const container = document.getElementById('xterm-container');
    if (!container) return;
    
    if (term) {
      term.dispose();
    }
    
    term = new Terminal({
      theme: {
        background: '#0b0b14',
        foreground: '#f1f5f9',
        cursor: '#a78bfa',
        black: '#0f0f18',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#2dd4bf',
        white: '#cbd5e1'
      },
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 12,
      lineHeight: 1.5,
      cursorBlink: true,
      convertEol: true
    });
    
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    
    try { fitAddon.fit() } catch(e){}
    setTimeout(() => {
      try {
        if (fitAddon) fitAddon.fit();
      } catch (err) {}
    }, 150);
    
    terminalLines.value.forEach(l => {
      if (l.type === 'system') {
        term.write(`\x1b[33m${l.text}\x1b[0m`);
      } else {
        term.write(l.text);
      }
    });
  });
}

function parseLog(s) {
  if (!s) return []
  return s.split('\n').filter(Boolean).map(t => ({ type: 'output', text: t + '\n' }))
}

function connectFixStream(id) {
  if (currentEventSource) {
    currentEventSource.close()
  }
  
  terminalLines.value = [{ type: 'system', text: '正在连接 Claude Code...\n' }]
  terminalDone.value = false
  terminalResult.value = null
  initTerminal()
  
  currentEventSource = new EventSource(`/api/feedback/${id}/fix-stream?token=${auth.token}`)
  currentEventSource.addEventListener('system', e => { 
    terminalLines.value.push({ type: 'system', text: e.data }); 
    if (term) term.write(`\x1b[33m${e.data}\x1b[0m`); 
    if (fitAddon) { try { fitAddon.fit() } catch(err){} }
  })
  currentEventSource.addEventListener('output', e => {
    terminalLines.value.push({ type: 'output', text: e.data });
    if (term) term.write(e.data);
    if (fitAddon) { try { fitAddon.fit() } catch(err){} }
  })
  currentEventSource.addEventListener('progress', e => {
    try {
      const progress = JSON.parse(e.data)
      currentProgress.value = progress
      emit('progress-updated', progress)
    } catch {}
  })
  currentEventSource.addEventListener('done', e => {
    terminalDone.value = true
    try { terminalResult.value = JSON.parse(e.data) } catch { terminalResult.value = { success: false } }
    if (currentEventSource) {
      currentEventSource.close()
      currentEventSource = null
    }
    emit('status-updated')
  })
  currentEventSource.onerror = () => {
    if (!terminalDone.value) {
      terminalLines.value.push({ type: 'system', text: '\n[连接断开]\n' })
      terminalDone.value = true
    }
    if (currentEventSource) {
      currentEventSource.close()
      currentEventSource = null
    }
    emit('status-updated')
  }
}

async function doStopFix() {
  stopping.value = true
  try {
    await api.stopFix(props.feedbackId)
    terminalDone.value = true
    terminalResult.value = { success: false, error: '用户手动停止' }
    emit('status-updated')
  } catch (e) {
    console.error(e)
  } finally {
    stopping.value = false
  }
}

async function doQueueFix() {
  if (!continueInstruction.value.trim()) return
  queuing.value = true
  try {
    const res = await api.queueFix(props.feedbackId, continueInstruction.value.trim())
    if (res.success) {
      continueInstruction.value = ''
    }
  } catch (e) {
    console.error(e)
  } finally {
    queuing.value = false
  }
}

async function doContinueFix() {
  if (!continueInstruction.value.trim()) return
  continuing.value = true
  try {
    const res = await api.continueFix(props.feedbackId, continueInstruction.value.trim())
    if (res.success) {
      continueInstruction.value = ''
      connectFixStream(props.feedbackId)
      emit('status-updated')
    }
  } catch (e) {
    console.error(e)
  } finally {
    continuing.value = false
  }
}

function handleState() {
  if (props.status === 'approved' && !props.fixResult) {
    connectFixStream(props.feedbackId)
  } else if (props.log) {
    terminalLines.value = parseLog(props.log)
    terminalDone.value = true
    terminalResult.value = props.fixResult
    initTerminal()
  } else {
    terminalLines.value = []
    terminalDone.value = false
    terminalResult.value = null
  }
}

watch(() => props.feedbackId, () => {
  if (currentEventSource) {
    currentEventSource.close()
    currentEventSource = null
  }
  handleState()
})

onMounted(() => {
  handleState()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  if (currentEventSource) {
    currentEventSource.close()
  }
  window.removeEventListener('resize', handleResize)
})

function handleResize() {
  if (fitAddon) {
    try { fitAddon.fit() } catch (e) {}
  }
}
</script>

<style scoped>
.terminal-glow-wrapper {
  position: relative;
  padding: 2px;
  background: linear-gradient(90deg, #8b5cf6, #06b6d4, #d946ef, #8b5cf6);
  background-size: 300% 300%;
  animation: borderFlowAnimation 4s ease infinite;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(139, 92, 246, 0.2);
  margin-bottom: 8px;
}
@keyframes borderFlowAnimation {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.terminal-xterm { background: #0b0b14; border-radius: 8px; padding: 16px 32px 16px 20px; min-height: 250px; max-height: 450px; overflow: hidden; }
.terminal-footer { margin-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 12px; }
.terminal-actions { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
.markdown-report-wrapper { background: #0b0b14; border-radius: 8px; padding: 16px; min-height: 250px; max-height: 450px; overflow-y: auto; }
.markdown-body { color: #f1f5f9; line-height: 1.6; font-size: 14px; }
.markdown-body :deep(h1) { font-size: 20px; font-weight: 600; margin-top: 16px; margin-bottom: 8px; color: #a78bfa; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 4px; }
.markdown-body :deep(h2) { font-size: 18px; font-weight: 600; margin-top: 14px; margin-bottom: 8px; color: #c084fc; }
.markdown-body :deep(h3) { font-size: 16px; font-weight: 600; margin-top: 12px; margin-bottom: 6px; color: #cbd5e1; }
.markdown-body :deep(p) { margin-bottom: 10px; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { padding-left: 20px; margin-bottom: 12px; }
.markdown-body :deep(li) { margin-bottom: 4px; list-style-type: disc; }
.markdown-body :deep(ol) li { list-style-type: decimal; }
.markdown-body :deep(code) { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #2dd4bf; }
.markdown-body :deep(pre) { background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); overflow-x: auto; margin-bottom: 12px; }
.markdown-body :deep(pre code) { background: transparent; padding: 0; color: #e2e8f0; font-size: 12px; }
.markdown-body :deep(blockquote) { border-left: 4px solid #8b5cf6; padding-left: 12px; color: #94a3b8; margin: 12px 0; background: rgba(139, 92, 246, 0.05); padding-top: 4px; padding-bottom: 4px; border-radius: 0 4px 4px 0; }
.markdown-body :deep(strong) { font-weight: bold; color: #fff; }
.markdown-body :deep(a) { color: #60a5fa; text-decoration: none; }
.markdown-body :deep(a:hover) { text-decoration: underline; }
:deep(.xterm) { padding-right: 24px !important; }
</style>
