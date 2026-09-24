import { queryCpuAI, buildSnapshot, getTypesafeEndpoint, DEFAULT_BFF_URL } from '../src/typesafe.js';

describe('TypeSafe BFF & AI integration tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTypesafeEndpoint', () => {
    test('默认回退到 DEFAULT_BFF_URL', () => {
      expect(getTypesafeEndpoint()).toBe(DEFAULT_BFF_URL);
    });

    test('优先使用传入的自定义地址', () => {
      expect(getTypesafeEndpoint('https://worker.custom.dev/typesafe')).toBe('https://worker.custom.dev/typesafe');
    });
  });

  describe('buildSnapshot', () => {
    test('正确构建物理快照', () => {
      const mockCpu = { x: 500, vx: 120, joints: [{ w: 2 }, { w: 1 }] };
      const mockPlayer = { x: 400, vx: 100, joints: [] };
      const mockTerrainData = {
        FINISH_X: 1000,
        SECTIONS: [
          { from: 0, type: 'flat' },
          { from: 400, type: 'hills' },
          { from: 800, type: 'water' },
        ],
      };

      const snap = buildSnapshot({
        cpu: mockCpu,
        player: mockPlayer,
        terrainData: mockTerrainData,
        raceTime: 4.5,
        stage: 1,
        STAGE_NAMES: ['第1关', '丘陵起伏', '第3关'],
        STAGES: [{}, {}, {}],
        waterLevelFn: () => Infinity,
        ceilingFn: () => -Infinity,
      });

      expect(snap.currentSection).toBe('hills');
      expect(snap.nextSection).toBe('water');
      expect(snap.cpuProgress).toBe(0.5);
      expect(snap.playerProgress).toBe(0.4);
      expect(snap.gapPercent).toBeCloseTo(10);
      expect(snap.stageName).toBe('丘陵起伏');
      expect(snap.inWater).toBe(false);
      expect(snap.inTunnel).toBe(false);
    });
  });

  describe('queryCpuAI', () => {
    test('未提供 apiKey 时直接返回 null，不发网络请求', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      const res = await queryCpuAI({ currentSection: 'flat' }, '');
      expect(res).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    test('网络抛出错误时静默返回 null', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network Error'));
      const res = await queryCpuAI({ currentSection: 'flat' }, 'test_key');
      expect(res).toBeNull();
      fetchSpy.mockRestore();
    });

    test('接口返回 HTTP 500 时静默返回 null', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
      });
      const res = await queryCpuAI({ currentSection: 'flat' }, 'test_key');
      expect(res).toBeNull();
      fetchSpy.mockRestore();
    });

    test('接口返回有效响应时正确解析姿势与提速标记', async () => {
      const mockData = {
        answers: {
          pose: { choice: 'round' },
          boost: { noul: 0.8 },
        },
      };

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      const res = await queryCpuAI({
        currentSection: 'hills',
        nextSection: 'flat',
        cpuProgress: 0.2,
        playerProgress: 0.3,
        gapPercent: -10,
        cpuVx: 50,
        shoulderW: 1,
        hipW: 1,
        raceTime: '2.0',
        stage: 0,
        stageName: '第1关',
      }, 'test_key', 'http://127.0.0.1:8787/typesafe');

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:8787/typesafe',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test_key',
            'Content-Type': 'application/json',
          }),
        })
      );
      expect(res).toEqual({ pose: 'round', boost: true });
      fetchSpy.mockRestore();
    });

    test('接口返回非法姿势时降级返回 null', async () => {
      const mockData = {
        answers: {
          pose: { choice: 'unknown_alien_pose' },
          boost: { noul: 0.2 },
        },
      };

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      const res = await queryCpuAI({ currentSection: 'flat' }, 'test_key');
      expect(res).toBeNull();
      fetchSpy.mockRestore();
    });
  });
});
