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
});
