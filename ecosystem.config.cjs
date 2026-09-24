/**
 * ecosystem.config.cjs —— PM2 生产环境进程管理配置
 *
 * 使用方法：
 *   启动服务: pm2 start ecosystem.config.cjs
 *   查看日志: pm2 logs cpgame-ws
 *   查看监控: pm2 monit
 *   开机自启: pm2 save && pm2 startup
 */

module.exports = {
  apps: [
    {
      name: 'cpgame-ws',
      script: './server/index.js',
      instances: 1, // WebSocket 内存房间状态，单实例运行
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 8080,
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      combine_logs: true,
    },
  ],
};
