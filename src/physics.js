/**
 * physics.js —— 物理引擎模块
 *
 * 职责：
 *   - 刚体平移运动（重力、速度积分）
 *   - 关节旋转运动（马达驱动）
 *   - 水 / 泥浆浮力与阻力
 *   - 地面 / 天花板碰撞检测与响应
 *
 * 设计原则：
 *   所有函数为纯函数或接受明确参数，不读取全局变量，便于单元测试。
 *   地形数据通过 `terrainFns` 参数对象注入，测试时可传 mock。
 */

import { G, E, MU, BUOY, DRAG, MUD_BUOY, MUD_DRAG, M_PT, WMAX, POWER, T } from './constants.js';

// ─── 辅助几何函数 ──────────────────────────────────────────────

/**
 * 计算两点之间的欧氏距离
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {number}
 */
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 在折线上按固定间距等距采样点
 *
 * 算法：沿折线逐段行走，每隔 spacing 距离放一个采样点。
 *
 * @param {{x:number,y:number}[]} pts    - 折线原始顶点
 * @param {number}               spacing - 采样间距（像素）
 * @returns {{x:number,y:number}[]} 等距采样点列
 */
export function samplePolyline(pts, spacing) {
  const out = [{ ...pts[0] }];
  let carry = 0; // 上一段剩余距离
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = dist(a, b);
    if (L === 0) continue;
    let d = spacing - carry;
    while (d <= L) {
      // 在线段 [a,b] 上距 a 为 d 的位置插入采样点
      out.push({
        x: a.x + (b.x - a.x) * d / L,
        y: a.y + (b.y - a.y) * d / L,
      });
      d += spacing;
    }
    carry = L - (d - spacing);
  }
  return out;
}

// ─── 最近点查询（用于碰撞检测） ────────────────────────────────

/**
 * 在折线上查找距给定点 (px,py) 最近的点
 * 仅搜索索引 [i0-12, i0+12] 范围（避免 O(n) 全量搜索）
 *
 * @param {{x,y}[]} P       - 地形点列
 * @param {number}  px,py   - 查询点坐标
 * @param {number}  i0      - 该 x 对应的地形索引（terrainIndex 返回值）
 * @returns {{x:number, y:number, d:number}} 最近点坐标及距离
 */
