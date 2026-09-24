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

  test('向下兼容字符串签名 buildLimbPrompt(terrainDesc, upcomingObstacle)', () => {
    const prompt = buildLimbPrompt('阶梯台阶', '垂直高墙');
    expect(prompt).toContain('垂直高墙');
    expect(prompt).toContain('攀爬');
  });
});

