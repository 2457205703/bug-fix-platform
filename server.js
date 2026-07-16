const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('./config.json');
const { callClaudeFix, callClaudeFixStream } = require('./claudeFixer');
const { callClaudeReviewStream } = require('./claudeReviewer');
const memoryEngine = require('./memoryEngine');
const embeddingEngine = require('./embeddingEngine');
const visualDiffEngine = require('./visualDiffEngine');
const { exec } = require('child_process');

const fixSessions = {};
const fixQueue = [];  // 待执行任务队列
let isFixing = false;  // 是否有任务正在执行

// 处理队列中的下一个任务
function processNextInQueue() {
  if (fixQueue.length === 0) {
    isFixing = false;
    console.log('[Queue] 队列已空，无任务执行中');
    return;
  }

  const nextTask = fixQueue.shift();
  console.log(`[Queue] 开始执行队列任务: ${nextTask.feedbackId}`);
  executeFixTask(nextTask);
}

// 执行修复任务的核心逻辑
async function executeFixTask(task) {
  const { feedbackId, skipReview } = task;
  isFixing = true;

  const row = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(feedbackId);
  if (!row) {
    console.log(`[Queue] 任务 ${feedbackId} 反馈不存在，跳过`);
    processNextInQueue();
    return;
  }

  const feedback = rowToFeedback(db.prepare('SELECT feedbacks.*, projects.name AS project_name FROM feedbacks LEFT JOIN projects ON feedbacks.project_id = projects.id WHERE feedbacks.id = ?').get(feedbackId));
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(feedback.projectId || 'default') || {
    path: config.targetProject,
    url: config.targetProjectUrl,
    verification_command: config.verificationCommand,
    auto_commit: config.autoCommit ? 1 : 0,
    auto_rollback: config.autoRollbackOnFailure ? 1 : 0,
    git_paths: ''
  };

  const session = {
    status: 'running',
    output: [],
    result: null,
    childProcess: null,
    pendingInstructions: [],
    startTime: new Date().toISOString(),
    autoRetriesCount: 0,
    skipReview: skipReview ? 1 : 0,
    project: {
      path: project.path,
      url: project.url,
      verificationCommand: project.verification_command,
      autoCommit: project.auto_commit === 1,
      autoRollback: project.auto_rollback === 1,
      gitPaths: project.git_paths || ''
    }
  };
  fixSessions[feedback.id] = session;

  console.log(`[Queue] 开始修复 ${feedback.id}: ${feedback.description}`);

  const screenshotFullPath = feedback.screenshotPath
    ? path.join(dataDir, feedback.screenshotPath.replace('/screenshots/', 'screenshots/'))
    : null;

  const similarMemos = await memoryEngine.findSimilarMemories(db, feedback.description, 2);
  if (similarMemos.length > 0) {
    session.output.push({ type: 'system', text: `[系统] 检索到 ${similarMemos.length} 条相似的历史修复记忆，已注入参考上下文...\n` });
  }

  let fixDescription = [
    `[${feedback.category}] ${feedback.description}`,
    feedback.detail || '',
    `(截图: ${screenshotFullPath || '未提供'})`
  ].filter(Boolean).join('\n');

  const stream = callClaudeFixStream(fixDescription, screenshotFullPath, feedback.category, similarMemos, session.project.path, session.project.gitPaths);
  session.childProcess = stream.childProcess;

  stream.on('start', () => { session.output.push({ type: 'system', text: 'Claude Code 启动中...\n' }); });
  stream.on('output', ({ text }) => { session.output.push({ type: 'output', text }); });
  stream.on('progress', ({ step, stepName }) => { session.progress = { step, stepName }; });
  stream.on('done', (result) => {
    session.inputTokens = (session.inputTokens || 0) + (result.inputTokens || 0);
    session.outputTokens = (session.outputTokens || 0) + (result.outputTokens || 0);
    session.costUsd = (session.costUsd || 0) + (result.costUsd || 0);
    runVerification(session, feedback.id, result);
  });
}
const app = express();
app.use(express.json());

// JWT 密钥
const JWT_SECRET = config.jwtSecret || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRES = '7d';

