/**
 * pvpService.test.js —— PvP 协调服务与状态机单元测试
 */

import { pvpService } from '../src/services/pvpService.js';
import { netClient } from '../src/net/client.js';

describe('PvPService 状态与交互流转', () => {
  beforeEach(() => {
    pvpService.resetSession();
    jest.clearAllMocks();
  });

  test('对手未离开且正常获胜时，主按钮显示为「下一关 →」', () => {
    pvpService.opponentLeft = false;
    const label = pvpService.getMainButtonLabel({ result: 'WIN', currentStage: 0 });
    expect(label).toBe('下一关 →');
  });

  test('对手已离开房间（中途退出或结算时离开），主按钮动态显示为「返回菜单 🚪」', () => {
    pvpService.opponentLeft = true;
    const labelWin = pvpService.getMainButtonLabel({ result: 'WIN', currentStage: 0 });
    expect(labelWin).toBe('返回菜单 🚪');

    const labelLose = pvpService.getMainButtonLabel({ result: 'LOSE', currentStage: 0 });
    expect(labelLose).toBe('返回菜单 🚪');
  });

  test('自己已点击准备但对手未就绪时，主按钮动态显示为「等待对手准备... ⏳」', () => {
    pvpService.opponentLeft = false;
    pvpService.selfReadyNext = true;
    pvpService.opponentReadyNext = false;

    const label = pvpService.getMainButtonLabel({ result: 'WIN', currentStage: 0 });
    expect(label).toBe('等待对手准备... ⏳');
  });

  test('对手离开状态下点击主按钮，自动调用 leaveRoom 并触发 onReturnToMenu 回调', () => {
    pvpService.opponentLeft = true;
    const leaveSpy = jest.spyOn(netClient, 'leaveRoom').mockImplementation(() => {});
    const onReturnToMenu = jest.fn();
    const onNextStageStarted = jest.fn();

    pvpService.handleMainButtonClick({
      currentStage: 0,
      result: 'WIN',
      onReturnToMenu,
      onNextStageStarted,
    });

    expect(leaveSpy).toHaveBeenCalled();
    expect(onReturnToMenu).toHaveBeenCalled();
    expect(pvpService.opponentLeft).toBe(false); // 重置了会话
  });

  test('正常对局点击下一关，发送 STAGE_READY 信令并设置 selfReadyNext', () => {
    pvpService.opponentLeft = false;
    const sendStageReadySpy = jest.spyOn(netClient, 'sendStageReady').mockImplementation(() => {});
    const onReturnToMenu = jest.fn();

    pvpService.handleMainButtonClick({
      currentStage: 0,
      result: 'WIN',
      onReturnToMenu,
      onNextStageStarted: jest.fn(),
    });

    expect(pvpService.selfReadyNext).toBe(true);
    expect(sendStageReadySpy).toHaveBeenCalledWith(1); // stage 0 -> next stage 1
    expect(onReturnToMenu).not.toHaveBeenCalled();
  });

  test('房主先点击再战/下一关，随后收到对手就绪时，正确携带目标关卡号发起开赛', () => {
    netClient.role = 'host';
    const startRaceSpy = jest.spyOn(netClient, 'startRace').mockImplementation(() => {});

    // 房主在第 0 关结束后点击下一关/再战
    pvpService.handleMainButtonClick({
      currentStage: 0,
      result: 'WIN',
      onReturnToMenu: jest.fn(),
      onNextStageStarted: jest.fn(),
    });

    expect(pvpService.selfReadyNext).toBe(true);
    expect(pvpService.pendingNextStage).toBe(1);
    expect(startRaceSpy).not.toHaveBeenCalled(); // 还在等对手

    // 对手发来 OPPONENT_STAGE_READY
    netClient.emit('OPPONENT_STAGE_READY', { stage: 1 });

    expect(startRaceSpy).toHaveBeenCalledWith(1); // 成功携带 stage 1 开赛！
  });

  test('对手先准备，房主点击再战一局，直接携带目标关卡号开赛', () => {
    netClient.role = 'host';
    const startRaceSpy = jest.spyOn(netClient, 'startRace').mockImplementation(() => {});

    // 对手先准备
    netClient.emit('OPPONENT_STAGE_READY', { stage: 2 });
    expect(pvpService.opponentReadyNext).toBe(true);
    expect(startRaceSpy).not.toHaveBeenCalled();

    // 房主点击再战一局 (当前第 1 关，结果 LOSE)
    pvpService.handleMainButtonClick({
      currentStage: 1,
      result: 'LOSE',
      onReturnToMenu: jest.fn(),
      onNextStageStarted: jest.fn(),
    });

    expect(startRaceSpy).toHaveBeenCalledWith(2);
  });

  test('挑战者点击再战一局，调用 requestRematch 并携带下一关关卡号', () => {
    netClient.role = 'guest';
    const rematchSpy = jest.spyOn(netClient, 'requestRematch').mockImplementation(() => {});
    const sendStageReadySpy = jest.spyOn(netClient, 'sendStageReady').mockImplementation(() => {});

    pvpService.handleMainButtonClick({
      currentStage: 2,
      result: 'LOSE',
      onReturnToMenu: jest.fn(),
      onNextStageStarted: jest.fn(),
    });

    expect(pvpService.selfReadyNext).toBe(true);
    expect(sendStageReadySpy).toHaveBeenCalledWith(3);
    expect(rematchSpy).toHaveBeenCalledWith(3);
  });
});
