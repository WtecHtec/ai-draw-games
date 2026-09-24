/**
 * roomManager.js —— 多房间生命周期与隔离管理器
 *
 * 职责：
 *   - 房间的创建、加入、解散与内存自动回收
 *   - 多房间绝对隔离（以 RoomID 为边界，消息绝不跨房泄露）
 *   - 房主与挑战者掉线/退出时的优雅降级与对局保护
 *   - 确定性随机地图种子生成与发放
 *   - 比赛胜负裁决与防作弊基本校验
 */

export class Room {
  constructor(id, hostWs, hostName = '玩家1') {
    this.id = id;
    this.host = {
      ws: hostWs,
      name: hostName,
      color: '#38bdf8', // 亮天蓝
      ready: true,
      progress: 0,
      finishTime: null,
    };
    this.guest = null;
    this.status = 'WAITING'; // 'WAITING' | 'READY' | 'COUNTDOWN' | 'RACING' | 'FINISHED'
    this.seed = 0;
    this.stage = 0;
    this.winner = null;
    this.createdAt = Date.now();
  }

  /** 获取对局中的对手 socket */
  getOpponent(ws) {
    if (this.host?.ws === ws) return this.guest?.ws || null;
    if (this.guest?.ws === ws) return this.host?.ws || null;
    return null;
  }

  /** 获取自己的角色身份 */
  getRole(ws) {
    if (this.host?.ws === ws) return 'host';
    if (this.guest?.ws === ws) return 'guest';
    return null;
  }

  /** 房间内广播消息 */
  broadcast(type, payload = {}, exceptWs = null) {
    const raw = JSON.stringify({ ...payload, type });
    const targets = [this.host?.ws, this.guest?.ws].filter(
      client => client && client.readyState === 1 && client !== exceptWs
    );
    for (const ws of targets) {
      ws.send(raw);
    }
  }

  /** 房间内向指定角色发送消息 */
  sendTo(role, type, payload = {}) {
    const targetWs = role === 'host' ? this.host?.ws : this.guest?.ws;
    if (targetWs && targetWs.readyState === 1) {
      targetWs.send(JSON.stringify({ ...payload, type }));
    }
  }
}

export class RoomManager {
  constructor() {
    /** 房间号 -> Room 实例 */
    this.rooms = new Map();
    /** WebSocket 连接 -> 房间号（O(1) 快速反查，防串房） */
    this.socketToRoom = new Map();
  }

  /** 生成唯一的 4 位数字房间码 */
  _generateRoomId() {
    let id;
    let attempts = 0;
    do {
      id = String(Math.floor(1000 + Math.random() * 9000));
      attempts++;
    } while (this.rooms.has(id) && attempts < 100);
    return id;
  }

  /** 创建新房间 */
  createRoom(hostWs, { hostName = '房主', stage = 0 } = {}) {
    // 若原先在其他房间，先离开
    this.leaveRoom(hostWs);

    const roomId = this._generateRoomId();
    const room = new Room(roomId, hostWs, hostName);
    room.stage = stage;

    this.rooms.set(roomId, room);
    this.socketToRoom.set(hostWs, roomId);

    room.sendTo('host', 'ROOM_CREATED', {
      roomId,
      role: 'host',
      hostName,
      stage,
      status: room.status,
    });

    return room;
  }

  /** 加入已有房间 */
  joinRoom(guestWs, roomId, guestName = '挑战者') {
    this.leaveRoom(guestWs);

    const room = this.rooms.get(String(roomId).trim());
    if (!room) {
      this._sendDirect(guestWs, 'ERROR', { message: '房间不存在，请检查房间号' });
      return null;
    }

    if (room.guest) {
      this._sendDirect(guestWs, 'ERROR', { message: '房间人数已满，无法加入' });
      return null;
    }

    if (room.status === 'RACING') {
      this._sendDirect(guestWs, 'ERROR', { message: '该房间正在激烈比赛中' });
      return null;
    }

    room.guest = {
      ws: guestWs,
      name: guestName,
      color: '#f97316', // 活力橙
      ready: true,
      progress: 0,
      finishTime: null,
    };
    room.status = 'READY';

    this.socketToRoom.set(guestWs, room.id);

    // 通知加入者
    room.sendTo('guest', 'JOIN_SUCCESS', {
      roomId: room.id,
      role: 'guest',
      hostName: room.host.name,
      guestName,
      stage: room.stage,
      status: room.status,
    });

    // 通知房主有新玩家进入
    room.sendTo('host', 'OPPONENT_JOINED', {
      guestName,
      role: 'guest',
      status: room.status,
    });

    return room;
  }

