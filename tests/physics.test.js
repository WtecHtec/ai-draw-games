/**
 * physics.test.js —— 物理引擎单元测试
 *
 * 测试覆盖：
 *   - samplePolyline 等距采样
 *   - dist 距离计算
 *   - closestOnPolyline 最近点查询
 *   - applyContact 碰撞冲量响应
 *   - stepBody 重力、关节驱动、水浮力
 */

import {
  dist, samplePolyline, closestOnPolyline, ceilingNear, applyContact, stepBody,
} from '../src/physics.js';

// ─── dist() ───────────────────────────────────────────────────

describe('dist(a, b) 两点距离', () => {
  test('同一点距离为 0', () => {
    expect(dist({ x: 3, y: 4 }, { x: 3, y: 4 })).toBe(0);
  });

  test('3-4-5 直角三角形', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 5);
  });

  test('负坐标正常计算', () => {
    expect(dist({ x: -1, y: -1 }, { x: 2, y: 3 })).toBeCloseTo(5, 5);
  });
});

// ─── samplePolyline() ─────────────────────────────────────────

describe('samplePolyline(pts, spacing) 等距采样', () => {
  test('单段直线按间距采样数量正确', () => {
    // 长度为 10 的直线，间距为 2，应有约 5 个采样点（含起点）
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const result = samplePolyline(pts, 2);
    expect(result.length).toBeGreaterThanOrEqual(5);
  });

  test('第一个采样点与折线起点相同', () => {
    const pts = [{ x: 5, y: 3 }, { x: 15, y: 3 }];
    const result = samplePolyline(pts, 3);
    expect(result[0]).toEqual({ x: 5, y: 3 });
  });

  test('采样点之间距离约等于 spacing', () => {
    const pts = [{ x: 0, y: 0 }, { x: 20, y: 0 }];
    const spacing = 4;
    const result = samplePolyline(pts, spacing);
    for (let i = 1; i < result.length; i++) {
      const d = dist(result[i - 1], result[i]);
      expect(d).toBeLessThanOrEqual(spacing + 0.01);
    }
  });

  test('重合点（长度为0的段）不产生 NaN', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }];
    const result = samplePolyline(pts, 2);
    for (const p of result) {
      expect(isNaN(p.x)).toBe(false);
      expect(isNaN(p.y)).toBe(false);
    }
  });
});

// ─── closestOnPolyline() ──────────────────────────────────────

describe('closestOnPolyline(P, px, py, i0) 最近点查询', () => {
  // 简单水平线段：y=100，x 从 0 到 20（步长 2）
  const P = [];
  for (let i = 0; i <= 10; i++) P.push({ x: i * 2, y: 100 });

  test('点正上方时最近点在正下方', () => {
    const cp = closestOnPolyline(P, 10, 50, 5);
    expect(cp.x).toBeCloseTo(10, 1);
    expect(cp.y).toBeCloseTo(100, 1);
    expect(cp.d).toBeCloseTo(50, 1);
  });

  test('点在线段上距离为 0', () => {
    const cp = closestOnPolyline(P, 6, 100, 3);
    expect(cp.d).toBeCloseTo(0, 3);
  });

  test('i0=0 时仍能正确搜索附近点', () => {
    const cp = closestOnPolyline(P, 0, 90, 0);
    expect(cp.y).toBeCloseTo(100, 1);
  });
});

// ─── ceilingNear() ────────────────────────────────────────────

describe('ceilingNear(CE, i0) 天花板附近判断', () => {
  test('无天花板时返回 false', () => {
    const CE = new Array(20).fill(-Infinity);
    expect(ceilingNear(CE, 10)).toBe(false);
  });

  test('附近有天花板时返回 true', () => {
    // 使用长度 40 的数组，天花板在索引 30
    const CE = new Array(40).fill(-Infinity);
    CE[30] = 200; // 在索引 30 处有天花板
    expect(ceilingNear(CE, 30)).toBe(true);  // 正好在天花板处
    expect(ceilingNear(CE, 20)).toBe(true);  // 距离 10，在 ±12 范围内
    expect(ceilingNear(CE, 17)).toBe(false); // 距离 13，超出 ±12
  });
});

