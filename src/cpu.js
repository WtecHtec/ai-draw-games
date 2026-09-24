/**
 * cpu.js —— CPU 对手 AI 模块
 *
 * 职责：
 *   - 定义 CPU 的预设姿势（圆轮、长腿、小轮、攀爬）
 *   - 根据当前位置查询应使用的姿势
 *   - CPU 以固定延迟（CPU_DELAY 秒）切换姿势，模拟"反应时间"
 */

import { SHOULDER, HIP } from './constants.js';

// ─── CPU 预设姿势（画板坐标系） ────────────────────────────────
// 每个姿势包含 arm（手臂笔划）和 leg（腿部笔划）
// 原理：每条笔划会被自动加入 180° 镜像，形成对称的双侧手脚

/**
 * 圆轮姿势（默认）
 * 手臂和腿各自构成半圆，镜像后成为完整圆轮。
 * 适合：平地、丘陵、水中
 */
export const CPU_ROUND = {
  arm: [[
    SHOULDER,
    { x: 176.1, y: 69.0 }, { x: 173.4, y: 75.5 }, { x: 169.1, y: 81.1 },
    { x: 163.5, y: 85.4 }, { x: 157.0, y: 88.1 }, { x: 150.0, y: 89.0 },
    { x: 143.0, y: 88.1 }, { x: 136.5, y: 85.4 }, { x: 130.9, y: 81.1 },
    { x: 126.6, y: 75.5 }, { x: 123.9, y: 69.0 }, { x: 123.0, y: 62.0 },
  ]],
  leg: [[
    HIP,
    { x: 188.6, y: 120.4 }, { x: 184.6, y: 130.0 }, { x: 178.3, y: 138.3 },
    { x: 170.0, y: 144.6 }, { x: 160.4, y: 148.6 }, { x: 150.0, y: 150.0 },
    { x: 139.6, y: 148.6 }, { x: 130.0, y: 144.6 }, { x: 121.7, y: 138.3 },
    { x: 115.4, y: 130.0 }, { x: 111.4, y: 120.4 }, { x: 110.0, y: 110.0 },
  ]],
};

/**
 * 长腿姿势（十字形）
 * 无手臂，腿部伸展成十字。
 * 适合：阶梯、小坑、大坑、水池、传送带、跨栏
 */
export const CPU_LONG = {
  arm: [],
  leg: [[ HIP, { x: 150, y: 178 }, HIP, { x: 210, y: 110 } ]],
};

/**
 * 小轮姿势（缩小版圆轮）
 * 比圆轮更小，可以通过低矮隧道。
 * 适合：隧道入口
 */
export const CPU_SMALL = {
  arm: [[
    SHOULDER,
    { x: 166.6, y: 68.9 }, { x: 162.7, y: 74.7 }, { x: 156.9, y: 78.6 },
    { x: 150.0, y: 80.0 }, { x: 143.1, y: 78.6 }, { x: 137.3, y: 74.7 },
    { x: 133.4, y: 68.9 }, { x: 132.0, y: 62.0 },
  ]],
  leg: [[
    HIP,
    { x: 172.2, y: 119.2 }, { x: 167.0, y: 127.0 }, { x: 159.2, y: 132.2 },
    { x: 150.0, y: 134.0 }, { x: 140.8, y: 132.2 }, { x: 133.0, y: 127.0 },
    { x: 127.8, y: 119.2 }, { x: 126.0, y: 110.0 },
  ]],
};

/**
 * 攀爬姿势
 * 短腿 + 超长手臂，用于攀爬高墙。
 * 适合：高墙、天花板+墙组合
 */
export const CPU_CLIMB = {
  arm: [[ SHOULDER, { x: 250, y: 62 } ]],
  leg: CPU_SMALL.leg,
};

/** 姿势名称 → 姿势对象的映射表 */
export const CPU_POSES = {
  round: CPU_ROUND,
  long:  CPU_LONG,
  small: CPU_SMALL,
  climb: CPU_CLIMB,
};

// ─── CPU 计划查询 ──────────────────────────────────────────────

/**
 * 根据 CPU 当前 X 坐标，查询应使用的姿势计划索引
 *
 * CPU_PLAN 是一个有序列表，每项格式为 { from: number, pose: string }，
 * 表示"当 X >= from 时切换到 pose 姿势"。
 * 查询返回当前满足条件的最后一项的索引。
 *
 * @param {object[]} cpuPlan - CPU 姿势计划数组（由 buildCourse 生成）
 * @param {number}   x       - CPU 当前 X 坐标
 * @returns {number} 计划索引
 */
export function cpuPlanIndex(cpuPlan, x) {
  let k = 0;
  for (let i = 0; i < cpuPlan.length; i++) {
    if (x >= cpuPlan[i].from) k = i;
  }
  return k;
}

/**
 * 根据当前物理地形与前方即将遭遇的障碍，智能选择系统规则最优解姿势
 *
 * 解决传统查 CPU_PLAN 可能落入过渡区 'round' 导致卡死的漏洞：
 * - 低矮隧道内：强制 'small'
 * - 高墙障碍前：强制 'climb'
 * - 阶梯/凹坑/深坑/跨栏/逆向传送带/泥沼/锯齿：强制 'long'
 * - 平地/丘陵/波浪/水池/颠簸/冰坡：'round'
 *
 * @param {object} terrainData - 关卡地形数据（包含 SECTIONS、CPU_PLAN 等）
 * @param {number} x           - CPU 当前 X 坐标
 * @param {object} [tf]        - 地形查询函数集合（包含 getCeiling 等）
 * @returns {'round'|'long'|'small'|'climb'} 最优姿势名称
 */
export function resolveOptimalPose(terrainData, x, tf) {
  // 1. 如果当前处于低矮隧道天花板下方，强制使用微缩轮
  if (tf && typeof tf.getCeiling === 'function' && tf.getCeiling(x) > -Infinity) {
    return 'small';
  }

  // 2. 检查前方 120px 内即将遭遇的障碍区段以及当前所在区段
  const currentSec = terrainData?.SECTIONS?.findLast(s => x >= s.from) ?? terrainData?.SECTIONS?.[0];
  const upcomingSec = terrainData?.SECTIONS?.find(s => s.from > x && s.from <= x + 120);

  // 障碍类型判断优先看即将到达的障碍（提前变形破障），若前方无障碍则看当前所在区段
  const targetSec = (upcomingSec && upcomingSec.type !== 'flat') ? upcomingSec : currentSec;
  const targetType = targetSec?.type || 'flat';

  if (targetType === 'tunnel') {
    return 'small';
  }

  if (targetType === 'wall') {
    return 'climb';
  }

  if (targetType === 'climb') {
    // climb 是天花板+高墙组合，如果在天花板下返回 small，否则在墙前返回 climb
    if (tf && typeof tf.getCeiling === 'function' && tf.getCeiling(x + 40) > -Infinity) {
      return 'small';
    }
    return 'climb';
  }

  if (['stairs', 'pits', 'bigpit', 'hurdles', 'belt', 'mud', 'sawtooth'].includes(targetType)) {
    return 'long';
  }

  if (['flat', 'hills', 'bumps', 'wave', 'ice', 'cliff', 'steep', 'water'].includes(targetType)) {
    return 'round';
  }

  // 兜底查 CPU_PLAN
  if (terrainData?.CPU_PLAN) {
    const k = cpuPlanIndex(terrainData.CPU_PLAN, x);
    return terrainData.CPU_PLAN[k]?.pose || 'long';
  }

  return 'round';
}
