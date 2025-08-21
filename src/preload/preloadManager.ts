import { ReaderApiClient } from "../api/readerApi";
import { BookContent } from "../api/types";
import { PreloadCache } from "./preloadCache";
import {
  PreloadConfig,
  PreloadTask,
  PreloadStatus,
  ReadingProgressEvent,
} from "./types";

/**
 * 预加载管理器
 * 负责管理章节预加载逻辑、任务队列和缓存策略
 */
export class PreloadManager {
  private cache: PreloadCache;
  private apiClient: ReaderApiClient;
  private config: PreloadConfig;
  private preloadQueue: Map<string, PreloadTask> = new Map();
  private isPreloading: boolean = false;
  private retryAttempts: Map<string, number> = new Map();
  private currentBook?: { url: string; totalChapters: number };
  private lastTriggeredProgress: number = 0;

  // 常量配置
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAY_BASE = 2000; // 2秒基础延迟
  private readonly PRELOAD_TIMEOUT = 30000; // 30秒超时

  constructor(apiClient: ReaderApiClient, config: PreloadConfig) {
    this.apiClient = apiClient;
    this.config = config;
    this.cache = new PreloadCache(config.maxCacheSize);

    // 定期清理过期缓存
    setInterval(() => {
      this.cache.cleanExpired();
    }, 10 * 60 * 1000); // 每10分钟清理一次
  }

  /**
   * 更新配置
   */
  updateConfig(config: PreloadConfig): void {
    this.config = config;
    this.cache.setMaxSize(config.maxCacheSize);

    if (!config.enabled) {
      this.clearPreloadQueue();
    }

    console.log("[PreloadManager] 配置已更新:", config);
  }

  /**
   * 设置当前书籍信息
   */
  setCurrentBook(bookUrl: string, totalChapters: number): void {
    // 如果切换了书籍，清空预加载队列
    if (this.currentBook?.url !== bookUrl) {
      this.clearPreloadQueue();
      this.lastTriggeredProgress = 0;
    }

    this.currentBook = { url: bookUrl, totalChapters };
    console.log(
      `[PreloadManager] 设置当前书籍: ${bookUrl}, 总章节数: ${totalChapters}`
    );
  }

  /**
   * 生成任务键
   */
  private generateTaskKey(bookUrl: string, chapterIndex: number): string {
    return `${bookUrl}#${chapterIndex}`;
  }

  /**
   * 处理阅读进度更新
   */
  onReadingProgress(event: ReadingProgressEvent): void {
    if (!this.config.enabled || !this.currentBook) {
      console.log(
        `[PreloadManager] 预加载已禁用或无当前书籍: enabled=${
          this.config.enabled
        }, hasBook=${!!this.currentBook}`
      );
      return;
    }

    const { chapterIndex, progress, totalChapters } = event;

    console.log(
      `[PreloadManager] 收到阅读进度: 第${
        chapterIndex + 1
      }章 ${progress}%, 触发阈值: ${this.config.triggerProgress}%, 上次触发: ${
        this.lastTriggeredProgress
      }%`
    );

    // 避免重复触发预加载
    if (Math.abs(progress - this.lastTriggeredProgress) < 5) {
      console.log(
        `[PreloadManager] 进度变化不足5%，跳过预加载: ${Math.abs(
          progress - this.lastTriggeredProgress
        )}%`
      );
      return;
    }

    // 检查是否达到预加载触发条件
    if (progress >= this.config.triggerProgress) {
      console.log(
        `[PreloadManager] 达到预加载触发条件: ${progress}% >= ${this.config.triggerProgress}%`
      );
      this.lastTriggeredProgress = progress;
      this.triggerPreload(this.currentBook.url, chapterIndex, totalChapters);
    } else {
      console.log(
        `[PreloadManager] 未达到预加载触发条件: ${progress}% < ${this.config.triggerProgress}%`
      );
    }
  }

  /**
   * 触发预加载
   */
  private async triggerPreload(
    bookUrl: string,
    currentChapterIndex: number,
    totalChapters: number
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const startIndex = currentChapterIndex + 1;
    const endIndex = Math.min(
      startIndex + this.config.chapterCount - 1,
      totalChapters - 1
    );

    console.log(
      `[PreloadManager] 触发预加载: 第${startIndex + 1}章 到 第${
        endIndex + 1
      }章`
    );

    for (let i = startIndex; i <= endIndex; i++) {
      // 检查是否已经缓存或正在预加载
      if (!this.cache.has(bookUrl, i) && !this.isChapterInQueue(bookUrl, i)) {
        await this.addPreloadTask(bookUrl, i);
      }
    }

    this.processPreloadQueue();
  }

  /**
   * 检查章节是否在预加载队列中
   */
  private isChapterInQueue(bookUrl: string, chapterIndex: number): boolean {
    const key = this.generateTaskKey(bookUrl, chapterIndex);
    return this.preloadQueue.has(key);
  }

