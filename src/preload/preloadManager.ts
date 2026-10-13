import { ReaderApiClient } from "../api/readerApi";
import { BookContent, Chapter } from "../api/types";
import { PreloadCache } from "./preloadCache";
import { PreloadConfig, PreloadTask, PreloadStatus, ReadingProgressEvent } from "./types";
import { logger } from "../utils/logger";

/** Caches and queued requests belong to one backend/book session. */
export class PreloadManager {
  private cache: PreloadCache;
  private apiClient: ReaderApiClient;
  private config: PreloadConfig;
  private preloadQueue = new Map<string, PreloadTask>();
  private currentBook?: { url: string; chapters: Chapter[] };
  private lastTriggeredProgress = 0;
  private lastChapterIndex?: number;
  private generation = 0;
  private runningGeneration?: number;
  private disposed = false;
  private cleanupInterval: NodeJS.Timeout;
  private timers = new Map<NodeJS.Timeout, (() => void) | undefined>();
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAY_BASE = 2000;
  private readonly PRELOAD_TIMEOUT = 30000;

  constructor(apiClient: ReaderApiClient, config: PreloadConfig) {
    this.apiClient = apiClient;
    this.config = config;
    this.cache = new PreloadCache(config.maxCacheSize);
    this.cleanupInterval = setInterval(() => this.cache.cleanExpired(), 10 * 60 * 1000);
  }

  updateConfig(config: PreloadConfig): void {
    this.config = config;
    this.cache.setMaxSize(config.maxCacheSize);
    if (!config.enabled) this.clearPreloadQueue();
  }

  updateApiClient(apiClient: ReaderApiClient): void {
    this.clearCurrentBook();
    this.apiClient = apiClient;
  }

  clearCurrentBook(): void {
    this.clearPreloadQueue();
    this.currentBook = undefined;
    this.lastTriggeredProgress = 0;
    this.lastChapterIndex = undefined;
    this.cache.clear();
  }

  setCurrentBook(bookUrl: string, chapters: Chapter[]): void {
    if (this.disposed || !this.apiClient.isActive) return;
    if (this.currentBook?.url !== bookUrl || this.currentBook.chapters !== chapters) {
      this.clearCurrentBook();
      this.currentBook = { url: bookUrl, chapters };
    }
  }

  private isCurrent(api: ReaderApiClient, generation: number): boolean {
    return !this.disposed && api.isActive && this.apiClient === api && this.generation === generation;
  }


  onReadingProgress(event: ReadingProgressEvent): void {
    if (!this.config.enabled || !this.currentBook || this.disposed || !this.apiClient.isActive) return;
    if (this.lastChapterIndex !== event.chapterIndex) {
      this.lastChapterIndex = event.chapterIndex;
      this.lastTriggeredProgress = 0;
    }
    if (Math.abs(event.progress - this.lastTriggeredProgress) < 5) return;
    if (event.progress >= this.config.triggerProgress) {
      this.lastTriggeredProgress = event.progress;
      void this.triggerPreload(this.currentBook.url, event.chapterIndex);
    }
  }

  private async triggerPreload(bookUrl: string, chapterIndex: number): Promise<void> {
    if (!this.config.enabled || !this.currentBook || this.currentBook.url !== bookUrl || this.disposed || !this.apiClient.isActive) return;
    const position = this.currentBook.chapters.findIndex(chapter => chapter.index === chapterIndex);
    if (position < 0) return;
    const upcoming = this.currentBook.chapters.slice(position + 1)
      .filter(chapter => !chapter.isVolume).slice(0, this.config.chapterCount);
    for (const chapter of upcoming) {
      const key = `${bookUrl}#${chapter.index}`;
      if (!this.cache.has(bookUrl, chapter.index) && !this.preloadQueue.has(key)) {
        this.preloadQueue.set(key, {
          bookUrl, chapterIndex: chapter.index, status: PreloadStatus.IDLE,
          retryCount: 0, createdAt: Date.now(),
        });
      }
    }
    await this.processPreloadQueue();
  }

