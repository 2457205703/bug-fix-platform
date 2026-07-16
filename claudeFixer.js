const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const config = require('./config.json');
const codegraph = require('./codegraph');

/**
 * 流式调用 Claude Code 修复代码
 * 返回 EventEmitter，实时推送 Claude 执行内容
 *
 * 事件:
 *   - 'start'    → 开始执行
 *   - 'output'   → 一条输出 ({ text: string })
 *   - 'progress' → 进度更新 ({ step: number, stepName: string })
 *   - 'done'     → 执行完成 ({ success, diff, error })
 */
function callClaudeFixStream(description, screenshotPath, category, similarMemos = [], projectDir = null, gitPaths = null) {
  const emitter = new EventEmitter();
  emitter.childProcess = null; // 保存进程引用，供外部 kill
  const finalProjectDir = projectDir || config.targetProject;
  const finalGitPaths = gitPaths ? gitPaths.split(/[\n,]+/).map(p => p.trim()).filter(Boolean) : [];

  // 异步启动
  setImmediate(() => {
    if (!fs.existsSync(finalProjectDir)) {
      emitter.emit('start');
      emitter.emit('output', { text: `\n>>> 错误: 目标项目目录不存在: ${finalProjectDir}\n` });
      emitter.emit('done', { success: false, diff: '', error: `目标项目目录不存在: ${finalProjectDir}` });
      return;
    }

    // 截断过长描述，避免 token 爆炸
    const maxDescLen = 3000;
    const truncatedDesc = description.length > maxDescLen
      ? description.slice(0, maxDescLen) + '\n...(描述已截断)'
      : description;

    const promptLines = [
      `你是一个专业的代码修复助手。`,
      `用户上报了一个 ${category} 问题：`,
      `"${truncatedDesc}"`,
      ``,
      `截图已保存在: ${screenshotPath || '未提供截图'}`,
      ``
    ];

    if (similarMemos && similarMemos.length > 0) {
      promptLines.push(`【相似历史修复参考】`);
      promptLines.push(`以下是系统检索到的相似历史修复案例（diff 已截断）：`);
      similarMemos.forEach((memo, idx) => {
        promptLines.push(`\n[历史案例 ${idx + 1}]`);
        promptLines.push(`Bug 描述: ${memo.description}`);
        // 截断 diff，避免 token 爆炸
        const diffPreview = memo.diff ? memo.diff.slice(0, 2000) + (memo.diff.length > 2000 ? '...(已截断)' : '') : '(无)';
        promptLines.push(`修复 Diff 预览: ${diffPreview}`);
      });
      promptLines.push(``);
    }

    promptLines.push(
      `请分析问题，精准定位并修复 Bug。`,
      ``,
      `【定位策略 - 必须先定位再读取】：`,
      `1. 如果有 CodeGraph MCP 工具，先用它搜索符号和调用关系`,
      `2. 否则先用 Bash 运行 grep/find 搜索关键词定位文件`,
      `3. 只读取定位到的关键文件，不要逐个遍历`,
      `4. 理解代码后直接修复，不要过度分析`,
      ``,
      `【修复原则】：`,
      `- 只修改出问题的代码`,
      `- 修复完成后即可结束`,
      `- 不要提交 git commit`
    );

    const prompt = promptLines.join('\n');

    // 构建 Claude 参数
    const claudeArgs = [
      '-p', prompt,
      '--allowedTools', 'Read,Edit,Bash(grep *),Bash(find *),Bash(git diff *)',
      '--permission-mode', 'acceptEdits',
      '--output-format', 'stream-json',
      '--verbose',
      '--bare'
    ];

    // 如果 CodeGraph 已安装且项目已索引，加载 MCP 配置
    if (codegraph.isInstalled() && codegraph.isIndexed(finalProjectDir)) {
      const mcpConfigPath = codegraph.getMcpConfig();
      claudeArgs.push('--mcp-config', mcpConfigPath);
      emitter.emit('output', { text: '[CodeGraph: MCP 已启用, 将使用代码图谱加速定位]\n' });
    }

    const child = spawn('claude', claudeArgs, {
      cwd: finalProjectDir,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe']  // 忽略 stdin 避免 "no stdin data" 警告
      // spawn 不支持 timeout 参数，会在 close 事件中自行处理超时
    });

    emitter.childProcess = child; // 保存进程引用
    emitter.emit('start');
    emitter.emit('progress', { step: 2, stepName: '分析源码' }); // 启动后进入分析阶段

    let fullOutput = '';
    let isThinking = false;
    let resultEvent = null;       // 捕获 stream-json 的 result 事件
    let fixStarted = false;       // 是否有过实际操作（Read/Edit 等）
    let closeTimer = null;
    let currentStep = 2;          // 当前进度：2=分析源码, 3=编写修复, 4=编译验证, 5=AI评审

    // 超时保护: 5 分钟后强制结束
    closeTimer = setTimeout(() => {
      if (!child.killed) {
        emitter.emit('output', { text: '\n>>> 执行超时 (5分钟)，强制终止\n' });
        child.kill('SIGTERM');
      }
    }, 300000);

    child.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const evt = JSON.parse(line);

          // 处理 assistant 消息（模型输出）
          if (evt.type === 'assistant' && evt.message?.content) {
            const content = evt.message.content;
            if (Array.isArray(content)) {
              content.forEach(c => {
                if (c.type === 'text' && c.text) {
                  emitter.emit('output', { text: c.text });
                  fullOutput += c.text;
                }
                // 处理 tool_use，更新进度
                if (c.type === 'tool_use') {
                  fixStarted = true;
                  const toolName = c.name || '';
                  emitter.emit('output', { text: `\n[${toolName}...]\n` });
                  if (toolName === 'Read' && currentStep < 2) {
                    currentStep = 2;
                    emitter.emit('progress', { step: 2, stepName: '分析源码' });
                  } else if (toolName === 'Edit' && currentStep < 3) {
                    currentStep = 3;
                    emitter.emit('progress', { step: 3, stepName: '编写修复' });
                  } else if (toolName === 'Bash' && currentStep < 4) {
                    currentStep = 4;
                    emitter.emit('progress', { step: 4, stepName: '编译验证' });
                  }
                }
              });
            }
          }
          // 处理 stream_event 格式
          else if (evt.type === 'stream_event') {
            const delta = evt.event?.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              emitter.emit('output', { text: delta.text });
              fullOutput += delta.text;
              isThinking = false;
            } else if (delta?.type === 'input_json_delta') {
              // tool 调用参数，检测操作类型更新进度
              fixStarted = true;
              if (!isThinking) {
                emitter.emit('output', { text: '\n[执行中...]\n' });
                isThinking = true;
              }

              // 分析 tool 名称判断进度
              const toolName = delta.tool_name || '';
              if (toolName === 'Read' && currentStep < 2) {
                currentStep = 2;
                emitter.emit('progress', { step: 2, stepName: '分析源码' });
              } else if (toolName === 'Edit' && currentStep < 3) {
                currentStep = 3;
                emitter.emit('progress', { step: 3, stepName: '编写修复' });
              } else if ((toolName === 'Bash' || toolName === 'execute_bash') && currentStep < 4) {
                // 检测是否是编译相关命令
                const partialInput = delta.partial_json || '';
                if (partialInput.includes('build') || partialInput.includes('compile') ||
                    partialInput.includes('mvn') || partialInput.includes('npm') ||
                    partialInput.includes('gradle') || partialInput.includes('test')) {
                  currentStep = 4;
                  emitter.emit('progress', { step: 4, stepName: '编译验证' });
                }
              }
            } else if (evt.event?.type === 'tool_use') {
              // tool_use 事件也能检测
              const toolName = evt.event.name || '';
              if (toolName === 'Read' && currentStep < 2) {
                currentStep = 2;
                emitter.emit('progress', { step: 2, stepName: '分析源码' });
              } else if (toolName === 'Edit' && currentStep < 3) {
                currentStep = 3;
                emitter.emit('progress', { step: 3, stepName: '编写修复' });
              } else if ((toolName === 'Bash' || toolName === 'execute_bash') && currentStep < 4) {
                currentStep = 4;
                emitter.emit('progress', { step: 4, stepName: '编译验证' });
              }
            }
          } else if (evt.type === 'result') {
            // Claude Code 的最终结果事件，进入 AI 评审阶段
            resultEvent = evt;
            fixStarted = true;
            if (currentStep < 5) {
              currentStep = 5;
              emitter.emit('progress', { step: 5, stepName: 'AI 评审' });
            }
            // 收到 result 后 2 秒内如果没有自动退出，则强行杀掉防止卡死
            setTimeout(() => {
              if (!child.killed) {
                child.kill('SIGTERM');
              }
            }, 2000);
          } else if (evt.type === 'system') {
            if (evt.subtype === 'init' && evt.model) {
              emitter.emit('output', { text: `[模型: ${evt.model}]\n` });
            }
          }
        } catch (e) {
          // 非 JSON 行，忽略
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      emitter.emit('output', { text: chunk.toString() });
    });

    child.on('close', (code) => {
      clearTimeout(closeTimer);

      const hasOutput = fullOutput.length > 200;
      let diffMatch = fullOutput.match(/diff --git[\s\S]*/);
      
      // 如果没有在日志里输出 diff，但确实执行了任务，主动通过本地 git 获取
      if (!diffMatch && (resultEvent && !resultEvent.is_error || fixStarted)) {
        try {
          const { execSync } = require('child_process');

          // 收集所有 gitPaths 的 diff
          const diffPaths = finalGitPaths.length > 0 ? finalGitPaths : [finalProjectDir];
          const allDiffs = [];

          diffPaths.forEach(gitPath => {
            // 检查是否有 .git 目录
            if (fs.existsSync(path.join(gitPath, '.git'))) {
              try {
                const localDiff = execSync('git diff', { cwd: gitPath, encoding: 'utf-8' });
                if (localDiff && localDiff.trim().length > 0) {
                  allDiffs.push(localDiff);
                }
              } catch (e) {
                // 单个目录获取失败不影响其他
              }
            }
          });

          if (allDiffs.length > 0) {
            diffMatch = [allDiffs.join('\n')];
          }
        } catch (e) {
          // ignore
        }
      }

      const hasDiff = !!diffMatch;

      // 判断是否修复成功：有 diff 或 result 事件或 claude 执行了实际操作
      const fixSuccess = hasDiff || (resultEvent && !resultEvent.is_error) || (hasOutput && fixStarted);

      const inputTokens = resultEvent ? (resultEvent.total_input_tokens || resultEvent.input_tokens || (resultEvent.usage && resultEvent.usage.input_tokens) || 0) : 0;
      const outputTokens = resultEvent ? (resultEvent.total_output_tokens || resultEvent.output_tokens || (resultEvent.usage && resultEvent.usage.output_tokens) || 0) : 0;
      const costUsd = resultEvent ? (resultEvent.total_cost_usd || resultEvent.cost_usd || resultEvent.cost || 0) : 0;

      if (fixSuccess) {
        emitter.emit('output', { text: '\n\n>>> 修复完成\n' });
        emitter.emit('done', {
          success: true,
          diff: hasDiff ? diffMatch[0] : (fullOutput || '修复完成，详见执行日志'),
          error: null,
          inputTokens,
          outputTokens,
          costUsd
        });
      } else if (hasOutput) {
        // 有输出但未检测到修复动作，可能是 Claude 只给了分析建议
        emitter.emit('output', { text: `\n>>> Claude 执行完成 (code: ${code})\n` });
        emitter.emit('done', {
          success: false,
          diff: fullOutput,
          error: 'Claude 未执行代码修改，可能是问题分析阶段',
          inputTokens,
          outputTokens,
          costUsd
        });
      } else {
        emitter.emit('output', { text: `\n>>> Claude Code 异常退出 (code: ${code})\n` });
        emitter.emit('done', {
          success: false,
          diff: '',
          error: `Claude Code 异常退出 (code: ${code})，请检查 claude CLI 是否正常`,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0
        });
      }
    });

    child.on('error', (err) => {
      clearTimeout(closeTimer);
      emitter.emit('output', { text: `\n>>> 启动失败: ${err.message}\n` });
      emitter.emit('done', { success: false, diff: '', error: err.message });
    });
  });

  return emitter;
}

/**
 * 同步调用（保留旧接口兼容）
 */
function callClaudeFix(description, screenshotPath, category) {
  return new Promise((resolve, reject) => {
    const stream = callClaudeFixStream(description, screenshotPath, category);
    let output = '';
    stream.on('output', ({ text }) => { output += text; });
    stream.on('done', (result) => {
      result.diff = result.diff || output;
      resolve(result);
    });
  });
}

module.exports = { callClaudeFix, callClaudeFixStream };
