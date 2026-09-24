// Jest 配置文件
module.exports = {
  // 测试环境：纯 Node.js（不依赖浏览器 DOM）
  testEnvironment: 'node',
  // 转换 ES 模块为 CommonJS（供 Jest 使用）
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  // 测试文件匹配规则
  testMatch: ['**/tests/**/*.test.js'],
  // 覆盖率收集范围
  collectCoverageFrom: ['src/**/*.js'],
  // 模拟纯浏览器端 WebGPU 库
  moduleNameMapper: {
    '^@mlc-ai/web-llm$': '<rootDir>/tests/__mocks__/web-llm.js',
  },
};