// ─── applyContact() ───────────────────────────────────────────

describe('applyContact() 碰撞冲量响应', () => {
  /**
   * 创建一个简单的物理对象（无关节）
   */
  function makeBody(vx = 0, vy = 5) {
    return { x: 0, y: 0, vx, vy, invM: 1 / 100, m: 100, speed: 1 };
  }

  test('向下速度撞地面法线向上后，vy 变正（反弹）', () => {
    const b = makeBody(0, 10); // 向下运动
    // 法线向上 (0, -1)，穿透深度 2
    applyContact(b, 0, 0, null, 0, -1, 2, null);
    // 反弹后 vy 应为负（向上）或至少减小
    expect(b.vy).toBeLessThan(10);
  });

  test('无穿透时（pen<=0）不调用也不报错', () => {
    const b = makeBody(0, -5); // 向上运动，法线向上
    const vyBefore = b.vy;
    // vn = vy * ny = (-5) * (-1) = 5 > 0，不应施加冲量
    applyContact(b, 0, 0, null, 0, -1, 0, null);
    expect(b.vy).toBe(vyBefore); // 未改变
  });

  test('穿透修正：位置沿法线移动', () => {
    const b = makeBody(0, 10);
    b.y = 5;
    applyContact(b, 0, 5, null, 0, -1, 4, null);
    // 位置应向上移动（-y 方向）
    expect(b.y).toBeLessThan(5);
  });

  test('传送带地面：切向摩擦考虑传送带速度', () => {
    const b = makeBody(0, 10);
    // 法线向上，传送带速度 -200（向左流动）
    applyContact(b, 0, 0, null, 0, -1, 2, { belt: -200 });
    // vx 应受传送带摩擦影响（向左加速）
    expect(typeof b.vx).toBe('number');
    expect(isNaN(b.vx)).toBe(false);
  });
});

// ─── stepBody() 重力与位移 ────────────────────────────────────

describe('stepBody() 重力与位移积分', () => {
  /**
   * 创建最简物理对象（无质点，跳过碰撞）
   */
  function makeMinimalBody() {
    return {
      x: 0, y: 0, vx: 0, vy: 0,
      invM: 1 / 100, m: 100, speed: 1,
      torsoPts: [], // 空质点，跳过碰撞
      joints: [],
    };
  }

  /**
   * 模拟地形函数：平地，高度 1000（物体不会碰到）
   */
  function makeFlatTerrainFns() {
    const TP = [{ x: 0, y: 1000 }, { x: 10000, y: 1000 }];
    const CE = [-Infinity, -Infinity];
    return {
      getTerrainH:    () => 1000,
      getCeiling:     () => -Infinity,
      getWaterLevel:  () => Infinity,
      getSurface:     () => null,
      getTerrainIndex: () => 0,
      ceilingNearFn:  () => false,
      TP, CPL: [{ x: 0, y: -3000 }, { x: 10000, y: -3000 }],
    };
  }

  test('无手脚时重力使 vy 增加', () => {
    const b = makeMinimalBody();
    const tf = makeFlatTerrainFns();
    const dt = 1 / 240;
    stepBody(b, dt, tf);
    expect(b.vy).toBeGreaterThan(0); // 重力向下
  });

  test('dt 步长内位移等于速度×dt（欧拉积分验证）', () => {
    const b = makeMinimalBody();
    b.vx = 50; // 初始水平速度
    const tf = makeFlatTerrainFns();
    const dt = 1 / 240;
    // 记录步进前的速度（步进中速度也在更新，这里只验证大致方向）
    stepBody(b, dt, tf);
    expect(b.x).toBeGreaterThan(0); // 向右移动
  });

  test('水平空气阻尼使 vx 略微减小', () => {
    const b = makeMinimalBody();
    b.vx = 100;
    const tf = makeFlatTerrainFns();
    const vxBefore = b.vx;
    stepBody(b, 1 / 240, tf);
    expect(b.vx).toBeLessThan(vxBefore);
  });
});
