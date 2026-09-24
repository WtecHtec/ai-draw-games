# 🎨 绘制滚轮赛跑 (Draw Roll Race)

> **随手一画就能跑！基于真实物理力学引擎与多智能体/实时联机对战的创意竞速游戏。**

---

## 🌟 核心特性

- **自由手绘与刚体物理**：在底部画板自由绘制手脚或正圆轮子，实时转换为具备质量、转动惯量与碰撞半径的真实物理实体，凭借摩擦力与推进力越野疾驰。
- **四种对战模式**：
  1. ⚙️ **规则对手 (System)**：经典启发式规则 AI，适配全地形基准姿态。
  2. ✨ **TypeSafe Jev AI**：实时采集世界力学快照与地形状况，端云协同智能决策。
  3. 🧠 **端侧 Qwen2.5 WebLLM**：完全基于浏览器端 WebGPU 运行的视觉/语言大模型，根据前方障碍实时手绘推理克制形态。
  4. 👥 **实时双人对决 (PvP)**：基于 WebSocket 的实时双人联机房间匹配，原生 60FPS 物理模拟与 15Hz 增量软对齐，支持多关卡连续就绪比拼。
- **防作弊与力学尺寸约束**：画板内置正圆半径限制（$\le 55\text{px}$）与肢体跨度限制（$\le 80\text{px}$），杜绝超长杠杆弹射与超大轮跨屏漏洞，手感纯正平衡。
- **DDD 领域驱动设计架构**：解耦核心物理主循环与各个领域服务，模块内聚清晰。
- **高颜值战报生成**：一键生成 750×1000 战车展台高清战绩卡片，支持移动端系统原生分享与社交媒体发布。

---

## 🏗️ 架构分层 (DDD 理念)

```
cpgame/
├── server/                    # [基础设施] WebSocket 对战服务端
│   ├── index.js               # 服务端入口（信令路由）
│   └── roomManager.js         # 房间生命周期与玩家状态机
├── src/
│   ├── constants.js           # [领域层] 物理常量、尺寸约束与坐标基准
│   ├── physics.js             # [领域服务] 纯函数刚体运动、重力/浮力/摩擦碰撞积分
│   ├── body.js                # [领域实体] 人体多关节骨骼物理对象与镜像转换
│   ├── terrain.js             # [领域服务] 16 种程序化地形生成器与碰撞线
│   ├── cpu.js                 # [领域模型] CPU 姿态与解算器
│   ├── services/              # [应用服务层]
│   │   ├── aiController.js    # AI 对手状态机（规则/Jev/Qwen 破障与系统脱困）
│   │   ├── pvpService.js      # PvP 对决协调器（房间生命周期、就绪同步、中途退出处理）
│   │   └── shareService.js    # 战绩卡片合成、趣味评语与分享弹窗
│   ├── net/                   # [基础设施层]
│   │   ├── client.js          # WebSocket 客户端连接与事件分发
│   │   └── opponentSync.js    # 对手位置航位推测与力学软平滑对齐
│   ├── llm/                   # [基础设施层]
│   │   ├── webllm.js          # WebLLM 引擎包装与 Qwen 推理管线
│   │   └── worker.js          # Web Worker 后台推理线程
│   ├── renderer.js            # [表现层] Canvas 2D 赛道与动态 HUD 渲染引擎
│   ├── drawpad.js             # [表现层] 触控/手写板交互与限制引导圈
│   └── game.js                # [编排层] 游戏主循环引擎与事件调度中心 (App Orchestrator)
└── tests/                     # 单元与集成测试套件（107+ Tests 100% PASS）
```

---

## 🚀 本地开发与快速启动

### 1. 环境准备
- **Node.js**：`>= 18.0.0`
- **npm**：`>= 8.0.0`
- **浏览器推荐**：Chrome 113+ / Edge 113+ / Safari 18+（端侧 Qwen 模式需支持 WebGPU）

### 2. 安装依赖
```bash
npm install
```

### 3. 配置环境变量
复制并编辑 `.env` 文件：
```bash
cp .env.example .env
```
`.env` 参数说明：
```env
# WebSocket 服务监听端口（服务端）
PORT=8080

# 前端连接 WebSocket 服务端的地址
# 本地开发填 ws://localhost:8080；生产环境若配置了 Nginx wss 代理，可填 wss://yourdomain.com/ws
VITE_WS_URL=ws://localhost:8080

# （可选）TypeSafe Jev AI 对战模型 API Key
VITE_JEV_API_KEY=
```

### 4. 运行服务
```bash
# 启动 WebSocket 对战服务端（端口 8080）
npm run server

# 新开终端，启动前端开发服务器（Vite）
npm run dev
```
打开浏览器访问终端打印的本地地址（默认 `http://localhost:5173`）即可开始体验。