  /**
   * 添加预加载任务
   */
  private async addPreloadTask(
    bookUrl: string,
    chapterIndex: number
  ): Promise<void> {
    const key = this.generateTaskKey(bookUrl, chapterIndex);

    const task: PreloadTask = {
      bookUrl,
      chapterIndex,
      status: PreloadStatus.IDLE,
      retryCount: 0,
      createdAt: Date.now(),
    };

    this.preloadQueue.set(key, task);
    console.log(`[PreloadManager] 添加预加载任务: 第${chapterIndex + 1}章`);
  }

  /**
   * 处理预加载队列
   */
  private async processPreloadQueue(): Promise<void> {
    if (this.isPreloading || this.preloadQueue.size === 0) {
      return;
    }

    this.isPreloading = true;

    try {
      // 按章节顺序处理任务
      const tasks = Array.from(this.preloadQueue.values())
        .filter((task) => task.status === PreloadStatus.IDLE)
        .sort((a, b) => a.chapterIndex - b.chapterIndex);

      for (const task of tasks) {
        if (!this.config.enabled) {
          break;
        }

        await this.executePreloadTask(task);

        // 添加小延迟，避免过于频繁的请求
        await this.delay(500);
      }
    } finally {
      this.isPreloading = false;
    }
  }

  /**
   * 执行预加载任务
   */
  private async executePreloadTask(task: PreloadTask): Promise<void> {
    const key = this.generateTaskKey(task.bookUrl, task.chapterIndex);

    try {
      task.status = PreloadStatus.LOADING;
      console.log(`[PreloadManager] 开始预加载: 第${task.chapterIndex + 1}章`);

      const content = await Promise.race([
        this.apiClient.getBookContent(task.bookUrl, task.chapterIndex),
        this.createTimeoutPromise(this.PRELOAD_TIMEOUT),
      ]);

      this.cache.set(task.bookUrl, task.chapterIndex, content);
      task.status = PreloadStatus.COMPLETED;
      this.preloadQueue.delete(key);
      this.retryAttempts.delete(key);

      console.log(`[PreloadManager] 预加载完成: 第${task.chapterIndex + 1}章`);
    } catch (error) {
      console.error(
        `[PreloadManager] 预加载失败: 第${task.chapterIndex + 1}章`,
        error
      );
      this.cache.recordPreloadFailure();

      await this.handlePreloadError(task, error);
    }
  }

  /**
   * 处理预加载错误
   */
  private async handlePreloadError(
    task: PreloadTask,
    error: any
  ): Promise<void> {
    const key = this.generateTaskKey(task.bookUrl, task.chapterIndex);
    const attempts = this.retryAttempts.get(key) || 0;

    if (attempts < this.MAX_RETRY_ATTEMPTS) {
      this.retryAttempts.set(key, attempts + 1);
      task.status = PreloadStatus.IDLE;
      task.retryCount = attempts + 1;

      // 指数退避重试
      const delay = this.RETRY_DELAY_BASE * Math.pow(2, attempts);
      console.log(
        `[PreloadManager] 将在${delay}ms后重试预加载第${
          task.chapterIndex + 1
        }章 (第${attempts + 1}次重试)`
      );

      setTimeout(() => {
        if (this.preloadQueue.has(key)) {
          this.processPreloadQueue();
        }
      }, delay);
    } else {
      task.status = PreloadStatus.FAILED;
      this.preloadQueue.delete(key);
      this.retryAttempts.delete(key);
      console.error(
        `[PreloadManager] 预加载第${
          task.chapterIndex + 1
        }章失败，已达到最大重试次数`
      );
    }
  }

  /**
   * 获取章节内容（优先从缓存获取）
   */
  async getChapterContent(
    bookUrl: string,
    chapterIndex: number
  ): Promise<BookContent> {
    // 先尝试从缓存获取
    const cachedContent = this.cache.get(bookUrl, chapterIndex);
    if (cachedContent) {
      console.log(`[PreloadManager] 从缓存获取章节: 第${chapterIndex + 1}章`);
      return cachedContent;
    }

    // 缓存未命中，直接从API获取
    console.log(`[PreloadManager] 从API获取章节: 第${chapterIndex + 1}章`);
    const content = await this.apiClient.getBookContent(bookUrl, chapterIndex);

    // 将获取的内容加入缓存
    this.cache.set(bookUrl, chapterIndex, content);

    return content;
  }

  /**
   * 清空预加载队列
   */
  private clearPreloadQueue(): void {
    this.preloadQueue.clear();
    this.retryAttempts.clear();
    console.log("[PreloadManager] 清空预加载队列");
  }

  /**
   * 创建超时Promise
   */
  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error("预加载超时")), timeout);
    });
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 获取预加载统计信息
   */
  getStats() {
    return {
      cache: this.cache.getStats(),
      hitRate: this.cache.getHitRate(),
      queueSize: this.preloadQueue.size,
      isPreloading: this.isPreloading,
    };
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.clearPreloadQueue();
    this.cache.clear();
    console.log("[PreloadManager] 资源已清理");
  }
}

