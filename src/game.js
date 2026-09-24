/**
 * game.js —— 游戏主循环模块
 *
 * 职责：
 *   - 初始化并管理游戏状态（racing, player, cpu, result, stage）
 *   - 运行固定时间步长物理循环
 *   - 检测胜负条件
 *   - 响应 HUD 按钮点击（重试/下一关/分享）
 *   - 连接画板（Drawpad）、物理引擎、渲染器
 */

import { buildCourse, terrain, waterLevel, surfaceAt, ceiling, terrainIndex, POOL, STAGES, STAGE_NAMES } from './terrain.js';
import { stepBody } from './physics.js';
import { makeBody, replaceBody, placeAtStart } from './body.js';
import { CPU_ROUND, CPU_POSES, cpuPlanIndex, resolveOptimalPose } from './cpu.js';
import { render, drawBody } from './renderer.js';
import { Drawpad } from './drawpad.js';
import { START_X, DT, MAX_ACCUM, CPU_SPEED, CPU_DELAY } from './constants.js';
import { queryCpuAI, buildSnapshot } from './typesafe.js';
import { generateLimbsWithQwen } from './llm/webllm.js';

// ─── DOM 获取 ──────────────────────────────────────────────────
const raceCanvas = document.getElementById('race');    // 比赛主画布
const padCanvas = document.getElementById('pad');     // 绘制画板
const rctx = raceCanvas.getContext('2d');

// ─── 游戏状态 ──────────────────────────────────────────────────
let stage = 0;     // 当前关卡（0-based）
let racing = false; // 是否正在比赛中
let player = null;  // 玩家物理对象
let cpu = null;  // CPU 物理对象
let cpuPlanIdx = 0;    // CPU 当前计划索引
let raceTime = 0;     // 已用时间（秒）
let lastTs = 0;     // 上一帧时间戳
let acc = 0;     // 时间累积器（固定步长用）
let raf = 0;     // requestAnimationFrame 句柄
let result = '';    // 比赛结果（''=进行中，'WIN'=胜，'LOSE'=败）
let cpuDone = false; // CPU 是否已到终点
let cpuWait = -1;    // CPU 等待切换姿势的开始时间

/** 对战模式：'system' = 规则 AI，'jev' = TypeSafe Jev 模型 */
let cpuMode = 'system';

/** TypeSafe API Key（用户在启动页输入，或读取 .env 默认配置）*/
let typesafeApiKey = (typeof import.meta !== 'undefined' && import.meta?.env ? (
  import.meta.env.VITE_JEV_API_KEY ||
  import.meta.env.JEV_API_KEY ||
  import.meta.env.VITE_TYPESAFE_API_KEY ||
  import.meta.env.TYPESAFE_API_KEY || ''
) : '').trim();

/** TypeSafe BFF 代理服务地址（可选，默认使用 cf-bff 本地服务）*/
let typesafeBffUrl = '';

/** 是否正在等待 AI 返回（防止重复发请）*/
let aiPending = false;

/** CPU 卡住持续时间（秒） */
let cpuStuckDuration = 0;

/** CPU 本局达到的最远 X 坐标（用于判断是否卡住） */
let cpuMaxX = 0;

/** Jev 模式下是否已切入系统规则兜底 */
let cpuInSystemFallback = false;

/** Qwen 模式在同一位置连续卡阻重试次数 */
let qwenStuckRetries = 0;

/** Qwen 模式上一次卡阻位置 X */
let qwenLastStuckX = 0;

/** Qwen 模式当前已处理的区段序号 */
let qwenSecIdx = 0;

/** 需要调用 WebLLM 破障的真实阻碍地形（平地、丘陵、颠簸、大波浪、冰坡等顺畅路段默认保持圆轮极速疾驰） */
export const OBSTACLE_TYPES = new Set([
  'stairs', 'pits', 'bigpit', 'hurdles', 'wall', 'climb', 'tunnel', 'sawtooth', 'belt', 'mud', 'water'
]);

/** HUD 按钮区域（供点击检测）*/
const hud = {};

/** 当前关卡地形数据（由 buildCourse 返回）*/
let terrainData = buildCourse(stage);

/** 设备像素比（高分屏适配）*/
let dpr = 1;

// ─── 地形查询函数包（注入给物理引擎） ─────────────────────────
function makeTerrainFns(td) {
  return {
    getTerrainH: x => terrain(td.HA, x),
    getCeiling: x => ceiling(td.CE, x),
    getWaterLevel: x => waterLevel(td.WL, x),
    getSurface: x => surfaceAt(td.SF, x),
    getTerrainIndex: x => terrainIndex(td.TP, x),
    ceilingNearFn: i0 => {
      // 判断附近是否有天花板（±12个采样点）
      for (let i = Math.max(0, i0 - 12); i <= Math.min(td.CE.length - 1, i0 + 12); i++) {
        if (td.CE[i] > -Infinity) return true;
      }
      return false;
    },
    TP: td.TP,
    CPL: td.CPL,
  };
}

// ─── 画板初始化 ────────────────────────────────────────────────

/**
 * 当画板笔划更新时触发：
 *   - 若已在比赛中 → 立即替换玩家手脚
 *   - 若不在比赛且无结果 → 开始比赛
 */
const drawpad = new Drawpad(padCanvas, limbs => {
  if (racing) {
    player = replaceBody(
      player, limbs,
      getComputedStyle(document.documentElement).getPropertyValue('--player').trim(),
      x => terrain(terrainData.HA, x),
    );
  } else if (!result) {
    startRace();
  }
});

