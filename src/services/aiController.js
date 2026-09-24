/**
 * aiController.js —— CPU 对手 AI 智能决策与状态机服务
 *
 * 职责：
 *   - 负责协调 CPU 对手在单人模式下的决策行为
 *   - 规则 AI：区段与几何形态匹配（resolveOptimalPose / CPU_PLAN）
 *   - TypeSafe Jev AI：物理快照推演与端云协同形态
 *   - 端侧 Qwen WebLLM：前瞻障碍手绘、连续受阻重绘与强力脱困
 *   - 卡阻检测与应急防御：超时自动切换形态与脱困冲量
 */

import { CPU_ROUND, CPU_POSES, cpuPlanIndex, resolveOptimalPose } from '../cpu.js';
import { replaceBody } from '../body.js';
import { queryCpuAI, buildSnapshot } from '../typesafe.js';
import { generateLimbsWithQwen } from '../llm/webllm.js';
import { STAGES, STAGE_NAMES } from '../terrain.js';

/** 需要调用 WebLLM 破障的真实阻碍地形 */
export const OBSTACLE_TYPES = new Set([
  'stairs', 'pits', 'bigpit', 'hurdles', 'wall', 'climb', 'tunnel', 'sawtooth', 'belt', 'mud', 'water',
]);

export class AIController {
  constructor() {
    this.cpuMode = 'system'; // 'system' | 'jev' | 'qwen'
    this.typesafeApiKey = '';
    this.typesafeBffUrl = '';

    this.aiPending = false;
    this.cpuStuckDuration = 0;
    this.cpuMaxX = 0;
    this.cpuInSystemFallback = false;
    this.qwenStuckRetries = 0;
    this.qwenLastStuckX = 0;
    this.qwenSecIdx = 0;

    this.onUpdateBadge = null;
    this.onUpdateQwenHud = null;
  }

  init({ cpuMode, typesafeApiKey, typesafeBffUrl, onUpdateBadge, onUpdateQwenHud }) {
    this.cpuMode = cpuMode || 'system';
    this.typesafeApiKey = typesafeApiKey || '';
    this.typesafeBffUrl = typesafeBffUrl || '';
    this.onUpdateBadge = onUpdateBadge;
    this.onUpdateQwenHud = onUpdateQwenHud;
    this.reset();
  }

  setMode(mode) {
    this.cpuMode = mode;
    this.reset();
  }

  setApiKey(key, bffUrl = '') {
    this.typesafeApiKey = key;
    this.typesafeBffUrl = bffUrl;
  }

  reset() {
    this.aiPending = false;
    this.cpuStuckDuration = 0;
    this.cpuMaxX = 0;
    this.cpuInSystemFallback = false;
    this.qwenStuckRetries = 0;
    this.qwenLastStuckX = 0;
    this.qwenSecIdx = 0;
  }