  private async processPreloadQueue(): Promise<void> {
    const api = this.apiClient;
    const generation = this.generation;
    if (!this.isCurrent(api, generation) || !this.config.enabled || this.runningGeneration === generation) return;
    this.runningGeneration = generation;
    try {
      while (this.isCurrent(api, generation) && this.config.enabled) {
        const task = Array.from(this.preloadQueue.values()).find(item => item.status === PreloadStatus.IDLE);
        if (!task) break;
        await this.executePreloadTask(task, api, generation);
        if (!this.isCurrent(api, generation)) break;
        await this.delay(500);
      }
    } finally {
      if (this.runningGeneration === generation) this.runningGeneration = undefined;
    }
  }

  private async executePreloadTask(task: PreloadTask, api: ReaderApiClient, generation: number): Promise<void> {
    if (!this.isCurrent(api, generation)) return;
    const key = `${task.bookUrl}#${task.chapterIndex}`;
    task.status = PreloadStatus.LOADING;
    let timeout: NodeJS.Timeout | undefined;
    try {
      const expiry = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          if (timeout) this.timers.delete(timeout);
          reject(new Error("预加载超时"));
        }, this.PRELOAD_TIMEOUT);
        this.timers.set(timeout, () => reject(new Error("阅读会话已结束")));
      });
      const content = await Promise.race([api.getBookContent(task.bookUrl, task.chapterIndex), expiry]);
      if (!this.isCurrent(api, generation)) return;
      this.cache.set(task.bookUrl, task.chapterIndex, content);
      this.preloadQueue.delete(key);
    } catch (error) {
      if (!this.isCurrent(api, generation)) return;
      this.cache.recordPreloadFailure();
      logger.warn(`预加载失败: ${String(error)}`, "PreloadManager");
      if (task.retryCount >= this.MAX_RETRY_ATTEMPTS) {
        this.preloadQueue.delete(key);
      } else {
        const delay = this.RETRY_DELAY_BASE * Math.pow(2, task.retryCount++);
        task.status = PreloadStatus.FAILED;
        const retry = setTimeout(() => {
          this.timers.delete(retry);
          if (!this.isCurrent(api, generation) || this.preloadQueue.get(key) !== task) return;
          task.status = PreloadStatus.IDLE;
          void this.processPreloadQueue();
        }, delay);
        this.timers.set(retry, undefined);
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout);
        this.timers.delete(timeout);
      }
    }
  }

  async getChapterContent(bookUrl: string, chapterIndex: number): Promise<BookContent> {
    const api = this.apiClient;
    const generation = this.generation;
    if (!this.isCurrent(api, generation)) throw new Error("阅读会话已结束");
    if (this.currentBook && (this.currentBook.url !== bookUrl ||
      !this.currentBook.chapters.some(chapter => chapter.index === chapterIndex && !chapter.isVolume))) {
      throw new Error("无可读取的章节");
    }
    const cached = this.cache.get(bookUrl, chapterIndex);
    if (cached) return cached;
    const content = await api.getBookContent(bookUrl, chapterIndex);
    if (!this.isCurrent(api, generation)) throw new Error("阅读会话已结束");
    this.cache.set(bookUrl, chapterIndex, content);
    return content;
  }

  private clearPreloadQueue(): void {
    this.generation++;
    this.runningGeneration = undefined;
    this.preloadQueue.clear();
    for (const [timer, cancel] of this.timers) {
      clearTimeout(timer);
      cancel?.();
    }
    this.timers.clear();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.timers.delete(timer); resolve(); }, ms);
      this.timers.set(timer, resolve);
    });
  }

  getStats() {
    return {
      cache: this.cache.getStats(), hitRate: this.cache.getHitRate(),
      queueSize: this.preloadQueue.size, isPreloading: this.runningGeneration === this.generation,
    };
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.cleanupInterval);
    this.clearCurrentBook();
  }
}
