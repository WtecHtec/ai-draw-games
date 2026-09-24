/**
 * terrain.js —— 地形生成模块
 *
 * 职责：
 *   - 定义所有地形区段（丘陵、阶梯、隧道、水池等）
 *   - 按关卡序号生成高度图、天花板图、水位图、地面属性图
 *   - 提供纯函数查询接口（terrain / waterLevel / surfaceAt / ceiling）
 *
 * 设计原则：
 *   所有导出函数均为纯函数，不依赖全局状态，便于单元测试。
 */

import { STEP_H, TUNNEL_H, TSTEP } from './constants.js';

// ─── 关卡定义 ──────────────────────────────────────────────────
/**
 * 地形区段池（全部可用区段）
 *
 * 字段说明：
 *   type   - 区段类型标识符
 *   len    - 区段水平长度（像素，部分类型自动计算）
 *   label  - 中文显示名称
 *   block  - CPU 在此区段前切换的姿势名称（undefined 表示无需切换）
 */
export const POOL = [
  { type: 'hills',    len: 800,                              label: '丘陵' },
  { type: 'stairs',   n: 3, h: STEP_H, gap: 100,            label: '阶梯',    block: 'long' },
  { type: 'bumps',    len: 500, amp: 10, period: 36,         label: '颠簸路' },
  { type: 'pits',     n: 2, w: 70, d: 30, gap: 120,         label: '小坑',    block: 'long' },
  { type: 'bigpit',   w: 110, d: 60,                         label: '大坑',    block: 'long' },
  { type: 'wave',     len: 600, dh: 90,                      label: '大波浪' },
  { type: 'sawtooth', n: 4, len: 90, h: 45,                  label: '锯齿坡' },
  { type: 'tunnel',   len: 360,                              label: '隧道',    block: 'small' },
  { type: 'hurdles',  n: 3, h: 26, w: 12, gap: 90,          label: '跨栏',    block: 'long' },
  { type: 'cliff',    dh: 130,                               label: '跳崖' },
  { type: 'steep',    len: 220, dh: -110,                    label: '急坡' },
  { type: 'water',    len: 720, d: 140,                      label: '水池',    block: 'long' },
  { type: 'wall',     h: 90,                                 label: '高墙',    block: 'climb' },
  { type: 'climb',    h: 80, tunnel: 260,                    label: '天花板+墙', block: 'climb' },
  { type: 'belt',     len: 420, speed: -200,                 label: '逆向传送带', block: 'long' },
  { type: 'ice',      len: 520, dh: -140, mu: 0.3,           label: '冰坡' },
  { type: 'mud',      len: 400, d: 60,                       label: '泥沼',    block: 'long' },
];

/**
 * 固定关卡序列（5个关卡，难度递增）
 * 每个关卡是一组区段 type 的有序列表
 */
export const STAGES = [
  // 关卡 1【新手】：基础地形，无水无泥，感受滚轮操控
  ['hills', 'bumps', 'stairs', 'pits', 'sawtooth', 'hills'],

  // 关卡 2【初级】：引入传送带和跨栏，需要调整旋转速度
  ['bumps', 'hurdles', 'wave', 'belt', 'bigpit', 'cliff', 'steep'],

  // 关卡 3【中级】：引入水池和冰坡，需要不同形状应对
  ['hills', 'water', 'ice', 'wall', 'stairs', 'hurdles', 'sawtooth', 'wave'],

  // 关卡 4【高级】：隧道、泥沼、组合关卡，需要多次策略调整
  ['wave', 'tunnel', 'mud', 'sawtooth', 'climb', 'pits', 'water', 'belt', 'stairs', 'cliff'],

  // 关卡 5【大师】：全障碍混合，全程无喘息，考验极限操控
  ['ice', 'tunnel', 'mud', 'cliff', 'wall', 'water', 'hurdles', 'belt',
   'sawtooth', 'climb', 'bigpit', 'stairs', 'steep', 'wave'],
];

/**
 * 关卡难度名称（与 STAGES 一一对应），用于 HUD 结果面板显示
 */
export const STAGE_NAMES = ['新手', '初级', '中级', '高级', '大师'];

// ─── 地形构建 ──────────────────────────────────────────────────
/**
 * 根据关卡序号构建完整地形数据
 *
 * @param {number} stage - 关卡序号（0-based）
 * @returns {{
 *   HA: number[],        高度图（地面 Y 坐标数组）
 *   CE: number[],        天花板图（无天花板处为 -Infinity）
 *   WL: number[],        水位图（无水处为 Infinity）
 *   SF: (object|null)[], 地面属性图（null = 普通，{belt,mu,mud}）
 *   TP: {x,y}[],        地形点列（用于最近点碰撞）
 *   CPL: {x,y}[],       天花板点列
 *   SECTIONS: object[], 可视区段信息（label, from, to, type）
 *   CPU_PLAN: object[], CPU 姿势切换计划
 *   FINISH_X: number    终点 X 坐标
 * }}
 */
