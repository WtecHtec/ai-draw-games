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
  { type: 'hills',    len: 1200,                             label: '丘陵' },
  { type: 'stairs',   n: 4, h: STEP_H, gap: 120,            label: '阶梯',    block: 'long' },
  { type: 'bumps',    len: 800, amp: 12, period: 38,         label: '颠簸路' },
  { type: 'pits',     n: 3, w: 80, d: 35, gap: 130,         label: '小坑',    block: 'long' },
  { type: 'bigpit',   w: 140, d: 70,                         label: '大坑',    block: 'long' },
  { type: 'wave',     len: 900, dh: 110,                     label: '大波浪' },
  { type: 'sawtooth', n: 5, len: 110, h: 50,                 label: '锯齿坡' },
  { type: 'tunnel',   len: 500,                              label: '隧道',    block: 'small' },
  { type: 'hurdles',  n: 4, h: 28, w: 14, gap: 110,          label: '跨栏',    block: 'long' },
  { type: 'cliff',    dh: 140,                               label: '跳崖' },
  { type: 'steep',    len: 300, dh: -130,                    label: '急坡' },
  { type: 'water',    len: 960, d: 150,                      label: '水池',    block: 'long' },
  { type: 'wall',     h: 95,                                 label: '高墙',    block: 'climb' },
  { type: 'climb',    h: 85, tunnel: 320,                    label: '天花板+墙', block: 'climb' },
  { type: 'belt',     len: 600, speed: -200,                 label: '逆向传送带', block: 'long' },
  { type: 'ice',      len: 750, dh: -160, mu: 0.28,          label: '冰坡' },
  { type: 'mud',      len: 560, d: 65,                       label: '泥沼',    block: 'long' },
];

/**
 * 关卡序列（大幅拉长赛道长度，全障碍组合丰富度提升）
 * 每个关卡是一组区段 type 的有序列表
 */
