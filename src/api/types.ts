/** Only the selected backend's settings are supplied to an API session. */
export type ReaderBackendConfig =
  | {
      backend: "reader3";
      serverUrl: string;
      accessToken?: string;
      appendReader3Path: boolean;
    }
  | {
      backend: "legado";
      serverUrl: string;
      apiKey: string;
    };

export interface Book {
  name: string;
  author: string;
  bookUrl: string;
  /** Opaque connection/account identity; old or foreign books cannot be reopened. */
  sourceKey: string;
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
  /** A volume heading has an index but no readable content. */
  isVolume?: boolean;
}

export interface BookContent {
  title: string;
  content: string;
  nextUrl?: string;
  prevUrl?: string;
}

export type WebviewIncomingMessage =
  | { command: "prevChapter" }
  | { command: "nextChapter" }
  | { command: "selectChapter" }
  | { command: "retry" }
  | { command: "readingProgress"; progress: number }
  | { command: "focus" }
  | { command: "blur" }
  | { command: "ready" }
  | { command: "panic" };

export type WebviewOutgoingMessage =
  | { command: "loading"; data?: { title?: string } }
  | { command: "error"; data: { message: string } }
  | {
      command: "updateChapter";
      data: {
        title: string;
        content: string;
        chapterIndex: number;
        totalChapters: number;
        hasPrev: boolean;
        hasNext: boolean;
      };
    }
  | {
      command: "applyStealth";
      data: {
        stealthEnabled: boolean;
        hideToolbar: boolean;
        fontSize: number;
        lineHeight: number;
      };
    };
