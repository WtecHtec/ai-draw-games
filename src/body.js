/**
 * body.js —— 人体物理模型模块
 *
 * 职责：
 *   - 将画板上绘制的线条转换为物理对象（质量、转动惯量、碰撞半径）
 *   - 胴体（头 + 躯干）：只有平移，无旋转
 *   - 关节（肩 / 髋）：绕关节中心旋转的"轮子"，每条笔划 + 其 180° 镜像组成双侧手脚
 *
 * 设计原则：
 *   所有函数为纯函数（不依赖 DOM / canvas），便于单元测试。
 */

import {
  T, SCALE, M_PT,
  HEAD, SHOULDER, HIP, TORSO,
} from './constants.js';
import { samplePolyline, dist } from './physics.js';

// ─── 人体创建 ──────────────────────────────────────────────────

/**
 * 根据手脚笔划创建完整人体物理对象
 *
 * 人体结构：
 *   - 胴体（torsoPts）：躯干折线 + 头部圆周采样点的集合，仅平移
 *   - 关节[0]（肩）：手臂笔划绕肩关节旋转
 *   - 关节[1]（髋）：腿部笔划绕髋关节旋转
 *
 * 每条笔划会自动加入其 180° 镜像，形成左右对称手脚。
 *
 * @param {{ arm: number[][], leg: number[][] }} limbs
 *   - arm: 手臂笔划数组（画板坐标）
 *   - leg: 腿部笔划数组（画板坐标）
 * @param {string} color - 角色颜色（CSS 颜色字符串）
 * @returns {object} 物理对象
 */
export function makeBody(limbs, color) {
  // ── 构建胴体采样点（躯干 + 头部圆周） ──
  let tp = samplePolyline(TORSO, 9); // 躯干折线采样
  // 头部：12 个圆周点
  for (let i = 0; i < 12; i++) {
    const t = i / 12 * Math.PI * 2;
    tp.push({
      x: HEAD.x + Math.cos(t) * HEAD.r,
      y: HEAD.y + Math.sin(t) * HEAD.r,
    });
  }

  // 计算胴体质心（画板坐标系）
  let cx = 0, cy = 0;
  for (const p of tp) { cx += p.x; cy += p.y; }
  cx /= tp.length; cy /= tp.length;

  // 坐标变换：画板坐标 → 以质心为原点、缩放到世界坐标
  const tf = p => ({ x: (p.x - cx) * SCALE, y: (p.y - cy) * SCALE });

  const torsoPts  = tp.map(tf);
  const torsoLine = TORSO.map(tf);
  const head      = { ...tf(HEAD), r: HEAD.r * SCALE };

  // 胴体总质量 + 碰撞半径
  let m = M_PT * torsoPts.length;
  let rad = 0;
  for (const p of torsoPts) rad = Math.max(rad, Math.hypot(p.x, p.y) + T);

  // ── 构建关节（肩 / 髋） ──
  const joints = [];
  for (const [jointPt, strokes] of [[SHOULDER, limbs.arm], [HIP, limbs.leg]]) {
    const o   = tf(jointPt); // 关节在世界坐标系中的偏移（相对质心）
    const rel = p => ({      // 画板坐标 → 相对关节中心的世界坐标
      x: (p.x - jointPt.x) * SCALE,
      y: (p.y - jointPt.y) * SCALE,
    });

    // 每条笔划 + 其 180° 旋转镜像（产生对称的另一侧手脚）
    const mirrored = strokes.map(st =>
      st.map(p => ({ x: 2 * jointPt.x - p.x, y: 2 * jointPt.y - p.y }))
    );
    const allStrokes = [...strokes, ...mirrored];

    // 对所有笔划采样，得到关节下所有质点（相对关节中心）
    let pts = [];
    for (const st of allStrokes) {
      pts = pts.concat(samplePolyline(st, 9).map(rel));
    }

    // 计算转动惯量 I 和碰撞半径
    let I = 0, jr = 0;
    for (const p of pts) {
      I  += M_PT * (p.x * p.x + p.y * p.y);
      jr  = Math.max(jr, Math.hypot(p.x, p.y));
    }
    I += M_PT * pts.length * T * T / 2; // 线条厚度贡献的惯量

    m   += M_PT * pts.length;
    if (pts.length) rad = Math.max(rad, Math.hypot(o.x, o.y) + jr + T);

    joints.push({
      ox: o.x, oy: o.y,   // 关节中心相对胴体质心的偏移
      pts,                  // 质点列表（相对关节中心）
      lines: allStrokes.map(st => st.map(rel)), // 用于渲染的线段列表
      a: 0,                 // 当前转角（弧度）
      w: 0,                 // 当前角速度（弧度/秒）
      dir: 1,               // 旋转方向（+1 = 顺时针，-1 = 逆时针）
      I,
      invI: pts.length ? 1 / I : 0,
      rad: jr + T,          // 关节碰撞半径
      active: pts.length > 0,
    });
  }

  return {
    torsoPts,   // 胴体质点（世界坐标，相对质心）
    torsoLine,  // 胴体渲染折线
    head,       // 头部渲染参数
    joints,     // 关节数组（[0]=肩，[1]=髋）
    m,          // 总质量
    invM: 1 / m,
    rad,        // 整体碰撞半径（用于初始放置）
    color,      // 渲染颜色
    speed: 1,   // 角速度上限倍率（CPU 会设为 CPU_SPEED）
    x: 0, y: 0, // 世界位置
    vx: 0, vy: 0, // 世界速度
  };
}

/**
 * 替换角色的手脚笔划，同时保留当前运动状态
 * （用于比赛中途重绘 / CPU 换姿势）
 *
 * @param {object} old    - 当前物理对象（保留 x,y,vx,vy,speed 和关节角速度）
 * @param {object} limbs  - 新手脚笔划
 * @param {string} color  - 颜色
 * @param {function} getTerrainH - 获取地面高度的函数（用于防止新物体穿入地面）
 * @returns {object} 新物理对象
 */
export function replaceBody(old, limbs, color, getTerrainH) {
  const b = makeBody(limbs, color);
  b.speed = old.speed;
  b.x = old.x;
  b.vx = old.vx;
  b.vy = old.vy;
  // 保留关节角度和角速度（避免瞬间跳变）
  for (let i = 0; i < b.joints.length; i++) {
    b.joints[i].a = old.joints[i].a;
    b.joints[i].w = old.joints[i].w;
  }
  // 将 Y 放置在地面以上（防止新的更大碰撞半径导致穿地）
  const groundY = getTerrainH ? getTerrainH(old.x) : old.y;
  b.y = Math.min(old.y, groundY - b.rad - 1);
  return b;
}

/**
 * 将角色放置到起点
 * @param {object} b            - 物理对象
 * @param {number} startX       - 起始 X
 * @param {function} getTerrainH - 地面高度查询函数
 */
export function placeAtStart(b, startX, getTerrainH) {
  b.x  = startX;
  b.y  = getTerrainH(startX) - b.rad - 1;
  b.vx = 0;
  b.vy = 0;
}
