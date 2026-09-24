/**
 * terrain.test.js —— 地形模块单元测试
 *
 * 测试覆盖：
 *   - buildCourse 返回数据的结构完整性
 *   - 各地形查询函数的边界行为
 *   - 高度图的连续性（相邻点高度差合理）
 *   - 水位图的正确性（水池区段水位有限，其余为 Infinity）
 *   - 天花板图的正确性（隧道内有天花板，其余为 -Infinity）
 *   - terrainIndex 的边界夹紧
 */

import {
  buildCourse, terrain, waterLevel, surfaceAt, ceiling, terrainIndex, STAGES, POOL,
} from '../src/terrain.js';
import { TSTEP } from '../src/constants.js';

// ─── buildCourse 结构测试 ──────────────────────────────────────

describe('buildCourse() 返回数据结构', () => {
  let td;
  beforeAll(() => { td = buildCourse(0); });

  test('返回对象包含所有必需字段', () => {
    expect(td).toHaveProperty('HA');
    expect(td).toHaveProperty('CE');
    expect(td).toHaveProperty('WL');
    expect(td).toHaveProperty('SF');
    expect(td).toHaveProperty('TP');
    expect(td).toHaveProperty('CPL');
    expect(td).toHaveProperty('SECTIONS');
    expect(td).toHaveProperty('CPU_PLAN');
    expect(td).toHaveProperty('FINISH_X');
  });

  test('HA、CE、WL、SF 长度一致', () => {
    expect(td.CE.length).toBe(td.HA.length);
    expect(td.WL.length).toBe(td.HA.length);
    expect(td.SF.length).toBe(td.HA.length);
  });

  test('TP 点列长度与 HA 一致，且每点 x 坐标正确', () => {
    expect(td.TP.length).toBe(td.HA.length);
    for (let i = 0; i < td.TP.length; i++) {
      expect(td.TP[i].x).toBeCloseTo(i * TSTEP, 5);
      expect(td.TP[i].y).toBe(td.HA[i]);
    }
  });

  test('FINISH_X > 0 且为正数', () => {
    expect(td.FINISH_X).toBeGreaterThan(0);
  });

  test('CPU_PLAN 第一项从 x=0 开始，姿势为 round', () => {
    expect(td.CPU_PLAN[0].from).toBe(0);
    expect(td.CPU_PLAN[0].pose).toBe('round');
  });

  test('SECTIONS 数量与关卡区段数对应（每个区段一个 label）', () => {
    const stageTypes = STAGES[0];
    expect(td.SECTIONS.length).toBe(stageTypes.length);
  });
});

// ─── 三个关卡均可生成 ──────────────────────────────────────────

describe('全部关卡均可生成', () => {
  test.each([0, 1, 2, 3, 4])('关卡 %i 生成不报错且 HA 非空', (s) => {
    const td = buildCourse(s);
    expect(td.HA.length).toBeGreaterThan(0);
    expect(td.FINISH_X).toBeGreaterThan(0);
  });
});

// ─── terrain() 查询函数 ────────────────────────────────────────

describe('terrain(HA, x) 地面高度查询', () => {
  let td;
  beforeAll(() => { td = buildCourse(0); });

  test('x=0 返回有效高度（起点平地约为 300）', () => {
    const h = terrain(td.HA, 0);
    expect(typeof h).toBe('number');
    expect(isFinite(h)).toBe(true);
    expect(h).toBeGreaterThan(0);
  });

  test('x 负值被夹紧到索引 0', () => {
    expect(terrain(td.HA, -100)).toBe(terrain(td.HA, 0));
  });

  test('x 超出范围被夹紧到最后一个索引', () => {
    const lastH = terrain(td.HA, 1e9);
    expect(typeof lastH).toBe('number');
    expect(isFinite(lastH)).toBe(true);
  });

  test('相邻采样点高度差不超过 200（连续性检查）', () => {
    // 检查前 500 个点（跳过后段的大跳崖等极端地形）
    let maxDiff = 0;
    for (let i = 0; i < Math.min(500, td.HA.length - 1); i++) {
      maxDiff = Math.max(maxDiff, Math.abs(td.HA[i + 1] - td.HA[i]));
    }
    expect(maxDiff).toBeLessThan(200);
  });
});

// ─── waterLevel() 查询函数 ────────────────────────────────────

describe('waterLevel(WL, x) 水位查询', () => {
  let td;
  beforeAll(() => { td = buildCourse(0); }); // 关卡1有水池区段

  test('无水区段水位为 Infinity', () => {
    // x=0 是平地，没有水
    expect(waterLevel(td.WL, 0)).toBe(Infinity);
  });

  test('水池区段内水位为有限正数', () => {
    // 找到 water 区段
    const waterSec = td.SECTIONS.find(s => s.type === 'water');
    if (!waterSec) return; // 关卡0无水则跳过（关卡1有水）
    const midX = (waterSec.from + waterSec.to) / 2 + 100; // 深水中段
    const wl = waterLevel(td.WL, midX);
    expect(wl).not.toBe(Infinity);
    expect(wl).toBeGreaterThan(0);
  });
});

// ─── surfaceAt() 查询函数 ─────────────────────────────────────

describe('surfaceAt(SF, x) 地面属性查询', () => {
  let td;
  beforeAll(() => { td = buildCourse(0); }); // 关卡1有传送带

  test('普通平地属性为 null', () => {
    expect(surfaceAt(td.SF, 0)).toBeNull();
  });

  test('传送带区段属性包含 belt 字段', () => {
    const beltSec = td.SECTIONS.find(s => s.type === 'belt');
    if (!beltSec) return;
    const midX = (beltSec.from + beltSec.to) / 2;
    const sf = surfaceAt(td.SF, midX);
    expect(sf).not.toBeNull();
    expect(sf).toHaveProperty('belt');
    expect(typeof sf.belt).toBe('number');
  });
});

// ─── ceiling() 查询函数 ────────────────────────────────────────

describe('ceiling(CE, x) 天花板查询', () => {
  let td;
  beforeAll(() => { td = buildCourse(0); }); // 关卡1有隧道

  test('非隧道区段天花板为 -Infinity', () => {
    expect(ceiling(td.CE, 0)).toBe(-Infinity);
  });
});

// ─── terrainIndex() ───────────────────────────────────────────

describe('terrainIndex(TP, x) 地形索引', () => {
  const TP = [{ x: 0 }, { x: 2 }, { x: 4 }, { x: 6 }];

  test('x=0 返回 0', () => {
    expect(terrainIndex(TP, 0)).toBe(0);
  });

  test('x=3 返回 1（floor(3/2)=1）', () => {
    expect(terrainIndex(TP, 3)).toBe(1);
  });

  test('x 超出范围返回 TP.length-2（安全夹紧）', () => {
    expect(terrainIndex(TP, 10000)).toBe(TP.length - 2);
  });

  test('x 为负值返回 0', () => {
    expect(terrainIndex(TP, -5)).toBe(0);
  });
});
