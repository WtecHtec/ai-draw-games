/**
 * game.js —— 游戏主循环与核心流程装配器 (App Orchestrator)
 *
 * 职责（DDD 应用层/编排层）：
 *   - 装配各领域服务（AIController, PvPService, ShareService, Drawpad, Renderer）
 *   - 运行固定时间步长物理循环（stepBody）
 *   - 终点检测与胜负裁决
 *   - 委托调度 HUD 按钮交互（下一关、再战、返回菜单、分享）
 */

import { buildCourse, terrain, waterLevel, surfaceAt, ceiling, terrainIndex, POOL, STAGES, STAGE_NAMES } from './terrain.js';
import { stepBody } from './physics.js';
import { makeBody, replaceBody, placeAtStart } from './body.js';
import { CPU_ROUND } from './cpu.js';
import { render } from './renderer.js';
import { Drawpad } from './drawpad.js';
import { START_X, DT, MAX_ACCUM, CPU_SPEED } from './constants.js';
import { netClient } from './net/client.js';

// 引入 DDD 领域服务模块
import { aiController, OBSTACLE_TYPES } from './services/aiController.js';
import { pvpService } from './services/pvpService.js';
import { shareResult } from './services/shareService.js';

// ─── DOM 获取 ──────────────────────────────────────────────────
const raceCanvas = document.getElementById('race');    // 比赛主画布
const padCanvas  = document.getElementById('pad');     // 绘制画板
const rctx = raceCanvas.getContext('2d');

// ─── 核心比赛状态 ──────────────────────────────────────────────
let stage = 0;       // 当前关卡（0-based）
let racing = false;  // 是否正在比赛中
let player = null;   // 玩家物理对象
let cpu = null;      // CPU / 对手 物理对象
let raceTime = 0;    // 已用时间（秒）
let lastTs = 0;      // 上一帧时间戳
let acc = 0;         // 时间累积器（固定步长用）
let raf = 0;         // requestAnimationFrame 句柄
let result = '';     // 比赛结果（''=进行中，'WIN'=胜，'LOSE'=败）
let cpuDone = false; // CPU 是否已到终点

/** 对战模式：'system' = 规则 AI，'jev' = TypeSafe Jev 模型，'qwen' = 端侧 Qwen，'pvp' = 双人对决 */
let cpuMode = 'system';

/** HUD 按钮交互区域缓存（供点击检测）*/
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
      for (let i = Math.max(0, i0 - 12); i <= Math.min(td.CE.length - 1, i0 + 12); i++) {
        if (td.CE[i] > -Infinity) return true;
      }
      return false;
    },
    TP: td.TP,
    CPL: td.CPL,
  };
}

// ─── UI HUD 提示方法 ──────────────────────────────────────────
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

function updateAiBadge(text, title = '') {
  const aiBadge = document.getElementById('ai-badge');
  if (!aiBadge) return;
  aiBadge.textContent = text;
  aiBadge.title = title;
}

// ─── 服务初始化 ────────────────────────────────────────────────
aiController.init({
  cpuMode,
  typesafeApiKey: (typeof import.meta !== 'undefined' && import.meta?.env ? (
    import.meta.env.VITE_JEV_API_KEY ||
    import.meta.env.JEV_API_KEY ||
    import.meta.env.VITE_TYPESAFE_API_KEY ||
    import.meta.env.TYPESAFE_API_KEY || ''
  ) : '').trim(),
  onUpdateBadge: updateAiBadge,
  onUpdateQwenHud: updateQwenHud,
});

// ─── 画板初始化 ────────────────────────────────────────────────
const drawpad = new Drawpad(padCanvas, limbs => {
  const tf = makeTerrainFns(terrainData);
  const playerColor = getComputedStyle(document.documentElement).getPropertyValue('--player').trim() || '#2563eb';
  if (!player) {
    player = makeBody(limbs, playerColor);
    placeAtStart(player, START_X, tf.getTerrainH);
  } else {
    player = replaceBody(player, limbs, playerColor, tf.getTerrainH);
  }
  renderFrame();

  // PvP 模式下无论开赛前后，绘制完成立刻向对手同步
  if (cpuMode === 'pvp') {
    netClient.sendLimbs(limbs);
  }

  if (!racing && !result && cpuMode !== 'pvp') {
    startRace();
  }
});

// 暴露画板供外部页面绑定
window.__drawpad = drawpad;
drawpad.draw();

// ─── 工具栏按钮事件绑定 ────────────────────────────────────────
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    drawpad.setTool(btn.dataset.tool);
  });
});

