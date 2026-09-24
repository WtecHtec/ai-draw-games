import { sanitizeLimbs, isWebGPUSupported } from '../src/llm/webllm.js';
import { SHOULDER, HIP } from '../src/constants.js';

describe('WebLLM limbs sanitizer and utilities', () => {
  test('isWebGPUSupported 检测正常', () => {
    expect(typeof isWebGPUSupported()).toBe('boolean');
  });

  test('sanitizeLimbs 边界钳制与坐标保留一位小数', () => {
    const raw = {
      thought: '测试长腿',
      arm: [
        [
          { x: 150, y: 62 },
          { x: 350, y: -50 }, // 越界
          { x: 180.456, y: 90.123 },
        ],
      ],
      leg: [
        [
          { x: 150, y: 110 },
          { x: -20, y: 220 }, // 越界
        ],
      ],
    };

    const cleaned = sanitizeLimbs(raw);

    // 检查 arm
    expect(cleaned.arm.length).toBe(1);
    expect(cleaned.arm[0][0]).toEqual({ x: 150, y: 62 });
    expect(cleaned.arm[0][1]).toEqual({ x: 290, y: 10 }); // 钳制到 max 290, min 10
    expect(cleaned.arm[0][2]).toEqual({ x: 180.5, y: 90.1 });

    // 检查 leg
    expect(cleaned.leg.length).toBe(1);
    expect(cleaned.leg[0][0]).toEqual({ x: 150, y: 110 });
    expect(cleaned.leg[0][1]).toEqual({ x: 10, y: 170 }); // 钳制
    expect(cleaned.thought).toBe('测试长腿');
  });

  test('如果首个点偏离关节过远，自动前置补齐关节坐标', () => {
    const raw = {
      arm: [
        [
          { x: 230, y: 120 }, // 远离肩关节 (150, 62)
          { x: 240, y: 130 },
        ],
      ],
      leg: [
        [
          { x: 200, y: 170 }, // 远离髋关节 (150, 110)
          { x: 210, y: 170 },
        ],
      ],
    };

    const cleaned = sanitizeLimbs(raw);
    expect(cleaned.arm[0][0]).toEqual({ x: SHOULDER.x, y: SHOULDER.y });
    expect(cleaned.leg[0][0]).toEqual({ x: HIP.x, y: HIP.y });
  });

  test('如果输入为空或缺失 leg，自动提供兜底腿部笔划', () => {
    const cleaned = sanitizeLimbs(null);
    expect(cleaned.leg.length).toBeGreaterThan(0);
    expect(cleaned.leg[0][0]).toEqual({ x: HIP.x, y: HIP.y });
    expect(cleaned.arm.length).toBe(0);
  });
});

describe('WebLLM buildLimbPrompt scene diagnosis and physics hints', () => {
  // 引入 buildLimbPrompt
  const { buildLimbPrompt } = require('../src/llm/webllm.js');

  test('阶梯台阶 (stairs) 包含直角台阶力学难点与长腿最优解', () => {
    const prompt = buildLimbPrompt({ currentSection: 'stairs', targetSection: 'stairs' });
    expect(prompt).toContain('垂直直角会彻底阻挡圆轮前进并导致空转卡死');
    expect(prompt).toContain('必须切换为长腿十字（long）');
  });

  test('垂直高墙 (wall) 包含攀爬手臂最优解', () => {
    const prompt = buildLimbPrompt({ currentSection: 'flat', targetSection: 'wall', distToUpcoming: 85 });
    expect(prompt).toContain('高耸垂直直立高墙');
    expect(prompt).toContain('必须使用攀爬姿势（climb）');
    expect(prompt).toContain('前方 85 像素处即将遭遇【垂直高墙】');
  });

  test('低矮隧道 (tunnel) 包含限高与微缩轮最优解', () => {
    const prompt = buildLimbPrompt({ currentSection: 'tunnel', targetSection: 'tunnel' });
    expect(prompt).toContain('天花板高度极低');
    expect(prompt).toContain('必须使用微缩轮（small）');
  });

  test('水池 (water) 包含大圆轮划水最优解', () => {
    const prompt = buildLimbPrompt({ currentSection: 'water', targetSection: 'water' });
    expect(prompt).toContain('深水浮力阻力');
    expect(prompt).toContain('饱满大圆轮（round）划水推进');
  });

  test('卡阻状态 (isStuck) 包含紧急重试提示与破障指令', () => {
    const prompt = buildLimbPrompt({
      currentSection: 'pits',
      isStuck: true,
      stuckCount: 2,
    });
    expect(prompt).toContain('严重空转卡死（已重试第 2 次）');
    expect(prompt).toContain('必须根据力学难点立即重绘');
  });

  test('有坡度与水域场景实况包含针对性力学最优解指导', () => {
    const prompt = buildLimbPrompt({
      currentSection: 'hills',
      targetSection: 'hills',
      hasSlope: true,
      slopeDesc: '上坡爬坡',
      inWater: true,
      speed: 45,
    });
    expect(prompt).toContain('当前路段有明显坡度');
    expect(prompt).toContain('手和脚都绘制圆');
    expect(prompt).toContain('当前赛车正处于深水中');
    expect(prompt).toContain('划水推进力最大、在水中跑得最快');
    expect(prompt).toContain('当前车速：45 像素/秒');
  });

  test('向下兼容字符串签名 buildLimbPrompt(terrainDesc, upcomingObstacle)', () => {
    const prompt = buildLimbPrompt('阶梯台阶', '垂直高墙');
    expect(prompt).toContain('垂直高墙');
    expect(prompt).toContain('攀爬');
  });
});