  /** 房主发起开始比赛（生成统一随机地图种子，并切换关卡） */
  startRace(ws, nextStage) {
    const roomId = this.socketToRoom.get(ws);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (room.host.ws !== ws) {
      return this._sendDirect(ws, 'ERROR', { message: '只有房主可以发起开赛' });
    }

    if (!room.guest) {
      return this._sendDirect(ws, 'ERROR', { message: '等待对手加入后方可开赛' });
    }

    if (typeof nextStage === 'number') {
      room.stage = nextStage;
    }

    // 生成当前比赛唯一的 32 位确定性随机地图种子
    room.seed = Math.floor(Math.random() * 0xFFFFFFFF);
    room.status = 'RACING';
    room.winner = null;
    room.host.finishTime = null;
    room.guest.finishTime = null;

    // 广播 3 秒同步起跑倒计时与地图种子
    const countdownMs = 3000;
    const startTimestamp = Date.now() + countdownMs;

    room.broadcast('RACE_START', {
      stage: room.stage,
      seed: room.seed,
      countdownMs,
      startTimestamp,
      hostName: room.host.name,
      guestName: room.guest.name,
    });
  }

  /** 处理比赛冲线结算 */
  handleFinish(ws, finishTime) {
    const roomId = this.socketToRoom.get(ws);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'RACING') return;

    const role = room.getRole(ws);
    if (!role) return;

    if (!room.winner) {
      // 首位冲线者获胜！
      room.winner = role;
      room.status = 'FINISHED';
      const winnerName = role === 'host' ? room.host.name : room.guest.name;

      room.broadcast('MATCH_OVER', {
        winner: role,
        winnerName,
        finishTime: Number(finishTime) || 0,
      });
    }
  }

  /** 请求再来一局（再战模式，携带目标关卡） */
  requestRematch(ws, stage) {
    const roomId = this.socketToRoom.get(ws);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room || !room.guest) return;

    if (typeof stage === 'number') {
      room.stage = stage;
    }

    // 重置状态进入就绪
    room.status = 'READY';
    room.winner = null;
    room.broadcast('REMATCH_READY', { stage: room.stage });
  }

  /** 消息转发（手绘肢体变更与高频位置同步） */
  relayMessage(ws, type, data) {
    const roomId = this.socketToRoom.get(ws);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;

    const opponent = room.getOpponent(ws);
    if (opponent && opponent.readyState === 1) {
      opponent.send(JSON.stringify({ ...data, type }));
    }
  }

  /** 玩家退出房间（主动退出或断开连接） */
  leaveRoom(ws) {
    const roomId = this.socketToRoom.get(ws);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    this.socketToRoom.delete(ws);

    if (!room) return;

    const isHost = room.host?.ws === ws;
    const opponent = room.getOpponent(ws);

    if (room.status === 'RACING') {
      // 竞速中退出/掉线：直接裁定留存方胜利
      if (opponent && opponent.readyState === 1) {
        opponent.send(JSON.stringify({
          type: 'OPPONENT_RESIGNED',
          message: `${isHost ? room.host.name : room.guest.name} 退出了游戏，你获得了胜利！`,
        }));
      }
      this.rooms.delete(roomId);
    } else {
      // 准备阶段退出
      if (isHost) {
        // 房主解散
        if (opponent && opponent.readyState === 1) {
          opponent.send(JSON.stringify({
            type: 'ROOM_CLOSED',
            message: '房主已解散房间',
          }));
          this.socketToRoom.delete(opponent);
        }
        this.rooms.delete(roomId);
      } else {
        // 挑战者离开：房间重置为等待状态
        room.guest = null;
        room.status = 'WAITING';
        if (room.host?.ws && room.host.ws.readyState === 1) {
          room.host.ws.send(JSON.stringify({
            type: 'OPPONENT_LEFT',
            message: '挑战者已离开房间，等待新玩家加入...',
            status: 'WAITING',
          }));
        }
      }
    }
  }

  _sendDirect(ws, type, payload) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type, ...payload }));
    }
  }
}