export function buildCourse(stage) {
  const HA = [];   // 地面高度数组
  const CE = [];   // 天花板高度数组
  const WL = [];   // 水位数组
  const SF = [];   // 地面属性数组
  const SECTIONS = [];
  const CPU_PLAN = [{ from: 0, pose: 'round' }]; // 初始姿势：圆轮

  // 构建课程：前置平地 → 各区段 + 过渡平地 → 末尾平地
  const course = [{ type: 'flat', len: 300 }];
  for (const type of STAGES[stage]) {
    course.push(POOL.find(c => c.type === type));
    course.push({ type: 'flat', len: 90 });
  }
  course.push({ type: 'flat', len: 60 });

  let x = 0;
  let y = 300;  // 初始地面高度（世界坐标 Y 轴向下为正）
  let surf = null; // 当前地面属性（传送带/冰/泥）

  /**
   * 向高度图数组追加若干采样点
   * @param {number} len       - 区段长度（像素）
   * @param {function} f       - f(t) → 地面Y，t 从 0 到 len
   * @param {function|null} ceil - 天花板Y函数（无则 null）
   * @param {number|undefined} water - 水面Y（无则 Infinity）
   */
  const push = (len, f, ceil = null, water = undefined) => {
    for (let i = 0; i < len / TSTEP; i++) {
      HA.push(f(i * TSTEP));
      CE.push(ceil ? ceil(i * TSTEP) : -Infinity);
      WL.push(water === undefined ? Infinity : water);
      SF.push(surf);
    }
    x += len;
  };

  // 丘陵波形函数（叠加三个正弦波产生自然起伏）
  const hillF = t =>
    30 * Math.sin(t / 190) +
    12 * Math.sin(t / 80 + 1.3) +
     5 * Math.sin(t / 40 + 2.1);

  // ─ 逐个区段生成地形 ─
  for (const c of course) {
    const from = x;

    if (c.type === 'flat') {
      // 平地
      push(c.len, () => y);

    } else if (c.type === 'hills') {
      // 丘陵：正弦叠加起伏
      const L = c.len, y0 = y;
      push(L, t => y0 + Math.sin(Math.PI * t / L) * hillF(t));

    } else if (c.type === 'bumps') {
      // 颠簸路：小幅余弦波
      const y0 = y;
      push(c.len, t => y0 - c.amp * (1 - Math.cos(t / c.period * Math.PI * 2)) / 2);

    } else if (c.type === 'wave') {
      // 大波浪：单个半余弦波（先升后降）
      const y0 = y, L = c.len;
      push(L, t => y0 - c.dh * (1 - Math.cos(t / L * Math.PI * 2)) / 2);

    } else if (c.type === 'sawtooth') {
      // 锯齿坡：多段线性上坡
      for (let k = 0; k < c.n; k++) {
        const y0 = y;
        push(c.len, t => y0 - c.h * t / c.len);
      }

    } else if (c.type === 'steep') {
      // 急坡：线性下坡
      const y0 = y, L = c.len;
      push(L, t => y0 + c.dh * t / L);
      y += c.dh;

    } else if (c.type === 'cliff') {
      // 跳崖：突然下降一个高度差
      push(40, () => y);
      y += c.dh;
      push(40, () => y);

    } else if (c.type === 'stairs') {
      // 阶梯：多级台阶，之后缓坡恢复原高度
      for (let k = 0; k < c.n; k++) {
        y -= c.h;
        push(c.gap, () => y);
      }
      const y1 = y;
      push(300, t => y1 + c.n * c.h * t / 300);
      y += c.n * c.h;

    } else if (c.type === 'pits') {
      // 小坑：多个沟槽
      const y0 = y;
      for (let k = 0; k < c.n; k++) {
        push(c.gap, () => y0);
        push(c.w,   () => y0 + c.d);
      }
      push(c.gap, () => y0);

    } else if (c.type === 'bigpit') {
      // 大坑：单个宽深沟槽
      const y0 = y;
      push(80,   () => y0);
      push(c.w,  () => y0 + c.d);
      push(80,   () => y0);

    } else if (c.type === 'tunnel') {
      // 隧道：有天花板的平地区段
      const y0 = y;
      push(60,    () => y0);
      push(c.len, () => y0, () => y0 - TUNNEL_H);
      push(60,    () => y0);

    } else if (c.type === 'hurdles') {
      // 跨栏：多个凸起障碍
      const y0 = y;
      for (let k = 0; k < c.n; k++) {
        push(c.gap, () => y0);
        push(c.w,   () => y0 - c.h);
      }
      push(c.gap, () => y0);

    } else if (c.type === 'wall') {
      // 高墙：需要攀爬的陡峭台阶
      push(60, () => y);
      y -= c.h;
      push(160, () => y);
      const y1 = y;
      push(300, t => y1 + c.h * t / 300);
      y += c.h;

    } else if (c.type === 'climb') {
      // 天花板+墙：低隧道后紧接高墙（需要先缩小再伸展）
      const y0 = y;
      push(60, () => y0);
      push(c.tunnel, () => y0, () => y0 - TUNNEL_H);
      push(180, () => y0);
      c.wallX = x; // 记录墙壁起始 X，供 CPU 计划使用
      y -= c.h;
      push(160, () => y);
      const y1 = y;
      push(300, t => y1 + c.h * t / 300);
      y += c.h;

    } else if (c.type === 'belt') {
      // 逆向传送带：地面向后流动，旋转快的轮子有优势
      surf = { belt: c.speed };
      push(c.len, () => y);
      surf = null;

    } else if (c.type === 'ice') {
      // 冰坡：低摩擦上坡，普通棒腿会滑落
      const y0 = y, L = c.len;
      surf = { mu: c.mu };
      push(L, t => y0 + c.dh * t / L);
      surf = null;
      y += c.dh;

    } else if (c.type === 'mud') {
      // 泥沼：向下沉，长腿可以拨泥前进，圆轮容易陷入
      const y0 = y;
      surf = { mud: true };
      push(60,          t => y0 + c.d * t / 60,           null, y0);
      push(c.len - 180, () => y0 + c.d,                   null, y0);
      push(120,         t => y0 + c.d * (1 - t / 120),    null, y0);
      surf = null;

    } else if (c.type === 'water') {
      // 水池：深水区，旋转手脚可以划水推进
      const y0 = y, d = c.d;
      push(60,          t => y0 + d * t / 60,          null, y0);
      push(c.len - 360, () => y0 + d,                  null, y0);
      push(300,         t => y0 + d * (1 - t / 300),   null, y0);
    }

    // 记录区段信息（用于 HUD 显示和 CPU 计划）
    if (c.label) SECTIONS.push({ from, to: x, label: c.label, type: c.type });

    // 生成 CPU 姿势切换计划
    if (c.type === 'climb') {
      CPU_PLAN.push({ from: from - 70,   pose: 'small' });
      CPU_PLAN.push({ from: c.wallX - 100, pose: 'climb' });
      CPU_PLAN.push({ from: x + 20,      pose: 'round' });
    } else if (c.block) {
      CPU_PLAN.push({ from: from - 70, pose: c.block });
      CPU_PLAN.push({ from: x + 20,   pose: 'round' });
    }
  }

  const FINISH_X = x;
  const yEnd = y;

  // 终点后追加长平地（防止越界）
  push(900, () => yEnd);

  // 构建点列（供碰撞检测使用）
  const TP  = HA.map((yy, i) => ({ x: i * TSTEP, y: yy }));
  const CPL = CE.map((yy, i) => ({ x: i * TSTEP, y: yy > -Infinity ? yy : -3000 }));

  return { HA, CE, WL, SF, TP, CPL, SECTIONS, CPU_PLAN, FINISH_X };
}

