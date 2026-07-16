let pipelinePromise = null;
let extractor = null;

// 异步初始化模型单例
async function getExtractor() {
  if (extractor) return extractor;
  if (!pipelinePromise) {
    console.log('[Embedding] 正在初始化本地语义特征提取模型 (Xenova/bge-small-zh-v1.5)...');
    // 使用动态导入规避未安装时的加载崩溃
    const { pipeline } = await import('@xenova/transformers');
    pipelinePromise = pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', {
      // 默认缓存到 ~/.cache/huggingface
      progress_callback: (info) => {
        if (info.status === 'progress') {
          console.log(`[Embedding] 下载进度: ${info.file} - ${Math.round(info.progress)}%`);
        }
      }
    });
  }
  extractor = await pipelinePromise;
  console.log('[Embedding] 本地 ONNX 语义特征提取模型初始化成功！已开启 100% 离线检索。');
  return extractor;
}

/**
 * 获取一段文本的 512 维特征向量
 * @param {String} text - 输入文本
 * @returns {Promise<Array<Number>|null>}
 */
async function getEmbedding(text) {
  try {
    const model = await getExtractor();
    // 运行模型推断，设置 pooling 与 normalize 选项
    const output = await model(text, { pooling: 'mean', normalize: true });
    
    // 从 Tensor 结构中解构出原始一维 JS Array 数组
    const embedding = Array.from(output.data);
    return embedding;
  } catch (err) {
    console.error('[Embedding] 生成特征向量失败:', err.message);
    return null;
  }
}

/**
 * 计算两个高维向量的余弦相似度
 * @param {Array<Number>} vecA 
 * @param {Array<Number>} vecB 
 * @returns {Number}
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return normA && normB ? dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

module.exports = {
  getEmbedding,
  cosineSimilarity,
  // 提前预加载模型
  preload: getExtractor
};
