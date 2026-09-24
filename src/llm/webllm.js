/**
 * webllm.js —— 基于 WebLLM (Qwen2.5-0.5B-Instruct) 的端侧 AI 自由手绘手脚决策引擎
 *
 * 职责：
 *   - 初始化与管理端侧 WebGPU LLM 引擎（Web Worker 后台推理，杜绝物理主循环掉帧）
 *   - 动态构建精炼、聚焦单一地形目标的系统提示词，彻底避免大段多场景示例导致模型混淆
 *   - 强化手脚协调铁律：圆轮模式下手臂大小必须与腿轮匹配，严禁长直线手臂拖地卡死
 *   - 在 sanitizeLimbs 中进行手脚几何协调保护（圆轮模式下手臂展幅不得超过腿轮半径）
 */

import { SHOULDER, HIP } from '../constants.js';
import { resolveOptimalPose } from '../cpu.js';

/** 默认推荐模型：兼顾显存体积(约320MB)、加载速度与手绘指令遵循 */
export const DEFAULT_MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

let webllmEngine = null;
let isInitializing = false;
let initPromise = null;

/**
 * 检查当前浏览器是否支持 WebGPU
 */
export function isWebGPUSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
}

/**
 * 获取或按需初始化 WebLLM 引擎（单例模式，Web Worker 架构）
 * @param {Function} [onProgress] - 下载与编译进度回调 ({ progress: 0~1, text: string })
 */
export async function getOrInitWebLLMEngine(onProgress) {
  if (webllmEngine) return webllmEngine;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    isInitializing = true;
    try {
      const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
      const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

      webllmEngine = await CreateWebWorkerMLCEngine(
        worker,
        DEFAULT_MODEL_ID,
        {
          initProgressCallback: (report) => {
            if (typeof onProgress === 'function') {
              onProgress(report);
            }
          },
        }
      );
      return webllmEngine;
    } catch (err) {
      webllmEngine = null;
      throw err;
    } finally {
      isInitializing = false;
      initPromise = null;
    }
  })();

  return initPromise;
}

/** 地形类型中文对照映射 */
export const TERRAIN_ZH = {
  flat: '平地赛道',
  hills: '起伏坡度',
  stairs: '阶梯台阶',
  pits: '凹坑陷阱',
  bigpit: '大深坑障碍',
  hurdles: '连续跨栏',
  wall: '垂直高墙',
  climb: '高墙攀爬',
  tunnel: '低矮隧道',
  water: '深水水域',
  mud: '减速泥沼',
  ice: '光滑冰坡',
  sawtooth: '锯齿陷阱',
  wave: '连续大波浪',
  belt: '逆向传送带',
};

/** 各类地形的力学难点与最优解核心特征 */
export const TERRAIN_PHYSICS_HINTS = {
  stairs: '前方是连续垂直直角阶梯。力学难点：垂直直角会彻底阻挡圆轮前进并导致空转卡死；力学最优解：必须切换为长腿十字（long）或多齿轮齿形态，依靠齿爪勾住直角台阶棱角向上翻越。',
  pits: '前方是连续凹坑地形。力学难点：圆轮沉入坑底无法推进；力学最优解：使用长腿十字（long）或多折线横跨坑壁。',
  bigpit: '前方是大深坑障碍。力学难点：圆轮跌入深坑卡死；力学最优解：使用长腿十字（long）支撑跨越。',
  hurdles: '前方是连续凸起跨栏。力学难点：圆轮撞栏减速；力学最优解：使用长腿十字（long）跨过障碍。',
  wall: '前方是高耸垂直直立高墙。力学难点：墙面垂直无法滚动翻越；力学最优解：必须使用攀爬姿势（climb），手臂向前伸出超长抓钩折线大臂扒住墙头，拉动身躯翻越高墙。',
  climb: '前方是高耸垂直直立高墙。力学难点：必须有足够臂展扒住墙头；力学最优解：必须使用攀爬姿势（climb），超长手臂拉起赛车翻越。',
  tunnel: '前方是低矮天花板隧道。力学难点：天花板高度极低，任何长腿或大轮均会撞击天花板彻底卡死；力学最优解：必须使用微缩轮（small），将手脚收紧为贴地极矮微折线。',
  water: '前方是深水赛道。力学难点：深水浮力阻力；力学最优解：使用饱满大圆轮（round）划水推进效果最好。',
  mud: '前方是粘稠泥沼。力学难点：轮子陷入烂泥打滑；力学最优解：齿爪折线或长腿十字跨出泥潭。',
  sawtooth: '前方是密集锯齿。力学难点：锯齿尖端阻卡；力学最优解：长腿十字或轮齿爪咬合越障。',
  ice: '前方是极滑冰坡。力学难点：摩擦力骤降打滑；力学最优解：流线圆弧轮顺势滑行冲刺。',
  wave: '前方是连续大波浪。力学难点：波谷与波峰剧烈颠簸；力学最优解：大外径圆弧轮顺应坡度翻滚。',
  belt: '前方是逆向传送带。力学难点：反向牵引阻力；力学最优解：轮齿齿牙强力抓地反推。',
  flat: '前方是开阔平地。力学难点：追求极限直线速度；力学最优解：圆轮或圆弧轮滚阻最小、转速最快。',
  hills: '前方是连续起伏山丘坡度。力学难点：频繁爬坡冲坡；力学最优解：圆弧轮辐惯性大、低滚阻顺势冲锋。',
};