// 将 drawpad 实例暴露给外部脚本（供 index.html 中的按钮绑定使用）
window.__drawpad = drawpad;

/** 更新左上方 WebLLM 响应与手绘提示（支持换行、半透明微型卡片） */
function updateQwenHud(text) {
  const hudEl = document.getElementById('qwen-hud');
  const textEl = document.getElementById('qwen-hud-text');
  if (!hudEl || !textEl) return;
  if (cpuMode !== 'qwen') {
    hudEl.classList.add('hidden');
    return;
  }
  hudEl.classList.remove('hidden');
  textEl.textContent = text;
}

/**
 * 启动页设置游戏配置（由 index.html 引导页调用）
 * @param {'system'|'jev'|'qwen'} mode - 对战模式
 * @param {string}         key         - TypeSafe API Key（mode='jev' 时使用）
 * @param {string}         [bffUrl]    - TypeSafe BFF 代理地址
 */
window.__setGameConfig = (mode, key, bffUrl) => {
  cpuMode = mode;
  const envDefaultKey = (typeof import.meta !== 'undefined' && import.meta?.env ? (
    import.meta.env.VITE_JEV_API_KEY ||
    import.meta.env.JEV_API_KEY ||
    import.meta.env.VITE_TYPESAFE_API_KEY ||
    import.meta.env.TYPESAFE_API_KEY || ''
  ) : '').trim();
  typesafeApiKey = key || envDefaultKey || '';
  typesafeBffUrl = bffUrl || '';
  // 存入 localStorage，下次自动填充
  if (key) localStorage.setItem('typesafe_api_key', key);
  if (bffUrl) localStorage.setItem('typesafe_bff_url', bffUrl);
  if (mode !== 'qwen') {
    const hudEl = document.getElementById('qwen-hud');
    if (hudEl) hudEl.classList.add('hidden');
  }
};

// 初始渲染画板
drawpad.draw();

// ─── 工具栏按钮事件绑定 ────────────────────────────────────────
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // 高亮当前选中工具
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    drawpad.setTool(btn.dataset.tool);
  });
});

// ─── 比赛控制 ──────────────────────────────────────────────────

