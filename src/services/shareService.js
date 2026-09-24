/**
 * shareService.js —— 战绩战报与社交分享应用服务
 *
 * 职责：
 *   - 根据完赛用时与胜负智能生成趣味称号和幽默评语
 *   - 生成 750×1000 电影级高颜值战绩分享海报（含手绘小车展台展示）
 *   - 调用 Web Share API 或展示高质感毛玻璃弹窗（支持图片长按保存与一键复制）
 */

import { drawBody } from '../renderer.js';

let sharing = false;

/** 绘制圆角矩形辅助函数 */
export function fillRoundRect(g, x, y, w, h, r, fill, stroke) {
  g.save();
  g.beginPath();
  if (typeof g.roundRect === 'function') {
    g.roundRect(x, y, w, h, r);
  } else {
    g.rect(x, y, w, h);
  }
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = 1.5; g.strokeStyle = stroke; g.stroke(); }
  g.restore();
}

/** 根据用时与胜负智能生成趣味称号和评语 */
export function getFunTitle(isWin, time) {
  if (!isWin) {
    const loseTitles = [
      { title: '🧗 翻滚爬行显眼包', quote: '「虽败犹荣！轮子具有后现代行为艺术之美！」' },
      { title: '🚧 赛道质检工程师', quote: '「我不是卡住了，我是在实地严谨考察路况！」' },
      { title: '🌪️ 物理学受害人', quote: '「牛顿定律暂时占了上风，下把必翻盘！」' },
    ];
    return loseTitles[Math.floor(Math.random() * loseTitles.length)];
  }
  if (time < 5.0) {
    return { title: '⚡ 超光速贴地飞行神', quote: '「对手还没起步，我已经到终点喝下午茶了！」' };
  } else if (time < 8.5) {
    return { title: '🚀 达芬奇在世 · 造轮大师', quote: '「精妙绝伦的力学轮子，物理老师直呼内行！」' };
  } else if (time < 13.0) {
    return { title: '🌀 物理学奇迹 · 破壁人', quote: '「只要轮子画得奇，没有翻不过去的高山！」' };
  } else {
    return { title: '👑 坚韧越野老司机', quote: '「一路颠簸翻滚，但我终究登顶了终点！」' };
  }
}