### 5. 测试与生产打包
```bash
# 运行全部单元测试与集成测试
npm test

# 打包生产静态资源到 dist/ 目录
npm run build
```

---

## 🛠️ 基于 PM2 部署 WebSocket 服务

在 Linux / macOS 服务器生产环境中，推荐使用 **PM2** 进行 Node.js 服务进程管理，具备自动重启、集群扩展、开机自启和日志监控功能。

### 1. 全局安装 PM2
```bash
npm install -g pm2
```

### 2. 方式 A：通过命令行直接启动
进入项目根目录：
```bash
# 启动服务端并指定进程名称
pm2 start server/index.js --name "cpgame-ws"

# 查看运行状态
pm2 status

# 查看实时日志
pm2 logs cpgame-ws
```

### 3. 方式 B：使用配置文件启动（推荐）
在项目根目录创建 `ecosystem.config.cjs`：
```javascript
module.exports = {
  apps: [
    {
      name: 'cpgame-ws',
      script: './server/index.js',
      instances: 1, // WebSocket 房间状态在内存中，单实例运行
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 8080,
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
```
通过配置文件启动与管理：
```bash
# 启动服务
pm2 start ecosystem.config.cjs

# 重启服务
pm2 restart cpgame-ws

# 停止服务
pm2 stop cpgame-ws

# 设置开机自启
pm2 save
pm2 startup
```

---

## 🌐 Nginx 生产反向代理与静态资源配置

在生产环境中，推荐使用 Nginx 托管前端打包后的静态资源（`dist/`），同时配置反向代理将 WebSocket 连接（支持 `wss://` 安全协议）转发至后端的 Node.js 服务。

### 1. 构建前端生产包
```bash
npm run build
```
打包输出目录为项目根目录下的 `dist/`。

### 2. Nginx 完整配置示例

编辑您的 Nginx 站点配置文件（例如 `/etc/nginx/conf.d/cpgame.conf`）：

```nginx
# 将 HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name game.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name game.example.com;

    # SSL 证书配置
    ssl_certificate     /etc/letsencrypt/live/game.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/game.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 1. 前端静态网页托管
    root /var/www/cpgame/dist;
    index index.html;

    # WebGPU / SharedArrayBuffer 隔离安全头（WebLLM 高效运行必需）
    add_header Cross-Origin-Embedder-Policy "credentialless" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;

    location / {
        try_files $uri $uri/ /index.html;
        
        # 静态资源缓存策略
        location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|wasm)$ {
            expires 30d;
            add_header Cache-Control "public, no-transform";
        }
    }

    # 2. WebSocket 实时对战服务反向代理 (/ws 路径)
    location /ws {
        proxy_pass http://127.0.0.1:8080;
        
        # 核心：开启 WebSocket 协议升级
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";

        # 客户端真实 IP 透传
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时设置（避免长连接被 Nginx 中途掐断）
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_connect_timeout 60s;
    }
}
```

> **提示**：若前端配置了 `/ws` 反代路径，请在生产环境的 `.env` 中设置：
> ```env
> VITE_WS_URL=wss://game.example.com/ws
> ```
> 然后重新执行 `npm run build`。

### 3. 测试并重载 Nginx
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## ❓ 常见问题排查 (FAQ)

### Q1: 双人对决提示“无法连接到对战服务器”？
- **排查步骤**：
  1. 确认 Node.js 服务是否正常启动：执行 `pm2 status` 或 `lsof -i:8080`；
  2. 若生产开启了 HTTPS，WebSocket 必须使用 `wss://` 协议，否则会被浏览器 Mixed Content 安全机制阻断；
  3. 确认服务器云安全组及防火墙是否开放了对应的 HTTP(80) / HTTPS(443) 或自定义端口。

### Q2: 端侧 Qwen2.5 提示“当前浏览器未启用 WebGPU”？
- WebGPU 目前已在 Chrome 113+、Edge 113+、Safari 18+ 原生开启。
- 若使用较旧系统或部分 Linux 浏览器，可在浏览器地址栏访问 `chrome://flags/#enable-unsafe-webgpu` 手动启用。若不支持，系统会自动降级为规则或 Jev AI。

### Q3: 为什么画板不能画出无限大的长腿或大圆？
- 为保障竞速游戏的竞技公平性与物理合理性，防止超长直线形成跨图弹射和数值漏洞，画板在设计上对正圆半径限制为最大 $55\text{px}$、肢体最大跨度限制为 $80\text{px}$，超出时会触发橙红警示并自动截断。

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 开源。