describe('WebLLM getTargetArchetype and physical self-healing sanitizeLimbs', () => {
  const { getTargetArchetype, sanitizeLimbs } = require('../src/llm/webllm.js');
  const { resolveOptimalPose } = require('../src/cpu.js');
  const { HIP, SHOULDER } = require('../src/constants.js');

  test('getTargetArchetype 准确判定各类地形对应物理姿势', () => {
    expect(getTargetArchetype('stairs')).toBe('long');
    expect(getTargetArchetype('pits')).toBe('long');
    expect(getTargetArchetype('bigpit')).toBe('long');
    expect(getTargetArchetype('hurdles')).toBe('long');
    expect(getTargetArchetype('mud')).toBe('long');
    expect(getTargetArchetype('belt')).toBe('long');
    expect(getTargetArchetype('wall')).toBe('climb');
    expect(getTargetArchetype('climb')).toBe('climb');
    expect(getTargetArchetype('tunnel')).toBe('small');
    expect(getTargetArchetype('flat')).toBe('round');
    expect(getTargetArchetype('hills')).toBe('round');
    expect(getTargetArchetype('water')).toBe('round');
    expect(getTargetArchetype('flat', true)).toBe('long'); // 卡阻状态强制 long
    expect(getTargetArchetype('hills', true, true)).toBe('round'); // 有坡度优先 round
    expect(getTargetArchetype('water', true, false, true)).toBe('round'); // 在水里优先 round
  });

  test('自由创意绘制：模型自主生成的肢体笔划得到完整保留，不被强制抹杀覆写', () => {
    const raw = {
      thought: '齿轮齿牙手脚',
      arm: [[{ x: 150, y: 62 }, { x: 180, y: 40 }, { x: 190, y: 62 }]],
      leg: [[{ x: 150, y: 110 }, { x: 170, y: 140 }, { x: 190, y: 110 }]],
    };
    const cleaned = sanitizeLimbs(raw, 'long');
    expect(cleaned.arm.length).toBe(1);
    expect(cleaned.leg.length).toBe(1);
    expect(cleaned.thought).toBe('齿轮齿牙手脚');
  });

  test('不限制形状自由发挥：任何模型自由创作的几何形态均得到完整保留', () => {
    const rawCreative = {
      thought: '自由创作图形',
      // 正方形/闭环/多边形
      arm: [
        [
          { x: 150, y: 62 },
          { x: 180, y: 62 },
          { x: 180, y: 92 },
          { x: 150, y: 92 },
          { x: 150, y: 62 },
        ],
      ],
      // 连续圆弧
      leg: [
        [
          { x: 150, y: 110 },
          { x: 170, y: 140 },
          { x: 130, y: 140 },
          { x: 150, y: 110 },
        ],
      ],
    };

    const cleaned = sanitizeLimbs(rawCreative, 'round');
    expect(cleaned.arm[0].length).toBe(5);
    expect(cleaned.leg[0].length).toBe(4);
  });

  test('完整保留多关键点坐标（细致保留 5~8 个关键点拟合弧线或多折线）', () => {
    const rawMultiPts = {
      thought: '多关键点平滑弧线',
      arm: [
        [
          { x: 150, y: 62 },
          { x: 165, y: 64 },
          { x: 180, y: 72 },
          { x: 195, y: 86 },
          { x: 205, y: 104 },
          { x: 208, y: 124 },
        ],
      ],
      leg: [
        [
          { x: 150, y: 110 },
          { x: 166, y: 114 },
          { x: 184, y: 126 },
          { x: 200, y: 144 },
          { x: 206, y: 166 },
        ],
      ],
    };

    const cleaned = sanitizeLimbs(rawMultiPts, 'round');
    expect(cleaned.arm[0].length).toBe(6);
    expect(cleaned.leg[0].length).toBe(5);
  });

  test('当 leg 完全为空时，自动补齐基础支撑腿以防物理引擎崩溃', () => {
    const raw = {
      thought: '仅有手臂',
      arm: [[{ x: 150, y: 62 }, { x: 200, y: 62 }]],
      leg: [],
    };
    const cleaned = sanitizeLimbs(raw, 'long');
    expect(cleaned.leg.length).toBe(1);
    expect(cleaned.leg[0][0]).toEqual({ x: HIP.x, y: HIP.y });
  });

  test('在圆轮模式下，自动约束手臂展幅不超过腿部圆轮半径，防止长臂拖地卡死', () => {
    const raw = {
      thought: '手长过长测试',
      // 手臂是一根超长直线，伸展到 x = 250 (长度 100)
      arm: [[{ x: 150, y: 62 }, { x: 250, y: 62 }]],
      // 腿部是一个半径 38 的标准圆轮
      leg: [[{ x: 150, y: 110 }, { x: 150, y: 148 }]],
    };
    const cleaned = sanitizeLimbs(raw, 'round');
    // 手臂最大距离应被等比限制到 <= 38
    const armEnd = cleaned.arm[0][1];
    const armLen = Math.hypot(armEnd.x - SHOULDER.x, armEnd.y - SHOULDER.y);
    expect(armLen).toBeLessThanOrEqual(38.1);
  });

  test('针对 small 形态，自动钳制 y 坐标以通过低矮隧道天花板', () => {
    const raw = {
      arm: [[{ x: 150, y: 62 }, { x: 150, y: 95 }]], // 碰顶
      leg: [[{ x: 150, y: 110 }, { x: 150, y: 155 }]], // 碰顶
    };
    const cleaned = sanitizeLimbs(raw, 'small');
    for (const p of cleaned.arm[0]) {
      expect(p.y).toBeLessThanOrEqual(82);
    }
    for (const p of cleaned.leg[0]) {
      expect(p.y).toBeLessThanOrEqual(132);
    }
  });

  test('resolveOptimalPose 智能选择对应场景的最优姿势，避免查 CPU_PLAN 产生误判', () => {
    const mockTerrain = {
      SECTIONS: [
        { from: 0, to: 300, type: 'flat' },
        { from: 300, to: 600, type: 'stairs' },
        { from: 600, to: 800, type: 'wall' },
      ],
      CPU_PLAN: [
        { from: 0, pose: 'round' },
        { from: 230, pose: 'long' },
        { from: 620, pose: 'round' }, // 传统过度区误配为 round
      ],
    };

    // 在天花板下
    const tfWithCeiling = { getCeiling: () => 200 };
    expect(resolveOptimalPose(mockTerrain, 100, tfWithCeiling)).toBe('small');

    // 面向阶梯
    const tfNormal = { getCeiling: () => -Infinity };
    expect(resolveOptimalPose(mockTerrain, 250, tfNormal)).toBe('long');
    expect(resolveOptimalPose(mockTerrain, 350, tfNormal)).toBe('long');

    // 面向高墙
    expect(resolveOptimalPose(mockTerrain, 550, tfNormal)).toBe('climb');
    expect(resolveOptimalPose(mockTerrain, 650, tfNormal)).toBe('climb');
  });
});