/**
 * 根据赛道地形与卡阻状态确定目标力学原型
 */
export function getTargetArchetype(currentSection, isStuck = false, hasSlope = false, inWater = false) {
  if (hasSlope || inWater) return 'round'; // 坡度或水中优先圆轮
  if (!currentSection) return 'round';
  const sec = String(currentSection).toLowerCase();
  if (sec.includes('tunnel')) return 'small';
  if (sec.includes('wall') || sec.includes('climb')) return 'climb';
  if (sec.includes('stair') || sec.includes('pit') || sec.includes('hurdle') || sec.includes('mud') || sec.includes('saw') || sec.includes('belt')) {
    return 'long';
  }
  if (isStuck) return 'long';
  return 'round';
}

/**
 * 构建精炼、聚焦当前目标的系统提示词
 */
export function buildLimbPrompt(params, legacyUpcoming) {
  let currentSection = 'flat';
  let targetSection = 'flat';
  let isStuck = false;
  let stuckCount = 0;
  let distToUpcoming = 0;
  let hasSlope = false;
  let slopeDesc = '平缓';
  let inWater = false;
  let inTunnel = false;
  let speed = 0;

  if (typeof params === 'object' && params !== null) {
    currentSection = params.currentSection || params.terrainDesc || 'flat';
    targetSection = params.targetSection || params.upcomingObstacle || currentSection;
    isStuck = Boolean(params.isStuck);
    stuckCount = Number(params.stuckCount) || 0;
    distToUpcoming = Number(params.distToUpcoming) || 0;
    hasSlope = Boolean(params.hasSlope);
    slopeDesc = params.slopeDesc || (hasSlope ? '明显起伏坡度' : '平缓');
    inWater = Boolean(params.inWater);
    inTunnel = Boolean(params.inTunnel);
    speed = Number(params.speed) || 0;
  } else {
    currentSection = params || 'flat';
    targetSection = legacyUpcoming || currentSection;
  }

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
  const activeKey = isStuck ? currKey : (targetKey || currKey);

  const currentZh = TERRAIN_ZH[currKey] || currKey;
  const targetZh = TERRAIN_ZH[targetKey] || targetKey;
  const physicsHint = TERRAIN_PHYSICS_HINTS[activeKey] || TERRAIN_PHYSICS_HINTS.flat;

  // 坡度场景实况
  let slopeSceneText = '';
  if (hasSlope || currKey === 'hills' || currKey === 'wave') {
    slopeSceneText = `⛰️ 当前路段有明显坡度（${slopeDesc}）！手和脚都绘制圆轮跑得最快！`;
  }

  // 水域场景实况
  let waterSceneText = '';
  if (inWater || currKey === 'water') {
    waterSceneText = `🌊 当前赛车正处于深水中！划水推进力最大、在水中跑得最快！`;
  }

  // 隧道场景实况
  let tunnelSceneText = (inTunnel || currKey === 'tunnel')
    ? '⚠️ 当前处于低矮天花板隧道内，天花板高度极低，手脚必须贴地微缩！'
    : '';

  let situationText = '';
  if (isStuck) {
    situationText = `⚠️ 严重危机：CPU 赛车当前在【${currentZh}】严重空转卡死（已重试第 ${stuckCount} 次）！必须根据力学难点立即重绘最优形态脱困！`;
  } else if (distToUpcoming > 0 && currKey !== targetKey) {
    situationText = `当前正在【${currentZh}】，前方 ${Math.round(distToUpcoming)} 像素处即将遭遇【${targetZh}】！`;
  } else {
    situationText = `正在通过【${currentZh}】。`;
  }

  return `你是顶级2D物理竞速AI赛车手。请根据当前赛道物理场景与障碍，完全自主做出力学分析并自由手绘手脚形态以击败对手。
肩关节起点: (150, 62)，髋关节起点: (150, 110)。画板尺寸与玩家画板完全一致为 宽 300 × 高 180，可用坐标范围严格限制在 X: [10, 290]，Y: [10, 170]。物理引擎会自动对每笔划做 180° 镜像构建对称双侧手脚。

【当前赛道物理场景】
- 实时战况：${situationText}
- 当前地形：【${currentZh}】，目标：【${targetZh}】
- 障碍难点与物理规律：${physicsHint}
${slopeSceneText ? `- 坡度实况：${slopeSceneText}\n` : ''}${waterSceneText ? `- 水域实况：${waterSceneText}\n` : ''}${tunnelSceneText ? `- 隧道实况：${tunnelSceneText}\n` : ''}- 当前车速：${Math.round(speed)} 像素/秒

【手绘尺寸与画布规范（与玩家画板完全保持一致）】
1. 画板尺寸与边界限制：画布尺寸为 宽 300 × 高 180，所有手脚坐标必须严格在 [10, 290] × [10, 170] 范围内，严禁超出边界。
2. 尺寸大胆拉大，充分利用画板空间：
   - 形状拉大：圆轮、直线、大弧度、大摆臂尽量往大画，大尺寸手脚具备更强悍的越障抓地力、翻越力与通过速度！
   - 圆轮与圆弧：半径可大胆放大到 45~58 像素（例如 X 延伸至 95~205，Y 深入至 160~168），大轮跑得快且不易卡坑！
   - 直线与大跨度肢体：展幅可拉伸到 60~110 像素（例如 X 延伸至 220~270，Y 达 160~170），大跨度长腿可轻松横跨连续大坑！
   - 严禁画超微型手脚（如半径仅 15~20px），太小会导致赛车动力不足卡死。
3. 极高创造自由度：完全不受任何固定模版限制！你可以自由手绘任意创新形态——连续折线、多关节爪齿、流线大弧线、旋转大桨叶、不对称多边形轮、强力杠杆或支柱，尽情发挥你对2D力学的无限想象力。
4. 手脚尺寸协调：手臂与腿部尺寸比例协调（手臂整体展幅不要大于腿部支撑半径导致拖地顶翻赛车）；若不需要手臂可将 arm 设为空 []。
5. 关键点细腻丰富：每个笔划建议包含 3 到 10 个关键点，精细勾勒出具有机械美感与推进力的轮廓。
6. 严格输出纯 JSON，严禁输出任何 markdown 格式或额外文字：
{
  "thought": "【战术形态名称】说明你的大尺寸手绘力学构想（20字以内）",
  "arm": [
    [{"x": 150, "y": 62}, ...]
  ],
  "leg": [
    [{"x": 150, "y": 110}, ...]
  ]
}`;
}

