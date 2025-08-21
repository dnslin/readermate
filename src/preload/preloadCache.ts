import { BookContent } from "../api/types";
import { CacheItem, PreloadStats } from "./types";

/**
 * 预加载缓存管理器
 * 使用LRU（最近最少使用）策略管理章节内容缓存
 */
export class PreloadCache {
  private cache: Map<string, CacheItem> = new Map();
  private accessOrder: string[] = [];
  private maxSize: number;
  private stats: PreloadStats;

  constructor(maxSize: number = 10) {
    this.maxSize = maxSize;
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      preloadSuccess: 0,
      preloadFailures: 0,
      currentCacheSize: 0
    };
  }

  /**
   * 生成缓存键
   */
  private generateKey(bookUrl: string, chapterIndex: number): string {
    return `${bookUrl}#${chapterIndex}`;
  }

  /**
   * 更新访问顺序（LRU）
   */
  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * 淘汰最近最少使用的缓存项
   */
  private evictLRU(): void {
    if (this.accessOrder.length === 0) {
      return;
    }

    const oldestKey = this.accessOrder.shift();
    if (oldestKey && this.cache.has(oldestKey)) {
      this.cache.delete(oldestKey);
      console.log(`[PreloadCache] 淘汰缓存项: ${oldestKey}`);
    }
  }

  /**
   * 设置缓存项
   */
  set(bookUrl: string, chapterIndex: number, content: BookContent): void {
    const key = this.generateKey(bookUrl, chapterIndex);
    const now = Date.now();

    // 如果缓存已满，先淘汰最旧的项
    while (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const cacheItem: CacheItem = {
      content,
      accessTime: now,
      cacheTime: now
    };

    this.cache.set(key, cacheItem);
    this.updateAccessOrder(key);
    this.stats.currentCacheSize = this.cache.size;
    this.stats.preloadSuccess++;

    console.log(`[PreloadCache] 缓存章节: ${bookUrl} 第${chapterIndex + 1}章`);
  }

  /**
   * 获取缓存项
   */
  get(bookUrl: string, chapterIndex: number): BookContent | undefined {
    const key = this.generateKey(bookUrl, chapterIndex);
    const cacheItem = this.cache.get(key);

    if (cacheItem) {
      // 更新访问时间和顺序
      cacheItem.accessTime = Date.now();
      this.updateAccessOrder(key);
      this.stats.cacheHits++;
      
      console.log(`[PreloadCache] 缓存命中: ${bookUrl} 第${chapterIndex + 1}章`);
      return cacheItem.content;
    }

    this.stats.cacheMisses++;
    console.log(`[PreloadCache] 缓存未命中: ${bookUrl} 第${chapterIndex + 1}章`);
    return undefined;
  }

  /**
   * 检查是否存在缓存
   */
  has(bookUrl: string, chapterIndex: number): boolean {
    const key = this.generateKey(bookUrl, chapterIndex);
    return this.cache.has(key);
  }

  /**
   * 删除特定缓存项
   */
  delete(bookUrl: string, chapterIndex: number): boolean {
    const key = this.generateKey(bookUrl, chapterIndex);
    const deleted = this.cache.delete(key);
    
    if (deleted) {
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      this.stats.currentCacheSize = this.cache.size;
      console.log(`[PreloadCache] 删除缓存项: ${key}`);
    }
    
    return deleted;
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.stats.currentCacheSize = 0;
    console.log("[PreloadCache] 清空所有缓存");
  }

  /**
   * 清理过期缓存（超过1小时的缓存）
   */
  cleanExpired(): void {
    const now = Date.now();
    const expireTime = 60 * 60 * 1000; // 1小时
    const keysToDelete: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (now - item.cacheTime > expireTime) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      this.cache.delete(key);
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
    });

    if (keysToDelete.length > 0) {
      this.stats.currentCacheSize = this.cache.size;
      console.log(`[PreloadCache] 清理过期缓存: ${keysToDelete.length} 项`);
    }
  }

  /**
   * 更新最大缓存大小
   */
  setMaxSize(maxSize: number): void {
    this.maxSize = maxSize;
    
    // 如果当前缓存超过新的最大值，淘汰多余的项
    while (this.cache.size > this.maxSize) {
      this.evictLRU();
    }
    
    this.stats.currentCacheSize = this.cache.size;
    console.log(`[PreloadCache] 更新最大缓存大小: ${maxSize}`);
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): PreloadStats {
    return { ...this.stats };
  }

  /**
   * 获取缓存命中率
   */
  getHitRate(): number {
    const total = this.stats.cacheHits + this.stats.cacheMisses;
    return total > 0 ? (this.stats.cacheHits / total) * 100 : 0;
  }

  /**
   * 记录预加载失败
   */
  recordPreloadFailure(): void {
    this.stats.preloadFailures++;
  }
}
