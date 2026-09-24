/**
 * src/llm/webllm.js —— WebLLM Qwen2.5-0.5B 端侧大模型接入与自主手绘模块
 *
 * 职责：
 *   - 通过 Web Worker 异步初始化与运行 Qwen2.5-0.5B-Instruct-q4f16_1-MLC 模型
 *   - 向模型发送赛道与力学环境，由模型自主生成手臂与腿部画笔点列
 *   - 提供完备的坐标清洗与平滑插值（Sanitizer），杜绝物理引擎 NaN
 *   - 提供 WebGPU 检测与下载进度回调
 */

import { SHOULDER, HIP } from '../constants.js';
import { TERRAIN_ZH, TERRAIN_PHYSICS_HINTS } from '../typesafe.js';

export const QWEN_MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

let engine = null;
let engineInitPromise = null;

/** 检测当前浏览器是否支持 WebGPU */
export function isWebGPUSupported() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/**
 * 初始化或获取已加载的 WebLLM 引擎单例
 * @param {function} [onProgress] - 进度回调 ({ text, progress }) => void
 * @returns {Promise<any>} WebWorkerMLCEngine 实例
 */
export async function getOrInitWebLLMEngine(onProgress) {
  if (engine) return engine;
  if (engineInitPromise) return engineInitPromise;

  if (!isWebGPUSupported()) {
    throw new Error('当前浏览器未启用 WebGPU，请使用最新版本的 Chrome、Edge 或 Safari 18+');
  }

  engineInitPromise = (async () => {
    // 动态引入 @mlc-ai/web-llm，实现按需代码分割（不影响规则模式和 Jev 模式初始加载）
    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');

    // 实例化独立 Worker
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      type: 'module',
    });

    // 创建 Web Worker 引擎
    const newEngine = await CreateWebWorkerMLCEngine(worker, QWEN_MODEL_ID, {
      initProgressCallback: (report) => {
        if (typeof onProgress === 'function') {
          onProgress(report);
        }
      },
    });

    engine = newEngine;
    return engine;
  })();

  try {
    return await engineInitPromise;
  } catch (err) {
    engineInitPromise = null;
    throw err;
  }
}

// ─── 提示词与手绘点列生成 ──────────────────────────────────────────

/**
 * 组装发送给 Qwen 的提示词（强调力学唯一最优解与击败玩家）
 */
