import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book, Chapter } from "../api/types";
import { BookshelfProvider } from "./bookshelfProvider";
import { PreloadManager } from "../preload/preloadManager";
import { PreloadConfig, ReadingProgressEvent } from "../preload/types";
import { logger } from "../utils/logger";
import { showFriendlyError } from "../utils/messages";

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class ReaderViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "readermateReaderPanel";

  private _view?: vscode.WebviewView;
  private readonly _extensionUri: vscode.Uri;

  public currentBook?: Book;
  public chapters: Chapter[] = [];
  public currentChapterIndex = 0;
  private apiClient: ReaderApiClient;
  private bookshelfProvider?: BookshelfProvider;
  private preloadManager: PreloadManager;
  private _isWebviewReady = false;
  private _pendingBook?: { book: Book; chapterIndex?: number };
  private _pendingChapterContent?: {
    title: string;
    content: string;
    chapterIndex: number;
    totalChapters: number;
    hasPrev: boolean;
    hasNext: boolean;
  };

  constructor(
    extensionUri: vscode.Uri,
    apiClient: ReaderApiClient,
    bookshelfProvider?: BookshelfProvider,
    preloadConfig?: PreloadConfig
  ) {
    this._extensionUri = extensionUri;
    this.apiClient = apiClient;
    this.bookshelfProvider = bookshelfProvider;

    const defaultConfig: PreloadConfig = {
      enabled: true,
      chapterCount: 2,
      triggerProgress: 50,
      maxCacheSize: 10,
    };
    this.preloadManager = new PreloadManager(
      apiClient,
      preloadConfig || defaultConfig
    );
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    this._isWebviewReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "media"),
        vscode.Uri.joinPath(this._extensionUri, "out"),
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "prevChapter":
          this.prevChapter();
          break;
        case "nextChapter":
          this.nextChapter();
          break;
        case "selectChapter":
          this.selectChapter();
          break;
        case "retry":
          this.loadCurrentChapter();
          break;
        case "readingProgress":
          this.handleReadingProgress(message.progress);
          break;
        case "ready":
          this._isWebviewReady = true;
          this.applySettings();
          if (this._pendingChapterContent) {
            webviewView.webview.postMessage({
              command: "updateChapter",
              data: this._pendingChapterContent,
            });
          } else if (this.currentBook && this.chapters.length > 0) {
            this.loadCurrentChapter();
          }
          break;
        case "panic":
          try {
            vscode.commands.executeCommand("workbench.action.closePanel");
          } catch {}
          break;
      }
    });

    vscode.commands.executeCommand(
      "setContext",
      "readermate.readerActive",
      true
    );

    if (this._pendingBook) {
      const { book, chapterIndex } = this._pendingBook;
      this._pendingBook = undefined;
      this.openBook(book, chapterIndex);
    }
  }

  public updatePreloadConfig(config: PreloadConfig): void {
    this.preloadManager.updateConfig(config);
    logger.info("预加载配置已更新", "ReaderViewProvider");
  }

  public updateApiClient(apiClient: ReaderApiClient): void {
    logger.info("开始更新API客户端", "ReaderViewProvider");
    this.apiClient = apiClient;
    this.preloadManager.updateApiClient(apiClient);
    logger.info("API客户端已更新", "ReaderViewProvider");
  }

  public updateBookshelfProvider(bookshelfProvider: BookshelfProvider): void {
    logger.info("更新书架提供者", "ReaderViewProvider");
    this.bookshelfProvider = bookshelfProvider;
  }

  public applySettings(): void {
    if (!this._view) return;
    try {
      const cfg = vscode.workspace.getConfiguration("readermate");
      const stealthEnabled = cfg.get<boolean>("stealth.enabled", true);
      const hideToolbar = cfg.get<boolean>("stealth.hideToolbar", true);
      const fontSize = cfg.get<number>("reader.fontSize", 16);
      const lineHeight = cfg.get<number>("reader.lineHeight", 1.7);

      this._view.webview.postMessage({
        command: "applyStealth",
        data: { stealthEnabled, hideToolbar, fontSize, lineHeight },
      });
      logger.debug("已向面板应用最新阅读与隐身设置", "ReaderViewProvider");
    } catch (e) {
      logger.error(e, "面板应用设置失败", "ReaderViewProvider");
    }
  }

  private handleReadingProgress(progress: number): void {
    if (!this.currentBook || this.chapters.length === 0) {
      return;
    }

    const event: ReadingProgressEvent = {
      chapterIndex: this.currentChapterIndex,
      progress: progress,
      totalChapters: this.chapters.length,
    };

    this.preloadManager.onReadingProgress(event);
    logger.debug(
      `阅读进度更新: 第${this.currentChapterIndex + 1}章 ${progress}%`,
      "ReaderViewProvider"
    );
  }

  public async openBook(book: Book, chapterIndex?: number) {
    if (!this._view) {
      this._pendingBook = { book, chapterIndex };
      vscode.commands.executeCommand("readermateReaderPanel.focus");
      return;
    }

    this.currentBook = book;

    try {
      this._view.webview.postMessage({
        command: "loading",
        data: { title: book.name },
      });

      logger.info(
        `开始获取章节列表: ${book.name}, bookUrl: ${book.bookUrl}`,
        "ReaderViewProvider"
      );
      this.chapters = await this.apiClient.getChapterList(book.bookUrl);
      logger.info(
        `章节列表获取成功，共 ${this.chapters.length} 章`,
        "ReaderViewProvider"
      );

      if (
        chapterIndex !== undefined &&
        chapterIndex >= 0 &&
        chapterIndex < this.chapters.length
      ) {
        this.currentChapterIndex = chapterIndex;
      } else {
        this.currentChapterIndex = book.durChapterIndex || 0;
      }

      if (this.currentChapterIndex >= this.chapters.length) {
        this.currentChapterIndex = 0;
      }

      await this.loadCurrentChapter();
      this.preloadManager.setCurrentBook(book.bookUrl, this.chapters.length);
    } catch (error) {
      logger.error(error, "加载章节失败", "ReaderViewProvider");
      showFriendlyError("chapterList", error, "ReaderViewProvider");
      this._view.webview.postMessage({
        command: "error",
        data: { message: "加载章节列表失败，请检查网络或服务配置" },
      });
    }
  }

  public async prevChapter() {
    if (this.currentChapterIndex > 0) {
      this.currentChapterIndex--;
      await this.loadCurrentChapter();
      await this.saveCurrentProgress();
    }
  }

  public async nextChapter() {
    if (this.currentChapterIndex < this.chapters.length - 1) {
      this.currentChapterIndex++;
      await this.loadCurrentChapter();
      await this.saveCurrentProgress();
    }
  }

  public async selectChapter() {
    if (!this.currentBook || this.chapters.length === 0) {
      vscode.window.showInformationMessage("请先打开一本书籍");
      return;
    }

    const items = this.chapters.map((ch) => ({
      label: ch.title,
      description:
        ch.index === this.currentChapterIndex ? "当前章节" : undefined,
      index: ch.index,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `选择《${this.currentBook.name}》的章节（共 ${this.chapters.length} 章）`,
      matchOnDescription: true,
    });

    if (picked) {
      this.currentChapterIndex = picked.index;
      await this.loadCurrentChapter();
      await this.saveCurrentProgress();
    }
  }

  private async saveCurrentProgress() {
    if (!this.currentBook || !this.chapters[this.currentChapterIndex]) {
      return;
    }

    try {
      await this.apiClient.saveBookProgress(
        this.currentBook.bookUrl,
        this.currentChapterIndex
      );
      if (this.bookshelfProvider) {
        this.bookshelfProvider.refresh();
      }
    } catch (error) {
      logger.warn(`保存阅读进度失败: ${String(error)}`, "ReaderViewProvider");
    }
  }

  public async loadCurrentChapter() {
    if (!this.chapters[this.currentChapterIndex] || !this.currentBook) {
      return;
    }

    const chapter = this.chapters[this.currentChapterIndex];
    if (this._view) {
      this._view.webview.postMessage({
        command: "loading",
        data: { title: chapter.title },
      });
    }

    try {
      const content = await this.preloadManager.getChapterContent(
        this.currentBook.bookUrl,
        this.currentChapterIndex
      );

      if (
        chapter.title &&
        content &&
        typeof content === "object" &&
        !Array.isArray(content)
      ) {
        content.title = chapter.title;
      }

      const messagePayload = {
        title: content.title,
        content: content.content,
        chapterIndex: this.currentChapterIndex,
        totalChapters: this.chapters.length,
        hasPrev: this.currentChapterIndex > 0,
        hasNext: this.currentChapterIndex < this.chapters.length - 1,
      };

      this._pendingChapterContent = messagePayload;

      if (this._view && this._isWebviewReady) {
        this._view.webview.postMessage({
          command: "updateChapter",
          data: messagePayload,
        });
      }
    } catch (error) {
      logger.error(error, "加载章节内容失败", "ReaderViewProvider");
      showFriendlyError("content", error, "ReaderViewProvider");
      if (this._view) {
        this._view.webview.postMessage({
          command: "error",
          data: { message: "章节内容加载失败，请点击重试" },
        });
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "reader.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "reader.css")
    );
    const cfg = vscode.workspace.getConfiguration("readermate");
    const fontSize = cfg.get<number>("reader.fontSize", 16);
    const lineHeight = cfg.get<number>("reader.lineHeight", 1.7);
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">
        <style>
          :root {
            --reader-font-size: ${fontSize}px;
            --reader-line-height: ${lineHeight};
          }
        </style>
        <title>ReaderMate</title>
      </head>
      <body>
        <div class="reader-container">
          <div class="toolbar">
            <button id="prev-btn" class="nav-btn" disabled>上一章</button>
            <button id="catalog-btn" class="nav-btn catalog-btn" title="查看目录 (Ctrl+Shift+C)">目录</button>
            <span id="chapter-info">未加载</span>
            <button id="next-btn" class="nav-btn" disabled>下一章</button>
          </div>
          <div class="content-area">
            <div id="loading-box" class="loading-state" style="display: none;">
              <div class="spinner"></div>
              <p id="loading-text">正在加载章节内容...</p>
            </div>
            <div id="error-box" class="error-state" style="display: none;">
              <p id="error-text">加载失败</p>
              <button id="retry-btn" class="nav-btn">重试</button>
            </div>
            <div id="chapter-body">
              <div id="chapter-title"></div>
              <div id="chapter-content" class="content"></div>
            </div>
          </div>
        </div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }

  public dispose() {
    this.preloadManager.dispose();
  }
}
