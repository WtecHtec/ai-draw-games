/**
 * aiController.test.js —— 系统规则 AI 自主选择最优解与切换测试
 */

import { aiController } from '../src/services/aiController.js';
import { makeBody } from '../src/body.js';
import { CPU_ROUND } from '../src/cpu.js';
import { buildCourse, terrain, ceiling, waterLevel, surfaceAt, terrainIndex } from '../src/terrain.js';

describe('AIController 系统规则模式 (System Mode) 最优解自主选择与切换', () => {
  let terrainData;
  let tf;

  beforeEach(() => {
    terrainData = buildCourse(0);
    tf = {
      getTerrainH: x => terrain(terrainData.HA, x),
      getCeiling: x => ceiling(terrainData.CE, x),
      getWaterLevel: x => waterLevel(terrainData.WL, x),
      getSurface: x => surfaceAt(terrainData.SF, x),
      getTerrainIndex: x => terrainIndex(terrainData.TP, x),
    };
    aiController.init({
      cpuMode: 'system',
      onUpdateBadge: jest.fn(),
      onUpdateQwenHud: jest.fn(),
    });
  });

  test('开局平地保持圆轮 (round)', () => {
    let cpu = makeBody(CPU_ROUND, '#e11d48');
    cpu.poseName = 'round';
    cpu.x = 120;

    cpu = aiController.step({
      cpu,
      player: cpu,
      terrainData,
      tf,
      dt: 1 / 60,
      raceTime: 0.1,
      stage: 0,
      racing: true,
      cpuDone: false,
    });

    expect(cpu.poseName).toBe('round');
  });

  test('当赛道前方遭遇台阶/深坑障碍时，系统规则自动识别最优解并切换为长腿 (long)', () => {
    // 构造包含台阶的测试地形
    const mockTerrain = {
      SECTIONS: [
        { type: 'flat', from: 0, to: 200 },
        { type: 'stairs', from: 200, to: 400 },
      ],
      CPU_PLAN: [{ from: 0, pose: 'round' }, { from: 200, pose: 'long' }],
    };

    let cpu = makeBody(CPU_ROUND, '#e11d48');
    cpu.poseName = 'round';
    cpu.x = 180; // 距离台阶障碍 20px（即将遭遇）

    // 第一次心跳感知到目标形态 long，记录时间
    cpu = aiController.step({
      cpu,
      player: cpu,
      terrainData: mockTerrain,
      tf,
      dt: 1 / 60,
      raceTime: 1.0,
      stage: 0,
      racing: true,
      cpuDone: false,
    });

    // 模拟 0.3 秒后，完成拟人化反应并完成最优解变身
    cpu = aiController.step({
      cpu,
      player: cpu,
      terrainData: mockTerrain,
      tf,
      dt: 1 / 60,
      raceTime: 1.35,
      stage: 0,
      racing: true,
      cpuDone: false,
    });

    expect(cpu.poseName).toBe('long');
  });

  test('当遭遇低矮隧道时，系统规则自动切换为小轮 (small)', () => {
    const mockTerrain = {
      SECTIONS: [
        { type: 'flat', from: 0, to: 300 },
        { type: 'tunnel', from: 300, to: 600 },
      ],
      CPU_PLAN: [{ from: 0, pose: 'round' }, { from: 300, pose: 'small' }],
    };

    let cpu = makeBody(CPU_ROUND, '#e11d48');
    cpu.poseName = 'round';
    cpu.x = 280; // 距离隧道 20px

    cpu = aiController.step({
      cpu,
      player: cpu,
      terrainData: mockTerrain,
      tf,
      dt: 1 / 60,
      raceTime: 2.0,
      stage: 0,
      racing: true,
      cpuDone: false,
    });

    cpu = aiController.step({
      cpu,
      player: cpu,
      terrainData: mockTerrain,
      tf,
      dt: 1 / 60,
      raceTime: 2.35,
      stage: 0,
      racing: true,
      cpuDone: false,
    });

    expect(cpu.poseName).toBe('small');
  });

  test('当遭遇垂直高墙时，系统规则自动切换为爬墙 (climb)', () => {
    const mockTerrain = {
      SECTIONS: [
        { type: 'flat', from: 0, to: 500 },
        { type: 'wall', from: 500, to: 700 },
      ],
      CPU_PLAN: [{ from: 0, pose: 'round' }, { from: 500, pose: 'climb' }],
    };

    let cpu = makeBody(CPU_ROUND, '#e11d48');
    cpu.poseName = 'round';
    cpu.x = 480; // 距离高墙 20px

    cpu = aiController.step({
      cpu,
      player: cpu,
      terrainData: mockTerrain,
      tf,
      dt: 1 / 60,
      raceTime: 3.0,
      stage: 0,
      racing: true,
      cpuDone: false,
    });

    cpu = aiController.step({
      cpu,
      player: cpu,
      terrainData: mockTerrain,
      tf,
      dt: 1 / 60,
      raceTime: 3.35,
      stage: 0,
      racing: true,
      cpuDone: false,
    });

    expect(cpu.poseName).toBe('climb');
  });
});