/**
 * 坐标清洗与手脚几何协调保护函数
 *
 * 保证：
 * 1. 坐标严格钳制在 [10, 290] x [10, 170]
 * 2. 笔划有效连接到对应关节
 * 3. 过滤重复点与无效 NaN
 * 4. 关键协调保护：在圆轮模式下，手臂最大展幅自动约束不超过腿部圆轮半径，防止长直线手臂拖地阻碍翻越
 * 5. 在长腿模式下，手臂自动清除向下拖地部分，集中动力翻越
 */
export function sanitizeLimbs(rawLimbs, targetArchetype = 'round') {
  const sanitizeStroke = (pts, joint) => {
    if (!Array.isArray(pts) || pts.length === 0) return null;

    const cleaned = [];
    for (const p of pts) {
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
      if (!isFinite(p.x) || !isFinite(p.y)) continue;
      const cx = Math.max(10, Math.min(290, p.x));
      const cy = Math.max(10, Math.min(170, p.y));
      const pt = { x: Number(cx.toFixed(1)), y: Number(cy.toFixed(1)) };
      if (cleaned.length > 0) {
        const last = cleaned[cleaned.length - 1];
        if (Math.hypot(pt.x - last.x, pt.y - last.y) < 1.0) continue;
      }
      cleaned.push(pt);
    }

    if (cleaned.length === 0) return null;

    // 确保起点在关节附近（距离小于 35px），若偏远则前置关节
    const d0 = Math.hypot(cleaned[0].x - joint.x, cleaned[0].y - joint.y);
    if (d0 > 35) {
      cleaned.unshift({ x: joint.x, y: joint.y });
    }

    // 确保至少有 2 个有效点形成线条
    if (cleaned.length === 1) {
      cleaned.push({ x: cleaned[0].x + 15, y: cleaned[0].y + 15 });
    }

    return cleaned;
  };

  let armStrokes = (Array.isArray(rawLimbs?.arm) ? rawLimbs.arm : [])
    .map(s => sanitizeStroke(s, SHOULDER))
    .filter(Boolean);

  let legStrokes = (Array.isArray(rawLimbs?.leg) ? rawLimbs.leg : [])
    .map(s => sanitizeStroke(s, HIP))
    .filter(Boolean);

  // 隧道限高特殊保护：若处于隧道，仅钳制天花板高度防撞顶
  if (targetArchetype === 'small') {
    armStrokes = armStrokes.map(s => s.map(p => ({ x: p.x, y: Math.min(82, p.y) })));
    legStrokes = legStrokes.map(s => s.map(p => ({ x: p.x, y: Math.min(132, p.y) })));
  }

  // 若 leg 完全为空，提供基础手绘以防物理引擎无支撑
  if (legStrokes.length === 0) {
    if (targetArchetype === 'long') {
      legStrokes = [[
        { x: HIP.x, y: HIP.y },
        { x: HIP.x, y: 178 },
        { x: HIP.x, y: HIP.y },
        { x: 218, y: HIP.y },
      ]];
    } else {
      legStrokes.push([
        { x: HIP.x, y: HIP.y },
        { x: HIP.x + 35, y: HIP.y + 35 },
        { x: HIP.x, y: HIP.y + 45 },
      ]);
    }
  }

  // ─── 手脚尺寸几何协调保护（防止手臂是直线且长于脚的圆轮半径导致拖地阻碍翻越） ───
  if (targetArchetype === 'round' && legStrokes.length > 0 && armStrokes.length > 0) {
    let maxLegR = 0;
    for (const stroke of legStrokes) {
      for (const p of stroke) {
        maxLegR = Math.max(maxLegR, Math.hypot(p.x - HIP.x, p.y - HIP.y));
      }
    }
    if (maxLegR < 15) maxLegR = 55;
    // 约束手臂任意点相对肩关节的距离不能超过腿部圆轮半径 maxLegR
    armStrokes = armStrokes.map(stroke => stroke.map(p => {
      const dx = p.x - SHOULDER.x;
      const dy = p.y - SHOULDER.y;
      const r = Math.hypot(dx, dy);
      if (r > maxLegR) {
        const factor = maxLegR / r;
        return {
          x: Number((SHOULDER.x + dx * factor).toFixed(1)),
          y: Number((SHOULDER.y + dy * factor).toFixed(1)),
        };
      }
      return p;
    }));
  } else if (targetArchetype === 'long') {
    // 阶梯台阶等障碍：手臂允许向下伸展，仅需确保不严重超出腿部下探深度导致整车倒栽
    const maxLegY = legStrokes.reduce((max, s) => Math.max(max, ...s.map(p => p.y)), HIP.y);
    armStrokes = armStrokes.map(stroke => stroke.filter(p => p.y <= maxLegY + 15)).filter(s => s.length >= 2);
  }

  return {
    arm: armStrokes,
    leg: legStrokes,
    thought: rawLimbs?.thought || 'AI 实时自主手绘手脚',
  };
}

