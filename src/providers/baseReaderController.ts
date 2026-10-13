import * as vscode from "vscode";
import { ReaderApiClient } from "../api/readerApi";
import { Book, Chapter, WebviewIncomingMessage, WebviewOutgoingMessage } from "../api/types";
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

export abstract class BaseReaderController {
  protected readonly _extensionUri: vscode.Uri;
  public apiClient: ReaderApiClient;
  public bookshelfProvider?: BookshelfProvider;
  public preloadManager: PreloadManager;

  public currentBook?: Book;
  public chapters: Chapter[] = [];
  public currentChapterIndex = 0;

  protected _isWebviewReady = false;
  protected _isNavigating = false;
  protected _lastNavTime = 0;
  protected _bookOperation = 0;
  protected _chapterOperation = 0;
  protected _pendingChapterContent?: {
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

  /**
   * 抽象方法：由具体宿主返回 Webview 对象
   */
  public abstract getWebview(): vscode.Webview | undefined;

  /**
   * 抽象方法：更新标题或描述
   */
  public abstract updateTitle(stealthTitle?: string): void;

  /**
   * 抽象方法：销毁清理资源
   */
  public abstract dispose(): void;

  public updatePreloadConfig(config: PreloadConfig): void {
    this.preloadManager.updateConfig(config);
    logger.info("预加载配置已更新", this.constructor.name);
  }

  public updateApiClient(apiClient: ReaderApiClient): void {
    this.resetReadingState();
    this.apiClient = apiClient;
    this.preloadManager.updateApiClient(apiClient);
  }

  protected resetReadingState(): void {
    this._bookOperation++;
    this._chapterOperation++;
    this.currentBook = undefined;
    this.chapters = [];
    this.currentChapterIndex = 0;
    this._pendingChapterContent = undefined;
    this._isNavigating = false;
    this._lastNavTime = 0;
    this.preloadManager.clearCurrentBook();
    const webview = this.getWebview();
    if (webview) {
      this._isWebviewReady = false;
      webview.html = this.getHtmlForWebview(webview);
    }
    this.updateTitle();
  }

  protected isCurrentBook(api: ReaderApiClient, book: Book, operation: number): boolean {
    return api.isActive && this.apiClient === api && this.currentBook === book &&
      this._bookOperation === operation && api.ownsBook(book);
  }

  public updateBookshelfProvider(bookshelfProvider: BookshelfProvider): void {
    logger.info("更新书架提供者", this.constructor.name);
    this.bookshelfProvider = bookshelfProvider;
  }

  public applySettings(): void {
    try {
      const cfg = vscode.workspace.getConfiguration("readermate");
      const stealthEnabled = cfg.get<boolean>("stealth.enabled", true);
      const hideToolbar = cfg.get<boolean>("stealth.hideToolbar", true);
      const fontSize = cfg.get<number>("reader.fontSize", 16);
      const lineHeight = cfg.get<number>("reader.lineHeight", 1.7);
      const disguiseTitle = cfg.get<string>("stealth.disguiseTitle", "输出");

      this.updateTitle(stealthEnabled ? disguiseTitle || "输出" : undefined);

      const webview = this.getWebview();
      if (webview) {
        webview.postMessage({
          command: "applyStealth",
          data: { stealthEnabled, hideToolbar, fontSize, lineHeight },
        });
      }
      logger.debug("已应用最新阅读与隐身设置", this.constructor.name);
    } catch (e) {
      logger.error(e, "应用设置失败", this.constructor.name);
    }
  }

  protected handleReadingProgress(progress: number): void {
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
      this.constructor.name
    );
  }

  public async openBook(book: Book, chapterIndex?: number): Promise<void> {
    const api = this.apiClient;
    if (!api.isActive || !api.ownsBook(book)) return;
    const operation = ++this._bookOperation;
    this._chapterOperation++;
    this.currentBook = book;
    this.chapters = [];
    this._pendingChapterContent = undefined;
    this._isNavigating = false;
    this._lastNavTime = 0;
    this.preloadManager.clearCurrentBook();
    this.applySettings();
    const webview = this.getWebview();
    webview?.postMessage({ command: "loading", data: { title: book.name } });
    try {
      const chapters = await api.getChapterList(book.bookUrl);
      if (!this.isCurrentBook(api, book, operation)) return;
      this.chapters = chapters;
      const requested = chapterIndex ?? book.durChapterIndex ?? 0;
      const readable = chapters.find(chapter => !chapter.isVolume && chapter.index >= requested) ||
        chapters.find(chapter => !chapter.isVolume);
      if (!readable) {
        webview?.postMessage({ command: "error", data: { message: "没有可读取的章节" } });
        return;
      }
      this.currentChapterIndex = readable.index;
      this.preloadManager.setCurrentBook(book.bookUrl, chapters);
      await this.loadCurrentChapter();
    } catch (error) {
      if (!this.isCurrentBook(api, book, operation)) return;
      logger.error(error, "加载章节失败", this.constructor.name);
      showFriendlyError("chapterList", error, this.constructor.name);
      webview?.postMessage({ command: "error", data: { message: "加载章节列表失败，请检查网络或服务配置" } });
    }
  }

  public async prevChapter(): Promise<void> {
    await this.navigateChapter(-1);
  }

  public async nextChapter(): Promise<void> {
    await this.navigateChapter(1);
  }

