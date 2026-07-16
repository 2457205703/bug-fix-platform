const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const config = require('./config.json');

/**
 * 流式调用 Claude 进行代码评审 (Reviewer)
 * 返回 EventEmitter，推送 Review 输出
 *
 * 事件:
 *   - 'start'  → 开始评审
 *   - 'output' → 输出内容 ({ text: string })
 *   - 'done'   → 评审结束 ({ decision: 'PASS'|'FAIL', reviewLog: string, detail: string })
 */
function callClaudeReviewStream(diff, bugDescription) {
  const emitter = new EventEmitter();
  emitter.childProcess = null;
  const projectDir = config.targetProject;

  setImmediate(() => {
    const prompt = [
      `你是一个极其严苛的代码评审专家（Reviewer）。`,
      `用户之前提交了一个 Bug 反馈：`,
      `"${bugDescription}"`,
      ``,
      `Coder（AI 修复助手）针对这个 Bug，在项目目录 ${projectDir} 下生成了如下修改的 Git Diff：`,
      `------------------------------`,
      diff,
      `------------------------------`,
      ``,
      `请分析这个 Diff，指出它是否真正完美修复了 Bug，是否引入了新的问题（如空指针、冗余防御性代码、逻辑漏洞、未处理的边界），是否符合优雅、简洁的代码规范。`,
      ``,
      `重要：请在你的输出结果的第一行，明确给出最终评审结论，格式必须为以下之一：`,
      `【PASS】 （如果修改十分完美，无任何潜在风险或优化空间）`,
      `【FAIL】 （如果修改存在漏洞、冗余逻辑、或存在更优雅的实现方式）`,
      ``,
      `如果是【FAIL】，请在结论下方分条列出具体的修改建议与打回原因（Coder 助手将会读取这些建议重新修改）。`,
      `不要生成其他的闲聊内容。`,
    ].join('\n');

    // 启动本地 claude 进行单次问答
    const child = spawn('claude', [
      '-p', prompt,
      '--bare'
    ], {
      cwd: projectDir,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'] // 忽略 stdin 避免阻塞
    });

    emitter.childProcess = child;
    emitter.emit('start');

    let reviewLog = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      reviewLog += text;
      emitter.emit('output', { text });
    });

    child.stderr.on('data', (chunk) => {
      // 过滤不需要的 stdin 警告，防止污染输出
      const text = chunk.toString();
      if (!text.includes('no stdin data received')) {
        emitter.emit('output', { text });
      }
    });

    child.on('close', (code) => {
      const trimmedLog = reviewLog.trim();
      const firstLine = trimmedLog.split('\n')[0] || '';
      
      let decision = 'PASS';
      if (firstLine.includes('【FAIL】') || trimmedLog.includes('【FAIL】')) {
        decision = 'FAIL';
      }

      // 提取打回的具体细节（去除首行的结论标签）
      const detail = trimmedLog.replace(/^【(PASS|FAIL)】.*(\r?\n)?/, '').trim();

      console.log(`[Reviewer] 评审结束, 状态: ${decision}, code: ${code}`);

      emitter.emit('done', {
        decision,
        reviewLog: trimmedLog,
        detail: detail || '未提供具体建议'
      });
    });

    child.on('error', (err) => {
      emitter.emit('output', { text: `\n>>> 启动评审专家失败: ${err.message}\n` });
      emitter.emit('done', { decision: 'FAIL', reviewLog: err.message, detail: err.message });
    });
  });

  return emitter;
}

module.exports = { callClaudeReviewStream };
