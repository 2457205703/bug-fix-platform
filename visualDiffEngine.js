const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');

// 辅助函数：读取并解析 PNG 文件，返回 PNG 实例与 buffer 描述
function readPNG(filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    
    const png = new PNG();
    png.parse(stream, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// 辅助函数：将图片尺寸调整为统一大小，以防 pixelmatch 因宽高度不一致抛出异常
function resizeToMatch(img1, img2) {
  const width = Math.max(img1.width, img2.width);
  const height = Math.max(img1.height, img2.height);

  const newImg1 = new PNG({ width, height });
  const newImg2 = new PNG({ width, height });

  // 用全白底色填充（或全透明，这里用全透明）
  PNG.bitblt(img1, newImg1, 0, 0, img1.width, img1.height, 0, 0);
  PNG.bitblt(img2, newImg2, 0, 0, img2.width, img2.height, 0, 0);

  return { img1: newImg1, img2: newImg2, width, height };
}

/**
 * 视觉回归对比核心接口
 * @param {Object} feedback - 反馈记录
 * @param {String} dataDir - 平台的数据目录
 * @param {String} projectUrl - 目标项目本地运行 URL (如 http://localhost:5173)
 * @returns {Promise<{fixedPath: String, diffPath: String, error: String}>}
 */
async function captureAndCompare(feedback, dataDir, projectUrl) {
  let browser = null;
  try {
    const urlPath = feedback.urlPath || '';
    const originRelPath = feedback.screenshotPath;
    
    if (!originRelPath) {
      return { error: '未提供原始 Bug 截图' };
    }

    const originFullPath = path.join(dataDir, originRelPath.replace(/^\/screenshots\//, 'screenshots/'));
    if (!fs.existsSync(originFullPath)) {
      return { error: `原始 Bug 截图不存在: ${originFullPath}` };
    }

    // 1. 使用 Playwright 截取修复后的页面
    console.log(`[VisualDiff] 启动浏览器访问: ${projectUrl}${urlPath}`);
    
    // 自适应重用本地已安装的 Chrome / Edge，避免在国内网络下干等 Playwright 170M 浏览器下载
    const launchOptions = { headless: true };
    const possiblePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        launchOptions.executablePath = p;
        console.log(`[VisualDiff] 检测到本机已安装浏览器，重用路径进行截图: ${p}`);
        break;
      }
    }

    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage();
    
    // 设置适当的视口大小，尽量贴合常规截图
    await page.setViewportSize({ width: 1280, height: 800 });
    
    // 访问页面，等待网络空闲或一定延时以确保渲染完成
    await page.goto(`${projectUrl}${urlPath}`, { timeout: 15000, waitUntil: 'networkidle' });
    await page.waitForTimeout(2000); // 额外等待 Vue 渲染与动画结束

    const fixedFileName = `fixed_${feedback.id}.png`;
    const fixedFullPath = path.join(dataDir, 'screenshots', fixedFileName);
    
    // 全屏或当前视口截图
    await page.screenshot({ path: fixedFullPath, fullPage: false });
    await browser.close();
    browser = null;

    console.log(`[VisualDiff] 修复后截图已保存: ${fixedFullPath}`);

    // 2. 使用 pixelmatch 对比两张截图的像素差异
    const originPng = await readPNG(originFullPath);
    const fixedPng = await readPNG(fixedFullPath);

    // 大小对齐防御保护
    const { img1, img2, width, height } = resizeToMatch(originPng, fixedPng);

    const diffPng = new PNG({ width, height });
    
    const numDiffPixels = pixelmatch(
      img1.data,
      img2.data,
      diffPng.data,
      width,
      height,
      { threshold: 0.1, includeAA: true }
    );

    const diffFileName = `diff_${feedback.id}.png`;
    const diffFullPath = path.join(dataDir, 'screenshots', diffFileName);

    // 保存 Diff 截图
    await new Promise((resolve, reject) => {
      const outStream = fs.createWriteStream(diffFullPath);
      diffPng.pack().pipe(outStream);
      outStream.on('finish', resolve);
      outStream.on('error', reject);
    });

    console.log(`[VisualDiff] 对比完成, 差异像素数: ${numDiffPixels}, Diff 图已保存: ${diffFullPath}`);

    return {
      fixedPath: `/screenshots/${fixedFileName}`,
      diffPath: `/screenshots/${diffFileName}`
    };

  } catch (err) {
    console.error('[VisualDiff] 执行失败:', err.message);
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    return { error: `视觉回归校验失败: ${err.message}` };
  }
}

module.exports = { captureAndCompare };