// ─── 全局对战配置入口（供 index.html 启动页调用） ───────────────
window.__setGameConfig = (mode, key, bffUrl) => {
  cpuMode = mode;
  aiController.setMode(mode);
  if (key || bffUrl) {
    aiController.setApiKey(key, bffUrl);
  }
  if (mode !== 'qwen') {
    updateQwenHud('');
  }
};

// ─── PvP 服务生命周期钩子装配 ──────────────────────────────────
pvpService.onRaceStart = ({ stage: newStage, seed, countdownMs }) => {
  cpuMode = 'pvp';
  if (typeof newStage === 'number') stage = newStage;

  window.__hideStartOverlay?.();
  document.getElementById('hint')?.remove();

  triggerPvPCountdown(seed, countdownMs || 3000);

  if (drawpad && drawpad.limbs && (drawpad.limbs.arm.length > 0 || drawpad.limbs.leg.length > 0)) {
    netClient.sendLimbs(drawpad.limbs);
  }
};

pvpService.onMatchFinish = ({ winner }) => {
  if (cpuMode !== 'pvp') return;
  racing = false;
  acc = 0;
  result = (winner === netClient.role) ? 'WIN' : 'LOSE';
  cancelAnimationFrame(raf);
  renderFrame();
};

pvpService.onOpponentResigned = (message) => {
  if (cpuMode !== 'pvp') return;
  racing = false;
  acc = 0;
  result = 'WIN';
  cancelAnimationFrame(raf);
  renderFrame();
  alert(message);
};

pvpService.onOpponentLimbsChanged = (limbs) => {
  if (cpuMode !== 'pvp') return;
  const tf = makeTerrainFns(terrainData);
  const cpuColor = getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim() || '#e11d48';
  if (cpu) {
    cpu = replaceBody(cpu, limbs, cpuColor, tf.getTerrainH);
  }
  renderFrame();
};

pvpService.onRenderNeeded = () => {
  renderFrame();
};

// ─── 比赛控制 ──────────────────────────────────────────────────

/** 触发 PvP 全屏 3-2-1 起跑倒计时 */
function triggerPvPCountdown(seed, countdownMs = 3000) {
  pvpService.seed = seed;
  pvpService.canMove = false;
  startRace({ seed, fromNetwork: true });

  const countdownEl = document.getElementById('pvp-countdown');
  const countTextEl = document.getElementById('countdown-text');
  if (countdownEl && countTextEl) {
    countdownEl.classList.remove('hidden');
    let remaining = Math.max(1, Math.round(countdownMs / 1000));
    countTextEl.textContent = remaining;

    const interval = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        countTextEl.textContent = remaining;
      } else if (remaining === 0) {
        countTextEl.textContent = 'GO!';
        pvpService.canMove = true;
      } else {
        clearInterval(interval);
        countdownEl.classList.add('hidden');
      }
    }, 1000);
  } else {
    pvpService.canMove = true;
  }
}

