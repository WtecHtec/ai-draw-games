import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from '../server/roomManager.js';

describe('PvP 全链路网络集成测试 (E2E Signaling & Sync)', () => {
  let wss;
  let manager;
  let SERVER_URL;

  beforeAll((done) => {
    manager = new RoomManager();
    // 使用端口 0 由系统动态分配空闲端口，杜绝冲突
    wss = new WebSocketServer({ port: 0 }, () => {
      const port = wss.address().port;
      SERVER_URL = `ws://127.0.0.1:${port}`;
      done();
    });

    wss.on('connection', (ws) => {
      ws.isAlive = true;
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          switch (msg.type) {
            case 'CREATE_ROOM':
              manager.createRoom(ws, msg);
              break;
            case 'JOIN_ROOM':
              manager.joinRoom(ws, msg.roomId, msg.guestName);
              break;
            case 'START_RACE':
              manager.startRace(ws);
              break;
            case 'FINISH':
              manager.handleFinish(ws, msg.finishTime);
              break;
            case 'REMATCH':
              manager.requestRematch(ws);
              break;
            case 'LEAVE_ROOM':
              manager.leaveRoom(ws);
              break;
            case 'LIMBS_UPDATE':
              manager.relayMessage(ws, 'OPPONENT_LIMBS', msg);
              break;
            case 'SYNC_FRAME':
              manager.relayMessage(ws, 'OPPONENT_FRAME', msg);
              break;
          }
        } catch (e) {
          console.error(e);
        }
      });

      ws.on('close', () => {
        manager.leaveRoom(ws);
      });
    });
  });

  afterAll((done) => {
    if (wss) {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close(done);
    } else {
      done();
    }
  });

  test('完整闭环：创建房间 -> 加入房间 -> 开赛下发相同种子 -> 笔划互通 -> 物理帧同步 -> 冲线结算', (done) => {
    const hostWs = new WebSocket(SERVER_URL);
    let guestWs = null;
    let createdRoomId = null;

    let hostReceivedSeed = null;
    let guestReceivedSeed = null;
    let receivedLimbs = false;
    let receivedFrame = false;
    let hasStarted = false;
    let hasFinished = false;

    function checkStart() {
      if (hostReceivedSeed !== null && guestReceivedSeed !== null && !hasStarted) {
        hasStarted = true;
        // 双端收到的确定性随机种子绝对必须完全一致
        expect(hostReceivedSeed).toBe(guestReceivedSeed);

        // 房主发送自己画的手脚
        hostWs.send(JSON.stringify({ type: 'LIMBS_UPDATE', limbs: [{ type: 'wheel', r: 25 }] }));

        // 房主发送 15Hz 物理位姿帧
        hostWs.send(JSON.stringify({ type: 'SYNC_FRAME', x: 120, y: 350, vx: 30, vy: -5, a: 0.2, w: 0.1 }));
      }
    }

    function checkFlow() {
      if (receivedLimbs && receivedFrame && !hasFinished) {
        hasFinished = true;
        // 房主冲线到达终点（用时 5.2 秒）
        hostWs.send(JSON.stringify({ type: 'FINISH', finishTime: 5.2 }));
      }
    }

    hostWs.on('open', () => {
      // 房主创建房间
      hostWs.send(JSON.stringify({ type: 'CREATE_ROOM', hostName: '房主车手', stage: 0 }));
    });

    hostWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'ROOM_CREATED') {
        expect(msg.roomId).toBeDefined();
        expect(msg.role).toBe('host');
        createdRoomId = msg.roomId;

        // 挑战者连接并加入房间
        guestWs = new WebSocket(SERVER_URL);
        guestWs.on('open', () => {
          guestWs.send(JSON.stringify({ type: 'JOIN_ROOM', roomId: createdRoomId, guestName: '极速挑战者' }));
        });

        guestWs.on('message', (gData) => {
          const gMsg = JSON.parse(gData.toString());

          if (gMsg.type === 'JOIN_SUCCESS') {
            expect(gMsg.roomId).toBe(createdRoomId);
            expect(gMsg.role).toBe('guest');

            // 房主点击开赛
            hostWs.send(JSON.stringify({ type: 'START_RACE' }));
          }

          if (gMsg.type === 'RACE_START') {
            expect(typeof gMsg.seed).toBe('number');
            expect(gMsg.countdownMs).toBe(3000);
            guestReceivedSeed = gMsg.seed;
            checkStart();
          }

          if (gMsg.type === 'OPPONENT_LIMBS') {
            expect(gMsg.limbs).toEqual([{ type: 'wheel', r: 25 }]);
            receivedLimbs = true;
            checkFlow();
          }

          if (gMsg.type === 'OPPONENT_FRAME') {
            expect(gMsg.x).toBe(120);
            expect(gMsg.vx).toBe(30);
            receivedFrame = true;
            checkFlow();
          }

          if (gMsg.type === 'MATCH_OVER') {
            expect(gMsg.winner).toBe('host');
            hostWs.close();
            guestWs.close();
            done();
          }
        });
      }

      if (msg.type === 'RACE_START') {
        expect(typeof msg.seed).toBe('number');
        hostReceivedSeed = msg.seed;
        checkStart();
      }
    });
  }, 8000);
});
