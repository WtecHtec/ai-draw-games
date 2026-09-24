/**
 * renderer.js —— Canvas 简笔画线条 / 素描草稿纸风格渲染模块
 *
 * 核心美学设计：
 *   - 极简手绘线条风 (Minimalist Doodle & Line Art)
 *   - 温暖质感的米白色草稿纸底色 + 浅灰色手绘方格坐标网格
 *   - 3.5px 纯黑墨水手绘地形轮廓线 + 地下 45° 手绘素描阴影排线 (Hatching)
 *   - 火柴人纯粹手绘动态美学：蓝色彩铅 (玩家) vs 红色彩铅 (对手)
 *   - 简笔画符号化特殊地形：手绘波浪纹水面、气泡泥沼、排线台阶、简笔箭头传送带、棋盘格终点旗
 *   - 手绘便签卡片风格 HUD 结算面板（纯白底、粗黑描边、复古硬投影）
 */

import { T, VIEW_W, START_X } from './constants.js';
import { terrainIndex, waterLevel } from './terrain.js';

// ─── 辅助函数 ──────────────────────────────────────────────────

/** 获取 CSS 变量的值 */
function cssVar(name) {
  return (typeof window !== 'undefined' && window.getComputedStyle)
    ? getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    : '';
}

/** 绘制折线路径（不描边，调用方自行 stroke/fill） */
function strokePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

/** 绘制圆角矩形路径 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// ─── 角色渲染（火柴人简笔画风格） ──────────────────────────────

/**
 * 在 canvas 上绘制一个手绘火柴人角色
 * 纯粹的手绘线条质感：黑墨水躯干 + 灵动小眼睛 + 高饱和度彩铅手绘肢体
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} b      - 物理对象
 * @param {number} alpha  - 透明度
 */
