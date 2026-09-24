import { defineConfig, loadEnv } from 'vite';
import { minify as minifyHtml } from 'html-minifier-terser';

/**
 * 生产构建优化插件：基于成熟第三方库 html-minifier-terser 彻底清除 HTML / CSS 中的全部注释与空白
 */
function htmlMinifyPlugin() {
  return {
    name: 'vite-plugin-html-minify',
    apply: 'build',
    async transformIndexHtml(html) {
      return await minifyHtml(html, {
        removeComments: true,        // 彻底移除 HTML 注释（包括所有中文注释）
        collapseWhitespace: true,    // 压缩多余空白符与换行
        removeRedundantAttributes: true,
        useShortDoctype: true,
        removeEmptyAttributes: true,
        minifyCSS: true,             // 自动压缩内联 <style> 并剔除所有 CSS 注释
        minifyJS: true,              // 自动压缩内联 <script>
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    define: {
      '__WS_URL__': JSON.stringify(env.VITE_WS_URL || ''),
      'process.env.VITE_WS_URL': JSON.stringify(env.VITE_WS_URL || ''),
    },

    plugins: [
      htmlMinifyPlugin(),
    ],

  build: {
    target: 'esnext',
    // 采用前端工业标准压缩库 Terser，彻底抹除所有注释与调试语句
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,         // 生产环境清除所有 console.*
        drop_debugger: true,        // 生产环境清除 debugger 断点
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
      },
      format: {
        comments: false,            // 彻底移除所有注释（包含中文注释、JSDoc、版权等）
      },
    },

    // 生产环境关闭 sourcemap，彻底防止源码及注释通过 sourceMappingURL 暴露
    sourcemap: false,

    // WebLLM 属于大型 AI 模型推理引擎（约 5.9MB），提高警告阈值保持打包日志清爽
    chunkSizeWarningLimit: 7000,

    rollupOptions: {
      output: {
        // 依赖分包优化 (Code Splitting)：将巨型模型引擎与游戏业务逻辑完全隔离
        manualChunks(id) {
          if (id.includes('@mlc-ai/web-llm')) {
            return 'vendor-webllm';
          }
          if (id.includes('node_modules')) {
            return 'vendor-libs';
          }
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
  },

  // 跨源安全隔离头配置（本地开发与预览时 WebLLM/SharedArrayBuffer 必需）
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  };
});