// 数据目录
const dataDir = config.dataDir || path.join(__dirname, 'data');
const screenshotDir = path.join(dataDir, 'screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

// SQLite
const dbPath = path.join(dataDir, 'feedbacks.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ==================== 数据库表 ====================

// 检查旧表是否需要迁移（使用 ALTER TABLE 保留数据）
const oldTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='feedbacks'").get();
  if (oldTable) {
    if (!oldTable.sql.includes('user_id')) {
      console.log('[Init] 旧表缺少 user_id 列，执行迁移...');
      try { db.exec("ALTER TABLE feedbacks ADD COLUMN user_id TEXT DEFAULT ''"); } catch (e) { /* 可能已存在 */ }
    }
    if (!oldTable.sql.includes('original_description')) {
      console.log('[Init] 旧表缺少 original_description 列，执行迁移...');
      try { db.exec("ALTER TABLE feedbacks ADD COLUMN original_description TEXT"); } catch (e) {}
      try { db.exec("ALTER TABLE feedbacks ADD COLUMN description_edited INTEGER DEFAULT 0"); } catch (e) {}
      try { db.exec("ALTER TABLE feedbacks ADD COLUMN edited_by TEXT"); } catch (e) {}
    }
    if (!oldTable.sql.includes('url_path')) {
      console.log('[Init] 旧表缺少 url_path 列，执行迁移...');
      try { db.exec("ALTER TABLE feedbacks ADD COLUMN url_path TEXT DEFAULT ''"); } catch (e) {}
    }
    if (!oldTable.sql.includes('fixed_screenshot_path')) {
      console.log('[Init] 旧表缺少 fixed_screenshot_path 列，执行迁移...');
      try { db.exec("ALTER TABLE feedbacks ADD COLUMN fixed_screenshot_path TEXT"); } catch (e) {}
      try { db.exec("ALTER TABLE feedbacks ADD COLUMN diff_screenshot_path TEXT"); } catch (e) {}
    }
    if (!oldTable.sql.includes('project_id')) {
      console.log('[Init] 旧表缺少 project_id 列，执行迁移...');
      try { db.exec("ALTER TABLE feedbacks ADD COLUMN project_id TEXT DEFAULT ''"); } catch (e) {}
    }
    if (!oldTable.sql.includes('input_tokens')) {
      console.log('[Init] 旧表缺少 token 统计列，执行迁移...');
      try { db.exec("ALTER TABLE feedbacks ADD COLUMN input_tokens INTEGER DEFAULT 0"); } catch (e) {}
      try { db.exec("ALTER TABLE feedbacks ADD COLUMN output_tokens INTEGER DEFAULT 0"); } catch (e) {}
      try { db.exec("ALTER TABLE feedbacks ADD COLUMN cost_usd REAL DEFAULT 0"); } catch (e) {}
    }
    if (!oldTable.sql.includes('skip_review')) {
      console.log('[Init] 旧表缺少 skip_review 列，执行迁移...');
      try { db.exec("ALTER TABLE feedbacks ADD COLUMN skip_review INTEGER DEFAULT 0"); } catch (e) {}
    }
  }

  const oldMemories = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='memories'").get();
  if (oldMemories && !oldMemories.sql.includes('embedding')) {
    console.log('[Init] memories 表缺少 embedding 列，执行迁移...');
    try { db.exec("ALTER TABLE memories ADD COLUMN embedding TEXT"); } catch (e) {}
  }

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    path TEXT NOT NULL,
    url TEXT DEFAULT '',
    verification_command TEXT DEFAULT '',
    auto_commit INTEGER DEFAULT 0,
    auto_rollback INTEGER DEFAULT 0,
    git_paths TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feedbacks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    reporter TEXT DEFAULT '匿名用户',
    category TEXT DEFAULT 'Bug',
    description TEXT NOT NULL,
    original_description TEXT,
    description_edited INTEGER DEFAULT 0,
    edited_by TEXT,
    detail TEXT DEFAULT '',
    url_path TEXT DEFAULT '',
    screenshot_path TEXT,
    fixed_screenshot_path TEXT,
    diff_screenshot_path TEXT,
    status TEXT DEFAULT 'pending',
    skip_review INTEGER DEFAULT 0,  -- 是否跳过 AI 评审
    created_at TEXT NOT NULL,
    fix_success INTEGER,
    fix_diff TEXT,
    fix_error TEXT,
    fix_log TEXT,
    fixed_at TEXT,
    project_id TEXT DEFAULT '',
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    feedback_id TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    diff TEXT NOT NULL,
    summary TEXT NOT NULL,
    embedding TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_fb_status ON feedbacks(status);
  CREATE INDEX IF NOT EXISTS idx_fb_user ON feedbacks(user_id);
  CREATE INDEX IF NOT EXISTS idx_fb_created ON feedbacks(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_memo_fb ON memories(feedback_id);
`);

// 迁移：检查 projects 表是否缺少 git_paths 列
const projectTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'").get();
if (projectTable && !projectTable.sql.includes('git_paths')) {
  console.log('[Init] projects 表缺少 git_paths 列，执行迁移...');
  try { db.exec("ALTER TABLE projects ADD COLUMN git_paths TEXT DEFAULT ''"); } catch (e) { /* 可能已存在 */ }
}

// 初始化项目表向下兼容数据
try {
  let defaultProj = db.prepare('SELECT id FROM projects WHERE id = ?').get('default');
  if (!defaultProj) {
    db.prepare(`
      INSERT INTO projects (id, name, path, url, verification_command, auto_commit, auto_rollback, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'default',
      '默认项目',
      config.targetProject || '',
      config.targetProjectUrl || '',
      config.verificationCommand || '',
      config.autoCommit ? 1 : 0,
      config.autoRollbackOnFailure ? 1 : 0,
      new Date().toISOString()
    );
    console.log('[Init] 自动创建默认项目 "默认项目" 并同步原有 config.json 配置');
  }

  const updateCount = db.prepare("UPDATE feedbacks SET project_id = 'default' WHERE project_id IS NULL OR project_id = ''").run();
  if (updateCount.changes > 0) {
    console.log(`[Init] 成功将 ${updateCount.changes} 条历史反馈关联到默认项目`);
  }
} catch (e) {
  console.error('[Init] 初始化项目关联失败:', e.message);
}

// 重置服务重启时意外卡在 approved (修复中) 状态的存量任务
try {
  const resetResult = db.prepare("UPDATE feedbacks SET status = 'failed', fix_error = '服务重启，任务意外中止', fixed_at = ? WHERE status = 'approved'").run(new Date().toISOString());
  if (resetResult.changes > 0) {
    console.log(`[Init] 已重置 ${resetResult.changes} 个因服务重启卡在“修复中”状态的挂死任务`);
  }
} catch (e) {
  console.error('[Init] 重置卡死任务失败:', e.message);
}

// ==================== 默认管理员 ====================

const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)
  `).run(uuidv4(), 'admin', hash, '管理员', 'admin', new Date().toISOString());
  console.log('[Init] 默认管理员: admin / admin123');
}

// 预加载/预热本地语义向量模型
embeddingEngine.preload().catch(err => {
  console.warn('[Embedding] 语义特征提取模型预加载失败，将自动降级至传统 TF-IDF。原因:', err.message);
});

// ==================== JWT 中间件 ====================

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '请先登录' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(req.user.id, 'active');
    if (!user) return res.status(401).json({ error: '用户不存在或已被禁用' });
    req.user.role = user.role;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function rolesAllowed(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

// ==================== Multer ====================

const storage = multer.diskStorage({
  destination: screenshotDir,
  filename: (req, file, cb) => { cb(null, `${uuidv4()}.png`); }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ==================== Helper ====================

function rowToFeedback(row) {
  return {
    id: row.id,
    userId: row.user_id,
    reporter: row.reporter,
    category: row.category,
    description: row.description,
    originalDescription: row.original_description,
    descriptionEdited: row.description_edited === 1,
    editedBy: row.edited_by,
    detail: row.detail,
    urlPath: row.url_path,
    screenshotPath: row.screenshot_path,
    fixedScreenshotPath: row.fixed_screenshot_path,
    diffScreenshotPath: row.diff_screenshot_path,
    status: row.status,
    createdAt: row.created_at,
    projectId: row.project_id || '',
    projectName: row.project_name || '',
    fixResult: row.fixed_at ? {
      success: row.fix_success === 1,
      diff: row.fix_diff,
      error: row.fix_error,
      log: row.fix_log,
      fixedAt: row.fixed_at,
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
      costUsd: row.cost_usd || 0
    } : null
  };
}

function userToRow(u) {
  return { id: u.id, username: u.username, displayName: u.display_name, role: u.role, status: u.status, createdAt: u.created_at };
}

// ==================== Auth API ====================

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.status !== 'active') return res.status(401).json({ error: '用户名或密码错误' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: '用户名或密码错误' });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

  res.json({
    token,
    user: userToRow(user)
  });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: userToRow(user) });
});

// ==================== 项目管理 API ====================

// 获取项目列表
app.get('/api/projects', authRequired, (req, res) => {
  try {
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    res.json({ projects: projects.map(p => ({
      id: p.id,
      name: p.name,
      path: p.path,
      url: p.url,
      verificationCommand: p.verification_command,
      autoCommit: p.auto_commit === 1,
      autoRollback: p.auto_rollback === 1,
      gitPaths: p.git_paths || '',
      createdAt: p.created_at
    })) });
  } catch (err) {
    res.status(500).json({ error: '获取项目列表失败' });
  }
});

// 新建项目 (admin)
app.post('/api/projects', authRequired, rolesAllowed('admin'), (req, res) => {
  const { name, path: projPath, url, verificationCommand, autoCommit, autoRollback, gitPaths } = req.body;
  if (!name || !name.trim() || !projPath || !projPath.trim()) {
    return res.status(400).json({ error: '项目名称和路径不能为空' });
  }

  try {
    const existing = db.prepare('SELECT id FROM projects WHERE name = ?').get(name.trim());
    if (existing) return res.status(400).json({ error: '项目名称已存在' });

    const id = uuidv4();
    db.prepare(`
      INSERT INTO projects (id, name, path, url, verification_command, auto_commit, auto_rollback, git_paths, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name.trim(),
      projPath.trim(),
      (url || '').trim(),
      (verificationCommand || '').trim(),
      autoCommit ? 1 : 0,
      autoRollback ? 1 : 0,
      (gitPaths || '').trim(),
      new Date().toISOString()
    );

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.json({ success: true, project: {
      id: project.id,
      name: project.name,
      path: project.path,
      url: project.url,
      verificationCommand: project.verification_command,
      autoCommit: project.auto_commit === 1,
      autoRollback: project.auto_rollback === 1,
      gitPaths: project.git_paths || '',
      createdAt: project.created_at
    } });
  } catch (err) {
    res.status(500).json({ error: `创建项目失败: ${err.message}` });
  }
});

