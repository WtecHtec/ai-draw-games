/**
 * src/llm/worker.js —— WebLLM 独立线程 Worker
 *
 * 职责：
 *   - 在独立 Web Worker 中执行模型加载、显存分配与张量计算
 *   - 避免阻塞主线程的 60 FPS 物理引擎循环和 Canvas 渲染
 */

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg) => {
  handler.onmessage(msg);
};