/**
 * 调用 Qwen2.5-0.5B-Instruct 端侧大模型自主绘制手脚
 */
export async function generateLimbsWithQwen(params) {
  const engine = await getOrInitWebLLMEngine(params?.onProgress);
  const prompt = buildLimbPrompt(params);

  const completion = await engine.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: '你是一位极具创造力与力学工程直觉的顶级2D竞速AI赛车手。画板尺寸与玩家完全一致为 宽 300 × 高 180（坐标范围严格在 X: [10, 290], Y: [10, 170] 内）。绘制手脚时，圆轮、直线、弧度请充分拉大、饱满（圆轮半径建议 45~58px，直线与大臂展幅建议 60~110px），大尺寸具备更强大的动力与越障通过性。手脚尺寸协调不拖地，坐标严禁超出画板边界，以纯JSON输出。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.7,
    max_tokens: 480,
  });

  const rawText = completion.choices[0]?.message?.content || '{}';
  const cleanJsonText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

  let parsed = null;
  try {
    parsed = JSON.parse(cleanJsonText);
  } catch {
    const firstBrace = cleanJsonText.indexOf('{');
    const lastBrace = cleanJsonText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(cleanJsonText.slice(firstBrace, lastBrace + 1));
      } catch (e2) {
        console.warn('Qwen JSON 提取解析失败:', e2, rawText);
      }
    }
  }

  const targetArchetype = getTargetArchetype(
    params?.currentSection || params?.terrainDesc,
    params?.isStuck,
    params?.hasSlope,
    params?.inWater
  );
  return sanitizeLimbs(parsed, targetArchetype);
}

/**
 * 格式化 Qwen 决策思路展示在 UI 上
 */
export function formatThoughtForHud(thought) {
  if (!thought) return '正在根据地形规划手绘形态...';
  return thought.length > 50 ? thought.slice(0, 48) + '...' : thought;
}
