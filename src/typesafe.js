/**
 * typesafe.js —— TypeSafe AI 接入模块
 *
 * 职责：
 *   - 将游戏实时物理快照转换为自然语言 state
 *   - 向 TypeSafe /v1/systemone 发起 Jev 决策请求
 *   - 静默处理所有错误（网络/key无效/超时），返回 null 即降级到规则 AI
 *
 * API 文档：https://docs.typesafe.ai/introduction/quickstart
 */

// ─── 地形类型中文名映射 ────────────────────────────────────────

/** 地形 type → 中文描述（供 AI 理解） */
export const TERRAIN_ZH = {
  flat: '平地',
  hills: '起伏丘陵',
  bumps: '颠簸路面',
  stairs: '阶梯台阶',
  wave: '大波浪',
  pits: '连续小坑',
  bigpit: '大深坑',
  sawtooth: '锯齿地形',
  hurdles: '跨栏障碍',
  belt: '传送带',
  water: '水池',
  mud: '泥浆沼泽',
  ice: '冰坡',
  wall: '垂直高墙',
  tunnel: '低矮隧道',
  cliff: '跳崖断层',
  steep: '陡坡',
  climb: '悬壁攀岩',
};

// 各特殊地形的物理力学特征及最优解法
export const TERRAIN_PHYSICS_HINTS = {
  stairs: '前方是连续垂直直角阶梯。力学难点：垂直直角会彻底阻挡圆轮前进并导致空转卡死；力学最优解：必须切换为长腿十字（long），依靠长臂勾住直角台阶棱角向上翻越。',
  pits: '前方是连续凹坑地形。力学难点：圆轮沉入坑底无法推进；力学最优解：使用长腿十字（long）横跨坑壁。',
  bigpit: '前方是大深坑障碍。力学难点：圆轮跌入深坑卡死；力学最优解：使用长腿十字（long）支撑跨越。',
  hurdles: '前方是连续凸起跨栏。力学难点：圆轮撞栏减速；力学最优解：使用长腿十字（long）跨过障碍。',
  wall: '前方是高耸垂直直立高墙。力学难点：墙高且直立，其他姿势无法翻爬；力学最优解：必须使用攀爬姿势（climb），以超长手臂扒住墙头拉动翻越。',
  climb: '前方是天花板低矮隧道接垂直高墙。力学难点：隧道限高、高墙垂直；力学最优解：隧道中必须微缩轮（small），墙前必须攀爬（climb）。',
  tunnel: '前方是低矮天花板隧道。力学难点：天花板高度极低，任何长腿或普通轮均会撞顶卡死；力学最优解：必须使用微缩轮（small）缩小体型通过。',
  belt: '前方是强力逆向传送带。力学难点：地面高速后移；力学最优解：长腿十字（long）具备强力点状抓地推进。',
  water: '前方是水池区域。力学难点：深水浮力阻力；力学最优解：饱满大圆轮（round）划水推进效果最好。',
  mud: '前方是黏稠泥浆沼泽。力学难点：极易深陷下沉；力学最优解：长腿十字（long）拔泥脱困推进。',
  flat: '开阔平坦平地。力学最优解：圆形大轮（round）阻力最小，滚动速度最快。',
  hills: '起伏丘陵斜坡。力学最优解：圆形大轮（round）惯性滚动平稳高效。',
  bumps: '颠簸细碎路面。力学最优解：圆形大轮（round）平顺滚动。',
  wave: '大波浪地形。力学最优解：圆形大轮（round）顺势冲浪。',
  sawtooth: '前方是锐角锯齿坑。力学难点：圆轮陷入锯齿尖端；力学最优解：长腿十字（long）横跨齿尖。',
  ice: '光滑冰坡。力学难点：摩擦力极低易打滑；力学最优解：圆形大轮（round）保持高速惯性冲坡。',
  cliff: '跳崖断层落差。力学难点：下落冲击；力学最优解：圆形大轮（round）平稳落地。',
};

// ─── 物理快照转自然语言 ────────────────────────────────────────

/**
 * 将物理快照组装为 TypeSafe state 字符串
 *
 * @param {object} snap - 物理快照对象
 * @returns {string} 自然语言描述
 */
