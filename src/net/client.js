/**
 * client.js —— 双人对决 PvP 网络通信客户端
 *
 * 职责：
 *   - 维护与 Node.js 房间服务器的 WebSocket 连接与自动重连
 *   - 事件订阅与分发系统
 *   - 房间信令请求（创建房间、加入房间、开始比赛、冲线结算、再来一局、退出）
 *   - 高频同步帧与手绘笔划的发送与接收
 */

export class NetworkClient {
  constructor() {
    this.ws = null;
    this.serverUrl = null;
    this.listeners = new Map();
    this.isConnected = false;
    this.roomId = null;
    this.role = null; // 'host' | 'guest'
    this.opponentName = null;
  }

  /** 注册事件监听 */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /** 注销事件监听 */
  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  /** 内部触发事件 */
  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (e) {
          console.error(`事件 ${event} 处理回调异常:`, e);
        }
      }
    }
  }

  /** 连接到对决服务 */
  connect(url) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }

    if (!url) {
      let envUrl = '';
      try {
        if (typeof process !== 'undefined' && process.env && process.env.VITE_WS_URL) {
          envUrl = process.env.VITE_WS_URL.trim();
        } else {
          const metaEnv = (new Function('try { return import.meta.env; } catch(e) { return null; }'))();
          if (metaEnv && metaEnv.VITE_WS_URL) {
            envUrl = metaEnv.VITE_WS_URL.trim();
          }
        }
      } catch (e) {}

      if (envUrl) {
        url = envUrl;
      } else {
        const protocol = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'wss:' : 'ws:';
        const host = (typeof window !== 'undefined' && window.location.hostname) ? window.location.hostname : 'localhost';
        url = `${protocol}//${host}:8080`;
      }
    }
    this.serverUrl = url;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.emit('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            const { type, ...payload } = msg;

            if (type === 'ROOM_CREATED') {
              this.roomId = payload.roomId;
              this.role = 'host';
            } else if (type === 'JOIN_SUCCESS') {
              this.roomId = payload.roomId;
              this.role = 'guest';
              this.opponentName = payload.hostName;
            } else if (type === 'OPPONENT_JOINED') {
              this.opponentName = payload.guestName;
            }

            this.emit(type, payload);
          } catch (err) {
            console.error('解析服务端消息失败:', err);
          }
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          this.emit('disconnected');
        };

        this.ws.onerror = (err) => {
          this.emit('error', err);
          reject(err);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /** 发送数据到服务端 */
  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  /** 创建房间 */
  createRoom(hostName = '房主', stage = 0) {
    this.send('CREATE_ROOM', { hostName, stage });
  }

  /** 加入房间 */
  joinRoom(roomId, guestName = '挑战者') {
    this.send('JOIN_ROOM', { roomId, guestName });
  }

  /** 房主开赛 (可指定下一关关卡号) */
  startRace(stage) {
    this.send('START_RACE', typeof stage === 'number' ? { stage } : {});
  }

  /** 发送下一关准备就绪状态 */
  sendStageReady(stage) {
    this.send('STAGE_READY', { stage, ready: true });
  }

  /** 同步发送手绘肢体更新 */
  sendLimbs(limbs) {
    this.send('LIMBS_UPDATE', { limbs });
  }

  /** 发送高频位置物理同步帧 */
  sendSyncFrame(frame) {
    this.send('SYNC_FRAME', frame);
  }

  /** 冲线结算 */
  sendFinish(finishTime) {
    this.send('FINISH', { finishTime });
  }

  /** 申请重赛 */
  requestRematch() {
    this.send('REMATCH');
  }

  /** 主动退出房间 */
  leaveRoom() {
    this.send('LEAVE_ROOM');
    this.roomId = null;
    this.role = null;
    this.opponentName = null;
  }

  /** 断开连接 */
  disconnect() {
    if (this.ws) {
      this.leaveRoom();
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}

export const netClient = new NetworkClient();