/** 开始（或重新开始）一场比赛 */
function startRace() {
  terrainData = buildCourse(stage);
  const tf = makeTerrainFns(terrainData);

  player = makeBody(drawpad.limbs, getComputedStyle(document.documentElement).getPropertyValue('--player').trim());
  cpu = makeBody(CPU_ROUND, getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim());
  // Jev 与 Qwen AI 模式采用 1.0 满速与玩家公平对决，规则模式保持原有 0.55 的新手平衡速度
  cpu.speed = (cpuMode === 'jev' || cpuMode === 'qwen') ? 1.0 : CPU_SPEED;
  cpuPlanIdx = 0;

  placeAtStart(player, START_X, tf.getTerrainH);
  placeAtStart(cpu, START_X, tf.getTerrainH);

  raceTime = 0;
  lastTs = 0;
  acc = 0;
  racing = true;
  result = '';
  cpuDone = false;
  cpuWait = -1;
  aiPending = false; // 重置 AI 请求状态

  cpuStuckDuration = 0;
  cpuMaxX = START_X;
  cpuInSystemFallback = false;
  qwenStuckRetries = 0;
  qwenLastStuckX = START_X;
  qwenSecIdx = 0;
  const aiBadge = document.getElementById('ai-badge');
  if (aiBadge) {
    aiBadge.textContent = cpuMode === 'qwen'
      ? '🧠 Qwen 手绘'
      : cpuMode === 'jev' ? '✨ Jev AI' : '⚙️ 规则';
    aiBadge.title = '';
  }

  // Qwen 模式：开局默认以 CPU_ROUND 顺畅疾驰起跑；仅当开局即处于阻碍地形时才调用 WebLLM 破障
  if (cpuMode === 'qwen') {
    const initSec = terrainData.SECTIONS[0]?.type || 'flat';
    if (OBSTACLE_TYPES.has(initSec)) {
      if (aiBadge) {
        aiBadge.textContent = '🧠 思考中...';
        aiBadge.title = '开局遭遇阻碍，正在生成破障形态';
      }
      const nextSec = terrainData.SECTIONS[1]?.type || 'flat';
      const distToUpcoming = terrainData.SECTIONS[1]?.from ? (terrainData.SECTIONS[1].from - START_X) : 0;
      const slopeVal = (tf.getTerrainH(START_X + 15) - tf.getTerrainH(START_X - 15)) / 30;
      const hasSlope = Math.abs(slopeVal) > 0.08;
      const inWater = tf.getWaterLevel(START_X) < tf.getTerrainH(START_X);
      const inTunnel = tf.getCeiling(START_X) > -Infinity;

      updateQwenHud(`⚠️ 开局遭遇阻碍：${initSec}\n💭 正在推演破障最优解...`);
      generateLimbsWithQwen({
        currentSection: initSec,
        targetSection: initSec,
        upcomingObstacle: nextSec,
        distToUpcoming,
        hasSlope,
        slopeDesc: slopeVal > 0.1 ? '下坡俯冲' : (slopeVal < -0.1 ? '上坡爬坡' : '平缓起跑'),
        inWater,
        inTunnel,
        speed: 0,
      }).then(qwenLimbs => {
        if (!racing || cpuDone) return;
        cpu = replaceBody(
          cpu, qwenLimbs,
          getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim(),
          tf.getTerrainH,
        );
        if (aiBadge) {
          aiBadge.textContent = '🧠 Qwen 手绘';
          aiBadge.title = qwenLimbs.thought || 'Qwen 自主手绘';
        }
        updateQwenHud(`📍 障碍变身：${initSec}\n🎯 最优解：${qwenLimbs.thought}\n🚀 全力突破中`);
      }).catch(err => {
        console.warn('Qwen 开局手绘错误:', err);
        if (aiBadge) aiBadge.textContent = '🧠 Qwen 疾驰';
        updateQwenHud('⚠️ 模型手绘降级');
      });
    } else {
      // 畅通路段：保持圆轮极速起跑，遇到阻碍再去调用 WebLLM
      if (aiBadge) {
        aiBadge.textContent = '🧠 Qwen 疾驰';
        aiBadge.title = '双圆轮极速起跑，遇到阻碍时调用 WebLLM 破障';
      }
      updateQwenHud(`📍 畅通路况：${initSec}\n⚡ 双圆轮极速起跑，遇到阻碍时调用 WebLLM 破障！`);
    }
  } else {
    updateQwenHud('');
  }

  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

/** 比赛结束处理 */
function finish() {
  racing = false;
  // 若 CPU 已到终点，玩家输；否则玩家赢
  result = cpuDone ? 'LOSE' : 'WIN';
  if (cpuMode === 'qwen') {
    updateQwenHud(result === 'WIN' ? '🏁 比赛结束\n🏆 人类玩家获胜！' : '🏁 比赛结束\n👑 Qwen2.5 凭借力学优势获胜！');
  }
  renderFrame();
}

// ─── 物理主循环 ────────────────────────────────────────────────

/** 每帧动画回调 */
function frame(ts) {
  if (!lastTs) lastTs = ts;
  acc += Math.min((ts - lastTs) / 1000, MAX_ACCUM);
  lastTs = ts;

  const tf = makeTerrainFns(terrainData);

  // 固定时间步长物理模拟（避免帧率波动影响物理）
  while (acc >= DT) {
    stepBody(player, DT, tf);
    raceTime += DT;
    acc -= DT;

    if (!cpuDone) {
      stepBody(cpu, DT, tf);

      // 计算当前区段索引
      const k = cpuPlanIndex(terrainData.CPU_PLAN, cpu.x);

      // ─── CPU 卡住检测（前进距离小于 8 像素） ───
      if (cpu.x > cpuMaxX + 8) {
        cpuMaxX = cpu.x;
        cpuStuckDuration = 0;
        // 若前进脱离卡阻点超过 80 像素，重置卡阻重试次数
        if (cpu.x > qwenLastStuckX + 80) {
          qwenStuckRetries = 0;
        }
      } else {
        cpuStuckDuration += DT;
      }

      // ─── 兜底机制：Jev 模式下若卡住 6 秒，直接切换为系统规则姿势脱困 ───
      if (cpuMode === 'jev' && !cpuInSystemFallback && cpuStuckDuration >= 6.0) {
        cpuInSystemFallback = true;
        const systemPose = terrainData.CPU_PLAN[k]?.pose || 'long';
        cpu = replaceBody(
          cpu, CPU_POSES[systemPose],
          getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim(),
          tf.getTerrainH,
        );
        cpuPlanIdx = k;
        cpu.speed = 1.0;
        cpuStuckDuration = 0;
        cpuMaxX = cpu.x;
        const aiBadge = document.getElementById('ai-badge');
        if (aiBadge) aiBadge.textContent = '⚙️ 系统(兜底)';
      }

      // ─── Qwen 模式卡住应急处理 ───
      // 若持续卡在某个位置，前 2 次调用 WebLLM 紧急重绘，持续第 3 次兜底使用系统规则脱困
      if (cpuMode === 'qwen' && !cpuInSystemFallback && cpuStuckDuration >= 2.5 && !aiPending) {
        if (Math.abs(cpu.x - qwenLastStuckX) > 60) {
          qwenStuckRetries = 0;
          qwenLastStuckX = cpu.x;
        }
        qwenStuckRetries++;
        cpuStuckDuration = 0;
        cpuMaxX = cpu.x;

        const aiBadge = document.getElementById('ai-badge');
        const currentSec = terrainData.SECTIONS.findLast(s => cpu.x >= s.from) ?? terrainData.SECTIONS[0];
        const slopeVal = (tf.getTerrainH(cpu.x + 15) - tf.getTerrainH(cpu.x - 15)) / 30;
        const hasSlope = Math.abs(slopeVal) > 0.08;
        const inWater = tf.getWaterLevel(cpu.x) < tf.getTerrainH(cpu.x) && cpu.y > tf.getWaterLevel(cpu.x);
        const inTunnel = tf.getCeiling(cpu.x) > -Infinity;

        if (qwenStuckRetries >= 3) {
          // 持续卡在同一位置 3 次：进入强力脱困，直接纯净使用系统规则模版（不添加任何其他手脚）
          cpuInSystemFallback = true;
          const systemPose = resolveOptimalPose(terrainData, cpu.x, tf);
          cpu = replaceBody(
            cpu, CPU_POSES[systemPose],
            getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim(),
            tf.getTerrainH,
          );
          cpu.poseName = systemPose;
          cpuPlanIdx = k;
          cpu.speed = 1.25;
          // 若为圆轮或坡度水域，赋予向前推进冲量
          if (systemPose === 'round') {
            cpu.vx += 30;
          }
          if (aiBadge) {
            aiBadge.textContent = '⚙️ 系统(脱困)';
            aiBadge.title = `连续3次受阻，直接使用系统规则模版(${systemPose})`;
          }
          updateQwenHud(`⚠️ 连续3次受阻，直接使用系统【${systemPose}】模版强力脱困\n🚗 越过障碍后自动恢复 WebLLM`);
        } else {
          aiPending = true;
          if (aiBadge) {
            aiBadge.textContent = '🧠 紧急破障';
            aiBadge.title = `卡阻重绘(${qwenStuckRetries}/3)`;
          }
          updateQwenHud(`⚠️ 卡阻停滞(第${qwenStuckRetries}/3次)！\n💥 正在重绘当前场景最优解形态...`);
          generateLimbsWithQwen({
            currentSection: currentSec.type,
            targetSection: currentSec.type,
            isStuck: true,
            stuckCount: qwenStuckRetries,
            hasSlope,
            slopeDesc: slopeVal > 0.1 ? '下坡俯冲' : (slopeVal < -0.1 ? '上坡爬坡' : '起伏坡度'),
            inWater,
            inTunnel,
            speed: Math.round(cpu.vx),
          }).then(qwenLimbs => {
            aiPending = false;
            if (!racing || cpuDone) return;
            cpu = replaceBody(
              cpu, qwenLimbs,
              getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim(),
              tf.getTerrainH,
            );
            cpu.speed = 1.15;
            if (aiBadge) {
              aiBadge.textContent = '🧠 Qwen 手绘';
              aiBadge.title = qwenLimbs.thought || 'Qwen 破障手绘';
            }
            updateQwenHud(`📍 应急脱困：${currentSec.type}\n🎯 决策：${qwenLimbs.thought}\n⚡ 爆发推进翻越中`);
          }).catch(() => {
            aiPending = false;
          });
        }
      }

      // ─── Qwen 模式系统兜底运行中持续卡阻二次防护 ───
      if (cpuMode === 'qwen' && cpuInSystemFallback && cpuStuckDuration >= 2.0) {
        cpuStuckDuration = 0;
        cpuMaxX = cpu.x;
        const currentSec = terrainData.SECTIONS.findLast(s => cpu.x >= s.from) ?? terrainData.SECTIONS[0];
        const currentType = currentSec.type;
        const slopeVal = (tf.getTerrainH(cpu.x + 15) - tf.getTerrainH(cpu.x - 15)) / 30;
        const hasSlope = Math.abs(slopeVal) > 0.08;
        const inWater = tf.getWaterLevel(cpu.x) < tf.getTerrainH(cpu.x) && cpu.y > tf.getWaterLevel(cpu.x);

        let altPose = 'long';
        if (hasSlope || inWater || ['flat', 'hills', 'wave', 'ice', 'water'].includes(currentType)) {
          // 有坡度、深水、平地：必须纯净使用系统圆轮 CPU_ROUND（双手双脚皆为圆轮），绝不使用直线手臂！
          altPose = 'round';
          cpu.vx += 35; // 赋予顺坡冲刺推进冲量
        } else if (currentType === 'wall' || currentType === 'climb') {
          altPose = 'climb';
          cpu.vy -= 40;
        } else if (currentType === 'tunnel') {
          altPose = 'small';
        } else {
          // 台阶、坑壁障碍：交替长腿十字并赋予起跳
          altPose = (cpu.poseName === 'long') ? 'climb' : 'long';
          cpu.vy -= 25;
        }

        cpu = replaceBody(
          cpu, CPU_POSES[altPose],
          getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim(),
          tf.getTerrainH,
        );
        cpu.poseName = altPose;
        cpu.speed = 1.35;
        const aiBadge = document.getElementById('ai-badge');
        if (aiBadge) aiBadge.textContent = '⚙️ 强力脱困';
        updateQwenHud(`⚠️ 兜底强化：采用系统纯正【${altPose}】模版脱困！`);
      }

      // ─── 系统兜底中，等下次再次卡住（>1.5秒）时重新调用 Jev AI ───
      if (cpuMode === 'jev' && cpuInSystemFallback && cpuStuckDuration >= 1.5 && !aiPending) {
        aiPending = true;
        const planPose = terrainData.CPU_PLAN[k]?.pose;
        const snap = buildSnapshot({
          cpu, player, terrainData, raceTime, stage,
          STAGE_NAMES, STAGES,
          waterLevelFn: tf.getWaterLevel,
          ceilingFn: tf.getCeiling,
          planPose,
        });
        queryCpuAI(snap, typesafeApiKey, typesafeBffUrl)
          .then(result => {
            aiPending = false;
            if (!racing || cpuDone) return;
            if (result?.pose) {
              cpuInSystemFallback = false;
              cpuPlanIdx = k;
              cpu = replaceBody(
                cpu, CPU_POSES[result.pose],
                getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim(),
                tf.getTerrainH,
              );
              cpu.speed = result.boost ? 1.25 : 1.0;
              cpuStuckDuration = 0;
              cpuMaxX = cpu.x;
              const aiBadge = document.getElementById('ai-badge');
              if (aiBadge) aiBadge.textContent = '✨ Jev AI';
            }
          });
      }

      // ─── Qwen 模式：在遇到下一个场景前 10 像素时精准触发 WebLLM 决策 ───
      if (cpuMode === 'qwen' && !aiPending) {
        const nextSecIdx = qwenSecIdx + 1;
        const nextSec = terrainData.SECTIONS[nextSecIdx];
        // 当赛车行驶到距离下一个区段仅剩 2 像素（或已进入该区段）时触发判断
        if (nextSec && (nextSec.from - cpu.x) <= 2) {
          qwenSecIdx = nextSecIdx;
          cpuInSystemFallback = false;
          qwenStuckRetries = 0;
          qwenLastStuckX = cpu.x;

          const currentSec = terrainData.SECTIONS.findLast(s => cpu.x >= s.from) ?? terrainData.SECTIONS[0];
          const targetSecType = nextSec.type;
          const isObstacle = OBSTACLE_TYPES.has(targetSecType);

          if (isObstacle) {
            // 遭遇真实阻碍：调用端侧 WebLLM 自由手绘推演克制形态
            aiPending = true;
            const distToUpcoming = Math.max(0, nextSec.from - cpu.x);
            const slopeVal = (tf.getTerrainH(cpu.x + 15) - tf.getTerrainH(cpu.x - 15)) / 30;
            const hasSlope = Math.abs(slopeVal) > 0.08;
            const inWater = tf.getWaterLevel(cpu.x) < tf.getTerrainH(cpu.x) && cpu.y > tf.getWaterLevel(cpu.x);
            const inTunnel = tf.getCeiling(cpu.x) > -Infinity;
            const aiBadge = document.getElementById('ai-badge');
            if (aiBadge) {
              aiBadge.textContent = '🧠 思考中...';
            }
            updateQwenHud(`📍 遭遇阻碍：${targetSecType}\n💭 正在推演克制障碍最优解...`);

            generateLimbsWithQwen({
              currentSection: currentSec.type,
              targetSection: targetSecType,
              distToUpcoming,
              hasSlope,
              slopeDesc: slopeVal > 0.1 ? '下坡俯冲' : (slopeVal < -0.1 ? '上坡爬坡' : '平缓路段'),
              inWater,
              inTunnel,
              speed: Math.round(cpu.vx),
            }).then(qwenLimbs => {
              aiPending = false;
              if (!racing || cpuDone) return;
              cpuPlanIdx = k;
              cpu = replaceBody(
                cpu, qwenLimbs,
                getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim(),
                tf.getTerrainH,
              );
              cpu.speed = 1.0;
              if (aiBadge) {
                aiBadge.textContent = '🧠 Qwen 手绘';
                aiBadge.title = qwenLimbs.thought || 'Qwen 手绘';
              }
              updateQwenHud(`📍 障碍变身：${targetSecType}\n🎯 最优解：${qwenLimbs.thought}\n🚀 全速进攻超越中`);
            }).catch(err => {
              aiPending = false;
              console.warn('Qwen 手绘失败，降级到默认:', err);
              const pose = resolveOptimalPose(terrainData, cpu.x, tf);
              cpuPlanIdx = k;
              cpu = replaceBody(
                cpu, CPU_POSES[pose],
                getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim(),
                tf.getTerrainH,
              );
              cpu.poseName = pose;
              if (aiBadge) aiBadge.textContent = '⚙️ 系统(兜底)';
              updateQwenHud(`📍 阻碍地形：${targetSecType}\n⚠️ 降级使用规则姿势（${pose}）`);
            });
          } else {
            // 开阔顺畅地形（平地、丘陵、颠簸、冰坡等）：不调用 WebLLM，直接恢复圆轮极速疾驰
            cpuPlanIdx = k;
            cpu = replaceBody(
              cpu, CPU_ROUND,
              getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim(),
              tf.getTerrainH,
            );
            cpu.poseName = 'round';
            cpu.speed = 1.0;
            const aiBadge = document.getElementById('ai-badge');
            if (aiBadge) {
              aiBadge.textContent = '🧠 Qwen 疾驰';
              aiBadge.title = '开阔顺畅路段，保持圆轮高速疾驰';
            }
            updateQwenHud(`📍 顺畅路段：${targetSecType}\n⚡ 无障碍阻碍，保持双圆轮高速疾驰！`);
          }
        }
      }

      // ─── 常规区段切换逻辑（用于 Jev 与规则模式） ───
      if (k !== cpuPlanIdx) {
        if (cpuMode === 'jev' && !cpuInSystemFallback && !aiPending) {
          // Jev 模式正常区段切换
          aiPending = true;
          const planPose = terrainData.CPU_PLAN[k]?.pose;
          const snap = buildSnapshot({
            cpu, player, terrainData, raceTime, stage,
            STAGE_NAMES, STAGES,
            waterLevelFn: tf.getWaterLevel,
            ceilingFn: tf.getCeiling,
            planPose,
          });
          queryCpuAI(snap, typesafeApiKey, typesafeBffUrl)
            .then(result => {
              aiPending = false;
              if (!racing || cpuDone) return;
              const pose = result?.pose ?? terrainData.CPU_PLAN[k].pose;
              cpuPlanIdx = k;
              cpu = replaceBody(
                cpu, CPU_POSES[pose],
                getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim(),
                tf.getTerrainH,
              );
              cpu.speed = result?.boost ? 1.25 : 1.0;
            });
        } else if (cpuMode === 'system' || cpuInSystemFallback) {
          // 规则模式或系统兜底中按地形自动切换
          if (cpuWait < 0) cpuWait = raceTime;
          if (raceTime - cpuWait >= CPU_DELAY) {
            cpuPlanIdx = k;
            cpuWait = -1;
            const pose = terrainData.CPU_PLAN[k].pose;
            cpu = replaceBody(
              cpu, CPU_POSES[pose],
              getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim(),
              tf.getTerrainH,
            );
          }
        }
      }

      if (cpu.x >= terrainData.FINISH_X) cpuDone = true;
    }

    // 玩家到终点：结束
    if (player.x >= terrainData.FINISH_X) { finish(); return; }
  }

  renderFrame();
  raf = requestAnimationFrame(frame);
}

/** 渲染当前帧 */
function renderFrame() {
  render(rctx, {
    player, cpu, raceTime, stage, result, hud, dpr,
    terrainData,
    STAGES, POOL, STAGE_NAMES,
  });
}

// ─── 响应式画布尺寸 ────────────────────────────────────────────

/** 调整比赛画布尺寸以匹配窗口（高分屏适配） */
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  raceCanvas.width = Math.round(window.innerWidth * dpr);
  raceCanvas.height = Math.round(window.innerHeight * dpr);
  renderFrame();
}
window.addEventListener('resize', resize);
resize(); // 初始化尺寸

