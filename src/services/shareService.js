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

  // 1. 米白素描纸底色
  g.fillStyle = '#faf8f5';
  g.fillRect(0, 0, w, h);

  // 绘制 24px 素描纸网格线
  g.save();
  g.strokeStyle = 'rgba(0, 0, 0, 0.04)';
  g.lineWidth = 1;
  for (let x = 0; x < w; x += 24) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let y = 0; y < h; y += 24) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.restore();

  // 2. 外框：纯墨水手绘双层线框 + 硬阴影
  const m = 24;
  // 硬黑阴影
  fillRoundRect(g, m + 6, m + 6, w - m * 2, h - m * 2, 20, '#1a1a1a', null);
  // 主纸面
  fillRoundRect(g, m, m, w - m * 2, h - m * 2, 20, '#ffffff', '#1a1a1a');

  // 3. 顶部 Header 药丸（手绘线框）
  fillRoundRect(g, 48 + 3, 48 + 3, w - 96, 44, 12, '#1a1a1a', null);
  fillRoundRect(g, 48, 48, w - 96, 44, 12, '#faf8f5', '#1a1a1a');

  g.fillStyle = '#1a1a1a';
  g.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('✏️ 简笔画滚轮赛跑 · DOODLE ROLL', 68, 70);

  g.textAlign = 'right';
  g.font = 'bold 15px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = '#1a1a1a';
  g.fillText(`第 ${stage + 1} 关 · ${stageName}`, w - 68, 70);

  // 4. 胜负大标题 & 趣味称号
  const isWin = result === 'WIN';
  const fun = getFunTitle(isWin, raceTime);

  g.textAlign = 'center';
  g.font = '900 40px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = '#1a1a1a';
  if (isWin) {
    g.fillText('🏆 冲 线 大 捷 ！', w / 2, 142);
  } else {
    g.fillText('💨 顽 强 完 赛 ！', w / 2, 142);
  }

  // 趣味称号气泡框（纯墨水手绘框）
  const titleText = `【 ${fun.title} 】`;
  g.font = 'bold 20px -apple-system, BlinkMacSystemFont, sans-serif';
  const titleWidth = g.measureText(titleText).width + 36;
  const titleX = (w - titleWidth) / 2;
  fillRoundRect(g, titleX + 2, 168 + 2, titleWidth, 38, 10, '#1a1a1a', null);
  fillRoundRect(g, titleX, 168, titleWidth, 38, 10, '#ffffff', '#1a1a1a');
  g.fillStyle = isWin ? '#1a1a1a' : '#dc2626';
  g.fillText(titleText, w / 2, 187);

  // 趣味评语
  g.font = '15px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = '#555555';
  g.fillText(fun.quote, w / 2, 230);

  // 5. 核心数据仪表盘 (3 列式手绘卡片，黑白红经典手绘)
  const cardY = 254;
  const cardH = 92;
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
    { label: '⏱️ 完赛耗时', val: timeStr, color: '#1a1a1a' },
    { label: '🆚 对战对手', val: opponentLabel, color: '#1a1a1a' },
    { label: '🔥 击败选手', val: beatPct, color: '#dc2626' },
  ];

  stats.forEach((st, idx) => {
    const cx = 48 + idx * (cardW + 12);
    // 硬黑投影
    fillRoundRect(g, cx + 3, cardY + 3, cardW, cardH, 12, '#1a1a1a', null);
    fillRoundRect(g, cx, cardY, cardW, cardH, 12, '#faf8f5', '#1a1a1a');

    g.textAlign = 'center';
    g.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
    g.fillStyle = '#666666';
    g.fillText(st.label, cx + cardW / 2, cardY + 28);

    g.font = '900 20px -apple-system, BlinkMacSystemFont, sans-serif';
    g.fillStyle = st.color;
    g.fillText(st.val, cx + cardW / 2, cardY + 64);
  });

  // 6. 专属手绘战车展示台 (手绘草图展台)
  const stageBoxY = 366;
  const stageBoxH = 460;
  fillRoundRect(g, 48 + 4, stageBoxY + 4, w - 96, stageBoxH, 16, '#1a1a1a', null);
  fillRoundRect(g, 48, stageBoxY, w - 96, stageBoxH, 16, '#faf8f5', '#1a1a1a');

  // 展示台标语
  fillRoundRect(g, (w - 200) / 2 + 2, stageBoxY + 16 + 2, 200, 28, 8, '#1a1a1a', null);
  fillRoundRect(g, (w - 200) / 2, stageBoxY + 16, 200, 28, 8, '#ffffff', '#1a1a1a');
  g.fillStyle = '#1a1a1a';
  g.font = 'bold 13px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillText('👑 玩家专属手绘火柴人战车', w / 2, stageBoxY + 30);

  // 展台手绘排线地面 (Hatching)
  const pedestalY = stageBoxY + stageBoxH - 60;
  g.save();
  // 展台轮廓
  g.beginPath();
  g.ellipse(w / 2, pedestalY, 210, 24, 0, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = '#1a1a1a';
  g.stroke();

  // 展台内部手绘排线
  g.clip();
  g.beginPath();
  g.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  g.lineWidth = 1.5;
  for (let x = w / 2 - 250; x < w / 2 + 250; x += 10) {
    g.moveTo(x, pedestalY - 40);
    g.lineTo(x + 40, pedestalY + 40);
  }
  g.stroke();
  g.restore();

  // 居中绘制放大的玩家手绘火柴人战车
  const scale = Math.min(4.8, 300 / (player.rad || 36));
  g.save();
  g.translate(w / 2, pedestalY - player.rad * scale);
  g.scale(scale, scale);
  drawBody(g, { ...player, x: 0, y: 0 }, 1);
  g.restore();

  // 7. 底部传播 Footer 与手绘印章
  const footerY = 852;
  g.beginPath();
  g.moveTo(48, footerY);
  g.lineTo(w - 48, footerY);
  g.lineWidth = 2;
  g.strokeStyle = '#1a1a1a';
  g.stroke();

  // 左侧传播引导
  g.textAlign = 'left';
  g.font = 'bold 15px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = '#1a1a1a';
  g.fillText('🕹️ 随手一画就能跑，敢来挑战我的手绘轮子吗？', 58, footerY + 34);

  g.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
  g.fillStyle = '#666666';
  g.fillText('简笔画线条物理竞速 · 自由发挥天马行空滚轮设计', 58, footerY + 60);

  // 手绘认证印章 (右侧经典印泥红)
  const stampX = w - 176;
  const stampY = footerY + 16;
  fillRoundRect(g, stampX + 2, stampY + 2, 120, 54, 8, '#1a1a1a', null);
  fillRoundRect(g, stampX, stampY, 120, 54, 8, '#ffffff', '#1a1a1a');

  g.textAlign = 'center';
  g.font = 'bold 11px monospace';
  g.fillStyle = '#dc2626';
  g.fillText('OFFICIAL SKETCH', stampX + 60, stampY + 22);
  g.font = '10px monospace';
  g.fillStyle = '#1a1a1a';
  const now = new Date();
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  g.fillText(dateStr, stampX + 60, stampY + 40);
}

