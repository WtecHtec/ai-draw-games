import { RoomManager } from '../server/roomManager.js';

class MockWebSocket {
  constructor() {
    this.readyState = 1; // WebSocket.OPEN
    this.sentMessages = [];
  }

  send(data) {
    this.sentMessages.push(JSON.parse(data));
  }

  getLastMessage() {
    return this.sentMessages[this.sentMessages.length - 1];
  }
}

describe('RoomManager 多房间隔离与生命周期管理测试', () => {
  let manager;
  let wsHost;
  let wsGuest;

  beforeEach(() => {
    manager = new RoomManager();
    wsHost = new MockWebSocket();
    wsGuest = new MockWebSocket();
  });

  test('创建房间生成 4 位独立房间号，并下发 ROOM_CREATED', () => {
    const room = manager.createRoom(wsHost, { hostName: '选手A', stage: 2 });
    expect(room.id).toMatch(/^\d{4}$/);
    expect(manager.rooms.has(room.id)).toBe(true);

    const msg = wsHost.getLastMessage();
    expect(msg.type).toBe('ROOM_CREATED');
    expect(msg.roomId).toBe(room.id);
    expect(msg.role).toBe('host');
  });

  test('挑战者加入已有房间成功，房主与挑战者收到对应事件', () => {
    const room = manager.createRoom(wsHost, { hostName: '选手A' });
    manager.joinRoom(wsGuest, room.id, '选手B');

    expect(room.guest).not.toBeNull();
    expect(room.status).toBe('READY');

    const guestMsg = wsGuest.getLastMessage();
    expect(guestMsg.type).toBe('JOIN_SUCCESS');
    expect(guestMsg.role).toBe('guest');

    const hostMsg = wsHost.getLastMessage();
    expect(hostMsg.type).toBe('OPPONENT_JOINED');
    expect(hostMsg.guestName).toBe('选手B');
  });

  test('房间人数已满或房间不存在时拒绝加入', () => {
    const room = manager.createRoom(wsHost);
    manager.joinRoom(wsGuest, room.id);

    const wsThird = new MockWebSocket();
    manager.joinRoom(wsThird, room.id);
    expect(wsThird.getLastMessage().type).toBe('ERROR');
    expect(wsThird.getLastMessage().message).toContain('已满');

    const wsNotExist = new MockWebSocket();
    manager.joinRoom(wsNotExist, '99999');
    expect(wsNotExist.getLastMessage().type).toBe('ERROR');
    expect(wsNotExist.getLastMessage().message).toContain('不存在');
  });

  test('开赛下发唯一随机地图种子，双端收到相同 seed', () => {
    const room = manager.createRoom(wsHost, { stage: 3 });
    manager.joinRoom(wsGuest, room.id);
    manager.startRace(wsHost);

    expect(room.status).toBe('RACING');
    expect(room.seed).toBeGreaterThan(0);

    const hostStart = wsHost.getLastMessage();
    const guestStart = wsGuest.getLastMessage();
    expect(hostStart.type).toBe('RACE_START');
    expect(guestStart.type).toBe('RACE_START');
    expect(hostStart.seed).toBe(room.seed);
    expect(guestStart.seed).toBe(room.seed);
    expect(hostStart.seed).toBe(guestStart.seed); // 保证 100% 绝对相同
  });

  test('比赛中转发对手的画板笔划与坐标帧，且不同房间绝对隔离', () => {
    const room1 = manager.createRoom(wsHost);
    manager.joinRoom(wsGuest, room1.id);

    const otherHost = new MockWebSocket();
    const otherGuest = new MockWebSocket();
    const room2 = manager.createRoom(otherHost);
    manager.joinRoom(otherGuest, room2.id);

    // 房间 1 内选手 A 改变画笔
    const limbs = { arm: [[{ x: 150, y: 62 }, { x: 180, y: 70 }]], leg: [] };
    manager.relayMessage(wsHost, 'OPPONENT_LIMBS', { limbs });

    // 房间 1 挑战者收到更新
    expect(wsGuest.getLastMessage().type).toBe('OPPONENT_LIMBS');
    expect(wsGuest.getLastMessage().limbs).toEqual(limbs);

    // 房间 2 的玩家不应收到任何房间 1 的消息（多房间绝对隔离）
    expect(otherHost.sentMessages.map(m => m.type)).toEqual(['ROOM_CREATED', 'OPPONENT_JOINED']);
    expect(otherGuest.sentMessages.map(m => m.type)).toEqual(['JOIN_SUCCESS']);
  });

  test('比赛中挑战者掉线/退出，房主直接获胜并安全销毁房间', () => {
    const room = manager.createRoom(wsHost);
    manager.joinRoom(wsGuest, room.id);
    manager.startRace(wsHost);

    manager.leaveRoom(wsGuest); // 挑战者断开

    const hostMsg = wsHost.getLastMessage();
    expect(hostMsg.type).toBe('OPPONENT_RESIGNED');
    expect(hostMsg.message).toContain('胜利');
    expect(manager.rooms.has(room.id)).toBe(false); // 内存立即释放
  });

  test('等待中挑战者退出，房间不销毁，重置为 WAITING 等待其他人', () => {
    const room = manager.createRoom(wsHost);
    manager.joinRoom(wsGuest, room.id);

    manager.leaveRoom(wsGuest); // 挑战者在准备阶段离开

    expect(manager.rooms.has(room.id)).toBe(true);
    expect(room.guest).toBeNull();
    expect(room.status).toBe('WAITING');
    expect(wsHost.getLastMessage().type).toBe('OPPONENT_LEFT');
  });
});