// ─── HUD 点击处理 ──────────────────────────────────────────────

/**
 * 结果面板按钮点击处理
 * 使用 click 事件而非 pointerdown，避免移动端分享弹窗被拦截
 */
raceCanvas.addEventListener('click', e => {
  if (racing || !result) return; // 比赛中或无结果时不响应
  const r = raceCanvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const hit = k => hud[k] && x >= hud[k].x && x <= hud[k].x + hud[k].w
    && y >= hud[k].y && y <= hud[k].y + hud[k].h;

  if (hit('share')) {
    shareResult();
  } else if (hit('restart')) {
    if (result === 'WIN') {
      stage = (stage + 1) % STAGES.length; // 胜利则进入下一关
    }
    startRace();
  }
});

// ─── 趣味战报与分享功能 ──────────────────────────────────────────

let sharing = false;

/** 绘制圆角矩形辅助函数 */
function fillRoundRect(g, x, y, w, h, r, fill, stroke) {
  g.save();
  g.beginPath();
  if (typeof g.roundRect === 'function') {
    g.roundRect(x, y, w, h, r);
  } else {
    g.rect(x, y, w, h);
  }
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = 1.5; g.strokeStyle = stroke; g.stroke(); }
  g.restore();
}

/** 根据用时与胜负智能生成趣味称号和评语 */
function getFunTitle(isWin, time) {
  if (!isWin) {
    const loseTitles = [
      { title: '🧗 翻滚爬行显眼包', quote: '「虽败犹荣！轮子具有后现代行为艺术之美！」' },
      { title: '🚧 赛道质检工程师', quote: '「我不是卡住了，我是在实地严谨考察路况！」' },
      { title: '🌪️ 物理学受害人', quote: '「牛顿定律暂时占了上风，下把必翻盘！」' },
    ];
    return loseTitles[Math.floor(Math.random() * loseTitles.length)];
  }
  if (time < 5.0) {
    return { title: '⚡ 超光速贴地飞行神', quote: '「对手还没起步，我已经到终点喝下午茶了！」' };
  } else if (time < 8.5) {
    return { title: '🚀 达芬奇在世 · 造轮大师', quote: '「精妙绝伦的力学轮子，物理老师直呼内行！」' };
  } else if (time < 13.0) {
    return { title: '🌀 物理学奇迹 · 破壁人', quote: '「只要轮子画得奇，没有翻不过去的高山！」' };
  } else {
    return { title: '👑 坚韧越野老司机', quote: '「一路颠簸翻滚，但我终究登顶了终点！」' };
  }
}