// 更新项目 (admin)
app.put('/api/projects/:id', authRequired, rolesAllowed('admin'), (req, res) => {
  const { name, path: projPath, url, verificationCommand, autoCommit, autoRollback, gitPaths } = req.body;
  if (!name || !name.trim() || !projPath || !projPath.trim()) {
    return res.status(400).json({ error: '项目名称和路径不能为空' });
  }

  try {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    // 检查重名
    const dup = db.prepare('SELECT id FROM projects WHERE name = ? AND id != ?').get(name.trim(), req.params.id);
    if (dup) return res.status(400).json({ error: '同名项目已存在' });

    db.prepare(`
      UPDATE projects
      SET name = ?, path = ?, url = ?, verification_command = ?, auto_commit = ?, auto_rollback = ?, git_paths = ?
      WHERE id = ?
    `).run(
      name.trim(),
      projPath.trim(),
      (url || '').trim(),
      (verificationCommand || '').trim(),
      autoCommit ? 1 : 0,
      autoRollback ? 1 : 0,
      (gitPaths || '').trim(),
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json({ success: true, project: {
      id: updated.id,
      name: updated.name,
      path: updated.path,
      url: updated.url,
      verificationCommand: updated.verification_command,
      autoCommit: updated.auto_commit === 1,
      autoRollback: updated.auto_rollback === 1,
      gitPaths: updated.git_paths || '',
      createdAt: updated.created_at
    } });
  } catch (err) {
    res.status(500).json({ error: `修改项目失败: ${err.message}` });
  }
});

// 删除项目 (admin)
app.delete('/api/projects/:id', authRequired, rolesAllowed('admin'), (req, res) => {
  if (req.params.id === 'default') {
    return res.status(400).json({ error: '默认项目不能被删除' });
  }

  try {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const related = db.prepare('SELECT id FROM feedbacks WHERE project_id = ? LIMIT 1').get(req.params.id);
    if (related) {
      return res.status(400).json({ error: '该项目下已有反馈关联，无法删除。请先转移或删除关联的反馈记录。' });
    }

    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '项目删除成功' });
  } catch (err) {
    res.status(500).json({ error: `删除项目失败: ${err.message}` });
  }
});

// ==================== 用户管理 API (admin) ====================

app.get('/api/users', authRequired, rolesAllowed('admin'), (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json({ users: users.map(userToRow) });
});

app.post('/api/users', authRequired, rolesAllowed('admin'), (req, res) => {
  const { username, password, displayName, role } = req.body;
  if (!username || !password || !displayName) return res.status(400).json({ error: '用户名、密码、显示名不能为空' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: '用户名已存在' });

  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)
  `).run(id, username, hash, displayName, role || 'user', new Date().toISOString());

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: userToRow(user) });
});

app.put('/api/users/:id', authRequired, rolesAllowed('admin'), (req, res) => {
  const { displayName, role } = req.body;
  const sets = [];
  const params = [];
  if (displayName !== undefined) { sets.push('display_name = ?'); params.push(displayName); }
  if (role !== undefined) { sets.push('role = ?'); params.push(role); }
  if (sets.length === 0) return res.status(400).json({ error: '无修改内容' });
  params.push(new Date().toISOString(), req.params.id);

  db.prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...params);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  res.json({ user: userToRow(user) });
});

app.put('/api/users/:id/disable', authRequired, rolesAllowed('admin'), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: '不能禁用自己' });
  db.prepare("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?").run(new Date().toISOString(), req.params.id);
  res.json({ success: true });
});

app.put('/api/users/:id/enable', authRequired, rolesAllowed('admin'), (req, res) => {
  db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?").run(new Date().toISOString(), req.params.id);
  res.json({ success: true });
});

// ==================== 反馈 API ====================

// 提交反馈（需登录）
app.post('/api/feedback', authRequired, upload.single('screenshot'), (req, res) => {
  try {
    const { category, description, detail, urlPath, projectId } = req.body;
    if (!description || !description.trim()) {
      return res.status(400).json({ error: '问题描述不能为空' });
    }

    const id = uuidv4();
    const screenshotPath = req.file ? `/screenshots/${req.file.filename}` : null;
    const reporter = req.user.username;
    const finalProjectId = projectId || 'default';

    db.prepare(`
      INSERT INTO feedbacks (id, user_id, reporter, category, description, original_description, detail, url_path, screenshot_path, status, created_at, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, req.user.id, reporter, category || 'Bug', description.trim(), description.trim(), (detail || '').trim(), (urlPath || '').trim(), screenshotPath, new Date().toISOString(), finalProjectId);

    const row = db.prepare('SELECT feedbacks.*, projects.name AS project_name FROM feedbacks LEFT JOIN projects ON feedbacks.project_id = projects.id WHERE feedbacks.id = ?').get(id);
    console.log(`[Feedback] 新反馈: ${id} from ${reporter} (项目: ${finalProjectId})`);
    res.json({ success: true, feedback: rowToFeedback(row) });
  } catch (err) {
    console.error('[Feedback] 提交失败:', err.message);
    res.status(500).json({ error: `提交失败: ${err.message}` });
  }
});

