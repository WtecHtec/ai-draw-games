/**
 * drawpad.js —— 绘制面板模块
 *
 * 职责：
 *   - 管理底部画板（自由绘制手脚）
 *   - Shift + 拖拽：以最近关节为圆心，拖拽距离为半径，松开后生成正圆
 *   - 普通拖拽：自由绘制笔划
 *   - 撤销 / 清除：删除最后一笔 / 清空所有
 *
 * 操作说明：
 *   普通拖拽       自由绘制（从最近关节出发）
 *   Shift + 拖拽   以最近关节为圆心，松开时半径=关节→松开点距离，生成正圆
 *   撤销按钮       删除最后一笔
 *   清除按钮       清空所有笔划
 */

import { SHOULDER, HIP, HEAD, TORSO, MAX_PER_JOINT } from './constants.js';
import { dist } from './physics.js';

// ─── 辅助：绘制折线 ────────────────────────────────────────────
function strokePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

// ─── 正圆生成 ──────────────────────────────────────────────────

/**
 * 生成以关节为圆心、r 为半径的半圆点列
 * 物理引擎会自动将笔划 180° 镜像，因此半圆 → 完整圆轮
 *
 * @param {{x,y}} joint - 关节坐标（画板坐标系）
 * @param {number} r    - 圆半径（画板像素）
 * @param {number} n    - 采样点数（越多越圆滑，默认 18）
 * @returns {{x,y}[]} 半圆点列
 */
function makeCircleStroke(joint, r, n = 18) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const angle = (Math.PI * i) / n;
    pts.push({
      x: joint.x + Math.cos(angle) * r,
      y: joint.y + Math.sin(angle) * r,
    });
  }
  return pts;
}

// ─── Drawpad 类 ────────────────────────────────────────────────

/**
 * 绘制面板控制器
 *
 * @param {HTMLCanvasElement} canvas  - 画板 canvas 元素
 * @param {function} onLimbsChanged   - 手脚更新回调 (limbs) => void
 */
export class Drawpad {
  constructor(canvas, onLimbsChanged) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.onLimbsChanged = onLimbsChanged;

    /** 各关节的笔划集合 */
    this.limbs = { arm: [], leg: [] };

    /** 当前正在绘制的笔划点列（自由模式） */
    this.stroke = [];

    /** 是否正在绘制 */
    this.drawing = false;

    /**
     * 正圆模式状态
     * circleCenter: 圆心关节坐标
     * circleKind:   'arm' | 'leg'
     * circleRadius: 当前预览半径
     */
    this.circleMode   = false;
    this.circleCenter = null;
    this.circleKind   = null;
    this.circleRadius = 0;