function buildStateText(snap) {
  // 领先/落后描述
  const gapPct = Math.abs(snap.gapPercent).toFixed(1);
  const gapDesc = snap.gapPercent > 2
    ? `CPU 领先 ${gapPct}%`
    : snap.gapPercent < -2
      ? `CPU 落后 ${gapPct}%`
      : '两者进度相当';

  // 速度档位描述
  const vxAbs = Math.abs(snap.cpuVx);
  const speedDesc = vxAbs > 180 ? `快（${vxAbs.toFixed(0)} px/s）`
    : vxAbs > 90 ? `中等（${vxAbs.toFixed(0)} px/s）`
      : `慢（${vxAbs.toFixed(0)} px/s）`;

  // 是否卡住：水平速度极低且关节有角速度（说明在空转而非被地面推着走）
  const stuck = vxAbs < 20 && (Math.abs(snap.shoulderW) + Math.abs(snap.hipW)) > 1;

  // 核心要克服的目标地形（正在应对或即将面对的）
  const targetType = snap.targetSection || snap.currentSection;
  const targetName = TERRAIN_ZH[targetType] || targetType;
  const isApproaching = Boolean(snap.upcomingSection && snap.distToUpcoming > 0);

  const constraints = [];
  if (snap.inTunnel) constraints.push('当前处于低矮隧道天花板限制中，身体必须最小化');
  if (snap.inWater) constraints.push('当前在深水/泥沼中');
  if (stuck) constraints.push('⚠️ CPU 当前已卡死停滞，必须立即切换最适合当前地形的破障姿势脱困！');

  const terrainAlert = isApproaching
    ? `⚠️ 关键路况：前方 ${(snap.distToUpcoming).toFixed(0)} 像素处即将遭遇「${targetName}」障碍！`
    : `当前路况：正在通过「${targetName}」地形区域。`;

  const physHint = TERRAIN_PHYSICS_HINTS[targetType] || '';

  const expertHint = snap.planPose
    ? `力学动力学引擎推荐姿势：${snap.planPose}。`
    : '';

  return [
    `关卡：第 ${snap.stage + 1} 关（${snap.stageName}）。`,
    terrainAlert,
    physHint,
    expertHint,
    constraints.length ? constraints.join('；') + '。' : '',
    `状态：CPU 进度 ${(snap.cpuProgress * 100).toFixed(0)}%，` +
    `玩家进度 ${(snap.playerProgress * 100).toFixed(0)}%，${gapDesc}。`,
    `速度：CPU 水平速度 ${speedDesc}。`,
    `比赛已进行 ${snap.raceTime} 秒。`,
  ].filter(Boolean).join('\n');
}

// ─── BFF 代理端点配置 ──────────────────────────────────────────

/** 默认 Cloudflare Worker BFF 代理端点（本地开发默认端口 8787） */
export const DEFAULT_BFF_URL = 'https://cf-bff.504105925.workers.dev/typesafe';

/**
 * 获取 TypeSafe 代理请求端点（避免浏览器直连触发 CORS 错误）
 * @param {string} [customUrl] - 自定义代理地址
 * @returns {string}
 */
export function getTypesafeEndpoint(customUrl) {
  if (customUrl && typeof customUrl === 'string' && customUrl.trim()) {
    return customUrl.trim();
  }
  if (typeof window !== 'undefined') {
    if (window.__TYPESAFE_BFF_URL) return window.__TYPESAFE_BFF_URL;
    const stored = window.localStorage?.getItem('typesafe_bff_url');
    if (stored && stored.trim()) return stored.trim();
    if (window.location && window.location.port === '8787') {
      return '/typesafe';
    }
  }
  return DEFAULT_BFF_URL;
}

// ─── TypeSafe AI 查询 ─────────────────────────────────────────

/**
 * 向 TypeSafe Jev 模型查询 CPU 最优姿势（经由 Cloudflare Worker BFF 代理）
 *
 * 静默错误策略：
 *   - 任何网络错误、API 错误、解析错误 → 返回 null
 *   - 调用方收到 null 后自动降级到规则 AI，不影响游戏体验
 *   - 不向用户显示任何错误提示
 *
 * @param {object} snap   - 物理快照（由 game.js 构建）
 * @param {string} apiKey - TypeSafe API Key
 * @param {string} [bffUrl] - 可选自定义 BFF 代理端点
 * @returns {Promise<{pose:string, boost:boolean}|null>}
 */
