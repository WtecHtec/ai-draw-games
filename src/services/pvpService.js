/**
 * pvpService.js —— 双人对决 (PvP) 业务协调与状态机服务
 *
 * 职责：
 *   - 维护双人实时对战的全生命周期状态（匹配、就绪、倒计时、竞速、结算、重赛/下一关）
 *   - 规范化处理网络信令（OPPONENT_RESIGNED, OPPONENT_STAGE_READY, RACE_START 等）
 *   - 处理异常边界情况：中途退出退回菜单、结算等待对手离开、下一关双人就绪协商流转
 */

import { netClient } from '../net/client.js';
import { OpponentSync } from '../net/opponentSync.js';
import { STAGES } from '../terrain.js';

export class PvPService {
  constructor() {
    this.opponentSync = new OpponentSync();

    /** 对局唯一随机地图种子 */
    this.seed = null;
    /** 起跑倒计时锁（倒计时期间锁死物理位移） */
    this.canMove = true;
    /** 对手真实手绘肢体（为 null 时小车停在原地不动） */
    this.opponentLimbs = null;
    /** 对手到达终点的时间 */
    this.opponentFinishTime = null;
    /** 上一次向服务端发送 15Hz 物理同步帧的时间戳 */
    this.lastSyncTs = 0;

    /** 状态标识：对手是否已离开房间（包括中途退出、断网或结算时离开） */
    this.opponentLeft = false;
    /** 状态标识：自己是否已点击下一关准备 */
    this.selfReadyNext = false;
    /** 状态标识：对手是否已准备下一关 */
    this.opponentReadyNext = false;

    // 回调钩子
    this.onMatchFinish = null;
    this.onOpponentResigned = null;
    this.onRaceStart = null;
    this.onOpponentLimbsChanged = null;
    this.onRenderNeeded = null;

    this._bindNetworkEvents();
  }

  /** 重置单局比赛临时状态 */
  resetRaceState() {
    this.canMove = false;
    this.lastSyncTs = 0;
    this.opponentFinishTime = null;
    this.selfReadyNext = false;
    this.opponentReadyNext = false;
    // 注意：opponentLeft 不在此重置，需在离开房间或新玩家加入时重置
  }

  /** 重置整个 PvP 会话状态（退出房间或进入大厅时调用） */
  resetSession() {
    this.seed = null;
    this.canMove = true;
    this.opponentLimbs = null;
    this.opponentFinishTime = null;
    this.opponentLeft = false;
    this.selfReadyNext = false;
    this.opponentReadyNext = false;
    this.lastSyncTs = 0;
  }

  _bindNetworkEvents() {
    // 监听对手高频位置同步帧
    const applyOpponentFrame = (frame) => {
      this.opponentSync.onReceivePacket(frame);
    };
    netClient.on('OPPONENT_FRAME', applyOpponentFrame);
    netClient.on('SYNC_FRAME', applyOpponentFrame);

    // 监听对手手绘更新
    netClient.on('OPPONENT_LIMBS', ({ limbs }) => {
      this.opponentLimbs = limbs;
      this.onOpponentLimbsChanged?.(limbs);
    });

    // 监听比赛冲线结算
    netClient.on('MATCH_OVER', (data) => {
      this.onMatchFinish?.(data);
    });

    // 监听对手中途认输/断线/退出
    netClient.on('OPPONENT_RESIGNED', ({ message }) => {
      this.opponentLeft = true;
      this.opponentLimbs = null;
      this.onOpponentResigned?.(message || '对手已退出比赛，你获得了胜利！');
    });

    // 监听房主解散房间
    netClient.on('ROOM_CLOSED', ({ message }) => {
      this.opponentLeft = true;
      this.opponentLimbs = null;
      this.onOpponentResigned?.(message || '房主已解散房间');
    });

    // 监听挑战者离开房间（房主端收到）
    netClient.on('OPPONENT_LEFT', ({ message }) => {
      this.opponentLeft = true;
      this.opponentLimbs = null;
      this.selfReadyNext = false;
      this.opponentReadyNext = false;
      this.onRenderNeeded?.();
    });

    // 监听对手发来的“下一关就绪”信令
    netClient.on('OPPONENT_STAGE_READY', () => {
      this.opponentReadyNext = true;
      this.onRenderNeeded?.();

      // 若自己是房主且自己也已就绪，自动开赛进入下一关
      if (netClient.role === 'host' && this.selfReadyNext) {
        this.triggerNextRace();
      }
    });

    // 监听开赛广播信令（新一局或下一关）
    netClient.on('RACE_START', (options) => {
      this.seed = options.seed;
      this.opponentLeft = false;
      this.selfReadyNext = false;
      this.opponentReadyNext = false;
      this.onRaceStart?.(options);
    });
  }

  /**
   * 触发房主开赛，并携带关卡索引
   */
  triggerNextRace(nextStage) {
    if (netClient.role === 'host') {
      netClient.startRace(nextStage);
    }
  }

  /**
   * 点击结算界面的主操作按钮（重试/下一关/返回菜单）
   * @param {object} params
   * @param {number} params.currentStage - 当前关卡号
   * @param {string} params.result - 'WIN' | 'LOSE'
   * @param {function} params.onReturnToMenu - 退回菜单回调
   * @param {function} params.onNextStageStarted - 下一关开始回调
   */
  handleMainButtonClick({ currentStage, result, onReturnToMenu, onNextStageStarted }) {
    // 场景 1：对手已经退出房间（中途断开或结算离开）
    if (this.opponentLeft) {
      netClient.leaveRoom();
      this.resetSession();
      onReturnToMenu();
      return;
    }

    // 场景 2：双方仍在对战，准备进入下一关
    this.selfReadyNext = true;
    const nextStage = (currentStage + 1) % STAGES.length;

    // 向对手发送自己已就绪信令
    netClient.sendStageReady(nextStage);
    this.onRenderNeeded?.();

    if (netClient.role === 'host') {
      // 房主：若对手已经就绪（或者对方也是准备状态），直接发起新关卡开赛
      if (this.opponentReadyNext) {
        this.triggerNextRace(nextStage);
      }
    } else {
      // 客态：请求重赛/下一关
      netClient.requestRematch();
    }
  }

  /**
   * 动态获取结算界面主按钮文案与状态
   */
  getMainButtonLabel({ result, currentStage }) {
    // 对手已离开：提示返回主菜单
    if (this.opponentLeft) {
      return '返回菜单 🚪';
    }

    // 已点击下一关，等待对手也点击
    if (this.selfReadyNext && !this.opponentReadyNext) {
      return '等待对手准备... ⏳';
    }

    // 正常状态
    if (result === 'WIN') {
      return currentStage + 1 < STAGES.length ? '下一关 →' : '重回第1关';
    }
    return '再战一局';
  }
}

export const pvpService = new PvPService();
