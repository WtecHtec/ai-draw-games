// Babel 配置：将 ES 模块语法转换为 CommonJS，使 Jest 可以运行
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
  ],
  plugins: ['babel-plugin-transform-import-meta'],
};
