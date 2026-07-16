const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('./config.json');

/**
 * CodeGraph 集成模块
 * 以 MCP 服务器方式让 Claude Code 直接使用 CodeGraph 的代码图谱能力
 *
 * 安装: npx @colbymchenry/codegraph --yes
 * 索引: cd 目标项目 && codegraph init -i
 */

const CG_PACKAGE = '@colbymchenry/codegraph';

/**
 * 查找 codegraph 可执行文件
 */
function findCodeGraphBin() {
  const paths = [
    'codegraph',
    path.join(os.homedir(), '.npm-global', 'bin', 'codegraph'),
    path.join(os.homedir(), '.local', 'bin', 'codegraph'),
    '/usr/local/bin/codegraph',
    '/opt/homebrew/bin/codegraph'
  ];

  for (const p of paths) {
    try {
      execSync(`"${p}" --version 2>/dev/null`, { stdio: 'pipe' });
      return p;
    } catch {
      continue;
    }
  }

  // 最后尝试 npx
  try {
    execSync(`npx ${CG_PACKAGE} --version`, { stdio: 'pipe', timeout: 30000 });
    return `npx ${CG_PACKAGE}`;
  } catch {
    return null;
  }
}

/**
 * 检查 CodeGraph 是否已安装并可用
 */
function isInstalled() {
  return findCodeGraphBin() !== null;
}

/**
 * 检查目标项目是否已构建 CodeGraph 索引
 */
function isIndexed(projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) return false;
  const indexDir = path.join(projectDir, '.codegraph');
  // .codegraph 目录下应有 index/ 或 index.db
  const contents = fs.existsSync(indexDir) ? fs.readdirSync(indexDir) : [];
  return contents.length > 0;
}

/**
 * 获取 CodeGraph MCP 配置文件路径
 */
function getMcpConfig() {
  const bin = findCodeGraphBin();
  const baseDataDir = config.dataDir || path.join(__dirname, 'data');
  const mcpFile = path.join(baseDataDir, '.codegraph-mcp.json');

  if (!fs.existsSync(mcpFile)) {
    fs.mkdirSync(path.dirname(mcpFile), { recursive: true });

    const cmd = bin || 'codegraph';
    const args = bin && bin.startsWith('npx')
      ? ['-y', CG_PACKAGE, 'mcp']
      : ['mcp'];

    const serverConfig = bin && bin.startsWith('npx')
      ? { command: 'npx', args: ['-y', CG_PACKAGE, 'mcp'] }
      : { command: bin || 'codegraph', args: ['mcp'] };

    fs.writeFileSync(mcpFile, JSON.stringify({
      mcpServers: {
        codegraph: serverConfig
      }
    }));
  }

  return mcpFile;
}

module.exports = { isInstalled, isIndexed, getMcpConfig };