/** 绘制高颜值、高传播度的战绩分享卡片 */
function renderShareCardCanvas(c, { player, stage, stageName, result, raceTime, cpuMode }) {
  const g = c.getContext('2d');
  const w = c.width;
  const h = c.height;

  // 1. 深色极光渐变背景
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0d0f2b');
  bg.addColorStop(0.4, '#1b1744');
  bg.addColorStop(0.8, '#2b1654');
  bg.addColorStop(1, '#100b28');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  // 柔和光晕
  const glow1 = g.createRadialGradient(w * 0.2, h * 0.15, 20, w * 0.2, h * 0.15, 300);
  glow1.addColorStop(0, 'rgba(229, 81, 186, 0.22)');
  glow1.addColorStop(1, 'rgba(229, 81, 186, 0)');
  g.fillStyle = glow1;
  g.fillRect(0, 0, w, h);

  const glow2 = g.createRadialGradient(w * 0.85, h * 0.45, 30, w * 0.85, h * 0.45, 320);
  glow2.addColorStop(0, 'rgba(124, 58, 237, 0.25)');
  glow2.addColorStop(1, 'rgba(124, 58, 237, 0)');
  g.fillStyle = glow2;
  g.fillRect(0, 0, w, h);

  // 2. 外框微光边框
  const m = 22;
  fillRoundRect(g, m, m, w - m * 2, h - m * 2, 28, 'rgba(255, 255, 255, 0.02)', 'rgba(255, 255, 255, 0.16)');

  // 3. 顶部 Header 药丸（游戏名称 + 关卡）
  fillRoundRect(g, 48, 48, w - 96, 44, 22, 'rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.12)');
  g.fillStyle = '#fff';
  g.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('🎨 绘制滚轮赛跑 · DRAW ROLL RACE', 68, 70);

  g.textAlign = 'right';
  g.font = 'bold 15px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = '#ff70a6';
  g.fillText(`第 ${stage + 1} 关 · ${stageName}`, w - 68, 70);

  // 4. 胜负大标题 & 趣味称号
  const isWin = result === 'WIN';
  const fun = getFunTitle(isWin, raceTime);

  g.textAlign = 'center';
  g.font = '900 42px -apple-system, BlinkMacSystemFont, sans-serif';
  if (isWin) {
    g.fillStyle = '#ffd166';
    g.shadowColor = 'rgba(255, 209, 102, 0.6)';
    g.shadowBlur = 24;
    g.fillText('🏆 冲 线 大 捷 ！', w / 2, 142);
  } else {
    g.fillStyle = '#38bdf8';
    g.shadowColor = 'rgba(56, 189, 248, 0.6)';
    g.shadowBlur = 24;
    g.fillText('💨 顽 强 完 赛 ！', w / 2, 142);
  }
  g.shadowBlur = 0; // 重置光晕

  // 趣味称号胶囊
  const titleText = `【 ${fun.title} 】`;
  g.font = 'bold 22px -apple-system, BlinkMacSystemFont, sans-serif';
  const titleWidth = g.measureText(titleText).width + 40;
  fillRoundRect(g, (w - titleWidth) / 2, 168, titleWidth, 40, 20, 'rgba(229, 81, 186, 0.18)', 'rgba(229, 81, 186, 0.6)');
  g.fillStyle = '#ff9be3';
  g.fillText(titleText, w / 2, 188);

  // 趣味评语
  g.font = 'italic 15px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = 'rgba(255, 255, 255, 0.8)';
  g.fillText(fun.quote, w / 2, 230);

  // 5. 核心数据仪表盘 (3 列式卡片)
  const cardY = 254;
  const cardH = 94;
  const cardW = (w - 96 - 24) / 3;

  const cs = Math.round(raceTime * 100);
  const timeStr = `${String(Math.floor(cs / 100)).padStart(2, '0')}:${String(cs % 100).padStart(2, '0')}`;
  const opponentLabel = cpuMode === 'qwen'
    ? '🧠 Qwen 手绘'
    : cpuMode === 'jev' ? '✨ Jev AI' : '⚙️ 规则对手';
  const beatPct = isWin ? Math.min(99.6, Math.max(82, 100 - raceTime * 1.6)).toFixed(1) + '%' : '极速进阶中';

  const stats = [
    { label: '⏱️ 完赛耗时', val: timeStr, color: '#4ade80' },
    { label: '🆚 对战对手', val: opponentLabel, color: '#c084fc' },
    { label: '🔥 击败选手', val: beatPct, color: '#f472b6' },
  ];

  stats.forEach((st, idx) => {
    const cx = 48 + idx * (cardW + 12);
    fillRoundRect(g, cx, cardY, cardW, cardH, 18, 'rgba(255, 255, 255, 0.06)', 'rgba(255, 255, 255, 0.14)');

    g.textAlign = 'center';
    g.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
    g.fillStyle = 'rgba(255, 255, 255, 0.6)';
    g.fillText(st.label, cx + cardW / 2, cardY + 30);

    g.font = 'bold 20px -apple-system, BlinkMacSystemFont, sans-serif';
    g.fillStyle = st.color;
    g.fillText(st.val, cx + cardW / 2, cardY + 66);
  });

  // 6. 专属手绘战车展示台 (Hero Feature)
  const stageBoxY = 366;
  const stageBoxH = 470;
  fillRoundRect(g, 48, stageBoxY, w - 96, stageBoxH, 24, 'rgba(255, 255, 255, 0.04)', 'rgba(255, 255, 255, 0.12)');

  // 展示台标语
  fillRoundRect(g, (w - 200) / 2, stageBoxY + 16, 200, 30, 15, 'rgba(255, 255, 255, 0.08)');
  g.fillStyle = 'rgba(255, 255, 255, 0.9)';
  g.font = 'bold 13px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillText('👑 玩家专属手绘战车', w / 2, stageBoxY + 31);

  // 展台聚光灯地面与阴影
  const pedestalY = stageBoxY + stageBoxH - 60;
  const spotGrad = g.createRadialGradient(w / 2, pedestalY - 20, 10, w / 2, pedestalY - 20, 240);
  spotGrad.addColorStop(0, 'rgba(124, 58, 237, 0.4)');
  spotGrad.addColorStop(0.6, 'rgba(229, 81, 186, 0.15)');
  spotGrad.addColorStop(1, 'rgba(229, 81, 186, 0)');
  g.fillStyle = spotGrad;
  g.fillRect(48, stageBoxY + 40, w - 96, stageBoxH - 60);

  // 展台发光椭圆环
  g.beginPath();
  g.ellipse(w / 2, pedestalY, 210, 28, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255, 255, 255, 0.08)';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(229, 81, 186, 0.6)';
  g.stroke();

  // 居中绘制放大的玩家手绘战车
  const scale = Math.min(4.8, 300 / (player.rad || 36));
  g.save();
  g.translate(w / 2, pedestalY - player.rad * scale);
  g.scale(scale, scale);
  drawBody(g, { ...player, x: 0, y: 0 }, 1);
  g.restore();

  // 7. 底部传播 Footer 与印章认证
  const footerY = 856;
  g.beginPath();
  g.moveTo(48, footerY);
  g.lineTo(w - 48, footerY);
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  g.stroke();

  // 左侧传播引导
  g.textAlign = 'left';
  g.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = '#fff';
  g.fillText('🕹️ 随手一画就能跑，敢来挑战我的成绩吗？', 58, footerY + 36);

  g.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = 'rgba(255, 255, 255, 0.55)';
  g.fillText('物理引擎极速竞速 · 自由发挥天马行空滚轮设计', 58, footerY + 62);

  // 认证徽章/印章 (右侧)
  fillRoundRect(g, w - 176, footerY + 16, 120, 56, 12, 'rgba(255, 255, 255, 0.06)', 'rgba(255, 255, 255, 0.15)');
  g.textAlign = 'center';
  g.font = 'bold 12px monospace';
  g.fillStyle = '#ff70a6';
  g.fillText('OFFICIAL RUN', w - 116, footerY + 36);
  g.font = '11px monospace';
  g.fillStyle = 'rgba(255, 255, 255, 0.5)';
  const now = new Date();
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  g.fillText(dateStr, w - 116, footerY + 54);
}

