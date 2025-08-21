import { BookContent } from "../api/types";

/**
 * 预加载配置接口
 */
export interface PreloadConfig {
  /** 是否启用预加载 */
  enabled: boolean;
  /** 预加载章节数量 */
  chapterCount: number;
  /** 触发预加载的阅读进度百分比 */
  triggerProgress: number;
  /** 最大缓存章节数量 */
  maxCacheSize: number;
}

/**
 * 预加载状态枚举
 */
export enum PreloadStatus {
  /** 空闲状态 */
  IDLE = "idle",
  /** 预加载中 */
  LOADING = "loading",
  /** 预加载完成 */
  COMPLETED = "completed",
  /** 预加载失败 */
  FAILED = "failed",
}

/**
 * 预加载任务接口
 */
export interface PreloadTask {
  /** 书籍URL */
  bookUrl: string;
  /** 章节索引 */
  chapterIndex: number;
  /** 任务状态 */
  status: PreloadStatus;
  /** 重试次数 */
  retryCount: number;
  /** 创建时间 */
  createdAt: number;
}

/**
 * 缓存项接口
 */
export interface CacheItem {
  /** 章节内容 */
  content: BookContent;
  /** 访问时间 */
  accessTime: number;
  /** 缓存时间 */
  cacheTime: number;
}

/**
 * 预加载统计信息
 */
export interface PreloadStats {
  /** 缓存命中次数 */
  cacheHits: number;
  /** 缓存未命中次数 */
  cacheMisses: number;
  /** 预加载成功次数 */
  preloadSuccess: number;
  /** 预加载失败次数 */
  preloadFailures: number;
  /** 当前缓存大小 */
  currentCacheSize: number;
}

/**
 * 阅读进度事件接口
 */
export interface ReadingProgressEvent {
  /** 当前章节索引 */
  chapterIndex: number;
  /** 阅读进度百分比 */
  progress: number;
  /** 总章节数 */
  totalChapters: number;
}