// 所有反馈列表（admin）
app.get('/api/feedbacks', authRequired, rolesAllowed('admin', 'developer'), (req, res) => {
  try {
    const { status } = req.query;
    let rows;
    if (status) {
      rows = db.prepare('SELECT feedbacks.*, projects.name AS project_name FROM feedbacks LEFT JOIN projects ON feedbacks.project_id = projects.id WHERE feedbacks.status = ? ORDER BY feedbacks.created_at DESC').all(status);
    } else {
      rows = db.prepare('SELECT feedbacks.*, projects.name AS project_name FROM feedbacks LEFT JOIN projects ON feedbacks.project_id = projects.id ORDER BY feedbacks.created_at DESC').all();
    }
    res.json({ feedbacks: rows.map(rowToFeedback) });
  } catch (err) {
    res.status(500).json({ error: '获取列表失败' });
  }
});

// 我的反馈列表（user）
app.get('/api/feedbacks/mine', authRequired, (req, res) => {
  try {
    const rows = db.prepare('SELECT feedbacks.*, projects.name AS project_name FROM feedbacks LEFT JOIN projects ON feedbacks.project_id = projects.id WHERE feedbacks.user_id = ? ORDER BY feedbacks.created_at DESC').all(req.user.id);
    res.json({ feedbacks: rows.map(rowToFeedback) });
  } catch (err) {
    res.status(500).json({ error: '获取列表失败' });
  }
});

// 反馈详情
app.get('/api/feedback/:id', authRequired, (req, res) => {
  try {
    const row = db.prepare('SELECT feedbacks.*, projects.name AS project_name FROM feedbacks LEFT JOIN projects ON feedbacks.project_id = projects.id WHERE feedbacks.id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '反馈不存在' });
    // user 只能看自己的
    if (req.user.role !== 'admin' && row.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权查看此反馈' });
    }
    res.json({ feedback: rowToFeedback(row) });
  } catch (err) {
    res.status(500).json({ error: '获取详情失败' });
  }
});

// 审批通过
app.post('/api/feedback/:id/approve', authRequired, rolesAllowed('admin', 'developer'), async (req, res) => {
  try {
    const { skipReview } = req.body;  // 是否跳过 AI 评审
    const row = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '反馈不存在' });
    if (row.status !== 'pending' && row.status !== 'failed' && row.status !== 'stopped' && row.status !== 'rejected' && row.status !== 'fixed') {
      return res.status(400).json({ error: `反馈状态为 ${row.status}，无法审批` });
    }

    // 更新状态为 approved（queued 表示排队等待）
    const newStatus = isFixing ? 'queued' : 'approved';
    db.prepare('UPDATE feedbacks SET status = ?, skip_review = ?, fixed_at = NULL, fix_success = NULL, fix_diff = NULL, fix_error = NULL, fix_log = NULL WHERE id = ?')
      .run(newStatus, skipReview ? 1 : 0, req.params.id);
    const feedback = rowToFeedback(db.prepare('SELECT feedbacks.*, projects.name AS project_name FROM feedbacks LEFT JOIN projects ON feedbacks.project_id = projects.id WHERE feedbacks.id = ?').get(req.params.id));

    // 如果有任务正在执行，加入队列
    if (isFixing) {
      fixQueue.push({ feedbackId: feedback.id, skipReview });
      console.log(`[Queue] ${feedback.id} 已加入队列，当前队列长度: ${fixQueue.length}`);
      return res.json({ success: true, message: `任务已加入队列（当前排队 ${fixQueue.length} 个），等待执行...`, feedback, queued: true });
    }

    // 否则立即执行
    res.json({ success: true, message: '审批通过，Claude Code 开始修复...', feedback });
    executeFixTask({ feedbackId: feedback.id, skipReview });
  } catch (err) {
    console.error('[Approve] 审批失败:', err);
    res.status(500).json({ error: '审批失败' });
  }
});

// 继续修复（用户介入）
app.post('/api/feedback/:id/continue-fix', authRequired, rolesAllowed('admin', 'developer'), (req, res) => {
  try {
    const { instruction } = req.body;
    if (!instruction || !instruction.trim()) {
      return res.status(400).json({ error: '补充指令不能为空' });
    }

    const row = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '反馈不存在' });
    
    // 如果任务卡在 approved 状态但内存会话已不存在，允许继续修复（强制重置）
    const sessionExists = !!fixSessions[row.id];
    if (row.status !== 'fixed' && row.status !== 'failed' && row.status !== 'stopped' && !(row.status === 'approved' && !sessionExists)) {
      return res.status(400).json({ error: '反馈状态不允许继续修复' });
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(row.project_id || 'default') || {
      path: config.targetProject,
      url: config.targetProjectUrl,
      verification_command: config.verificationCommand,
      auto_commit: config.autoCommit ? 1 : 0,
      auto_rollback: config.autoRollbackOnFailure ? 1 : 0
    };

    const session = {
      status: 'running',
      output: [],
      result: null,
      childProcess: null,
      pendingInstructions: [],
      startTime: new Date().toISOString(),
      autoRetriesCount: 0,
      skipReview: row.skip_review || 0,  // 继承之前的设置
      project: {
        path: project.path,
        url: project.url,
        verificationCommand: project.verification_command,
        autoCommit: project.auto_commit === 1,
        autoRollback: project.auto_rollback === 1,
        gitPaths: project.git_paths || ''
      }
    };
    fixSessions[row.id] = session;

    const feedback = rowToFeedback(db.prepare('SELECT feedbacks.*, projects.name AS project_name FROM feedbacks LEFT JOIN projects ON feedbacks.project_id = projects.id WHERE feedbacks.id = ?').get(row.id));
    res.json({ success: true, message: '继续修复中...', feedback });

    console.log(`[ContinueFix] 继续修复 ${row.id}: ${instruction}`);
    runContinueFix(row.id, instruction.trim(), session);
  } catch (err) {
    console.error('[ContinueFix] 失败:', err);
    res.status(500).json({ error: '继续修复失败' });
  }
});

