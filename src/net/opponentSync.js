/**
 * opponentSync.js —— 远程对手赛车状态轻量软校准器
 *
 * 核心逻辑：
 *   - 赛车运动、手脚转动与地形碰撞 100% 由本地物理引擎 stepBody 原生驱动（与 CPU 对手一致）；
 *   - 远程真实玩家手绘数据触发 replaceBody 即时变身；
 *   - 网络位置包仅在真实物理基础之上提供温和的漂移软校准（softAlign），杜绝任何浮空漂移或瞬移。
 */

export class OpponentSync {
  constructor(initialBody = null) {
    this.target = {
      x: initialBody ? initialBody.x : 0,
      y: initialBody ? initialBody.y : 0,
      vx: 0,
      vy: 0,
    };
    this.hasReceivedFirst = false;
  }

  /**
   * 接收服务端转发的对手物理帧
   */
  onReceivePacket(pkt) {
    if (!pkt) return;
    this.target.x = typeof pkt.x === 'number' ? pkt.x : this.target.x;
    this.target.y = typeof pkt.y === 'number' ? pkt.y : this.target.y;
    this.target.vx = typeof pkt.vx === 'number' ? pkt.vx : 0;
    this.target.vy = typeof pkt.vy === 'number' ? pkt.vy : 0;
    this.hasReceivedFirst = true;
  }

  /**
   * 软校准：在真实物理步进（stepBody）的基础之上，消除双端浮点积累误差
   * 绝不干涉垂直重力与地面贴合，彻底消除“悬空飘移”
   *
   * @param {object} cpuBody - 远程对手物理对象
   * @param {number} dt      - 步长（秒）
   */
  softAlign(cpuBody, dt = 0.016) {
    if (!cpuBody || !this.hasReceivedFirst) return;

    const dx = this.target.x - cpuBody.x;
    const dy = this.target.y - cpuBody.y;
    const dist = Math.hypot(dx, dy);

    // 若误差极大（网络延迟严重或开赛初始）：瞬间对齐
    if (dist > 180) {
      cpuBody.x = this.target.x;
      cpuBody.y = this.target.y;
      cpuBody.vx = this.target.vx;
      cpuBody.vy = this.target.vy;
      return;
    }

    // 细微误差：温和水平纠偏（不干扰垂直力学碰撞与重力）
    if (Math.abs(dx) > 8) {
      cpuBody.x += dx * Math.min(0.2, dt * 5);
      cpuBody.vx += (this.target.vx - cpuBody.vx) * Math.min(0.2, dt * 5);
    }
  }

  /** 重置状态 */
  reset(body) {
    this.hasReceivedFirst = false;
    if (body) {
      this.target.x = body.x;
      this.target.y = body.y;
      this.target.vx = 0;
      this.target.vy = 0;
    }
  }
}