export async function queryCpuAI(snap, apiKey, bffUrl) {
  if (!apiKey) return null;

  const endpoint = getTypesafeEndpoint(bffUrl);
  const state = buildStateText(snap);

  let response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'jev-latest',
        state,
        questions: {
          // Choice：从 4 种预设姿势中选最优解
          pose: {
            type: 'choice',
            instructions: `核心决策任务：为克服前方「${TERRAIN_ZH[snap.targetSection || snap.currentSection] || '目标'}」地形，请选择唯一力学最优姿势`,
            criteria: {
              long: '长腿十字（无手臂，长腿伸直呈十字）：【必选用于】「阶梯台阶」、「跨栏障碍」、「连续凹坑/深坑」、「逆向传送带」和「泥浆沼泽」。长腿能勾住台阶棱角与坑壁翻越，严禁用于低矮隧道。',
              climb: '攀爬姿势（超长手臂+极短腿）：【必选用于】「垂直高墙」和「陡坡悬壁」。手臂超长可扒住墙头拉动身体翻越高墙，遇到高墙必须选此姿势；其他平缓地形或台阶效果差。',
              small: '微缩轮（微型极小圆轮）：【必选用于】「低矮隧道」和「天花板限制区段」。极致缩小体型避免头顶撞击天花板卡死，遇到隧道必须选此姿势；出隧道后需及时更换。',
              round: '圆形大轮（双半圆饱满大轮）：【必选用于】「平地」、「起伏丘陵」、「颠簸路」、「大波浪」以及「水池划水」。滚动平稳阻力最小、冲刺速度最快；但在垂直阶梯、高墙、深坑处会彻底卡死打滑！',
            },
          },
          // Noul：是否需要提速追赶
          boost: {
            type: 'noul',
            instructions: 'CPU 明显落后于玩家（落后超过 5% 进度），需要提速追赶',
          },
        },
      }),
    });
  } catch {
    // 网络错误、超时、AbortError → 静默降级
    return null;
  } finally {
    clearTimeout(timer);
  }

  // HTTP 错误（401 key无效、429 限流等）→ 静默降级
  if (!response.ok) return null;

  let data;
  try {
    data = await response.json();
  } catch {
    return null;
  }

  // 解析结果
  const pose = data?.answers?.pose?.choice ?? null;
  const boost = (data?.answers?.boost?.noul ?? 0) > 0.55;

  // pose 必须是已知姿势，否则降级
  if (!['round', 'long', 'small', 'climb'].includes(pose)) return null;

  return { pose, boost };
}

// ─── 物理快照构建 ──────────────────────────────────────────────

/**
 * 从游戏状态构建物理快照对象
 *
 * 在 game.js 中每次 CPU 进入新区段时调用。
 *
 * @param {object} params - { cpu, player, terrainData, raceTime, stage, STAGE_NAMES, STAGES, waterLevelFn, ceilingFn, planPose }
 * @returns {object} 物理快照
 */
export function buildSnapshot({
  cpu, player, terrainData, raceTime, stage,
  STAGE_NAMES, STAGES, waterLevelFn, ceilingFn,
  planPose,
}) {
  const { SECTIONS, FINISH_X } = terrainData;

  // 当前区段（已经踏入的最后一个区段）
  const currentSec = SECTIONS.findLast(s => cpu.x >= s.from) ?? SECTIONS[0];
  // 紧接着即将面对的障碍区段（向前扫描 120 像素）
  const upcomingSec = SECTIONS.find(s => s.from > cpu.x && s.from <= cpu.x + 120 && s.type !== currentSec.type);
  // 目标区段：如果 120px 内即将遭遇障碍，则以此障碍为核心判断依据；否则为当前区段
  const targetSec = upcomingSec || currentSec;
  // 下一区段（用于长远提示，跳过 flat）
  const nextSec = SECTIONS.find(s => s.from > (targetSec?.to ?? cpu.x) && s.type !== 'flat');

  // 进度（0–1）
  const cpuProgress = Math.min(1, cpu.x / FINISH_X);
  const playerProgress = Math.min(1, player.x / FINISH_X);
  const gapPercent = (cpuProgress - playerProgress) * 100; // 正=CPU领先

  // 地形限制
  const inWater = isFinite(waterLevelFn(cpu.x));
  const inTunnel = ceilingFn(cpu.x) > -Infinity;

  return {
    currentSection: currentSec?.type ?? 'flat',
    upcomingSection: upcomingSec?.type ?? null,
    distToUpcoming: upcomingSec ? Math.max(0, upcomingSec.from - cpu.x) : 0,
    targetSection: targetSec?.type ?? 'flat',
    nextSection: nextSec?.type ?? null,
    planPose: planPose ?? null,
    cpuProgress,
    playerProgress,
    gapPercent,
    cpuVx: cpu.vx,
    shoulderW: cpu.joints[0]?.w ?? 0,
    hipW: cpu.joints[1]?.w ?? 0,
    raceTime: raceTime.toFixed(1),
    stage,
    stageName: STAGE_NAMES[stage] ?? `第${stage + 1}关`,
    stageTotal: STAGES.length,
    inTunnel,
    inWater,
  };
}