/** 绘制高颜值、高传播度的战绩分享卡片 */
export function renderShareCardCanvas(c, { player, stage, stageName, result, raceTime, cpuMode }) {
  const g = c.getContext('2d');
  const w = c.width;
  const h = c.height;

  // 1. 深色极光渐变背景
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0d0f2b');
  bg.addColorStop(0.4, '#1b1744');
  bg.addColorStop(0.8, '#2b1654');
  bg.addColorStop(1, '#100b28');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  // 柔和光晕
  const glow1 = g.createRadialGradient(w * 0.2, h * 0.15, 20, w * 0.2, h * 0.15, 300);
  glow1.addColorStop(0, 'rgba(229, 81, 186, 0.22)');
  glow1.addColorStop(1, 'rgba(229, 81, 186, 0)');
  g.fillStyle = glow1;
  g.fillRect(0, 0, w, h);

  const glow2 = g.createRadialGradient(w * 0.85, h * 0.45, 30, w * 0.85, h * 0.45, 320);
  glow2.addColorStop(0, 'rgba(124, 58, 237, 0.25)');
  glow2.addColorStop(1, 'rgba(124, 58, 237, 0)');
  g.fillStyle = glow2;
  g.fillRect(0, 0, w, h);

  // 2. 外框微光边框
  const m = 22;
  fillRoundRect(g, m, m, w - m * 2, h - m * 2, 28, 'rgba(255, 255, 255, 0.02)', 'rgba(255, 255, 255, 0.16)');

  // 3. 顶部 Header 药丸（游戏名称 + 关卡）
  fillRoundRect(g, 48, 48, w - 96, 44, 22, 'rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.12)');
  g.fillStyle = '#fff';
  g.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('🎨 绘制滚轮赛跑 · DRAW ROLL RACE', 68, 70);

  g.textAlign = 'right';
  g.font = 'bold 15px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = '#ff70a6';
  g.fillText(`第 ${stage + 1} 关 · ${stageName}`, w - 68, 70);

  // 4. 胜负大标题 & 趣味称号
  const isWin = result === 'WIN';
  const fun = getFunTitle(isWin, raceTime);

  g.textAlign = 'center';
  g.font = '900 42px -apple-system, BlinkMacSystemFont, sans-serif';
  if (isWin) {
    g.fillStyle = '#ffd166';
    g.shadowColor = 'rgba(255, 209, 102, 0.6)';
    g.shadowBlur = 24;
    g.fillText('🏆 冲 线 大 捷 ！', w / 2, 142);
  } else {
    g.fillStyle = '#38bdf8';
    g.shadowColor = 'rgba(56, 189, 248, 0.6)';
    g.shadowBlur = 24;
    g.fillText('💨 顽 强 完 赛 ！', w / 2, 142);
  }
  g.shadowBlur = 0; // 重置光晕

  // 趣味称号胶囊
  const titleText = `【 ${fun.title} 】`;
  g.font = 'bold 22px -apple-system, BlinkMacSystemFont, sans-serif';
  const titleWidth = g.measureText(titleText).width + 40;
  fillRoundRect(g, (w - titleWidth) / 2, 168, titleWidth, 40, 20, 'rgba(229, 81, 186, 0.18)', 'rgba(229, 81, 186, 0.6)');
  g.fillStyle = '#ff9be3';
  g.fillText(titleText, w / 2, 188);

  // 趣味评语
  g.font = 'italic 15px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = 'rgba(255, 255, 255, 0.8)';
  g.fillText(fun.quote, w / 2, 230);

  // 5. 核心数据仪表盘 (3 列式卡片)
  const cardY = 254;
  const cardH = 94;
  const cardW = (w - 96 - 24) / 3;

  const cs = Math.round(raceTime * 100);
  const timeStr = `${String(Math.floor(cs / 100)).padStart(2, '0')}:${String(cs % 100).padStart(2, '0')}`;
  const opponentLabel = cpuMode === 'pvp'
    ? '👥 双人对决'
    : cpuMode === 'qwen'
      ? '🧠 Qwen 手绘'
      : cpuMode === 'jev' ? '✨ Jev AI' : '⚙️ 规则对手';
  const beatPct = isWin ? Math.min(99.6, Math.max(82, 100 - raceTime * 1.6)).toFixed(1) + '%' : '极速进阶中';

  const stats = [
    { label: '⏱️ 完赛耗时', val: timeStr, color: '#4ade80' },
    { label: '🆚 对战对手', val: opponentLabel, color: '#c084fc' },
    { label: '🔥 击败选手', val: beatPct, color: '#f472b6' },
  ];

  stats.forEach((st, idx) => {
    const cx = 48 + idx * (cardW + 12);
    fillRoundRect(g, cx, cardY, cardW, cardH, 18, 'rgba(255, 255, 255, 0.06)', 'rgba(255, 255, 255, 0.14)');

    g.textAlign = 'center';
    g.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
    g.fillStyle = 'rgba(255, 255, 255, 0.6)';
    g.fillText(st.label, cx + cardW / 2, cardY + 30);

    g.font = 'bold 20px -apple-system, BlinkMacSystemFont, sans-serif';
    g.fillStyle = st.color;
    g.fillText(st.val, cx + cardW / 2, cardY + 66);
  });

  // 6. 专属手绘战车展示台 (Hero Feature)
  const stageBoxY = 366;
  const stageBoxH = 470;
  fillRoundRect(g, 48, stageBoxY, w - 96, stageBoxH, 24, 'rgba(255, 255, 255, 0.04)', 'rgba(255, 255, 255, 0.12)');

  // 展示台标语
  fillRoundRect(g, (w - 200) / 2, stageBoxY + 16, 200, 30, 15, 'rgba(255, 255, 255, 0.08)');
  g.fillStyle = 'rgba(255, 255, 255, 0.9)';
  g.font = 'bold 13px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillText('👑 玩家专属手绘战车', w / 2, stageBoxY + 31);

  // 展台聚光灯地面与阴影
  const pedestalY = stageBoxY + stageBoxH - 60;
  const spotGrad = g.createRadialGradient(w / 2, pedestalY - 20, 10, w / 2, pedestalY - 20, 240);
  spotGrad.addColorStop(0, 'rgba(124, 58, 237, 0.4)');
  spotGrad.addColorStop(0.6, 'rgba(229, 81, 186, 0.15)');
  spotGrad.addColorStop(1, 'rgba(229, 81, 186, 0)');
  g.fillStyle = spotGrad;
  g.fillRect(48, stageBoxY + 40, w - 96, stageBoxH - 60);

  // 展台发光椭圆环
  g.beginPath();
  g.ellipse(w / 2, pedestalY, 210, 28, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255, 255, 255, 0.08)';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(229, 81, 186, 0.6)';
  g.stroke();

  // 居中绘制放大的玩家手绘战车
  const scale = Math.min(4.8, 300 / (player.rad || 36));
  g.save();
  g.translate(w / 2, pedestalY - player.rad * scale);
  g.scale(scale, scale);
  drawBody(g, { ...player, x: 0, y: 0 }, 1);
  g.restore();

  // 7. 底部传播 Footer 与印章认证
  const footerY = 856;
  g.beginPath();
  g.moveTo(48, footerY);
  g.lineTo(w - 48, footerY);
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  g.stroke();

  // 左侧传播引导
  g.textAlign = 'left';
  g.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = '#fff';
  g.fillText('🕹️ 随手一画就能跑，敢来挑战我的成绩吗？', 58, footerY + 36);

  g.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = 'rgba(255, 255, 255, 0.55)';
  g.fillText('物理引擎极速竞速 · 自由发挥天马行空滚轮设计', 58, footerY + 62);

  // 认证徽章/印章 (右侧)
  fillRoundRect(g, w - 176, footerY + 16, 120, 56, 12, 'rgba(255, 255, 255, 0.06)', 'rgba(255, 255, 255, 0.15)');
  g.textAlign = 'center';
  g.font = 'bold 12px monospace';
  g.fillStyle = '#ff70a6';
  g.fillText('OFFICIAL RUN', w - 116, footerY + 36);
  g.font = '11px monospace';
  g.fillStyle = 'rgba(255, 255, 255, 0.5)';
  const now = new Date();
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  g.fillText(dateStr, w - 116, footerY + 54);
}

