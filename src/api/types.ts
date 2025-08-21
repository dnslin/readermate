export interface Book {
  name: string;
  author: string;
  bookUrl: string;
  coverUrl?: string;
  lastChapter?: string;
  readProgress?: number;
  durChapterIndex?: number; // 当前阅读进度的章节索引
  totalChapterNum?: number; // 总章节数
  latestChapterTitle?: string; // 最新章节标题
}

export interface Chapter {
  title: string;
  url: string;
  index: number;
}

export interface BookContent {
  title: string;
  content: string;
  nextUrl?: string;
  prevUrl?: string;
}
