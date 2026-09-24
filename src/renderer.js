/**
 * renderer.js —— Canvas 渲染模块
 *
 * 职责：
 *   - 渲染天空渐变背景
 *   - 渲染地形（地面、天花板、特殊地面如冰/传送带/水/泥）
 *   - 渲染起点/终点旗帜
 *   - 渲染玩家和 CPU 角色
 *   - 渲染 HUD（进度条、计时器、关卡指示、结果面板）
 */

import { T, VIEW_W, START_X } from './constants.js';
import { terrainIndex, waterLevel } from './terrain.js';

// ─── 辅助函数 ──────────────────────────────────────────────────

/**
 * 获取 CSS 变量的值（用于读取主题色）
 * @param {string} name - CSS 变量名（如 '--player'）
 * @returns {string}
 */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * 绘制折线路径（不描边，调用方自行 stroke/fill）
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x,y}[]} pts - 点列
 */
function strokePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

/**
 * 绘制圆角矩形路径（不描边/填充）
 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// ─── 角色渲染 ──────────────────────────────────────────────────

/**
 * 在 canvas 上绘制一个物理角色
 *
 * 绘制顺序：躯干 → 头部 → 关节手脚（手脚在最上层）
 * 每条线先画深色描边（--ink），再画角色颜色（b.color），产生描边效果。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} b      - 物理对象
 * @param {number} alpha  - 透明度（CPU 略透明以示区分）
 */