export function buildLimbPrompt(params, legacyUpcoming) {
  let currentSection = 'flat';
  let targetSection = 'flat';
  let isStuck = false;
  let stuckCount = 0;
  let distToUpcoming = 0;

  if (typeof params === 'string') {
    currentSection = params;
    targetSection = legacyUpcoming || params;
  } else if (params && typeof params === 'object') {
    currentSection = params.currentSection || params.terrainDesc || 'flat';
    targetSection = params.targetSection || params.upcomingObstacle || currentSection;
    isStuck = Boolean(params.isStuck);
    stuckCount = Number(params.stuckCount) || 0;
    distToUpcoming = Number(params.distToUpcoming) || 0;
  }

  // 匹配标准地形 key
  const matchKey = (val) => {
    if (!val || typeof val !== 'string') return 'flat';
    for (const k of Object.keys(TERRAIN_PHYSICS_HINTS)) {
      if (val === k || val.includes(k) || (TERRAIN_ZH[k] && val.includes(TERRAIN_ZH[k]))) {
        return k;
      }
    }
    return 'flat';
  };

  const currKey = matchKey(currentSection);
  const targetKey = matchKey(targetSection);
  // 当卡住时以当前卡阻地形为主；平时若前方有即将到达的障碍，以即将遭遇的障碍为主
  const activeKey = isStuck ? currKey : (targetKey || currKey);

  const currentZh = TERRAIN_ZH[currKey] || currKey;
  const targetZh = TERRAIN_ZH[targetKey] || targetKey;
  const physicsHint = TERRAIN_PHYSICS_HINTS[activeKey] || TERRAIN_PHYSICS_HINTS.flat;

  let situationText = '';
  if (isStuck) {
    situationText = `⚠️ 严重危机：CPU 赛车当前在【${currentZh}】严重空转卡死（已重试第 ${stuckCount} 次）！常规圆轮已彻底卡死，必须根据力学难点立即重绘极端长腿或超长手臂翻越脱困！`;
  } else if (distToUpcoming > 0 && currKey !== targetKey) {
    situationText = `⚠️ 临近路况：当前正在【${currentZh}】，前方 ${Math.round(distToUpcoming)} 像素处即将遭遇【${targetZh}】！必须提前变形手绘最优破障形态！`;
  } else {
    situationText = `当前赛道路况：正在通过【${currentZh}】赛道区域。`;
  }

  return `你是顶级2D物理竞速AI赛车手。你肩负唯一使命：根据赛道力学深度诊断，手绘出【唯一力学最优解】的车身肢体点列，以压倒性的动力学优势击败人类玩家！

【实时战报与现场力学深度诊断】
- 战况：${situationText}
- 力学难点与最优解：${physicsHint}

【画布几何与力学物理约束】
- 画布宽 300px，高 180px。
- 肩关节中心坐标：x = 150, y = 62（手臂起点）。
- 髋关节中心坐标：x = 150, y = 110（腿部起点）。
- 物理引擎会自动对每条笔划做 180° 对称镜像，构建对称的双侧车轮/四肢。

【力学最优解对应坐标方案指南】
1. 阶梯/连续凹坑/大深坑/跨栏/逆向传送带/泥浆沼泽/锯齿 (stairs/pits/bigpit/hurdles/belt/mud/sawtooth) 或卡阻脱困：
   - 必杀最优解：长腿十字（long）！手臂为空（arm: []），腿部手绘长腿十字以勾住棱角拉动身躯向上翻越跨障。
   - 推荐点列：
     arm: []
     leg: [ [{"x": 150, "y": 110}, {"x": 150, "y": 178}, {"x": 150, "y": 110}, {"x": 218, "y": 110}] ]

2. 垂直高墙/攀岩 (wall/climb)：
   - 必杀最优解：攀爬抓地姿势（climb）！超长手臂（长度达 90px 以上）扒住高墙顶端拉动翻越，腿部保持微轮紧凑跟随。
   - 推荐点列：
     arm: [ [{"x": 150, "y": 62}, {"x": 248, "y": 62}] ]
     leg: [ [{"x": 150, "y": 110}, {"x": 166, "y": 120}, {"x": 150, "y": 130}] ]

3. 低矮天花板隧道 (tunnel)：
   - 必杀最优解：微缩轮（small）！手臂与腿部半径均严格控制在 20px 以内，紧贴地面疾驰，绝不碰顶。
   - 推荐点列：
     arm: [ [{"x": 150, "y": 62}, {"x": 165, "y": 68}, {"x": 150, "y": 76}] ]
     leg: [ [{"x": 150, "y": 110}, {"x": 165, "y": 118}, {"x": 150, "y": 126}] ]

4. 开阔平地/起伏丘陵/颠簸路面/大波浪/水池划水/冰坡 (flat/hills/bumps/wave/water/ice/cliff/steep)：
   - 必杀最优解：饱满大圆轮（round）！滚动阻力极小，高转速冲刺，水池划水推力最高。
   - 推荐点列：
     arm: [ [{"x": 150, "y": 62}, {"x": 175, "y": 72}, {"x": 160, "y": 88}, {"x": 125, "y": 62}] ]
     leg: [ [{"x": 150, "y": 110}, {"x": 185, "y": 130}, {"x": 160, "y": 150}, {"x": 115, "y": 110}] ]

【严格输出格式】
必须直接输出合法的纯 JSON 字符串，严禁输出任何 markdown 格式代码块或解释废话：
{
  "thought": "【战术名称】力学原理简述（20字以内）",
  "arm": [
    [{"x": 150, "y": 62}, ...]
  ],
  "leg": [
    [{"x": 150, "y": 110}, ...]
  ]
}`;
}