  private async navigateChapter(direction: -1 | 1): Promise<void> {
    const book = this.currentBook;
    const api = this.apiClient;
    const operation = this._bookOperation;
    const now = Date.now();
    if (!book || !this.isCurrentBook(api, book, operation) || this._isNavigating || now - this._lastNavTime < 300) return;
    const position = this.chapters.findIndex(chapter => chapter.index === this.currentChapterIndex);
    const candidates = direction === 1 ? this.chapters.slice(position + 1) : this.chapters.slice(0, position).reverse();
    const target = candidates.find(chapter => !chapter.isVolume);
    if (!target) return;
    this._isNavigating = true;
    this._lastNavTime = now;
    try {
      this.currentChapterIndex = target.index;
      await this.loadCurrentChapter();
    } finally {
      if (this.isCurrentBook(api, book, operation)) this._isNavigating = false;
    }
  }

  public async selectChapter(): Promise<void> {
    const book = this.currentBook;
    const api = this.apiClient;
    const operation = this._bookOperation;
    if (!book || !this.isCurrentBook(api, book, operation) || this.chapters.length === 0) {
      vscode.window.showInformationMessage("请先打开一本书籍");
      return;
    }
    const items = this.chapters.filter(chapter => !chapter.isVolume).map(chapter => ({
      label: chapter.title,
      description: chapter.index === this.currentChapterIndex ? "当前章节" : undefined,
      index: chapter.index,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `选择《${book.name}》的章节（共 ${items.length} 章）`, matchOnDescription: true,
    });
    if (picked && this.isCurrentBook(api, book, operation)) {
      this.currentChapterIndex = picked.index;
      await this.loadCurrentChapter();
    }
  }

  public async loadCurrentChapter(): Promise<void> {
    const api = this.apiClient;
    const book = this.currentBook;
    const operation = this._bookOperation;
    const chapter = this.chapters.find(item => item.index === this.currentChapterIndex && !item.isVolume);
    if (!book || !chapter || !this.isCurrentBook(api, book, operation)) return;
    const load = ++this._chapterOperation;
    const webview = this.getWebview();
    webview?.postMessage({ command: "loading", data: { title: chapter.title } });
    try {
      const content = await this.preloadManager.getChapterContent(book.bookUrl, chapter.index);
      if (!this.isCurrentBook(api, book, operation) || load !== this._chapterOperation) return;
      const position = this.chapters.indexOf(chapter);
      const messagePayload = {
        title: chapter.title || content.title, content: content.content,
        chapterIndex: chapter.index, totalChapters: this.chapters.length,
        hasPrev: this.chapters.slice(0, position).some(item => !item.isVolume),
        hasNext: this.chapters.slice(position + 1).some(item => !item.isVolume),
      };
      this._pendingChapterContent = messagePayload;
      if (this._isWebviewReady && webview) webview.postMessage({ command: "updateChapter", data: messagePayload });
      try {
        await api.saveBookProgress(book.bookUrl, chapter.index);
        if (this.isCurrentBook(api, book, operation) && load === this._chapterOperation) this.bookshelfProvider?.refresh();
      } catch (error) {
        if (this.isCurrentBook(api, book, operation)) logger.warn(`保存阅读进度失败: ${String(error)}`, this.constructor.name);
      }
    } catch (error) {
      if (!this.isCurrentBook(api, book, operation) || load !== this._chapterOperation) return;
      logger.error(error, "加载章节内容失败", this.constructor.name);
      showFriendlyError("content", error, this.constructor.name);
      webview?.postMessage({ command: "error", data: { message: "章节内容加载失败，请点击重试" } });
    }
  }

  protected handleWebviewMessage(message: unknown): void {
    if (!message || typeof message !== "object" || !("command" in message)) {
      return;
    }
    const msg = message as WebviewIncomingMessage;
    const webview = this.getWebview();
    switch (msg.command) {
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
        if (typeof msg.progress === "number") {
          this.handleReadingProgress(msg.progress);
        }
        break;
      case "focus":
        vscode.commands.executeCommand(
          "setContext",
          "readermate.readerFocused",
          true
        );
        break;
      case "blur":
        vscode.commands.executeCommand(
          "setContext",
          "readermate.readerFocused",
          false
        );
        break;
      case "ready":
        this._isWebviewReady = true;
        this.applySettings();
        if (this._pendingChapterContent && webview) {
          const updateMsg: WebviewOutgoingMessage = {
            command: "updateChapter",
            data: this._pendingChapterContent,
          };
          webview.postMessage(updateMsg);
        }
        break;
      case "panic":
        BaseReaderController.handleBossKey();
        break;
    }
  }

  public getHtmlForWebview(webview: vscode.Webview): string {
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

  /**
   * 全局老板键处理：关闭所有阅读界面并瞬间回到代码编辑状态
   */
  public static handleBossKey(): void {
    logger.info("执行全局老板键 (Boss Key)", "BaseReaderController");
    // 1. 关闭编辑器模式下的阅读标签页
    vscode.commands.executeCommand("readermate.closePanelIfOpen");

    // 2. 关闭侧边栏
    try {
      vscode.commands.executeCommand("workbench.action.closeSidebar");
    } catch (error) {
      logger.warn(`关闭侧边栏失败: ${String(error)}`, "BaseReaderController");
    }

    // 3. 关闭底部面板
    try {
      vscode.commands.executeCommand("workbench.action.closePanel");
    } catch (error) {
      logger.warn(`关闭底部面板失败: ${String(error)}`, "BaseReaderController");
    }

    // 4. 将焦点切回主代码编辑区域
    try {
      vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    } catch (error) {
      logger.warn(`恢复编辑器焦点失败: ${String(error)}`, "BaseReaderController");
    }

    vscode.commands.executeCommand(
      "setContext",
      "readermate.readerFocused",
      false
    );
  }
}