    this._bindEvents();
  }

  // ─── 关节选取 ─────────────────────────────────────────────────

  /**
   * 根据点击位置选择最近关节
   * @param {{x,y}} pos
   * @returns {{ joint: {x,y}, kind: 'arm'|'leg' }}
   */
  _nearestJoint(pos) {
    if (dist(pos, SHOULDER) <= dist(pos, HIP)) {
      return { joint: SHOULDER, kind: 'arm' };
    }
    return { joint: HIP, kind: 'leg' };
  }

  // ─── 笔划添加 ──────────────────────────────────────────────────

  /**
   * 添加一条笔划到指定关节，超出 MAX_PER_JOINT 时移除最旧的
   */
  _addStroke(kind, stroke) {
    this.limbs[kind].push(stroke);
    if (this.limbs[kind].length > MAX_PER_JOINT) this.limbs[kind].shift();
    this.onLimbsChanged(this.limbs);
  }

  /**
   * 完成一条自由笔划：将起点平移到最近关节，然后添加
   */
  _finishFreeStroke(stroke) {
    if (stroke.length < 3) return;
    const { joint, kind } = this._nearestJoint(stroke[0]);
    const dx = joint.x - stroke[0].x, dy = joint.y - stroke[0].y;
    const limb = stroke.map(p => ({ x: p.x + dx, y: p.y + dy }));
    this._addStroke(kind, limb);
  }

  // ─── 即时操作 ──────────────────────────────────────────────────

  /** 撤销：删除最近添加的一条笔划 */
  applyUndo() {
    // 优先从腿部删，再从手臂删
    if      (this.limbs.leg.length > 0) this.limbs.leg.pop();
    else if (this.limbs.arm.length > 0) this.limbs.arm.pop();
    this.onLimbsChanged(this.limbs);
    this.draw();
  }

  /** 清除：删除所有笔划 */
  applyClear() {
    this.limbs = { arm: [], leg: [] };
    this.onLimbsChanged(this.limbs);
    this.draw();
  }

  // ─── Canvas 坐标转换 ────────────────────────────────────────────

  _padPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * this.canvas.width  / r.width,
      y: (e.clientY - r.top)  * this.canvas.height / r.height,
    };
  }

  // ─── 进入正圆模式（内部方法） ──────────────────────────────────

  /**
   * 进入正圆绘制模式，以最近关节为圆心
   * @param {{x,y}} pos - 触发点坐标（用于选择关节）
   */
  _enterCircleMode(pos) {
    const { joint, kind } = this._nearestJoint(pos);
    this.circleMode   = true;
    this.circleCenter = joint;
    this.circleKind   = kind;
    this.circleRadius = 20; // 初始预览半径
  }

  // ─── 事件绑定 ──────────────────────────────────────────────────

  _bindEvents() {
    const canvas = this.canvas;

    /** 长按定时器（移动端圆形快捷键） */
    let longPressTimer = null;
    /** 按下时的起始坐标（用于判断是否移动超出阈值） */
    let pointerStartPos = null;
    /** 取消长按（移动超出阈值或提前松开） */
    const cancelLongPress = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    };

    canvas.addEventListener('pointerdown', e => {
      const pos = this._padPos(e);
      canvas.setPointerCapture(e.pointerId);
      pointerStartPos = pos;
      this.drawing = true;

      if (e.shiftKey) {
        // ── 桌面端：Shift + 拖拽 → 立即进入正圆模式 ──
        this._enterCircleMode(pos);
      } else {
        // ── 默认：自由绘制 ──
        this.circleMode = false;
        this.stroke = [pos];

        // 移动端长按检测（500ms 无位移 → 进入正圆模式）
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          // 清除已有的短笔划，进入圆形模式
          this.stroke = [];
          this._enterCircleMode(pointerStartPos);
          // 触觉反馈（iOS / Android 支持时振动 30ms）
          if (navigator.vibrate) navigator.vibrate(30);
          this.draw();
        }, 500);
      }
      this.draw();
    });

    canvas.addEventListener('pointermove', e => {
      if (!this.drawing) return;
      const pos = this._padPos(e);

      if (this.circleMode) {
        // 正圆模式：拖拽距离 = 半径
        this.circleRadius = Math.max(5, dist(pos, this.circleCenter));
      } else {
        // 自由模式：移动超出 8px 则取消长按（防误触）
        if (longPressTimer && dist(pos, pointerStartPos) > 8) {
          cancelLongPress();
        }
        // 超出边界时暂停（回来后直线连接）
        if (pos.x < 0 || pos.y < 0 || pos.x > canvas.width || pos.y > canvas.height) return;
        if (dist(pos, this.stroke[this.stroke.length - 1]) > 4) {
          this.stroke.push(pos);
        }
      }
      this.draw();
    });

    const endStroke = () => {
      cancelLongPress(); // 确保定时器已清除
      if (!this.drawing) return;
      this.drawing = false;

      if (this.circleMode) {
        // 松开：以当前半径生成正圆
        if (this.circleRadius >= 5) {
          const stroke = makeCircleStroke(this.circleCenter, this.circleRadius);
          this._addStroke(this.circleKind, stroke);
        }
        this.circleMode   = false;
        this.circleCenter = null;
        this.circleRadius = 0;
      } else {
        this._finishFreeStroke(this.stroke);
        this.stroke = [];
      }
      this.draw();
    };

    canvas.addEventListener('pointerup',     endStroke);
    canvas.addEventListener('pointercancel', endStroke);
  }

  // ─── 渲染画板 ──────────────────────────────────────────────────

  /**
   * 重新渲染画板
   * 内容：人体模板 + 已绘笔划 + 当前笔划/正圆预览 + 淡色操作提示
   */
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    const inkColor    = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    const playerColor = getComputedStyle(document.documentElement).getPropertyValue('--player').trim();

    // ── 淡色操作提示水印（始终显示，不绘制时最明显，绘制时淡出） ──
    // 当画板有笔划时降低透明度（已经懂了，不再需要提示）
    const hasStrokes = this.limbs.arm.length + this.limbs.leg.length > 0;
    const hintAlpha  = this.drawing ? 0.04 : hasStrokes ? 0.08 : 0.18;
    const isTouchDev = navigator.maxTouchPoints > 0;
    const hintText   = isTouchDev ? '长按 → 正圆' : 'Shift + 拖拽 → 正圆';

    ctx.save();
    ctx.globalAlpha = hintAlpha;
    ctx.fillStyle   = inkColor;
    ctx.font        = `11px sans-serif`;
    ctx.textAlign   = 'center';
    ctx.fillText(hintText, this.canvas.width / 2, this.canvas.height - 10);
    ctx.restore();

    // 人体模板（躯干 + 头部）
    ctx.strokeStyle = inkColor; ctx.lineWidth = 4;
    strokePath(ctx, TORSO);
    ctx.beginPath();
    ctx.arc(HEAD.x, HEAD.y, HEAD.r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();

    // 关节标记（红色圆点）
    for (const j of [SHOULDER, HIP]) {
      ctx.beginPath(); ctx.arc(j.x, j.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = playerColor; ctx.fill();
    }

    // 已绘手脚笔划
    ctx.strokeStyle = playerColor; ctx.lineWidth = 5;
    for (const ln of [...this.limbs.arm, ...this.limbs.leg]) strokePath(ctx, ln);

    // ── 预览 ──
    if (this.circleMode && this.circleCenter) {
      // 正圆预览：虚线圆 + 半径辅助线
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = playerColor; ctx.lineWidth = 3;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(this.circleCenter.x, this.circleCenter.y, this.circleRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // 半径辅助线（细线）
      ctx.strokeStyle = inkColor; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.circleCenter.x, this.circleCenter.y);
      ctx.lineTo(this.circleCenter.x + this.circleRadius, this.circleCenter.y);
      ctx.stroke();
      // 半径数字（小字）
      ctx.fillStyle = inkColor; ctx.font = '10px sans-serif';
      ctx.textAlign = 'left'; ctx.globalAlpha = 0.7;
      ctx.fillText(`r ${Math.round(this.circleRadius)}`, this.circleCenter.x + 4, this.circleCenter.y - 4);
      ctx.restore();
    } else if (!this.circleMode && this.stroke.length >= 2) {
      // 自由笔划预览（半透明）
      ctx.globalAlpha = 0.45;
      strokePath(ctx, this.stroke);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left'; // 还原默认对齐
  }
}
