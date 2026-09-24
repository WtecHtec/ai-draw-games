/**
 * body.test.js —— 人体模型单元测试
 *
 * 测试覆盖：
 *   - makeBody 创建空手脚时基本属性
 *   - makeBody 含手臂笔划时质量、半径增加
 *   - replaceBody 保留运动状态
 *   - placeAtStart 正确放置到地面上方
 */

import { makeBody, replaceBody, placeAtStart } from '../src/body.js';
import { SHOULDER, HIP, M_PT } from '../src/constants.js';

// ─── 辅助数据 ──────────────────────────────────────────────────

/** 空手脚（无笔划） */
const EMPTY_LIMBS = { arm: [], leg: [] };

/** 简单手臂笔划：肩关节出发，向右延伸 */
const ARM_STROKE = [
  SHOULDER,
  { x: SHOULDER.x + 30, y: SHOULDER.y },
  { x: SHOULDER.x + 60, y: SHOULDER.y },
];

/** 简单腿部笔划：髋关节出发，向下延伸 */
const LEG_STROKE = [
  HIP,
  { x: HIP.x, y: HIP.y + 30 },
  { x: HIP.x, y: HIP.y + 60 },
];

// ─── makeBody() ────────────────────────────────────────────────

describe('makeBody() 创建物理对象', () => {
  test('空手脚时基本字段存在且类型正确', () => {
    const b = makeBody(EMPTY_LIMBS, '#ff0000');
    expect(typeof b.x).toBe('number');
    expect(typeof b.y).toBe('number');
    expect(typeof b.vx).toBe('number');
    expect(typeof b.vy).toBe('number');
    expect(typeof b.m).toBe('number');
    expect(typeof b.invM).toBe('number');
    expect(typeof b.rad).toBe('number');
    expect(b.color).toBe('#ff0000');
    expect(b.speed).toBe(1);
    expect(Array.isArray(b.joints)).toBe(true);
    expect(b.joints.length).toBe(2); // 肩 + 髋
  });

  test('质量为正数', () => {
    const b = makeBody(EMPTY_LIMBS, 'red');
    expect(b.m).toBeGreaterThan(0);
  });

  test('invM = 1 / m', () => {
    const b = makeBody(EMPTY_LIMBS, 'red');
    expect(b.invM).toBeCloseTo(1 / b.m, 10);
  });

  test('碰撞半径为正数', () => {
    const b = makeBody(EMPTY_LIMBS, 'red');
    expect(b.rad).toBeGreaterThan(0);
  });

  test('含手臂笔划时质量大于空手脚', () => {
    const empty = makeBody(EMPTY_LIMBS, 'red');
    const withArm = makeBody({ arm: [ARM_STROKE], leg: [] }, 'red');
    expect(withArm.m).toBeGreaterThan(empty.m);
  });

  test('含腿部笔划时碰撞半径大于或等于空手脚', () => {
    const empty = makeBody(EMPTY_LIMBS, 'red');
    const withLeg = makeBody({ arm: [], leg: [LEG_STROKE] }, 'red');
    expect(withLeg.rad).toBeGreaterThanOrEqual(empty.rad);
  });

  test('关节[0]（肩）空手臂时 active=false', () => {
    const b = makeBody(EMPTY_LIMBS, 'red');
    expect(b.joints[0].active).toBe(false);
  });

  test('关节[1]（髋）空腿时 active=false', () => {
    const b = makeBody(EMPTY_LIMBS, 'red');
    expect(b.joints[1].active).toBe(false);
  });

  test('含手臂笔划时肩关节 active=true', () => {
    const b = makeBody({ arm: [ARM_STROKE], leg: [] }, 'red');
    expect(b.joints[0].active).toBe(true);
  });

  test('含腿部笔划时髋关节 active=true', () => {
    const b = makeBody({ arm: [], leg: [LEG_STROKE] }, 'red');
    expect(b.joints[1].active).toBe(true);
  });

  test('关节初始角度和角速度均为 0', () => {
    const b = makeBody({ arm: [ARM_STROKE], leg: [LEG_STROKE] }, 'blue');
    for (const j of b.joints) {
      expect(j.a).toBe(0);
      expect(j.w).toBe(0);
    }
  });

  test('torsoPts 不为空（胴体有采样点）', () => {
    const b = makeBody(EMPTY_LIMBS, 'red');
    expect(b.torsoPts.length).toBeGreaterThan(0);
  });

  test('转动惯量 I 为正且 invI = 1/I（有笔划时）', () => {
    const b = makeBody({ arm: [ARM_STROKE], leg: [] }, 'red');
    const j = b.joints[0];
    expect(j.I).toBeGreaterThan(0);
    expect(j.invI).toBeCloseTo(1 / j.I, 10);
  });
});

// ─── replaceBody() ────────────────────────────────────────────

describe('replaceBody() 替换手脚保留状态', () => {
  test('保留 x, vx, vy', () => {
    const old = makeBody(EMPTY_LIMBS, 'red');
    old.x = 500; old.vx = 30; old.vy = -20;
    const getH = () => 1000; // 地面很低，不影响 y 放置
    const b = replaceBody(old, { arm: [ARM_STROKE], leg: [] }, 'blue', getH);
    expect(b.x).toBe(500);
    expect(b.vx).toBe(30);
    expect(b.vy).toBe(-20);
  });

  test('保留 speed 倍率', () => {
    const old = makeBody(EMPTY_LIMBS, 'red');
    old.speed = 0.55;
    const b = replaceBody(old, EMPTY_LIMBS, 'blue', () => 1000);
    expect(b.speed).toBe(0.55);
  });

  test('保留关节角速度', () => {
    const old = makeBody({ arm: [ARM_STROKE], leg: [LEG_STROKE] }, 'red');
    old.joints[0].w = 5.0;
    old.joints[1].w = 3.0;
    const b = replaceBody(old, { arm: [ARM_STROKE], leg: [LEG_STROKE] }, 'blue', () => 1000);
    expect(b.joints[0].w).toBe(5.0);
    expect(b.joints[1].w).toBe(3.0);
  });

  test('颜色更新为新颜色', () => {
    const old = makeBody(EMPTY_LIMBS, 'red');
    const b = replaceBody(old, EMPTY_LIMBS, '#0000ff', () => 1000);
    expect(b.color).toBe('#0000ff');
  });
});

// ─── placeAtStart() ───────────────────────────────────────────

describe('placeAtStart() 放置到起点', () => {
  test('放置后 x = startX', () => {
    const b = makeBody(EMPTY_LIMBS, 'red');
    placeAtStart(b, 120, () => 300);
    expect(b.x).toBe(120);
  });

  test('放置后 vx = vy = 0', () => {
    const b = makeBody(EMPTY_LIMBS, 'red');
    b.vx = 100; b.vy = 50;
    placeAtStart(b, 120, () => 300);
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
  });

  test('放置后 y < 地面高度（物体在地面以上）', () => {
    const b = makeBody(EMPTY_LIMBS, 'red');
    const groundY = 300;
    placeAtStart(b, 120, () => groundY);
    // y（质心）应在地面高度减去碰撞半径以上
    expect(b.y).toBeLessThan(groundY);
  });
});