// 排队指令（执行中调用）
app.post('/api/feedback/:id/queue-fix', authRequired, rolesAllowed('admin', 'developer'), (req, res) => {
  try {
    const { instruction } = req.body;
    if (!instruction || !instruction.trim()) {
      return res.status(400).json({ error: '补充指令不能为空' });
    }

    const session = fixSessions[req.params.id];
    if (!session) return res.status(404).json({ error: '没有正在执行的修复任务' });
    if (session.status !== 'running') {
      return res.status(400).json({ error: '当前没有正在执行的任务，请使用继续修复' });
    }

    session.pendingInstructions.push(instruction.trim());
    session.output.push({ type: 'system', text: `[排队] 已添加补充指令，将在当前执行完成后自动继续\n` });
    res.json({ success: true, message: '指令已排队，当前执行完成后自动继续' });
  } catch (err) {
    res.status(500).json({ error: '排队失败' });
  }
});

// 停止修复
app.post('/api/feedback/:id/stop-fix', authRequired, rolesAllowed('admin', 'developer'), (req, res) => {
  try {
    const session = fixSessions[req.params.id];
    if (!session) {
      // 容错处理：如果内存会话已丢失但数据库仍处于 approved (修复中)，强行将其置为 stopped 状态以解卡
      const row = db.prepare('SELECT status FROM feedbacks WHERE id = ?').get(req.params.id);
      if (row && row.status === 'approved') {
        db.prepare(`
          UPDATE feedbacks SET status = ?, fix_success = 0, fix_error = ?, fixed_at = ? WHERE id = ?
        `).run('stopped', '任务内存丢失，手动重置停止', new Date().toISOString(), req.params.id);
        
        // 尝试回滚防污染
        rollbackChanges(config.targetProject, null);
        
        console.log(`[StopFix] 任务 ${req.params.id} 内存丢失，已手动强制重置为 stopped`);
        return res.json({ success: true, message: '检测到挂死任务，已手动强行停止重置' });
      }
      return res.status(404).json({ error: '没有正在执行的修复任务' });
    }
    if (session.status !== 'running') {
      return res.status(400).json({ error: '任务未在执行中' });
    }

    // 终止进程
    if (session.childProcess && !session.childProcess.killed) {
      session.childProcess.kill('SIGTERM');
    }

    session.output.push({ type: 'system', text: '\n[用户已停止执行]\n' });
    session.status = 'done';
    session.result = { success: false, diff: '', error: '用户手动停止执行' };
    session.childProcess = null;

    // 触发自动回滚以清理工作区
    rollbackChanges(config.targetProject, session);

    // 保存当前日志到数据库，状态为 stopped（用户主动停止）
    const log = session.output.map(o => o.text).join('');
    db.prepare(`
      UPDATE feedbacks SET status = ?, fix_success = 0, fix_error = ?, fix_log = ?, fixed_at = ? WHERE id = ?
    `).run('stopped', '用户手动停止执行', log, new Date().toISOString(), req.params.id);

    // 清空排队指令
    session.pendingInstructions = [];

    res.json({ success: true, message: '已停止执行' });
    console.log(`[StopFix] ${req.params.id} 用户停止执行`);
  } catch (err) {
    res.status(500).json({ error: '停止失败' });
  }
});

// SSE
app.get('/api/feedback/:id/fix-stream', (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ error: '未授权，请先登录' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT role, status FROM users WHERE id = ?').get(decoded.id);
    if (!user || user.status !== 'active' || user.role !== 'admin') {
      return res.status(403).json({ error: '权限不足' });
    }
  } catch (err) {
    return res.status(401).json({ error: '登录已过期' });
  }

  const session = fixSessions[req.params.id];
  if (!session) return res.status(404).json({ error: '没有正在执行的修复任务' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  for (const item of session.output) sendSSE(res, item.type, item.text);
  if (session.progress) sendSSE(res, 'progress', JSON.stringify(session.progress));
  if (session.status === 'done') { sendSSE(res, 'done', JSON.stringify(session.result)); return res.end(); }

  let sentCount = session.output.length;
  let sentProgress = session.progress ? session.progress.step : 0;
  const interval = setInterval(() => {
    while (sentCount < session.output.length) {
      sendSSE(res, session.output[sentCount].type, session.output[sentCount].text);
      sentCount++;
    }
    if (session.progress && session.progress.step !== sentProgress) {
      sendSSE(res, 'progress', JSON.stringify(session.progress));
      sentProgress = session.progress.step;
    }
    if (session.status === 'done') {
      clearInterval(interval);
      sendSSE(res, 'done', JSON.stringify(session.result));
      res.end();
    }
  }, 200);
  req.on('close', () => clearInterval(interval));
});

// 拒绝
app.post('/api/feedback/:id/reject', authRequired, rolesAllowed('admin', 'developer'), (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '反馈不存在' });
    db.prepare('UPDATE feedbacks SET status = ? WHERE id = ?').run('rejected', req.params.id);
    const updated = rowToFeedback(db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(req.params.id));
    res.json({ success: true, feedback: updated });
  } catch (err) {
    res.status(500).json({ error: '操作失败' });
  }
});