/** 生成分享图片并调用系统分享 / 弹窗展示 */
function shareResult() {
  if (!player || sharing) return;

  const stageName = STAGE_NAMES[stage] ?? `第${stage + 1}关`;
  const cs = Math.round(raceTime * 100);
  const timeStr = `${String(Math.floor(cs / 100)).padStart(2, '0')}:${String(cs % 100).padStart(2, '0')}`;
  const isWin = result === 'WIN';
  const fun = getFunTitle(isWin, raceTime);
  const oppText = cpuMode === 'jev' ? '✨ TypeSafe Jev AI' : '⚙️ 规则对手';

  // 1. 生成 750×1000 高清卡片画布
  const c = document.createElement('canvas');
  c.width = 750;
  c.height = 1000;
  renderShareCardCanvas(c, {
    player, stage, stageName, result, raceTime, cpuMode,
  });

  const dataUrl = c.toDataURL('image/png');

  // 2. 组装社交传播文案
  const head = isWin ? `🏆 我在【绘制滚轮赛跑】${stageName}通关！` : `💥 我在【绘制滚轮赛跑】${stageName}发起挑战！`;
  const text = `${head}\n荣获称号：${fun.title}\n完赛耗时：${timeStr} ｜ 对战：${oppText}\n${fun.quote}\n\n来试试你画的轮子能跑多快 👉 ${location.href.split(/[?#]/)[0]}\n#绘制滚轮赛跑 #独立游戏`;
  const intent = 'https://x.com/intent/post?text=' + encodeURIComponent(text);

  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], 'draw-roll-race.png', { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    // 移动端：通过系统分享面板发送（支持微信、相册、X 等）
    sharing = true;
    navigator.share({ files: [file], text })
      .catch(err => { if (!err || err.name !== 'AbortError') showShareImage(dataUrl, intent, text); })
      .finally(() => { sharing = false; });
  } else {
    showShareImage(dataUrl, intent, text);
  }
}