// ─── 查询函数（纯函数，便于单元测试） ────────────────────────────

/**
 * 查询指定 X 处的地面高度
 * @param {number[]} HA - 高度图数组
 * @param {number} x    - 世界 X 坐标
 * @returns {number} 地面 Y（向下为正）
 */
export function terrain(HA, x) {
  const i = Math.max(0, Math.min(HA.length - 1, Math.floor(x / TSTEP)));
  return HA[i];
}

/**
 * 查询指定 X 处的水面高度
 * @param {number[]} WL - 水位图数组
 * @param {number} x    - 世界 X 坐标
 * @returns {number} 水面 Y（Infinity 表示无水）
 */
export function waterLevel(WL, x) {
  const i = Math.max(0, Math.min(WL.length - 1, Math.floor(x / TSTEP)));
  return WL[i];
}

/**
 * 查询指定 X 处的地面属性
 * @param {(object|null)[]} SF - 地面属性数组
 * @param {number} x           - 世界 X 坐标
 * @returns {object|null} 地面属性（null=普通；{belt}=传送带；{mu}=冰；{mud}=泥）
 */
export function surfaceAt(SF, x) {
  const i = Math.max(0, Math.min(SF.length - 1, Math.floor(x / TSTEP)));
  return SF[i];
}

/**
 * 查询指定 X 处的天花板高度
 * @param {number[]} CE - 天花板图数组
 * @param {number} x    - 世界 X 坐标
 * @returns {number} 天花板 Y（-Infinity 表示无天花板）
 */
export function ceiling(CE, x) {
  const i = Math.max(0, Math.min(CE.length - 1, Math.floor(x / TSTEP)));
  return CE[i];
}

/**
 * 获取地形采样索引（用于最近邻搜索的范围限制）
 * @param {number[]} TP - 地形点列
 * @param {number} x    - 世界 X 坐标
 * @returns {number} 安全的数组索引
 */
export function terrainIndex(TP, x) {
  return Math.min(Math.max(Math.floor(x / TSTEP), 0), TP.length - 2);
}