/** 生成分享图片并调用系统分享 / 弹窗展示 */
export function shareResult({ player, stage, stageName, result, raceTime, cpuMode }) {
  if (!player || sharing) return;

  const cs = Math.round(raceTime * 100);
  const timeStr = `${String(Math.floor(cs / 100)).padStart(2, '0')}:${String(cs % 100).padStart(2, '0')}`;
  const isWin = result === 'WIN';
  const fun = getFunTitle(isWin, raceTime);
  const oppText = cpuMode === 'pvp'
    ? '👥 双人对决'
    : cpuMode === 'qwen'
      ? '🧠 Qwen 手绘'
      : cpuMode === 'jev' ? '✨ TypeSafe Jev AI' : '⚙️ 规则对手';

  // 1. 生成 750×1000 高清卡片画布
  const c = document.createElement('canvas');
  c.width = 750;
  c.height = 1000;
  renderShareCardCanvas(c, {
    player, stage, stageName, result, raceTime, cpuMode,
  });

  const dataUrl = c.toDataURL('image/png');

  // 2. 组装社交传播文案
  const head = isWin ? `🏆 我在【绘制滚轮赛跑】${stageName}通关！` : `💥 我在【绘制滚轮赛跑】${stageName}发起挑战！`;
  const text = `${head}\n荣获称号：${fun.title}\n完赛耗时：${timeStr} ｜ 对战：${oppText}\n${fun.quote}\n\n来试试你画的轮子能跑多快 👉 ${location.href.split(/[?#]/)[0]}\n#绘制滚轮赛跑 #独立游戏`;
  const intent = 'https://x.com/intent/post?text=' + encodeURIComponent(text);

  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], 'draw-roll-race.png', { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    // 移动端：通过系统分享面板发送（支持微信、相册、X 等）
    sharing = true;
    navigator.share({ files: [file], text })
      .catch(err => { if (!err || err.name !== 'AbortError') showShareImage(dataUrl, intent, text); })
      .finally(() => { sharing = false; });
  } else {
    showShareImage(dataUrl, intent, text);
  }
}