// 删除反馈
app.delete('/api/feedback/:id', authRequired, rolesAllowed('admin', 'developer'), (req, res) => {
  try {
    const row = db.prepare('SELECT screenshot_path, fixed_screenshot_path, diff_screenshot_path FROM feedbacks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '反馈不存在' });

    // 删除关联的本地图片文件
    const paths = [row.screenshot_path, row.fixed_screenshot_path, row.diff_screenshot_path];
    paths.forEach(p => {
      if (p) {
        const fullPath = path.join(dataDir, p.replace(/^\/screenshots\//, 'screenshots/'));
        if (fs.existsSync(fullPath)) {
          try { fs.unlinkSync(fullPath); } catch (e) { console.error('删除截图文件失败:', e); }
        }
      }
    });

    // 删除数据库记录
    db.prepare('DELETE FROM memories WHERE feedback_id = ?').run(req.params.id);
    db.prepare('DELETE FROM feedbacks WHERE id = ?').run(req.params.id);

    // 清理可能在内存中运行的会话
    const session = fixSessions[req.params.id];
    if (session && session.childProcess && !session.childProcess.killed) {
      try { session.childProcess.kill('SIGTERM'); } catch (e) {}
    }
    delete fixSessions[req.params.id];

    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('[Feedback] 删除失败:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

// 管理员修改反馈描述（保留原始）
app.put('/api/feedback/:id/description', authRequired, rolesAllowed('admin', 'developer'), (req, res) => {
  try {
    const { description, originalDescription, detail } = req.body;

    const row = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '反馈不存在' });

    const sets = [];
    const params = [];

    // 编辑 description
    if (description !== undefined && description.trim()) {
      // 首次修改时保存原始描述
      if (!row.original_description && !originalDescription) {
        sets.push('original_description = ?');
        params.push(row.description);
      }
      sets.push('description = ?');
      params.push(description.trim());
      sets.push('description_edited = 1');
      sets.push('edited_by = ?');
      params.push(req.user.username);
    }

    // 编辑 originalDescription
    if (originalDescription !== undefined) {
      sets.push('original_description = ?');
      params.push(originalDescription.trim() || null);
    }

    // 编辑 detail
    if (detail !== undefined) {
      sets.push('detail = ?');
      params.push(detail.trim());
    }

    if (sets.length === 0) return res.status(400).json({ error: '无修改内容' });
    params.push(req.params.id);

    db.prepare(`UPDATE feedbacks SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    const updated = rowToFeedback(db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(req.params.id));
    res.json({ success: true, feedback: updated });
  } catch (err) {
    res.status(500).json({ error: '修改失败' });
  }
});

// 管理员重置用户密码
app.post('/api/users/:id/reset-password', authRequired, rolesAllowed('admin'), (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, new Date().toISOString(), req.params.id);

    res.json({ success: true, message: '密码已重置' });
  } catch (err) {
    res.status(500).json({ error: '重置失败' });
  }
});

// 自动回滚修改以保护工作区
function rollbackChanges(projectDir, session) {
  const autoRollback = session ? session.project.autoRollback : config.autoRollbackOnFailure;
  if (!autoRollback) return;

  // 获取所有需要回滚的 Git 仓库路径
  let gitPaths = [];
  if (session && session.project.gitPaths) {
    const gitPathsStr = session.project.gitPaths.trim();
    console.log('[Git] gitPaths 原始值:', JSON.stringify(gitPathsStr));
    if (gitPathsStr) {
      // 尝试 JSON 解析
      try {
        const parsed = JSON.parse(gitPathsStr);
        gitPaths = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        // 不是 JSON，按换行分隔处理
        gitPaths = gitPathsStr.split(/[\n,]+/).map(p => p.trim()).filter(Boolean);
      }
    }
    console.log('[Git] 解析后的 gitPaths:', gitPaths);
  }

  // 如果没有配置 gitPaths，尝试使用主项目路径
  if (gitPaths.length === 0 && projectDir) {
    const mainGitDir = path.join(projectDir, '.git');
    if (fs.existsSync(mainGitDir)) {
      gitPaths.push(projectDir);
    } else {
      // 自动检测子目录中的 Git 仓库
      try {
        const subdirs = fs.readdirSync(projectDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => path.join(projectDir, d.name));

        subdirs.forEach(subdir => {
          if (fs.existsSync(path.join(subdir, '.git'))) {
            gitPaths.push(subdir);
          }
        });
      } catch (e) {}
    }
  }

  if (gitPaths.length === 0) {
    console.log('[Git] 未检测到 Git 仓库，跳过回滚操作');
    if (session) session.output.push({ type: 'system', text: `\n[系统] 未检测到 Git 仓库，跳过自动回滚保护。\n` });
    return;
  }

  console.log(`[Git] 正在回滚 ${gitPaths.length} 个 Git 仓库中的修改...`);
  if (session) session.output.push({ type: 'system', text: `\n[系统] 正在回滚 ${gitPaths.length} 个仓库的修改...\n` });

  gitPaths.forEach((gitPath, idx) => {
    const gitDir = path.join(gitPath, '.git');
    if (!fs.existsSync(gitDir)) {
      console.log(`[Git] ${gitPath} 不是 Git 仓库，跳过`);
      if (session) session.output.push({ type: 'system', text: `[系统] ${gitPath} 不是 Git 仓库，跳过\n` });
      return;
    }

    console.log(`[Git] 正在回滚 ${gitPath}...`);
    if (session) session.output.push({ type: 'system', text: `[系统] 正在回滚 ${gitPath}...\n` });

    exec('git checkout -- .', { cwd: gitPath }, (err) => {
      if (err) {
        console.error(`[Git] ${gitPath} 回滚失败:`, err.message);
        if (session) session.output.push({ type: 'system', text: `[系统] ${gitPath} 回滚失败: ${err.message}\n` });
      } else {
        console.log(`[Git] ${gitPath} 回滚成功`);
        if (session) session.output.push({ type: 'system', text: `[系统] ${gitPath} 已成功回滚。\n` });
      }
    });
  });
}

// 运行 AI 代码交叉评审
function runReviewer(session, feedbackId, result) {
  const projectDir = session.project.path;
  const row = db.prepare('SELECT description FROM feedbacks WHERE id = ?').get(feedbackId);
  const desc = row ? row.description : 'Bug 修复任务';

  session.output.push({ type: 'system', text: `\n[系统] 正在启动 AI 代码交叉评审专家机制...\n` });
  console.log(`[Review] 正在启动 ${feedbackId} 交叉评审...`);

  const reviewStream = callClaudeReviewStream(result.diff || result.result || '', desc);
  session.childProcess = reviewStream.childProcess;

  reviewStream.on('start', () => {
    session.output.push({ type: 'system', text: `\n[AI 评审专家] 开始阅读修复 Diff，评估代码优雅性与逻辑...\n` });
  });

  reviewStream.on('output', ({ text }) => {
    session.output.push({ type: 'output', text });
  });

  reviewStream.on('done', (reviewResult) => {
    session.childProcess = null;
    if (reviewResult.decision === 'PASS') {
      session.output.push({ type: 'system', text: `\n[系统] 交叉评审通过！代码非常优雅，同意合入。\n` });
      console.log(`[Review] ${feedbackId} 评审通过 (PASS)`);
      
      // 触发成功后置处理（含视觉测试与 Git 提交）
      handleFixSuccess(session, feedbackId, result);
    } else {
      session.output.push({ type: 'system', text: `\n[系统] 评审专家未通过！修改被打回，打回建议如下：\n------------------------------\n${reviewResult.detail}\n------------------------------\n` });
      console.log(`[Review] ${feedbackId} 评审未通过 (FAIL)`);

      const maxRetries = config.maxAutoRetries || 3;
      if (session.autoRetriesCount < maxRetries) {
        session.autoRetriesCount++;
        session.output.push({ type: 'system', text: `\n[系统] 自动将评审建议作为纠错指令，启动第 ${session.autoRetriesCount} / ${maxRetries} 次自纠错...\n` });
        console.log(`[Review] ${feedbackId} 触发自纠错第 ${session.autoRetriesCount} 次`);

        const errorPrompt = [
          `AI 代码评审专家未通过上次的修改。`,
          `评审专家的优化建议如下：`,
          `------------------------------`,
          reviewResult.detail,
          `------------------------------`,
          `请针对评审专家的意见，修改并重构代码以确保代码的高质量和正确性。`
        ].join('\n');

        runContinueFix(feedbackId, errorPrompt, session, true);
      } else {
        session.output.push({ type: 'system', text: `\n[系统] 已达最大自动纠错次数 (${maxRetries})，判定最终修复失败。\n` });
        console.log(`[Review] ${feedbackId} 达到最大重试次数，修复失败`);
        result.success = false;
        result.error = `AI 评审未通过: ${reviewResult.detail}`;

        // 回滚工作区
        rollbackChanges(projectDir, session);
        handleFixDone(session, feedbackId, result);
      }
    }
  });
}

// 自动编译/验证逻辑与 AI 自纠错
function runVerification(session, feedbackId, result) {
  if (session.status === 'done' || session.status === 'verified') return;
  const cmd = session.project.verificationCommand;
  const projectDir = session.project.path;

  console.log(`[Verify] ${feedbackId} skipReview=${session.skipReview}, hasCmd=${!!cmd}`);

  if (!result.success) {
    rollbackChanges(projectDir, session);
    handleFixDone(session, feedbackId, result);
    return;
  }

  // 如果跳过 AI 评审，直接完成
  if (session.skipReview) {
    if (!cmd) {
      // 没有验证命令，直接标记完成
      session.output.push({ type: 'system', text: `\n[系统] 已跳过 AI 评审环节，修复完成。\n` });
      handleFixDone(session, feedbackId, result);
      return;
    }
    // 有验证命令，运行验证后直接完成
    session.output.push({ type: 'system', text: `\n[系统] 正在运行项目验证命令: ${cmd}...\n` });
    console.log(`[Verify] 正在项目 ${projectDir} 运行验证命令: ${cmd}`);
    exec(cmd, { cwd: projectDir }, (err, stdout, stderr) => {
      if (!err) {
        session.output.push({ type: 'system', text: `\n[系统] 验证成功！已跳过 AI 评审，修复完成。\n` });
        console.log(`[Verify] ${feedbackId} 验证成功，跳过评审`);
        handleFixDone(session, feedbackId, result);
      } else {
        const errorMsg = stderr || stdout || err.message;
        session.output.push({ type: 'system', text: `\n[系统] 验证编译失败！错误信息：\n${errorMsg}\n` });
        console.log(`[Verify] ${feedbackId} 验证失败`);
        rollbackChanges(projectDir, session);
        handleFixDone(session, feedbackId, { success: false, error: errorMsg });
      }
    });
    return;
  }

  // 没有配置验证命令，直接进入 AI 代码评审
  if (!cmd) {
    runReviewer(session, feedbackId, result);
    return;
  }

  session.output.push({ type: 'system', text: `\n[系统] 正在运行项目验证命令: ${cmd}...\n` });
  console.log(`[Verify] 正在项目 ${projectDir} 运行验证命令: ${cmd}`);

  exec(cmd, { cwd: projectDir }, (err, stdout, stderr) => {
    if (!err) {
      session.output.push({ type: 'system', text: `\n[系统] 验证成功！项目编译/静态校验通过。\n` });
      console.log(`[Verify] ${feedbackId} 验证成功`);

      // 进入 AI 评审阶段
      runReviewer(session, feedbackId, result);
    } else {
      const errorMsg = stderr || stdout || err.message;
      session.output.push({ type: 'system', text: `\n[系统] 验证编译失败！错误信息：\n${errorMsg}\n` });
      console.log(`[Verify] ${feedbackId} 验证失败`);

      const maxRetries = config.maxAutoRetries || 3;
      if (session.autoRetriesCount < maxRetries) {
        session.autoRetriesCount++;
        session.output.push({ type: 'system', text: `\n[系统] 触发 AI 自动纠错，第 ${session.autoRetriesCount} / ${maxRetries} 次尝试...\n` });
        console.log(`[Verify] ${feedbackId} 触发自纠错第 ${session.autoRetriesCount} 次`);

        const errorPrompt = [
          `项目编译/静态验证失败。`,
          `运行命令 "${cmd}" 时报错：`,
          `------------------------------`,
          errorMsg,
          `------------------------------`,
          `请分析上述报错信息，定位并修复代码中的相关问题以确保通过编译。`
        ].join('\n');

        runContinueFix(feedbackId, errorPrompt, session, true);
      } else {
        session.output.push({ type: 'system', text: `\n[系统] 已达最大自动纠错次数 (${maxRetries})，判定修复失败。\n` });
        console.log(`[Verify] ${feedbackId} 达到最大纠错次数，修复失败`);
        result.success = false;
        result.error = `验证命令失败: ${errorMsg}`;

        // 达到最大次数仍失败，触发回滚
        rollbackChanges(projectDir, session);

        handleFixDone(session, feedbackId, result);
      }
    }
  });
}

// 修复成功后的流程管理（视觉测试 & Git 自动提交）
function handleFixSuccess(session, feedbackId, result) {
  const feedback = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(feedbackId);
  const targetUrl = session.project.url;
  
  if (feedback && feedback.url_path && feedback.screenshot_path && targetUrl) {
    session.output.push({ type: 'system', text: `\n[系统] 正在启动 Headless 浏览器进行视觉回归测试 (访问: ${targetUrl}${feedback.url_path})...\n` });
    console.log(`[VisualDiff] 正在为 ${feedbackId} 启动视觉测试...`);

    visualDiffEngine.captureAndCompare(rowToFeedback(feedback), dataDir, targetUrl)
      .then((diffResult) => {
        if (diffResult.error) {
          session.output.push({ type: 'system', text: `\n[系统] 视觉回归测试跳过或失败: ${diffResult.error}\n` });
          console.warn(`[VisualDiff] 失败:`, diffResult.error);
        } else {
          session.output.push({ type: 'system', text: `\n[系统] 视觉回归测试完成！生成了修复后截图与像素差异对比图。\n` });
          
          db.prepare(`
            UPDATE feedbacks 
            SET fixed_screenshot_path = ?, diff_screenshot_path = ? 
            WHERE id = ?
          `).run(diffResult.fixedPath, diffResult.diffPath, feedbackId);
          
          // 更新缓存
          result.fixedScreenshotPath = diffResult.fixedPath;
          result.diffScreenshotPath = diffResult.diffPath;
        }
        
        // 运行 Git 自动提交
        runGitCommit(session, feedbackId, result);
      })
      .catch((err) => {
        session.output.push({ type: 'system', text: `\n[系统] 视觉回归测试异常: ${err.message}\n` });
        runGitCommit(session, feedbackId, result);
      });
  } else {
    // 无需视觉回归，直接执行 Git 提交
    runGitCommit(session, feedbackId, result);
  }
}

// 自动 Git 提交处理
function runGitCommit(session, feedbackId, result) {
  const projectDir = session.project.path;
  const gitDir = path.join(projectDir, '.git');
  const row = db.prepare('SELECT description FROM feedbacks WHERE id = ?').get(feedbackId);
  const desc = row ? row.description : '';

  if (session.project.autoCommit && fs.existsSync(gitDir)) {
    const commitMsg = `fix(ai): 自动修复 #${feedbackId.slice(0, 8)} - ${desc}`;
    session.output.push({ type: 'system', text: `[系统] 正在自动提交代码: "${commitMsg}"...\n` });
    exec(`git add . && git commit -m "${commitMsg}"`, { cwd: projectDir }, (gitErr) => {
      if (gitErr) {
        session.output.push({ type: 'system', text: `[系统] 自动提交失败: ${gitErr.message}\n` });
        console.error('[Git] 自动提交失败:', gitErr.message);
      } else {
        session.output.push({ type: 'system', text: `[系统] 自动提交成功！\n` });
        console.log('[Git] 自动提交成功');
      }
      handleFixDone(session, feedbackId, result);
    });
  } else {
    if (session.project.autoCommit && !fs.existsSync(gitDir)) {
      session.output.push({ type: 'system', text: `[系统] 检测到目标项目不是 Git 仓库，跳过自动 Git 提交。\n` });
      console.log('[Git] 目标项目不是 Git 仓库，跳过自动 Git 提交');
    }
    handleFixDone(session, feedbackId, result);
  }
}

// 处理修复完成，检查队列
function handleFixDone(session, feedbackId, result) {
  session.status = 'done';
  session.result = result;
  session.childProcess = null;
  const log = session.output.map(o => o.text).join('');
  const status = result.success ? 'fixed' : 'failed';
  const finalInputTokens = session.inputTokens || 0;
  const finalOutputTokens = session.outputTokens || 0;
  const finalCostUsd = session.costUsd || 0;
  db.prepare(`
    UPDATE feedbacks SET status = ?, fix_success = ?, fix_diff = ?, fix_error = ?, fix_log = ?, fixed_at = ?, input_tokens = ?, output_tokens = ?, cost_usd = ? WHERE id = ?
  `).run(status, result.success ? 1 : 0, result.diff || '', result.error || '', log, new Date().toISOString(), finalInputTokens, finalOutputTokens, finalCostUsd, feedbackId);
  console.log(`[Fix] ${feedbackId} 修复${result.success ? '成功' : '失败'}`);

  // 成功时，保存至修复经验记忆库
  if (result.success) {
    const row = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(feedbackId);
    if (row) {
      memoryEngine.saveMemory(db, {
        feedbackId: row.id,
        description: row.description,
        category: row.category,
        diff: result.diff || '',
        summary: row.description
      });
    }
  }

  // 检查队列，如有待执行指令则自动继续
  if (session.pendingInstructions.length > 0) {
    const instruction = session.pendingInstructions.shift();
    console.log(`[Queue] ${feedbackId} 执行排队指令: ${instruction}`);
    runContinueFix(feedbackId, instruction, session);
  } else {
    setTimeout(() => { delete fixSessions[feedbackId]; }, 300000);
    // 处理队列中的下一个任务
    processNextInQueue();
  }
}

// 执行继续修复的核心逻辑
function runContinueFix(feedbackId, instruction, session, isAutoCorrection = false) {
  const row = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(feedbackId);
  if (!row) return;

  db.prepare('UPDATE feedbacks SET status = ? WHERE id = ?').run('approved', feedbackId);
  session.status = 'running';
  session.output = [];
  session.result = null;
  if (!isAutoCorrection) {
    session.autoRetriesCount = 0; // 手动继续修复时重置计数器
  }

  // 截取最后 100 行日志，避免 token 爆炸
  let logPreview = '(无执行日志)';
  if (row.fix_log) {
    const logLines = row.fix_log.split('\n');
    logPreview = logLines.slice(-100).join('\n');
    if (logLines.length > 100) {
      logPreview = `...(省略前 ${logLines.length - 100} 行)...\n` + logPreview;
    }
  }

  const fixDescription = [
    `【之前的修复记录（最后 100 行）】`,
    logPreview,
    ``,
    `【用户补充指令】`,
    instruction,
    ``,
    `请根据之前的修复尝试和用户的补充指令，继续修复这个问题。`,
    `注意：先读取相关代码确认之前的修改情况，再根据用户反馈进行调整。`
  ].join('\n');

  const stream = callClaudeFixStream(fixDescription, null, row.category, [], session.project.path, session.project.gitPaths);
  session.childProcess = stream.childProcess;

  stream.on('start', () => { session.output.push({ type: 'system', text: 'Claude Code 继续修复...\n' }); });
  stream.on('output', ({ text }) => { session.output.push({ type: 'output', text }); });
  stream.on('done', (result) => {
    session.inputTokens = (session.inputTokens || 0) + (result.inputTokens || 0);
    session.outputTokens = (session.outputTokens || 0) + (result.outputTokens || 0);
    session.costUsd = (session.costUsd || 0) + (result.costUsd || 0);
    // 继续修复直接结束，不做验证和评审
    session.output.push({ type: 'system', text: '\n[系统] 继续修复完成。\n' });
    handleFixDone(session, feedbackId, result);
  });
}

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${data}\n\n`);
}

// 静态文件
app.use('/screenshots', express.static(screenshotDir));

const distDir = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/screenshots')) {
      res.sendFile(path.join(distDir, 'index.html'));
    }
  });
}

app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n  Bug 反馈平台已启动`);
  console.log(`  端口: ${config.port}`);
  console.log(`  数据库: ${dbPath}`);
  console.log(`  默认管理员: admin / admin123`);
  console.log(`  反馈: http://localhost:${config.port}/`);
  console.log(`  审批: http://localhost:${config.port}/admin`);
  console.log(`  目标项目: ${config.targetProject}\n`);
});