/** 生成分享图片并弹窗展示（解决重复触发与双图问题） */
export function shareResult({ player, stage, stageName, result, raceTime, cpuMode }) {
  if (!player || sharing) return;
  sharing = true;

  try {
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
    const head = isWin ? `🏆 我在【简笔画滚轮赛跑】${stageName}通关！` : `💥 我在【简笔画滚轮赛跑】${stageName}发起挑战！`;
    const text = `${head}\n荣获称号：${fun.title}\n完赛耗时：${timeStr} ｜ 对战：${oppText}\n${fun.quote}\n\n来试试你画的简笔画轮子能跑多快 👉 ${location.href.split(/[?#]/)[0]}\n#简笔画滚轮赛跑 #独立游戏`;
    const intent = 'https://x.com/intent/post?text=' + encodeURIComponent(text);

    // 3. 将二进制图片准备为 Blob
    const bin = atob(dataUrl.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });

    // 4. 直接展示纯手绘风格战绩弹窗（用户可直观复制单张图片或下载保存，彻底避免双图 Bug）
    showShareImage(dataUrl, intent, text, blob);
  } finally {
    // 防抖：500ms 后释放锁
    setTimeout(() => { sharing = false; }, 500);
  }
}

/** 在页面内以极简手绘草稿图纸风格展示分享卡片（支持单张图片复制、保存与分享） */
export function showShareImage(dataUrl, intent, text, blob) {
  // 严格清除已有弹窗，确保 DOM 中永远只有 1 个实例
  document.getElementById('share-overlay')?.remove();

  const box = document.createElement('div');
  box.id = 'share-overlay';
  box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;z-index:200;padding:16px;box-sizing:border-box;backdrop-filter:blur(3px);';

  const card = document.createElement('div');
  card.style.cssText = 'background:#faf8f5;border:3px solid #1a1a1a;border-radius:16px;padding:18px 20px;display:flex;flex-direction:column;align-items:center;gap:12px;max-width:min(90vw, 420px);box-shadow:6px 6px 0 #1a1a1a;box-sizing:border-box;';

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;color:#1a1a1a;';
  titleRow.innerHTML = '<span style="font-weight:800;font-size:16px;">📸 手绘战绩卡片</span><span id="share-close-btn" style="cursor:pointer;font-size:20px;font-weight:bold;line-height:1;padding:4px;" title="关闭">✕</span>';
  card.appendChild(titleRow);

  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = '简笔画战绩卡片';
  img.style.cssText = 'width:100%;max-height:54vh;object-fit:contain;border:2px solid #1a1a1a;border-radius:8px;box-shadow:3px 3px 0 #1a1a1a;display:block;';
  card.appendChild(img);

  const hintText = document.createElement('p');
  hintText.textContent = '💡 点击下方“复制图片”可直接在微信/QQ等按 Ctrl+V / 粘贴发送';
  hintText.style.cssText = 'margin:0;font-size:11px;color:#666666;text-align:center;line-height:1.4;';
  card.appendChild(hintText);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;width:100%;justify-content:center;flex-wrap:wrap;';

  // 1. 复制图片按钮（写入纯单个 PNG 图片到系统剪贴板，彻底杜绝双图 Bug）
  const copyImgBtn = document.createElement('button');
  copyImgBtn.type = 'button';
  copyImgBtn.textContent = '🖼️ 复制图片';
  copyImgBtn.style.cssText = 'flex:1;min-width:110px;padding:9px 12px;border:2px solid #1a1a1a;border-radius:10px;background:#ffffff;color:#1a1a1a;font-size:13px;font-weight:800;cursor:pointer;box-shadow:2px 2px 0 #1a1a1a;transition:all 0.12s;';
  
  copyImgBtn.addEventListener('click', async () => {
    try {
      if (blob && navigator.clipboard && window.ClipboardItem) {
        const item = new ClipboardItem({ 'image/png': blob });
        await navigator.clipboard.write([item]);
        copyImgBtn.textContent = '✅ 图片已复制！';
        setTimeout(() => { copyImgBtn.textContent = '🖼️ 复制图片'; }, 2200);
        return;
      }
      throw new Error('ClipboardItem not supported');
    } catch {
      // 降级为自动下载图片
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'doodle-race-score.png';
      a.click();
      copyImgBtn.textContent = '📥 已保存图片！';
      setTimeout(() => { copyImgBtn.textContent = '🖼️ 复制图片'; }, 2200);
    }
  });
  btnRow.appendChild(copyImgBtn);

  // 2. 保存图片文件按钮
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = '📥 保存图片';
  saveBtn.style.cssText = 'flex:1;min-width:100px;padding:9px 12px;border:2px solid #1a1a1a;border-radius:10px;background:#ffffff;color:#1a1a1a;font-size:13px;font-weight:800;cursor:pointer;box-shadow:2px 2px 0 #1a1a1a;transition:all 0.12s;';
  saveBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'doodle-race-score.png';
    a.click();
    saveBtn.textContent = '✅ 已下载！';
    setTimeout(() => { saveBtn.textContent = '📥 保存图片'; }, 2200);
  });
  btnRow.appendChild(saveBtn);

  // 3. X 分享按钮（手绘纯黑边框白底）
  if (intent) {
    const xBtn = document.createElement('a');
    xBtn.href = intent;
    xBtn.target = '_blank';
    xBtn.rel = 'noopener';
    xBtn.textContent = '🚀 发布到 X';
    xBtn.style.cssText = 'flex:1;min-width:90px;padding:9px 12px;border:2px solid #1a1a1a;border-radius:10px;background:#ffffff;color:#1a1a1a;font-size:13px;font-weight:800;text-decoration:none;text-align:center;box-sizing:border-box;box-shadow:2px 2px 0 #1a1a1a;';
    btnRow.appendChild(xBtn);
  }

  card.appendChild(btnRow);
  box.appendChild(card);

  const closeFn = () => box.remove();
  box.addEventListener('pointerdown', e => { if (e.target === box) closeFn(); });
  card.querySelector('#share-close-btn').addEventListener('click', closeFn);
  document.body.appendChild(box);
}