export function closestOnPolyline(P, px, py, i0) {
  let best = Infinity, bx = px, by = 0;
  for (let i = Math.max(0, i0 - 12); i <= Math.min(P.length - 2, i0 + 12); i++) {
    const a = P[i], b = P[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let u = l2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
    u = Math.max(0, Math.min(1, u));
    const qx = a.x + dx * u, qy = a.y + dy * u;
    const d2 = (px - qx) ** 2 + (py - qy) ** 2;
    if (d2 < best) { best = d2; bx = qx; by = qy; }
  }
  return { x: bx, y: by, d: Math.sqrt(best) };
}

/**
 * 判断指定 X 附近是否存在天花板（±12 个采样点内）
 * 用于处理天花板侧面碰撞
 *
 * @param {number[]} CE - 天花板数组
 * @param {number}   i0 - 地形索引
 * @returns {boolean}
 */
export function ceilingNear(CE, i0) {
  for (let i = Math.max(0, i0 - 12); i <= Math.min(CE.length - 1, i0 + 12); i++) {
    if (CE[i] > -Infinity) return true;
  }
  return false;
}

// ─── 碰撞响应 ──────────────────────────────────────────────────

/**
 * 对单个碰撞点施加冲量（同时处理法向和切向摩擦）
 *
 * 物理原理：
 *   - 计算相对速度的法向分量 vn
 *   - 若 vn < 0（相互靠近），施加法向冲量 jn（含弹性系数 E）
 *   - 根据库仑摩擦模型计算切向冲量 jt（不超过 μ × jn）
 *   - 对位移做少量穿透修正（避免持续穿入）
 *
 * @param {object} b       - 物体状态（vx,vy,x,y,invM）
 * @param {number} px,py   - 碰撞点世界坐标
 * @param {object|null} j  - 关节对象（null 表示躯干无旋转点）
 * @param {number} nx,ny   - 碰撞法线（指向物体外侧）
 * @param {number} pen     - 穿透深度
 * @param {object|null} surf - 地面属性（影响传送带速度和摩擦系数）
 */
export function applyContact(b, px, py, j, nx, ny, pen, surf = null) {
  // 传送带速度和摩擦系数修正
  const belt = surf && surf.belt ? surf.belt * b.speed : 0;
  const muF  = surf && surf.mu  ? surf.mu              : 1;

  // 碰撞点相对质心的力臂
  const rx = j ? px - (b.x + j.ox) : 0;
  const ry = j ? py - (b.y + j.oy) : 0;
  const w = j ? j.w : 0, invI = j ? j.invI : 0;

  // 计算碰撞点速度（平移 + 旋转贡献）
  let vpx = b.vx - w * ry, vpy = b.vy + w * rx;

  // 法向相对速度（<0 表示正在接近）
  const vn = vpx * nx + vpy * ny;

  if (vn < 0) {
    // ── 法向冲量 ──
    const rn = rx * ny - ry * nx; // 力臂在法线方向的分量
    const kn = b.invM + rn * rn * invI; // 等效质量倒数
    const jn = -(1 + E) * vn / kn;
    b.vx += jn * nx * b.invM;
    b.vy += jn * ny * b.invM;
    if (j) j.w += rn * jn * invI;

    // ── 切向摩擦冲量 ──
    const tx = -ny, ty = nx; // 切线方向（垂直于法线）
    const w2 = j ? j.w : 0;
    vpx = b.vx - w2 * ry; vpy = b.vy + w2 * rx;
    const vt = (vpx - belt) * tx + vpy * ty; // 相对传送带的切向速度
    const rt = rx * ty - ry * tx;
    const kt = b.invM + rt * rt * invI;
    let jt = -vt / kt;
    const lim = MU * muF * jn; // 库仑摩擦上限
    jt = Math.max(-lim, Math.min(lim, jt));
    b.vx += jt * tx * b.invM;
    b.vy += jt * ty * b.invM;
    if (j) j.w += rt * jt * invI;
  }

  // 穿透修正：小幅移动物体以减少穿入（最大修正量限制为 8px 防抖动）
  const corr = Math.min(pen, 8) * 0.4;
  b.x += nx * corr;
  b.y += ny * corr;
}

/**
 * 处理单个质点与地形（地面 + 天花板）的碰撞
 *
 * @param {object} b        - 物体状态
 * @param {number} px,py    - 质点世界坐标
 * @param {object|null} j   - 关节（null=躯干）
 * @param {object} terrainFns - 地形查询函数集合：
 *   { getHA, getCE, getWL, getSF, TP, CPL, getTerrainIndex }
 */
export function contact(b, px, py, j, terrainFns) {
  const { getCeiling, ceilingNearFn, TP, CPL, getTerrainH, getTerrainIndex, getSurface } = terrainFns;

  const i0 = getTerrainIndex(px);

  // ── 天花板碰撞（隧道 / 天花板区段） ──
  const c = getCeiling(px);
  if (py - T - 4 < c || ceilingNearFn(i0)) {
    const inside = py < c; // 点是否已穿入天花板上方
    const cp = closestOnPolyline(CPL, px, py, i0);
    const cpen = inside ? cp.d + T : T - cp.d;
    if (cpen > 0) {
      let nx, ny;
      if (cp.d < 1e-6) { nx = 0; ny = 1; }
      else if (inside)  { nx = (cp.x - px) / cp.d; ny = (cp.y - py) / cp.d; }
      else              { nx = (px - cp.x) / cp.d; ny = (py - cp.y) / cp.d; }
      applyContact(b, px, py, j, nx, ny, cpen, null);
    }
  }

  // ── 地面碰撞 ──
  const h = getTerrainH(px);
  if (py + T + 4 < h) return; // 距地面足够远，跳过
  const inside = py > h;
  const cp = closestOnPolyline(TP, px, py, i0);
  const pen = inside ? cp.d + T : T - cp.d;
  if (pen <= 0) return;
  let nx, ny;
  if (cp.d < 1e-6) { nx = 0; ny = -1; }
  else if (inside)  { nx = (cp.x - px) / cp.d; ny = (cp.y - py) / cp.d; }
  else              { nx = (px - cp.x) / cp.d; ny = (py - cp.y) / cp.d; }
  applyContact(b, px, py, j, nx, ny, pen, getSurface(px));
}

// ─── 主物理步进 ────────────────────────────────────────────────

/**
 * 推进物体物理状态一个时间步
 *
 * 执行顺序：
 *   1. 重力积分（vy += G*dt）
 *   2. 空气阻力（微小水平阻尼）
 *   3. 关节马达驱动（角速度积分）
 *   4. 位移积分
 *   5. 水 / 泥浮力与阻力（所有质点）
 *   6. 碰撞检测与响应（所有质点）
 *
 * @param {object} b     - 物体状态（会被原地修改）
 * @param {number} dt    - 时间步长（秒）
 * @param {object} terrainFns - 地形查询函数集合（同 contact 参数）
 */
export function stepBody(b, dt, terrainFns) {
  // 1. 重力
  b.vy += G * dt;

  // 2. 水平空气阻尼（防止无限加速）
  b.vx *= 1 - 0.03 * dt;

  // 3. 关节马达：驱动旋转，但限制最大角速度
  for (const j of b.joints) {
    if (!j.active) continue;
    if (j.w * j.dir < WMAX * b.speed) {
      j.w += j.dir * POWER * G * b.m * j.rad * j.invI * dt;
    }
    j.a += j.w * dt; // 角度积分
  }

  // 4. 位移积分
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // 预先统计总质点数（用于浮力均摊）
  const nPts = b.torsoPts.length + b.joints.reduce((n, j) => n + j.pts.length, 0);

  /**
   * 对单个质点施加水 / 泥的浮力和阻力
   * @param {number} px,py   - 质点世界坐标
   * @param {object|null} j  - 所属关节（null=躯干）
   */
  const applyWater = (px, py, j) => {
    const { getWaterLevel, getSurface } = terrainFns;
    if (py < getWaterLevel(px)) return; // 质点在水面以上，无影响
    const sf = getSurface(px);
    const mud = sf && sf.mud;
    // 浮力：向上的力（泥浆浮力小于水，角色会下沉）
    b.vy -= G * (mud ? MUD_BUOY : BUOY) / nPts * dt;
    // 阻力：与速度反向，旋转的手脚可以产生推进力
    const rx = j ? px - (b.x + j.ox) : 0;
    const ry = j ? py - (b.y + j.oy) : 0;
    const w = j ? j.w : 0;
    const vpx = b.vx - w * ry, vpy = b.vy + w * rx;
    const dr = mud ? MUD_DRAG : DRAG;
    const fx = -dr * M_PT * vpx * dt;
    const fy = -dr * M_PT * vpy * dt;
    b.vx += fx * b.invM;
    b.vy += fy * b.invM;
    if (j) j.w += (rx * fy - ry * fx) * j.invI;
  };

  // 5. 水 / 泥处理（躯干质点 + 各关节质点）
  for (const v of b.torsoPts) {
    applyWater(b.x + v.x, b.y + v.y, null);
  }
  for (const j of b.joints) {
    const c = Math.cos(j.a), s = Math.sin(j.a);
    for (const v of j.pts) {
      applyWater(
        b.x + j.ox + v.x * c - v.y * s,
        b.y + j.oy + v.x * s + v.y * c,
        j,
      );
    }
  }

  // 6. 碰撞（躯干质点 + 各关节质点）
  for (const v of b.torsoPts) {
    contact(b, b.x + v.x, b.y + v.y, null, terrainFns);
  }
  for (const j of b.joints) {
    const c = Math.cos(j.a), s = Math.sin(j.a);
    for (const v of j.pts) {
      contact(
        b,
        b.x + j.ox + v.x * c - v.y * s,
        b.y + j.oy + v.x * s + v.y * c,
        j,
        terrainFns,
      );
    }
  }
}