/** 开始（或重新开始）一场比赛 */
function startRace(options = {}) {
  if (options.seed !== undefined) {
    pvpService.seed = options.seed;
  }
  terrainData = buildCourse(stage, { seed: (cpuMode === 'pvp' && pvpService.seed != null) ? pvpService.seed : undefined });
  const tf = makeTerrainFns(terrainData);

  const playerColor = getComputedStyle(document.documentElement).getPropertyValue('--player').trim() || '#2563eb';
  const cpuColor    = getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim() || '#e11d48';

  player = makeBody(drawpad.limbs, playerColor);

  if (cpuMode === 'pvp') {
    // 双人对战：对手形态由真实网络数据决定，若未绘制则为空手脚（无法移动）
    const initialOpponentLimbs = pvpService.opponentLimbs || { arm: [], leg: [] };
    cpu = makeBody(initialOpponentLimbs, cpuColor);
    cpu.speed = 1.0;
    pvpService.opponentSync.reset(cpu);
    pvpService.resetRaceState();
  } else {
    cpu = makeBody(CPU_ROUND, cpuColor);
    cpu.poseName = 'round';
    cpu.speed = (cpuMode === 'jev' || cpuMode === 'qwen') ? 1.0 : CPU_SPEED;
    aiController.reset();
  }

  placeAtStart(player, START_X, tf.getTerrainH);
  placeAtStart(cpu, START_X, tf.getTerrainH);

  raceTime = 0;
  lastTs = 0;
  acc = 0;
  racing = true;
  result = '';
  cpuDone = false;

  const aiBadgeText = cpuMode === 'pvp'
    ? '👥 PvP 对决'
    : cpuMode === 'qwen'
      ? '🧠 Qwen 手绘'
      : cpuMode === 'jev' ? '✨ Jev AI' : '⚙️ 规则';
  updateAiBadge(aiBadgeText, cpuMode === 'pvp' ? `房间: ${netClient.roomId || '对局中'}` : '');

  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

/** 比赛冲线结束处理 */
function finish() {
  racing = false;
  acc = 0;
  if (cpuMode === 'pvp') {
    if (!result) {
      result = cpuDone ? 'LOSE' : 'WIN';
    }
  } else {
    result = cpuDone ? 'LOSE' : 'WIN';
    if (cpuMode === 'qwen') {
      updateQwenHud(result === 'WIN' ? '🏁 比赛结束\n🏆 人类玩家获胜！' : '🏁 比赛结束\n👑 Qwen2.5 凭借力学优势获胜！');
    }
  }
  cancelAnimationFrame(raf);
  renderFrame();
}

// ─── 物理主循环 ────────────────────────────────────────────────

function frame(ts) {
  if (!racing || result) {
    acc = 0;
    renderFrame();
    return;
  }

  if (!lastTs) lastTs = ts;
  const elapsed = Math.min((ts - lastTs) / 1000, MAX_ACCUM);
  acc += elapsed;
  lastTs = ts;

  // PvP 倒计时未结束时锁死物理位移
  if (cpuMode === 'pvp' && !pvpService.canMove) {
    acc = 0;
    renderFrame();
    raf = requestAnimationFrame(frame);
    return;
  }

  const tf = makeTerrainFns(terrainData);

  while (acc >= DT) {
    stepBody(player, DT, tf);
    raceTime += DT;
    acc -= DT;

    if (!cpuDone) {
      stepBody(cpu, DT, tf);

      if (cpuMode === 'pvp') {
        pvpService.opponentSync.softAlign(cpu, DT);
      } else {
        cpu = aiController.step({
          cpu, player, terrainData, tf, dt: DT, raceTime, stage, racing, cpuDone,
        });
      }

      if (cpu.x >= terrainData.FINISH_X) cpuDone = true;
    }

    // 玩家冲线
    if (player.x >= terrainData.FINISH_X) {
      if (cpuMode === 'pvp') {
        netClient.sendFinish(raceTime);
      }
      finish();
      return;
    }
  }

  // 15Hz 向服务端广播物理位置同步帧
  if (cpuMode === 'pvp' && racing && (ts - pvpService.lastSyncTs >= 66)) {
    pvpService.lastSyncTs = ts;
    netClient.sendSyncFrame({
      x: Math.round(player.x * 10) / 10,
      y: Math.round(player.y * 10) / 10,
      vx: Math.round(player.vx * 10) / 10,
      vy: Math.round(player.vy * 10) / 10,
      j0a: Math.round((player.joints[0]?.a || 0) * 100) / 100,
      j1a: Math.round((player.joints[1]?.a || 0) * 100) / 100,
    });
  }

  renderFrame();
  raf = requestAnimationFrame(frame);
}

/** 渲染当前帧（支持从 pvpService 获取动态主按钮文案） */
function renderFrame() {
  const mainButtonLabel = cpuMode === 'pvp'
    ? pvpService.getMainButtonLabel({ result, currentStage: stage })
    : undefined;

  render(rctx, {
    player, cpu, raceTime, stage, result, hud, dpr,
    terrainData,
    STAGES, POOL, STAGE_NAMES,
    mainButtonLabel,
  });
}

// ─── 响应式画布尺寸 ────────────────────────────────────────────

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  raceCanvas.width = Math.round(window.innerWidth * dpr);
  raceCanvas.height = Math.round(window.innerHeight * dpr);
  renderFrame();
}
window.addEventListener('resize', resize);
resize();

// ─── HUD 点击处理与事件委托 ────────────────────────────────────

raceCanvas.addEventListener('click', e => {
  if (racing || !result) return;
  const r = raceCanvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const hit = k => hud[k] && x >= hud[k].x && x <= hud[k].x + hud[k].w
    && y >= hud[k].y && y <= hud[k].y + hud[k].h;

  if (hit('share')) {
    shareResult({
      player,
      stage,
      stageName: STAGE_NAMES[stage] ?? `第${stage + 1}关`,
      result,
      raceTime,
      cpuMode,
    });
  } else if (hit('restart')) {
    if (cpuMode === 'pvp') {
      pvpService.handleMainButtonClick({
        currentStage: stage,
        result,
        onReturnToMenu: () => {
          racing = false;
          result = '';
          cancelAnimationFrame(raf);
          window.__showStartOverlay?.();
          renderFrame();
        },
        onNextStageStarted: () => {
          renderFrame();
        },
      });
    } else {
      if (result === 'WIN') {
        stage = (stage + 1) % STAGES.length;
      }
      startRace();
    }
  }
});