export const STAGES = [
  // 关卡 1【新手拉长】：基础起伏与阶梯小坑，体验翻山越岭与长途疾驰
  ['hills', 'bumps', 'stairs', 'pits', 'wave', 'sawtooth', 'bumps', 'stairs', 'hills', 'pits'],

  // 关卡 2【初级拉长】：引入逆向传送带、跨栏与大坑组合，需要强力抓地与跨越
  ['bumps', 'hurdles', 'wave', 'belt', 'bigpit', 'cliff', 'steep', 'hurdles', 'wave', 'pits', 'hills', 'belt'],

  // 关卡 3【中级拉长】：深水水域、极滑冰坡与垂直高墙深度混合，多变地貌挑战
  ['hills', 'water', 'ice', 'wall', 'stairs', 'hurdles', 'sawtooth', 'wave', 'mud', 'ice', 'water', 'cliff', 'stairs', 'hills'],

  // 关卡 4【高级马拉松】：隧道天花板限高、减速泥沼与攀爬高墙连续组合，高频应变
  ['wave', 'tunnel', 'mud', 'sawtooth', 'climb', 'pits', 'water', 'belt', 'stairs', 'cliff', 'wall', 'tunnel', 'ice', 'hurdles', 'mud', 'wave'],

  // 关卡 5【大师大满贯】：超长全地貌混合极限拉练，高难度复杂地貌不间断挑战
  ['ice', 'tunnel', 'mud', 'cliff', 'wall', 'water', 'hurdles', 'belt',
   'sawtooth', 'climb', 'bigpit', 'stairs', 'steep', 'wave', 'tunnel', 'water', 'wall', 'belt', 'mud', 'climb'],
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

  // 构建课程：前置平地 → 各区段 + 过渡平地 → 末尾平地（带平滑随机缓冲）
  const course = [{ type: 'flat', len: 350 }];
  for (const type of STAGES[stage]) {
    const proto = POOL.find(c => c.type === type);
    course.push({ ...proto });
    course.push({ type: 'flat', len: Math.round(90 + Math.random() * 60) });
  }
  course.push({ type: 'flat', len: 80 });

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

  // ─ 逐个区段生成地形（全地形参数融入程序化随机抖动，每局比赛地形细节独一无二） ─
  for (const c of course) {
    const from = x;

    if (c.type === 'flat') {
      // 平地：若高度偏离基准面 300，平滑过渡回 300，防止连续坡度累积导致赛道漂移出画面
      const targetY = 300;
      if (Math.abs(y - targetY) > 8) {
        const yStart = y;
        const diff = targetY - yStart;
        push(c.len, t => yStart + diff * (1 - Math.cos(Math.PI * t / c.len)) / 2);
        y = targetY;
      } else {
        push(c.len, () => y);
      }

    } else if (c.type === 'hills') {
      // 丘陵：正弦叠加起伏（引入随机频率、相位与振幅，每次比赛起伏曲线独一无二）
      const L = Math.round(c.len * (0.9 + Math.random() * 0.25));
      const y0 = y;
      const f1 = 170 + Math.random() * 40;
      const f2 = 70 + Math.random() * 20;
      const p1 = Math.random() * Math.PI * 2;
      const p2 = Math.random() * Math.PI * 2;
      const a1 = 26 + Math.random() * 10;
      const a2 = 10 + Math.random() * 5;
      const hillF = t =>
        a1 * Math.sin(t / f1 + p1) +
        a2 * Math.sin(t / f2 + p2) +
        5 * Math.sin(t / 40 + 2.1);
      push(L, t => y0 + Math.sin(Math.PI * t / L) * hillF(t));

    } else if (c.type === 'bumps') {
      // 颠簸路：小幅余弦波（随机抖动振幅与波长）
      const y0 = y;
      const amp = c.amp * (0.85 + Math.random() * 0.35);
      const period = c.period * (0.9 + Math.random() * 0.2);
      const bLen = Math.round(c.len * (0.9 + Math.random() * 0.25));
      push(bLen, t => y0 - amp * (1 - Math.cos(t / period * Math.PI * 2)) / 2);

    } else if (c.type === 'wave') {
      // 大波浪：单个半余弦波（随机波长与波高）
      const y0 = y;
      const L = Math.round(c.len * (0.9 + Math.random() * 0.25));
      const dh = c.dh * (0.85 + Math.random() * 0.3);
      push(L, t => y0 - dh * (1 - Math.cos(t / L * Math.PI * 2)) / 2);

    } else if (c.type === 'sawtooth') {
      // 锯齿坡：多段线性上坡（随机步数与坡度）
      const n = Math.min(6, Math.max(3, Math.round(c.n + (Math.random() > 0.5 ? 1 : 0))));
      const sLen = Math.round(c.len * (0.9 + Math.random() * 0.25));
      const sH = c.h * (0.85 + Math.random() * 0.3);
      for (let k = 0; k < n; k++) {
        const y0 = y;
        push(sLen, t => y0 - sH * t / sLen);
      }

    } else if (c.type === 'steep') {
      // 急坡：线性下坡（随机坡长与落差）
      const y0 = y;
      const L = Math.round(c.len * (0.9 + Math.random() * 0.25));
      const dh = c.dh * (0.85 + Math.random() * 0.3);
      push(L, t => y0 + dh * t / L);
      y += dh;

    } else if (c.type === 'cliff') {
      // 跳崖：突然下降一个高度差（随机高度落差）
      const dh = c.dh * (0.85 + Math.random() * 0.3);
      push(40, () => y);
      y += dh;
      push(40, () => y);

    } else if (c.type === 'stairs') {
      // 阶梯：多级台阶，之后缓坡恢复原高度（随机阶数与台阶宽度）
      const n = Math.min(5, Math.max(3, Math.round(c.n + (Math.random() > 0.5 ? 1 : 0))));
      const gap = Math.round(c.gap * (0.9 + Math.random() * 0.25));
      for (let k = 0; k < n; k++) {
        y -= c.h;
        push(gap, () => y);
      }
      const y1 = y;
      push(300, t => y1 + n * c.h * t / 300);
      y += n * c.h;

    } else if (c.type === 'pits') {
      // 小坑：多个沟槽（随机坑数、坑宽与深度）
      const y0 = y;
      const n = Math.min(4, Math.max(2, Math.round(c.n + (Math.random() > 0.5 ? 1 : 0))));
      const pw = Math.round(c.w * (0.85 + Math.random() * 0.3));
      const pd = Math.round(c.d * (0.85 + Math.random() * 0.3));
      const pgap = Math.round(c.gap * (0.85 + Math.random() * 0.3));
      for (let k = 0; k < n; k++) {
        push(pgap, () => y0);
        push(pw,   () => y0 + pd);
      }
      push(pgap, () => y0);

    } else if (c.type === 'bigpit') {
      // 大坑：单个宽深沟槽（随机坑宽与深度）
      const y0 = y;
      const pw = Math.round(c.w * (0.85 + Math.random() * 0.3));
      const pd = Math.round(c.d * (0.85 + Math.random() * 0.3));
      push(80,   () => y0);
      push(pw,  () => y0 + pd);
      push(80,   () => y0);

    } else if (c.type === 'tunnel') {
      // 隧道：有天花板的平地区段（随机隧道长度）
      const y0 = y;
      const tLen = Math.round(c.len * (0.9 + Math.random() * 0.3));
      push(60,    () => y0);
      push(tLen, () => y0, () => y0 - TUNNEL_H);
      push(60,    () => y0);

    } else if (c.type === 'hurdles') {
      // 跨栏：多个凸起障碍（随机数量与间距）
      const y0 = y;
      const n = Math.min(5, Math.max(3, Math.round(c.n + (Math.random() > 0.5 ? 1 : 0))));
      const hgap = Math.round(c.gap * (0.85 + Math.random() * 0.3));
      for (let k = 0; k < n; k++) {
        push(hgap, () => y0);
        push(c.w,   () => y0 - c.h);
      }
      push(hgap, () => y0);

    } else if (c.type === 'wall') {
      // 高墙：需要攀爬的陡峭台阶（随机墙高）
      const wh = Math.round(c.h * (0.9 + Math.random() * 0.2));
      push(60, () => y);
      y -= wh;
      push(160, () => y);
      const y1 = y;
      push(300, t => y1 + wh * t / 300);
      y += wh;

    } else if (c.type === 'climb') {
      // 天花板+墙：低隧道后紧接高墙（随机隧道长与墙高）
      const y0 = y;
      const ch = Math.round(c.h * (0.9 + Math.random() * 0.2));
      const cTunnel = Math.round(c.tunnel * (0.9 + Math.random() * 0.25));
      push(60, () => y0);
      push(cTunnel, () => y0, () => y0 - TUNNEL_H);
      push(180, () => y0);
      c.wallX = x; // 记录墙壁起始 X，供 CPU 计划使用
      y -= ch;
      push(160, () => y);
      const y1 = y;
      push(300, t => y1 + ch * t / 300);
      y += ch;

    } else if (c.type === 'belt') {
      // 逆向传送带：地面向后流动（随机流速与长度）
      const bSpeed = -Math.round(160 + Math.random() * 90);
      const bLen = Math.round(c.len * (0.9 + Math.random() * 0.25));
      c.speed = bSpeed;
      c.len = bLen;
      surf = { belt: bSpeed };
      push(bLen, () => y);
      surf = null;

    } else if (c.type === 'ice') {
      // 冰坡：低摩擦上坡（随机摩擦系数与坡度）
      const y0 = y;
      const L = Math.round(c.len * (0.9 + Math.random() * 0.25));
      const dh = c.dh * (0.85 + Math.random() * 0.3);
      const mu = Number((0.2 + Math.random() * 0.15).toFixed(2));
      surf = { mu };
      push(L, t => y0 + dh * t / L);
      surf = null;
      y += dh;

    } else if (c.type === 'mud') {
      // 泥沼：向下沉（随机泥沼长度与深度）
      const y0 = y;
      const mLen = Math.round(c.len * (0.9 + Math.random() * 0.25));
      const md = Math.round(c.d * (0.85 + Math.random() * 0.3));
      surf = { mud: true };
      push(60,          t => y0 + md * t / 60,           null, y0);
      push(mLen - 180,  () => y0 + md,                   null, y0);
      push(120,         t => y0 + md * (1 - t / 120),    null, y0);
      surf = null;

    } else if (c.type === 'water') {
      // 水池：深水区（随机水深与水域长度）
      const y0 = y;
      const wLen = Math.round(c.len * (0.9 + Math.random() * 0.25));
      const d = Math.round(c.d * (0.85 + Math.random() * 0.3));
      push(60,          t => y0 + d * t / 60,          null, y0);
      push(wLen - 360,  () => y0 + d,                  null, y0);
      push(300,         t => y0 + d * (1 - t / 300),   null, y0);
    }

    // 记录区段信息（用于 HUD 显示、渲染器材质绘制和 CPU 计划）
    if (c.label) {
      SECTIONS.push({
        from,
        to: x,
        label: c.label,
        type: c.type,
        speed: c.speed,
        tunnel: c.tunnel,
        h: c.h,
        w: c.w,
        n: c.n,
        d: c.d,
        gap: c.gap,
      });
    }

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