/** 在页面内以精致毛玻璃弹窗展示分享卡片（支持保存图片与一键复制文案） */
export function showShareImage(dataUrl, intent, text) {
  document.getElementById('share-overlay')?.remove();
  const box = document.createElement('div');
  box.id = 'share-overlay';
  box.style.cssText = 'position:fixed;inset:0;background:rgba(10,12,28,0.85);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;z-index:200;padding:16px;box-sizing:border-box;';

  const card = document.createElement('div');
  card.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:24px;padding:20px 22px;display:flex;flex-direction:column;align-items:center;gap:14px;max-width:min(90vw, 420px);box-shadow:0 24px 60px rgba(0,0,0,0.6);';

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;color:#fff;';
  titleRow.innerHTML = '<span style="font-weight:700;font-size:16px;">📸 专属战绩卡已生成</span><span id="share-close-btn" style="cursor:pointer;font-size:18px;opacity:0.6;padding:4px;">✕</span>';
  card.appendChild(titleRow);

  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = '战绩分享卡片';
  img.style.cssText = 'width:100%;max-height:56vh;object-fit:contain;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,0.5);';
  card.appendChild(img);

  const hintText = document.createElement('p');
  hintText.textContent = '💡 手机端可长按图片保存，电脑端右键复制';
  hintText.style.cssText = 'margin:0;font-size:12px;color:rgba(255,255,255,0.6);text-align:center;';
  card.appendChild(hintText);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;width:100%;justify-content:center;';

  // 复制战报按钮
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = '📋 复制战报';
  copyBtn.style.cssText = 'flex:1;padding:10px 12px;border:none;border-radius:12px;background:rgba(255,255,255,0.14);color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:background 0.2s;';
  copyBtn.addEventListener('click', () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✅ 已复制！';
        setTimeout(() => { copyBtn.textContent = '📋 复制战报'; }, 2000);
      });
    }
  });
  btnRow.appendChild(copyBtn);

  // X 分享按钮
  if (intent) {
    const xBtn = document.createElement('a');
    xBtn.href = intent;
    xBtn.target = '_blank';
    xBtn.rel = 'noopener';
    xBtn.textContent = '🚀 发布到 X';
    xBtn.style.cssText = 'flex:1;padding:10px 12px;border-radius:12px;background:linear-gradient(135deg,#e551ba,#7c3aed);color:#fff;font-size:13px;font-weight:700;text-decoration:none;text-align:center;box-sizing:border-box;box-shadow:0 4px 15px rgba(124,58,237,0.3);';
    btnRow.appendChild(xBtn);
  }

  card.appendChild(btnRow);
  box.appendChild(card);

  const closeFn = () => box.remove();
  box.addEventListener('pointerdown', e => { if (e.target === box) closeFn(); });
  card.querySelector('#share-close-btn').addEventListener('click', closeFn);
  document.body.appendChild(box);
}