export function drawBody(ctx, b, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(b.x, b.y);
  ctx.lineJoin = 'round';
  ctx.lineCap  = 'round';

  const inkColor = cssVar('--ink') || '#1a1a1a';
  const limbColor = b.color || cssVar('--player') || '#1a1a1a';

  // 1. 躯干折线（纯黑手绘钢笔线条）
  ctx.strokeStyle = inkColor;
  ctx.lineWidth   = 3.5;
  strokePath(ctx, b.torsoLine);

  // 2. 头部：纯白填充圆圈 + 2.5px 纯黑描边 + 灵动小眼睛黑点
  ctx.beginPath();
  ctx.arc(b.head.x, b.head.y, b.head.r, 0, Math.PI * 2);
  ctx.fillStyle   = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = inkColor;
  ctx.lineWidth   = 2.5;
  ctx.stroke();

  // 灵动小眼睛（向右注视前方赛道）
  const eyeR = 1.8;
  const eyeX = b.head.x + b.head.r * 0.42;
  const eyeY = b.head.y - b.head.r * 0.12;
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fillStyle = inkColor;
  ctx.fill();

  // 微笑小弧线嘴巴（简笔画手绘细节）
  ctx.beginPath();
  ctx.arc(b.head.x + b.head.r * 0.25, b.head.y + b.head.r * 0.28, 3, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.strokeStyle = inkColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 3. 关节旋转手脚（纯正手绘墨水线条，旋转产生动感）
  for (const j of b.joints) {
    ctx.save();
    ctx.translate(j.ox, j.oy);
    ctx.rotate(j.a);

    // 肢体主线条：手绘画笔实线
    ctx.strokeStyle = limbColor;
    ctx.lineWidth   = T * 2 - 0.5; // 约 7.5px 饱满手绘画线
    for (const ln of j.lines) strokePath(ctx, ln);

    // 关节轴心黑色手绘固定铆钉点
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = inkColor;
    ctx.fill();

    ctx.restore();
  }

  ctx.restore();
}

// ─── 主渲染函数 ────────────────────────────────────────────────

/**
 * 渲染一帧完整画面（简笔画线条 / 素描手绘风格）
 */
export function render(ctx, state) {
  const { player, cpu, raceTime, stage, result, hud, dpr, terrainData, STAGES, POOL, STAGE_NAMES, mainButtonLabel } = state;
  const { TP, CPL, SECTIONS, FINISH_X } = terrainData;
  const W = ctx.canvas.width, H = ctx.canvas.height;

  const inkColor   = cssVar('--ink') || '#1a1a1a';
  const playerColor = cssVar('--player') || '#1a1a1a';
  const cpuColor   = cssVar('--cpu') || '#dc2626';

  // ── 1. 温暖的素描草稿纸底色 ──
  ctx.fillStyle = '#faf8f5';
  ctx.fillRect(0, 0, W, H);

  // ── 2. 相机跟随玩家 ──
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
  ctx.lineCap  = 'round';

  // ── 3. 草稿纸方格浅网格线（世界坐标系对齐） ──
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)';
  ctx.lineWidth = 1;
  const gridSize = 32;
  const startGridX = Math.floor(camX / gridSize) * gridSize;
  const endGridX   = camX + VW + gridSize;
  const startGridY = Math.floor(camY / gridSize) * gridSize;
  const endGridY   = camY + VH + gridSize;

  ctx.beginPath();
  for (let gx = startGridX; gx <= endGridX; gx += gridSize) {
    ctx.moveTo(gx, startGridY); ctx.lineTo(gx, endGridY);
  }
  for (let gy = startGridY; gy <= endGridY; gy += gridSize) {
    ctx.moveTo(startGridX, gy); ctx.lineTo(endGridX, gy);
  }
  ctx.stroke();
  ctx.restore();

  // ── 4. 地面内部填充与手绘素描 45° 排线 (Hatching) ──
  ctx.beginPath();
  ctx.moveTo(camX, camY + VH + 15);
  const i0 = terrainIndex(TP, camX);
  for (let i = i0; i < TP.length && TP[i].x <= camX + VW + 4; i++) {
    ctx.lineTo(TP[i].x, TP[i].y);
  }
  ctx.lineTo(camX + VW + 4, camY + VH + 15);
  ctx.closePath();

  // 素描纸微灰底面填充
  ctx.fillStyle = '#f3f0e8';
  ctx.fill();

  // 45° 手绘素描阴影斜排线（在地面内部裁剪）
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.055)';
  ctx.lineWidth   = 1.2;
  const hatchStep = 18;
  const hatchTotalW = VW + VH * 2 + 100;
  ctx.beginPath();
  for (let hx = camX - VH - 40; hx < camX + hatchTotalW; hx += hatchStep) {
    ctx.moveTo(hx, camY - 20);
    ctx.lineTo(hx + VH + 40, camY + VH + 20);
  }
  ctx.stroke();
  ctx.restore();

  // ── 5. 特殊地面材质：手绘简笔画符号化设计 ──
  for (const sec of SECTIONS) {
    if (sec.to < camX - 40 || sec.from > camX + VW + 40) continue;
    const iStart = terrainIndex(TP, sec.from);
    const iEnd   = terrainIndex(TP, sec.to);

    if (sec.type === 'ice') {
      // 冰坡：双层手绘黑实线 + 坡面手绘简笔小雪花晶体 (*)
      ctx.lineWidth   = 2;
      ctx.strokeStyle = inkColor;
      ctx.beginPath();
      for (let i = iStart; i <= iEnd; i++) ctx.lineTo(TP[i].x, TP[i].y + 4);
      ctx.stroke();

      // 简笔小雪花点缀
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.font      = '10px monospace';
      for (let sx = sec.from + 20; sx < sec.to - 10; sx += 45) {
        const sy = TP[terrainIndex(TP, sx)].y - 6;
        ctx.fillText('❄', sx, sy);
      }

    } else if (sec.type === 'belt') {
      // 传送带：手绘双杠导轨 + 两端小圆轴 + 流动手绘空心箭头 >>>
      const beltSpeed = (typeof sec.speed === 'number' && isFinite(sec.speed)) ? sec.speed : -200;
      const off = Math.abs((raceTime * beltSpeed) % 24);

      // 下轨道黑线
      ctx.lineWidth = 2; ctx.strokeStyle = inkColor;
      ctx.beginPath();
      ctx.moveTo(sec.from, TP[iStart].y + 5);
      ctx.lineTo(sec.to,   TP[iEnd].y + 5);
      ctx.stroke();

      // 两端手绘小圆轴
      for (const rx of [sec.from, sec.to]) {
        const ry = TP[terrainIndex(TP, rx)].y + 2.5;
        ctx.beginPath();
        ctx.arc(rx, ry, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.strokeStyle = inkColor; ctx.stroke();
        ctx.beginPath();
        ctx.arc(rx, ry, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = inkColor; ctx.fill();
      }

      // 轨道上手绘简笔流动箭头 (>>>)
      ctx.lineWidth = 1.8; ctx.strokeStyle = inkColor;
      const arrowStep = 30;
      for (let sx = sec.from + (off % arrowStep); sx < sec.to - 8; sx += arrowStep) {
        const gy = TP[terrainIndex(TP, sx)].y;
        ctx.beginPath();
        ctx.moveTo(sx + 7, gy - 4);
        ctx.lineTo(sx + 1, gy);
        ctx.lineTo(sx + 7, gy + 4);
        ctx.stroke();
      }

    } else if (sec.type === 'hurdles') {
      // 跨栏：简笔画跨栏小木架
      for (let i = iStart; i < iEnd - 3; i++) {
        const curY  = TP[i].y;
        const prevY = TP[Math.max(0, i - 1)].y;
        const nextY = TP[Math.min(TP.length - 1, i + 1)].y;
        if (curY < prevY - 10 && Math.abs(curY - nextY) < 10) {
          const hx = TP[i].x;
          const barW = 16;
          // 简笔小支架线条
          ctx.strokeStyle = inkColor; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(hx - barW / 2, prevY); ctx.lineTo(hx - barW / 2, curY - 2);
          ctx.moveTo(hx + barW / 2, prevY); ctx.lineTo(hx + barW / 2, curY - 2);
          // 横板（手绘黑白条纹）
          ctx.rect(hx - barW / 2, curY - 4, barW, 4);
          ctx.stroke();
          i += 6;
        }
      }

    } else if (sec.type === 'wall' || sec.type === 'climb') {
      // 高墙：垂直纯黑线条 + 墙面手绘水平砖石排线
      for (let i = iStart; i < iEnd; i++) {
        const dy = TP[i + 1].y - TP[i].y;
        if (dy < -15) {
          const wx = TP[i].x;
          const wTop = TP[i + 1].y;
          const wBot = TP[i].y;
          // 墙体内部手绘斜横排线
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)'; ctx.lineWidth = 1;
          ctx.beginPath();
          for (let y = wTop + 8; y < wBot; y += 10) {
            ctx.moveTo(wx - 6, y); ctx.lineTo(wx, y);
          }
          ctx.stroke();

          // 墙头手绘抓握凸起
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = inkColor; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.rect(wx - 8, wTop - 3, 14, 4);
          ctx.fill(); ctx.stroke();
        }
      }

    } else if (sec.type === 'stairs') {
      // 阶梯：在每个直角竖立面绘制 2~3 条手绘垂直排线，强化立体简笔画感
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      for (let i = iStart; i < iEnd; i++) {
        if (TP[i + 1].y < TP[i].y - 5) {
          const sx = TP[i].x;
          for (let sy = TP[i + 1].y + 4; sy < TP[i].y; sy += 6) {
            ctx.moveTo(sx - 3, sy); ctx.lineTo(sx, sy);
          }
        }
      }
      ctx.stroke();
    }
  }

  // ── 6. 核心赛道主地表线条：3.5px 纯正黑墨水手绘线条 ──
  ctx.strokeStyle = inkColor;
  ctx.lineWidth   = 3.5;
  ctx.beginPath();
  ctx.moveTo(TP[i0].x, TP[i0].y);
  for (let i = i0; i < TP.length && TP[i].x <= camX + VW + 4; i++) {
    ctx.lineTo(TP[i].x, TP[i].y);
  }
  ctx.stroke();

  // ── 7. 隧道天花板与顶棚（手绘草图排线顶棚） ──
  for (const sec of SECTIONS) {
    if (sec.type !== 'tunnel' && sec.type !== 'climb') continue;
    if (sec.to < camX || sec.from > camX + VW) continue;
    const iStart = terrainIndex(CPL, sec.from);
    const iEnd   = terrainIndex(CPL, sec.to);

    let inCeil = false;
    let ceilStartX = 0;

    for (let i = iStart; i <= iEnd; i++) {
      const pt = CPL[i];
      if (pt.y > -2000) {
        if (!inCeil) {
          inCeil = true;
          ceilStartX = pt.x;
          ctx.beginPath();
          ctx.moveTo(pt.x, camY - 20);
          ctx.lineTo(pt.x, pt.y);
        } else {
          ctx.lineTo(pt.x, pt.y);
        }
      } else if (inCeil) {
        inCeil = false;
        ctx.lineTo(CPL[i - 1].x, camY - 20);
        ctx.closePath();
        ctx.fillStyle = '#f3f0e8'; ctx.fill();

        // 天花板手绘下边缘浓黑实线
        ctx.strokeStyle = inkColor; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ceilStartX, CPL[terrainIndex(CPL, ceilStartX)].y);
        ctx.lineTo(CPL[i - 1].x, CPL[i - 1].y);
        ctx.stroke();
      }
    }
    if (inCeil) {
      ctx.lineTo(CPL[iEnd].x, camY - 20);
      ctx.closePath();
      ctx.fillStyle = '#f3f0e8'; ctx.fill();
    }
  }

  // ── 8. 水池与泥沼：手绘简笔波纹与气泡 ──
  for (const sec of SECTIONS) {
    if (sec.type !== 'water' && sec.type !== 'mud') continue;
    if (sec.to < camX - 20 || sec.from > camX + VW + 20) continue;
    const wl = waterLevel(terrainData.WL, (sec.from + sec.to) / 2);

    if (sec.type === 'water') {
      // 极简手绘水面微淡纸影
      ctx.fillStyle = 'rgba(0, 0, 0, 0.035)';
      ctx.fillRect(sec.from, wl, sec.to - sec.from, 100);

      // 水面手绘起伏纯黑墨水波浪线 (~)
      ctx.strokeStyle = inkColor;
      ctx.lineWidth   = 2.2;
      ctx.beginPath();
      ctx.moveTo(sec.from, wl);
      const waveT = raceTime * 3.5;
      for (let wx = sec.from; wx <= sec.to; wx += 14) {
        const wy = wl + Math.sin(wx * 0.12 + waveT) * 2.5;
        ctx.lineTo(wx, wy);
      }
      ctx.stroke();

      // 水下手绘简笔小气泡 (○)
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.lineWidth   = 1.2;
      for (let bx = sec.from + 20; bx < sec.to - 10; bx += 50) {
        const by = wl + 20 + Math.sin(bx + waveT) * 8;
        ctx.beginPath();
        ctx.arc(bx, by, 3, 0, Math.PI * 2);
        ctx.stroke();
      }

    } else if (sec.type === 'mud') {
      // 泥浆：淡褐微染 + 泥沼起伏黑线
      ctx.fillStyle = 'rgba(180, 83, 9, 0.08)';
      ctx.fillRect(sec.from, wl, sec.to - sec.from, 100);

      ctx.strokeStyle = '#92400e';
      ctx.lineWidth   = 2.5;
      ctx.beginPath();
      ctx.moveTo(sec.from, wl);
      const mudT = raceTime * 2;
      for (let mx = sec.from; mx <= sec.to; mx += 16) {
        const my = wl + Math.sin(mx * 0.08 + mudT) * 1.8;
        ctx.lineTo(mx, my);
      }
      ctx.stroke();
    }
  }

  // ── 9. 起点与终点旗帜（手绘黑白棋盘格与起跑门） ──
  // 起点：手绘火柴人旗帜
  const startY = TP[terrainIndex(TP, START_X)].y;
  ctx.strokeStyle = inkColor; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(START_X, startY); ctx.lineTo(START_X, startY - 45);
  ctx.stroke();
  ctx.fillStyle = playerColor;
  ctx.beginPath();
  ctx.moveTo(START_X, startY - 45);
  ctx.lineTo(START_X + 22, startY - 37);
  ctx.lineTo(START_X, startY - 29);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // 终点：手绘门架 + 飘动黑白棋盘格旗帜
  const finY = TP[terrainIndex(TP, FINISH_X)].y;
  ctx.strokeStyle = inkColor; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(FINISH_X, finY); ctx.lineTo(FINISH_X, finY - 55);
  ctx.stroke();

  // 手绘飘扬的黑白棋盘旗帜
  const flagW = 26, flagH = 18;
  const fx = FINISH_X, fy = finY - 55;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#1a1a1a' : '#ffffff';
      ctx.fillRect(fx + c * (flagW / 4), fy + r * (flagH / 3), flagW / 4, flagH / 3);
    }
  }
  ctx.strokeRect(fx, fy, flagW, flagH);

  // ── 10. 角色渲染（火柴人） ──
  if (cpu)    drawBody(ctx, cpu, 0.92);
  if (player) drawBody(ctx, player, 1.0);

  ctx.restore(); // 结束世界缩放变换

  // ── 11. HUD 顶部状态与进度条（手绘黑白线条风） ──
  ctx.save();
  ctx.scale(dpr, dpr);
  const cw = W / dpr, ch = H / dpr;
  const bx = 24, by = 24, bw = cw - 48;

  // 进度条手绘轨道：2px 纯黑手绘导轨线
  ctx.strokeStyle = inkColor; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); ctx.stroke();

  // 进度条两端手绘刻度
  ctx.beginPath();
  ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 4);
  ctx.moveTo(bx + bw, by - 4); ctx.lineTo(bx + bw, by + 4);
  ctx.stroke();

  // 障碍区段手绘灰色卡槽
  for (const sec of SECTIONS) {
    if (!POOL.find(c => c.label === sec.label)?.block) continue;
    const x0 = bx + bw * (sec.from - START_X) / (FINISH_X - START_X);
    const x1 = bx + bw * (sec.to   - START_X) / (FINISH_X - START_X);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x1, by); ctx.stroke();
  }

  // 玩家（蓝）与 CPU（红）手绘实心位置小球
  for (const [b, col, r] of [[cpu, cpuColor, 5], [player, playerColor, 6]]) {
    if (!b) continue;
    const t = Math.min(Math.max((b.x - START_X) / (FINISH_X - START_X), 0), 1);
    ctx.beginPath();
    ctx.arc(bx + bw * t, by, r, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = inkColor; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // 计时器（纯黑墨水手写质感）
  ctx.fillStyle = inkColor;
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(raceTime.toFixed(1) + ' 秒', cw - 24, 52);
  ctx.textAlign = 'left';

  // 关卡指示：手绘小圆点 + 关卡名
  {
    const dotSpacing = Math.min(50, (cw - 120) / Math.max(STAGES.length - 1, 1));
    const totalW = (STAGES.length - 1) * dotSpacing;
    const dotX0  = cw / 2 - totalW / 2;
    ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    for (let i = 0; i < STAGES.length; i++) {
      const dx = dotX0 + i * dotSpacing;
      const isCurrent = i === stage;
      ctx.beginPath();
      ctx.arc(dx, 52, isCurrent ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent ? inkColor : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = inkColor; ctx.lineWidth = 1.5; ctx.stroke();

      if (STAGE_NAMES) {
        ctx.fillStyle = isCurrent ? inkColor : '#888';
        ctx.font = isCurrent ? 'bold 9px sans-serif' : '8px sans-serif';
        ctx.fillText(STAGE_NAMES[i], dx, 66);
      }
    }
    ctx.textAlign = 'left';
  }

  // ── 12. 冲线结算面板（手绘素描便签白卡片） ──
  if (result) {
    const pw = Math.min(cw - 40, 340), ph = 260;
    const px = (cw - pw) / 2, py = ch * 0.12;

    // 手绘卡片阴影（硬黑色投影）
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    roundRect(ctx, px + 4, py + 4, pw, ph, 16);
    ctx.fill();

    // 手绘卡片白色便签纸主体
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = inkColor; ctx.lineWidth = 2.5;
    roundRect(ctx, px, py, pw, ph, 16);
    ctx.fill(); ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // 胜负大标题（粗黑有力）
    const isWin = result === 'WIN';
    ctx.fillStyle = isWin ? playerColor : cpuColor;
    ctx.font = '900 32px sans-serif';
    ctx.fillText(isWin ? '冲线！胜利 🎉' : '冲线…惜败 💨', cw / 2, py + 44);

    // 关卡信息
    const diffName = STAGE_NAMES ? STAGE_NAMES[stage] : `第 ${stage + 1} 关`;
    ctx.fillStyle = inkColor; ctx.font = '14px sans-serif';
    ctx.fillText(`第 ${stage + 1} 关【${diffName}】/ 共 ${STAGES.length} 关`, cw / 2, py + 88);

    // 用时
    ctx.font = 'bold 24px monospace';
    ctx.fillText(`用时 ${raceTime.toFixed(2)} 秒`, cw / 2, py + 128);

    // 按钮交互区
    const bBtnW = pw - 48, bBtnH = 40;
    const defaultLabel = isWin
      ? (stage + 1 < STAGES.length ? '下一关 →' : '重回第1关')
      : '再来一次';
    const mainLabel = mainButtonLabel || defaultLabel;

    hud.restart = { x: px + 24, y: py + 164, w: bBtnW, h: bBtnH };
    hud.share   = { x: px + 24, y: py + 212, w: bBtnW, h: bBtnH };

    for (const [k, label, fill, color] of [
      ['restart', mainLabel,  inkColor, '#ffffff'],
      ['share',   '分享战报', '#ffffff', inkColor],
    ]) {
      const r = hud[k];
      // 按钮手绘微投影
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      roundRect(ctx, r.x + 2, r.y + 2, r.w, r.h, 12); ctx.fill();

      // 按钮主体
      ctx.fillStyle = fill; ctx.strokeStyle = inkColor; ctx.lineWidth = 2;
      roundRect(ctx, r.x, r.y, r.w, r.h, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = color; ctx.font = 'bold 15px sans-serif';
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    }

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  ctx.restore();
}