/** 在页面内以精致毛玻璃弹窗展示分享卡片（支持保存图片与一键复制文案） */
function showShareImage(dataUrl, intent, text) {
  document.getElementById('share-overlay')?.remove();
  const box = document.createElement('div');
  box.id = 'share-overlay';
  box.style.cssText = 'position:fixed;inset:0;background:rgba(10,12,28,0.85);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;z-index:200;padding:16px;box-sizing:border-box;';

  const card = document.createElement('div');
  card.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:24px;padding:20px 22px;display:flex;flex-direction:column;align-items:center;gap:14px;max-width:min(90vw, 420px);box-shadow:0 24px 60px rgba(0,0,0,0.6);';

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;color:#fff;';
  titleRow.innerHTML = '<span style="font-weight:700;font-size:16px;">📸 专属战绩卡已生成</span><span id="share-close-btn" style="cursor:pointer;font-size:18px;opacity:0.6;padding:4px;">✕</span>';
  card.appendChild(titleRow);

  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = '战绩分享卡片';
  img.style.cssText = 'width:100%;max-height:56vh;object-fit:contain;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,0.5);';
  card.appendChild(img);

  const hintText = document.createElement('p');
  hintText.textContent = '💡 手机端可长按图片保存，电脑端右键复制';
  hintText.style.cssText = 'margin:0;font-size:12px;color:rgba(255,255,255,0.6);text-align:center;';
  card.appendChild(hintText);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;width:100%;justify-content:center;';

  // 复制战报按钮
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = '📋 复制战报';
  copyBtn.style.cssText = 'flex:1;padding:10px 12px;border:none;border-radius:12px;background:rgba(255,255,255,0.14);color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:background 0.2s;';
  copyBtn.addEventListener('click', () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✅ 已复制！';
        setTimeout(() => { copyBtn.textContent = '📋 复制战报'; }, 2000);
      });
    }
  });
  btnRow.appendChild(copyBtn);

  // X 分享按钮
  if (intent) {
    const xBtn = document.createElement('a');
    xBtn.href = intent;
    xBtn.target = '_blank';
    xBtn.rel = 'noopener';
    xBtn.textContent = '🚀 发布到 X';
    xBtn.style.cssText = 'flex:1;padding:10px 12px;border-radius:12px;background:linear-gradient(135deg,#e551ba,#7c3aed);color:#fff;font-size:13px;font-weight:700;text-decoration:none;text-align:center;box-sizing:border-box;box-shadow:0 4px 15px rgba(124,58,237,0.3);';
    btnRow.appendChild(xBtn);
  }

  card.appendChild(btnRow);
  box.appendChild(card);

  const closeFn = () => box.remove();
  box.addEventListener('pointerdown', e => { if (e.target === box) closeFn(); });
  card.querySelector('#share-close-btn').addEventListener('click', closeFn);
  document.body.appendChild(box);
}
