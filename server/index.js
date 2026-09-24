/**
 * server/index.js —— 双人对决模式 WebSocket 网关服务
 *
 * 启动方式：npm run server
 * 默认端口：8080 (可通过环境变量 PORT 指定)
 */

import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './roomManager.js';

const PORT = Number(process.env.PORT) || 8080;
const wss = new WebSocketServer({ port: PORT });
const manager = new RoomManager();

console.log(`🚀 双人对决 PvP WebSocket 服务已就绪，正在监听端口 :${PORT}`);

wss.on('connection', (ws) => {
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const { type } = msg;

      switch (type) {
        case 'CREATE_ROOM':
          manager.createRoom(ws, msg);
          break;

        case 'JOIN_ROOM':
          manager.joinRoom(ws, msg.roomId, msg.guestName);
          break;

        case 'START_RACE':
          manager.startRace(ws, msg.stage);
          break;

        case 'FINISH':
          manager.handleFinish(ws, msg.finishTime);
          break;

        case 'REMATCH':
          manager.requestRematch(ws, msg.stage);
          break;

        case 'STAGE_READY':
          manager.relayMessage(ws, 'OPPONENT_STAGE_READY', msg);
          break;

        case 'LEAVE_ROOM':
          manager.leaveRoom(ws);
          break;

        // 实时转发玩家画出的手脚笔划
        case 'LIMBS_UPDATE':
          manager.relayMessage(ws, 'OPPONENT_LIMBS', msg);
          break;

        // 实时转发位置与物理状态同步帧 (15Hz)
        case 'SYNC_FRAME':
          manager.relayMessage(ws, 'OPPONENT_FRAME', msg);
          break;

        default:
          console.warn(`未知消息类型: ${type}`);
      }
    } catch (err) {
      console.error('处理消息异常:', err);
    }
  });

  ws.on('close', () => {
    manager.leaveRoom(ws);
  });

  ws.on('error', (err) => {
    console.error('Socket 异常:', err.message);
    manager.leaveRoom(ws);
  });
});

// 心跳探活机制（每 20 秒检测一次，3 次超时自动断开假死连接）
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      manager.leaveRoom(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 20000);

wss.on('close', () => {
  clearInterval(interval);
});