export function drawBody(ctx, b, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(b.x, b.y);
  ctx.lineJoin = 'round';
  ctx.lineCap  = 'round';

  // 带描边效果的折线绘制函数
  const line = ln => {
    ctx.strokeStyle = cssVar('--ink'); ctx.lineWidth = T * 2 + 3; strokePath(ctx, ln);
    ctx.strokeStyle = b.color;        ctx.lineWidth = T * 2;      strokePath(ctx, ln);
  };

  // 躯干
  line(b.torsoLine);

  // 头部：白色填充圆 + 描边 + 眼睛
  ctx.beginPath();
  ctx.arc(b.head.x, b.head.y, b.head.r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.strokeStyle = cssVar('--ink'); ctx.lineWidth = 2.5; ctx.stroke();
  ctx.beginPath();
  ctx.arc(b.head.x + b.head.r * 0.45, b.head.y - b.head.r * 0.15, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = cssVar('--ink'); ctx.fill();

  // 关节手脚（绕关节中心旋转后绘制）
  for (const j of b.joints) {
    ctx.save();
    ctx.translate(j.ox, j.oy);
    ctx.rotate(j.a);
    for (const ln of j.lines) line(ln);
    ctx.restore();
  }

  ctx.restore();
}

// ─── 主渲染函数 ────────────────────────────────────────────────

/**
 * 渲染一帧完整画面
 *
 * @param {CanvasRenderingContext2D} ctx  - 比赛 canvas 上下文
 * @param {object} state                 - 游戏状态：
 *   { player, cpu, raceTime, stage, result, hud, dpr,
 *     terrainData: { TP, CPL, SECTIONS, FINISH_X },
 *     STAGES, POOL }
 */
export function render(ctx, state) {
  const { player, cpu, raceTime, stage, result, hud, dpr, terrainData, STAGES, POOL, STAGE_NAMES } = state;
  const { TP, CPL, SECTIONS, FINISH_X } = terrainData;
  const W = ctx.canvas.width, H = ctx.canvas.height;

  // ── 天空渐变 ──
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0,    '#3b4dbf');
  sky.addColorStop(0.5,  '#8ea4f8');
  sky.addColorStop(1,    '#d6c8ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // ── 相机跟随玩家 ──
  const zoom = W / VIEW_W;
  const VW = VIEW_W, VH = H / zoom;
  const px0 = player ? player.x : START_X;
  const py0 = player ? player.y : (TP.length ? TP[0].y - 40 : 260);
  const camX = Math.max(0, px0 - VW * 0.32);
  const camY = py0 - VH * 0.38;

  ctx.save();
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);
  ctx.lineJoin = 'round';

  // ── 地面 ──
  ctx.beginPath();
  ctx.moveTo(camX, camY + VH + 10);
  const i0 = terrainIndex(TP, camX);
  for (let i = i0; i < TP.length && TP[i].x <= camX + VW + 2; i++) {
    ctx.lineTo(TP[i].x, TP[i].y);
  }
  ctx.lineTo(camX + VW + 2, camY + VH + 10);
  ctx.closePath();
  ctx.fillStyle = cssVar('--ground');
  ctx.fill();

  // 地面竖纹（视觉参考线，判断进度）
  ctx.save(); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  const SW = 40;
  for (let sx = Math.floor(camX / (SW * 2)) * SW * 2; sx < camX + VW; sx += SW * 2) {
    ctx.fillRect(sx, camY - 10, SW, VH + 20);
  }
  ctx.restore();

  // ── 特殊地面：传送带 / 冰 ──
  for (const sec of SECTIONS) {
    if (sec.type !== 'belt' && sec.type !== 'ice') continue;
    if (sec.to < camX || sec.from > camX + VW) continue;
    ctx.lineWidth = 6; ctx.lineCap = 'butt';
    if (sec.type === 'ice') {
      // 冰：淡蓝色覆盖层
      ctx.strokeStyle = 'rgba(190,235,255,0.95)';
      ctx.beginPath();
      for (let i = terrainIndex(TP, sec.from); i <= terrainIndex(TP, sec.to); i++) {
        ctx.lineTo(TP[i].x, TP[i].y + 1);
      }
      ctx.stroke();
    } else {
      // 传送带：深色底 + 流动箭头纹
      const off = (raceTime * sec.speed * -1) % 24;
      ctx.strokeStyle = '#555b66'; ctx.lineWidth = 6; ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(sec.from, TP[terrainIndex(TP, sec.from)].y + 1);
      ctx.lineTo(sec.to,   TP[terrainIndex(TP, sec.to)].y + 1);
      ctx.stroke();
      ctx.strokeStyle = '#d9dde6'; ctx.lineWidth = 2;
      for (let sx = sec.from - off; sx < sec.to; sx += 24) {
        if (sx < sec.from) continue;
        const gy = TP[terrainIndex(TP, sx)].y;
        ctx.beginPath();
        ctx.moveTo(sx + 5, gy - 2);
        ctx.lineTo(sx,     gy + 2);
        ctx.lineTo(sx + 5, gy + 6);
        ctx.stroke();
      }
    }
  }

  // ── 隧道天花板 ──
  for (const sec of SECTIONS) {
    if (sec.type !== 'tunnel' && sec.type !== 'climb') continue;
    if (sec.to < camX || sec.from > camX + VW) continue;
    const x0 = sec.from + 60;
    const x1 = sec.type === 'climb' ? x0 + 260 : sec.to - 60;
    const cy  = CPL[terrainIndex(CPL, x0 + 1)].y;
    ctx.fillStyle = cssVar('--ground');
    ctx.fillRect(x0, camY - 10, x1 - x0, cy - camY + 10);
  }

  // ── 起点 / 终点旗帜 ──
  for (const [gx, label] of [[START_X, '起点'], [FINISH_X, '终点']]) {
    const gy = TP[terrainIndex(TP, gx)].y;
    ctx.strokeStyle = cssVar('--ink'); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 110); ctx.stroke();
    // 棋盘格旗子
    for (let ri = 0; ri < 6; ri++) {
      for (let k = 0; k < 2; k++) {
        ctx.fillStyle = (ri + k) % 2 ? '#fff' : cssVar('--ink');
        ctx.fillRect(gx + k * 8, gy - 110 + ri * 8, 8, 8);
      }
    }
    ctx.fillStyle = cssVar('--ink');
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(label, gx + 20, gy - 96);
  }

  // ── 角色 ──
  if (cpu)    drawBody(ctx, cpu,    0.85); // CPU 略透明
  if (player) drawBody(ctx, player, 1);

  // ── 水 / 泥覆盖层（半透明，覆盖在角色上方） ──
  for (const sec of SECTIONS) {
    if (sec.type !== 'water' && sec.type !== 'mud') continue;
    if (sec.to < camX || sec.from > camX + VW) continue;
    const wl = waterLevel(terrainData.WL, sec.from + 100); // 使用实际水位数组
    ctx.beginPath();
    ctx.moveTo(sec.from, wl);
    for (let i = terrainIndex(TP, sec.from); i <= terrainIndex(TP, sec.to); i++) {
      ctx.lineTo(TP[i].x, Math.max(TP[i].y, wl));
    }
    ctx.lineTo(sec.to, wl);
    ctx.closePath();
    ctx.fillStyle = sec.type === 'mud'
      ? 'rgba(120,80,40,0.8)'
      : 'rgba(70,150,235,0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sec.from, wl); ctx.lineTo(sec.to, wl); ctx.stroke();
  }

  ctx.restore(); // 结束缩放/平移变换

  // ── HUD（以 CSS 像素为基准，独立变换） ──
  ctx.save();
  ctx.scale(dpr, dpr);
  const cw = W / dpr, ch = H / dpr;
  const bx = 24, by = 22, bw = cw - 48;

  // 进度条背景线
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); ctx.stroke();

  // 需切换姿势的区段高亮（白色矩形块）
  for (const sec of SECTIONS) {
    if (!POOL.find(c => c.label === sec.label)?.block) continue;
    const x0 = bx + bw * (sec.from - START_X) / (FINISH_X - START_X);
    const x1 = bx + bw * (sec.to   - START_X) / (FINISH_X - START_X);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(x0, by - 4, x1 - x0, 8);
  }

  // 玩家 / CPU 位置圆点
  for (const [b, col, r] of [[cpu, '--cpu', 5], [player, '--player', 6]]) {
    if (!b) continue;
    const t = Math.min(Math.max((b.x - START_X) / (FINISH_X - START_X), 0), 1);
    ctx.fillStyle = cssVar(col);
    ctx.beginPath(); ctx.arc(bx + bw * t, by, r, 0, Math.PI * 2); ctx.fill();
  }

  // 计时器
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(raceTime.toFixed(1) + ' 秒', cw - 24, 48);
  ctx.textAlign = 'left';

  // 关卡指示：圆点 + 难度名称（居中排列，适配最多5关）
  {
    const dotSpacing = Math.min(50, (cw - 120) / Math.max(STAGES.length - 1, 1));
    const totalW = (STAGES.length - 1) * dotSpacing;
    const dotX0  = cw / 2 - totalW / 2;
    ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    for (let i = 0; i < STAGES.length; i++) {
      const dx = dotX0 + i * dotSpacing;
      const isCurrent = i === stage;
      // 圆点
      ctx.beginPath(); ctx.arc(dx, 48, isCurrent ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent ? '#fff' : 'rgba(255,255,255,0.35)'; ctx.fill();
      // 难度名称（当前关卡显示完整名；其余小字）
      if (STAGE_NAMES) {
        ctx.fillStyle = isCurrent ? '#fff' : 'rgba(255,255,255,0.4)';
        ctx.font = isCurrent ? 'bold 9px sans-serif' : '8px sans-serif';
        ctx.fillText(STAGE_NAMES[i], dx, 62);
      }
    }
    ctx.textAlign = 'left';
  }

  // ── 结果面板 ──
  if (result) {
    const pw = Math.min(cw - 40, 340), ph = 260;
    const px = (cw - pw) / 2, py = ch * 0.12;

    // 面板背景
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.strokeStyle = cssVar('--ink'); ctx.lineWidth = 2;
    roundRect(ctx, px, py, pw, ph, 18); ctx.fill(); ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // 胜负标题
    ctx.fillStyle = result === 'WIN' ? cssVar('--player') : cssVar('--cpu');
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(result === 'WIN' ? '冲线！胜利 🎉' : '冲线…败北 😓', cw / 2, py + 44);

    // 关卡信息（含难度名称）
    const diffName = STAGE_NAMES ? STAGE_NAMES[stage] : `第 ${stage + 1} 关`;
    ctx.fillStyle = cssVar('--ink'); ctx.font = '16px sans-serif';
    ctx.fillText(`第 ${stage + 1} 关【${diffName}】/ 共 ${STAGES.length} 关`, cw / 2, py + 88);

    // 时间
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(`用时 ${raceTime.toFixed(2)} 秒`, cw / 2, py + 128);

    // 按钮（重试 / 下一关，分享）
    const bBtnW = pw - 48, bBtnH = 40;
    const mainLabel = result === 'WIN'
      ? (stage + 1 < STAGES.length ? '下一关 →' : '重回第1关')
      : '再来一次';

    hud.restart = { x: px + 24, y: py + 164, w: bBtnW, h: bBtnH };
    hud.share   = { x: px + 24, y: py + 212, w: bBtnW, h: bBtnH };

    for (const [k, label, fill, color] of [
      ['restart', mainLabel,  cssVar('--ink'), '#fff'],
      ['share',   '分享成绩', '#fff',          cssVar('--ink')],
    ]) {
      const r = hud[k];
      ctx.fillStyle = fill; ctx.strokeStyle = cssVar('--ink'); ctx.lineWidth = 2;
      roundRect(ctx, r.x, r.y, r.w, r.h, 20); ctx.fill(); ctx.stroke();
      ctx.fillStyle = color; ctx.font = 'bold 16px sans-serif';
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    }

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  ctx.restore();
}
