const { v4: uuidv4 } = require('uuid');
const embeddingEngine = require('./embeddingEngine');

// 简易中英文混合分词器 (Bi-gram + 英文单词分词)
function tokenize(text) {
  if (!text) return [];
  const words = [];
  const clean = text.toLowerCase();
  
  // 1. 提取英文单词和数字
  const engMatches = clean.match(/[a-z0-9\-_]+/g) || [];
  words.push(...engMatches);
  
  // 2. 提取中文字符串并做二元切分 (Bi-gram)
  const chineseBlocks = clean.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const block of chineseBlocks) {
    if (block.length === 1) {
      words.push(block);
    } else {
      for (let i = 0; i < block.length - 1; i++) {
        words.push(block.slice(i, i + 2));
      }
    }
  }
  return words;
}

// 异步保存修复记忆（含语义特征计算）
async function saveMemory(db, { feedbackId, description, category, diff, summary }) {
  try {
    const id = uuidv4();
    const cleanDiff = diff || '';
    const cleanSummary = summary || '';
    
    // 异步生成特征向量（如果模型还没加载完或失败，会自动降为 null，数据库存 null 即可）
    const embedding = await embeddingEngine.getEmbedding(description);
    const embeddingStr = embedding ? JSON.stringify(embedding) : null;
    
    const existing = db.prepare('SELECT id FROM memories WHERE feedback_id = ?').get(feedbackId);
    
    if (existing) {
      db.prepare(`
        UPDATE memories 
        SET description = ?, category = ?, diff = ?, summary = ?, embedding = ?, created_at = ? 
        WHERE feedback_id = ?
      `).run(description.trim(), category, cleanDiff, cleanSummary, embeddingStr, new Date().toISOString(), feedbackId);
      console.log(`[Memory] 更新记忆 (含向量): ${feedbackId}`);
    } else {
      db.prepare(`
        INSERT INTO memories (id, feedback_id, description, category, diff, summary, embedding, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, feedbackId, description.trim(), category, cleanDiff, cleanSummary, embeddingStr, new Date().toISOString());
      console.log(`[Memory] 新增记忆 (含向量): ${feedbackId}`);
    }
    return true;
  } catch (err) {
    console.error('[Memory] 保存失败:', err.message);
    return false;
  }
}

// 语义特征 RAG 主检索逻辑（带有 TF-IDF 倒退兜底）
async function findSimilarMemories(db, query, limit = 2) {
  try {
    // 1. 尝试计算查询的语义向量
    const queryVector = await embeddingEngine.getEmbedding(query);
    
    if (queryVector) {
      console.log('[RAG] 使用本地 ONNX 语义向量引擎检索...');
      const memories = db.prepare('SELECT * FROM memories').all();
      
      const scoredMemories = [];
      for (const memo of memories) {
        let docVector = null;
        if (memo.embedding) {
          try { docVector = JSON.parse(memo.embedding); } catch (e) {}
        }
        
        // 防御性策略：对数据库中尚未算过向量的老旧存量记忆，现场补充计算并存回
        if (!docVector) {
          docVector = await embeddingEngine.getEmbedding(memo.description);
          if (docVector) {
            db.prepare('UPDATE memories SET embedding = ? WHERE feedback_id = ?')
              .run(JSON.stringify(docVector), memo.feedback_id);
          }
        }
        
        if (docVector) {
          const score = embeddingEngine.cosineSimilarity(queryVector, docVector);
          scoredMemories.push({ memo, score });
        }
      }
      
      // 过滤掉向量夹角余弦低于 0.4 的并按相似度降序排序
      return scoredMemories
        .filter(item => item.score > 0.4)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => item.memo);
    }
  } catch (err) {
    console.warn('[RAG] 本地向量特征提取失败，自动降级为 TF-IDF 分词引擎:', err.message);
  }
  
  // 2. 兜底回退至 TF-IDF 分词匹配
  console.log('[RAG] 正在使用 TF-IDF 分词匹配进行兜底检索...');
  return findSimilarMemoriesTFIDF(db, query, limit);
}

// 备用兜底检索 (TF-IDF 余弦相似度)
function findSimilarMemoriesTFIDF(db, query, limit = 2) {
  try {
    const memories = db.prepare('SELECT * FROM memories').all();
    if (memories.length === 0) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const totalDocs = memories.length;
    const docFreqs = {};
    const allDocTokens = memories.map(memo => tokenize(memo.description + ' ' + memo.category));
    
    allDocTokens.forEach(tokens => {
      const uniqueTokens = new Set(tokens);
      uniqueTokens.forEach(t => {
        docFreqs[t] = (docFreqs[t] || 0) + 1;
      });
    });

    const idfs = {};
    for (const token in docFreqs) {
      idfs[token] = Math.log(totalDocs / (docFreqs[token] + 1)) + 1;
    }

    const queryVector = {};
    queryTokens.forEach(t => {
      const tf = queryTokens.filter(x => x === t).length / queryTokens.length;
      const idf = idfs[t] || 1;
      queryVector[t] = tf * idf;
    });

    const scoredMemories = memories.map((memo, idx) => {
      const docTokens = allDocTokens[idx];
      if (docTokens.length === 0) return { memo, score: 0 };

      const docVector = {};
      const uniqueDocTokens = new Set(docTokens);
      uniqueDocTokens.forEach(t => {
        const tf = docTokens.filter(x => x === t).length / docTokens.length;
        const idf = idfs[t] || 1;
        docVector[t] = tf * idf;
      });

      let dotProduct = 0;
      let queryNorm = 0;
      let docNorm = 0;

      for (const t in queryVector) {
        dotProduct += (queryVector[t] || 0) * (docVector[t] || 0);
        queryNorm += Math.pow(queryVector[t], 2);
      }
      for (const t in docVector) {
        docNorm += Math.pow(docVector[t], 2);
      }

      const score = queryNorm && docNorm ? dotProduct / (Math.sqrt(queryNorm) * Math.sqrt(docNorm)) : 0;
      return { memo, score };
    });

    return scoredMemories
      .filter(item => item.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.memo);

  } catch (err) {
    console.error('[Memory] TF-IDF 检索失败:', err.message);
    return [];
  }
}

module.exports = { saveMemory, findSimilarMemories };