  /**
   * 物理帧步进心跳（在每一物理步中运行）
   * @returns {object} 返回更新后的 cpu 物理对象
   */
  step({ cpu, player, terrainData, tf, dt, raceTime, stage, racing, cpuDone }) {
    if (this.cpuMode === 'pvp') return cpu; // PvP 模式不由 AIController 接管

    const k = cpuPlanIndex(terrainData.CPU_PLAN, cpu.x);

    // ─── 卡住检测（位移小于 8 像素） ───
    if (cpu.x > this.cpuMaxX + 8) {
      this.cpuMaxX = cpu.x;
      this.cpuStuckDuration = 0;
      if (cpu.x > this.qwenLastStuckX + 80) {
        this.qwenStuckRetries = 0;
      }
    } else {
      this.cpuStuckDuration += dt;
    }

    const cpuColor = getComputedStyle(document.documentElement).getPropertyValue('--cpu').trim() || '#e11d48';

    // ─── 兜底机制：Jev 模式下若卡住 6 秒，切入系统规则兜底 ───
    if (this.cpuMode === 'jev' && !this.cpuInSystemFallback && this.cpuStuckDuration >= 6.0) {
      this.cpuInSystemFallback = true;
      const systemPose = terrainData.CPU_PLAN[k]?.pose || 'long';
      cpu = replaceBody(cpu, CPU_POSES[systemPose], cpuColor, tf.getTerrainH);
      cpu.speed = 1.0;
      this.cpuStuckDuration = 0;
      this.cpuMaxX = cpu.x;
      this.onUpdateBadge?.('⚙️ 系统(兜底)');
    }

    // ─── Qwen 模式卡住应急处理 ───
    if (this.cpuMode === 'qwen' && !this.cpuInSystemFallback && this.cpuStuckDuration >= 2.5 && !this.aiPending) {
      if (Math.abs(cpu.x - this.qwenLastStuckX) > 60) {
        this.qwenStuckRetries = 0;
        this.qwenLastStuckX = cpu.x;
      }
      this.qwenStuckRetries++;
      this.cpuStuckDuration = 0;
      this.cpuMaxX = cpu.x;

      const currentSec = terrainData.SECTIONS.findLast(s => cpu.x >= s.from) ?? terrainData.SECTIONS[0];
      const slopeVal = (tf.getTerrainH(cpu.x + 15) - tf.getTerrainH(cpu.x - 15)) / 30;
      const hasSlope = Math.abs(slopeVal) > 0.08;
      const inWater = tf.getWaterLevel(cpu.x) < tf.getTerrainH(cpu.x) && cpu.y > tf.getWaterLevel(cpu.x);
      const inTunnel = tf.getCeiling(cpu.x) > -Infinity;

      if (this.qwenStuckRetries >= 3) {
        // 连续 3 次受阻：直接纯净使用系统最佳规则模版强力脱困
        this.cpuInSystemFallback = true;
        const systemPose = resolveOptimalPose(terrainData, cpu.x, tf);
        cpu = replaceBody(cpu, CPU_POSES[systemPose], cpuColor, tf.getTerrainH);
        cpu.poseName = systemPose;
        cpu.speed = 1.25;
        if (systemPose === 'round') cpu.vx += 30;

        this.onUpdateBadge?.('⚙️ 系统(脱困)', `连续3次受阻，直接使用系统规则模版(${systemPose})`);
        this.onUpdateQwenHud?.(`⚠️ 连续3次受阻，直接使用系统【${systemPose}】模版强力脱困\n🚗 越过障碍后自动恢复 WebLLM`);
      } else {
        this.aiPending = true;
        this.onUpdateBadge?.('🧠 紧急破障', `卡阻重绘(${this.qwenStuckRetries}/3)`);
        this.onUpdateQwenHud?.(`⚠️ 卡阻停滞(第${this.qwenStuckRetries}/3次)！\n💥 正在重绘当前场景最优解形态...`);

        generateLimbsWithQwen({
          currentSection: currentSec.type,
          targetSection: currentSec.type,
          isStuck: true,
          stuckCount: this.qwenStuckRetries,
          hasSlope,
          slopeDesc: slopeVal > 0.1 ? '下坡俯冲' : (slopeVal < -0.1 ? '上坡爬坡' : '起伏坡度'),
          inWater,
          inTunnel,
          speed: Math.round(cpu.vx),
        }).then(qwenLimbs => {
          this.aiPending = false;
          if (!racing || cpuDone) return;
          cpu = replaceBody(cpu, qwenLimbs, cpuColor, tf.getTerrainH);
          cpu.speed = 1.15;
          this.onUpdateBadge?.('🧠 Qwen 手绘', qwenLimbs.thought || 'Qwen 破障手绘');
          this.onUpdateQwenHud?.(`📍 应急脱困：${currentSec.type}\n🎯 决策：${qwenLimbs.thought}\n⚡ 爆发推进翻越中`);
        }).catch(() => {
          this.aiPending = false;
        });
      }
    }

    // ─── Qwen 模式系统兜底中二次防护 ───
    if (this.cpuMode === 'qwen' && this.cpuInSystemFallback && this.cpuStuckDuration >= 2.0) {
      this.cpuStuckDuration = 0;
      this.cpuMaxX = cpu.x;
      const currentSec = terrainData.SECTIONS.findLast(s => cpu.x >= s.from) ?? terrainData.SECTIONS[0];
      const currentType = currentSec.type;
      const slopeVal = (tf.getTerrainH(cpu.x + 15) - tf.getTerrainH(cpu.x - 15)) / 30;
      const hasSlope = Math.abs(slopeVal) > 0.08;
      const inWater = tf.getWaterLevel(cpu.x) < tf.getTerrainH(cpu.x) && cpu.y > tf.getWaterLevel(cpu.x);

      let altPose = 'long';
      if (hasSlope || inWater || ['flat', 'hills', 'wave', 'ice', 'water'].includes(currentType)) {
        altPose = 'round';
        cpu.vx += 35;
      } else if (currentType === 'wall' || currentType === 'climb') {
        altPose = 'climb';
        cpu.vy -= 40;
      } else if (currentType === 'tunnel') {
        altPose = 'small';
      } else {
        altPose = (cpu.poseName === 'long') ? 'climb' : 'long';
        cpu.vy -= 25;
      }

      cpu = replaceBody(cpu, CPU_POSES[altPose], cpuColor, tf.getTerrainH);
      cpu.poseName = altPose;
      cpu.speed = 1.35;
      this.onUpdateBadge?.('⚙️ 强力脱困');
      this.onUpdateQwenHud?.(`⚠️ 兜底强化：采用系统纯正【${altPose}】模版脱困！`);
    }

    // ─── Jev 模式重试查询 ───
    if (this.cpuMode === 'jev' && this.cpuInSystemFallback && this.cpuStuckDuration >= 1.5 && !this.aiPending) {
      this.aiPending = true;
      const planPose = terrainData.CPU_PLAN[k]?.pose;
      const snap = buildSnapshot({
        cpu, player, terrainData, raceTime, stage,
        STAGE_NAMES, STAGES,
        waterLevelFn: tf.getWaterLevel,
        ceilingFn: tf.getCeiling,
        planPose,
      });
      queryCpuAI(snap, this.typesafeApiKey, this.typesafeBffUrl)
        .then(res => {
          this.aiPending = false;
          if (!racing || cpuDone) return;
          if (res?.pose) {
            this.cpuInSystemFallback = false;
            cpu = replaceBody(cpu, CPU_POSES[res.pose], cpuColor, tf.getTerrainH);
            cpu.speed = res.boost ? 1.25 : 1.0;
            this.cpuStuckDuration = 0;
            this.cpuMaxX = cpu.x;
            this.onUpdateBadge?.('✨ Jev AI');
          }
        });
    }

    // ─── Qwen 模式：遭遇下一个障碍前精准触发 WebLLM 决策 ───
    if (this.cpuMode === 'qwen' && !this.aiPending) {
      const nextSecIdx = this.qwenSecIdx + 1;
      const nextSec = terrainData.SECTIONS[nextSecIdx];
      if (nextSec && (nextSec.from - cpu.x) <= 2) {
        this.qwenSecIdx = nextSecIdx;
        this.cpuInSystemFallback = false;
        this.qwenStuckRetries = 0;
        this.qwenLastStuckX = cpu.x;

        const currentSec = terrainData.SECTIONS.findLast(s => cpu.x >= s.from) ?? terrainData.SECTIONS[0];
        const targetSecType = nextSec.type;
        const isObstacle = OBSTACLE_TYPES.has(targetSecType);

        if (isObstacle) {
          this.aiPending = true;
          const distToUpcoming = Math.max(0, nextSec.from - cpu.x);
          const slopeVal = (tf.getTerrainH(cpu.x + 15) - tf.getTerrainH(cpu.x - 15)) / 30;
          const hasSlope = Math.abs(slopeVal) > 0.08;
          const inWater = tf.getWaterLevel(cpu.x) < tf.getTerrainH(cpu.x) && cpu.y > tf.getWaterLevel(cpu.x);
          const inTunnel = tf.getCeiling(cpu.x) > -Infinity;

          this.onUpdateBadge?.('🧠 思考中...');
          this.onUpdateQwenHud?.(`📍 遭遇阻碍：${targetSecType}\n💭 正在推演克制障碍最优解...`);

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
            this.aiPending = false;
            if (!racing || cpuDone) return;
            cpu = replaceBody(cpu, qwenLimbs, cpuColor, tf.getTerrainH);
            cpu.speed = 1.0;
            this.onUpdateBadge?.('🧠 Qwen 手绘', qwenLimbs.thought || 'Qwen 手绘');
            this.onUpdateQwenHud?.(`📍 障碍变身：${targetSecType}\n🎯 最优解：${qwenLimbs.thought}\n🚀 全速进攻超越中`);
          }).catch(err => {
            this.aiPending = false;
            const pose = resolveOptimalPose(terrainData, cpu.x, tf);
            cpu = replaceBody(cpu, CPU_POSES[pose], cpuColor, tf.getTerrainH);
            cpu.poseName = pose;
            this.onUpdateBadge?.('⚙️ 系统(兜底)');
            this.onUpdateQwenHud?.(`📍 阻碍地形：${targetSecType}\n⚠️ 降级使用规则姿势（${pose}）`);
          });
        } else {
          // 开阔路段：恢复圆轮疾驰
          cpu = replaceBody(cpu, CPU_ROUND, cpuColor, tf.getTerrainH);
          cpu.poseName = 'round';
          cpu.speed = 1.0;
        }
      }
    }

    return cpu;
  }
}

export const aiController = new AIController();