/**
 * 坐标清洗与安全平滑函数
 *
 * 保证：
 * 1. 坐标严格钳制在 [10, 290] x [10, 170]
 * 2. 笔划有效连接到对应关节
 * 3. 过滤重复点与无效 NaN
 */
export function sanitizeLimbs(rawLimbs) {
  const sanitizeStroke = (pts, joint) => {
    if (!Array.isArray(pts) || pts.length === 0) return null;

    const cleaned = [];
    for (const p of pts) {
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
      if (!isFinite(p.x) || !isFinite(p.y)) continue;
      // 钳制在有效画布范围内
      const cx = Math.max(10, Math.min(290, p.x));
      const cy = Math.max(10, Math.min(170, p.y));
      cleaned.push({ x: Number(cx.toFixed(1)), y: Number(cy.toFixed(1)) });
    }

    if (cleaned.length === 0) return null;

    // 确保起点在关节附近（距离小于 35px），若偏远则前置关节
    const d0 = Math.hypot(cleaned[0].x - joint.x, cleaned[0].y - joint.y);
    if (d0 > 35) {
      cleaned.unshift({ x: joint.x, y: joint.y });
    }

    // 确保至少有 2 个有效点
    if (cleaned.length === 1) {
      cleaned.push({ x: cleaned[0].x + 15, y: cleaned[0].y + 15 });
    }

    return cleaned;
  };

  const armStrokes = (Array.isArray(rawLimbs?.arm) ? rawLimbs.arm : [])
    .map(s => sanitizeStroke(s, SHOULDER))
    .filter(Boolean);

  const legStrokes = (Array.isArray(rawLimbs?.leg) ? rawLimbs.leg : [])
    .map(s => sanitizeStroke(s, HIP))
    .filter(Boolean);

  // 如果 leg 为空，至少给一个默认腿以避免物理引擎完全无法移动
  if (legStrokes.length === 0) {
    legStrokes.push([
      { x: HIP.x, y: HIP.y },
      { x: HIP.x + 35, y: HIP.y + 35 },
      { x: HIP.x, y: HIP.y + 45 },
    ]);
  }

  return {
    arm: armStrokes,
    leg: legStrokes,
    thought: rawLimbs?.thought || 'AI 实时自主手绘手脚',
  };
}

/**
 * 调用 Qwen2.5-0.5B-Instruct 端侧大模型自主绘制手脚
 *
 * @param {object} params
 * @param {object} params
 * @param {string} [params.currentSection] - 当前地形类型（如"stairs"）
 * @param {string} [params.targetSection]  - 目标地形类型（如"wall"）
 * @param {string} [params.terrainDesc]    - 兼容字段：当前地形描述
 * @param {string} [params.upcomingObstacle] - 兼容字段：前方障碍描述
 * @param {boolean} [params.isStuck]       - 是否处于卡死停滞状态
 * @param {number} [params.stuckCount]     - 卡阻重试次数
 * @param {number} [params.distToUpcoming] - 距离前方障碍距离
 * @param {function} [params.onProgress]   - 加载进度回调
 * @returns {Promise<{ arm: object[][], leg: object[][], thought: string }>}
 */
export async function generateLimbsWithQwen(params = {}) {
  const modelEngine = await getOrInitWebLLMEngine(params.onProgress);

  const prompt = buildLimbPrompt(params);

  const completion = await modelEngine.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: '你是一个追求极致竞速与力学克制的顶级2D物理赛跑AI赛车手。你的唯一宗旨是：根据地形状况与力学深度诊断，在画板上手绘出【唯一物理力学最优解】点列，以压倒性的动力学优势击败人类玩家！你严格只输出纯 JSON 数据，不得带有任何 markdown 代码块或解释废话。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.25,
    max_tokens: 380,
  });

  const reply = completion.choices[0]?.message?.content?.trim() || '';

  // 提取 JSON
  let parsed = null;
  try {
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.warn('Qwen 手绘 JSON 解析失败，回退到基础清洗:', err);
  }

  return sanitizeLimbs(parsed);
}
